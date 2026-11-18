/**
 * Productos empacados en la tienda en Firestore: el producto (products/{id},
 * el de siempre) y empacados/{id} (si es picante y de dónde viene). Lo que se
 * captura lo arma js/empaque.js; aquí se guarda y se observa.
 *
 * Se crean juntos, en un lote: las reglas solo dejan crear empacados/{id} con
 * su producto, y al personal del Catálogo solo le dejan crear productos así
 * (con un código propio que empieza por 4). Por eso un producto que no nació
 * empacado nunca puede volverse uno, y solo en estos el personal del Catálogo
 * puede cambiar el precio (con su entrada de priceHistory, como el admin).
 */
import { db, doc, collection, onSnapshot, writeBatch, serverTimestamp } from './firebase.js';
import { armarProducto } from './esquema.js';
import { ahora, prepararParche } from './productos.js';

const coleccion = () => collection(db, 'empacados');

/** empacados/ en vivo: Map id de producto → { picante, procedencia, … }. */
export function observarEmpacados(alCambiar, alFallar) {
  return onSnapshot(coleccion(), { includeMetadataChanges: true }, (r) => {
    alCambiar(new Map(r.docs.map((d) => [d.id, { id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pendiente: d.metadata.hasPendingWrites }])));
  }, alFallar);
}

/**
 * Crea el producto (con su código nuevo) y su empacados/{id} en un lote.
 * Devuelve { id, producto, promesa }: sin señal queda en cola.
 */
export function crearEmpacado({ producto, empacado, upc }, usuario) {
  const marca = ahora();
  const referencia = doc(collection(db, 'products'));
  const datos = { ...armarProducto({ ...producto, upc }, usuario), creadoEn: marca, actualizadoEn: marca };
  const lote = writeBatch(db);
  lote.set(referencia, datos);
  lote.set(doc(coleccion(), referencia.id), {
    ...empacado,
    creadoEn: serverTimestamp(),
    creadoPor: datos.actualizadoPor,
    actualizadoEn: serverTimestamp(),
    actualizadoPor: datos.actualizadoPor,
  });
  return { id: referencia.id, producto: { id: referencia.id, ...datos }, promesa: lote.commit() };
}

/**
 * Guarda lo que cambió de un producto empacado (cambiosEmpacado): el parche
 * del producto (y su historial si cambió el precio) y empacados/{id}.
 */
export function actualizarEmpacado({ actual, cambiosProducto, empacado }, usuario) {
  const lote = writeBatch(db);
  if (Object.keys(cambiosProducto).length > 0) {
    const { parche, historial } = prepararParche(actual, cambiosProducto, usuario, ahora());
    lote.update(doc(db, 'products', actual.id), parche);
    if (historial) lote.set(doc(db, 'priceHistory', historial.id), historial.datos);
  }
  if (empacado) {
    lote.update(doc(coleccion(), actual.id), {
      ...empacado,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: String(usuario).toLowerCase(),
    });
  }
  return { promesa: lote.commit() };
}
