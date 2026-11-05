/**
 * Back office · Movimientos en vivo: cada acción de las cajas conforme ocurre
 * (venta iniciada, artículo agregado, pago, venta completada, cancelaciones,
 * efectivo, turnos…), lo más reciente primero. Se actualiza solo. Por defecto
 * los últimos 60 del día; «Ver todos los movimientos» trae el día completo.
 * Un movimiento con recibo abre su transacción.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { t, tc } from './idioma.js';
import { observarEventos } from './pos-datos.js';
import { claveDia, sumarDias, inicioDia, chip, mostrarMensaje } from './bo.js';
import { infoEvento, horaConSegundos, cumpleFiltros, textoEvento, GRUPOS_EVENTO } from './eventos.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'movimientos.html' });

const $ = (id) => document.getElementById(id);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const ULTIMOS = 60;
const parametros = new URLSearchParams(window.location.search);

let dia = REGEX_DIA.test(parametros.get('dia') ?? '') ? parametros.get('dia') : claveDia();
let todos = parametros.get('todos') === '1';
let eventos = [];
let vistos = new Set(); // para resaltar los que llegan en vivo
let primeraCarga = true; // hasta que responda el servidor no se resalta nada (lo de la caché no es «nuevo»)
let firma = '';
let dejar = null;

$('f-grupo').append(...GRUPOS_EVENTO.map(([valor, texto]) => h('option', { value: valor, text: texto })));
$('f-dia').value = dia;
$('contenido').hidden = false;

const filtros = () => ({ caja: $('f-caja').value, cajero: $('f-cajero').value, grupo: $('f-grupo').value });

function llenarSelect(select, pares, todosTexto) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todosTexto }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

function fila(e) {
  const info = infoEvento(e.tipo);
  const { hora, meridiano } = horaConSegundos(e.fecha);
  const nuevo = !primeraCarga && !vistos.has(e.id);
  const contenido = [
    h('div', { class: 'movimiento__hora' }, h('span', { text: hora }), h('span', { text: meridiano })),
    h('div', { class: 'movimiento__cuerpo' },
      h('div', { class: 'movimiento__cabecera' },
        chip(info.etiqueta, info.chip),
        h('strong', { text: e.cajeroNombre || e.cajero }),
        h('span', { class: 'movimiento__caja', text: e.cajaNombre || e.caja })),
      h('p', { class: 'movimiento__texto', text: textoEvento(e) })),
  ];
  const clase = `movimiento${info.tono ? ` movimiento--${info.tono}` : ''}${nuevo ? ' movimiento--nuevo' : ''}`;
  const fila = e.folio
    ? h('a', { class: 'movimiento__fila', href: `transacciones.html?folio=${encodeURIComponent(e.folio)}`, title: t('Abrir el recibo {folio}', { folio: e.folio }) }, contenido)
    : h('div', { class: 'movimiento__fila' }, contenido);
  return h('li', { class: clase, dataset: { tipo: e.tipo } }, fila);
}

function pintar() {
  const cajas = new Map(eventos.map((e) => [e.caja, e.cajaNombre || e.caja]));
  const personas = new Map(eventos.map((e) => [e.cajero, e.cajeroNombre || e.cajero]));
  llenarSelect($('f-caja'), [...cajas].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), t('Todas'));
  llenarSelect($('f-cajero'), [...personas].sort((a, b) => a[1].localeCompare(b[1], 'es')), t('Todos'));

  const f = filtros();
  const lista = eventos.filter((e) => cumpleFiltros(e, f));
  $('lista-movimientos').replaceChildren(...lista.map(fila));
  $('vacio').hidden = lista.length > 0;
  $('vacio').textContent = eventos.length === 0
    ? (dia === claveDia() ? t('Todavía no hay movimientos hoy. Aparecen aquí en cuanto una caja vende.') : t('No hubo movimientos ese día.'))
    : t('Ningún movimiento con esos filtros.');
  $('pie').textContent = todos ? textoTodos(eventos.length, lista.length) : textoUltimos(Math.min(ULTIMOS, eventos.length));
  vistos = new Set(eventos.map((e) => e.id));
}

/** «10 movimientos del día.» (y cuántos dejan los filtros). En inglés, «1 event» en singular. */
function textoTodos(n, filtrados) {
  if (filtrados !== n) {
    const valores = { n, filtrados };
    return n === 1 ? tc('uno', '{n} movimientos del día · {filtrados} con estos filtros.', valores) : t('{n} movimientos del día · {filtrados} con estos filtros.', valores);
  }
  return n === 1 ? tc('uno', '{n} movimientos del día.', { n }) : t('{n} movimientos del día.', { n });
}

function textoUltimos(n) {
  return n === 1
    ? tc('uno', 'Los últimos {n} movimientos del día. «Ver todos los movimientos» trae el día completo.', { n })
    : t('Los últimos {n} movimientos del día. «Ver todos los movimientos» trae el día completo.', { n });
}

function escuchar() {
  dejar?.();
  eventos = [];
  primeraCarga = true;
  const hoy = dia === claveDia();
  $('en-vivo').hidden = !hoy;
  $('btn-todos').textContent = todos ? t('Ver solo los últimos') : t('Ver todos los movimientos');
  for (const boton of document.querySelectorAll('[data-dia]')) {
    boton.setAttribute('aria-pressed', String(sumarDias(claveDia(), Number(boton.dataset.dia)) === dia));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('dia', dia);
  if (todos) url.searchParams.set('todos', '1');
  else url.searchParams.delete('todos');
  window.history.replaceState(null, '', url);
  firma = '';
  dejar = observarEventos({ desde: inicioDia(dia), hasta: inicioDia(sumarDias(dia, 1)), limite: todos ? null : ULTIMOS }, (lista, { desdeCache }) => {
    const nueva = lista.map((e) => e.id).join();
    if (nueva !== firma) { // los movimientos no cambian: si son los mismos, no se vuelve a pintar
      firma = nueva;
      eventos = lista;
      mostrarMensaje($('mensaje'), '', '');
      pintar();
    }
    if (!desdeCache) primeraCarga = false; // de aquí en adelante, lo que llegue se resalta
  }, (error) => mostrarMensaje($('mensaje'), 'error', t('No se pudieron cargar los movimientos: {error}', { error: mensajeError(error) })));
  pintar();
}

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
for (const id of ['f-caja', 'f-cajero', 'f-grupo']) $(id).addEventListener('change', pintar);
$('filtros').addEventListener('submit', (e) => e.preventDefault());
$('btn-todos').addEventListener('click', () => {
  todos = !todos;
  escuchar();
});

// A medianoche, «hoy» cambia de día.
setInterval(() => {
  if ($('en-vivo').hidden === false && dia !== claveDia()) {
    dia = claveDia();
    $('f-dia').value = dia;
    escuchar();
  }
}, 60_000);

escuchar();
