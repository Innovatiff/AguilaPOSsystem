/**
 * Pantalla del cliente en una tableta: el estado viaja por Firestore, en
 * pantallas/{huella} (la huella sale de js/nip.js, huellaPantalla). La caja
 * lo actualiza mientras exista el documento; un administrador lo crea al
 * emparejar una tableta y lo borra al desconectarla. La tableta lo lee sin
 * sesión. Las reglas están en firestore.rules (sección "pantallas").
 */
import { db, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from './firebase.js';

const referencia = (id) => doc(db, 'pantallas', id);

/** ¿Hay una tableta emparejada con esa pantalla? */
export async function hayTableta(id) {
  return (await getDoc(referencia(id))).exists();
}

/**
 * La caja manda lo que debe ver el cliente. Solo actualiza: si un
 * administrador desconectó la tableta (borró el documento), falla con
 * not-found y la caja deja de mandar.
 */
export function actualizarPantalla(id, { caja, cajero, estado }) {
  return updateDoc(referencia(id), { caja, cajero, estado, actualizadoEn: serverTimestamp() });
}

/** Un administrador empareja una tableta: crea el documento (si ya existía, lo deja como está). */
export async function crearPantalla(id, { caja, cajero, estado }) {
  if ((await getDoc(referencia(id))).exists()) return;
  await setDoc(referencia(id), { caja, cajero, estado, actualizadoEn: serverTimestamp() });
}

/** Un administrador desconecta la tableta de una caja: la caja deja de mandar. */
export function borrarPantalla(id) {
  return deleteDoc(referencia(id));
}

/** La tableta escucha su pantalla: `alCambiar(datos | null)` (null: ya no está emparejada). */
export function observarPantalla(id, alCambiar, alFallar) {
  return onSnapshot(referencia(id), (d) => {
    if (!d.exists()) {
      alCambiar(null);
      return;
    }
    const datos = d.data({ serverTimestamps: 'estimate' });
    alCambiar({ ...datos, actualizadoMs: typeof datos.actualizadoEn?.toMillis === 'function' ? datos.actualizadoEn.toMillis() : null });
  }, alFallar);
}
