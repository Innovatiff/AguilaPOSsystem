/**
 * Pantalla del cliente (caja/cliente.html): lo que ve el cliente en la segunda
 * pantalla de la caja. Va en una ventana del mismo navegador que la caja, en
 * la misma computadora (la caja la abre desde «Más funciones → Pantalla del
 * cliente», o se abre esta dirección a mano y se lleva a la otra pantalla).
 *
 * No inicia sesión ni lee Firestore: escucha a la caja por el BroadcastChannel
 * de js/pantalla-cliente.js y pinta lo último que recibió:
 *   - caja cerrada / bienvenida;
 *   - el ticket conforme se escanea: el último artículo en grande, la lista
 *     con cantidad × precio e importe, y el total (con su total en efectivo
 *     cuando el redondeo a 5 ¢ lo cambia);
 *   - el cobro: lo pagado y lo que falta;
 *   - la venta registrada: gracias y su cambio (unos segundos, luego la bienvenida).
 * Si la caja deja de hablar (cerrada, recargando), vuelve a la bienvenida.
 */
import { CANAL_CLIENTE, SILENCIO_MS, GRACIAS_MS, esEstadoValido } from './pantalla-cliente.js';

const $ = (id) => document.getElementById(id);
const CLAVE_TIENDA = 'aguila.cliente.tienda';
const leer = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardar = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } };

const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL_CLIENTE) : null;

let estado = null; // último estado válido que mandó la caja
let firma = ''; // para no volver a pintar lo mismo
let recibidoEn = 0; // cuándo cambió el estado por última vez
let ultimoMensaje = 0; // cuándo habló la caja por última vez
let conectada = false; // la caja habló al menos una vez desde que se abrió esta pantalla
let destacadaAntes = '';
let vistaAntes = '';

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  return nodo;
}

function vista(nombre) {
  for (const v of ['aviso', 'venta', 'gracias']) $(`vista-${v}`).hidden = v !== nombre;
  document.body.dataset.vista = nombre;
}

function aviso(titulo, texto, tipo = '') {
  vista('aviso');
  $('aviso-titulo').textContent = titulo;
  $('aviso-texto').textContent = texto;
  $('vista-aviso').dataset.tipo = tipo;
}

function nombreTienda() {
  return estado?.tienda || leer(CLAVE_TIENDA) || 'Águila Marketplace';
}

// ------------------------------------------------------------- ticket

function nodoLinea(l, ultimaId) {
  const importe = el('span', 'linea-cliente__importe');
  if (l.antes) importe.append(el('s', null, l.antes), ' ');
  importe.append(l.importe);
  const detalle = el('span', 'linea-cliente__detalle', l.detalle);
  if (l.descuento) detalle.append(' · ', el('span', 'linea-cliente__descuento', l.descuento));
  const clases = ['linea-cliente'];
  if (l.id === ultimaId) clases.push('linea-cliente--ultima');
  if (l.negativa) clases.push('linea-cliente--negativa');
  const li = el('li', clases.join(' '));
  li.dataset.id = l.id;
  li.append(el('span', 'linea-cliente__nombre', l.nombre), importe, detalle);
  return li;
}

function pintarVenta(e) {
  vista('venta');
  $('modo').hidden = !e.devolucion;
  $('vista-venta').classList.toggle('venta-cliente--devolucion', !!e.devolucion);

  const destacado = e.ultima;
  $('destacado').hidden = !destacado;
  if (destacado) {
    $('destacado-nombre').textContent = destacado.nombre;
    $('destacado-detalle').textContent = [destacado.detalle, destacado.descuento].filter(Boolean).join(' · ');
    $('destacado-importe').textContent = destacado.importe;
    const marca = `${destacado.id}|${destacado.detalle}|${destacado.importe}`;
    if (marca !== destacadaAntes) {
      // Artículo nuevo o que cambió: se ilumina un momento.
      $('destacado').classList.remove('destacado--nuevo');
      void $('destacado').offsetWidth;
      $('destacado').classList.add('destacado--nuevo');
      destacadaAntes = marca;
    }
  }

  const lista = $('lineas');
  lista.replaceChildren(...(e.ocultas ? [el('li', 'lineas-cliente__ocultas', `… y ${e.ocultas} artículos más arriba`)] : []), ...e.lineas.map((l) => nodoLinea(l, destacado?.id)));
  (lista.querySelector('.linea-cliente--ultima') ?? lista.lastElementChild)?.scrollIntoView({ block: 'nearest' });

  $('t-articulos').textContent = String(e.articulos);
  $('t-subtotal').textContent = e.subtotal;
  $('fila-descuento').hidden = !e.descuento;
  $('t-descuento').textContent = e.descuento ?? '';
  $('t-impuesto-nombre').textContent = e.impuestoNombre;
  $('t-impuesto').textContent = e.impuesto;
  $('t-total-nombre').textContent = e.devolucion ? 'Total a devolver' : 'Total';
  $('t-total').textContent = e.total;
  $('t-efectivo').hidden = !e.totalEfectivo;
  $('t-efectivo').textContent = e.totalEfectivo ? `En efectivo: ${e.totalEfectivo}` : '';
  $('t-ahorro').hidden = !e.ahorro || e.devolucion;
  $('t-ahorro').textContent = e.ahorro ? `Usted ahorra ${e.ahorro}` : '';

  const cobro = e.fase === 'cobro' ? e.cobro : null;
  $('cobro').hidden = !cobro;
  document.body.classList.toggle('cliente--cobrando', !!cobro);
  if (cobro) {
    $('c-pagado').textContent = cobro.pagado;
    $('c-falta-nombre').textContent = e.devolucion ? 'Por devolver' : 'Falta';
    $('c-falta').textContent = cobro.falta;
    $('c-indicacion').textContent = e.devolucion
      ? ''
      : cobro.tarjeta ? 'Pague en la terminal y siga sus indicaciones.' : `Forma de pago: ${cobro.metodo}`;
  }
}

function pintarGracias(e) {
  vista('gracias');
  $('g-mensaje').textContent = e.devolucion ? 'Devolución registrada' : e.mensaje;
  $('g-total-nombre').textContent = e.devolucion ? 'Total devuelto' : 'Total';
  $('g-total').textContent = e.total;
  $('g-pagos-nombre').textContent = e.devolucion ? 'Se le devolvió' : 'Pagó';
  $('g-pagos').textContent = e.pagos.length ? e.pagos.map((p) => `${p.metodo} ${p.importe}`).join(' + ') : '—';
  $('g-cambio-fila').hidden = !e.cambio;
  $('g-cambio').textContent = e.cambio ?? '';
  $('g-ahorro').hidden = !e.ahorro || e.devolucion;
  $('g-ahorro').textContent = e.ahorro ? `Hoy ahorró ${e.ahorro}` : '';
  $('g-folio').textContent = e.folio ? `Ticket ${e.folio}` : '';
}

// ------------------------------------------------------------- pintar según lo último que se sabe

function pintar() {
  const ahora = Date.now();
  $('tienda').textContent = nombreTienda();
  $('caja').textContent = estado?.caja ?? '';
  $('atiende').textContent = estado?.atiende && conectada && ahora - ultimoMensaje <= SILENCIO_MS ? `Le atiende ${estado.atiende}` : '';

  let actual;
  if (!canal) {
    actual = 'sin-canal';
    if (actual !== vistaAntes) aviso('Pantalla del cliente', 'Este navegador no puede recibir a la caja. Usa Chrome o Edge al día, en la misma computadora que la caja.', 'error');
  } else if (!conectada) {
    actual = 'esperando';
    if (actual !== vistaAntes) aviso('Pantalla del cliente', 'Abre la caja en esta misma computadora y este navegador: aquí se verá lo que se escanea, cada precio y el total. Lleva esta ventana a la pantalla del cliente y tócala para verla en pantalla completa.', 'configurar');
  } else if (!estado || ahora - ultimoMensaje > SILENCIO_MS || estado.fase === 'libre' || (estado.fase === 'cobrado' && ahora - recibidoEn > GRACIAS_MS)) {
    actual = `bienvenida|${nombreTienda()}`;
    if (actual !== vistaAntes) aviso('¡Bienvenido!', nombreTienda(), 'bienvenida');
  } else if (estado.fase === 'cerrada') {
    actual = `cerrada|${nombreTienda()}`;
    if (actual !== vistaAntes) aviso('Caja cerrada', nombreTienda(), 'cerrada');
  } else if (estado.fase === 'cobrado') {
    actual = `gracias|${firma}`;
    if (actual !== vistaAntes) pintarGracias(estado);
  } else {
    actual = `venta|${firma}`;
    if (actual !== vistaAntes) pintarVenta(estado);
  }
  vistaAntes = actual;
}

// ------------------------------------------------------------- canal con la caja

if (canal) {
  canal.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;
    ultimoMensaje = Date.now();
    conectada = true;
    if (data.tipo === 'estado' && esEstadoValido(data.estado)) {
      const nueva = JSON.stringify(data.estado);
      if (nueva !== firma) {
        firma = nueva;
        estado = data.estado;
        recibidoEn = Date.now();
        if (estado.tienda) guardar(CLAVE_TIENDA, estado.tienda);
      }
    } else if (data.tipo === 'adios') {
      // La caja se cerró o se está recargando: bienvenida hasta que vuelva a hablar.
      estado = null;
      firma = '';
    }
    pintar();
  });
  canal.postMessage({ tipo: 'hola' });
}

// ------------------------------------------------------------- reloj, pantalla completa, cursor y pantalla encendida

function reloj() {
  const f = new Date();
  const h24 = f.getHours();
  $('reloj').textContent = `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(f.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
}

function alternarPantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('btn-completa').addEventListener('click', alternarPantallaCompleta);
document.addEventListener('dblclick', alternarPantallaCompleta);
document.addEventListener('fullscreenchange', () => {
  $('btn-completa').hidden = !!document.fullscreenElement;
});

let temporizadorCursor = null;
document.addEventListener('pointermove', () => {
  document.body.classList.remove('sin-cursor');
  clearTimeout(temporizadorCursor);
  temporizadorCursor = setTimeout(() => document.body.classList.add('sin-cursor'), 3000);
});

async function mantenerEncendida() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen');
  } catch { /* sin permiso: la pantalla se apaga sola según el sistema */ }
}
document.addEventListener('visibilitychange', mantenerEncendida);
mantenerEncendida();

reloj();
pintar();
setInterval(() => {
  reloj();
  pintar(); // silencio de la caja y fin del «gracias»
  if (canal && (!conectada || Date.now() - ultimoMensaje > SILENCIO_MS)) canal.postMessage({ tipo: 'hola' });
}, 1000);
