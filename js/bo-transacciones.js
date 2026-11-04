/**
 * Back office · Transacciones: cada venta completada, anulada (ticket
 * cancelado) o devuelta de un rango de días, de todas las cajas, en vivo.
 * Filtros: asociado, caja, estado, marcas de auditoría (descuento, cambio de
 * precio, artículos anulados, autorización, venta libre, devolución sin
 * recibo), forma de pago, y búsqueda por número de recibo o nombre de
 * artículo (escanear el recibo lo busca en cualquier día). Cada transacción
 * abre su recibo completo, con reimpresión, y su historial de auditoría (sus
 * movimientos en vivo). Exportación a CSV.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import {
  observarVentasEntre, observarCancelacionesEntre, buscarVentasPorFolio, observarConfigPos, observarCajas,
  historialDeVenta, historialDeCancelacion,
} from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { METODOS_PAGO, NOMBRE_METODO, folioDesdeTexto } from './ticket.js';
import { milisDe } from './turnos.js';
import { configConDefectos } from './config-pos.js';
import { normalizarTexto } from './esquema.js';
import {
  dinero, claveDia, sumarDias, inicioDia, diasEntre, chip, abrirTicket, abrirCancelacion, descargarCSV, csvMonto, mostrarMensaje, fechaHora, cuando,
} from './bo.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'transacciones.html' });

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(window.location.search);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DIAS = 31;

const hoy = claveDia();
let desde = REGEX_DIA.test(parametros.get('desde') ?? '') ? parametros.get('desde') : (REGEX_DIA.test(parametros.get('dia') ?? '') ? parametros.get('dia') : hoy);
let hasta = REGEX_DIA.test(parametros.get('hasta') ?? '') ? parametros.get('hasta') : (REGEX_DIA.test(parametros.get('dia') ?? '') ? parametros.get('dia') : hoy);
let ventas = [];
let cancelaciones = [];
let cajas = new Map();
let tiendas = new Map();
let config = configConDefectos(null);
const dejar = [];

$('contenido').hidden = false;

// ------------------------------------------------------------- transacciones

/** Marcas de auditoría de una venta: [clave, texto]. */
function marcasDe(v) {
  const marcas = [];
  if (v.descuentoLineasCentavos + v.descuentoTicketCentavos > 0) marcas.push(['descuento', 'Descuento']);
  if (v.cambiosPrecio > 0) marcas.push(['precio', 'Cambio de precio']);
  if (v.lineasAnuladas > 0) marcas.push(['anuladas', `${v.lineasAnuladas} ${v.lineasAnuladas === 1 ? 'anulado' : 'anulados'}`]);
  if (v.autorizacion) marcas.push(['autorizada', 'Autorizada']);
  if ((v.lineas ?? []).some((l) => l.departamento && !l.productoId)) marcas.push(['libre', 'Venta libre']);
  if (v.tipo === 'devolucion' && !v.ventaOriginal) marcas.push(['sin-recibo', 'Sin recibo']);
  return marcas;
}

const ESTADO = {
  completada: ['Completada', 'abierto'],
  devuelta: ['Devuelta', 'neutro'],
  devolucion: ['Devolución', 'aviso'],
  anulada: ['Anulada', 'alerta'],
};

const textoMetodos = (v) => [...new Set((v.pagos ?? []).map((p) => NOMBRE_METODO[p.metodo] ?? p.metodo))].join(' + ') || '—';

/** Ventas, devoluciones y tickets cancelados como filas uniformes. */
function transacciones() {
  const devueltas = new Set(ventas.filter((v) => v.tipo === 'devolucion' && v.ventaOriginal).map((v) => v.ventaOriginal));
  const deVentas = ventas.map((v) => ({
    id: v.id,
    clase: 'venta',
    folio: v.folio,
    fecha: v.fecha,
    cajero: v.cajero,
    cajeroNombre: v.cajeroNombre,
    caja: v.caja,
    cajaNombre: v.cajaNombre,
    articulos: Math.abs(v.articulos),
    metodos: textoMetodos(v),
    pagos: (v.pagos ?? []).map((p) => p.metodo),
    marcas: marcasDe(v),
    estado: v.tipo === 'devolucion' ? 'devolucion' : devueltas.has(v.folio) ? 'devuelta' : 'completada',
    total: v.totalCentavos,
    buscable: normalizarTexto(`${v.folio.replace(/-/g, '')} ${(v.lineas ?? []).map((l) => `${l.nombre} ${l.upc ?? ''} ${l.plu ?? ''}`).join(' ')}`),
    venta: v,
  }));
  const deCancelaciones = cancelaciones.map((m) => ({
    id: m.id,
    clase: 'cancelacion',
    folio: null,
    fecha: m.fecha,
    cajero: m.cajero,
    cajeroNombre: m.cajeroNombre,
    caja: m.caja,
    cajaNombre: cajas.get(m.caja)?.nombre ?? m.caja,
    articulos: Number(/^(\d+)/.exec(m.motivo ?? '')?.[1] ?? 0),
    metodos: '—',
    pagos: [],
    marcas: [],
    estado: 'anulada',
    total: m.importeCentavos,
    buscable: normalizarTexto(m.motivo ?? ''),
    movimiento: m,
  }));
  return [...deVentas, ...deCancelaciones].sort((a, b) => (milisDe(b.fecha) ?? 0) - (milisDe(a.fecha) ?? 0));
}

const filtros = () => ({
  cajero: $('f-cajero').value,
  caja: $('f-caja').value,
  estado: $('f-estado').value,
  marca: $('f-marca').value,
  pago: $('f-pago').value,
  buscar: normalizarTexto($('f-buscar').value).replace(/-/g, ''),
});

function cumple(t, f) {
  if (f.cajero && t.cajero !== f.cajero) return false;
  if (f.caja && t.caja !== f.caja) return false;
  if (f.estado && t.estado !== f.estado) return false;
  if (f.marca === 'ninguna' && t.marcas.length > 0) return false;
  if (f.marca && f.marca !== 'ninguna' && !t.marcas.some(([clave]) => clave === f.marca)) return false;
  if (f.pago && !t.pagos.includes(f.pago)) return false;
  if (f.buscar && !f.buscar.split(' ').every((palabra) => t.buscable.includes(palabra))) return false;
  return true;
}

// ------------------------------------------------------------- pintar

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

let visibles = [];
function pintar() {
  const todas = transacciones();
  const personas = new Map(todas.map((t) => [t.cajero, t.cajeroNombre || t.cajero]));
  const enCajas = new Map(todas.map((t) => [t.caja, t.cajaNombre || t.caja]));
  llenarSelect($('f-cajero'), [...personas].sort((a, b) => a[1].localeCompare(b[1], 'es')), 'Todos');
  llenarSelect($('f-caja'), [...enCajas].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), 'Todas');
  if (parametros.get('caja') && !$('f-caja').value && enCajas.has(parametros.get('caja'))) $('f-caja').value = parametros.get('caja');

  const f = filtros();
  visibles = todas.filter((t) => cumple(t, f));
  let vendido = 0;
  let devuelto = 0;
  let anuladas = 0;
  for (const t of visibles) {
    if (t.estado === 'anulada') anuladas += 1;
    else if (t.total < 0) devuelto += -t.total;
    else vendido += t.total;
  }
  $('contador').textContent = `${visibles.length === todas.length ? visibles.length : `${visibles.length} de ${todas.length}`} transacciones · vendido ${dinero(vendido)}${devuelto ? ` · devuelto ${dinero(devuelto)}` : ''}${anuladas ? ` · ${anuladas} anulada${anuladas === 1 ? '' : 's'}` : ''}`;
  $('vacio').hidden = visibles.length > 0;
  $('tabla-transacciones').hidden = visibles.length === 0;
  $('tabla-transacciones').tBodies[0].replaceChildren(...visibles.map((t) => {
    const [estadoTexto, estadoChip] = ESTADO[t.estado];
    return h('tr', { tabindex: 0, dataset: { id: t.id }, class: t.estado === 'anulada' ? 'fila--anulada' : t.estado === 'devolucion' ? 'fila--devolucion' : null },
      h('td', null, t.folio ? h('span', { class: 'monoespaciada', text: t.folio }) : h('span', { class: 'secundario', text: 'Sin recibo' }),
        t.venta?.pendiente ? chip('Por enviar', 'aviso') : null),
      h('td', { text: cuando(t.fecha) }),
      h('td', { text: t.cajeroNombre }),
      h('td', { text: t.cajaNombre }),
      h('td', { class: 'num', text: String(t.articulos) }),
      h('td', { text: t.metodos }),
      h('td', { class: 'marcas' }, t.marcas.map(([, texto]) => chip(texto, 'neutro'))),
      h('td', null, chip(estadoTexto, estadoChip)),
      h('td', { class: `num${t.estado === 'anulada' ? ' tachado' : ''}`, text: dinero(t.total) }));
  }));
  return visibles;
}

// ------------------------------------------------------------- datos

function ajustarRango() {
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diasEntre(desde, hasta).length > MAXIMO_DIAS) {
    desde = sumarDias(hasta, -(MAXIMO_DIAS - 1));
    mostrarMensaje($('mensaje'), 'aviso', `Se muestran como máximo ${MAXIMO_DIAS} días: desde el ${desde}.`);
  }
  $('f-desde').value = desde;
  $('f-hasta').value = hasta;
}

function escuchar() {
  for (const d of dejar.splice(0)) d();
  ajustarRango();
  ventas = [];
  cancelaciones = [];
  for (const boton of document.querySelectorAll('[data-rango]')) {
    boton.setAttribute('aria-pressed', String(hasta === claveDia() && desde === sumarDias(hasta, -(Number(boton.dataset.rango) - 1))));
  }
  const url = new URL(window.location.href);
  url.searchParams.delete('dia');
  url.searchParams.set('desde', desde);
  url.searchParams.set('hasta', hasta);
  window.history.replaceState(null, '', url);
  const falla = (que) => (error) => mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar ${que}: ${mensajeError(error)}`);
  dejar.push(observarVentasEntre(desde, hasta, (lista) => {
    ventas = lista;
    pintar();
  }, falla('las ventas')));
  dejar.push(observarCancelacionesEntre(inicioDia(desde), inicioDia(sumarDias(hasta, 1)), (lista) => {
    cancelaciones = lista;
    pintar();
  }, () => {}));
  pintar();
}

function abrir(t) {
  if (t.clase === 'cancelacion') {
    abrirCancelacion(t.movimiento, { cajaNombre: t.cajaNombre, historial: historialDeCancelacion({ turno: t.movimiento.turno, importeCentavos: t.movimiento.importeCentavos, fecha: t.movimiento.fecha }) });
    return;
  }
  abrirTicket(t.venta, {
    tienda: tiendas.get(t.venta.tienda),
    config,
    historial: historialDeVenta(t.venta.folio),
    alVerTurno: (turno) => { window.location.href = `turnos.html?turno=${encodeURIComponent(turno)}`; },
  });
}

// ------------------------------------------------------------- eventos

for (const boton of document.querySelectorAll('[data-rango]')) {
  boton.addEventListener('click', () => {
    hasta = claveDia();
    desde = sumarDias(hasta, -(Number(boton.dataset.rango) - 1));
    escuchar();
  });
}
for (const id of ['f-desde', 'f-hasta']) {
  $(id).addEventListener('change', () => {
    if (!REGEX_DIA.test($('f-desde').value) || !REGEX_DIA.test($('f-hasta').value)) return;
    desde = $('f-desde').value;
    hasta = $('f-hasta').value;
    escuchar();
  });
}
for (const id of ['f-cajero', 'f-caja', 'f-estado', 'f-marca', 'f-pago']) $(id).addEventListener('change', pintar);
$('f-buscar').addEventListener('input', pintar);
$('filtros').addEventListener('submit', (e) => e.preventDefault());

// Enter (o el escáner) en Buscar con un recibo completo: se abre aunque sea de otro día.
$('f-buscar').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const folio = folioDesdeTexto($('f-buscar').value);
  if (!folio) return;
  const cargada = transacciones().find((t) => t.folio === folio);
  try {
    const venta = cargada?.venta ?? (await buscarVentasPorFolio(folio))[0];
    if (!venta) {
      mostrarMensaje($('mensaje'), 'error', `No existe el recibo ${folio}.`);
      return;
    }
    mostrarMensaje($('mensaje'), '', '');
    if (!cargada) {
      desde = venta.dia;
      hasta = venta.dia;
      $('f-buscar').value = '';
      escuchar();
    }
    abrir({ clase: 'venta', venta });
  } catch (error) {
    mostrarMensaje($('mensaje'), 'error', `No se pudo buscar el recibo: ${mensajeError(error)}`);
  }
});

function filaElegida(e) {
  const fila = e.target.closest('tr[data-id]');
  return fila ? visibles.find((t) => t.id === fila.dataset.id) : null;
}
$('tabla-transacciones').addEventListener('click', (e) => {
  const t = filaElegida(e);
  if (t) abrir(t);
});
$('tabla-transacciones').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = filaElegida(e);
  if (t) abrir(t);
});

$('btn-exportar').addEventListener('click', () => {
  const lista = pintar();
  const filas = [['fecha', 'recibo', 'estado', 'caja', 'asociado', 'codigo', 'articulos', 'formas_de_pago', 'marcas',
    'subtotal', 'descuentos', 'impuesto', 'total', 'efectivo', 'debito', 'credito', 'otro', 'autorizo', 'ticket_original']];
  for (const t of [...lista].reverse()) {
    const v = t.venta;
    filas.push([
      fechaHora(t.fecha), t.folio ?? '', ESTADO[t.estado][0], t.cajaNombre, t.cajeroNombre, t.cajero, t.articulos, t.metodos === '—' ? '' : t.metodos,
      t.marcas.map(([, texto]) => texto).join('; '),
      v ? csvMonto(v.subtotalCentavos) : '', v ? csvMonto(v.descuentoLineasCentavos + v.descuentoTicketCentavos) : '', v ? csvMonto(v.impuestoCentavos) : '',
      csvMonto(t.total), ...METODOS_PAGO.map((m) => (v ? csvMonto(v.porMetodo?.[m] ?? 0) : '')), v?.autorizadoPor ?? '', v?.ventaOriginal ?? '',
    ]);
  }
  descargarCSV(`transacciones-${desde}${hasta !== desde ? `-a-${hasta}` : ''}.csv`, filas);
});

observarTiendas((lista) => { tiendas = new Map(lista.map((t) => [t.id, t])); }, () => {});
observarCajas((lista) => {
  cajas = new Map(lista.map((c) => [c.id, c]));
  pintar();
}, () => {});
observarConfigPos((c) => { config = c; }, () => {});

escuchar();

if (parametros.get('folio')) {
  $('f-buscar').value = parametros.get('folio');
  $('f-buscar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
}
