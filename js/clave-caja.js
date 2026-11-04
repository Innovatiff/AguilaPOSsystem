/**
 * Clave de caja (secretos/caja): la llave con la que se calcula la huella de
 * cada NIP (js/nip.js). Solo la leen los administradores; se crea sola la
 * primera vez que un administrador la necesita (registrar un NIP o configurar
 * una caja) y nunca cambia: si cambiara, todos los NIP dejarían de servir en
 * las cajas hasta volver a registrarlos.
 */
import { db, doc, getDoc, runTransaction, serverTimestamp } from './firebase.js';
import { generarClaveCaja, claveCajaValida } from './nip.js';

const referencia = () => doc(db, 'secretos', 'caja');

/**
 * Devuelve la clave de caja; si todavía no existe, la crea (solo un
 * administrador puede). Dos administradores a la vez no crean dos claves:
 * la transacción solo escribe si nadie la escribió antes.
 * @param {string} usuario quien la crea (queda en creadaPor)
 */
export async function obtenerClaveCaja(usuario) {
  const actual = await getDoc(referencia());
  if (actual.exists() && claveCajaValida(actual.data().clave)) return actual.data().clave;
  let clave = generarClaveCaja();
  await runTransaction(db, async (transaccion) => {
    const existente = await transaccion.get(referencia());
    if (existente.exists()) {
      clave = existente.data().clave;
      return;
    }
    transaccion.set(referencia(), { clave, creadaEn: serverTimestamp(), creadaPor: usuario });
  });
  if (!claveCajaValida(clave)) throw Object.assign(new Error('La clave de caja guardada está dañada.'), { code: 'caja/clave-danada' });
  return clave;
}
