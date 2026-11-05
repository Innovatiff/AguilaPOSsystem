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
import { t, tc } from './idioma.js';
import {
  observarVentasEntre, observarCancelacionesEntre, buscarVentasPorFolio, observarConfigPos, observarCajas,
  historialDeVenta, historialDeCancelacion,
} from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { METODOS_PAGO, nombreMetodo, folioDesdeTexto } from './ticket.js';
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

// «Marca» aquí es la de auditoría (en inglés «Flag»), no la de un producto («Brand», que es lo que le da la traducción de la página).
document.querySelector('label[for="f-marca"]').textContent = tc('auditoria', 'Marca');
$('contenido').hidden = false;

// ------------------------------------------------------------- transacciones

/** Marcas de auditoría de una venta: [clave, texto] (texto en el idioma elegido). */
function marcasDe(v) {
  const marcas = [];
  if (v.descuentoLineasCentavos + v.descuentoTicketCentavos > 0) marcas.push(['descuento', t('Descuento')]);
  if (v.cambiosPrecio > 0) marcas.push(['precio', t('Cambio de precio')]);
  if (v.lineasAnuladas > 0) marcas.push(['anuladas', v.lineasAnuladas === 1 ? t('{n} anulado', { n: v.lineasAnuladas }) : t('{n} anulados', { n: v.lineasAnuladas })]);
  if (v.autorizacion) marcas.push(['autorizada', t('Autorizada')]);
  if ((v.lineas ?? []).some((l) => l.departamento && !l.productoId)) marcas.push(['libre', t('Venta libre')]);
  if (v.tipo === 'devolucion' && !v.ventaOriginal) marcas.push(['sin-recibo', t('Sin recibo')]);
  return marcas;
}

/** estado → [texto, chip]. El texto va en el idioma elegido (también en el CSV). */
const ESTADO = {
  completada: [t('Completada'), 'abierto'],
  devuelta: [t('Devuelta'), 'neutro'],
  devolucion: [t('Devolución'), 'aviso'],
  anulada: [t('Anulada'), 'alerta'],
};

const textoMetodos = (v) => [...new Set((v.pagos ?? []).map((p) => nombreMetodo(p.metodo)))].join(' + ') || '—';

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

function cumple(tx, f) {
  if (f.cajero && tx.cajero !== f.cajero) return false;
  if (f.caja && tx.caja !== f.caja) return false;
  if (f.estado && tx.estado !== f.estado) return false;
  if (f.marca === 'ninguna' && tx.marcas.length > 0) return false;
  if (f.marca && f.marca !== 'ninguna' && !tx.marcas.some(([clave]) => clave === f.marca)) return false;
  if (f.pago && !tx.pagos.includes(f.pago)) return false;
  if (f.buscar && !f.buscar.split(' ').every((palabra) => tx.buscable.includes(palabra))) return false;
  return true;
}

// ------------------------------------------------------------- pintar

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

/** «8 transacciones» o «2 de 8 transacciones» (en inglés, «1 transaction» en singular). */
function cuantasTransacciones(n, total) {
  if (n !== total) return t('{n} de {total} transacciones', { n, total });
  return n === 1 ? tc('uno', '{n} transacciones', { n }) : t('{n} transacciones', { n });
}

let visibles = [];
function pintar() {
  const todas = transacciones();
  const personas = new Map(todas.map((tx) => [tx.cajero, tx.cajeroNombre || tx.cajero]));
  const enCajas = new Map(todas.map((tx) => [tx.caja, tx.cajaNombre || tx.caja]));
  llenarSelect($('f-cajero'), [...personas].sort((a, b) => a[1].localeCompare(b[1], 'es')), t('Todos'));
  llenarSelect($('f-caja'), [...enCajas].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), t('Todas'));
  if (parametros.get('caja') && !$('f-caja').value && enCajas.has(parametros.get('caja'))) $('f-caja').value = parametros.get('caja');

  const f = filtros();
  visibles = todas.filter((tx) => cumple(tx, f));
  let vendido = 0;
  let devuelto = 0;
  let anuladas = 0;
  for (const tx of visibles) {
    if (tx.estado === 'anulada') anuladas += 1;
    else if (tx.total < 0) devuelto += -tx.total;
    else vendido += tx.total;
  }
  const partes = [cuantasTransacciones(visibles.length, todas.length), t('vendido {monto}', { monto: dinero(vendido) })];
  if (devuelto) partes.push(t('devuelto {monto}', { monto: dinero(devuelto) }));
  if (anuladas) partes.push(anuladas === 1 ? t('{n} anulada', { n: anuladas }) : t('{n} anuladas', { n: anuladas }));
  $('contador').textContent = partes.join(' · ');
  $('vacio').hidden = visibles.length > 0;
  $('tabla-transacciones').hidden = visibles.length === 0;
  $('tabla-transacciones').tBodies[0].replaceChildren(...visibles.map((tx) => {
    const [estadoTexto, estadoChip] = ESTADO[tx.estado];
    return h('tr', { tabindex: 0, dataset: { id: tx.id }, class: tx.estado === 'anulada' ? 'fila--anulada' : tx.estado === 'devolucion' ? 'fila--devolucion' : null },
      h('td', null, tx.folio ? h('span', { class: 'monoespaciada', text: tx.folio }) : h('span', { class: 'secundario', text: t('Sin recibo') }),
        tx.venta?.pendiente ? chip(t('Por enviar'), 'aviso') : null),
      h('td', { text: cuando(tx.fecha) }),
      h('td', { text: tx.cajeroNombre }),
      h('td', { text: tx.cajaNombre }),
      h('td', { class: 'num', text: String(tx.articulos) }),
      h('td', { text: tx.metodos }),
      h('td', { class: 'marcas' }, tx.marcas.map(([, texto]) => chip(texto, 'neutro'))),
      h('td', null, chip(estadoTexto, estadoChip)),
      h('td', { class: `num${tx.estado === 'anulada' ? ' tachado' : ''}`, text: dinero(tx.total) }));
  }));
  return visibles;
}

// ------------------------------------------------------------- datos

function ajustarRango() {
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diasEntre(desde, hasta).length > MAXIMO_DIAS) {
    desde = sumarDias(hasta, -(MAXIMO_DIAS - 1));
    mostrarMensaje($('mensaje'), 'aviso', t('Se muestran como máximo {n} días: desde el {desde}.', { n: MAXIMO_DIAS, desde }));
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
  const falla = (que) => (error) => mostrarMensaje($('mensaje'), 'error', t('No se pudieron cargar {que}: {error}', { que, error: mensajeError(error) }));
  dejar.push(observarVentasEntre(desde, hasta, (lista) => {
    ventas = lista;
    pintar();
  }, falla(t('las ventas'))));
  dejar.push(observarCancelacionesEntre(inicioDia(desde), inicioDia(sumarDias(hasta, 1)), (lista) => {
    cancelaciones = lista;
    pintar();
  }, () => {}));
  pintar();
}

function abrir(tx) {
  if (tx.clase === 'cancelacion') {
    abrirCancelacion(tx.movimiento, { cajaNombre: tx.cajaNombre, historial: historialDeCancelacion({ turno: tx.movimiento.turno, importeCentavos: tx.movimiento.importeCentavos, fecha: tx.movimiento.fecha }) });
    return;
  }
  abrirTicket(tx.venta, {
    tienda: tiendas.get(tx.venta.tienda),
    config,
    historial: historialDeVenta(tx.venta.folio),
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
  const cargada = transacciones().find((tx) => tx.folio === folio);
  try {
    const venta = cargada?.venta ?? (await buscarVentasPorFolio(folio))[0];
    if (!venta) {
      mostrarMensaje($('mensaje'), 'error', t('No existe el recibo {folio}.', { folio }));
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
    mostrarMensaje($('mensaje'), 'error', t('No se pudo buscar el recibo: {error}', { error: mensajeError(error) }));
  }
});

function filaElegida(e) {
  const fila = e.target.closest('tr[data-id]');
  return fila ? visibles.find((tx) => tx.id === fila.dataset.id) : null;
}
$('tabla-transacciones').addEventListener('click', (e) => {
  const tx = filaElegida(e);
  if (tx) abrir(tx);
});
$('tabla-transacciones').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tx = filaElegida(e);
  if (tx) abrir(tx);
});

$('btn-exportar').addEventListener('click', () => {
  const lista = pintar();
  // Reporte para personas: encabezados y estados en el idioma elegido; números, fechas y códigos tal cual.
  const filas = [[t('fecha'), t('recibo'), t('estado'), t('caja'), t('asociado'), t('codigo'), t('articulos'), t('formas_de_pago'), t('marcas'),
    t('subtotal'), t('descuentos'), t('impuesto'), t('total'), t('efectivo'), t('debito'), t('credito'), t('otro'), t('autorizo'), t('ticket_original')]];
  for (const tx of [...lista].reverse()) {
    const v = tx.venta;
    filas.push([
      fechaHora(tx.fecha), tx.folio ?? '', ESTADO[tx.estado][0], tx.cajaNombre, tx.cajeroNombre, tx.cajero, tx.articulos, tx.metodos === '—' ? '' : tx.metodos,
      tx.marcas.map(([, texto]) => texto).join('; '),
      v ? csvMonto(v.subtotalCentavos) : '', v ? csvMonto(v.descuentoLineasCentavos + v.descuentoTicketCentavos) : '', v ? csvMonto(v.impuestoCentavos) : '',
      csvMonto(tx.total), ...METODOS_PAGO.map((m) => (v ? csvMonto(v.porMetodo?.[m] ?? 0) : '')), v?.autorizadoPor ?? '', v?.ventaOriginal ?? '',
    ]);
  }
  descargarCSV(hasta !== desde ? t('transacciones-{desde}-a-{hasta}.csv', { desde, hasta }) : t('transacciones-{desde}.csv', { desde }), filas);
});

observarTiendas((lista) => { tiendas = new Map(lista.map((tienda) => [tienda.id, tienda])); }, () => {});
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
