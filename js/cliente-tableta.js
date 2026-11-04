/**
 * Pantalla del cliente en una tableta: emparejarla y escucharla.
 * js/cliente.js lo carga solo en la tableta (en la segunda pantalla de la caja
 * no hace falta Firebase).
 *
 * Emparejar: un administrador entra en la tableta (correo o número + NIP o
 * contraseña), elige la caja, y la tableta guarda el id de su pantalla
 * (pantallas/{huella}: HMAC de la caja con la clave de caja, js/nip.js) —
 * nunca la clave— y cierra la sesión del administrador. Desde entonces lee
 * ese documento sin sesión (las reglas lo permiten solo por su id).
 */
import { auth, db, doc, getDoc, signOut } from './firebase.js';
import { iniciarSesion, mensajeError } from './auth.js';
import { listarCajas, leerTienda } from './pos-datos.js';
import { huellaPantalla, claveCajaValida } from './nip.js';
import { crearPantalla, borrarPantalla, hayTableta, observarPantalla } from './pantalla-remota.js';
import { estadoCliente } from './pantalla-cliente.js';
import { configConDefectos } from './config-pos.js';

const aviso = (texto) => Object.assign(new Error(texto), { code: 'cliente/aviso' });

/** Mensaje para el administrador (en español) de cualquier error. */
export const mensajeDe = (error) => (error?.code === 'cliente/aviso' ? error.message : mensajeError(error));

/** La tableta trabaja sin sesión: se cierra la que hubiera quedado (p. ej. si se cerró la página a media configuración). */
export async function sinSesion() {
  await signOut(auth).catch(() => {});
}

/**
 * Un administrador entra. Devuelve las cajas activas, cada una con el id de su
 * pantalla y si ya tiene una tableta emparejada. La sesión sigue abierta
 * hasta emparejar() o sinSesion().
 */
export async function entrarAdmin(identificador, secreto) {
  const { personal } = await iniciarSesion(identificador, secreto);
  try {
    if (personal.rol !== 'admin') throw aviso('Solo un administrador puede emparejar la tableta.');
    const secretoCaja = await getDoc(doc(db, 'secretos', 'caja'));
    const clave = secretoCaja.exists() ? secretoCaja.data().clave : null;
    if (!claveCajaValida(clave)) throw aviso('Todavía no hay cajas configuradas: primero un administrador asigna la computadora de la caja.');
    const cajas = (await listarCajas()).filter((c) => c.activo);
    if (cajas.length === 0) throw aviso('No hay cajas activas. Da de alta las cajas en el back office (Cajas).');
    const tiendas = new Map();
    const lista = [];
    for (const c of cajas) {
      if (!tiendas.has(c.tienda)) tiendas.set(c.tienda, (await leerTienda(c.tienda).catch(() => null))?.nombre ?? c.tienda);
      const pantalla = await huellaPantalla(clave, c.id);
      lista.push({ id: c.id, nombre: c.nombre, tienda: tiendas.get(c.tienda), pantalla, conectada: await hayTableta(pantalla) });
    }
    return { personal, cajas: lista };
  } catch (error) {
    await sinSesion();
    throw error;
  }
}

/**
 * Empareja esta tableta con la caja: crea su pantalla si no existía (con la
 * bienvenida, hasta que la caja mande su ticket) y cierra la sesión.
 * @returns {{ caja: string, cajaNombre: string, tienda: string, pantalla: string }} lo que guarda la tableta
 */
export async function emparejar(caja, personal) {
  try {
    await crearPantalla(caja.pantalla, {
      caja: caja.id,
      cajero: personal.usuario,
      estado: estadoCliente({ fase: 'libre', tienda: caja.tienda, caja: caja.nombre, config: configConDefectos(null) }),
    });
    return { caja: caja.id, cajaNombre: caja.nombre, tienda: caja.tienda, pantalla: caja.pantalla };
  } finally {
    await sinSesion();
  }
}

/** Desconecta la tableta de una caja (borra su pantalla): la caja deja de mandar. Sigue la sesión del administrador. */
export function desconectar(caja) {
  return borrarPantalla(caja.pantalla);
}

export { observarPantalla };
