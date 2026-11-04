/**
 * Entregas de mercancía en Firestore (recepciones/{id}). El documento lo arma
 * js/inventario.js; aquí solo se guarda, se observa y se anula. Las reglas
 * (sección "recepciones") exigen la fecha del servidor, que quien la registra
 * sea quien dice ser, y que solo un administrador la anule.
 */
import {
  db, doc, collection, query, where, orderBy, onSnapshot, setDoc, updateDoc, serverTimestamp, Timestamp,
} from './firebase.js';

const coleccion = () => collection(db, 'recepciones');
const conDatos = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pendiente: d.metadata.hasPendingWrites });

/**
 * Guarda una entrega (armada con armarRecepcion). Devuelve { id, promesa }:
 * sin señal la escritura queda en cola y la promesa se resuelve al enviarse.
 */
export function registrarRecepcion(datos) {
  const ref = doc(coleccion());
  return { id: ref.id, promesa: setDoc(ref, { ...datos, fecha: serverTimestamp() }) };
}

/**
 * Entregas registradas entre dos instantes (Date; `hasta` excluido), las más
 * recientes primero, en vivo. Un solo rango sobre `fecha`: sin índice compuesto.
 */
export function observarRecepciones({ desde, hasta }, alCambiar, alFallar) {
  return onSnapshot(
    query(coleccion(), where('fecha', '>=', Timestamp.fromDate(desde)), where('fecha', '<', Timestamp.fromDate(hasta)), orderBy('fecha', 'desc')),
    { includeMetadataChanges: true },
    (r) => alCambiar(r.docs.map(conDatos)),
    alFallar,
  );
}

/** Anula una entrega (solo administradores): sigue a la vista, tachada, y deja de contar. */
export function anularRecepcion(id, usuario) {
  return updateDoc(doc(coleccion(), id), { anulada: true, anuladaPor: usuario, anuladaEn: serverTimestamp() });
}
