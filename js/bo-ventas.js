/**
 * Back office · Ventas: el diario de tickets de un día, de todas las cajas,
 * en vivo. Filtros por caja, persona, tipo y forma de pago; búsqueda de un
 * ticket por su folio (también escaneando el código del recibo, de cualquier
 * día); ficha del ticket con reimpresión; exportación a CSV.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarVentasDelDia, buscarVentasPorFolio, observarConfigPos } from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { METODOS_PAGO, folioDesdeTexto } from './ticket.js';
import { milisDe } from './turnos.js';
import { configConDefectos } from './config-pos.js';
import { dinero, claveDia, sumarDias, fechaLarga, hora, metodosDe, chip, abrirTicket, descargarCSV, csvMonto, mostrarMensaje, fechaHora } from './bo.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'ventas.html' });

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(window.location.search);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;

let dia = REGEX_DIA.test(parametros.get('dia') ?? '') ? parametros.get('dia') : claveDia();
let ventas = [];
let tiendas = new Map();
let config = configConDefectos(null);
let dejar = null;

$('f-dia').value = dia;
$('f-caja').value = '';
$('contenido').hidden = false;

const filtros = () => ({
  caja: $('f-caja').value,
  cajero: $('f-cajero').value,
  tipo: $('f-tipo').value,
  pago: $('f-pago').value,
  folio: $('f-folio').value.trim(),
});

function cumple(v, f) {
  if (f.caja && v.caja !== f.caja) return false;
  if (f.cajero && v.cajero !== f.cajero) return false;
  if (f.tipo === 'venta' && v.tipo !== 'venta') return false;
  if (f.tipo === 'devolucion' && v.tipo !== 'devolucion') return false;
  if (f.tipo === 'autorizada' && !v.autorizacion) return false;
  if (f.tipo === 'descuento' && !(v.descuentoLineasCentavos + v.descuentoTicketCentavos > 0)) return false;
  if (f.pago && !(v.pagos ?? []).some((p) => p.metodo === f.pago)) return false;
  if (f.folio && !v.folio.replace(/-/g, '').includes(f.folio.replace(/-/g, ''))) return false;
  return true;
}

/** Opciones de un <select> a partir de las ventas del día, conservando la elegida. */
function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

function pintar() {
  const cajas = new Map(ventas.map((v) => [v.caja, v.cajaNombre]));
  const personas = new Map(ventas.map((v) => [v.cajero, v.cajeroNombre]));
  llenarSelect($('f-caja'), [...cajas].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), 'Todas');
  llenarSelect($('f-cajero'), [...personas].sort((a, b) => a[1].localeCompare(b[1], 'es')), 'Todas las personas');
  if (parametros.get('caja') && !$('f-caja').value && cajas.has(parametros.get('caja'))) $('f-caja').value = parametros.get('caja');

  const f = filtros();
  const lista = ventas.filter((v) => cumple(v, f)).sort((a, b) => (milisDe(b.fecha) ?? 0) - (milisDe(a.fecha) ?? 0));

  let total = 0;
  let tickets = 0;
  let devoluciones = 0;
  let devuelto = 0;
  let descuentos = 0;
  let impuesto = 0;
  let articulos = 0;
  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  for (const v of lista) {
    total += v.totalCentavos;
    impuesto += v.impuestoCentavos;
    descuentos += v.descuentoLineasCentavos + v.descuentoTicketCentavos;
    if (v.tipo === 'devolucion') {
      devoluciones += 1;
      devuelto += -v.totalCentavos;
    } else {
      tickets += 1;
      articulos += v.articulos;
    }
    for (const m of METODOS_PAGO) porMetodo[m] += v.porMetodo?.[m] ?? 0;
  }
  const tarjetas = porMetodo.debito + porMetodo.credito + porMetodo.otro;
  $('k-total').textContent = dinero(total);
  $('k-total-detalle').textContent = descuentos ? `Descuentos: ${dinero(descuentos)}` : 'Con impuesto';
  $('k-tickets').textContent = String(tickets);
  $('k-tickets-detalle').textContent = devoluciones ? `${devoluciones} devolución(es) · ${dinero(devuelto)}` : `${articulos} artículos`;
  $('k-efectivo').textContent = dinero(porMetodo.efectivo);
  $('k-efectivo-detalle').textContent = 'Neto de devoluciones';
  $('k-tarjetas').textContent = dinero(tarjetas);
  $('k-tarjetas-detalle').textContent = `Débito ${dinero(porMetodo.debito)} · Crédito ${dinero(porMetodo.credito)}`;
  $('k-impuesto-etiqueta').textContent = config.impuestoNombre;
  $('k-impuesto').textContent = dinero(impuesto);
  $('k-impuesto-detalle').textContent = 'Cobrado en el día';

  $('contador').textContent = lista.length === ventas.length ? `${lista.length} tickets` : `${lista.length} de ${ventas.length} tickets`;
  $('vacio').hidden = lista.length > 0;
  $('tabla-ventas').hidden = lista.length === 0;
  $('tabla-ventas').tBodies[0].replaceChildren(...lista.map((v) => {
    const marcas = [];
    if (v.tipo === 'devolucion') marcas.push(chip('Devolución', 'alerta'));
    if (v.autorizacion) marcas.push(chip('Autorizado', 'info'));
    if (v.pendiente) marcas.push(chip('Por enviar', 'aviso'));
    return h('tr', { tabindex: 0, dataset: { id: v.id }, class: v.tipo === 'devolucion' ? 'fila--devolucion' : null },
      h('td', { text: hora(v.fecha) }),
      h('td', null, h('span', { class: 'monoespaciada', text: v.folio }), ' ', marcas),
      h('td', { text: v.cajaNombre }),
      h('td', { text: v.cajeroNombre }),
      h('td', { class: 'num', text: String(v.articulos) }),
      h('td', { text: metodosDe(v) }),
      h('td', { class: 'num', text: v.descuentoLineasCentavos + v.descuentoTicketCentavos ? dinero(-(v.descuentoLineasCentavos + v.descuentoTicketCentavos)) : '' }),
      h('td', { class: 'num', text: dinero(v.totalCentavos) }));
  }));
  $('tabla-ventas').tFoot.replaceChildren(lista.length ? h('tr', null,
    h('td', { colspan: 4, text: 'Total' }),
    h('td', { class: 'num', text: String(articulos) }),
    h('td', { text: '' }),
    h('td', { class: 'num', text: descuentos ? dinero(-descuentos) : '' }),
    h('td', { class: 'num', text: dinero(total) })) : '');
  return lista;
}

function escuchar() {
  dejar?.();
  ventas = [];
  $('ventas-fecha').textContent = `${fechaLarga(dia)} · todas las cajas, en vivo`;
  for (const boton of document.querySelectorAll('[data-dia]')) {
    boton.setAttribute('aria-pressed', String(sumarDias(claveDia(), Number(boton.dataset.dia)) === dia));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('dia', dia);
  window.history.replaceState(null, '', url);
  dejar = observarVentasDelDia(dia, (lista) => {
    ventas = lista;
    pintar();
  }, (error) => mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar las ventas: ${mensajeError(error)}`));
  pintar();
}

function abrir(venta) {
  abrirTicket(venta, {
    tienda: tiendas.get(venta.tienda),
    config,
    alVerTurno: (turno) => { window.location.href = `turnos.html?turno=${encodeURIComponent(turno)}`; },
  });
}

// ------------------------------------------------------------- eventos

$('f-dia').addEventListener('change', () => {
  if (!REGEX_DIA.test($('f-dia').value)) return;
  dia = $('f-dia').value;
  escuchar();
});
for (const boton of document.querySelectorAll('[data-dia]')) {
  boton.addEventListener('click', () => {
    dia = sumarDias(claveDia(), Number(boton.dataset.dia));
    $('f-dia').value = dia;
    escuchar();
  });
}
for (const id of ['f-caja', 'f-cajero', 'f-tipo', 'f-pago']) $(id).addEventListener('change', pintar);
$('f-folio').addEventListener('input', pintar);
$('filtros').addEventListener('submit', (e) => e.preventDefault());

// Enter (o el escáner) en la búsqueda: un folio completo se busca en cualquier día.
$('f-folio').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const folio = folioDesdeTexto($('f-folio').value);
  if (!folio) return;
  const delDia = ventas.filter((v) => v.folio === folio);
  try {
    const encontradas = delDia.length ? delDia : await buscarVentasPorFolio(folio);
    if (encontradas.length === 0) {
      mostrarMensaje($('mensaje'), 'error', `No existe el ticket ${folio}.`);
      return;
    }
    mostrarMensaje($('mensaje'), '', '');
    const venta = encontradas[0];
    if (venta.dia !== dia) {
      dia = venta.dia;
      $('f-dia').value = dia;
      $('f-folio').value = '';
      escuchar();
    }
    abrir(venta);
  } catch (error) {
    mostrarMensaje($('mensaje'), 'error', `No se pudo buscar el ticket: ${mensajeError(error)}`);
  }
});

$('tabla-ventas').addEventListener('click', (e) => {
  const fila = e.target.closest('tr[data-id]');
  const venta = fila && ventas.find((v) => v.id === fila.dataset.id);
  if (venta) abrir(venta);
});
$('tabla-ventas').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const fila = e.target.closest('tr[data-id]');
  const venta = fila && ventas.find((v) => v.id === fila.dataset.id);
  if (venta) abrir(venta);
});

$('btn-exportar').addEventListener('click', () => {
  const lista = pintar();
  const filas = [['fecha', 'folio', 'tipo', 'caja', 'atendio', 'codigo', 'articulos', 'subtotal', 'descuentos', 'base_gravada', 'base_tasa_cero', 'impuesto', 'total', 'efectivo', 'debito', 'credito', 'otro', 'redondeo', 'autorizo', 'ticket_original']];
  for (const v of [...lista].reverse()) {
    filas.push([
      fechaHora(v.fecha), v.folio, v.tipo, v.cajaNombre, v.cajeroNombre, v.cajero, v.articulos,
      csvMonto(v.subtotalCentavos), csvMonto(v.descuentoLineasCentavos + v.descuentoTicketCentavos), csvMonto(v.baseGravadaCentavos),
      csvMonto(v.baseTasaCeroCentavos), csvMonto(v.impuestoCentavos), csvMonto(v.totalCentavos),
      ...METODOS_PAGO.map((m) => csvMonto(v.porMetodo?.[m] ?? 0)), csvMonto(v.redondeoCentavos), v.autorizadoPor ?? '', v.ventaOriginal ?? '',
    ]);
  }
  descargarCSV(`ventas-${dia}.csv`, filas);
});

observarTiendas((lista) => { tiendas = new Map(lista.map((t) => [t.id, t])); }, () => {});
observarConfigPos((c) => {
  config = c;
  pintar();
}, () => {});

escuchar();

if (parametros.get('folio')) {
  $('f-folio').value = parametros.get('folio');
  $('f-folio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
}

