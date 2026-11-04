/**
 * Acceso del personal: inicio y cierre de sesión, ficha staff/{usuario} y
 * guardias de página: back office (solo administradores) y app Catálogo
 * (administradores y el personal con permiso de catálogo).
 *
 * Entra solo el personal registrado en el back office (Empleados): la cuenta de
 * Firebase Authentication necesita su ficha activa y vigente. Cada colaborador
 * entra con su correo y su NIP (6 dígitos): correos/{correo} dice qué código
 * interno tiene, y detrás está la cuenta "<código>@<dominio sintético>". En una
 * caja configurada basta el NIP (nips/{huella}, ver js/nip.js). Las cuentas por
 * correo real entran con correo y contraseña. Ver js/identidad.js.
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
import { correoDeAcceso, usuarioDe, esCorreoDeCodigo, esCorreo, esNIP, tipoDeIdentificador, normalizarIdentificador } from './identidad.js';
import { huellaNip } from './nip.js';

/** Raíz de la app (la carpeta de index.html), válida desde cualquier subcarpeta (gestion/…). */
export const RAIZ = new URL('../', import.meta.url).pathname;

/**
 * ¿La página es de la app Catálogo (/catalogo/)? Las pantallas de productos,
 * captura y etiquetas son las mismas en el back office y en el Catálogo: la
 * guardia, la navegación y la página de entrada cambian según la app.
 */
export const EN_CATALOGO = typeof location !== 'undefined' && /\/catalogo\//.test(location.pathname);
const PAGINA_ENTRADA = EN_CATALOGO ? 'catalogo/entrar.html' : 'login.html';

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
  'catalogo/sin-registro': 'Esta cuenta no está registrada. Pide a un administrador que te dé de alta en el back office (Empleados).',
  'catalogo/desactivado': 'Tu acceso está desactivado. Habla con el gerente.',
  'catalogo/cuenta-renovada': 'Tu NIP fue restablecido. Entra con el NIP nuevo.',
  'catalogo/sin-version-libre': 'No se pudo crear la cuenta de este código. Usa otro código.',
  'catalogo/identificador': 'Escribe tu correo.',
  'catalogo/sin-permiso-catalogo': 'No tienes permiso para usar el Catálogo. Pide a un administrador que te lo active en Empleados.',
  'caja/nip-incorrecto': 'NIP incorrecto.',
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
  const tipo = ficha.tipo ?? (esCorreoDeCodigo(correo) ? 'codigo' : 'correo');
  return {
    usuario,
    email: correo,
    nombre: ficha.nombre || usuario,
    rol: ficha.rol ?? 'empleado',
    tipo,
    tienda: ficha.tienda ?? null,
    completa: typeof ficha.correoAuth === 'string',
    correo: ficha.correo ?? (tipo === 'correo' ? usuario : null),
    catalogo: ficha.catalogo === true,
  };
}

/** ¿Puede usar la app Catálogo? Los administradores siempre; el resto, con permiso. */
export function puedeUsarCatalogo(personal) {
  return personal?.rol === 'admin' || personal?.catalogo === true;
}

/**
 * Inicia sesión con correo + NIP (colaboradores), correo + contraseña (cuentas
 * por correo real) o, por compatibilidad, código de empleado + NIP.
 * Con correo y un secreto de 6 dígitos se busca primero el código del
 * colaborador (correos/{correo}); si el correo no es de un colaborador, es
 * una cuenta por correo real. Las contraseñas tienen al menos 8 caracteres:
 * un NIP nunca se confunde con una.
 * @returns {Promise<{usuario: import('firebase/auth').User, personal: object}>}
 */
export async function iniciarSesion(identificador, secreto) {
  const id = normalizarIdentificador(identificador);
  const tipo = tipoDeIdentificador(id);
  if (!tipo) throw errorCatalogo('catalogo/identificador');
  let correo = id;
  if (tipo === 'codigo') {
    correo = correoDeAcceso(id, await versionDeCodigo(id));
  } else if (esNIP(secreto)) {
    const codigo = await codigoDeCorreo(id);
    if (codigo) correo = correoDeAcceso(codigo, await versionDeCodigo(codigo));
  }
  return entrarCon(correo, String(secreto).trim());
}

/**
 * Caja registradora: entra solo con el NIP. La huella del NIP con la clave de
 * la caja localiza el código y la versión de cuenta (nips/{huella}); después
 * se entra a esa cuenta con el NIP como contraseña. Un NIP que no está en el
 * índice da el mismo error que uno equivocado.
 */
export async function iniciarSesionConNip(nip, claveCaja) {
  const texto = String(nip ?? '').trim();
  return entrarCon(await correoDeNip(texto, claveCaja), texto);
}

/** Correo de la cuenta de Auth de quien tiene ese NIP (nips/{huella}). Lanza caja/nip-incorrecto si no hay nadie. */
export async function correoDeNip(nip, claveCaja) {
  const texto = String(nip ?? '').trim();
  if (!esNIP(texto)) throw errorCatalogo('caja/nip-incorrecto');
  const registro = await getDoc(doc(db, 'nips', await huellaNip(claveCaja, texto)));
  const datos = registro.exists() ? registro.data() : null;
  if (!datos || typeof datos.codigo !== 'string' || !Number.isInteger(datos.version)) throw errorCatalogo('caja/nip-incorrecto');
  return correoDeAcceso(datos.codigo, datos.version);
}

async function entrarCon(correo, secreto) {
  const credencial = await signInWithEmailAndPassword(auth, correo, secreto);
  try {
    const personal = await fichaEfectiva(credencial.user);
    return { usuario: credencial.user, personal };
  } catch (error) {
    if (String(error?.code ?? '').startsWith('catalogo/')) await signOut(auth);
    throw error;
  }
}

/** Código interno del colaborador con ese correo (correos/{correo}, lectura pública de un documento), o null. */
export async function codigoDeCorreo(correo) {
  try {
    const registro = await getDoc(doc(db, 'correos', String(correo).trim().toLowerCase()));
    const codigo = registro.exists() ? registro.data().codigo : null;
    return typeof codigo === 'string' && /^[0-9]{6}$/.test(codigo) ? codigo : null;
  } catch {
    return null;
  }
}

/**
 * Versión de cuenta vigente de un código (accesos/{código}, lectura pública):
 * tras restablecer un NIP el código apunta a "<código>.<versión>@…". Sin dato
 * o sin conexión se asume la 1.
 */
export async function versionDeCodigo(codigo) {
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
  window.location.replace(`${RAIZ}${PAGINA_ENTRADA}?motivo=sesion-cerrada`);
}

/** Solo para cuentas por correo real: las de código no reciben correo (el gerente restablece el NIP). */
export function enviarRestablecimiento(correo) {
  const limpio = String(correo ?? '').trim().toLowerCase();
  if (!esCorreo(limpio)) return Promise.reject(errorCatalogo('catalogo/identificador'));
  return sendPasswordResetEmail(auth, limpio);
}

/** Solo se permite volver a páginas de la misma app: back office (raíz o gestion/) o Catálogo (catalogo/). */
export function destinoSeguro(valor, porDefecto = EN_CATALOGO ? 'catalogo/index.html' : 'index.html') {
  const texto = String(valor ?? '');
  const patron = EN_CATALOGO ? /^catalogo\/[a-z0-9-]+\.html(\?[^#/\\]*)?$/ : /^(gestion\/)?[a-z0-9-]+\.html(\?[^#/\\]*)?$/;
  return patron.test(texto) ? texto : porDefecto;
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
  window.location.replace(`${RAIZ}${PAGINA_ENTRADA}?volver=${volver}${motivo ? `&motivo=${motivo}` : ''}`);
  return new Promise(() => {}); // la página se abandona; nunca se resuelve
}

/**
 * Guardia de página: exige sesión de personal registrado y activo.
 * - Back office: rol admin (el resto del personal usa la caja, la consulta y,
 *   con permiso, el Catálogo). Sin él, de vuelta a login.html.
 * - App Catálogo (/catalogo/): administradores o personal con permiso de
 *   catálogo (Empleados). Sin él, de vuelta a catalogo/entrar.html.
 */
export async function requerirPersonal({ soloAdmin = true } = {}) {
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
  if (EN_CATALOGO ? !puedeUsarCatalogo(personal) : (soloAdmin && personal.rol !== 'admin')) {
    await signOut(auth);
    return irALogin(EN_CATALOGO ? 'sin-permiso-catalogo' : 'solo-admin');
  }
  return { usuario, personal };
}
