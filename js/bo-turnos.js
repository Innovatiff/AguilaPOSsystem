/**
 * Back office · Turnos: los abiertos en este momento y los de un periodo,
 * con horas en caja, ventas y cuadre del efectivo. La ficha de un turno
 * muestra su corte (Z, o X si sigue abierto), sus ventas y movimientos,
 * permite reimprimir el corte, verificar el resumen guardado contra las
 * ventas y, si sigue abierto, cerrarlo como administrador.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarTurnosAbiertos, leerTurnosEntre, leerTurnoCompleto, cerrarTurno, observarVentasDelDia, observarConfigPos } from './pos-datos.js';
import { observarTiendas, esperarConfirmacion } from './productos.js';
import { METODOS_PAGO, NOMBRE_METODO } from './ticket.js';
import { resumirTurno, minutosTurno, diferenciasResumen, milisDe, NOMBRE_MOVIMIENTO, ventasNetas } from './turnos.js';
import { reciboTurno, imprimir } from './recibo.js';
import { configConDefectos } from './config-pos.js';
import { centavosDesdeTexto } from './precios.js';
import {
  dinero, claveDia, sumarDias, inicioDia, fechaHora, hora, formatearDuracion, chip, abrirTicket,
  descargarCSV, csvMonto, mostrarMensaje, metodosDe,
} from './bo.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'turnos.html' });

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(window.location.search);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;

let desde = REGEX_DIA.test(parametros.get('desde') ?? '') ? parametros.get('desde') : sumarDias(claveDia(), -6);
let hasta = REGEX_DIA.test(parametros.get('hasta') ?? '') ? parametros.get('hasta') : claveDia();
let turnos = [];
let abiertos = [];
let ventasHoy = [];
let tiendas = new Map();
let config = configConDefectos(null);

$('f-desde').value = desde;
$('f-hasta').value = hasta;
$('contenido').hidden = false;

const minutosDe = (t) => (t.estado === 'cerrado' && t.resumen ? t.resumen.minutos : minutosTurno(t));

function estadoTurno(t) {
  const chips = [];
  if (t.estado === 'abierto') chips.push(chip('Abierto', 'abierto'));
  else if (t.diferenciaCentavos === null || t.diferenciaCentavos === undefined) chips.push(chip('Sin conteo', 'neutro'));
  else if (t.diferenciaCentavos === 0) chips.push(chip('Cuadra', 'abierto'));
  else if (t.diferenciaCentavos < 0) chips.push(chip('Faltante', 'alerta'));
  else chips.push(chip('Sobrante', 'aviso'));
  if (t.cierreForzado) chips.push(chip('Cerrado por admin', 'neutro'));
  return chips;
}

// ------------------------------------------------------------- abiertos ahora

function pintarAbiertos() {
  const vendidoPorTurno = new Map();
  for (const v of ventasHoy) vendidoPorTurno.set(v.turno, (vendidoPorTurno.get(v.turno) ?? 0) + v.totalCentavos);
  const lista = [...abiertos].sort((a, b) => (milisDe(a.abiertoEn) ?? 0) - (milisDe(b.abiertoEn) ?? 0));
  $('abiertos-vacio').hidden = lista.length > 0;
  $('tabla-abiertos').hidden = lista.length === 0;
  $('abiertos-nota').textContent = lista.length ? `${lista.length} caja(s) vendiendo` : '';
  $('tabla-abiertos').tBodies[0].replaceChildren(...lista.map((t) => h('tr', { tabindex: 0, dataset: { id: t.id } },
    h('td', null, t.cajeroNombre, h('span', { class: 'secundario', text: t.cajero })),
    h('td', { text: t.cajaNombre }),
    h('td', { text: fechaHora(t.abiertoEn) }),
    h('td', { class: 'num', text: formatearDuracion(minutosTurno(t)) }),
    h('td', { class: 'num', text: dinero(t.fondoInicialCentavos) }),
    h('td', { class: 'num', text: dinero(vendidoPorTurno.get(t.id) ?? 0) }),
    h('td', { class: 'num' }, h('button', { type: 'button', class: 'boton boton--pequeno', text: 'Ver' })))));
}

// ------------------------------------------------------------- periodo

const filtrosActuales = () => ({ caja: $('f-caja').value, persona: $('f-persona').value, estado: $('f-estado').value });

function cumple(t, f) {
  if (f.caja && t.caja !== f.caja) return false;
  if (f.persona && t.cajero !== f.persona) return false;
  if (f.estado === 'cerrado' && t.estado !== 'cerrado') return false;
  if (f.estado === 'abierto' && t.estado !== 'abierto') return false;
  if (f.estado === 'diferencia' && !(t.diferenciaCentavos)) return false;
  if (f.estado === 'forzado' && !t.cierreForzado) return false;
  return true;
}

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

function filtrados() {
  const f = filtrosActuales();
  return turnos.filter((t) => cumple(t, f)).sort((a, b) => (milisDe(b.abiertoEn) ?? 0) - (milisDe(a.abiertoEn) ?? 0));
}

function pintarPeriodo() {
  llenarSelect($('f-caja'), [...new Map(turnos.map((t) => [t.caja, t.cajaNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), 'Todas');
  llenarSelect($('f-persona'), [...new Map(turnos.map((t) => [t.cajero, t.cajeroNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es')), 'Todas');
  const lista = filtrados();
  let minutos = 0;
  let vendido = 0;
  let faltantes = 0;
  let nFaltantes = 0;
  let sobrantes = 0;
  let nSobrantes = 0;
  let cerrados = 0;
  for (const t of lista) {
    minutos += minutosDe(t);
    if (t.estado === 'cerrado') {
      cerrados += 1;
      vendido += t.resumen?.totalCentavos ?? 0;
      if (t.diferenciaCentavos < 0) {
        faltantes += -t.diferenciaCentavos;
        nFaltantes += 1;
      } else if (t.diferenciaCentavos > 0) {
        sobrantes += t.diferenciaCentavos;
        nSobrantes += 1;
      }
    }
  }
  $('k-turnos').textContent = String(lista.length);
  $('k-turnos-detalle').textContent = `${cerrados} cerrados · ${lista.length - cerrados} abiertos`;
  $('k-horas').textContent = formatearDuracion(minutos);
  $('k-horas-detalle').textContent = `${new Set(lista.map((t) => t.cajero)).size} persona(s)`;
  $('k-vendido').textContent = dinero(vendido);
  $('k-faltantes').textContent = dinero(faltantes);
  $('k-faltantes-detalle').textContent = nFaltantes === 1 ? '1 turno' : `${nFaltantes} turnos`;
  $('k-sobrantes').textContent = dinero(sobrantes);
  $('k-sobrantes-detalle').textContent = nSobrantes === 1 ? '1 turno' : `${nSobrantes} turnos`;

  $('contador').textContent = lista.length === turnos.length ? `${lista.length} turnos` : `${lista.length} de ${turnos.length} turnos`;
  $('vacio').hidden = lista.length > 0;
  $('tabla-turnos').hidden = lista.length === 0;
  $('tabla-turnos').tBodies[0].replaceChildren(...lista.map((t) => {
    const r = t.resumen;
    return h('tr', { tabindex: 0, dataset: { id: t.id } },
      h('td', null, t.cajeroNombre, h('span', { class: 'secundario', text: t.cajero })),
      h('td', { text: t.cajaNombre }),
      h('td', { text: fechaHora(t.abiertoEn) }),
      h('td', { text: t.cerradoEn ? fechaHora(t.cerradoEn) : '—' }),
      h('td', { class: 'num', text: formatearDuracion(minutosDe(t)) }),
      h('td', { class: 'num', text: r ? String(r.ventas + r.devoluciones) : '—' }),
      h('td', { class: 'num', text: r ? dinero(r.totalCentavos) : '—' }),
      h('td', { class: 'num', text: r ? dinero(r.efectivo.esperadoCentavos) : '—' }),
      h('td', { class: 'num', text: t.efectivoContadoCentavos === null || t.efectivoContadoCentavos === undefined ? '—' : dinero(t.efectivoContadoCentavos) }),
      h('td', { class: 'num', text: t.diferenciaCentavos === null || t.diferenciaCentavos === undefined ? '—' : dinero(t.diferenciaCentavos) }),
      h('td', null, estadoTurno(t)));
  }));
}

async function cargarPeriodo() {
  for (const boton of document.querySelectorAll('[data-periodo]')) boton.setAttribute('aria-pressed', String(periodoDe(boton.dataset.periodo).join() === [desde, hasta].join()));
  const url = new URL(window.location.href);
  url.searchParams.set('desde', desde);
  url.searchParams.set('hasta', hasta);
  url.searchParams.delete('turno');
  window.history.replaceState(null, '', url);
  try {
    turnos = await leerTurnosEntre(inicioDia(desde), inicioDia(sumarDias(hasta, 1)));
    mostrarMensaje($('mensaje'), '', '');
  } catch (error) {
    turnos = [];
    mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar los turnos: ${mensajeError(error)}`);
  }
  pintarPeriodo();
}

function periodoDe(clave) {
  const hoy = claveDia();
  if (clave === 'hoy') return [hoy, hoy];
  if (clave === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
  if (clave === 'semana') return [sumarDias(hoy, -6), hoy];
  return [`${hoy.slice(0, 8)}01`, hoy];
}

// ------------------------------------------------------------- ficha del turno

function filaDato(termino, valor) {
  return [h('dt', { text: termino }), h('dd', null, valor)];
}

function datoResumen(etiqueta, valor) {
  return h('div', { class: 'dato-bo' }, h('span', { text: etiqueta }), h('strong', { text: valor }));
}

async function abrirDetalle(id) {
  let datos;
  try {
    datos = await leerTurnoCompleto(id);
  } catch (error) {
    mostrarMensaje($('mensaje'), 'error', `No se pudo leer el turno: ${mensajeError(error)}`);
    return;
  }
  const { turno, ventas, movimientos } = datos;
  if (!turno) {
    mostrarMensaje($('mensaje'), 'error', 'Ese turno no existe.');
    return;
  }
  const abierto = turno.estado === 'abierto';
  const tienda = tiendas.get(turno.tienda) ?? null;
  const recalculado = resumirTurno({ turno, ventas, movimientos, departamentos: config.departamentos, hasta: abierto ? Date.now() : (milisDe(turno.cerradoEn) ?? Date.now()) });
  const resumen = abierto ? recalculado : (turno.resumen ?? recalculado);
  const corte = () => reciboTurno(turno, resumen, { tienda, config, tipo: abierto ? 'X' : 'Z' });
  const vista = corte();
  vista.classList.add('recibo--vista');

  const e = resumen.efectivo;
  const ficha = h('dl', { class: 'ficha ficha--compacta' },
    filaDato('Persona', `${turno.cajeroNombre} (${turno.cajero})`),
    filaDato('Caja', `${turno.cajaNombre} · ${turno.tiendaNombre}`),
    filaDato('Apertura', fechaHora(turno.abiertoEn)),
    filaDato('Cierre', abierto ? 'Sigue abierto' : fechaHora(turno.cerradoEn)),
    filaDato('Horas en caja', formatearDuracion(abierto ? minutosTurno(turno) : resumen.minutos)),
    filaDato('Fondo inicial', dinero(turno.fondoInicialCentavos)),
    filaDato('Efectivo esperado', dinero(e.esperadoCentavos)),
    turno.efectivoContadoCentavos !== null && turno.efectivoContadoCentavos !== undefined ? filaDato('Contado', dinero(turno.efectivoContadoCentavos)) : null,
    turno.diferenciaCentavos !== null && turno.diferenciaCentavos !== undefined ? filaDato('Diferencia', h('strong', { text: dinero(turno.diferenciaCentavos) })) : null,
    turno.cierreForzado ? filaDato('Cerró', `${turno.cerradoPor} (administrador)`) : null,
    turno.notaCierre ? filaDato('Nota', turno.notaCierre) : null);

  const cifras = h('div', { class: 'datos-bo' },
    datoResumen('Tickets', String(resumen.ventas + resumen.devoluciones)),
    datoResumen('Total', dinero(resumen.totalCentavos)),
    datoResumen('Ventas netas', dinero(ventasNetas(resumen))),
    datoResumen(config.impuestoNombre, dinero(resumen.impuestoCentavos)),
    ...METODOS_PAGO.map((m) => datoResumen(NOMBRE_METODO[m], dinero(resumen.porMetodo[m] ?? 0))),
    datoResumen('Descuentos', dinero(resumen.descuentosCentavos)),
    datoResumen('Devoluciones', `${resumen.devoluciones} · ${dinero(resumen.devolucionesCentavos)}`),
    datoResumen('Líneas anuladas', `${resumen.lineasAnuladas} · ${dinero(resumen.lineasAnuladasCentavos)}`),
    datoResumen('Tickets cancelados', `${resumen.cancelaciones} · ${dinero(resumen.cancelacionesCentavos)}`),
    datoResumen('Aperturas de cajón', String(resumen.aperturasCajon)),
    datoResumen('Con autorización', String(resumen.autorizadas)));

  const ordenadas = [...ventas].sort((a, b) => (milisDe(a.fecha) ?? 0) - (milisDe(b.fecha) ?? 0));
  const tablaVentas = h('table', { class: 'tabla tabla--compacta tabla--clic' },
    h('thead', null, h('tr', null, h('th', { text: 'Hora' }), h('th', { text: 'Ticket' }), h('th', { text: 'Pago' }), h('th', { class: 'num', text: 'Total' }))),
    h('tbody', null, ordenadas.map((v) => h('tr', { tabindex: 0, dataset: { id: v.id }, class: v.tipo === 'devolucion' ? 'fila--devolucion' : null },
      h('td', { text: hora(v.fecha) }), h('td', { class: 'monoespaciada', text: v.folio }), h('td', { text: metodosDe(v) }), h('td', { class: 'num', text: dinero(v.totalCentavos) })))));
  tablaVentas.addEventListener('click', (ev) => {
    const fila = ev.target.closest('tr[data-id]');
    const venta = fila && ventas.find((v) => v.id === fila.dataset.id);
    if (venta) abrirTicket(venta, { tienda, config });
  });
  const ordenMov = [...movimientos].sort((a, b) => (milisDe(a.fecha) ?? 0) - (milisDe(b.fecha) ?? 0));
  const tablaMovimientos = h('table', { class: 'tabla tabla--compacta' },
    h('thead', null, h('tr', null, h('th', { text: 'Hora' }), h('th', { text: 'Movimiento' }), h('th', { text: 'Motivo' }), h('th', { class: 'num', text: 'Monto' }))),
    h('tbody', null, ordenMov.map((m) => h('tr', null,
      h('td', { text: hora(m.fecha) }), h('td', { text: NOMBRE_MOVIMIENTO[m.tipo] ?? m.tipo }), h('td', { text: m.motivo ?? '' }),
      h('td', { class: 'num', text: m.tipo === 'apertura' ? '' : dinero(m.importeCentavos) })))));

  const mensaje = h('p', { class: 'mensaje', role: 'status', hidden: true });
  const botonCorte = h('button', { type: 'button', class: 'boton', text: abierto ? 'Imprimir corte X' : 'Imprimir corte Z' });
  const botonVerificar = abierto ? null : h('button', { type: 'button', class: 'boton boton--claro', text: 'Verificar contra las ventas' });
  const botonCerrarTurno = abierto ? h('button', { type: 'button', class: 'boton boton--peligro', text: 'Cerrar este turno' }) : null;
  const dialogo = h('dialog', { class: 'editor editor--turno', 'aria-label': `Turno de ${turno.cajeroNombre}` },
    h('div', { class: 'editor__form' },
      h('header', { class: 'editor__cabecera' },
        h('h2', null, `Turno de ${turno.cajeroNombre} · ${turno.cajaNombre} `, estadoTurno(turno)),
        h('button', { type: 'button', class: 'boton boton--secundario', 'data-cerrar': '', text: 'Cerrar' })),
      mensaje,
      h('div', { class: 'editor__cuerpo editor__cuerpo--ticket' },
        h('div', null,
          ficha,
          cifras,
          h('h3', { class: 'subtitulo-bo', text: `Tickets (${ventas.length})` }),
          ventas.length ? tablaVentas : h('p', { class: 'nota', text: 'Sin tickets.' }),
          h('h3', { class: 'subtitulo-bo', text: `Movimientos de efectivo (${movimientos.length})` }),
          movimientos.length ? tablaMovimientos : h('p', { class: 'nota', text: 'Sin retiros, entradas ni aperturas de cajón.' })),
        h('div', { class: 'vista-recibo-bo' }, vista)),
      h('footer', { class: 'editor__pie' }, botonCorte, botonVerificar, botonCerrarTurno)));

  dialogo.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cerrar]')) dialogo.close();
  });
  botonCorte.addEventListener('click', () => imprimir(corte()));
  botonVerificar?.addEventListener('click', () => {
    if (!turno.resumen) {
      mostrarMensaje(mensaje, 'error', 'Este turno no tiene resumen guardado.');
      return;
    }
    const diferencias = diferenciasResumen(turno.resumen, recalculado);
    if (diferencias.length === 0) {
      mostrarMensaje(mensaje, 'ok', `Cuadra: el corte guardado coincide con los ${ventas.length} tickets y ${movimientos.length} movimientos registrados.`);
    } else {
      const lista = diferencias.map((d) => `${d.campo}: guardado ${d.campo.startsWith('ventas') || d.campo === 'devoluciones' ? d.guardado : dinero(d.guardado)}, ahora ${d.campo.startsWith('ventas') || d.campo === 'devoluciones' ? d.recalculado : dinero(d.recalculado)}`).join(' · ');
      mostrarMensaje(mensaje, 'error', `No cuadra (${lista}). Suele pasar si una caja sin conexión envió tickets después del cierre.`);
    }
  });
  botonCerrarTurno?.addEventListener('click', async () => {
    const cerrado = await cerrarComoAdmin(turno, ventas, movimientos);
    if (cerrado) {
      dialogo.close();
      await cargarPeriodo();
      abrirDetalle(turno.id);
    }
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  document.body.append(dialogo);
  dialogo.showModal();
}

/** Cierra desde el back office un turno que quedó abierto (la cajera se fue sin cerrar). */
function cerrarComoAdmin(turno, ventas, movimientos) {
  return new Promise((resolver) => {
    const contado = h('input', { id: 'cierre-contado', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Opcional, ej. 154.50' });
    const nota = h('input', { id: 'cierre-nota', autocomplete: 'off', maxlength: 200, value: 'Cerrado desde el back office' });
    const mensaje = h('p', { class: 'mensaje', role: 'status', hidden: true });
    const confirmar = h('button', { type: 'submit', class: 'boton boton--peligro', text: 'Cerrar el turno' });
    const forma = h('form', { class: 'editor__form', novalidate: true },
      h('header', { class: 'editor__cabecera' }, h('h2', { text: `Cerrar el turno de ${turno.cajeroNombre}` })),
      h('div', { class: 'editor__cuerpo editor__cuerpo--simple' },
        h('p', { class: 'nota', text: `${turno.cajaNombre} · abierto desde ${fechaHora(turno.abiertoEn)}. La caja queda libre y el turno se cierra a tu nombre. Si la caja sigue encendida, la cajera verá que su turno se cerró.` }),
        h('div', { class: 'campo' }, h('label', { for: 'cierre-contado', text: 'Efectivo contado en el cajón ($)' }), contado),
        h('div', { class: 'campo' }, h('label', { for: 'cierre-nota', text: 'Nota' }), nota),
        mensaje),
      h('footer', { class: 'editor__pie' }, confirmar, h('button', { type: 'button', class: 'boton boton--claro', 'data-cancelar': '', text: 'Cancelar' })));
    const dialogo = h('dialog', { class: 'editor editor--angosto' }, forma);
    let resultado = false;
    forma.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-cancelar]')) dialogo.close();
    });
    forma.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      let contadoCentavos = null;
      try {
        if (contado.value.trim() !== '') contadoCentavos = centavosDesdeTexto(contado.value);
      } catch (error) {
        mostrarMensaje(mensaje, 'error', error.message);
        return;
      }
      confirmar.disabled = true;
      const resumen = resumirTurno({ turno, ventas, movimientos, departamentos: config.departamentos, hasta: Date.now() });
      const diferencia = contadoCentavos === null ? null : contadoCentavos - resumen.efectivo.esperadoCentavos;
      try {
        const promesa = cerrarTurno({ turno, resumen, contadoCentavos, conteo: null, diferenciaCentavos: diferencia, nota: nota.value.trim() || null, quien: personal.usuario });
        promesa.catch(() => {});
        const estado = await esperarConfirmacion(promesa, 10000);
        if (estado === 'pendiente') throw new Error('Sin conexión con el servidor: el cierre se enviará al volver la red.');
        resultado = true;
        dialogo.close();
      } catch (error) {
        mostrarMensaje(mensaje, 'error', `No se pudo cerrar: ${error?.code ? mensajeError(error) : error.message}`);
        confirmar.disabled = false;
      }
    });
    dialogo.addEventListener('close', () => {
      dialogo.remove();
      resolver(resultado);
    });
    document.body.append(dialogo);
    dialogo.showModal();
    contado.focus();
  });
}

// ------------------------------------------------------------- eventos y datos

function filaClic(tabla) {
  const abrir = (ev) => {
    const fila = ev.target.closest('tr[data-id]');
    if (fila) abrirDetalle(fila.dataset.id);
  };
  tabla.addEventListener('click', abrir);
  tabla.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') abrir(ev);
  });
}
filaClic($('tabla-abiertos'));
filaClic($('tabla-turnos'));

for (const id of ['f-desde', 'f-hasta']) {
  $(id).addEventListener('change', () => {
    if (!REGEX_DIA.test($('f-desde').value) || !REGEX_DIA.test($('f-hasta').value)) return;
    desde = $('f-desde').value;
    hasta = $('f-hasta').value;
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    $('f-desde').value = desde;
    $('f-hasta').value = hasta;
    cargarPeriodo();
  });
}
for (const boton of document.querySelectorAll('[data-periodo]')) {
  boton.addEventListener('click', () => {
    [desde, hasta] = periodoDe(boton.dataset.periodo);
    $('f-desde').value = desde;
    $('f-hasta').value = hasta;
    cargarPeriodo();
  });
}
for (const id of ['f-caja', 'f-persona', 'f-estado']) $(id).addEventListener('change', pintarPeriodo);
$('filtros').addEventListener('submit', (ev) => ev.preventDefault());

$('btn-exportar').addEventListener('click', () => {
  const filas = [['persona', 'codigo', 'caja', 'apertura', 'cierre', 'minutos', 'horas', 'tickets', 'vendido', 'efectivo_esperado', 'contado', 'diferencia', 'cerrado_por_admin']];
  for (const t of [...filtrados()].reverse()) {
    const minutos = minutosDe(t);
    filas.push([
      t.cajeroNombre, t.cajero, t.cajaNombre, fechaHora(t.abiertoEn), t.cerradoEn ? fechaHora(t.cerradoEn) : '', minutos, (minutos / 60).toFixed(2),
      t.resumen ? t.resumen.ventas + t.resumen.devoluciones : '', t.resumen ? csvMonto(t.resumen.totalCentavos) : '',
      t.resumen ? csvMonto(t.resumen.efectivo.esperadoCentavos) : '', csvMonto(t.efectivoContadoCentavos), csvMonto(t.diferenciaCentavos), t.cierreForzado ? 'sí' : '',
    ]);
  }
  descargarCSV(`turnos-${desde}-a-${hasta}.csv`, filas);
});

observarTurnosAbiertos((lista) => {
  abiertos = lista;
  pintarAbiertos();
}, (error) => mostrarMensaje($('mensaje'), 'error', `No se pudieron cargar los turnos abiertos: ${mensajeError(error)}`));

let diaVentas = claveDia();
let dejarVentas = observarVentasDelDia(diaVentas, (lista) => {
  ventasHoy = lista;
  pintarAbiertos();
}, () => {});
setInterval(() => {
  if (claveDia() !== diaVentas) {
    diaVentas = claveDia();
    dejarVentas();
    dejarVentas = observarVentasDelDia(diaVentas, (lista) => {
      ventasHoy = lista;
      pintarAbiertos();
    }, () => {});
  }
  pintarAbiertos();
}, 60000);

observarTiendas((lista) => { tiendas = new Map(lista.map((t) => [t.id, t])); }, () => {});
observarConfigPos((c) => { config = c; }, () => {});

const turnoPedido = parametros.get('turno');
await cargarPeriodo();
if (turnoPedido) abrirDetalle(turnoPedido);
