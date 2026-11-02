/**
 * Back office · Inicio: lo que pasa hoy en las cajas, al momento (ventas,
 * tickets, formas de pago, ventas por hora, cajas con turno abierto y los
 * últimos tickets), más el estado del catálogo y del personal.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { h } from './dom.js';
import { observarVentasDelDia, observarCajas, observarConfigPos } from './pos-datos.js';
import { observarCatalogo, observarTiendas } from './productos.js';
import { pendienteImpresion } from './esquema.js';
import { armarFichaPersonal } from './identidad.js';
import { db, doc, setDoc, collection, onSnapshot, Timestamp } from './firebase.js';
import { METODOS_PAGO, NOMBRE_METODO } from './ticket.js';
import { milisDe } from './turnos.js';
import { configConDefectos } from './config-pos.js';
import { dinero, claveDia, fechaLarga, hora, saludo, metodosDe, chip, abrirTicket } from './bo.js';
import { graficaColumnas, barraSegmentada } from './grafica.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'index.html' });

const $ = (id) => document.getElementById(id);
const fallo = (que) => (error) => avisar(`No se pudo cargar ${que}: ${mensajeError(error)}`, 'error', 0);

/** Colores de la barra de formas de pago: orden categórico fijo, validado (ver dataviz). */
const COLOR_METODO = Object.freeze({ efectivo: '#2a78d6', debito: '#eb6834', credito: '#1baf7a', otro: '#eda100' });
const HORA_APERTURA = 7;
const HORA_CIERRE = 21;

let dia = claveDia();
let ventas = [];
let cajas = [];
let tiendas = new Map();
let config = configConDefectos(null);
let dejarVentas = null;

$('saludo').textContent = saludo(personal.nombre);
$('contenido').hidden = false;

const grafica = graficaColumnas($('grafica-horas'), {
  descripcion: 'Ventas por hora de hoy',
  formatoValor: (centavos) => dinero(centavos),
});

// ------------------------------------------------------------- resumen del día

function resumirDia() {
  const r = { total: 0, tickets: 0, devoluciones: 0, devuelto: 0, vendido: 0, articulos: 0, impuesto: 0, netas: 0, porMetodo: {}, porHora: new Map(), porTurno: new Map() };
  for (const m of METODOS_PAGO) r.porMetodo[m] = 0;
  for (const v of ventas) {
    r.total += v.totalCentavos;
    r.impuesto += v.impuestoCentavos;
    r.netas += v.baseGravadaCentavos + v.baseTasaCeroCentavos;
    if (v.tipo === 'devolucion') {
      r.devoluciones += 1;
      r.devuelto += -v.totalCentavos;
    } else {
      r.tickets += 1;
      r.vendido += v.totalCentavos;
      r.articulos += v.articulos;
    }
    for (const m of METODOS_PAGO) r.porMetodo[m] += v.porMetodo?.[m] ?? 0;
    const ms = milisDe(v.fecha);
    if (ms !== null) {
      const clave = new Date(ms).getHours();
      const celda = r.porHora.get(clave) ?? { total: 0, tickets: 0 };
      celda.total += v.totalCentavos;
      if (v.tipo !== 'devolucion') celda.tickets += 1;
      r.porHora.set(clave, celda);
    }
    r.porTurno.set(v.turno, (r.porTurno.get(v.turno) ?? 0) + v.totalCentavos);
  }
  return r;
}

function pintarKpis(r) {
  $('kpi-total').textContent = dinero(r.total);
  $('kpi-total-detalle').textContent = r.devuelto ? `Todas las cajas, con impuesto · ${dinero(r.devuelto)} devuelto` : 'Todas las cajas, con impuesto';
  $('kpi-tickets').textContent = r.tickets.toLocaleString('en-CA');
  $('kpi-devoluciones').textContent = r.devoluciones === 1 ? '1 devolución' : `${r.devoluciones} devoluciones`;
  $('kpi-promedio').textContent = r.tickets ? dinero(Math.round(r.vendido / r.tickets)) : '—';
  $('kpi-articulos').textContent = r.tickets ? `${(r.articulos / r.tickets).toFixed(1)} artículos por ticket` : 'Sin ventas todavía';
  $('kpi-impuesto-etiqueta').textContent = `${config.impuestoNombre} cobrado`;
  $('kpi-impuesto').textContent = dinero(r.impuesto);
  $('kpi-netas').textContent = `Ventas netas sin impuesto: ${dinero(r.netas)}`;
}

function pintarHoras(r) {
  const horas = [...r.porHora.keys()];
  const desde = Math.min(HORA_APERTURA, ...horas);
  const hasta = Math.max(HORA_CIERRE, ...horas);
  const datos = [];
  for (let hh = desde; hh <= hasta; hh += 1) {
    const celda = r.porHora.get(hh) ?? { total: 0, tickets: 0 };
    datos.push({
      etiqueta: `${String(hh).padStart(2, '0')}:00`,
      valor: Math.max(0, celda.total),
      detalle: celda.tickets === 1 ? '1 ticket' : `${celda.tickets} tickets`,
    });
  }
  grafica.actualizar(datos);
  $('tabla-horas').tBodies[0].replaceChildren(...datos.filter((d) => d.valor > 0 || r.porHora.has(Number(d.etiqueta.slice(0, 2)))).map((d) => {
    const celda = r.porHora.get(Number(d.etiqueta.slice(0, 2)));
    return h('tr', null, h('td', { text: `${d.etiqueta}–${d.etiqueta.slice(0, 2)}:59` }), h('td', { class: 'num', text: String(celda?.tickets ?? 0) }), h('td', { class: 'num', text: dinero(celda?.total ?? 0) }));
  }));
}

function pintarPagos(r) {
  const cobrado = METODOS_PAGO.reduce((acc, m) => acc + Math.max(0, r.porMetodo[m]), 0);
  const partes = METODOS_PAGO.map((m) => ({ nombre: NOMBRE_METODO[m], valor: Math.max(0, r.porMetodo[m]), color: COLOR_METODO[m], texto: dinero(r.porMetodo[m]) }));
  $('barra-pagos').replaceChildren(barraSegmentada(partes, 'Formas de pago de hoy'));
  $('lista-pagos').replaceChildren(...METODOS_PAGO.map((m) => h('li', null,
    h('span', { class: 'muestra-color', style: `background:${COLOR_METODO[m]}` }),
    h('span', { text: NOMBRE_METODO[m] }),
    h('span', { class: 'parte', text: cobrado > 0 ? `${Math.round((Math.max(0, r.porMetodo[m]) / cobrado) * 100)} %` : '' }),
    h('span', { class: 'cifra', text: dinero(r.porMetodo[m]) }))));
}

function pintarCajas(r) {
  $('cajas-vacio').hidden = cajas.length > 0;
  $('lista-cajas').replaceChildren(...cajas.map((caja) => {
    const tienda = tiendas.get(caja.tienda)?.nombre ?? caja.tienda;
    let estado;
    let detalle;
    if (!caja.activo) {
      estado = chip('Desactivada', 'aviso');
      detalle = tienda;
    } else if (caja.turnoActual) {
      estado = chip('Abierta', 'abierto');
      detalle = `${caja.turnoCajeroNombre} desde las ${hora(caja.turnoDesde)} · ${dinero(r.porTurno.get(caja.turnoActual) ?? 0)} hoy`;
    } else {
      estado = chip('Libre', 'neutro');
      detalle = tienda;
    }
    const nombre = caja.turnoActual
      ? h('a', { href: `turnos.html?turno=${encodeURIComponent(caja.turnoActual)}`, text: caja.nombre })
      : h('span', { text: caja.nombre });
    return h('li', null, h('strong', null, nombre), estado, h('small', { text: detalle }));
  }));
}

function pintarUltimos() {
  const ultimos = [...ventas].sort((a, b) => (milisDe(b.fecha) ?? 0) - (milisDe(a.fecha) ?? 0)).slice(0, 8);
  $('ultimos-vacio').hidden = ultimos.length > 0;
  $('tabla-ultimos').hidden = ultimos.length === 0;
  $('tabla-ultimos').tBodies[0].replaceChildren(...ultimos.map((v) => {
    const fila = h('tr', { tabindex: 0, dataset: { id: v.id } },
      h('td', { text: hora(v.fecha) }),
      h('td', null, v.folio, v.tipo === 'devolucion' ? h('span', { class: 'secundario', text: 'Devolución' }) : null),
      h('td', { text: v.cajaNombre }),
      h('td', { text: v.cajeroNombre }),
      h('td', { text: metodosDe(v) }),
      h('td', { class: 'num', text: dinero(v.totalCentavos) }));
    return fila;
  }));
}

function abrirFila(evento) {
  const fila = evento.target.closest('tr[data-id]');
  if (!fila) return;
  const venta = ventas.find((v) => v.id === fila.dataset.id);
  if (venta) {
    abrirTicket(venta, {
      tienda: tiendas.get(venta.tienda),
      config,
      alVerTurno: (turno) => { window.location.href = `turnos.html?turno=${encodeURIComponent(turno)}`; },
    });
  }
}
$('tabla-ultimos').addEventListener('click', abrirFila);
$('tabla-ultimos').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') abrirFila(e);
});

function pintarTodo() {
  const r = resumirDia();
  pintarKpis(r);
  pintarHoras(r);
  pintarPagos(r);
  pintarCajas(r);
  pintarUltimos();
}

// ------------------------------------------------------------- datos en vivo

function escucharDia() {
  dejarVentas?.();
  $('fecha-hoy').textContent = `${fechaLarga(dia)} · todas las cajas, al momento`;
  dejarVentas = observarVentasDelDia(dia, (lista) => {
    ventas = lista;
    pintarTodo();
  }, fallo('las ventas de hoy'));
}
escucharDia();

// A medianoche el tablero pasa solo al día nuevo.
setInterval(() => {
  if (claveDia() !== dia) {
    dia = claveDia();
    ventas = [];
    escucharDia();
  }
}, 60000);

observarCajas((lista) => {
  cajas = lista;
  pintarTodo();
}, fallo('las cajas'));

observarConfigPos((c) => {
  config = c;
  pintarTodo();
}, fallo('la configuración del POS'));

observarTiendas((lista) => {
  tiendas = new Map(lista.map((t) => [t.id, t]));
  $('ind-tiendas').textContent = String(lista.filter((t) => t.activo).length);
  pintarTodo();
}, fallo('las tiendas'));

observarCatalogo(({ catalogo }) => {
  let activos = 0;
  let pendientes = 0;
  for (const p of catalogo.values()) {
    if (!p.activo) continue;
    activos += 1;
    if (pendienteImpresion(p)) pendientes += 1;
  }
  $('ind-productos').textContent = activos.toLocaleString('en-CA');
  $('ind-pendientes').textContent = pendientes.toLocaleString('en-CA');
}, fallo('el catálogo'));

onSnapshot(collection(db, 'staff'), (resultado) => {
  $('ind-empleados').textContent = String(resultado.docs.filter((d) => d.data().activo === true).length);
}, fallo('el personal'));

// Ficha anterior a Gestión (solo nombre, rol, activo): se completa una vez, sin cambiar nada más.
if (!personal.completa) {
  const ahora = Timestamp.fromMillis(Date.now());
  const ficha = { ...armarFichaPersonal({ usuario: personal.usuario, tipo: 'correo', nombre: personal.nombre, rol: personal.rol, activo: true, tienda: personal.tienda }, personal.usuario), creadoEn: ahora, actualizadoEn: ahora };
  setDoc(doc(db, 'staff', personal.usuario), ficha).catch((error) => avisar(`No se pudo completar tu ficha: ${mensajeError(error)}`, 'error', 0));
}

