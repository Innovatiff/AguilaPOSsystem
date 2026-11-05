/**
 * Idioma de Águila POS: español (el predeterminado) o inglés, a elección de
 * quien usa cada computadora o tableta (botón «English» / «Español»). Se
 * guarda en este navegador y vale para todas las apps del sitio y para lo que
 * se imprime desde él: recibos, cortes X y Z, comprobantes, reportes y
 * etiquetas. Cambiar de idioma recarga la página.
 *
 * El código está escrito en español: t(«texto en español», { valores }) da
 * ese texto en el idioma elegido. Las traducciones al inglés viven en
 * js/i18n/ con el texto en español como clave; los valores se insertan con
 * {nombre}. Si una misma frase se traduce distinto según dónde va, se le da
 * contexto: tc(«movimiento», «Pago») busca primero «movimiento|Pago».
 * Los datos (productos, tiendas, personas, departamentos, notas) nunca se
 * traducen: se muestran como se escribieron.
 *
 * Módulo sin DOM: funciona en el navegador y en Node (pruebas).
 */
export const IDIOMAS = Object.freeze(['es', 'en']);
export const CLAVE_IDIOMA = 'aguila.idioma';

let fijo = null; // pruebas: idioma fijado en memoria
let diccionario = null; // inglés, cargado solo si hace falta

function guardado() {
  try {
    return globalThis.localStorage?.getItem(CLAVE_IDIOMA) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

/**
 * El idioma con que se abrió la página: dura hasta que se recarga. Si en otra
 * pestaña se cambia de idioma, esta sigue (y sigue imprimiendo) en el suyo
 * hasta recargarse; así nunca queda la pantalla en un idioma y lo impreso en otro.
 */
const deLaPagina = guardado();

/** Idioma en uso: 'es' o 'en'. */
export function idioma() {
  return fijo ?? deLaPagina;
}

export const enIngles = () => idioma() === 'en';

/** Locale para Intl (fechas y números). */
export const locale = () => (enIngles() ? 'en-CA' : 'es-CA');

/** Guarda el idioma en este navegador. Quien llama recarga la página. */
export function guardarIdioma(valor) {
  if (!IDIOMAS.includes(valor)) throw new Error(`Idioma desconocido: ${valor}`);
  try {
    globalThis.localStorage?.setItem(CLAVE_IDIOMA, valor);
  } catch {
    // sin almacenamiento: dura lo que dure la página
  }
  fijo = valor;
}

/** Carga el diccionario inglés (una vez). */
export async function cargarIngles() {
  diccionario ??= (await import('./i18n/en.js')).EN;
  return diccionario;
}

/** Pruebas: fija el idioma (y, para inglés, carga antes el diccionario con cargarIngles()). */
export function fijarIdioma(valor) {
  fijo = valor ?? null;
}

if (idioma() === 'en') await cargarIngles();

/** Claves que se pidieron en inglés y no tienen traducción (para las pruebas). */
export const faltantes = new Set();

function interpolar(plantilla, valores) {
  if (!valores) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (marca, clave) => (Object.prototype.hasOwnProperty.call(valores, clave) ? String(valores[clave] ?? '') : marca));
}

function buscar(clave) {
  if (!diccionario) return undefined;
  return Object.prototype.hasOwnProperty.call(diccionario, clave) ? diccionario[clave] : undefined;
}

/** El texto (en español) en el idioma elegido, con sus {valores}. */
export function t(texto, valores = null) {
  if (!enIngles()) return interpolar(texto, valores);
  const traduccion = buscar(texto);
  if (traduccion === undefined) faltantes.add(texto);
  return interpolar(traduccion ?? texto, valores);
}

/** Como t(), con contexto para frases que en inglés cambian según dónde van. */
export function tc(contexto, texto, valores = null) {
  if (!enIngles()) return interpolar(texto, valores);
  const traduccion = buscar(`${contexto}|${texto}`) ?? buscar(texto);
  if (traduccion === undefined) faltantes.add(`${contexto}|${texto}`);
  return interpolar(traduccion ?? texto, valores);
}

/** Siempre en español (lo que se guarda, como los movimientos en vivo), con sus {valores}. */
export const tEs = (texto, valores = null) => interpolar(texto, valores);

/** Traducción exacta de un texto suelto, o el mismo texto si no la hay (páginas estáticas). */
export function traducirTexto(texto) {
  if (!enIngles()) return texto;
  return buscar(texto) ?? texto;
}

// ------------------------------------------------------------- fechas y números

const DIAS = {
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const MESES = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const dos = (n) => String(n).padStart(2, '0');

/** "a.m." / "p.m." en español; "AM" / "PM" en inglés. */
export const meridiano = (horas24) => (enIngles() ? (horas24 < 12 ? 'AM' : 'PM') : (horas24 < 12 ? 'a.m.' : 'p.m.'));

/** Hora de 12 horas: "01:19 p.m." / "01:19 PM" (con segundos si se pide). */
export function hora12(fecha, { segundos = false } = {}) {
  const h24 = fecha.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${dos(h12)}:${dos(fecha.getMinutes())}${segundos ? `:${dos(fecha.getSeconds())}` : ''} ${meridiano(h24)}`;
}

/** "mié, 4 de nov 01:19 p.m." / "Wed, Nov 4 01:19 PM". */
export function diaYHora(fecha) {
  const i = idioma();
  return i === 'en'
    ? `${DIAS.en[fecha.getDay()]}, ${MESES.en[fecha.getMonth()]} ${fecha.getDate()} ${hora12(fecha)}`
    : `${DIAS.es[fecha.getDay()]}, ${fecha.getDate()} de ${MESES.es[fecha.getMonth()]} ${hora12(fecha)}`;
}

/** Entero con separador de miles del idioma: 1,234 (ambos usan coma en Canadá y México). */
export const numero = (n) => Number(n).toLocaleString(enIngles() ? 'en-CA' : 'es-MX');
