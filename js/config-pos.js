/**
 * Configuración del POS (config/pos): valores por defecto y validación.
 * Módulo puro: lo usan la caja, el back office (Configuración) y las pruebas.
 */
import { TASA_HST_BP } from './ticket.js';
import { t, enIngles } from './idioma.js';

/** Colores de las teclas de departamento (clases CSS de la caja, no colores libres). */
export const COLORES_DEPARTAMENTO = Object.freeze(['verde', 'naranja', 'rojo', 'azul', 'amarillo', 'morado', 'turquesa', 'gris']);

// Los nombres de los departamentos y el pie del recibo de fábrica son datos (se guardan en config/pos): no se traducen.
// Cada tecla puede llevar además su nombre en inglés (nombreEn), que se ve cuando el equipo está en inglés.
// i18n:sin-revisar-inicio
/** Teclas de departamento para vender artículos sin código o que no están en el catálogo. */
export const DEPARTAMENTOS_DEFECTO = Object.freeze([
  { id: 'abarrotes', nombre: 'Abarrotes', nombreEn: 'Grocery', claseFiscal: 'tasaCero', color: 'verde' },
  { id: 'abarrotes-tx', nombre: 'Abarrotes +Tx', nombreEn: 'Grocery +Tx', claseFiscal: 'gravado', color: 'naranja' },
  { id: 'carniceria', nombre: 'Carnicería', nombreEn: 'Meat', claseFiscal: 'tasaCero', color: 'rojo' },
  { id: 'frutas-verduras', nombre: 'Frutas y verduras', nombreEn: 'Produce', claseFiscal: 'tasaCero', color: 'verde' },
  { id: 'panaderia', nombre: 'Panadería', nombreEn: 'Bakery', claseFiscal: 'tasaCero', color: 'amarillo' },
  { id: 'lacteos', nombre: 'Lácteos', nombreEn: 'Dairy', claseFiscal: 'tasaCero', color: 'azul' },
  { id: 'bebidas-tx', nombre: 'Bebidas +Tx', nombreEn: 'Beverages +Tx', claseFiscal: 'gravado', color: 'turquesa' },
  { id: 'salud-belleza', nombre: 'Salud y belleza', nombreEn: 'Health & Beauty', claseFiscal: 'gravado', color: 'morado' },
  { id: 'varios-tx', nombre: 'Varios +Tx', nombreEn: 'Miscellaneous +Tx', claseFiscal: 'gravado', color: 'gris' },
]);

export const CONFIG_POS_DEFECTO = Object.freeze({
  impuestoNombre: 'HST',
  tasaImpuestoBP: TASA_HST_BP,
  fondoSugeridoCentavos: 15000,
  limiteVentaLibreCentavos: 20000,
  conteoCiego: true,
  papelRecibo: 80,
  reciboPie: '¡Gracias por su compra!',
  departamentos: DEPARTAMENTOS_DEFECTO,
});
// i18n:sin-revisar-fin

export const MAXIMO_DEPARTAMENTOS = 24;
export const MAXIMO_NOMBRE_DEPARTAMENTO = 30;

const DE_FABRICA = new Map(DEPARTAMENTOS_DEFECTO.map((d) => [d.id, d]));

/**
 * La tecla con su nombre en inglés: el que se guardó o, si es una tecla de
 * fábrica que nadie renombró, el de fábrica (así una configuración guardada
 * antes de existir el campo también se ve en inglés).
 */
function conNombreEn(d) {
  const propio = typeof d.nombreEn === 'string' ? d.nombreEn.trim().slice(0, MAXIMO_NOMBRE_DEPARTAMENTO) : '';
  const fabrica = DE_FABRICA.get(d.id);
  const nombreEn = propio || (fabrica && fabrica.nombre === String(d.nombre).trim() ? fabrica.nombreEn : '');
  return { ...d, nombreEn: nombreEn || null };
}

/** Nombre de la tecla en el idioma de la página: en inglés, el suyo si lo tiene. */
export function nombreDepartamento(d) {
  if (!d) return '';
  return enIngles() && typeof d.nombreEn === 'string' && d.nombreEn.trim() ? d.nombreEn.trim() : d.nombre;
}

/**
 * Nombre de un departamento guardado en una venta o un corte (con el nombre en
 * español de ese momento): en español, tal cual se guardó; en inglés, el de la
 * tecla con ese id si tiene nombre en inglés.
 */
export function nombreDepartamentoPorId(departamentos, id, guardado = '') {
  if (!enIngles()) return guardado;
  const d = (departamentos ?? []).find((x) => x.id === id);
  return (typeof d?.nombreEn === 'string' && d.nombreEn.trim()) || guardado;
}

/** Nombre de una línea de venta para mostrar: las de venta libre, con el nombre de su departamento en el idioma de la página. */
export function nombreDeLinea(linea, departamentos) {
  return linea?.departamento && !linea.productoId ? nombreDepartamentoPorId(departamentos, linea.departamento, linea.nombre) : linea?.nombre ?? '';
}

/** Configuración efectiva: lo guardado, con los valores por defecto donde falte o no sea válido. */
export function configConDefectos(guardada) {
  const g = guardada ?? {};
  const entero = (v, defecto, min, max) => (Number.isSafeInteger(v) && v >= min && v <= max ? v : defecto);
  const departamentos = (Array.isArray(g.departamentos) && g.departamentos.length > 0
    ? g.departamentos.filter((d) => validarDepartamento(d).length === 0).slice(0, MAXIMO_DEPARTAMENTOS)
    : DEPARTAMENTOS_DEFECTO).map(conNombreEn);
  return {
    impuestoNombre: typeof g.impuestoNombre === 'string' && g.impuestoNombre.trim() ? g.impuestoNombre.trim().slice(0, 20) : CONFIG_POS_DEFECTO.impuestoNombre,
    tasaImpuestoBP: entero(g.tasaImpuestoBP, CONFIG_POS_DEFECTO.tasaImpuestoBP, 0, 3000),
    fondoSugeridoCentavos: entero(g.fondoSugeridoCentavos, CONFIG_POS_DEFECTO.fondoSugeridoCentavos, 0, 10_000_000),
    limiteVentaLibreCentavos: entero(g.limiteVentaLibreCentavos, CONFIG_POS_DEFECTO.limiteVentaLibreCentavos, 0, 10_000_000),
    conteoCiego: typeof g.conteoCiego === 'boolean' ? g.conteoCiego : CONFIG_POS_DEFECTO.conteoCiego,
    papelRecibo: g.papelRecibo === 58 ? 58 : 80,
    reciboPie: typeof g.reciboPie === 'string' ? g.reciboPie.slice(0, 300) : CONFIG_POS_DEFECTO.reciboPie,
    departamentos: departamentos.length > 0 ? departamentos : DEPARTAMENTOS_DEFECTO.map(conNombreEn),
  };
}

/** Errores de una tecla de departamento (vacío si está bien). */
export function validarDepartamento(d) {
  const errores = [];
  if (!d || typeof d !== 'object') return [t('Departamento no válido')];
  if (typeof d.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(d.id)) errores.push(t('Identificador no válido'));
  if (typeof d.nombre !== 'string' || d.nombre.trim() === '' || d.nombre.length > MAXIMO_NOMBRE_DEPARTAMENTO) errores.push(t('El nombre debe tener de 1 a 30 caracteres'));
  if (d.nombreEn !== undefined && d.nombreEn !== null && (typeof d.nombreEn !== 'string' || d.nombreEn.length > MAXIMO_NOMBRE_DEPARTAMENTO)) {
    errores.push(t('El nombre en inglés debe tener como máximo 30 caracteres'));
  }
  if (!['gravado', 'tasaCero'].includes(d.claseFiscal)) errores.push(t('Clase fiscal no válida'));
  if (!COLORES_DEPARTAMENTO.includes(d.color)) errores.push(t('Color no válido'));
  return errores;
}

/** Documento config/pos listo para guardar (las reglas exigen estos campos exactos). */
export function armarConfigPos(datos, usuario, actualizadoEn) {
  const c = configConDefectos(datos);
  return {
    impuestoNombre: c.impuestoNombre,
    tasaImpuestoBP: c.tasaImpuestoBP,
    fondoSugeridoCentavos: c.fondoSugeridoCentavos,
    limiteVentaLibreCentavos: c.limiteVentaLibreCentavos,
    conteoCiego: c.conteoCiego,
    papelRecibo: c.papelRecibo,
    reciboPie: c.reciboPie,
    departamentos: c.departamentos.map((d) => ({ id: d.id, nombre: d.nombre.trim(), nombreEn: d.nombreEn?.trim() || null, claseFiscal: d.claseFiscal, color: d.color })),
    actualizadoEn,
    actualizadoPor: usuario,
  };
}
