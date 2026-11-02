/**
 * Recibos y comprobantes de la caja para la impresora térmica (rollo de 80 mm
 * o 58 mm), impresos SOLO con el diálogo de impresión del navegador y
 * @media print (ver css/recibo.css). Con Chrome en --kiosk-printing salen sin
 * diálogo, y el controlador de la impresora abre el cajón al imprimir.
 *
 * Construye el DOM de: recibo de venta o devolución, corte de turno (X / Z),
 * comprobante de movimiento de efectivo y apertura de turno.
 */
import { formatearMonto, formatearPeso, formatearPorcentaje, NOMBRE_METODO, METODOS_PAGO, digitosFolio } from './ticket.js';
import { svgCode128C } from './code128.js';
import { formatearDuracion, milisDe, NOMBRE_MOVIMIENTO, ventasNetas } from './turnos.js';

const formatoFecha = new Intl.DateTimeFormat('es-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** "2026-11-02 14:32" en hora local. */
export function fechaHora(valor) {
  const ms = milisDe(valor);
  if (ms === null) return '—';
  const partes = Object.fromEntries(formatoFecha.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour === '24' ? '00' : partes.hour}:${partes.minute}`;
}

/** Monto sin el signo de pesos, para las columnas del recibo: 998 → "9.98", −100 → "-1.00". */
const importe = (centavos) => formatearMonto(centavos).replace('$', '');

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  return nodo;
}

function fila(izquierda, derecha, clase = '') {
  const f = el('div', `recibo__fila${clase ? ` ${clase}` : ''}`);
  f.append(el('span', 'recibo__izq', izquierda), el('span', 'recibo__der', derecha));
  return f;
}

const separador = (doble = false) => el('div', doble ? 'recibo__sep recibo__sep--doble' : 'recibo__sep');

/** Nombre, dirección, teléfono, correo y número de impuesto de la tienda. */
export function encabezadoTienda(tienda, impuestoNombre = 'HST') {
  const bloque = el('header', 'recibo__encabezado');
  bloque.append(el('div', 'recibo__tienda', tienda?.nombre || 'Águila Marketplace'));
  if (tienda?.direccion) bloque.append(el('div', '', tienda.direccion));
  const contacto = [tienda?.telefono ? `Tel. ${tienda.telefono}` : '', tienda?.correo ?? ''].filter(Boolean);
  for (const linea of contacto) bloque.append(el('div', '', linea));
  if (tienda?.numeroImpuesto) bloque.append(el('div', '', `${impuestoNombre} # ${tienda.numeroImpuesto}`));
  return bloque;
}

function contenedor(papel, clase) {
  const nodo = el('article', `recibo ${clase}`);
  nodo.dataset.papel = String(papel ?? 80);
  return nodo;
}

/**
 * Recibo de una venta o devolución (documento ventas/{id}).
 * @param {object} venta
 * @param {{ tienda?: object, config?: object, copia?: boolean }} [opciones]
 */
export function reciboVenta(venta, { tienda = null, config = {}, copia = false } = {}) {
  const impuestoNombre = config.impuestoNombre ?? 'HST';
  const devolucion = venta.tipo === 'devolucion';
  const r = contenedor(config.papelRecibo, 'recibo--venta');
  r.dataset.folio = venta.folio;
  r.append(encabezadoTienda(tienda ?? { nombre: venta.tiendaNombre }, impuestoNombre));
  if (copia) r.append(el('div', 'recibo__marca', '*** COPIA ***'));
  if (devolucion) r.append(el('div', 'recibo__marca recibo__marca--fuerte', 'DEVOLUCIÓN'));
  r.append(separador());
  r.append(fila(`Ticket ${String(venta.numero).padStart(4, '0')}`, fechaHora(venta.fecha)));
  r.append(fila(`${venta.cajaNombre}`, `Atendió: ${venta.cajeroNombre}`, 'recibo__fila--suave'));
  if (devolucion && venta.ventaOriginal) r.append(fila('Ticket original', venta.ventaOriginal, 'recibo__fila--suave'));
  r.append(separador());

  const lineas = el('div', 'recibo__lineas');
  for (const l of venta.lineas) {
    const bloque = el('div', 'recibo__linea');
    const nombre = [l.nombre, l.presentacion].filter(Boolean).join(' ');
    bloque.append(el('div', 'recibo__desc', nombre));
    const detalle = l.unidad === 'peso'
      ? `${formatearPeso(l.pesoGramos)} × ${importe(l.precioUnitarioCentavos)}/kg`
      : `${l.cantidad} × ${importe(l.precioUnitarioCentavos)}`;
    const montoLinea = l.importeCentavos + l.descuentoCentavos;
    bloque.append(fila(detalle, `${importe(montoLinea)} ${l.claseFiscal === 'gravado' ? 'T' : ' '}`, 'recibo__fila--linea'));
    if (l.precioOriginalCentavos !== null && l.precioOriginalCentavos !== undefined) {
      bloque.append(fila(`  Precio cambiado (era ${importe(l.precioOriginalCentavos)})`, '', 'recibo__fila--nota'));
    }
    if (l.descuentoCentavos > 0) bloque.append(fila('  Descuento', `-${importe(l.descuentoCentavos)}  `, 'recibo__fila--nota'));
    lineas.append(bloque);
  }
  r.append(lineas);
  r.append(separador());

  const articulos = Math.abs(venta.articulos);
  r.append(fila(`Artículos: ${articulos}`, ''));
  r.append(fila('Subtotal', importe(venta.subtotalCentavos)));
  if (venta.descuentoTicketCentavos > 0) r.append(fila('Descuento al ticket', `-${importe(venta.descuentoTicketCentavos)}`));
  const tasa = formatearPorcentaje(venta.tasaImpuestoBP).replace(' ', '');
  r.append(fila(`${impuestoNombre} ${tasa} sobre ${importe(venta.baseGravadaCentavos)}`, importe(venta.impuestoCentavos)));
  r.append(fila(devolucion ? 'TOTAL DEVUELTO' : 'TOTAL', formatearMonto(devolucion ? -venta.totalCentavos : venta.totalCentavos), 'recibo__fila--total'));
  r.append(separador());

  for (const p of venta.pagos) {
    const nombre = NOMBRE_METODO[p.metodo] ?? p.metodo;
    if (p.metodo === 'efectivo' && p.recibidoCentavos !== null && p.recibidoCentavos !== undefined) {
      r.append(fila(`${nombre} recibido`, importe(p.recibidoCentavos)));
    } else {
      r.append(fila(devolucion ? `Reembolso · ${nombre}` : nombre, importe(Math.abs(p.importeCentavos))));
    }
  }
  if (venta.redondeoCentavos !== 0) r.append(fila('Redondeo del efectivo', importe(venta.redondeoCentavos)));
  if (venta.cambioCentavos > 0) r.append(fila('CAMBIO', formatearMonto(venta.cambioCentavos), 'recibo__fila--cambio'));
  if (venta.autorizadoPor) r.append(fila('Autorizó', venta.autorizadoPor, 'recibo__fila--suave'));
  r.append(separador());
  r.append(el('div', 'recibo__leyenda', `T = con ${impuestoNombre}`));
  if (config.reciboPie) r.append(el('div', 'recibo__pie', config.reciboPie));
  const codigo = el('div', 'recibo__codigo');
  codigo.append(svgCode128C(digitosFolio(venta.folio)), el('div', 'recibo__folio', venta.folio));
  r.append(codigo);
  return r;
}

/**
 * Corte de turno: X (parcial, el turno sigue abierto) o Z (cierre).
 * @param {object} turno documento del turno
 * @param {object} resumen resultado de resumirTurno
 * @param {{ tienda?: object, config?: object, tipo?: 'X'|'Z', contadoCentavos?: number|null }} [opciones]
 */
export function reciboTurno(turno, resumen, { tienda = null, config = {}, tipo = 'Z', contadoCentavos = null, ahora = Date.now(), ocultarEfectivo = false } = {}) {
  const r = contenedor(config.papelRecibo, 'recibo--turno');
  r.append(encabezadoTienda(tienda ?? { nombre: turno.tiendaNombre }, config.impuestoNombre ?? 'HST'));
  r.append(el('div', 'recibo__titulo', tipo === 'Z' ? 'CIERRE DE TURNO (Z)' : 'CORTE PARCIAL (X)'));
  if (turno.cierreForzado) r.append(el('div', 'recibo__marca', `Cerrado por ${turno.cerradoPor}`));
  r.append(fila(turno.cajaNombre, `${turno.cajeroNombre}`));
  r.append(fila('Código', String(turno.cajero), 'recibo__fila--suave'));
  r.append(fila('Apertura', fechaHora(turno.abiertoEn)));
  r.append(fila(tipo === 'Z' ? 'Cierre' : 'Corte', fechaHora(turno.cerradoEn ?? ahora)));
  r.append(fila('Horas en caja', formatearDuracion(resumen.minutos), 'recibo__fila--fuerte'));
  r.append(separador());

  r.append(fila('Ventas (tickets)', String(resumen.ventas)));
  r.append(fila('Devoluciones', String(resumen.devoluciones)));
  r.append(fila('Artículos', String(resumen.articulos)));
  r.append(fila('Ventas brutas', importe(resumen.brutoVentasCentavos)));
  r.append(fila('Descuentos', resumen.descuentosCentavos ? `-${importe(resumen.descuentosCentavos)}` : importe(0)));
  if (resumen.devoluciones) r.append(fila('Devoluciones', `-${importe(resumen.devolucionesSinImpuestoCentavos)}`));
  r.append(fila('Ventas netas (sin imp.)', importe(ventasNetas(resumen))));
  r.append(fila(`  Con ${config.impuestoNombre ?? 'HST'}`, importe(resumen.baseGravadaCentavos), 'recibo__fila--suave'));
  r.append(fila('  Tasa cero', importe(resumen.baseTasaCeroCentavos), 'recibo__fila--suave'));
  r.append(fila(config.impuestoNombre ?? 'HST', importe(resumen.impuestoCentavos)));
  r.append(fila('TOTAL', formatearMonto(resumen.totalCentavos), 'recibo__fila--total'));
  r.append(separador());

  r.append(el('div', 'recibo__subtitulo', 'FORMAS DE PAGO'));
  for (const m of METODOS_PAGO) r.append(fila(NOMBRE_METODO[m], importe(resumen.porMetodo[m] ?? 0)));
  if (resumen.redondeoCentavos !== 0) r.append(fila('  Redondeo del efectivo', importe(resumen.redondeoCentavos), 'recibo__fila--suave'));
  r.append(separador());

  if (!ocultarEfectivo) {
    const e = resumen.efectivo;
    r.append(el('div', 'recibo__subtitulo', 'EFECTIVO EN CAJA'));
    r.append(fila('Fondo inicial', importe(e.fondoCentavos)));
    r.append(fila('+ Ventas en efectivo', importe(e.ventasCentavos)));
    if (e.devolucionesCentavos) r.append(fila('- Devoluciones en efectivo', importe(e.devolucionesCentavos)));
    if (e.retirosCentavos) r.append(fila('- Retiros', importe(e.retirosCentavos)));
    if (e.entradasCentavos) r.append(fila('+ Entradas', importe(e.entradasCentavos)));
    if (e.pagosCentavos) r.append(fila('- Pagos desde caja', importe(e.pagosCentavos)));
    r.append(fila('= Esperado', importe(e.esperadoCentavos), 'recibo__fila--fuerte'));
    const contado = contadoCentavos ?? turno.efectivoContadoCentavos ?? null;
    if (contado !== null && contado !== undefined) {
      const diferencia = contado - e.esperadoCentavos;
      r.append(fila('Contado', importe(contado), 'recibo__fila--fuerte'));
      const nombre = diferencia === 0 ? 'Diferencia (cuadra)' : diferencia > 0 ? 'Diferencia (sobrante)' : 'Diferencia (faltante)';
      r.append(fila(nombre, importe(diferencia), `recibo__fila--fuerte${diferencia !== 0 ? ' recibo__fila--alerta' : ''}`));
    }
    r.append(separador());
  }

  r.append(fila('Líneas anuladas', `${resumen.lineasAnuladas} (${importe(resumen.lineasAnuladasCentavos)})`));
  r.append(fila('Tickets cancelados', `${resumen.cancelaciones} (${importe(resumen.cancelacionesCentavos)})`));
  r.append(fila('Aperturas de cajón', String(resumen.aperturasCajon)));
  r.append(fila('Ventas con autorización', String(resumen.autorizadas)));
  if (resumen.primerFolio) {
    r.append(fila('Primer ticket', resumen.primerFolio, 'recibo__fila--suave'));
    r.append(fila('Último ticket', resumen.ultimoFolio, 'recibo__fila--suave'));
  }
  const deptos = Object.values(resumen.porDepartamento ?? {});
  if (deptos.length) {
    r.append(separador());
    r.append(el('div', 'recibo__subtitulo', 'VENTA LIBRE POR DEPARTAMENTO'));
    for (const d of deptos.sort((a, b) => b.netoCentavos - a.netoCentavos)) r.append(fila(d.nombre, importe(d.netoCentavos)));
  }
  r.append(separador(true));
  r.append(el('div', 'recibo__firma', 'Firma de quien entrega'));
  r.append(el('div', 'recibo__firma', 'Firma de quien recibe'));
  r.append(el('div', 'recibo__pie recibo__pie--chico', `Impreso ${fechaHora(ahora)}`));
  return r;
}

/** Comprobante de retiro, entrada, pago desde caja o apertura de cajón. */
export function comprobanteMovimiento(movimiento, { tienda = null, config = {}, turno = null } = {}) {
  const r = contenedor(config.papelRecibo, 'recibo--movimiento');
  r.append(encabezadoTienda(tienda, config.impuestoNombre ?? 'HST'));
  r.append(el('div', 'recibo__titulo', (NOMBRE_MOVIMIENTO[movimiento.tipo] ?? movimiento.tipo).toUpperCase()));
  r.append(fila(turno?.cajaNombre ?? '', fechaHora(movimiento.fecha)));
  r.append(fila('Cajera', movimiento.cajeroNombre));
  if (movimiento.tipo !== 'apertura') r.append(fila('IMPORTE', formatearMonto(movimiento.importeCentavos), 'recibo__fila--total'));
  if (movimiento.motivo) r.append(el('div', 'recibo__nota', `Motivo: ${movimiento.motivo}`));
  if (movimiento.tipo !== 'apertura') {
    r.append(separador(true));
    r.append(el('div', 'recibo__firma', 'Firma'));
  }
  return r;
}

/** Comprobante de apertura de turno, con el fondo que entra al cajón. */
export function comprobanteApertura(turno, { tienda = null, config = {} } = {}) {
  const r = contenedor(config.papelRecibo, 'recibo--movimiento');
  r.append(encabezadoTienda(tienda ?? { nombre: turno.tiendaNombre }, config.impuestoNombre ?? 'HST'));
  r.append(el('div', 'recibo__titulo', 'APERTURA DE TURNO'));
  r.append(fila(turno.cajaNombre, fechaHora(turno.abiertoEn ?? Date.now())));
  r.append(fila('Cajera', `${turno.cajeroNombre} (${turno.cajero})`));
  r.append(fila('FONDO INICIAL', formatearMonto(turno.fondoInicialCentavos), 'recibo__fila--total'));
  return r;
}

/**
 * Imprime un comprobante con el diálogo del navegador (o directo con
 * --kiosk-printing). Solo se imprime #zona-impresion (ver css/recibo.css).
 * @param {HTMLElement|HTMLElement[]} nodos uno o varios comprobantes (cada uno en su hoja)
 */
export function imprimir(nodos) {
  let zona = document.getElementById('zona-impresion');
  if (!zona) {
    zona = el('div');
    zona.id = 'zona-impresion';
    document.body.append(zona);
  }
  zona.replaceChildren(...[].concat(nodos));
  document.body.classList.add('imprimiendo');
  try {
    window.print();
  } finally {
    // Chrome bloquea el hilo mientras imprime: al volver ya se puede limpiar.
    setTimeout(() => {
      document.body.classList.remove('imprimiendo');
    }, 0);
  }
}
