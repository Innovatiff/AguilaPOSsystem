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
import { t, tc, enIngles } from './idioma.js';
import { leerTurnosEntre, observarConfigPos } from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { METODOS_PAGO, nombreMetodo, formatearPeso } from './ticket.js';
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

const grafica = graficaColumnas($('grafica-dias'), { descripcion: t('Ventas por día del periodo'), formatoValor: (c) => dinero(c) });

/** Fecha larga dentro de una frase: en español en minúsculas («del lunes, 2 de noviembre…»); en inglés, con sus mayúsculas. */
const fechaEnFrase = (dia) => (enIngles() ? fechaLarga(dia) : fechaLarga(dia).toLowerCase());

/** Plurales del inglés para textos que en español van con «(s)» o siempre en plural (así el español queda igual). */
const turnosS = (n) => (n === 1 ? tc('uno', '{n} turno(s)', { n }) : t('{n} turno(s)', { n }));
const ticketsS = (n) => (n === 1 ? tc('uno', '{n} ticket(s)', { n }) : t('{n} ticket(s)', { n }));

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
  for (const tu of lista) {
    const clave = claveDe(tu);
    const g = grupos.get(clave) ?? { clave, nombre: nombreDe(tu), turnos: [] };
    g.turnos.push(tu);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    resumen: sumarResumenes(g.turnos.map((tu) => tu.resumen)),
    diferencia: g.turnos.reduce((acc, tu) => acc + (tu.diferenciaCentavos ?? 0), 0),
  }));
}

const ticketsDe = (r) => r.ventas;
const promedioDe = (r) => (r.ventas ? Math.round((r.totalCentavos + r.devolucionesCentavos) / r.ventas) : 0);

function calcular() {
  const f = { tienda: $('f-tienda').value, caja: $('f-caja').value };
  const delFiltro = turnos.filter((tu) => (!f.tienda || tu.tienda === f.tienda) && (!f.caja || tu.caja === f.caja));
  const cerrados = delFiltro.filter((tu) => tu.estado === 'cerrado' && tu.resumen);
  const abiertos = delFiltro.filter((tu) => tu.estado === 'abierto');
  const total = sumarResumenes(cerrados.map((tu) => tu.resumen));
  const porDia = agrupar(cerrados, (tu) => claveDia(new Date(milisDe(tu.abiertoEn))), (tu) => claveDia(new Date(milisDe(tu.abiertoEn))));
  const porPersona = agrupar(cerrados, (tu) => tu.cajero, (tu) => tu.cajeroNombre).sort((a, b) => b.resumen.totalCentavos - a.resumen.totalCentavos);
  const porCaja = agrupar(cerrados, (tu) => tu.caja, (tu) => tu.cajaNombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  const faltantes = cerrados.filter((tu) => tu.diferenciaCentavos < 0);
  const sobrantes = cerrados.filter((tu) => tu.diferenciaCentavos > 0);
  return { cerrados, abiertos, total, porDia, porPersona, porCaja, faltantes, sobrantes };
}

function fila(...celdas) {
  return h('tr', null, celdas);
}
const td = (texto, num = false) => h('td', { class: num ? 'num' : null, text: texto });

function pintar() {
  calculo = calcular();
  const { cerrados, abiertos, total: r, porDia, porPersona, porCaja, faltantes, sobrantes } = calculo;
  $('reporte-periodo').textContent = desde === hasta ? fechaLarga(desde) : t('Del {desde} al {hasta}', { desde: fechaEnFrase(desde), hasta: fechaEnFrase(hasta) });
  const notaAbiertos = $('nota-abiertos');
  notaAbiertos.hidden = abiertos.length === 0;
  notaAbiertos.textContent = abiertos.length === 1
    ? tc('uno', '{n} turno(s) del periodo siguen abiertos y todavía no entran en el reporte: se suman cuando se cierran.', { n: 1 })
    : t('{n} turno(s) del periodo siguen abiertos y todavía no entran en el reporte: se suman cuando se cierran.', { n: abiertos.length });

  // Indicadores
  $('k-total').textContent = dinero(r.totalCentavos);
  const totalDetalle = { n: cerrados.length, impuesto: config.impuestoNombre };
  $('k-total-detalle').textContent = cerrados.length === 1
    ? tc('uno', '{n} turno(s) cerrado(s) · con {impuesto}', totalDetalle)
    : t('{n} turno(s) cerrado(s) · con {impuesto}', totalDetalle);
  $('k-netas').textContent = dinero(ventasNetas(r));
  $('k-tickets').textContent = r.ventas.toLocaleString('en-CA');
  const ticketsDetalle = { devoluciones: r.devoluciones, articulos: r.articulos.toLocaleString('en-CA') };
  $('k-tickets-detalle').textContent = r.devoluciones === 1
    ? tc('uno', '{devoluciones} devolución(es) · {articulos} artículos', ticketsDetalle)
    : t('{devoluciones} devolución(es) · {articulos} artículos', ticketsDetalle);
  $('k-promedio').textContent = r.ventas ? dinero(promedioDe(r)) : '—';
  $('k-promedio-detalle').textContent = r.descuentosCentavos ? t('Descuentos: {monto}', { monto: dinero(r.descuentosCentavos) }) : t('Sin descuentos');

  // Ventas por día (todos los días del periodo, también los que no vendieron)
  const porDiaMapa = new Map(porDia.map((g) => [g.clave, g]));
  const dias = diasEntre(desde, hasta);
  grafica.actualizar(dias.map((d) => {
    const g = porDiaMapa.get(d);
    const tickets = { fecha: fechaCorta(d), n: g ? g.resumen.ventas : 0 };
    return {
      etiqueta: dias.length > 14 ? d.slice(8) : fechaCorta(d).replace(/\.$/, ''),
      valor: Math.max(0, g?.resumen.totalCentavos ?? 0),
      detalle: tickets.n === 1 ? tc('uno', '{fecha} · {n} tickets', tickets) : t('{fecha} · {n} tickets', tickets),
    };
  }));
  $('tabla-dias').tBodies[0].replaceChildren(...dias.filter((d) => porDiaMapa.has(d)).map((d) => {
    const g = porDiaMapa.get(d);
    return fila(td(fechaCorta(d)), td(String(g.turnos.length), true), td(String(ticketsDe(g.resumen)), true), td(dinero(ventasNetas(g.resumen)), true), td(dinero(g.resumen.impuestoCentavos), true), td(dinero(g.resumen.totalCentavos), true));
  }));

  // Formas de pago
  const cobrado = METODOS_PAGO.reduce((acc, m) => acc + Math.max(0, r.porMetodo[m]), 0);
  $('barra-pagos').replaceChildren(barraSegmentada(METODOS_PAGO.map((m) => ({ nombre: nombreMetodo(m), valor: Math.max(0, r.porMetodo[m]), color: COLOR_METODO[m], texto: dinero(r.porMetodo[m]) })), t('Formas de pago del periodo')));
  $('lista-pagos').replaceChildren(...METODOS_PAGO.map((m) => h('li', null,
    h('span', { class: 'muestra-color', style: `background:${COLOR_METODO[m]}` }),
    h('span', { text: nombreMetodo(m) }),
    h('span', { class: 'parte', text: cobrado > 0 ? t('{n} %', { n: Math.round((Math.max(0, r.porMetodo[m]) / cobrado) * 100) }) : '' }),
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
      td(t('Total')), td(String(cerrados.length), true), td(formatearDuracion(r.minutos), true), td(String(r.ventas), true),
      td(dinero(r.totalCentavos), true), td(r.ventas ? dinero(promedioDe(r)) : '—', true), td(dinero(porPersona.reduce((acc, g) => acc + g.diferencia, 0)), true)));
  }

  // Impuestos
  $('lista-impuestos').replaceChildren(
    h('dt', { text: t('Ventas con {impuesto}', { impuesto: config.impuestoNombre }) }), h('dd', { text: dinero(r.baseGravadaCentavos) }),
    h('dt', { text: t('Ventas tasa cero') }), h('dd', { text: dinero(r.baseTasaCeroCentavos) }),
    h('dt', { text: t('Ventas netas') }), h('dd', { text: dinero(ventasNetas(r)) }),
    h('dt', { text: t('{impuesto} cobrado', { impuesto: config.impuestoNombre }) }), h('dd', null, h('strong', { text: dinero(r.impuestoCentavos) })),
    h('dt', { text: t('Total con impuesto') }), h('dd', { text: dinero(r.totalCentavos) }),
    h('dt', { text: t('Redondeo del efectivo') }), h('dd', { text: dinero(r.redondeoCentavos) }),
    h('dt', { text: t('Devoluciones (sin impuesto)') }), h('dd', { text: dinero(r.devolucionesSinImpuestoCentavos) }));

  // Productos
  const productos = Object.entries(r.productos).map(([clave, p]) => ({ clave, ...p })).sort((a, b) => b.netoCentavos - a.netoCentavos).slice(0, TOP_PRODUCTOS);
  $('tabla-productos').tBodies[0].replaceChildren(...productos.map((p, i) => fila(
    // «Otros artículos» lo escribe el resumen del turno (js/turnos.js) cuando hay demasiados productos.
    td(String(i + 1)), td(p.clave === 'otros' ? t('Otros artículos') : p.nombre), h('td', { class: 'monoespaciada', text: p.upc ?? '' }),
    td(p.pesoGramos ? formatearPeso(p.pesoGramos) + (p.cantidad ? ` + ${p.cantidad}` : '') : String(p.cantidad), true), td(dinero(p.netoCentavos), true))));

  // Cajas y departamentos
  $('tabla-cajas').tBodies[0].replaceChildren(...porCaja.map((g) => fila(td(g.nombre), td(String(g.turnos.length), true), td(String(ticketsDe(g.resumen)), true), td(dinero(g.resumen.totalCentavos), true))));
  const deptos = Object.values(r.porDepartamento).sort((a, b) => b.netoCentavos - a.netoCentavos);
  $('tabla-deptos').tBodies[0].replaceChildren(...(deptos.length ? deptos.map((d) => fila(td(d.nombre), td(String(d.articulos), true), td(dinero(d.netoCentavos), true))) : [fila(h('td', { colspan: 3, class: 'nota', text: t('Sin ventas por departamento.') }))]));

  // Control
  const dato = (etiqueta, valor, detalle = '') => h('div', { class: 'dato-bo' }, h('span', { text: etiqueta }), h('strong', { text: valor }), detalle ? h('small', { text: detalle }) : null);
  $('datos-control').replaceChildren(
    dato(t('Faltantes de efectivo'), dinero(-faltantes.reduce((acc, tu) => acc + tu.diferenciaCentavos, 0)), turnosS(faltantes.length)),
    dato(t('Sobrantes de efectivo'), dinero(sobrantes.reduce((acc, tu) => acc + tu.diferenciaCentavos, 0)), turnosS(sobrantes.length)),
    dato(t('Devoluciones'), dinero(r.devolucionesCentavos), ticketsS(r.devoluciones)),
    dato(t('Descuentos'), dinero(r.descuentosCentavos)),
    dato(t('Líneas anuladas'), String(r.lineasAnuladas), dinero(r.lineasAnuladasCentavos)),
    dato(t('Tickets cancelados'), String(r.cancelaciones), dinero(r.cancelacionesCentavos)),
    dato(t('Cambios de precio'), String(r.cambiosPrecio)),
    dato(t('Ventas con autorización'), String(r.autorizadas)),
    dato(t('Aperturas de cajón'), String(r.aperturasCajon)),
    dato(t('Retiros a caja fuerte'), dinero(r.efectivo.retirosCentavos)),
    dato(t('Pagos desde caja'), dinero(r.efectivo.pagosCentavos)),
    dato(t('Turnos cerrados por un admin'), String(cerrados.filter((tu) => tu.cierreForzado).length)));
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
    mostrarMensaje($('mensaje'), 'error', t('No se pudieron cargar los turnos: {error}', { error: mensajeError(error) }));
  }
  document.querySelector('.paneles').classList.remove('cargando-datos');
  llenarSelect($('f-tienda'), tiendas.map((tienda) => [tienda.id, tienda.nombre]), t('Todas'));
  llenarSelect($('f-caja'), [...new Map(turnos.map((tu) => [tu.caja, tu.cajaNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), t('Todas'));
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
  // Reporte para personas: rótulos en el idioma elegido; números, fechas y códigos tal cual.
  const filas = [
    [t('Reporte Águila POS'), t('{desde} a {hasta}', { desde, hasta })],
    [],
    [t('Resumen'), t('Monto')],
    [t('Total con impuesto'), csvMonto(r.totalCentavos)],
    [t('Ventas netas'), csvMonto(ventasNetas(r))],
    [t('Ventas con {impuesto}', { impuesto: config.impuestoNombre }), csvMonto(r.baseGravadaCentavos)],
    [t('Ventas tasa cero'), csvMonto(r.baseTasaCeroCentavos)],
    [t('{impuesto} cobrado', { impuesto: config.impuestoNombre }), csvMonto(r.impuestoCentavos)],
    [t('Descuentos'), csvMonto(r.descuentosCentavos)],
    [t('Devoluciones (con impuesto)'), csvMonto(r.devolucionesCentavos)],
    ...METODOS_PAGO.map((m) => [nombreMetodo(m), csvMonto(r.porMetodo[m])]),
    [],
    [t('Día'), t('Turnos'), t('Tickets'), t('Ventas netas'), t('Impuesto'), t('Total')],
    ...porDia.sort((a, b) => a.clave.localeCompare(b.clave)).map((g) => [g.clave, g.turnos.length, g.resumen.ventas, csvMonto(ventasNetas(g.resumen)), csvMonto(g.resumen.impuestoCentavos), csvMonto(g.resumen.totalCentavos)]),
    [],
    [t('Persona'), tc('persona', 'Código'), t('Turnos'), t('Horas'), t('Tickets'), t('Vendido'), t('Diferencia de efectivo')],
    ...porPersona.map((g) => [g.nombre, g.clave, g.turnos.length, (g.resumen.minutos / 60).toFixed(2), g.resumen.ventas, csvMonto(g.resumen.totalCentavos), csvMonto(g.diferencia)]),
    [],
    [t('Caja'), t('Turnos'), t('Tickets'), t('Vendido')],
    ...porCaja.map((g) => [g.nombre, g.turnos.length, g.resumen.ventas, csvMonto(g.resumen.totalCentavos)]),
  ];
  descargarCSV(t('reporte-{desde}-a-{hasta}.csv', { desde, hasta }), filas);
});

observarConfigPos((c) => {
  config = c;
  if (calculo) pintar();
}, () => {});

observarTiendas((lista) => {
  tiendas = lista;
  llenarSelect($('f-tienda'), tiendas.map((tienda) => [tienda.id, tienda.nombre]), t('Todas'));
}, () => {});

cargar();
