/**
 * Pantalla del cliente: la segunda pantalla de la caja, de cara al cliente.
 *
 * La caja (js/caja.js) le manda lo que tiene que mostrar por un
 * BroadcastChannel: misma computadora, mismo navegador, sin red ni Firestore
 * (es instantáneo, funciona sin conexión y nadie de fuera le puede escribir).
 * La pantalla (caja/cliente.html, js/cliente.js) no inicia sesión ni guarda
 * nada del ticket: solo pinta el último estado que recibió.
 *
 * Este módulo es puro (sin DOM ni Firebase): arma ese estado, ya con los
 * textos y montos formateados, a partir del ticket de la caja. Lo prueban las
 * pruebas unitarias.
 *
 * Mensajes del canal:
 *   caja → pantalla: { tipo: 'estado', estado }   cada vez que algo cambia
 *                    { tipo: 'latido' }           cada LATIDO_MS: la caja sigue abierta
 *                    { tipo: 'adios' }            la caja se cerró o recargó
 *   pantalla → caja: { tipo: 'hola' }             recién abierta: pide el estado actual
 */
import { formatearMonto, formatearPeso, formatearPorcentaje, redondearEfectivo, NOMBRE_METODO } from './ticket.js';

export const CANAL_CLIENTE = 'aguila-pantalla-cliente';
export const LATIDO_MS = 4000;
/** Sin noticias de la caja en este tiempo, la pantalla deja el ticket y da la bienvenida. */
export const SILENCIO_MS = 15000;
/** Tras cobrar, el «gracias» y el cambio se quedan este tiempo y vuelve la bienvenida. */
export const GRACIAS_MS = 25000;
/** Cuántas líneas se mandan (las últimas): en la pantalla no caben más. */
export const MAXIMO_LINEAS = 60;

// Tableta (por internet, js/pantalla-remota.js)
/** La caja agrupa los cambios: como mucho una escritura en Firestore cada tanto. */
export const RETRASO_TABLETA_MS = 350;
/** Mientras no tiene tableta, cada cuánto la caja mira si le emparejaron una (una lectura). */
export const REVISAR_TABLETA_MS = 60 * 1000;
/** En la tableta, un ticket sin cambios en tanto tiempo es de una caja que se quedó así: bienvenida. */
export const ANTIGUEDAD_MAXIMA_MS = 20 * 60 * 1000;

export const FASES = Object.freeze(['cerrada', 'libre', 'venta', 'cobro', 'cobrado']);

const dinero = formatearMonto;

/** "María José López" → "María": el cliente ve solo el primer nombre. */
export function primerNombre(nombre) {
  const primero = String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return primero.includes('@') ? '' : primero.slice(0, 30);
}

function describirDescuento(d) {
  if (!d) return null;
  return d.tipo === 'porcentaje' ? formatearPorcentaje(d.puntosBase) : dinero(d.centavos);
}

/** Una línea del ticket (ya calculada por calcularTicket) como la ve el cliente. */
export function lineaCliente(l) {
  const peso = l.unidad === 'peso';
  return {
    id: l.id,
    nombre: [l.nombre, l.presentacion].filter((t) => typeof t === 'string' && t.trim() !== '').join(' '),
    detalle: peso
      ? `${formatearPeso(l.pesoGramos)} × ${dinero(l.precioUnitarioCentavos)}/kg`
      : `${l.cantidad} × ${dinero(l.precioUnitarioCentavos)}`,
    importe: dinero(l.importeCentavos),
    antes: l.descuentoCentavos > 0 ? dinero(l.importeBrutoCentavos) : null,
    descuento: l.descuentoCentavos > 0 ? `Descuento ${describirDescuento(l.descuento) ?? ''}`.trim() : null,
    negativa: (l.cantidad ?? 0) < 0 || (l.pesoGramos ?? 0) < 0,
  };
}

/** Totales del ticket para el cliente (y el total en efectivo si el redondeo a 5 ¢ lo cambia). */
function totales(calculo, config, ticket) {
  const efectivo = redondearEfectivo(calculo.totalCentavos);
  return {
    articulos: Math.abs(calculo.articulos),
    subtotal: dinero(calculo.subtotalCentavos),
    descuento: calculo.descuentoTicketCentavos > 0
      ? `${dinero(-calculo.descuentoTicketCentavos)}${ticket?.descuentoTicket?.tipo === 'porcentaje' ? ` (${formatearPorcentaje(ticket.descuentoTicket.puntosBase)})` : ''}`
      : null,
    ahorro: calculo.descuentoLineasCentavos + calculo.descuentoTicketCentavos > 0
      ? dinero(calculo.descuentoLineasCentavos + calculo.descuentoTicketCentavos)
      : null,
    impuestoNombre: `${config.impuestoNombre} ${formatearPorcentaje(config.tasaImpuestoBP)}`,
    impuesto: dinero(calculo.impuestoCentavos),
    total: dinero(calculo.totalCentavos),
    totalEfectivo: efectivo !== calculo.totalCentavos ? dinero(efectivo) : null,
  };
}

/**
 * Estado que se manda a la pantalla del cliente.
 * @param {object} datos
 * @param {'cerrada'|'libre'|'venta'|'cobro'|'cobrado'} datos.fase
 *   cerrada: la caja no está vendiendo (sin turno abierto) · libre: lista, sin
 *   ticket · venta: ticket en curso · cobro: el diálogo de cobro está abierto ·
 *   cobrado: venta (o devolución) recién registrada.
 * @param {string} [datos.tienda] nombre de la tienda · [datos.caja] nombre de la caja
 * @param {string} [datos.atiende] nombre de quien atiende (se manda solo el primero)
 * @param {object} datos.config configuración del POS (impuesto y mensaje del recibo)
 * @param {object} [datos.ticket] ticket de la caja · [datos.calculo] calcularTicket(ticket)
 * @param {string} [datos.ultima] id de la última línea agregada o cambiada
 * @param {object} [datos.cobro] { totalCentavos, pagos, metodo, pendienteCentavos, pendienteEfectivoCentavos }
 * @param {object} [datos.venta] la venta registrada (fase cobrado)
 */
export function estadoCliente({ fase, tienda = '', caja = '', atiende = null, config, ticket = null, calculo = null, ultima = null, cobro = null, venta = null }) {
  if (!FASES.includes(fase)) throw new Error(`Fase desconocida: ${fase}`);
  const base = {
    v: 1,
    fase,
    tienda: String(tienda ?? '').slice(0, 80),
    caja: String(caja ?? '').slice(0, 40),
    atiende: fase === 'cerrada' ? '' : primerNombre(atiende),
    mensaje: String(config?.reciboPie ?? '').split('\n')[0].trim().slice(0, 120) || '¡Gracias por su compra!',
  };
  if (fase === 'cerrada' || fase === 'libre') return base;

  if (fase === 'cobrado') {
    if (!venta) throw new Error('Falta la venta registrada');
    const devolucion = venta.tipo === 'devolucion';
    return {
      ...base,
      devolucion,
      folio: venta.folio,
      articulos: Math.abs(venta.articulos),
      total: dinero(Math.abs(venta.totalCentavos + (venta.redondeoCentavos ?? 0))),
      pagos: (venta.pagos ?? []).map((p) => ({
        metodo: NOMBRE_METODO[p.metodo] ?? p.metodo,
        importe: dinero(Math.abs(p.recibidoCentavos ?? p.importeCentavos)),
      })),
      cambio: venta.cambioCentavos > 0 ? dinero(venta.cambioCentavos) : null,
      ahorro: (venta.descuentoLineasCentavos ?? 0) + (venta.descuentoTicketCentavos ?? 0) > 0
        ? dinero(venta.descuentoLineasCentavos + venta.descuentoTicketCentavos)
        : null,
    };
  }

  if (!ticket || !calculo) throw new Error('Falta el ticket');
  const devolucion = ticket.modo === 'devolucion';
  const lineas = calculo.lineas.slice(-MAXIMO_LINEAS).map(lineaCliente);
  const destacada = calculo.lineas.find((l) => l.id === ultima) ?? calculo.lineas.at(-1) ?? null;
  const estado = {
    ...base,
    devolucion,
    lineas,
    ocultas: Math.max(0, calculo.lineas.length - MAXIMO_LINEAS),
    ultima: destacada ? lineaCliente(destacada) : null,
    ...totales(calculo, config, ticket),
  };
  if (fase === 'cobro' && cobro) {
    const efectivo = cobro.metodo === 'efectivo';
    const pagado = (cobro.pagos ?? []).reduce((suma, p) => suma + Math.abs(p.importeCentavos), 0);
    estado.cobro = {
      metodo: NOMBRE_METODO[cobro.metodo] ?? cobro.metodo,
      tarjeta: cobro.metodo === 'debito' || cobro.metodo === 'credito',
      pagado: dinero(pagado),
      falta: dinero(Math.abs(efectivo ? cobro.pendienteEfectivoCentavos : cobro.pendienteCentavos)),
      pagos: (cobro.pagos ?? []).map((p) => ({
        metodo: NOMBRE_METODO[p.metodo] ?? p.metodo,
        importe: dinero(Math.abs(p.recibidoCentavos ?? p.importeCentavos)),
      })),
    };
  } else if (fase === 'cobro') {
    estado.fase = 'venta';
  }
  return estado;
}

/** ¿El mensaje que llega por el canal tiene forma de estado? (la pantalla descarta lo demás) */
export function esEstadoValido(estado) {
  return !!estado && typeof estado === 'object' && estado.v === 1 && FASES.includes(estado.fase)
    && (estado.fase === 'cerrada' || estado.fase === 'libre' || estado.fase === 'cobrado' || Array.isArray(estado.lineas));
}
