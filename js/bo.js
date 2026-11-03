/**
 * Piezas compartidas por las pantallas de ventas del back office (inicio,
 * ventas, turnos, reportes): formatos, fechas locales, descarga de CSV,
 * chips de estado y la ficha de un ticket con su recibo y reimpresión.
 */
import { h } from './dom.js';
import { formatearMonto, formatearPeso, NOMBRE_METODO, claveDia } from './ticket.js';
import { milisDe, formatearDuracion } from './turnos.js';
import { reciboVenta, imprimir, fechaHora } from './recibo.js';
import { aCSV } from './csv.js';

export const dinero = formatearMonto;
export { claveDia, fechaHora, formatearDuracion };

// ------------------------------------------------------------- fechas (hora local de la tienda)

/** "2026-11-02" → Date local a las 00:00. */
export function inicioDia(dia) {
  const [a, m, d] = String(dia).split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** "2026-11-02" + 3 → "2026-11-05". */
export function sumarDias(dia, dias) {
  const fecha = inicioDia(dia);
  fecha.setDate(fecha.getDate() + dias);
  return claveDia(fecha);
}

/** Días de `desde` a `hasta` (ambos incluidos), en orden. */
export function diasEntre(desde, hasta) {
  const dias = [];
  for (let dia = desde; dia <= hasta && dias.length < 400; dia = sumarDias(dia, 1)) dias.push(dia);
  return dias;
}

const formatoLargo = new Intl.DateTimeFormat('es-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const formatoCorto = new Intl.DateTimeFormat('es-CA', { weekday: 'short', day: 'numeric', month: 'short' });

const conMayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** "Lunes, 2 de noviembre de 2026". Acepta Date, Timestamp, milisegundos o "AAAA-MM-DD". */
export function fechaLarga(valor) {
  const fecha = typeof valor === 'string' ? inicioDia(valor) : new Date(milisDe(valor) ?? Date.now());
  return conMayuscula(formatoLargo.format(fecha));
}

/** "Lun., 2 nov." */
export function fechaCorta(valor) {
  const fecha = typeof valor === 'string' ? inicioDia(valor) : new Date(milisDe(valor) ?? Date.now());
  return conMayuscula(formatoCorto.format(fecha));
}

/** "08:02" en hora local. */
export function hora(valor) {
  const ms = milisDe(valor);
  if (ms === null) return '—';
  const f = new Date(ms);
  return `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
}

/** Saludo según la hora del día. */
export function saludo(nombre, ahora = new Date()) {
  const horaDia = ahora.getHours();
  const parte = horaDia < 12 ? 'Buenos días' : horaDia < 19 ? 'Buenas tardes' : 'Buenas noches';
  // Un correo no es un nombre: quien no tiene nombre puesto recibe solo el saludo.
  const primero = String(nombre ?? '').trim().split(/\s+/)[0];
  return primero && !primero.includes('@') ? `${parte}, ${primero}` : parte;
}

// ------------------------------------------------------------- textos y piezas

/** "Efectivo $20.00 + Débito $5.07" (lo cobrado, o lo devuelto en una devolución). */
export function textoPagos(venta) {
  if (!venta.pagos?.length) return '—';
  return venta.pagos.map((p) => {
    const recibio = p.metodo === 'efectivo' && p.recibidoCentavos > Math.abs(p.importeCentavos) ? ` (recibió ${dinero(p.recibidoCentavos)})` : '';
    return `${NOMBRE_METODO[p.metodo] ?? p.metodo} ${dinero(Math.abs(p.importeCentavos))}${recibio}`;
  }).join(' + ');
}

/** Métodos usados, sin montos: "Efectivo + Débito". */
export function metodosDe(venta) {
  const nombres = [...new Set((venta.pagos ?? []).map((p) => NOMBRE_METODO[p.metodo] ?? p.metodo))];
  return nombres.length ? nombres.join(' + ') : '—';
}

/** Chip de estado con punto y texto (el color nunca va solo). */
export function chip(texto, tipo = 'neutro') {
  return h('span', { class: `chip chip--${tipo}`, text: texto });
}

export function mostrarMensaje(elemento, tipo, texto) {
  elemento.textContent = texto ?? '';
  elemento.className = `mensaje mensaje--${tipo}`;
  elemento.hidden = !texto;
}

/** Descarga un CSV (con BOM: Excel lo abre con acentos). */
export function descargarCSV(nombre, filas) {
  const blob = new Blob([aCSV(filas)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = h('a', { href: url, download: nombre });
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Centavos → "12.34" para un CSV (sin signo de pesos ni comas de miles). */
export const csvMonto = (centavos) => (Number.isSafeInteger(centavos) ? (centavos / 100).toFixed(2) : '');

// ------------------------------------------------------------- ficha de un ticket

function filaDato(termino, valor) {
  return [h('dt', { text: termino }), h('dd', null, valor)];
}

/**
 * Ficha de un ticket en un diálogo: datos, líneas, recibo y reimpresión.
 * @param {object} venta documento ventas/{id}
 * @param {{ tienda?: object, config?: object, alVerTurno?: (turnoId: string) => void }} [opciones]
 */
export function abrirTicket(venta, { tienda = null, config = {}, alVerTurno = null } = {}) {
  const devolucion = venta.tipo === 'devolucion';
  const recibo = reciboVenta(venta, { tienda, config });
  recibo.classList.add('recibo--vista');

  const lineas = h('table', { class: 'tabla tabla--compacta' },
    h('thead', null, h('tr', null,
      h('th', { text: 'Artículo' }), h('th', { class: 'num', text: 'Cantidad' }), h('th', { class: 'num', text: 'Precio' }),
      h('th', { class: 'num', text: 'Descuento' }), h('th', { class: 'num', text: 'Importe' }))),
    h('tbody', null, venta.lineas.map((l) => h('tr', null,
      h('td', null, l.nombre, l.presentacion ? h('span', { class: 'secundario', text: l.presentacion }) : null,
        l.precioOriginalCentavos !== null && l.precioOriginalCentavos !== undefined ? h('span', { class: 'secundario', text: `Precio cambiado (era ${dinero(l.precioOriginalCentavos)})` }) : null,
        l.departamento ? h('span', { class: 'secundario', text: 'Venta libre por departamento' }) : null),
      h('td', { class: 'num', text: l.unidad === 'peso' ? formatearPeso(l.pesoGramos) : String(l.cantidad) }),
      h('td', { class: 'num', text: `${dinero(l.precioUnitarioCentavos)}${l.unidad === 'peso' ? '/kg' : ''}` }),
      h('td', { class: 'num', text: l.descuentoCentavos + l.descuentoTicketCentavos ? dinero(-(l.descuentoCentavos + l.descuentoTicketCentavos)) : '' }),
      h('td', { class: 'num', text: `${dinero(l.netoCentavos)}${l.claseFiscal === 'gravado' ? ' T' : ''}` })))));

  const datos = h('dl', { class: 'ficha ficha--compacta' },
    filaDato('Fecha', fechaHora(venta.fecha)),
    filaDato('Caja', `${venta.cajaNombre} · ${venta.tiendaNombre}`),
    filaDato('Atendió', `${venta.cajeroNombre} (${venta.cajero})`),
    filaDato('Total', h('strong', { text: dinero(venta.totalCentavos) })),
    filaDato(devolucion ? 'Reembolso' : 'Pago', textoPagos(venta)),
    venta.cambioCentavos > 0 ? filaDato('Cambio', dinero(venta.cambioCentavos)) : null,
    venta.redondeoCentavos ? filaDato('Redondeo', dinero(venta.redondeoCentavos)) : null,
    venta.autorizadoPor ? filaDato('Autorizó', venta.autorizadoPor) : null,
    venta.ventaOriginal ? filaDato('Ticket original', venta.ventaOriginal) : null,
    venta.lineasAnuladas ? filaDato('Líneas anuladas', `${venta.lineasAnuladas} (${dinero(venta.lineasAnuladasCentavos)})`) : null);

  const botonTurno = alVerTurno ? h('button', { type: 'button', class: 'boton boton--claro', text: 'Ver el turno' }) : null;
  const dialogo = h('dialog', { class: 'editor editor--ticket', 'aria-label': `Ticket ${venta.folio}` },
    h('div', { class: 'editor__form' },
      h('header', { class: 'editor__cabecera' },
        h('h2', null, `Ticket ${venta.folio} `, devolucion ? chip('Devolución', 'alerta') : null),
        h('button', { type: 'button', class: 'boton boton--secundario', 'data-cerrar': '', text: 'Cerrar' })),
      h('div', { class: 'editor__cuerpo editor__cuerpo--ticket' },
        h('div', null, datos, lineas),
        h('div', { class: 'vista-recibo-bo' }, recibo)),
      h('footer', { class: 'editor__pie' },
        h('button', { type: 'button', class: 'boton', 'data-reimprimir': '', text: 'Reimprimir recibo' }),
        botonTurno,
        h('span', { class: 'nota', text: 'La copia sale marcada como COPIA.' }))));
  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]')) dialogo.close();
    else if (e.target.closest('[data-reimprimir]')) imprimir(reciboVenta(venta, { tienda, config, copia: true }));
  });
  botonTurno?.addEventListener('click', () => {
    dialogo.close();
    alVerTurno(venta.turno);
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  document.body.append(dialogo);
  dialogo.showModal();
  return dialogo;
}
