/**
 * CSV del catálogo: exportación e importación con el esquema exacto.
 * Módulo puro (sin Firebase ni DOM), probado en Node.
 *
 * - RFC 4180: comillas, comillas dobles escapadas, saltos de línea dentro
 *   de comillas, CRLF. Se escribe con BOM para que Excel respete acentos.
 * - Al importar se detecta el delimitador (coma, punto y coma o tabulador).
 * - Dinero siempre en centavos enteros, como en la base de datos.
 */
import {
  CAMPOS_EDITABLES, UNIDADES_VENTA, CLASES_FISCALES,
  armarProducto, validarProducto, diferenciasProducto, esFechaISO,
} from './esquema.js';
import { normalizarUPC } from './upca.js';

/** Columnas del archivo exportado, en este orden. `id` es el id del documento. */
export const COLUMNAS_EXPORTACION = Object.freeze([
  'id', 'upc', 'plu', 'nombre', 'marca', 'descriptor', 'presentacion',
  'precioCentavos', 'unidadVenta', 'precioPorKgCentavos', 'claseFiscal',
  'tiendas', 'existencias', 'costoCentavos', 'proveedor', 'activo',
  'ultimoPrecioImpresoCentavos', 'fechaUltimaImpresion',
  'creadoEn', 'actualizadoEn', 'actualizadoPor',
]);

/** Columnas que la importación lee. Las demás del esquema las pone la app. */
export const COLUMNAS_IMPORTABLES = Object.freeze([
  'id', 'upc', 'plu', 'nombre', 'marca', 'descriptor', 'presentacion',
  'precioCentavos', 'unidadVenta', 'precioPorKgCentavos', 'claseFiscal',
  'tiendas', 'proveedor', 'activo', 'ultimoPrecioImpresoCentavos', 'fechaUltimaImpresion',
]);

/** Columnas que se aceptan en el archivo pero no se importan (las administra la app o el POS). */
export const COLUMNAS_IGNORADAS = Object.freeze(['existencias', 'costoCentavos', 'tokensBusqueda', 'creadoEn', 'actualizadoEn', 'actualizadoPor']);

const CAMPOS_COMPARABLES = Object.freeze([...CAMPOS_EDITABLES, 'ultimoPrecioImpresoCentavos', 'fechaUltimaImpresion']);
const SEPARADOR_TIENDAS = '|';

// ------------------------------------------------------------- escritura
function escapar(valor, delimitador) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /["\r\n]/.test(texto) || texto.includes(delimitador) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Filas (arreglos de valores) → texto CSV con BOM y CRLF. */
export function aCSV(filas, delimitador = ',') {
  return `﻿${filas.map((fila) => fila.map((v) => escapar(v, delimitador)).join(delimitador)).join('\r\n')}\r\n`;
}

const fechaISO = (marca) => (marca && typeof marca.toDate === 'function' ? marca.toDate().toISOString() : '');

/** Un producto (con su id) → valores en el orden de COLUMNAS_EXPORTACION. */
export function serializarProducto(p) {
  return COLUMNAS_EXPORTACION.map((columna) => {
    const valor = p[columna];
    if (columna === 'tiendas') return (valor ?? []).join(SEPARADOR_TIENDAS);
    if (columna === 'creadoEn' || columna === 'actualizadoEn') return fechaISO(valor);
    if (typeof valor === 'boolean') return valor ? 'true' : 'false';
    return valor ?? '';
  });
}

/** Catálogo completo → CSV, ordenado por nombre. */
export function exportarCatalogo(productos) {
  const ordenados = [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return aCSV([[...COLUMNAS_EXPORTACION], ...ordenados.map(serializarProducto)]);
}

/** Solo la fila de encabezados importables, para llenar en una hoja de cálculo. */
export function plantillaCSV() {
  return aCSV([COLUMNAS_IMPORTABLES.filter((c) => c !== 'id')]);
}

/** Nombre de archivo con la fecha local. */
export function nombreArchivoExportacion(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `catalogo-aguila-${y}-${m}-${d}.csv`;
}

// ------------------------------------------------------------- lectura
function detectarDelimitador(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (d) => primera.split(d).length - 1;
  return [',', ';', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

/**
 * Texto CSV → { delimitador, encabezados, filas }. Tolera BOM, CRLF/LF,
 * comillas RFC 4180 y filas vacías al final.
 */
export function deCSV(texto) {
  let t = String(texto ?? '');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const delimitador = detectarDelimitador(t);
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === delimitador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  while (filas.length > 0 && filas[filas.length - 1].every((v) => v.trim() === '')) filas.pop();
  const [encabezados = [], ...datos] = filas;
  return { delimitador, encabezados: encabezados.map((e) => e.trim()), filas: datos };
}

// ------------------------------------------------------------- interpretación de celdas
const VERDADEROS = new Set(['true', '1', 'si', 'sí', 'verdadero', 'x', 'activo']);
const FALSOS = new Set(['false', '0', 'no', 'falso', 'inactivo']);

function enteroCentavos(texto, columna) {
  const limpio = texto.trim();
  if (limpio === '') return null;
  if (/^-?\d+$/.test(limpio)) return Number.parseInt(limpio, 10);
  if (/^\d+[.,]\d+$/.test(limpio)) throw new Error(`${columna} debe ser un entero en centavos (499, no 4.99)`);
  throw new Error(`${columna} no es un número entero: "${limpio}"`);
}

/** Convierte el texto de una celda al valor del esquema. Lanza con mensaje claro. */
export function interpretarCelda(columna, texto) {
  const crudo = String(texto ?? '');
  const limpio = crudo.trim();
  switch (columna) {
    case 'id':
      return limpio === '' ? null : limpio;
    case 'upc': {
      if (limpio === '') return null;
      if (/^\d+(\.\d+)?e\+?\d+$/i.test(limpio)) throw new Error('upc en notación científica: Excel lo convirtió a número; da formato de texto a la columna');
      const digitos = limpio.replace(/\s+/g, '');
      // Excel quita el cero inicial: 11 dígitos se completan a 12.
      return normalizarUPC(/^\d{11}$/.test(digitos) ? `0${digitos}` : digitos);
    }
    case 'plu':
      if (limpio === '') return null;
      if (!/^\d{4,5}$/.test(limpio)) throw new Error(`plu debe tener 4 o 5 dígitos: "${limpio}"`);
      return limpio;
    case 'nombre':
    case 'marca':
    case 'descriptor':
    case 'proveedor':
      return limpio === '' ? null : limpio;
    case 'presentacion':
      return limpio;
    case 'precioCentavos':
    case 'precioPorKgCentavos':
    case 'ultimoPrecioImpresoCentavos':
      return enteroCentavos(limpio, columna);
    case 'unidadVenta': {
      if (limpio === '') return null;
      const valor = limpio.toLowerCase();
      if (!UNIDADES_VENTA.includes(valor)) throw new Error(`unidadVenta debe ser pieza o peso: "${limpio}"`);
      return valor;
    }
    case 'claseFiscal': {
      if (limpio === '') return null;
      const valor = limpio.toLowerCase().replace(/\s+/g, '');
      if (valor === 'gravado' || valor === '+tx') return 'gravado';
      if (valor === 'tasacero' || valor === 'c') return 'tasaCero';
      if (CLASES_FISCALES.includes(limpio)) return limpio;
      throw new Error(`claseFiscal debe ser gravado o tasaCero: "${limpio}"`);
    }
    case 'tiendas':
      return limpio === '' ? [] : limpio.split(/[|;]/).map((t) => t.trim()).filter(Boolean);
    case 'activo': {
      if (limpio === '') return null;
      const valor = limpio.toLowerCase();
      if (VERDADEROS.has(valor)) return true;
      if (FALSOS.has(valor)) return false;
      throw new Error(`activo debe ser true o false: "${limpio}"`);
    }
    case 'fechaUltimaImpresion':
      if (limpio === '') return null;
      if (!esFechaISO(limpio)) throw new Error(`fechaUltimaImpresion debe ser AAAA-MM-DD: "${limpio}"`);
      return limpio;
    default:
      return limpio;
  }
}

// ------------------------------------------------------------- plan de importación
const VALORES_NUEVO = Object.freeze({
  upc: null, plu: null, nombre: null, marca: null, descriptor: null, presentacion: '',
  precioCentavos: null, unidadVenta: 'pieza', precioPorKgCentavos: null, claseFiscal: null,
  tiendas: [], proveedor: null, activo: true, ultimoPrecioImpresoCentavos: null, fechaUltimaImpresion: null,
});

/**
 * Compara el archivo con el catálogo y decide qué crear, qué actualizar y
 * qué filas tienen errores. No escribe nada.
 *
 * - Con `id` se actualiza ese producto (debe existir).
 * - Sin `id`, un `upc` que ya existe actualiza ese producto; si no, se crea.
 * - Columna ausente = campo sin tocar (o valor por defecto al crear).
 *   Celda vacía = null (presentacion: ''), salvo activo y upc, que al
 *   actualizar se dejan como están: un UPC nunca se borra desde el CSV.
 *
 * @param {{encabezados: string[], filas: string[][]}} archivo
 * @param {Map<string, object>} catalogo id → producto
 * @param {string} correo quien importa
 */
export function planificarImportacion(archivo, catalogo, correo) {
  const plan = { crear: [], actualizar: [], sinCambios: 0, errores: [], avisos: [], columnas: [], ignoradas: [], desconocidas: [] };
  const indice = new Map();
  archivo.encabezados.forEach((encabezado, i) => {
    const nombre = encabezado.replace(/^﻿/, '').trim();
    const conocida = COLUMNAS_IMPORTABLES.find((c) => c.toLowerCase() === nombre.toLowerCase());
    if (conocida) {
      indice.set(conocida, i);
      plan.columnas.push(conocida);
    } else if (COLUMNAS_IGNORADAS.some((c) => c.toLowerCase() === nombre.toLowerCase())) {
      plan.ignoradas.push(nombre);
    } else if (nombre !== '') {
      plan.desconocidas.push(nombre);
    }
  });
  if (plan.ignoradas.length > 0) plan.avisos.push(`Columnas que no se importan (las administra la app o el POS): ${plan.ignoradas.join(', ')}.`);
  if (plan.desconocidas.length > 0) plan.avisos.push(`Columnas desconocidas, se omiten: ${plan.desconocidas.join(', ')}.`);
  if (plan.columnas.length === 0) {
    plan.errores.push({ linea: 1, mensaje: 'El archivo no tiene ninguna columna del esquema (nombre, upc, precioCentavos…).' });
    return plan;
  }

  const porUPC = new Map();
  for (const p of catalogo.values()) if (p.upc) porUPC.set(p.upc, p);
  const upcsEnArchivo = new Map();
  const productosEnArchivo = new Map(); // id del producto → línea donde ya apareció

  archivo.filas.forEach((fila, i) => {
    const linea = i + 2;
    if (fila.every((v) => String(v ?? '').trim() === '')) return;
    try {
      const celdas = {};
      for (const [columna, posicion] of indice) celdas[columna] = interpretarCelda(columna, fila[posicion] ?? '');

      let actual = null;
      if (celdas.id) {
        actual = catalogo.get(celdas.id) ?? null;
        if (!actual) throw new Error(`no existe ningún producto con id "${celdas.id}"`);
      } else if (celdas.upc) {
        actual = porUPC.get(celdas.upc) ?? null;
      }
      if (actual) {
        if (productosEnArchivo.has(actual.id)) throw new Error(`«${actual.nombre}» ya aparece en la línea ${productosEnArchivo.get(actual.id)}`);
        productosEnArchivo.set(actual.id, linea);
      }

      if (celdas.upc) {
        if (upcsEnArchivo.has(celdas.upc)) throw new Error(`el UPC ${celdas.upc} aparece más de una vez en el archivo (línea ${upcsEnArchivo.get(celdas.upc)})`);
        upcsEnArchivo.set(celdas.upc, linea);
        const dueno = porUPC.get(celdas.upc);
        if (dueno && actual && dueno.id !== actual.id) throw new Error(`el UPC ${celdas.upc} ya pertenece a otro producto («${dueno.nombre}»)`);
      }

      const base = actual ? { ...actual } : { ...VALORES_NUEVO };
      for (const columna of plan.columnas) {
        if (columna === 'id') continue;
        const valor = celdas[columna];
        if (columna === 'activo' && valor === null) continue; // vacío: se deja como está / true al crear
        if (columna === 'upc' && valor === null && actual) continue; // un UPC nunca se borra desde el CSV
        if ((columna === 'unidadVenta' || columna === 'claseFiscal') && valor === null && actual) continue;
        base[columna] = valor;
      }
      if (!actual) {
        for (const requerida of ['nombre', 'precioCentavos', 'claseFiscal']) {
          if (!indice.has(requerida)) throw new Error(`para crear productos el archivo necesita la columna ${requerida}`);
        }
        if (base.unidadVenta === null) base.unidadVenta = 'pieza';
      }

      const preparado = armarProducto(base, correo);
      const errores = validarProducto({ ...preparado, creadoEn: {}, actualizadoEn: {} });
      if (errores.length > 0) throw new Error(errores.join(' '));

      if (actual) {
        const cambios = diferenciasProducto(actual, preparado, CAMPOS_COMPARABLES);
        if (Object.keys(cambios).length === 0) plan.sinCambios += 1;
        else plan.actualizar.push({ linea, actual, cambios, nombre: preparado.nombre });
      } else {
        plan.crear.push({ linea, datos: preparado, nombre: preparado.nombre });
      }
    } catch (error) {
      plan.errores.push({ linea, mensaje: error.message });
    }
  });
  return plan;
}
