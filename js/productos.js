/**
 * Capa de datos de productos. Sin DOM.
 *
 * - El catálogo completo se sincroniza con un solo listener y vive en la caché
 *   persistente de Firestore: búsquedas instantáneas, sin señal y al día con
 *   lo que editan otras estaciones.
 * - Las actualizaciones envían solo los campos que cambiaron (sin pisar el
 *   trabajo de otra estación). Un cambio de precio sale en el mismo lote que
 *   su entrada de priceHistory, como exigen las reglas.
 * - Sin señal, las escrituras quedan en cola local; esperarConfirmacion()
 *   permite avisar al personal sin bloquear la pantalla.
 */
import {
  db, doc, collection, query, where, orderBy, limit,
  getDoc, getDocs, onSnapshot, writeBatch, setDoc, Timestamp,
} from './firebase.js';
import { armarProducto, tokensBusqueda, idHistorialPrecio, prepararConsulta } from './esquema.js';
import { normalizarUPC } from './upca.js';

export const ahora = () => Timestamp.fromMillis(Date.now());

const productos = () => collection(db, 'products');
const conId = (instantanea) => ({ id: instantanea.id, ...instantanea.data() });

/**
 * Sincroniza el catálogo completo. `alCambiar` recibe el Map id → producto
 * (el mismo objeto, actualizado in situ), si los datos vienen de caché y si
 * hay escrituras pendientes de enviar.
 * @returns {() => void} función para dejar de observar
 */
export function observarCatalogo(alCambiar, alFallar) {
  const catalogo = new Map();
  return onSnapshot(
    query(productos(), orderBy('nombre')),
    { includeMetadataChanges: true },
    (instantanea) => {
      for (const cambio of instantanea.docChanges()) {
        if (cambio.type === 'removed') catalogo.delete(cambio.doc.id);
        else catalogo.set(cambio.doc.id, conId(cambio.doc));
      }
      alCambiar({
        catalogo,
        desdeCache: instantanea.metadata.fromCache,
        pendientes: instantanea.metadata.hasPendingWrites,
      });
    },
    alFallar,
  );
}

/** Tiendas ordenadas por nombre (activas e inactivas; la UI decide). */
export function observarTiendas(alCambiar, alFallar) {
  return onSnapshot(
    query(collection(db, 'stores'), orderBy('nombre')),
    (instantanea) => alCambiar(instantanea.docs.map(conId)),
    alFallar,
  );
}

/** Productos con ese UPC (normalizado a 12 dígitos). Debería haber 0 o 1. */
export async function buscarPorUPC(upc) {
  const codigo = normalizarUPC(upc);
  const resultado = await getDocs(query(productos(), where('upc', '==', codigo), limit(2)));
  return resultado.docs.map(conId);
}

/**
 * Búsqueda en Firestore con array-contains sobre tokensBusqueda (el término
 * más largo); el resto de términos se filtra aquí. Es la vía cuando el
 * catálogo aún no terminó de sincronizarse.
 */
export async function buscarPorTexto(consulta, maximo = 50) {
  const { termino, resto } = prepararConsulta(consulta);
  if (!termino) return [];
  const resultado = await getDocs(
    query(productos(), where('tokensBusqueda', 'array-contains', termino), orderBy('nombre'), limit(maximo)),
  );
  return resultado.docs.map(conId).filter((p) => resto.every((t) => p.tokensBusqueda.includes(t)));
}

export async function obtenerProducto(id) {
  const instantanea = await getDoc(doc(productos(), id));
  return instantanea.exists() ? conId(instantanea) : null;
}

/** Observa un producto abierto para detectar cambios de otra estación. */
export function observarProducto(id, alCambiar, alFallar) {
  return onSnapshot(
    doc(productos(), id),
    { includeMetadataChanges: true },
    (instantanea) => alCambiar(instantanea.exists() ? conId(instantanea) : null, instantanea.metadata),
    alFallar,
  );
}

/** Historial de precios de un producto, del más reciente al más antiguo. */
export function observarHistorial(id, alCambiar, alFallar) {
  return onSnapshot(
    query(collection(db, 'priceHistory'), where('productId', '==', id)),
    (instantanea) =>
      alCambiar(instantanea.docs.map(conId).sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis())),
    alFallar,
  );
}

/**
 * Crea un producto con id automático (nunca el UPC).
 * @returns {{ id: string, producto: object, promesa: Promise<void> }}
 */
export function crearProducto(datos, correo) {
  const marca = ahora();
  const referencia = doc(productos());
  const producto = { ...armarProducto(datos, correo), creadoEn: marca, actualizadoEn: marca };
  return { id: referencia.id, producto, promesa: setDoc(referencia, producto) };
}

/**
 * Aplica solo `cambios` sobre el producto `actual`. Si cambia el precio,
 * escribe la entrada de priceHistory en el mismo lote.
 * @returns {{ promesa: Promise<void>, parche: object, cambioPrecio: boolean }}
 */
export function actualizarProducto(actual, cambios, correo) {
  const marca = ahora();
  const usuario = String(correo).toLowerCase();
  const parche = { ...cambios, actualizadoEn: marca, actualizadoPor: usuario };
  if ('nombre' in cambios || 'marca' in cambios) {
    parche.tokensBusqueda = tokensBusqueda(cambios.nombre ?? actual.nombre, cambios.marca ?? actual.marca);
  }
  const cambioPrecio = 'precioCentavos' in cambios && cambios.precioCentavos !== actual.precioCentavos;

  const lote = writeBatch(db);
  lote.update(doc(productos(), actual.id), parche);
  if (cambioPrecio) {
    lote.set(doc(db, 'priceHistory', idHistorialPrecio(actual.id, marca.toMillis())), {
      productId: actual.id,
      precioAnteriorCentavos: actual.precioCentavos,
      precioNuevoCentavos: cambios.precioCentavos,
      fecha: marca,
      usuario,
    });
  }
  return { promesa: lote.commit(), parche, cambioPrecio };
}

/**
 * Espera la confirmación del servidor hasta `ms`. Si no llega (sin señal),
 * la escritura ya quedó aplicada y encolada localmente: 'pendiente'.
 * Un rechazo antes del plazo se propaga como error.
 */
export function esperarConfirmacion(promesa, ms = 2500) {
  return Promise.race([
    promesa.then(() => 'confirmado'),
    new Promise((resolver) => setTimeout(() => resolver('pendiente'), ms)),
  ]);
}
