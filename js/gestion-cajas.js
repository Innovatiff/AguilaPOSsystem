/**
 * Back office · Cajas: alta y edición de las cajas registradoras de cada
 * tienda. El turno (quién la tiene abierta) solo lo cambian la propia caja o
 * el cierre desde Turnos; aquí se ve y se enlaza.
 */
import { requerirPersonal, mensajeError, RAIZ } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarCajas, crearCaja, editarCaja } from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { chip, hora, mostrarMensaje } from './bo.js';
import { t, tc } from './idioma.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'gestion/cajas.html' });

const $ = (id) => document.getElementById(id);
const formulario = $('form-caja');
const mensaje = $('c-mensaje');
let cajas = [];
let tiendas = [];
let editando = null;

$('enlace-caja').textContent = new URL(`${RAIZ}caja/`, window.location.href).href;
$('contenido').hidden = false;

const nombreTienda = (id) => tiendas.find((tienda) => tienda.id === id)?.nombre ?? id;

function modo(caja) {
  editando = caja;
  $('c-guardar').textContent = caja ? t('Guardar cambios') : t('Agregar caja');
  $('c-cancelar').hidden = !caja;
  if (caja) {
    $('c-nombre').value = caja.nombre;
    $('c-numero').value = String(caja.numero);
    $('c-tienda').value = caja.tienda;
    $('c-activo').checked = caja.activo;
    $('c-nombre').focus();
  } else {
    formulario.reset();
    $('c-activo').checked = true;
    if (tiendas.length) $('c-tienda').value = tiendas.find((tienda) => tienda.activo)?.id ?? tiendas[0].id;
    const siguiente = Math.max(0, ...cajas.filter((c) => c.tienda === $('c-tienda').value).map((c) => c.numero)) + 1;
    if (siguiente <= 99) {
      $('c-numero').value = String(siguiente);
      $('c-nombre').value = `Caja ${siguiente}`;
    }
  }
}

function pintarTiendas() {
  const actual = $('c-tienda').value;
  $('c-tienda').replaceChildren(...tiendas.map((tienda) => h('option', { value: tienda.id, text: tienda.activo ? `${tienda.nombre}` : t('{nombre} (inactiva)', { nombre: tienda.nombre }) })));
  if (tiendas.some((tienda) => tienda.id === actual)) $('c-tienda').value = actual;
}

function pintarCajas() {
  $('cajas-vacio').hidden = cajas.length > 0;
  $('tabla-cajas').hidden = cajas.length === 0;
  $('tabla-cajas').tBodies[0].replaceChildren(...cajas.map((caja) => {
    const turno = caja.turnoActual
      ? h('a', { href: `${RAIZ}turnos.html?turno=${encodeURIComponent(caja.turnoActual)}`, text: t('{cajera} desde las {hora}', { cajera: caja.turnoCajeroNombre, hora: hora(caja.turnoDesde) }) })
      : h('span', { class: 'nota', text: '—' });
    const estado = !caja.activo ? chip(t('Desactivada'), 'aviso') : caja.turnoActual ? chip(tc('estado', 'Turno abierto'), 'abierto') : chip(t('Libre'), 'neutro');
    return h('tr', { class: caja.activo ? null : 'inactivo' },
      h('td', { class: 'num', text: String(caja.numero) }),
      h('td', null, h('strong', { text: caja.nombre }), h('span', { class: 'secundario monoespaciada', text: caja.id })),
      h('td', { text: nombreTienda(caja.tienda) }),
      h('td', null, estado),
      h('td', null, turno),
      h('td', { class: 'acciones-fila' },
        h('button', { type: 'button', class: 'boton boton--pequeno', text: t('Editar'), onclick: () => modo(caja) }),
        h('button', { type: 'button', class: 'boton boton--pequeno', text: caja.activo ? t('Desactivar') : t('Activar'), onclick: () => alternar(caja) })));
  }));
}

async function alternar(caja) {
  if (caja.activo && caja.turnoActual && !window.confirm(t('{caja} tiene un turno abierto. Si la desactivas, ese turno sigue hasta que se cierre, pero nadie podrá abrir otro. ¿Desactivarla?', { caja: caja.nombre }))) return;
  try {
    await editarCaja(caja.id, { ...caja, activo: !caja.activo }, personal.usuario);
    mostrarMensaje(mensaje, 'ok', caja.activo ? t('{caja} desactivada.', { caja: caja.nombre }) : t('{caja} activada.', { caja: caja.nombre }));
  } catch (error) {
    mostrarMensaje(mensaje, 'error', mensajeError(error));
  }
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!formulario.reportValidity()) return;
  const datos = {
    nombre: $('c-nombre').value.trim(),
    numero: Number.parseInt($('c-numero').value, 10),
    tienda: $('c-tienda').value,
    activo: $('c-activo').checked,
  };
  if (!Number.isInteger(datos.numero) || datos.numero < 1 || datos.numero > 99) {
    mostrarMensaje(mensaje, 'error', t('El número de caja va de 1 a 99 (sale en el folio de los tickets).'));
    return;
  }
  const repetida = cajas.find((c) => c.tienda === datos.tienda && c.numero === datos.numero && c.id !== editando?.id);
  if (repetida) {
    const valores = { numero: datos.numero, tienda: nombreTienda(datos.tienda), caja: repetida.nombre };
    mostrarMensaje(mensaje, 'error', repetida.activo
      ? t('Ya existe la caja {numero} en {tienda} ({caja}).', valores)
      : t('Ya existe la caja {numero} en {tienda} ({caja}, desactivada).', valores));
    return;
  }
  if (editando?.turnoActual && (editando.numero !== datos.numero || editando.tienda !== datos.tienda)) {
    mostrarMensaje(mensaje, 'error', t('Esta caja tiene un turno abierto: cambia su número o su tienda después de cerrarlo.'));
    return;
  }
  $('c-guardar').disabled = true;
  try {
    if (editando) {
      await editarCaja(editando.id, datos, personal.usuario);
      mostrarMensaje(mensaje, 'ok', t('{caja} guardada.', { caja: datos.nombre }));
    } else {
      const id = `${datos.tienda}-${datos.numero}`;
      if (cajas.some((c) => c.id === id)) throw Object.assign(new Error(t('Ya existe una caja con el identificador {id}.', { id })), { code: 'caja/existe' });
      await crearCaja(id, datos, personal.usuario);
      mostrarMensaje(mensaje, 'ok', t('{caja} creada. Asígnala a una computadora abriendo la caja en ella.', { caja: datos.nombre }));
    }
    modo(null);
  } catch (error) {
    mostrarMensaje(mensaje, 'error', error?.code === 'caja/existe' ? error.message : mensajeError(error));
  } finally {
    $('c-guardar').disabled = false;
  }
});

$('c-cancelar').addEventListener('click', () => modo(null));
$('c-tienda').addEventListener('change', () => {
  if (editando) return;
  const siguiente = Math.max(0, ...cajas.filter((c) => c.tienda === $('c-tienda').value).map((c) => c.numero)) + 1;
  if (siguiente <= 99) {
    $('c-numero').value = String(siguiente);
    $('c-nombre').value = `Caja ${siguiente}`;
  }
});

let tiendasListas = false;
let cajasListas = false;
let formularioListo = false;
/** El formulario propone tienda y número cuando ya llegaron las tiendas y las cajas. */
function prepararFormulario() {
  if (formularioListo || !tiendasListas || !cajasListas) return;
  formularioListo = true;
  if (!editando) modo(null);
}

observarTiendas((lista) => {
  tiendas = lista;
  tiendasListas = true;
  pintarTiendas();
  pintarCajas();
  prepararFormulario();
}, (error) => mostrarMensaje(mensaje, 'error', mensajeError(error)));

observarCajas((lista) => {
  cajas = lista;
  cajasListas = true;
  pintarCajas();
  prepararFormulario();
}, (error) => mostrarMensaje(mensaje, 'error', mensajeError(error)));
