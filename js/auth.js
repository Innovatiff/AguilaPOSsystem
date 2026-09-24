/**
 * Acceso del personal: inicio y cierre de sesión, ficha en staff/{email} y
 * guardia para las páginas de la app.
 *
 * Toda cuenta de Firebase Authentication entra como empleado. La ficha en
 * staff/{email} es opcional: aporta nombre, el rol admin, o corta el acceso
 * con activo == false. Las cuentas se crean en la consola de Firebase.
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

const MENSAJES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.',
  'auth/network-request-failed': 'Sin conexión. Revisa la red e inténtalo de nuevo.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 8 caracteres.',
  'catalogo/desactivado': 'Tu acceso está desactivado. Avisa al administrador.',
  'permission-denied': 'No tienes permiso para hacer esto.',
  'unavailable': 'Sin conexión con la base de datos. Inténtalo de nuevo.',
};

/** Mensaje en español para un error de Firebase (o genérico). */
export function mensajeError(error) {
  const codigo = error?.code ?? '';
  return MENSAJES[codigo] ?? `Error inesperado${codigo ? ` (${codigo})` : ''}.`;
}

/** Usuario de Firebase Auth actual (o null), una vez que Auth terminó de cargar la sesión. */
export function usuarioActual() {
  return new Promise((resolve) => {
    const dejarDeObservar = onAuthStateChanged(auth, (usuario) => {
      dejarDeObservar();
      resolve(usuario);
    });
  });
}

/** Ficha de staff/{email} o null si no existe. Con caché persistente funciona sin conexión. */
export async function fichaPersonal(email) {
  const correo = String(email).toLowerCase();
  const instantanea = await getDoc(doc(db, 'staff', correo));
  return instantanea.exists() ? { email: correo, ...instantanea.data(), sinFicha: false } : null;
}

/** Ficha implícita de una cuenta sin documento en staff: empleado. */
function fichaPorDefecto(usuario) {
  const correo = String(usuario.email).toLowerCase();
  return { email: correo, nombre: usuario.displayName || correo, rol: 'empleado', activo: true, sinFicha: true };
}

/**
 * Resuelve la ficha efectiva de una cuenta. Lanza catalogo/desactivado si
 * su ficha existe con activo == false.
 */
async function fichaEfectiva(usuario) {
  const ficha = await fichaPersonal(usuario.email);
  if (ficha && ficha.activo !== true) {
    throw Object.assign(new Error('Acceso desactivado'), { code: 'catalogo/desactivado' });
  }
  return ficha ?? fichaPorDefecto(usuario);
}

/**
 * Inicia sesión. Cualquier cuenta de Authentication entra, salvo que su
 * ficha de personal esté desactivada.
 * @returns {Promise<{usuario: import('firebase/auth').User, personal: object}>}
 */
export async function iniciarSesion(email, contrasena) {
  const credencial = await signInWithEmailAndPassword(auth, String(email).trim(), contrasena);
  try {
    const personal = await fichaEfectiva(credencial.user);
    return { usuario: credencial.user, personal };
  } catch (error) {
    if (error?.code === 'catalogo/desactivado') await signOut(auth);
    throw error;
  }
}

export async function cerrarSesion() {
  await signOut(auth);
  window.location.replace('login.html?motivo=sesion-cerrada');
}

export function enviarRestablecimiento(email) {
  return sendPasswordResetEmail(auth, String(email).trim());
}

/** Solo se permite volver a páginas de esta misma app. */
export function destinoSeguro(valor, porDefecto = 'index.html') {
  const texto = String(valor ?? '');
  return /^[a-z0-9-]+\.html(\?[^#/\\]*)?$/.test(texto) ? texto : porDefecto;
}

function irALogin(motivo) {
  const pagina = window.location.pathname.split('/').pop() || 'index.html';
  const volver = encodeURIComponent(pagina + window.location.search);
  window.location.replace(`login.html?volver=${volver}${motivo ? `&motivo=${motivo}` : ''}`);
  return new Promise(() => {}); // la página se abandona; nunca se resuelve
}

/**
 * Guardia de página: exige sesión de personal activo (y rol admin si se pide).
 * Redirige a login.html cuando no se cumple.
 */
export async function requerirPersonal({ soloAdmin = false } = {}) {
  const usuario = await usuarioActual();
  if (!usuario) return irALogin();

  let personal;
  try {
    personal = await fichaEfectiva(usuario);
  } catch (error) {
    if (error?.code === 'catalogo/desactivado') {
      await signOut(auth);
      return irALogin('desactivado');
    }
    return irALogin('sin-conexion');
  }
  if (soloAdmin && personal.rol !== 'admin') {
    window.location.replace('index.html?aviso=solo-admin');
    return new Promise(() => {});
  }
  return { usuario, personal };
}
