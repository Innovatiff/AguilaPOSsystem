/**
 * Movimientos en vivo (eventos/): nombres, colores y agrupación de cada tipo,
 * y la hora con segundos. Módulo puro (sin Firebase ni DOM): lo usan la
 * página de movimientos y el historial de auditoría de las transacciones, y
 * se prueba en Node. Los tipos son los mismos que aceptan las reglas.
 */

/** tipo → { etiqueta, chip (clase chip--*), grupo (filtro), tono (borde de la fila) } */
export const TIPOS_EVENTO = Object.freeze({
  venta_iniciada: { etiqueta: 'Venta iniciada', chip: 'neutro', grupo: 'ventas', tono: null },
  articulo: { etiqueta: 'Artículo agregado', chip: 'neutro', grupo: 'articulos', tono: null },
  cantidad: { etiqueta: 'Cantidad cambiada', chip: 'neutro', grupo: 'articulos', tono: null },
  precio: { etiqueta: 'Precio cambiado', chip: 'aviso', grupo: 'cambios', tono: 'aviso' },
  descuento: { etiqueta: 'Descuento', chip: 'aviso', grupo: 'cambios', tono: 'aviso' },
  articulo_anulado: { etiqueta: 'Artículo anulado', chip: 'alerta', grupo: 'anulaciones', tono: 'alerta' },
  autorizacion: { etiqueta: 'Autorización', chip: 'info', grupo: 'cambios', tono: 'info' },
  espera: { etiqueta: 'En espera', chip: 'neutro', grupo: 'ventas', tono: null },
  recuperada: { etiqueta: 'Recuperada', chip: 'neutro', grupo: 'ventas', tono: null },
  venta_cancelada: { etiqueta: 'Venta cancelada', chip: 'alerta', grupo: 'anulaciones', tono: 'alerta' },
  pago: { etiqueta: 'Pago', chip: 'abierto', grupo: 'pagos', tono: 'ok' },
  venta_completada: { etiqueta: 'Venta completada', chip: 'abierto', grupo: 'ventas', tono: 'ok' },
  devolucion_iniciada: { etiqueta: 'Devolución iniciada', chip: 'aviso', grupo: 'devoluciones', tono: null },
  devolucion_completada: { etiqueta: 'Devolución', chip: 'aviso', grupo: 'devoluciones', tono: 'aviso' },
  efectivo: { etiqueta: 'Efectivo', chip: 'info', grupo: 'efectivo', tono: 'info' },
  turno_abierto: { etiqueta: 'Turno abierto', chip: 'info', grupo: 'turnos', tono: 'info' },
  turno_cerrado: { etiqueta: 'Turno cerrado', chip: 'info', grupo: 'turnos', tono: 'info' },
});

/** Opciones del filtro «Tipo» de la página de movimientos. */
export const GRUPOS_EVENTO = Object.freeze([
  ['ventas', 'Ventas'],
  ['articulos', 'Artículos'],
  ['pagos', 'Pagos'],
  ['cambios', 'Precios, descuentos y autorizaciones'],
  ['anulaciones', 'Anulaciones y cancelaciones'],
  ['devoluciones', 'Devoluciones'],
  ['efectivo', 'Efectivo'],
  ['turnos', 'Turnos'],
]);

const DESCONOCIDO = Object.freeze({ etiqueta: 'Movimiento', chip: 'neutro', grupo: null, tono: null });

export function infoEvento(tipo) {
  return TIPOS_EVENTO[tipo] ?? DESCONOCIDO;
}

/** Milisegundos de un Timestamp de Firestore, un Date, un número o un {seconds, nanoseconds}. */
export function milisDeMarca(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return valor;
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  if (typeof valor.seconds === 'number') return valor.seconds * 1000 + Math.floor((valor.nanoseconds ?? 0) / 1e6);
  return null;
}

/** Hora con segundos en formato de 12 horas: { hora: '01:16:13', meridiano: 'p.m.' } (hora local). */
export function horaConSegundos(valor) {
  const milis = milisDeMarca(valor);
  if (milis === null) return { hora: '--:--:--', meridiano: '' };
  const fecha = new Date(milis);
  const h24 = fecha.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const dos = (n) => String(n).padStart(2, '0');
  return { hora: `${dos(h12)}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`, meridiano: h24 < 12 ? 'a.m.' : 'p.m.' };
}

/** El evento cumple los filtros de la página: caja, persona y grupo de tipo ('' = todos). */
export function cumpleFiltros(evento, { caja = '', cajero = '', grupo = '' } = {}) {
  if (caja && evento.caja !== caja) return false;
  if (cajero && evento.cajero !== cajero) return false;
  if (grupo && infoEvento(evento.tipo).grupo !== grupo) return false;
  return true;
}
