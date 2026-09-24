/**
 * Esquema del catálogo: constantes, normalización y validación.
 * Módulo puro (sin Firebase ni DOM) para poder probarlo en Node y reutilizarlo
 * en el POS. Refleja exactamente lo que exigen las reglas de Firestore.
 */

export const UNIDADES_VENTA = Object.freeze(['pieza', 'peso']);
export const CLASES_FISCALES = Object.freeze(['gravado', 'tasaCero']);
export const ROLES = Object.freeze(['admin', 'empleado']);

/** Campos de products/{id}, en el orden del esquema. Ni uno más. */
export const CAMPOS_PRODUCTO = Object.freeze([
  'upc', 'plu', 'nombre', 'marca', 'descriptor', 'presentacion',
  'precioCentavos', 'unidadVenta', 'precioPorKgCentavos', 'claseFiscal',
  'tiendas', 'existencias', 'costoCentavos', 'proveedor', 'activo',
  'ultimoPrecioImpresoCentavos', 'fechaUltimaImpresion', 'tokensBusqueda',
  'creadoEn', 'actualizadoEn', 'actualizadoPor',
]);

export const LIMITES = Object.freeze({
  nombre: 80,
  marca: 60,
  descriptor: 80,
  presentacion: 30,
  proveedor: 80,
  precioCentavosMaximo: 9999999,
  tiendasMaximo: 20,
  tokensMaximo: 400,
});

export const LONGITUD_MINIMA_TOKEN = 3;

/** Campos que el personal edita desde la pantalla de productos. */
export const CAMPOS_EDITABLES = Object.freeze([
  'upc', 'plu', 'nombre', 'marca', 'descriptor', 'presentacion',
  'precioCentavos', 'unidadVenta', 'precioPorKgCentavos', 'claseFiscal',
  'tiendas', 'proveedor', 'activo',
]);

const REGEX_UPC = /^[0-9]{12}$/;
const REGEX_PLU = /^[0-9]{4,5}$/;
const REGEX_FECHA_ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Minúsculas, sin acentos (ñ → n), espacios colapsados. */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras normalizadas de un texto (separadas por espacios). */
export function palabras(texto) {
  const normalizado = normalizarTexto(texto);
  return normalizado === '' ? [] : normalizado.split(' ');
}

/**
 * tokensBusqueda: todos los prefijos de 3 o más letras de cada palabra del
 * nombre y de la marca. "Salsa Verde" → sal, sals, salsa, ver, verd, verde.
 * Firestore no busca subcadenas; con esto, array-contains sobre el término
 * normalizado encuentra el producto mientras se escribe.
 */
export function tokensBusqueda(nombre, marca) {
  const tokens = new Set();
  for (const palabra of [...palabras(nombre), ...palabras(marca)]) {
    for (let n = LONGITUD_MINIMA_TOKEN; n <= palabra.length; n += 1) {
      tokens.add(palabra.slice(0, n));
    }
  }
  return [...tokens].sort();
}

/**
 * Prepara una consulta de búsqueda: el término más largo (≥ 3 letras) va al
 * array-contains; el resto se filtra en el cliente.
 * @returns {{ termino: string | null, resto: string[] }}
 */
export function prepararConsulta(consulta) {
  const lista = palabras(consulta).filter((p) => p.length >= LONGITUD_MINIMA_TOKEN);
  if (lista.length === 0) return { termino: null, resto: [] };
  const [termino, ...resto] = [...lista].sort((a, b) => b.length - a.length);
  return { termino, resto };
}

/**
 * Búsqueda en memoria sobre el catálogo sincronizado: cada término debe ser
 * prefijo de alguna palabra del nombre o la marca (sin acentos ni mayúsculas),
 * o prefijo del UPC o del PLU. Sin límite de 3 letras: aquí no hay Firestore.
 */
export function coincideBusqueda(producto, consulta) {
  const terminos = palabras(consulta);
  if (terminos.length === 0) return true;
  const palabrasProducto = [...palabras(producto.nombre), ...palabras(producto.marca)];
  const codigos = [producto.upc, producto.plu].filter((c) => typeof c === 'string' && c !== '');
  return terminos.every(
    (termino) => palabrasProducto.some((p) => p.startsWith(termino)) || codigos.some((c) => c.startsWith(termino)),
  );
}

const iguales = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

/**
 * Campos editables cuyo valor cambió entre el producto guardado y el capturado.
 * Solo esos se envían: dos estaciones que editan campos distintos no se pisan.
 */
export function diferenciasProducto(actual, nuevo) {
  const cambios = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (!iguales(actual[campo] ?? null, nuevo[campo] ?? null)) cambios[campo] = nuevo[campo] ?? null;
  }
  return cambios;
}

/** ¿El texto parece un código de barras tecleado por el escáner? */
export function pareceUPC(texto) {
  return /^\d{11,13}$/.test(String(texto ?? '').trim());
}

export function esFechaISO(valor) {
  return typeof valor === 'string' && REGEX_FECHA_ISO.test(valor);
}

/** Fecha local "YYYY-MM-DD" (la del reloj de la estación, no UTC). */
export function fechaISOLocal(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Id de la entrada de priceHistory que acompaña a un cambio de precio. */
export function idHistorialPrecio(productId, fechaMillis) {
  if (!Number.isInteger(fechaMillis)) throw new TypeError('fechaMillis debe ser un entero (milisegundos)');
  return `${productId}_${fechaMillis}`;
}

const esEntero = (v) => Number.isInteger(v);
const esTextoONulo = (v, maximo) => v === null || (typeof v === 'string' && v.length <= maximo);

/**
 * Valida un documento de producto completo contra el esquema.
 * Devuelve la lista de errores (vacía si es válido), en español, para la UI.
 * Las marcas de tiempo se aceptan como cualquier objeto no nulo (Timestamp).
 */
export function validarProducto(p) {
  const errores = [];
  if (p === null || typeof p !== 'object') return ['El producto no es un objeto'];

  const claves = Object.keys(p);
  for (const campo of CAMPOS_PRODUCTO) if (!claves.includes(campo)) errores.push(`Falta el campo ${campo}`);
  for (const clave of claves) if (!CAMPOS_PRODUCTO.includes(clave)) errores.push(`Campo no permitido: ${clave}`);
  if (errores.length > 0) return errores;

  if (!(p.upc === null || (typeof p.upc === 'string' && REGEX_UPC.test(p.upc)))) errores.push('El UPC debe tener 12 dígitos o estar vacío');
  if (!(p.plu === null || (typeof p.plu === 'string' && REGEX_PLU.test(p.plu)))) errores.push('El PLU debe tener 4 o 5 dígitos o estar vacío');
  if (!(typeof p.nombre === 'string' && p.nombre.length > 0 && p.nombre.length <= LIMITES.nombre)) errores.push(`El nombre es obligatorio (máximo ${LIMITES.nombre} caracteres)`);
  if (!esTextoONulo(p.marca, LIMITES.marca)) errores.push(`La marca no puede superar ${LIMITES.marca} caracteres`);
  if (!esTextoONulo(p.descriptor, LIMITES.descriptor)) errores.push(`El descriptor no puede superar ${LIMITES.descriptor} caracteres`);
  if (!(typeof p.presentacion === 'string' && p.presentacion.length <= LIMITES.presentacion)) errores.push(`La presentación debe ser texto (máximo ${LIMITES.presentacion} caracteres)`);
  if (!(esEntero(p.precioCentavos) && p.precioCentavos >= 0 && p.precioCentavos <= LIMITES.precioCentavosMaximo)) errores.push('El precio debe ser un entero en centavos entre 0 y 9,999,999');
  if (!UNIDADES_VENTA.includes(p.unidadVenta)) errores.push('La unidad de venta debe ser "pieza" o "peso"');
  if (p.unidadVenta === 'pieza') {
    if (!(esEntero(p.precioCentavos) && p.precioCentavos > 0)) errores.push('Un producto por pieza necesita precio mayor que cero');
    if (p.precioPorKgCentavos !== null) errores.push('Un producto por pieza no lleva precio por kilo');
  }
  if (p.unidadVenta === 'peso' && !(esEntero(p.precioPorKgCentavos) && p.precioPorKgCentavos > 0)) errores.push('Un producto por peso necesita precio por kilo en centavos, mayor que cero');
  if (!CLASES_FISCALES.includes(p.claseFiscal)) errores.push('La clase fiscal debe ser "gravado" o "tasaCero"');
  if (!(Array.isArray(p.tiendas) && p.tiendas.length <= LIMITES.tiendasMaximo && p.tiendas.every((t) => typeof t === 'string' && t !== ''))) errores.push('Las tiendas deben ser una lista de identificadores');
  if (!(p.existencias === null || esEntero(p.existencias))) errores.push('Las existencias deben ser un entero o null');
  if (!(p.costoCentavos === null || esEntero(p.costoCentavos))) errores.push('El costo debe ser un entero en centavos o null');
  if (!esTextoONulo(p.proveedor, LIMITES.proveedor)) errores.push(`El proveedor no puede superar ${LIMITES.proveedor} caracteres`);
  if (typeof p.activo !== 'boolean') errores.push('activo debe ser verdadero o falso');
  if (!(p.ultimoPrecioImpresoCentavos === null || (esEntero(p.ultimoPrecioImpresoCentavos) && p.ultimoPrecioImpresoCentavos >= 0))) errores.push('El último precio impreso debe ser un entero en centavos o null');
  if (!(p.fechaUltimaImpresion === null || esFechaISO(p.fechaUltimaImpresion))) errores.push('La fecha de última impresión debe ser "YYYY-MM-DD" o null');
  if (!(Array.isArray(p.tokensBusqueda) && p.tokensBusqueda.length <= LIMITES.tokensMaximo)) errores.push('tokensBusqueda debe ser una lista');
  if (!(p.creadoEn && typeof p.creadoEn === 'object')) errores.push('Falta creadoEn');
  if (!(p.actualizadoEn && typeof p.actualizadoEn === 'object')) errores.push('Falta actualizadoEn');
  if (!(typeof p.actualizadoPor === 'string' && p.actualizadoPor.includes('@'))) errores.push('actualizadoPor debe ser el correo del usuario');
  return errores;
}

/**
 * Construye el documento completo de un producto nuevo a partir de los datos
 * capturados. Los campos que administra el POS quedan en null. No incluye las
 * marcas de tiempo: las pone la capa de escritura (js/productos.js).
 */
export function armarProducto(datos, correoUsuario) {
  const limpiar = (v) => {
    if (v === undefined || v === null) return null;
    const texto = String(v).trim();
    return texto === '' ? null : texto;
  };
  const nombre = String(datos.nombre ?? '').trim();
  const marca = limpiar(datos.marca);
  const unidadVenta = datos.unidadVenta ?? 'pieza';
  return {
    upc: limpiar(datos.upc),
    plu: limpiar(datos.plu),
    nombre,
    marca,
    descriptor: limpiar(datos.descriptor),
    presentacion: String(datos.presentacion ?? '').trim(),
    precioCentavos: datos.precioCentavos,
    unidadVenta,
    precioPorKgCentavos: unidadVenta === 'peso' ? (datos.precioPorKgCentavos ?? null) : null,
    claseFiscal: datos.claseFiscal,
    tiendas: Array.isArray(datos.tiendas) ? [...datos.tiendas] : [],
    existencias: null,
    costoCentavos: null,
    proveedor: limpiar(datos.proveedor),
    activo: datos.activo ?? true,
    ultimoPrecioImpresoCentavos: datos.ultimoPrecioImpresoCentavos ?? null,
    fechaUltimaImpresion: datos.fechaUltimaImpresion ?? null,
    tokensBusqueda: tokensBusqueda(nombre, marca),
    actualizadoPor: String(correoUsuario).toLowerCase(),
  };
}
