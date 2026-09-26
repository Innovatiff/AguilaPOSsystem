/**
 * Identidad del personal: cómo un código de empleado se convierte en la
 * cuenta de Firebase Authentication que hay detrás, y al revés.
 *
 * - Cuentas por CÓDIGO (empleados): las crea el gerente desde Gestión.
 *   Firebase Auth solo conoce correos, así que cada código se guarda como un
 *   correo sintético que no recibe nada: "<código>@<DOMINIO_CODIGOS>". El
 *   secreto es un NIP numérico (la contraseña de esa cuenta).
 * - Cuentas por CORREO (gerentes, o quien lo prefiera): correo real y contraseña.
 *
 * El "usuario" de una persona es su identificador estable: el código, o el
 * correo real en minúsculas. Es lo que queda en actualizadoPor y en el
 * historial de precios. Al restablecer un NIP se crea una cuenta nueva (sube
 * la versión: "100123.2@…") pero el usuario sigue siendo "100123".
 *
 * Módulo puro (sin Firebase ni DOM): se prueba en Node y lo reflejan las
 * reglas de Firestore (función usuarioActual()).
 */

/** Dominio de los correos sintéticos. Subdominio del proyecto: nadie más lo posee. */
export const DOMINIO_CODIGOS = 'codigo.aguilapos.firebaseapp.com';

export const REGEX_CODIGO = /^[0-9]{6}$/;
export const REGEX_NIP = /^[0-9]{6,10}$/;
export const REGEX_CORREO = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export const LONGITUD_MINIMA_CONTRASENA = 8;
export const TIPOS_ACCESO = Object.freeze(['codigo', 'correo']);

/** Campos de staff/{usuario}, en el orden del esquema. Ni uno más. */
export const CAMPOS_PERSONAL = Object.freeze([
  'usuario', 'tipo', 'correoAuth', 'nombre', 'rol', 'activo', 'tienda',
  'creadoEn', 'actualizadoEn', 'actualizadoPor', 'cuentaVersion',
]);

/** Limpia lo que teclea alguien para entrar: código (solo dígitos) o correo en minúsculas. */
export function normalizarIdentificador(texto) {
  const limpio = String(texto ?? '').trim();
  if (limpio.includes('@')) return limpio.toLowerCase();
  return limpio.replace(/\s+/g, '');
}

export function esCodigo(texto) {
  return REGEX_CODIGO.test(normalizarIdentificador(texto));
}

export function esCorreo(texto) {
  const id = normalizarIdentificador(texto);
  return REGEX_CORREO.test(id) && !esCorreoDeCodigo(id);
}

/** 'codigo', 'correo' o null si no se reconoce. */
export function tipoDeIdentificador(texto) {
  if (esCodigo(texto)) return 'codigo';
  if (esCorreo(texto)) return 'correo';
  return null;
}

/** ¿Es un correo sintético de los que representan un código? */
export function esCorreoDeCodigo(correoAuth) {
  const correo = String(correoAuth ?? '').trim().toLowerCase();
  const arroba = correo.indexOf('@');
  return arroba > 0 && correo.slice(arroba + 1) === DOMINIO_CODIGOS;
}

/**
 * Correo de Firebase Auth para un usuario (código o correo) y versión de cuenta.
 * La versión 1 no lleva sufijo; a partir de la 2 el código va seguido de ".<versión>".
 */
export function correoDeAcceso(identificador, version = 1) {
  const id = normalizarIdentificador(identificador);
  if (esCodigo(id)) {
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1) throw new Error('Versión de cuenta inválida.');
    return `${id}${v > 1 ? `.${v}` : ''}@${DOMINIO_CODIGOS}`;
  }
  if (esCorreo(id)) return id;
  throw new Error('Escribe tu código de empleado (solo números) o tu correo.');
}

/** Usuario estable a partir del correo de Auth: código (sin versión) o correo en minúsculas. */
export function usuarioDe(correoAuth) {
  const correo = String(correoAuth ?? '').trim().toLowerCase();
  if (!esCorreoDeCodigo(correo)) return correo;
  return correo.slice(0, correo.indexOf('@')).split('.')[0];
}

/** Versión de cuenta que codifica un correo sintético (1 si no lleva sufijo o no es sintético). */
export function versionDe(correoAuth) {
  const correo = String(correoAuth ?? '').trim().toLowerCase();
  if (!esCorreoDeCodigo(correo)) return 1;
  const partes = correo.slice(0, correo.indexOf('@')).split('.');
  const v = Number(partes[1] ?? '1');
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

// ------------------------------------------------------------- validación
export function validarCodigo(codigo) {
  const id = normalizarIdentificador(codigo);
  if (id === '') return 'Escribe el código de empleado.';
  if (!REGEX_CODIGO.test(id)) return 'El código de empleado son 6 dígitos.';
  return null;
}

const SECUENCIAS = new Set(['0123456789', '9876543210']);

/** NIP: de 6 a 10 dígitos, ni todos iguales ni una secuencia (123456, 654321…). */
export function validarNIP(nip) {
  const texto = String(nip ?? '').trim();
  if (texto === '') return 'Escribe el NIP.';
  if (!REGEX_NIP.test(texto)) return 'El NIP son de 6 a 10 dígitos, solo números.';
  if (/^(\d)\1+$/.test(texto)) return 'El NIP no puede ser el mismo dígito repetido.';
  for (const secuencia of SECUENCIAS) {
    if (secuencia.includes(texto)) return 'El NIP no puede ser una secuencia como 123456.';
  }
  return null;
}

export function validarContrasena(texto) {
  const contrasena = String(texto ?? '');
  if (contrasena === '') return 'Escribe la contraseña.';
  if (contrasena.length < LONGITUD_MINIMA_CONTRASENA) return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`;
  return null;
}

/** Siguiente código libre: el mayor + 1, siempre de 6 dígitos; 100001 si no hay ninguno. */
export function siguienteCodigo(codigosExistentes) {
  let mayor = 100000;
  for (const codigo of codigosExistentes ?? []) {
    const texto = String(codigo);
    if (REGEX_CODIGO.test(texto)) mayor = Math.max(mayor, Number(texto));
  }
  const siguiente = String(mayor + 1).padStart(6, '0');
  return REGEX_CODIGO.test(siguiente) ? siguiente : '';
}

/** Texto para mostrar a una persona: "Nombre (100123)" o "Nombre (correo)"; si no hay nombre, el usuario. */
export function etiquetaUsuario(usuario, nombre) {
  const id = String(usuario ?? '');
  const limpio = String(nombre ?? '').trim();
  return limpio && limpio.toLowerCase() !== id ? `${limpio} (${id})` : id;
}

/**
 * Construye la ficha completa de staff/{usuario}, sin marcas de tiempo (las
 * pone la capa de escritura). Refleja lo que exigen las reglas.
 */
export function armarFichaPersonal(datos, actualizadoPor) {
  const usuario = normalizarIdentificador(datos.usuario);
  const tipo = datos.tipo ?? tipoDeIdentificador(usuario);
  const cuentaVersion = Number(datos.cuentaVersion ?? 1);
  const correoAuth = datos.correoAuth ?? (tipo === 'codigo' ? correoDeAcceso(usuario, cuentaVersion) : usuario);
  const tienda = String(datos.tienda ?? '').trim();
  return {
    usuario,
    tipo,
    correoAuth: String(correoAuth).toLowerCase(),
    nombre: String(datos.nombre ?? '').trim(),
    rol: datos.rol,
    activo: datos.activo ?? true,
    tienda: tienda === '' ? null : tienda,
    actualizadoPor,
    cuentaVersion,
  };
}

/** Errores (en español) de una ficha; vacío si es válida. Mismo criterio que las reglas. */
export function validarFichaPersonal(f) {
  const errores = [];
  if (!TIPOS_ACCESO.includes(f.tipo)) errores.push('El tipo de acceso debe ser "codigo" o "correo".');
  if (f.tipo === 'codigo') {
    const error = validarCodigo(f.usuario);
    if (error) errores.push(error);
    else if (f.correoAuth !== correoDeAcceso(f.usuario, f.cuentaVersion)) errores.push('El correo de la cuenta no corresponde al código y su versión.');
  } else if (f.tipo === 'correo') {
    if (!esCorreo(f.usuario)) errores.push('El correo no es válido.');
    else if (f.correoAuth !== f.usuario) errores.push('El correo de la cuenta debe ser el mismo correo.');
    if (f.cuentaVersion !== 1) errores.push('Las cuentas por correo no llevan versión.');
  }
  if (typeof f.nombre !== 'string' || f.nombre.trim() === '' || f.nombre.length > 80) errores.push('El nombre es obligatorio (máximo 80 caracteres).');
  if (!['admin', 'empleado'].includes(f.rol)) errores.push('El rol debe ser admin o empleado.');
  if (typeof f.activo !== 'boolean') errores.push('activo debe ser verdadero o falso.');
  if (f.tienda !== null && !/^[a-z0-9-]{2,40}$/.test(String(f.tienda))) errores.push('La tienda no es válida.');
  if (!Number.isInteger(f.cuentaVersion) || f.cuentaVersion < 1) errores.push('La versión de cuenta debe ser un entero mayor o igual a 1.');
  if (typeof f.actualizadoPor !== 'string' || f.actualizadoPor === '') errores.push('Falta quién actualiza la ficha.');
  return errores;
}
