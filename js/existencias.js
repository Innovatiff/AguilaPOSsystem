/**
 * Existencias en Firestore (existencias/{tienda}__{producto}): el último
 * conteo de cada producto en la tienda y en la bodega, con la caducidad y el
 * país de procedencia (Inventario → Ajuste rápido). El ajuste lo arma
 * js/inventario.js (armarAjuste); aquí se guarda y se observa.
 *
 * Se guarda con merge: el lugar que no se contó se queda como estaba (dos
 * personas pueden contar la tienda y la bodega a la vez). Sin señal, la
 * escritura queda en cola y se envía al volver. Las reglas (sección
 * "existencias") exigen la hora del servidor y que quien cuenta sea quien dice.
 */
import { db, doc, collection, query, where, onSnapshot, setDoc, serverTimestamp } from './firebase.js';
import { LUGARES } from './inventario.js';

const coleccion = () => collection(db, 'existencias');
const conDatos = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pendiente: d.metadata.hasPendingWrites });

/** Guarda un ajuste ({ id, datos } de armarAjuste). Devuelve { id, promesa }: sin señal, la promesa se resuelve al enviarse. */
export function guardarAjuste({ id, datos }) {
  const ahora = serverTimestamp();
  const conHora = { ...datos, actualizadoEn: ahora };
  for (const lugar of LUGARES) if (conHora[lugar]) conHora[lugar] = { ...conHora[lugar], contadoEn: ahora };
  return { id, promesa: setDoc(doc(coleccion(), id), conHora, { merge: true }) };
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
