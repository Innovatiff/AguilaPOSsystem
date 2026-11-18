/**
 * Productos empacados en la tienda (bolsas de chicharrón de harina, chiles
 * secos…): su código de barras propio, lo que se captura al crearlos y los
 * textos de su etiqueta. Módulo puro: sin DOM ni Firestore (las escrituras
 * están en js/empacados.js; la etiqueta se dibuja en js/etiquetas.js).
 *
 * Cada producto empacado es un producto normal del catálogo (products/{id}:
 * la caja lo vende por su código) más empacados/{id}, con lo que no cabe en
 * el esquema del producto: si es picante y de dónde viene. El esquema del
 * producto no cambia.
 *
 * El código nuevo es un UPC-A que empieza por 4: en GS1 ese prefijo es para
 * uso interno de la tienda, así que nunca choca con el de un fabricante, y la
 * caja no lo confunde con una etiqueta de balanza (esas empiezan por 2).
 *
 * En la etiqueta solo el nombre va en español (como se escribió); lo demás va
 * siempre en inglés, sin importar el idioma de la pantalla.
 */
import { digitoVerificadorUPCA } from './upca.js';
import { centavosDesdeTexto } from './precios.js';
import { origenDesdeTexto } from './inventario.js';
import { t } from './idioma.js';

export const PREFIJO_EMPACADO = '4';
export const REGEX_CODIGO_EMPACADO = /^4\d{11}$/;
export const FRASES_PROCEDENCIA = Object.freeze(['hecho', 'producto']);
export const LIMITES_EMPACADO = Object.freeze({ nombre: 80, pais: 40, precioCentavos: 9999999, etiquetas: 200 });
/** Cantidades que se ofrecen con un toque al imprimir. */
export const CANTIDADES_RAPIDAS = Object.freeze([5, 10, 20, 30]);

/** Un dígito al azar sin sesgo (0–9) con el generador del sistema. */
function digitoAlAzar() {
  const byte = new Uint8Array(1);
  do globalThis.crypto.getRandomValues(byte);
  while (byte[0] >= 250);
  return byte[0] % 10;
}

/**
 * Código de barras nuevo para un producto empacado: UPC-A de 12 dígitos que
 * empieza por 4, con su dígito verificador, y que no esté en `ocupados` (los
 * códigos del catálogo). `azar` da dígitos (para las pruebas).
 */
export function nuevoCodigoEmpacado(ocupados = new Set(), azar = digitoAlAzar) {
  for (let intento = 0; intento < 100; intento += 1) {
    let once = PREFIJO_EMPACADO;
    for (let i = 0; i < 10; i += 1) once += String(azar());
    const codigo = `${once}${digitoVerificadorUPCA(once)}`;
    if (!ocupados.has(codigo)) return codigo;
  }
  throw new Error(t('No se pudo generar un código nuevo. Intenta otra vez.'));
}

/** Nombre tal como va al catálogo y a la barra negra de la etiqueta: sin espacios de más. */
const nombreLimpio = (texto) => String(texto ?? '').trim().replace(/\s+/g, ' ');

/**
 * Lo capturado → { producto, empacado }. `producto` son los datos para
 * armarProducto (sin código: lo pone quien llama al crear); `empacado`, lo
 * que va en empacados/{id}. Lanza un Error que se le puede mostrar a quien
 * captura. `picante` y `claseFiscal` son obligatorios: nada se supone.
 */
export function armarEmpacado({ nombre, precio, claseFiscal, picante, frase = 'hecho', pais, tiendas = [] }) {
  const limpio = nombreLimpio(nombre);
  if (limpio === '') throw new Error(t('Escribe el nombre del producto.'));
  if (limpio.length > LIMITES_EMPACADO.nombre) throw new Error(t('El nombre puede tener hasta {max} letras.', { max: LIMITES_EMPACADO.nombre }));
  if (String(precio ?? '').trim() === '') throw new Error(t('Escribe el precio.'));
  const precioCentavos = centavosDesdeTexto(precio);
  if (precioCentavos <= 0 || precioCentavos > LIMITES_EMPACADO.precioCentavos) throw new Error(t('El precio debe ser mayor que cero.'));
  if (!['gravado', 'tasaCero'].includes(claseFiscal)) throw new Error(t('Elige si lleva impuesto.'));
  if (typeof picante !== 'boolean') throw new Error(t('Elige si es picante o no.'));
  if (!FRASES_PROCEDENCIA.includes(frase)) throw new Error(t('Elige «Hecho en» o «Producto de».'));
  const paisGuardado = origenDesdeTexto(pais);
  if (!paisGuardado) throw new Error(t('Escribe el país de procedencia.'));
  if (paisGuardado.length > LIMITES_EMPACADO.pais) throw new Error(t('El país puede tener hasta {max} letras.', { max: LIMITES_EMPACADO.pais }));
  const lista = [...new Set((tiendas ?? []).filter((id) => typeof id === 'string' && id !== ''))];
  if (lista.length === 0) throw new Error(t('Elige al menos una tienda.'));
  return {
    producto: {
      nombre: limpio, marca: null, descriptor: null, presentacion: '', plu: null,
      precioCentavos, unidadVenta: 'pieza', claseFiscal, tiendas: lista, proveedor: null, activo: true,
    },
    empacado: { picante, procedencia: { frase, pais: paisGuardado } },
  };
}

/**
 * Lo que cambió al editar un producto empacado: { cambiosProducto, empacado }.
 * `cambiosProducto` solo trae los campos del producto que cambiaron (el
 * precio va con su historial); `empacado`, lo nuevo de empacados/{id} o null
 * si no cambió.
 */
export function cambiosEmpacado(actual, empacadoActual, armado) {
  const cambiosProducto = {};
  for (const campo of ['nombre', 'precioCentavos', 'claseFiscal']) {
    if (armado.producto[campo] !== actual[campo]) cambiosProducto[campo] = armado.producto[campo];
  }
  const tiendasAntes = [...(actual.tiendas ?? [])].sort().join('|');
  if ([...armado.producto.tiendas].sort().join('|') !== tiendasAntes) cambiosProducto.tiendas = armado.producto.tiendas;
  const mismo = empacadoActual
    && empacadoActual.picante === armado.empacado.picante
    && empacadoActual.procedencia?.frase === armado.empacado.procedencia.frase
    && empacadoActual.procedencia?.pais === armado.empacado.procedencia.pais;
  return { cambiosProducto, empacado: mismo ? null : armado.empacado };
}

/** Cuántas etiquetas: entero de 1 a 200 (lanza si no). */
export function cantidadEtiquetas(texto) {
  const limpio = String(texto ?? '').trim();
  const n = /^\d{1,4}$/.test(limpio) ? Number.parseInt(limpio, 10) : Number.NaN;
  if (!(n >= 1 && n <= LIMITES_EMPACADO.etiquetas)) throw new Error(t('Escribe cuántas etiquetas: de 1 a {max}.', { max: LIMITES_EMPACADO.etiquetas }));
  return n;
}

// ------------------------------------------------------------- la etiqueta, en inglés

/** Países de la lista (como se guardan) → su nombre en inglés para la etiqueta. */
export const PAISES_EN_INGLES = Object.freeze({
  México: 'Mexico',
  Canadá: 'Canada',
  'Estados Unidos': 'USA',
  Guatemala: 'Guatemala',
  'El Salvador': 'El Salvador',
  Honduras: 'Honduras',
  Nicaragua: 'Nicaragua',
  'Costa Rica': 'Costa Rica',
  Panamá: 'Panama',
  Colombia: 'Colombia',
  Perú: 'Peru',
  Ecuador: 'Ecuador',
  Chile: 'Chile',
  Argentina: 'Argentina',
  Brasil: 'Brazil',
  'República Dominicana': 'Dominican Republic',
  España: 'Spain',
  Italia: 'Italy',
  China: 'China',
  Tailandia: 'Thailand',
  India: 'India',
});

/** «Made in Canada» / «Product of Mexico». Un país que no está en la lista va como se escribió. */
export function procedenciaEnIngles(procedencia) {
  const pais = PAISES_EN_INGLES[procedencia?.pais] ?? String(procedencia?.pais ?? '').trim();
  return `${procedencia?.frase === 'producto' ? 'Product of' : 'Made in'} ${pais}`.trim();
}

/** 'AAAA-MM-DD' → «Packed on Nov 18, 2026». */
export function fechaEmpaqueEnIngles(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(t('Elige la fecha de empaque.'));
  const fecha = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== iso) throw new Error(t('Elige la fecha de empaque.'));
  const texto = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(fecha);
  return `Packed on ${texto}`;
}

/** «Spicy» / «Not spicy». */
export const textoPicante = (picante) => (picante ? 'Spicy' : 'Not spicy');

/** Todo lo que lleva la etiqueta (el nombre en español; lo demás, en inglés). */
export function textosEtiquetaEmpaque(producto, empacado, fechaEmpaque) {
  return {
    nombre: producto.nombre,
    procedencia: procedenciaEnIngles(empacado.procedencia),
    picante: textoPicante(empacado.picante),
    fecha: fechaEmpaqueEnIngles(fechaEmpaque),
    codigo: producto.upc,
  };
}
