/**
 * Acceso del personal: inicio y cierre de sesión, ficha staff/{usuario} y
 * guardia para las páginas del catálogo y de Gestión.
 *
 * Entra solo el personal registrado por el gerente en Gestión: la cuenta de
 * Firebase Authentication necesita su ficha activa y vigente. El usuario es el
 * código de empleado (cuenta "<código>@<dominio sintético>" con NIP) o el
 * correo real (con contraseña). Ver js/identidad.js.
 */
import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  doc,
  getDoc,
} from './firebase.js';
import { correoDeAcceso, usuarioDe, esCorreoDeCodigo, esCorreo, tipoDeIdentificador, normalizarIdentificador } from './identidad.js';

/** Raíz de la app (la carpeta de index.html), válida desde cualquier subcarpeta (gestion/…). */
export const RAIZ = new URL('../', import.meta.url).pathname;

const MENSAJES = {
  'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Usuario o contraseña incorrectos.',
  'auth/user-not-found': 'Usuario o contraseña incorrectos.',
  'auth/wrong-password': 'Usuario o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión. Revisa la red e inténtalo de nuevo.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña es demasiado corta.',
  'auth/requires-recent-login': 'Por seguridad, cierra sesión, vuelve a entrar y repite la operación.',
  'auth/operation-not-allowed': 'Firebase no permite crear cuentas: activa «Enable create (sign-up)» en Authentication → Settings → User actions.',
  'auth/admin-restricted-operation': 'Firebase no permite crear cuentas: activa «Enable create (sign-up)» en Authentication → Settings → User actions.',
  'catalogo/sin-registro': 'Esta cuenta no está registrada. Pide al gerente que te dé de alta en Gestión.',
  'catalogo/desactivado': 'Tu acceso está desactivado. Habla con el gerente.',
  'catalogo/cuenta-renovada': 'Tu NIP fue restablecido. Entra con el NIP nuevo.',
  'catalogo/sin-version-libre': 'No se pudo crear la cuenta de este código. Usa otro código.',
  'catalogo/identificador': 'Escribe tu código de empleado (solo números) o tu correo.',
  'permission-denied': 'No tienes permiso para hacer esto.',
  'unavailable': 'Sin conexión con la base de datos. Inténtalo de nuevo.',
};

/** Mensaje en español para un error de Firebase (o genérico). */
export function mensajeError(error) {
  const codigo = error?.code ?? '';
  return MENSAJES[codigo] ?? `Error inesperado${codigo ? ` (${codigo})` : ''}.`;
}

const errorCatalogo = (codigo) => Object.assign(new Error(MENSAJES[codigo] ?? codigo), { code: codigo });

/** Usuario de Firebase Auth actual (o null), una vez que Auth terminó de cargar la sesión. */
export function usuarioActual() {
  return new Promise((resolve) => {
    const dejarDeObservar = onAuthStateChanged(auth, (usuario) => {
      dejarDeObservar();
      resolve(usuario);
    });
  });
}

/** Ficha staff/{usuario} tal cual está guardada, o null. Con caché persistente funciona sin conexión. */
export async function fichaDeUsuario(usuario) {
  const instantanea = await getDoc(doc(db, 'staff', String(usuario)));
  return instantanea.exists() ? { id: instantanea.id, ...instantanea.data() } : null;
}

/**
 * Resuelve la ficha efectiva de una cuenta de Auth. Lanza catalogo/sin-registro,
 * catalogo/desactivado o catalogo/cuenta-renovada cuando no debe entrar.
 * @returns {Promise<{usuario: string, email: string, nombre: string, rol: string, tipo: string, tienda: string|null, completa: boolean}>}
 */
export async function fichaEfectiva(usuarioAuth) {
  const correo = String(usuarioAuth.email ?? '').toLowerCase();
  const usuario = usuarioDe(correo);
  const ficha = await fichaDeUsuario(usuario);
  if (!ficha) throw errorCatalogo('catalogo/sin-registro');
  if (ficha.activo !== true) throw errorCatalogo('catalogo/desactivado');
  const correoVigente = String(ficha.correoAuth ?? usuario).toLowerCase();
  if (correoVigente !== correo) throw errorCatalogo('catalogo/cuenta-renovada');
  return {
    usuario,
    email: correo,
    nombre: ficha.nombre || usuario,
    rol: ficha.rol ?? 'empleado',
    tipo: ficha.tipo ?? (esCorreoDeCodigo(correo) ? 'codigo' : 'correo'),
    tienda: ficha.tienda ?? null,
    completa: typeof ficha.correoAuth === 'string',
  };
}

/**
 * Inicia sesión con código de empleado + NIP, o correo + contraseña.
 * @returns {Promise<{usuario: import('firebase/auth').User, personal: object}>}
 */
export async function iniciarSesion(identificador, secreto) {
  const tipo = tipoDeIdentificador(identificador);
  if (!tipo) throw errorCatalogo('catalogo/identificador');
  const version = tipo === 'codigo' ? await versionDeCodigo(normalizarIdentificador(identificador)) : 1;
  const correo = correoDeAcceso(identificador, version);
  const credencial = await signInWithEmailAndPassword(auth, correo, secreto);
  try {
    const personal = await fichaEfectiva(credencial.user);
    return { usuario: credencial.user, personal };
  } catch (error) {
    if (String(error?.code ?? '').startsWith('catalogo/')) await signOut(auth);
    throw error;
  }
}

/**
 * Versión de cuenta vigente de un código (accesos/{código}, lectura pública):
 * tras restablecer un NIP el código apunta a "<código>.<versión>@…". Sin dato
 * o sin conexión se asume la 1.
 */
async function versionDeCodigo(codigo) {
  try {
    const acceso = await getDoc(doc(db, 'accesos', codigo));
    const version = acceso.exists() ? Number(acceso.data().version) : 1;
    return Number.isInteger(version) && version >= 1 ? version : 1;
  } catch {
    return 1;
  }
}

/** Cierra la sesión sin salir de la página (para casos de acceso denegado). */
export function cerrarSesionSilenciosa() {
  return signOut(auth);
}

export async function cerrarSesion() {
  await signOut(auth);
  window.location.replace(`${RAIZ}login.html?motivo=sesion-cerrada`);
}

/** Solo para cuentas por correo real: las de código no reciben correo (el gerente restablece el NIP). */
export function enviarRestablecimiento(correo) {
  const limpio = String(correo ?? '').trim().toLowerCase();
  if (!esCorreo(limpio)) return Promise.reject(errorCatalogo('catalogo/identificador'));
  return sendPasswordResetEmail(auth, limpio);
}

/** Solo se permite volver a páginas de esta misma app (raíz o gestion/). */
export function destinoSeguro(valor, porDefecto = 'index.html') {
  const texto = String(valor ?? '');
  return /^(gestion\/)?[a-z0-9-]+\.html(\?[^#/\\]*)?$/.test(texto) ? texto : porDefecto;
}

/** Página actual relativa a la raíz de la app: "productos.html", "gestion/empleados.html?x=1". */
export function paginaActual() {
  const ruta = window.location.pathname;
  let relativa = ruta.startsWith(RAIZ) ? ruta.slice(RAIZ.length) : ruta.replace(/^\/+/, '');
  if (relativa === '' || relativa.endsWith('/')) relativa += 'index.html';
  return relativa + window.location.search;
}

function irALogin(motivo) {
  const volver = encodeURIComponent(paginaActual());
  window.location.replace(`${RAIZ}login.html?volver=${volver}${motivo ? `&motivo=${motivo}` : ''}`);
  return new Promise(() => {}); // la página se abandona; nunca se resuelve
}

/**
 * Guardia de página: exige sesión de personal registrado y activo (y rol admin
 * si se pide). Redirige a login.html cuando no se cumple.
 */
export async function requerirPersonal({ soloAdmin = false } = {}) {
  const usuario = await usuarioActual();
  if (!usuario) return irALogin();

  let personal;
  try {
    personal = await fichaEfectiva(usuario);
  } catch (error) {
    const codigo = String(error?.code ?? '');
    if (codigo.startsWith('catalogo/')) {
      await signOut(auth);
      return irALogin(codigo.slice('catalogo/'.length));
    }
    return irALogin('sin-conexion');
  }
  if (soloAdmin && personal.rol !== 'admin') {
    window.location.replace(`${RAIZ}index.html?aviso=solo-admin`);
    return new Promise(() => {});
  }
  return { usuario, personal };
}
