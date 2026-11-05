/**
 * Movimientos en vivo (eventos/): nombres, colores y agrupación de cada tipo,
 * la hora con segundos y el texto de cada movimiento en el idioma elegido.
 * Módulo puro (sin Firebase ni DOM): lo usan la página de movimientos y el
 * historial de auditoría de las transacciones, y se prueba en Node. Los
 * tipos son los mismos que aceptan las reglas.
 *
 * Texto: la caja lo guarda siempre en español, con una de las PLANTILLAS_EVENTO
 * (así el registro es uno solo, venda la caja en el idioma que venda). Para
 * mostrarlo en inglés, textoEvento() reconoce la plantilla, toma sus valores
 * (traduciendo los que son palabras: formas de pago, movimientos de efectivo,
 * detalles de una autorización) y arma el texto con la plantilla en inglés.
 */
import { t, enIngles, traducirTexto, hora12 } from './idioma.js';
import { nombreMetodo, METODOS_PAGO, NOMBRE_METODO } from './ticket.js';
import { NOMBRE_MOVIMIENTO } from './turnos.js';

const tipo = (etiqueta, chip, grupo, tono) => Object.freeze({ etiqueta, chip, grupo, tono });

/** tipo → { etiqueta, chip (clase chip--*), grupo (filtro), tono (borde de la fila) } */
export const TIPOS_EVENTO = Object.freeze({
  venta_iniciada: tipo(t('Venta iniciada'), 'neutro', 'ventas', null),
  articulo: tipo(t('Artículo agregado'), 'neutro', 'articulos', null),
  cantidad: tipo(t('Cantidad cambiada'), 'neutro', 'articulos', null),
  precio: tipo(t('Precio cambiado'), 'aviso', 'cambios', 'aviso'),
  descuento: tipo(t('Descuento'), 'aviso', 'cambios', 'aviso'),
  articulo_anulado: tipo(t('Artículo anulado'), 'alerta', 'anulaciones', 'alerta'),
  autorizacion: tipo(t('Autorización'), 'info', 'cambios', 'info'),
  espera: tipo(t('En espera'), 'neutro', 'ventas', null),
  recuperada: tipo(t('Recuperada'), 'neutro', 'ventas', null),
  venta_cancelada: tipo(t('Venta cancelada'), 'alerta', 'anulaciones', 'alerta'),
  pago: tipo(t('Pago'), 'abierto', 'pagos', 'ok'),
  venta_completada: tipo(t('Venta completada'), 'abierto', 'ventas', 'ok'),
  devolucion_iniciada: tipo(t('Devolución iniciada'), 'aviso', 'devoluciones', null),
  devolucion_completada: tipo(t('Devolución'), 'aviso', 'devoluciones', 'aviso'),
  efectivo: tipo(t('Efectivo'), 'info', 'efectivo', 'info'),
  turno_abierto: tipo(t('Turno abierto'), 'info', 'turnos', 'info'),
  turno_cerrado: tipo(t('Turno cerrado'), 'info', 'turnos', 'info'),
});

/** Opciones del filtro «Tipo» de la página de movimientos. */
export const GRUPOS_EVENTO = Object.freeze([
  ['ventas', t('Ventas')],
  ['articulos', t('Artículos')],
  ['pagos', t('Pagos')],
  ['cambios', t('Precios, descuentos y autorizaciones')],
  ['anulaciones', t('Anulaciones y cancelaciones')],
  ['devoluciones', t('Devoluciones')],
  ['efectivo', t('Efectivo')],
  ['turnos', t('Turnos')],
]);

const DESCONOCIDO = Object.freeze({ etiqueta: t('Movimiento'), chip: 'neutro', grupo: null, tono: null });

export function infoEvento(tipoEvento) {
  return TIPOS_EVENTO[tipoEvento] ?? DESCONOCIDO;
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

/** Hora con segundos en formato de 12 horas: { hora: '01:16:13', meridiano: 'p.m.' } (hora local; 'PM' en inglés). */
export function horaConSegundos(valor) {
  const milis = milisDeMarca(valor);
  if (milis === null) return { hora: '--:--:--', meridiano: '' };
  const [hora, meridiano] = hora12(new Date(milis), { segundos: true }).split(' ');
  return { hora, meridiano };
}

/** El evento cumple los filtros de la página: caja, persona y grupo de tipo ('' = todos). */
export function cumpleFiltros(evento, { caja = '', cajero = '', grupo = '' } = {}) {
  if (caja && evento.caja !== caja) return false;
  if (cajero && evento.cajero !== cajero) return false;
  if (grupo && infoEvento(evento.tipo).grupo !== grupo) return false;
  return true;
}

// ------------------------------------------------------------- texto de cada movimiento

/**
 * Plantillas (en español) del texto que guarda la caja, de la más específica a
 * la más general. Las de autorización y de «en espera» se usan también como
 * {detalle} y {resumen} de otras. La caja las escribe con tEs() (js/caja.js) y
 * cada una tiene su traducción en js/i18n/en-comun.js. La última es el motivo
 * que la caja guarda en un ticket cancelado (movimientos de efectivo): el back
 * office lo muestra con traducirTextoEvento() también.
 */
// i18n:sin-revisar-inicio (plantillas que se guardan en español; su inglés está en en-comun.js)
export const PLANTILLAS_EVENTO = Object.freeze([
  'Turno abierto con {fondo} de fondo',
  'Turno de {cajera} cerrado por {quien} — vendido {vendido}, contado {contado}, diferencia {diferencia}',
  'Turno cerrado — vendido {vendido}, contado {contado}, diferencia {diferencia}',
  'Venta iniciada en {caja}',
  'Ahora {articulo} — {importe}',
  '{nombre}: precio tecleado corregido de {antes} a {nuevo}',
  '{nombre}: {antes} → {nuevo} (catálogo {original})',
  'Se quitó el descuento a todo el ticket',
  'Se quitó el descuento de {nombre}',
  'Descuento de {descuento} a todo el ticket',
  'Descuento de {descuento} a {nombre}',
  '{admin} autorizó: {detalle}',
  'Venta libre de {importe} en {nombre} (más de {limite})',
  'Cambio de precio: {nombre} {antes} → {nuevo}',
  'Devolución del ticket {folio}',
  'Devolución sin recibo',
  'Ticket en espera — {resumen}',
  'Ticket recuperado — {resumen}',
  '{articulos} artículo(s) · {total} · devolución',
  '{articulos} artículo(s) · {total}',
  'Ticket en espera cancelado al cerrar el turno — {importe}',
  'Venta cancelada — {total} ({articulos} artículos)',
  'Reembolso en {metodo} {importe} de {folio}',
  '{metodo} {monto} en {folio} (saldo {saldo})',
  'Devolución {folio} — {total} ({articulos} artículos, reembolso {metodos}), del ticket {original}',
  'Devolución {folio} — {total} ({articulos} artículos, reembolso {metodos})',
  'Venta {folio} completada — {total} ({articulos} artículos, {metodos}), cambio {cambio}',
  'Venta {folio} completada — {total} ({articulos} artículos, {metodos})',
  'Apertura de cajón sin venta — {motivo}',
  'Apertura de cajón sin venta',
  '{movimiento} de {importe} — {motivo}',
  '{movimiento} de {importe}',
  '{articulos} artículo(s)',
]);
// i18n:sin-revisar-fin

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Valores de vocabulario cerrado: se reconocen tal cual (así «Retiro de efectivo de $20.00» no se corta en el primer «de»). */
const VOCABULARIO = {
  movimiento: Object.values(NOMBRE_MOVIMIENTO),
  metodo: Object.values(NOMBRE_METODO).flatMap((n) => [n, n.toLowerCase()]),
};
const COMPILADAS = PLANTILLAS_EVENTO.map((plantilla) => {
  const claves = [];
  const patron = plantilla.split(/(\{\w+\})/).map((parte) => {
    const m = /^\{(\w+)\}$/.exec(parte);
    if (!m) return escapar(parte);
    claves.push(m[1]);
    const opciones = VOCABULARIO[m[1]];
    return `(?<${m[1]}>${opciones ? opciones.map(escapar).join('|') : '.+?'})`;
  }).join('');
  return { plantilla, claves, re: new RegExp(`^${patron}$`, 's') };
});

/** «Efectivo» o «efectivo» → la forma de pago en el idioma elegido (con la misma mayúscula); null si no es una. */
function traducirMetodo(texto) {
  const codigo = METODOS_PAGO.find((m) => NOMBRE_METODO[m].toLowerCase() === texto.toLowerCase());
  if (!codigo) return null;
  const nombre = nombreMetodo(codigo);
  return texto[0] === texto[0].toLowerCase() ? nombre.toLowerCase() : nombre;
}

/** Los valores que son palabras se traducen; si no se reconocen, la plantilla no era esa. */
const TRADUCIR_VALOR = {
  metodo: traducirMetodo,
  metodos: (texto) => {
    if (texto === 'sin pago') return t('sin pago');
    const partes = texto.split(' + ').map(traducirMetodo);
    return partes.includes(null) ? null : partes.join(' + ');
  },
  movimiento: (texto) => (Object.values(NOMBRE_MOVIMIENTO).includes(texto) ? traducirTexto(texto) : null),
  descuento: (texto) => texto.replace(/(\d) %$/, '$1%'), // «10 %» → «10%»
  detalle: (texto, nivel) => traducirTextoEvento(texto, nivel + 1),
  resumen: (texto, nivel) => traducirTextoEvento(texto, nivel + 1),
};

/** Texto de un movimiento (guardado en español) en el idioma elegido. Lo que no se reconoce queda tal cual. */
export function traducirTextoEvento(texto, nivel = 0) {
  if (!enIngles() || typeof texto !== 'string' || !texto || nivel > 2) return texto;
  const exacta = traducirTexto(texto);
  if (exacta !== texto) return exacta;
  for (const { plantilla, claves, re } of COMPILADAS) {
    const m = re.exec(texto);
    if (!m) continue;
    const valores = {};
    let vale = true;
    for (const clave of claves) {
      const traducir = TRADUCIR_VALOR[clave];
      const valor = traducir ? traducir(m.groups[clave], nivel) : m.groups[clave];
      if (valor === null) {
        vale = false;
        break;
      }
      valores[clave] = valor;
    }
    if (!vale) continue;
    // Con un solo artículo, la forma en singular si la hay («1 item», no «1 items»).
    const formaSingular = `${plantilla}#1`;
    const singular = valores.articulos === '1' && traducirTexto(formaSingular) !== formaSingular;
    return t(singular ? formaSingular : plantilla, valores);
  }
  return texto;
}

/** Texto para mostrar de un evento (o de su campo texto). */
export const textoEvento = (evento) => traducirTextoEvento(evento?.texto ?? '');
