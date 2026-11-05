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
import { t, tc } from './idioma.js';
import { observarTurnosAbiertos, leerTurnosEntre, leerTurnoCompleto, cerrarTurno, observarVentasDelDia, observarConfigPos } from './pos-datos.js';
import { observarTiendas, esperarConfirmacion } from './productos.js';
import { METODOS_PAGO, nombreMetodo } from './ticket.js';
import { resumirTurno, minutosTurno, diferenciasResumen, milisDe, nombreMovimiento, ventasNetas } from './turnos.js';
import { reciboTurno, imprimir } from './recibo.js';
import { configConDefectos } from './config-pos.js';
import { centavosDesdeTexto } from './precios.js';
import {
  dinero, claveDia, sumarDias, inicioDia, fechaHora, hora, formatearDuracion, chip, abrirTicket,
  descargarCSV, csvMonto, mostrarMensaje, metodosDe, textoMotivo,
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

const minutosDe = (tu) => (tu.estado === 'cerrado' && tu.resumen ? tu.resumen.minutos : minutosTurno(tu));

function estadoTurno(tu) {
  const chips = [];
  if (tu.estado === 'abierto') chips.push(chip(t('Abierto'), 'abierto'));
  else if (tu.diferenciaCentavos === null || tu.diferenciaCentavos === undefined) chips.push(chip(t('Sin conteo'), 'neutro'));
  else if (tu.diferenciaCentavos === 0) chips.push(chip(t('Cuadra'), 'abierto'));
  else if (tu.diferenciaCentavos < 0) chips.push(chip(t('Faltante'), 'alerta'));
  else chips.push(chip(t('Sobrante'), 'aviso'));
  if (tu.cierreForzado) chips.push(chip(t('Cerrado por admin'), 'neutro'));
  return chips;
}

/** Plurales del inglés para textos que en español van con «(s)» o siempre en plural (así el español queda igual). */
const cajasVendiendo = (n) => (n === 1 ? tc('uno', '{n} caja(s) vendiendo', { n }) : t('{n} caja(s) vendiendo', { n }));
const personas = (n) => (n === 1 ? tc('uno', '{n} persona(s)', { n }) : t('{n} persona(s)', { n }));
const cuantosTurnos = (n) => (n === 1 ? t('1 turno') : t('{n} turnos', { n }));

// ------------------------------------------------------------- abiertos ahora

function pintarAbiertos() {
  const vendidoPorTurno = new Map();
  for (const v of ventasHoy) vendidoPorTurno.set(v.turno, (vendidoPorTurno.get(v.turno) ?? 0) + v.totalCentavos);
  const lista = [...abiertos].sort((a, b) => (milisDe(a.abiertoEn) ?? 0) - (milisDe(b.abiertoEn) ?? 0));
  $('abiertos-vacio').hidden = lista.length > 0;
  $('tabla-abiertos').hidden = lista.length === 0;
  $('abiertos-nota').textContent = lista.length ? cajasVendiendo(lista.length) : '';
  $('tabla-abiertos').tBodies[0].replaceChildren(...lista.map((tu) => h('tr', { tabindex: 0, dataset: { id: tu.id } },
    h('td', null, tu.cajeroNombre, h('span', { class: 'secundario', text: tu.cajero })),
    h('td', { text: tu.cajaNombre }),
    h('td', { text: fechaHora(tu.abiertoEn) }),
    h('td', { class: 'num', text: formatearDuracion(minutosTurno(tu)) }),
    h('td', { class: 'num', text: dinero(tu.fondoInicialCentavos) }),
    h('td', { class: 'num', text: dinero(vendidoPorTurno.get(tu.id) ?? 0) }),
    h('td', { class: 'num' }, h('button', { type: 'button', class: 'boton boton--pequeno', text: t('Ver') })))));
}

// ------------------------------------------------------------- periodo

const filtrosActuales = () => ({ caja: $('f-caja').value, persona: $('f-persona').value, estado: $('f-estado').value });

function cumple(tu, f) {
  if (f.caja && tu.caja !== f.caja) return false;
  if (f.persona && tu.cajero !== f.persona) return false;
  if (f.estado === 'cerrado' && tu.estado !== 'cerrado') return false;
  if (f.estado === 'abierto' && tu.estado !== 'abierto') return false;
  if (f.estado === 'diferencia' && !(tu.diferenciaCentavos)) return false;
  if (f.estado === 'forzado' && !tu.cierreForzado) return false;
  return true;
}

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

function filtrados() {
  const f = filtrosActuales();
  return turnos.filter((tu) => cumple(tu, f)).sort((a, b) => (milisDe(b.abiertoEn) ?? 0) - (milisDe(a.abiertoEn) ?? 0));
}

function pintarPeriodo() {
  llenarSelect($('f-caja'), [...new Map(turnos.map((tu) => [tu.caja, tu.cajaNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })), t('Todas'));
  llenarSelect($('f-persona'), [...new Map(turnos.map((tu) => [tu.cajero, tu.cajeroNombre]))].sort((a, b) => a[1].localeCompare(b[1], 'es')), t('Todas'));
  const lista = filtrados();
  let minutos = 0;
  let vendido = 0;
  let faltantes = 0;
  let nFaltantes = 0;
  let sobrantes = 0;
  let nSobrantes = 0;
  let cerrados = 0;
  for (const tu of lista) {
    minutos += minutosDe(tu);
    if (tu.estado === 'cerrado') {
      cerrados += 1;
      vendido += tu.resumen?.totalCentavos ?? 0;
      if (tu.diferenciaCentavos < 0) {
        faltantes += -tu.diferenciaCentavos;
        nFaltantes += 1;
      } else if (tu.diferenciaCentavos > 0) {
        sobrantes += tu.diferenciaCentavos;
        nSobrantes += 1;
      }
    }
  }
  $('k-turnos').textContent = String(lista.length);
  $('k-turnos-detalle').textContent = t('{cerrados} cerrados · {abiertos} abiertos', { cerrados, abiertos: lista.length - cerrados });
  $('k-horas').textContent = formatearDuracion(minutos);
  $('k-horas-detalle').textContent = personas(new Set(lista.map((tu) => tu.cajero)).size);
  $('k-vendido').textContent = dinero(vendido);
  $('k-faltantes').textContent = dinero(faltantes);
  $('k-faltantes-detalle').textContent = cuantosTurnos(nFaltantes);
  $('k-sobrantes').textContent = dinero(sobrantes);
  $('k-sobrantes-detalle').textContent = cuantosTurnos(nSobrantes);

  // En español «1 turnos» (como siempre); en inglés, «1 shift».
  $('contador').textContent = lista.length !== turnos.length
    ? t('{n} de {total} turnos', { n: lista.length, total: turnos.length })
    : lista.length === 1 ? tc('uno', '{n} turnos', { n: 1 }) : t('{n} turnos', { n: lista.length });
  $('vacio').hidden = lista.length > 0;
  $('tabla-turnos').hidden = lista.length === 0;
  $('tabla-turnos').tBodies[0].replaceChildren(...lista.map((tu) => {
    const r = tu.resumen;
    return h('tr', { tabindex: 0, dataset: { id: tu.id } },
      h('td', null, tu.cajeroNombre, h('span', { class: 'secundario', text: tu.cajero })),
      h('td', { text: tu.cajaNombre }),
      h('td', { text: fechaHora(tu.abiertoEn) }),
      h('td', { text: tu.cerradoEn ? fechaHora(tu.cerradoEn) : '—' }),
      h('td', { class: 'num', text: formatearDuracion(minutosDe(tu)) }),
      h('td', { class: 'num', text: r ? String(r.ventas + r.devoluciones) : '—' }),
      h('td', { class: 'num', text: r ? dinero(r.totalCentavos) : '—' }),
      h('td', { class: 'num', text: r ? dinero(r.efectivo.esperadoCentavos) : '—' }),
      h('td', { class: 'num', text: tu.efectivoContadoCentavos === null || tu.efectivoContadoCentavos === undefined ? '—' : dinero(tu.efectivoContadoCentavos) }),
      h('td', { class: 'num', text: tu.diferenciaCentavos === null || tu.diferenciaCentavos === undefined ? '—' : dinero(tu.diferenciaCentavos) }),
      h('td', null, estadoTurno(tu)));
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
    mostrarMensaje($('mensaje'), 'error', t('No se pudieron cargar los turnos: {error}', { error: mensajeError(error) }));
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
    mostrarMensaje($('mensaje'), 'error', t('No se pudo leer el turno: {error}', { error: mensajeError(error) }));
    return;
  }
  const { turno, ventas, movimientos } = datos;
  if (!turno) {
    mostrarMensaje($('mensaje'), 'error', t('Ese turno no existe.'));
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
    filaDato(t('Persona'), `${turno.cajeroNombre} (${turno.cajero})`),
    filaDato(t('Caja'), `${turno.cajaNombre} · ${turno.tiendaNombre}`),
    filaDato(t('Apertura'), fechaHora(turno.abiertoEn)),
    filaDato(t('Cierre'), abierto ? t('Sigue abierto') : fechaHora(turno.cerradoEn)),
    filaDato(t('Horas en caja'), formatearDuracion(abierto ? minutosTurno(turno) : resumen.minutos)),
    filaDato(t('Fondo inicial'), dinero(turno.fondoInicialCentavos)),
    filaDato(t('Efectivo esperado'), dinero(e.esperadoCentavos)),
    turno.efectivoContadoCentavos !== null && turno.efectivoContadoCentavos !== undefined ? filaDato(t('Contado'), dinero(turno.efectivoContadoCentavos)) : null,
    turno.diferenciaCentavos !== null && turno.diferenciaCentavos !== undefined ? filaDato(t('Diferencia'), h('strong', { text: dinero(turno.diferenciaCentavos) })) : null,
    turno.cierreForzado ? filaDato(t('Cerró'), t('{quien} (administrador)', { quien: turno.cerradoPor })) : null,
    turno.notaCierre ? filaDato(t('Nota'), turno.notaCierre) : null);

  const cifras = h('div', { class: 'datos-bo' },
    datoResumen(t('Tickets'), String(resumen.ventas + resumen.devoluciones)),
    datoResumen(t('Total'), dinero(resumen.totalCentavos)),
    datoResumen(t('Ventas netas'), dinero(ventasNetas(resumen))),
    datoResumen(config.impuestoNombre, dinero(resumen.impuestoCentavos)),
    ...METODOS_PAGO.map((m) => datoResumen(nombreMetodo(m), dinero(resumen.porMetodo[m] ?? 0))),
    datoResumen(t('Descuentos'), dinero(resumen.descuentosCentavos)),
    datoResumen(t('Devoluciones'), `${resumen.devoluciones} · ${dinero(resumen.devolucionesCentavos)}`),
    datoResumen(t('Líneas anuladas'), `${resumen.lineasAnuladas} · ${dinero(resumen.lineasAnuladasCentavos)}`),
    datoResumen(t('Tickets cancelados'), `${resumen.cancelaciones} · ${dinero(resumen.cancelacionesCentavos)}`),
    datoResumen(t('Aperturas de cajón'), String(resumen.aperturasCajon)),
    datoResumen(t('Con autorización'), String(resumen.autorizadas)));

  const ordenadas = [...ventas].sort((a, b) => (milisDe(a.fecha) ?? 0) - (milisDe(b.fecha) ?? 0));
  const tablaVentas = h('table', { class: 'tabla tabla--compacta tabla--clic' },
    h('thead', null, h('tr', null, h('th', { text: t('Hora') }), h('th', { text: t('Ticket') }), h('th', { text: t('Pago') }), h('th', { class: 'num', text: t('Total') }))),
    h('tbody', null, ordenadas.map((v) => h('tr', { tabindex: 0, dataset: { id: v.id }, class: v.tipo === 'devolucion' ? 'fila--devolucion' : null },
      h('td', { text: hora(v.fecha) }), h('td', { class: 'monoespaciada', text: v.folio }), h('td', { text: metodosDe(v) }), h('td', { class: 'num', text: dinero(v.totalCentavos) })))));
  tablaVentas.addEventListener('click', (ev) => {
    const fila = ev.target.closest('tr[data-id]');
    const venta = fila && ventas.find((v) => v.id === fila.dataset.id);
    if (venta) abrirTicket(venta, { tienda, config });
  });
  const ordenMov = [...movimientos].sort((a, b) => (milisDe(a.fecha) ?? 0) - (milisDe(b.fecha) ?? 0));
  const tablaMovimientos = h('table', { class: 'tabla tabla--compacta' },
    h('thead', null, h('tr', null, h('th', { text: t('Hora') }), h('th', { text: tc('efectivo', 'Movimiento') }), h('th', { text: t('Motivo') }), h('th', { class: 'num', text: t('Monto') }))),
    h('tbody', null, ordenMov.map((m) => h('tr', null,
      h('td', { text: hora(m.fecha) }), h('td', { text: nombreMovimiento(m.tipo) }), h('td', { text: textoMotivo(m) }),
      h('td', { class: 'num', text: m.tipo === 'apertura' ? '' : dinero(m.importeCentavos) })))));

  const mensaje = h('p', { class: 'mensaje', role: 'status', hidden: true });
  const botonCorte = h('button', { type: 'button', class: 'boton', text: abierto ? t('Imprimir corte X') : t('Imprimir corte Z') });
  const botonVerificar = abierto ? null : h('button', { type: 'button', class: 'boton boton--claro', text: t('Verificar contra las ventas') });
  const botonCerrarTurno = abierto ? h('button', { type: 'button', class: 'boton boton--peligro', text: t('Cerrar este turno') }) : null;
  const titulo = t('Turno de {cajera} · {caja}', { cajera: turno.cajeroNombre, caja: turno.cajaNombre });
  const dialogo = h('dialog', { class: 'editor editor--turno', 'aria-label': t('Turno de {cajera}', { cajera: turno.cajeroNombre }) },
    h('div', { class: 'editor__form' },
      h('header', { class: 'editor__cabecera' },
        h('h2', null, `${titulo} `, estadoTurno(turno)),
        h('button', { type: 'button', class: 'boton boton--secundario', 'data-cerrar': '', text: t('Cerrar') })),
      mensaje,
      h('div', { class: 'editor__cuerpo editor__cuerpo--ticket' },
        h('div', null,
          ficha,
          cifras,
          h('h3', { class: 'subtitulo-bo', text: t('Tickets ({n})', { n: ventas.length }) }),
          ventas.length ? tablaVentas : h('p', { class: 'nota', text: t('Sin tickets.') }),
          h('h3', { class: 'subtitulo-bo', text: t('Movimientos de efectivo ({n})', { n: movimientos.length }) }),
          movimientos.length ? tablaMovimientos : h('p', { class: 'nota', text: t('Sin retiros, entradas ni aperturas de cajón.') })),
        h('div', { class: 'vista-recibo-bo' }, vista)),
      h('footer', { class: 'editor__pie' }, botonCorte, botonVerificar, botonCerrarTurno)));

  dialogo.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cerrar]')) dialogo.close();
  });
  botonCorte.addEventListener('click', () => imprimir(corte()));
  botonVerificar?.addEventListener('click', () => {
    if (!turno.resumen) {
      mostrarMensaje(mensaje, 'error', t('Este turno no tiene resumen guardado.'));
      return;
    }
    const diferencias = diferenciasResumen(turno.resumen, recalculado);
    if (diferencias.length === 0) {
      mostrarMensaje(mensaje, 'ok', t('Cuadra: el corte guardado coincide con los {tickets} tickets y {movimientos} movimientos registrados.', { tickets: ventas.length, movimientos: movimientos.length }));
    } else {
      // {campo} es el nombre del campo del resumen (ventas, totalCentavos…): se muestra tal cual.
      const lista = diferencias.map((d) => t('{campo}: guardado {guardado}, ahora {ahora}', {
        campo: d.campo,
        guardado: d.campo.startsWith('ventas') || d.campo === 'devoluciones' ? d.guardado : dinero(d.guardado),
        ahora: d.campo.startsWith('ventas') || d.campo === 'devoluciones' ? d.recalculado : dinero(d.recalculado),
      })).join(' · ');
      mostrarMensaje(mensaje, 'error', t('No cuadra ({diferencias}). Suele pasar si una caja sin conexión envió tickets después del cierre.', { diferencias: lista }));
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
    const contado = h('input', { id: 'cierre-contado', inputmode: 'decimal', autocomplete: 'off', placeholder: t('Opcional, ej. 154.50') });
    // Nota propuesta, editable: se guarda tal como queda (en el idioma de quien cierra), como una nota escrita a mano.
    const nota = h('input', { id: 'cierre-nota', autocomplete: 'off', maxlength: 200, value: t('Cerrado desde el back office') });
    const mensaje = h('p', { class: 'mensaje', role: 'status', hidden: true });
    const confirmar = h('button', { type: 'submit', class: 'boton boton--peligro', text: t('Cerrar el turno') });
    const forma = h('form', { class: 'editor__form', novalidate: true },
      h('header', { class: 'editor__cabecera' }, h('h2', { text: t('Cerrar el turno de {cajera}', { cajera: turno.cajeroNombre }) })),
      h('div', { class: 'editor__cuerpo editor__cuerpo--simple' },
        h('p', { class: 'nota', text: t('{caja} · abierto desde {desde}. La caja queda libre y el turno se cierra a tu nombre. Si la caja sigue encendida, la cajera verá que su turno se cerró.', { caja: turno.cajaNombre, desde: fechaHora(turno.abiertoEn) }) }),
        h('div', { class: 'campo' }, h('label', { for: 'cierre-contado', text: t('Efectivo contado en el cajón ($)') }), contado),
        h('div', { class: 'campo' }, h('label', { for: 'cierre-nota', text: t('Nota') }), nota),
        mensaje),
      h('footer', { class: 'editor__pie' }, confirmar, h('button', { type: 'button', class: 'boton boton--claro', 'data-cancelar': '', text: t('Cancelar') })));
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
        if (estado === 'pendiente') throw new Error(t('Sin conexión con el servidor: el cierre se enviará al volver la red.'));
        resultado = true;
        dialogo.close();
      } catch (error) {
        mostrarMensaje(mensaje, 'error', t('No se pudo cerrar: {error}', { error: error?.code ? mensajeError(error) : error.message }));
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
  // Reporte para personas (horas): encabezados y «sí» en el idioma elegido; números, fechas y códigos tal cual.
  const filas = [[t('persona'), t('codigo'), t('caja'), t('apertura'), t('cierre'), t('minutos'), t('horas'), t('tickets'), t('vendido'), t('efectivo_esperado'), t('contado'), t('diferencia'), t('cerrado_por_admin')]];
  for (const tu of [...filtrados()].reverse()) {
    const minutos = minutosDe(tu);
    filas.push([
      tu.cajeroNombre, tu.cajero, tu.cajaNombre, fechaHora(tu.abiertoEn), tu.cerradoEn ? fechaHora(tu.cerradoEn) : '', minutos, (minutos / 60).toFixed(2),
      tu.resumen ? tu.resumen.ventas + tu.resumen.devoluciones : '', tu.resumen ? csvMonto(tu.resumen.totalCentavos) : '',
      tu.resumen ? csvMonto(tu.resumen.efectivo.esperadoCentavos) : '', csvMonto(tu.efectivoContadoCentavos), csvMonto(tu.diferenciaCentavos), tu.cierreForzado ? t('sí') : '',
    ]);
  }
  descargarCSV(t('turnos-{desde}-a-{hasta}.csv', { desde, hasta }), filas);
});

observarTurnosAbiertos((lista) => {
  abiertos = lista;
  pintarAbiertos();
}, (error) => mostrarMensaje($('mensaje'), 'error', t('No se pudieron cargar los turnos abiertos: {error}', { error: mensajeError(error) })));

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

observarTiendas((lista) => { tiendas = new Map(lista.map((tienda) => [tienda.id, tienda])); }, () => {});
observarConfigPos((c) => { config = c; }, () => {});

const turnoPedido = parametros.get('turno');
await cargarPeriodo();
if (turnoPedido) abrirDetalle(turnoPedido);
