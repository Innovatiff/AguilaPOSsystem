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
import { armarProducto, tokensBusqueda, idHistorialPrecio, prepararConsulta, fechaISOLocal } from './esquema.js';
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
/**
 * Parche de actualización de un producto y, si cambia el precio, la entrada
 * de historial que debe acompañarlo en el mismo lote.
 */
export function prepararParche(actual, cambios, correo, marca) {
  const usuario = String(correo).toLowerCase();
  const parche = { ...cambios, actualizadoEn: marca, actualizadoPor: usuario };
  if ('nombre' in cambios || 'marca' in cambios) {
    parche.tokensBusqueda = tokensBusqueda(cambios.nombre ?? actual.nombre, cambios.marca ?? actual.marca);
  }
  const cambioPrecio = 'precioCentavos' in cambios && cambios.precioCentavos !== actual.precioCentavos;
  const historial = cambioPrecio
    ? {
      id: idHistorialPrecio(actual.id, marca.toMillis()),
      datos: {
        productId: actual.id,
        precioAnteriorCentavos: actual.precioCentavos,
        precioNuevoCentavos: cambios.precioCentavos,
        fecha: marca,
        usuario,
      },
    }
    : null;
  return { parche, historial, cambioPrecio };
}

export function actualizarProducto(actual, cambios, correo) {
  const marca = ahora();
  const { parche, historial, cambioPrecio } = prepararParche(actual, cambios, correo, marca);
  const lote = writeBatch(db);
  lote.update(doc(productos(), actual.id), parche);
  if (historial) lote.set(doc(db, 'priceHistory', historial.id), historial.datos);
  return { promesa: lote.commit(), parche, cambioPrecio };
}

/**
 * Las reglas hacen una lectura única por cambio de precio (get del producto)
 * y Firestore admite 20 lecturas de reglas por lote; 12 productos por lote
 * deja margen (verificado en pruebas/reglas/limites.test.mjs).
 */
export const PRODUCTOS_POR_LOTE_IMPORTACION = 12;

/**
 * Ejecuta un plan de importación (ver js/csv.js) por lotes. Cada lote se
 * espera hasta 15 s; sin señal queda en cola y se informa como pendiente.
 * @param {{crear: Array<{datos: object, linea: number}>, actualizar: Array<{actual: object, cambios: object, linea: number}>}} plan
 * @param {(avance: object) => void} [alProgresar]
 */
export async function importarPlan(plan, correo, alProgresar = () => {}) {
  const trabajos = [
    ...plan.crear.map((t) => ({ tipo: 'crear', ...t })),
    ...plan.actualizar.map((t) => ({ tipo: 'actualizar', ...t })),
  ];
  const resumen = { total: trabajos.length, hechos: 0, confirmados: 0, pendientes: 0, fallidos: 0, errores: [] };
  for (let i = 0; i < trabajos.length; i += PRODUCTOS_POR_LOTE_IMPORTACION) {
    const grupo = trabajos.slice(i, i + PRODUCTOS_POR_LOTE_IMPORTACION);
    const marca = ahora();
    const lote = writeBatch(db);
    for (const trabajo of grupo) {
      if (trabajo.tipo === 'crear') {
        lote.set(doc(productos()), { ...trabajo.datos, creadoEn: marca, actualizadoEn: marca });
      } else {
        const { parche, historial } = prepararParche(trabajo.actual, trabajo.cambios, correo, marca);
        lote.update(doc(productos(), trabajo.actual.id), parche);
        if (historial) lote.set(doc(db, 'priceHistory', historial.id), historial.datos);
      }
    }
    const promesa = lote.commit();
    promesa.catch(() => {});
    let resultado;
    try {
      resultado = await esperarConfirmacion(promesa, 15000);
    } catch (error) {
      resultado = 'fallido';
      resumen.errores.push({ lineas: grupo.map((t) => t.linea), mensaje: error?.code ?? error?.message ?? 'error' });
    }
    if (resultado === 'confirmado') resumen.confirmados += grupo.length;
    else if (resultado === 'pendiente') resumen.pendientes += grupo.length;
    else resumen.fallidos += grupo.length;
    resumen.hechos += grupo.length;
    alProgresar({ ...resumen });
  }
  return resumen;
}

const OPERACIONES_POR_LOTE = 400; // Firestore admite 500 por lote

/**
 * Registra qué precio quedó impreso en la etiqueta de cada producto (solo los
 * que salieron de la impresora). `items` trae el precio tal como se imprimió,
 * no el actual: si otra estación lo cambió mientras tanto, el producto sigue
 * pendiente.
 * @param {Array<{id: string, precioCentavos: number}>} items
 * @returns {{ promesa: Promise<void[]>, cantidad: number, fecha: string }}
 */
export function marcarImpresos(items, correo) {
  const fecha = fechaISOLocal();
  const marca = ahora();
  const usuario = String(correo).toLowerCase();
  const unicos = new Map();
  for (const item of items) unicos.set(item.id, item.precioCentavos);

  const confirmaciones = [];
  let lote = writeBatch(db);
  let operaciones = 0;
  for (const [id, precioCentavos] of unicos) {
    lote.update(doc(productos(), id), {
      ultimoPrecioImpresoCentavos: precioCentavos,
      fechaUltimaImpresion: fecha,
      actualizadoEn: marca,
      actualizadoPor: usuario,
    });
    operaciones += 1;
    if (operaciones === OPERACIONES_POR_LOTE) {
      confirmaciones.push(lote.commit());
      lote = writeBatch(db);
      operaciones = 0;
    }
  }
  if (operaciones > 0) confirmaciones.push(lote.commit());
  return { promesa: Promise.all(confirmaciones), cantidad: unicos.size, fecha };
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
