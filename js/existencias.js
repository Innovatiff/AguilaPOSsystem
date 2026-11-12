/**
 * Existencias en Firestore (existencias/{tienda}__{producto}): el último
 * conteo de cada producto en la tienda y en la bodega, con la caducidad y el
 * país de procedencia (Inventario → Ajuste rápido), y lo movido desde
 * entonces: lo que vende la caja sale de la tienda y lo que llega en una
 * entrega entra a la bodega. El ajuste lo arma js/inventario.js
 * (armarAjuste); aquí se guarda y se observa.
 *
 * Se guarda con merge: el lugar que no se contó se queda como estaba (dos
 * personas pueden contar la tienda y la bodega a la vez). Sin señal, la
 * escritura queda en cola y se envía al volver. Las reglas (sección
 * "existencias") exigen la hora del servidor y que quien cuenta sea quien dice.
 *
 * Los movimientos (ventas y entregas) no se esperan ni detienen nada. Se
 * mandan solo los que el servidor va a aceptar (donde hay existencias, y si
 * pasaron después del último conteo de ese lugar): un rechazo en la cola de
 * escrituras haría que el SDK reenviara lo que va detrás, y un incremento
 * reenviado se sumaría dos veces.
 */
import { db, doc, collection, query, where, onSnapshot, getDoc, setDoc, updateDoc, serverTimestamp, increment } from './firebase.js';
import { LUGARES, movimientosDeRecepcion, cuentaDesdeConteo } from './inventario.js';

const coleccion = () => collection(db, 'existencias');
const conDatos = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pendiente: d.metadata.hasPendingWrites });

/** Guarda un ajuste ({ id, datos } de armarAjuste). Devuelve { id, promesa }: sin señal, la promesa se resuelve al enviarse. */
export function guardarAjuste({ id, datos }) {
  const ahora = serverTimestamp();
  const conHora = { ...datos, actualizadoEn: ahora };
  for (const lugar of LUGARES) if (conHora[lugar]) conHora[lugar] = { ...conHora[lugar], contadoEn: ahora };
  return { id, promesa: setDoc(doc(coleccion(), id), conHora, { merge: true }) };
}

const ignorar = () => {};

/**
 * La caja, al cobrar: lo que la venta saca de la tienda (o la devolución
 * regresa), producto por producto (movimientosDeVenta, ya filtrados con
 * cuentaDesdeConteo: productos con existencias en esa tienda y contados antes
 * de la venta). Nunca detiene ni retrasa la venta.
 */
export function registrarSalidaDeVenta({ ventaId, venta, movimientos, usuario }) {
  for (const m of movimientos) {
    updateDoc(doc(coleccion(), `${venta.tienda}__${m.producto}`), {
      vendidoTienda: increment(m.cantidad),
      ultimoMovimiento: { tipo: venta.tipo, ref: ventaId, linea: m.linea, cantidad: m.cantidad, por: usuario, registradoEn: serverTimestamp() },
    }).catch(ignorar);
  }
}

/** Lo que manda un renglón de una entrega (o de su anulación) a la bodega. */
function movimientoDeEntrega({ recepcionId, m, personal, anulacion }) {
  const cantidad = anulacion ? -m.cantidad : m.cantidad;
  const ahora = serverTimestamp();
  return {
    recibidoBodega: increment(cantidad),
    ultimoMovimiento: { tipo: anulacion ? 'anulacion' : 'entrega', ref: recepcionId, linea: m.linea, cantidad, por: personal.usuario, registradoEn: ahora },
    actualizadoEn: ahora,
    actualizadoPor: personal.usuario,
    actualizadoPorNombre: String(personal.nombre || personal.usuario).trim().slice(0, 80),
  };
}

/**
 * Inventario, ya guardada la entrega: lo que llegó entra a la bodega de su
 * tienda, renglón por renglón (crea las existencias del producto si aún no
 * tenía). Sin tienda no suma a ninguna bodega.
 */
export function registrarEntradaDeEntrega({ recepcionId, recepcion, personal }) {
  for (const m of movimientosDeRecepcion(recepcion)) {
    setDoc(doc(coleccion(), `${recepcion.tienda}__${m.producto}`), {
      tienda: recepcion.tienda, producto: m.producto, nombre: String(m.nombre ?? '').slice(0, 120), upc: m.upc, plu: m.plu, porPeso: m.porPeso,
      ...movimientoDeEntrega({ recepcionId, m, personal, anulacion: false }),
    }, { merge: true }).catch(ignorar);
  }
}

/**
 * Inventario, al anular una entrega (admin): se resta de la bodega lo que
 * había sumado, solo donde cuenta (si la bodega se contó después de la
 * entrega, ya está en el conteo y no se toca).
 */
export async function registrarAnulacionDeEntrega({ recepcionId, recepcion, personal }) {
  const cuando = typeof recepcion.fecha?.toMillis === 'function' ? recepcion.fecha.toMillis() : NaN;
  for (const m of movimientosDeRecepcion(recepcion)) {
    const ref = doc(coleccion(), `${recepcion.tienda}__${m.producto}`);
    try {
      const actual = await getDoc(ref);
      if (actual.exists() && cuentaDesdeConteo(actual.data(), 'enBodega', cuando)) {
        updateDoc(ref, movimientoDeEntrega({ recepcionId, m, personal, anulacion: true })).catch(ignorar);
      }
    } catch {
      // sin señal o sin permiso: no se resta nada
    }
  }
}

/** Existencias de una tienda, en vivo. Una sola igualdad: sin índice compuesto. */
export function observarExistencias(tienda, alCambiar, alFallar) {
  return onSnapshot(
    query(coleccion(), where('tienda', '==', tienda)),
    { includeMetadataChanges: true },
    (r) => alCambiar(r.docs.map(conDatos)),
    alFallar,
  );
}
