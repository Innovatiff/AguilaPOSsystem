/**
 * Acceso del personal: inicio y cierre de sesión, comprobación de la ficha
 * en staff/{email} y guardia para las páginas de la app.
 */
import {
  auth,
  db,
  authSecundaria,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
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
  'catalogo/sin-acceso': 'Tu cuenta no está dada de alta como personal activo. Avisa al administrador.',
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
  const instantanea = await getDoc(doc(db, 'staff', String(email).toLowerCase()));
  return instantanea.exists() ? { email: instantanea.id, ...instantanea.data() } : null;
}

/**
 * Inicia sesión y comprueba que el correo esté dado de alta y activo en staff.
 * @returns {Promise<{usuario: import('firebase/auth').User, personal: object}>}
 */
export async function iniciarSesion(email, contrasena) {
  const credencial = await signInWithEmailAndPassword(auth, String(email).trim(), contrasena);
  const personal = await fichaPersonal(credencial.user.email);
  if (!personal || personal.activo !== true) {
    await signOut(auth);
    throw Object.assign(new Error('Sin acceso'), { code: 'catalogo/sin-acceso' });
  }
  return { usuario: credencial.user, personal };
}

export async function cerrarSesion() {
  await signOut(auth);
  window.location.replace('login.html?motivo=sesion-cerrada');
}

export function enviarRestablecimiento(email) {
  return sendPasswordResetEmail(auth, String(email).trim());
}

/**
 * Crea la cuenta de acceso (Firebase Auth) de un empleado sin cerrar la
 * sesión del administrador. Si la cuenta ya existe, no falla.
 * @returns {Promise<'creada'|'existente'>}
 */
export async function crearCuentaAcceso(email, contrasena) {
  const authSec = authSecundaria();
  try {
    await createUserWithEmailAndPassword(authSec, String(email).trim().toLowerCase(), contrasena);
    return 'creada';
  } catch (error) {
    if (error?.code === 'auth/email-already-in-use') return 'existente';
    throw error;
  } finally {
    await signOut(authSec).catch(() => {});
  }
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
    personal = await fichaPersonal(usuario.email);
  } catch {
    return irALogin('sin-conexion');
  }
  if (!personal || personal.activo !== true) {
    await signOut(auth);
    return irALogin('sin-acceso');
  }
  if (soloAdmin && personal.rol !== 'admin') {
    window.location.replace('index.html?aviso=solo-admin');
    return new Promise(() => {});
  }
  return { usuario, personal };
}
