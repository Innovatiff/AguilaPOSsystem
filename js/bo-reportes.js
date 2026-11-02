/**
 * Back office · Reportes de un periodo, a partir del resumen que cada turno
 * guarda al cerrarse (no hace falta leer cada ticket): totales, impuestos,
 * ventas por día, formas de pago, horas y ventas por persona, por caja,
 * productos más vendidos, venta libre por departamento y controles.
 * Los turnos que siguen abiertos no entran hasta que se cierran.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { leerTurnosEntre, observarConfigPos } from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { METODOS_PAGO, NOMBRE_METODO, formatearPeso } from './ticket.js';
import { sumarResumenes, ventasNetas, milisDe } from './turnos.js';
import { configConDefectos } from './config-pos.js';
import { dinero, claveDia, sumarDias, inicioDia, diasEntre, fechaLarga, fechaCorta, formatearDuracion, descargarCSV, csvMonto, mostrarMensaje } from './bo.js';
import { graficaColumnas, barraSegmentada } from './grafica.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'reportes.html' });

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(window.location.search);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_METODO = Object.freeze({ efectivo: '#2a78d6', debito: '#eb6834', credito: '#1baf7a', otro: '#eda100' });
const TOP_PRODUCTOS = 25;

let desde = REGEX_DIA.test(parametros.get('desde') ?? '') ? parametros.get('desde') : `${claveDia().slice(0, 8)}01`;
let hasta = REGEX_DIA.test(parametros.get('hasta') ?? '') ? parametros.get('hasta') : claveDia();
let turnos = [];
let tiendas = [];
let config = configConDefectos(null);
let calculo = null;

$('f-desde').value = desde;
$('f-hasta').value = hasta;
$('contenido').hidden = false;

const grafica = graficaColumnas($('grafica-dias'), { descripcion: 'Ventas por día del periodo', formatoValor: (c) => dinero(c) });

function periodoDe(clave) {
  const hoy = claveDia();
  if (clave === 'hoy') return [hoy, hoy];
  if (clave === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
  if (clave === 'semana') return [sumarDias(hoy, -6), hoy];
  if (clave === 'mes') return [`${hoy.slice(0, 8)}01`, hoy];
  const primeroEste = `${hoy.slice(0, 8)}01`;
  const ultimoPasado = sumarDias(primeroEste, -1);
  return [`${ultimoPasado.slice(0, 8)}01`, ultimoPasado];
}

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

/** Agrupa los turnos cerrados y suma sus resúmenes por clave. */
function agrupar(lista, claveDe, nombreDe) {
  const grupos = new Map();
  for (const t of lista) {
    const clave = claveDe(t);
    const g = grupos.get(clave) ?? { clave, nombre: nombreDe(t), turnos: [] };
    g.turnos.push(t);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    resumen: sumarResumenes(g.turnos.map((t) => t.resumen)),
    diferencia: g.turnos.reduce((acc, t) => acc + (t.diferenciaCentavos ?? 0), 0),
  }));
}

const ticketsDe = (r) => r.ventas;
const promedioDe = (r) => (r.ventas ? Math.round((r.totalCentavos + r.devolucionesCentavos) / r.ventas) : 0);

function calcular() {
  const f = { tienda: $('f-tienda').value, caja: $('f-caja').value };
  const delFiltro = turnos.filter((t) => (!f.tienda || t.tienda === f.tienda) && (!f.caja || t.caja === f.caja));
  const cerrados = delFiltro.filter((t) => t.estado === 'cerrado' && t.resumen);
  const abiertos = delFiltro.filter((t) => t.estado === 'abierto');
  const total = sumarResumenes(cerrados.map((t) => t.resumen));
  const porDia = agrupar(cerrados, (t) => claveDia(new Date(milisDe(t.abiertoEn))), (t) => claveDia(new Date(milisDe(t.abiertoEn))));
  const porPersona = agrupar(cerrados, (t) => t.cajero, (t) => t.cajeroNombre).sort((a, b) => b.resumen.totalCentavos - a.resumen.totalCentavos);
  const porCaja = agrupar(cerrados, (t) => t.caja, (t) => t.cajaNombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  const faltantes = cerrados.filter((t) => t.diferenciaCentavos < 0);
  const sobrantes = cerrados.filter((t) => t.diferenciaCentavos > 0);
  return { cerrados, abiertos, total, porDia, porPersona, porCaja, faltantes, sobrantes };
}

function fila(...celdas) {
  return h('tr', null, celdas);
}
const td = (texto, num = false) => h('td', { class: num ? 'num' : null, text: texto });

function pintar() {
  calculo = calcular();
  const { cerrados, abiertos, total: r, porDia, porPersona, porCaja, faltantes, sobrantes } = calculo;
  $('reporte-periodo').textContent = desde === hasta ? fechaLarga(desde) : `Del ${fechaLarga(desde).toLowerCase()} al ${fechaLarga(hasta).toLowerCase()}`;
  const notaAbiertos = $('nota-abiertos');
  notaAbiertos.hidden = abiertos.length === 0;
  notaAbiertos.textContent = `${abiertos.length} turno(s) del periodo siguen abiertos y todavía no entran en el reporte: se suman cuando se cierran.`;

  // Indicadores
  $('k-total').textContent = dinero(r.totalCentavos);
  $('k-total-detalle').textContent = `${cerrados.length} turno(s) cerrado(s) · con ${config.impuestoNombre}`;
  $('k-netas').textContent = dinero(ventasNetas(r));
  $('k-tickets').textContent = r.ventas.toLocaleString('en-CA');
  $('k-tickets-detalle').textContent = `${r.devoluciones} devolución(es) · ${r.articulos.toLocaleString('en-CA')} artículos`;
  $('k-promedio').textContent = r.ventas ? dinero(promedioDe(r)) : '—';
  $('k-promedio-detalle').textContent = r.descuentosCentavos ? `Descuentos: ${dinero(r.descuentosCentavos)}` : 'Sin descuentos';

  // Ventas por día (todos los días del periodo, también los que no vendieron)
  const porDiaMapa = new Map(porDia.map((g) => [g.clave, g]));
  const dias = diasEntre(desde, hasta);
  grafica.actualizar(dias.map((d) => {
    const g = porDiaMapa.get(d);
    return { etiqueta: dias.length > 14 ? d.slice(8) : fechaCorta(d).replace(/\.$/, ''), valor: Math.max(0, g?.resumen.totalCentavos ?? 0), detalle: `${fechaCorta(d)} · ${g ? g.resumen.ventas : 0} tickets` };
  }));
  $('tabla-dias').tBodies[0].replaceChildren(...dias.filter((d) => porDiaMapa.has(d)).map((d) => {
    const g = porDiaMapa.get(d);
    return fila(td(fechaCorta(d)), td(String(g.turnos.length), true), td(String(ticketsDe(g.resumen)), true), td(dinero(ventasNetas(g.resumen)), true), td(dinero(g.resumen.impuestoCentavos), true), td(dinero(g.resumen.totalCentavos), true));
  }));

  // Formas de pago
  const cobrado = METODOS_PAGO.reduce((acc, m) => acc + Math.max(0, r.porMetodo[m]), 0);
  $('barra-pagos').replaceChildren(barraSegmentada(METODOS_PAGO.map((m) => ({ nombre: NOMBRE_METODO[m], valor: Math.max(0, r.porMetodo[m]), color: COLOR_METODO[m], texto: dinero(r.porMetodo[m]) })), 'Formas de pago del periodo'));
  $('lista-pagos').replaceChildren(...METODOS_PAGO.map((m) => h('li', null,
    h('span', { class: 'muestra-color', style: `background:${COLOR_METODO[m]}` }),
    h('span', { text: NOMBRE_METODO[m] }),
    h('span', { class: 'parte', text: cobrado > 0 ? `${Math.round((Math.max(0, r.porMetodo[m]) / cobrado) * 100)} %` : '' }),
    h('span', { class: 'cifra', text: dinero(r.porMetodo[m]) }))));

  // Personas
  $('tabla-personas').tBodies[0].replaceChildren(...porPersona.map((g) => fila(
    h('td', null, g.nombre, h('span', { class: 'secundario', text: g.clave })),
    td(String(g.turnos.length), true),
    td(formatearDuracion(g.resumen.minutos), true),
    td(String(ticketsDe(g.resumen)), true),
    td(dinero(g.resumen.totalCentavos), true),
    td(g.resumen.ventas ? dinero(promedioDe(g.resumen)) : '—', true),
    td(dinero(g.diferencia), true))));
  if (porPersona.length) {
    $('tabla-personas').tBodies[0].append(h('tr', { class: 'fila--total' },
      td('Total'), td(String(cerrados.length), true), td(formatearDuracion(r.minutos), true), td(String(r.ventas), true),
      td(dinero(r.totalCentavos), true), td(r.ventas ? dinero(promedioDe(r)) : '—', true), td(dinero(porPersona.reduce((acc, g) => acc + g.diferencia, 0)), true)));
  }

  // Impuestos
  $('lista-impuestos').replaceChildren(
    h('dt', { text: `Ventas con ${config.impuestoNombre}` }), h('dd', { text: dinero(r.baseGravadaCentavos) }),
    h('dt', { text: 'Ventas tasa cero' }), h('dd', { text: dinero(r.baseTasaCeroCentavos) }),
    h('dt', { text: 'Ventas netas' }), h('dd', { text: dinero(ventasNetas(r)) }),
    h('dt', { text: `${config.impuestoNombre} cobrado` }), h('dd', null, h('strong', { text: dinero(r.impuestoCentavos) })),
    h('dt', { text: 'Total con impuesto' }), h('dd', { text: dinero(r.totalCentavos) }),
    h('dt', { text: 'Redondeo del efectivo' }), h('dd', { text: dinero(r.redondeoCentavos) }),
    h('dt', { text: 'Devoluciones (sin impuesto)' }), h('dd', { text: dinero(r.devolucionesSinImpuestoCentavos) }));

  // Productos
  const productos = Object.entries(r.productos).map(([clave, p]) => ({ clave, ...p })).sort((a, b) => b.netoCentavos - a.netoCentavos).slice(0, TOP_PRODUCTOS);
  $('tabla-productos').tBodies[0].replaceChildren(...productos.map((p, i) => fila(
    td(String(i + 1)), td(p.nombre), h('td', { class: 'monoespaciada', text: p.upc ?? '' }),
    td(p.pesoGramos ? formatearPeso(p.pesoGramos) + (p.cantidad ? ` + ${p.cantidad}` : '') : String(p.cantidad), true), td(dinero(p.netoCentavos), true))));

  // Cajas y departamentos
  $('tabla-cajas').tBodies[0].replaceChildren(...porCaja.map((g) => fila(td(g.nombre), td(String(g.turnos.length), true), td(String(ticketsDe(g.resumen)), true), td(dinero(g.resumen.totalCentavos), true))));
  const deptos = Object.values(r.porDepartamento).sort((a, b) => b.netoCentavos - a.netoCentavos);
  $('tabla-deptos').tBodies[0].replaceChildren(...(deptos.length ? deptos.map((d) => fila(td(d.nombre), td(String(d.articulos), true), td(dinero(d.netoCentavos), true))) : [fila(h('td', { colspan: 3, class: 'nota', text: 'Sin ventas por departamento.' }))]));

  // Control
  const dato = (etiqueta, valor, detalle = '') => h('div', { class: 'dato-bo' }, h('span', { text: etiqueta }), h('strong', { text: valor }), detalle ? h('small', { text: detalle }) : null);
  $('datos-control').replaceChildren(
    dato('Faltantes de efectivo', dinero(-faltantes.reduce((acc, t) => acc + t.diferenciaCentavos, 0)), `${faltantes.length} turno(s)`),
    dato('Sobrantes de efectivo', dinero(sobrantes.reduce((acc, t) => acc + t.diferenciaCentavos, 0)), `${sobrantes.length} turno(s)`),
    dato('Devoluciones', dinero(r.devolucionesCentavos), `${r.devoluciones} ticket(s)`),
    dato('Descuentos', dinero(r.descuentosCentavos)),
    dato('Líneas anuladas', String(r.lineasAnuladas), dinero(r.lineasAnuladasCentavos)),
    dato('Tickets cancelados', String(r.cancelaciones), dinero(r.cancelacionesCentavos)),
    dato('Cambios de precio', String(r.cambiosPrecio)),
    dato('Ventas con autorización', String(r.autorizadas)),
    dato('Aperturas de cajón', String(r.aperturasCajon)),
    dato('Retiros a caja fuerte', dinero(r.efectivo.retirosCentavos)),
    dato('Pagos desde caja', dinero(r.efectivo.pagosCentavos)),
    dato('Turnos cerrados por un admin', String(cerrados.filter((t) => t.cierreForzado).length)));
}

async function cargar() {
  for (const boton of document.querySelectorAll('[data-periodo]')) boton.setAttribute('aria-pressed', String(periodoDe(boton.dataset.periodo).join() === [desde, hasta].join()));
  const url = new URL(window.location.href);
  url.searchParams.set('desde', desde);
  url.searchParams.set('hasta', hasta);
  window.history.replaceState(null, '', url);
  document.querySelector('.paneles').classList.add('cargando-datos');
  try {
    turnos = await leerTurnosEntre(inicioDia(desde), inicioDia(sumarDias(hasta, 1)));
    mostrarMensaje($('mensaje'), '', '');
  } catch (error) {
    turnos = [];
    mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar los turnos: ${mensajeError(error)}`);
  }
  document.querySelector('.paneles').classList.remove('cargando-datos');
  llenarSelect($('f-tienda'), tiendas.map((t) => [t.id, t.nombre]), 'Todas');
  llenarSelect($('f-caja'), [...new Map(turnos.map((t) => [t.caja, t.cajaNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), 'Todas');
  pintar();
}

// ------------------------------------------------------------- eventos

for (const id of ['f-desde', 'f-hasta']) {
  $(id).addEventListener('change', () => {
    if (!REGEX_DIA.test($('f-desde').value) || !REGEX_DIA.test($('f-hasta').value)) return;
    desde = $('f-desde').value;
    hasta = $('f-hasta').value;
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    $('f-desde').value = desde;
    $('f-hasta').value = hasta;
    cargar();
  });
}
for (const boton of document.querySelectorAll('[data-periodo]')) {
  boton.addEventListener('click', () => {
    [desde, hasta] = periodoDe(boton.dataset.periodo);
    $('f-desde').value = desde;
    $('f-hasta').value = hasta;
    cargar();
  });
}
for (const id of ['f-tienda', 'f-caja']) $(id).addEventListener('change', pintar);
$('filtros').addEventListener('submit', (e) => e.preventDefault());
$('btn-imprimir').addEventListener('click', () => window.print());

$('btn-exportar').addEventListener('click', () => {
  if (!calculo) return;
  const { total: r, porDia, porPersona, porCaja } = calculo;
  const filas = [
    [`Reporte Águila POS`, `${desde} a ${hasta}`],
    [],
    ['Resumen', 'Monto'],
    ['Total con impuesto', csvMonto(r.totalCentavos)],
    ['Ventas netas', csvMonto(ventasNetas(r))],
    [`Ventas con ${config.impuestoNombre}`, csvMonto(r.baseGravadaCentavos)],
    ['Ventas tasa cero', csvMonto(r.baseTasaCeroCentavos)],
    [`${config.impuestoNombre} cobrado`, csvMonto(r.impuestoCentavos)],
    ['Descuentos', csvMonto(r.descuentosCentavos)],
    ['Devoluciones (con impuesto)', csvMonto(r.devolucionesCentavos)],
    ...METODOS_PAGO.map((m) => [NOMBRE_METODO[m], csvMonto(r.porMetodo[m])]),
    [],
    ['Día', 'Turnos', 'Tickets', 'Ventas netas', 'Impuesto', 'Total'],
    ...porDia.sort((a, b) => a.clave.localeCompare(b.clave)).map((g) => [g.clave, g.turnos.length, g.resumen.ventas, csvMonto(ventasNetas(g.resumen)), csvMonto(g.resumen.impuestoCentavos), csvMonto(g.resumen.totalCentavos)]),
    [],
    ['Persona', 'Código', 'Turnos', 'Horas', 'Tickets', 'Vendido', 'Diferencia de efectivo'],
    ...porPersona.map((g) => [g.nombre, g.clave, g.turnos.length, (g.resumen.minutos / 60).toFixed(2), g.resumen.ventas, csvMonto(g.resumen.totalCentavos), csvMonto(g.diferencia)]),
    [],
    ['Caja', 'Turnos', 'Tickets', 'Vendido'],
    ...porCaja.map((g) => [g.nombre, g.turnos.length, g.resumen.ventas, csvMonto(g.resumen.totalCentavos)]),
  ];
  descargarCSV(`reporte-${desde}-a-${hasta}.csv`, filas);
});

observarConfigPos((c) => {
  config = c;
  if (calculo) pintar();
}, () => {});

observarTiendas((lista) => {
  tiendas = lista;
  llenarSelect($('f-tienda'), tiendas.map((t) => [t.id, t.nombre]), 'Todas');
}, () => {});

cargar();
