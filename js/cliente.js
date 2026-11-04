/**
 * Pantalla del cliente (caja/cliente.html): lo que ve el cliente mientras le
 * cobran. Funciona de dos maneras:
 *
 *  - Segunda pantalla de la caja: una ventana del mismo navegador, en la
 *    misma computadora (la caja la abre desde «Más funciones → Pantalla del
 *    cliente»). Escucha a la caja por el BroadcastChannel de
 *    js/pantalla-cliente.js: sin internet, sin sesión, sin Firebase.
 *  - Tableta: otro aparato. Un administrador la empareja una vez con una caja
 *    («Usar en una tableta») y desde entonces lee, sin sesión, el documento
 *    pantallas/{huella} que esa caja actualiza (js/cliente-tableta.js, que
 *    solo se carga en la tableta).
 *
 * En los dos casos pinta lo último que recibió: caja cerrada o bienvenida;
 * el ticket conforme se escanea (el último artículo en grande, la lista con
 * cantidad × precio e importe y el total, con su total en efectivo cuando el
 * redondeo a 5 ¢ lo cambia); el cobro (lo pagado y lo que falta); y la venta
 * registrada (gracias y su cambio, unos segundos, luego la bienvenida).
 */
import { CANAL_CLIENTE, SILENCIO_MS, GRACIAS_MS, ANTIGUEDAD_MAXIMA_MS, esEstadoValido } from './pantalla-cliente.js';

const $ = (id) => document.getElementById(id);
const CLAVE_TIENDA = 'aguila.cliente.tienda';
const CLAVE_TABLETA = 'aguila.cliente.tableta';
const CONFIGURAR_MS = 3 * 60 * 1000; // la sesión del administrador en la tableta se cierra sola si se queda así

const leer = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardar = (clave, valor) => {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch { /* sin almacenamiento */ }
};

function leerEmparejamiento() {
  try {
    const e = JSON.parse(leer(CLAVE_TABLETA) ?? 'null');
    return e && /^[0-9a-f]{64}$/.test(e.pantalla ?? '') && typeof e.caja === 'string' ? e : null;
  } catch {
    return null;
  }
}

const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL_CLIENTE) : null;

let emparejamiento = leerEmparejamiento(); // { caja, cajaNombre, tienda, pantalla } en una tableta
let estado = null; // último estado válido recibido
let firma = ''; // para no volver a pintar lo mismo
let recibidoEn = 0; // cuándo cambió el estado por última vez (reloj de este aparato)
let servidorMs = null; // en la tableta: cuándo lo escribió la caja (hora del servidor)
let ultimoMensaje = 0; // segunda pantalla: cuándo habló la caja por última vez
let conectada = false; // ya se recibió algo desde que se abrió la pantalla
let desconectadaPorAdmin = false; // tableta: un administrador borró su pantalla
let configurando = false;
let destacadaAntes = '';
let vistaAntes = '';
let dejarDeEscuchar = null;
let modulo = null; // js/cliente-tableta.js, cargado al necesitarlo

const enTableta = () => !!emparejamiento;
const tableta = () => {
  modulo ??= import('./cliente-tableta.js');
  return modulo;
};

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  return nodo;
}

function vista(nombre) {
  for (const v of ['aviso', 'venta', 'gracias', 'configurar']) $(`vista-${v}`).hidden = v !== nombre;
  document.body.dataset.vista = nombre;
}

function aviso(titulo, texto, tipo = '', { boton = false } = {}) {
  vista('aviso');
  $('aviso-titulo').textContent = titulo;
  $('aviso-texto').textContent = texto;
  $('vista-aviso').dataset.tipo = tipo;
  $('btn-tableta').hidden = !boton;
}

function nombreTienda() {
  return estado?.tienda || emparejamiento?.tienda || leer(CLAVE_TIENDA) || 'Águila Marketplace';
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

/** ¿Lo recibido ya no vale? Segunda pantalla: la caja dejó de hablar. Tableta: un ticket que la caja no toca desde hace mucho. */
function caduco(ahora) {
  if (!estado) return true;
  if (enTableta()) return servidorMs !== null && estado.fase !== 'cerrada' && estado.fase !== 'libre' && ahora - servidorMs > ANTIGUEDAD_MAXIMA_MS;
  return ahora - ultimoMensaje > SILENCIO_MS;
}

function pintar() {
  if (configurando) return;
  const ahora = Date.now();
  $('tienda').textContent = nombreTienda();
  $('caja').textContent = estado?.caja || emparejamiento?.cajaNombre || '';
  $('atiende').textContent = estado?.atiende && conectada && !caduco(ahora) ? `Le atiende ${estado.atiende}` : '';
  $('sin-red').hidden = !enTableta() || navigator.onLine;
  $('btn-configurar').hidden = !enTableta() || !!document.fullscreenElement;

  let actual;
  if (enTableta() && desconectadaPorAdmin) {
    actual = 'desconectada';
    if (actual !== vistaAntes) aviso('Tableta sin caja', `Un administrador desconectó esta tableta de ${emparejamiento.cajaNombre}. Toca «Configurar» para emparejarla de nuevo.`, 'configurar');
  } else if (enTableta() && !conectada) {
    actual = 'conectando';
    if (actual !== vistaAntes) aviso('¡Bienvenido!', nombreTienda(), 'bienvenida');
  } else if (!enTableta() && !canal) {
    actual = 'sin-canal';
    if (actual !== vistaAntes) aviso('Pantalla del cliente', 'Este navegador no puede recibir a la caja. Usa Chrome o Edge al día.', 'error', { boton: true });
  } else if (!enTableta() && !conectada) {
    actual = 'esperando';
    if (actual !== vistaAntes) {
      aviso('Pantalla del cliente', 'En la segunda pantalla de la caja: abre la caja en esta misma computadora y este navegador. En una tableta: toca «Usar en una tableta» y que un administrador elija la caja.', 'configurar', { boton: true });
    }
  } else if (caduco(ahora) || estado.fase === 'libre' || (estado.fase === 'cobrado' && ahora - recibidoEn > GRACIAS_MS)) {
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

/** Llega un estado de la caja (por el canal o por la tableta). */
function recibir(nuevo, { servidor = null } = {}) {
  conectada = true;
  ultimoMensaje = Date.now();
  if (!esEstadoValido(nuevo)) return;
  servidorMs = servidor;
  const texto = JSON.stringify(nuevo);
  if (texto === firma) return;
  firma = texto;
  estado = nuevo;
  recibidoEn = Date.now();
  if (estado.tienda) guardar(CLAVE_TIENDA, estado.tienda);
}

// ------------------------------------------------------------- segunda pantalla: canal con la caja

if (canal) {
  canal.addEventListener('message', ({ data }) => {
    if (enTableta() || !data || typeof data !== 'object') return;
    if (data.tipo === 'estado') {
      recibir(data.estado);
    } else if (data.tipo === 'adios') {
      // La caja se cerró o se está recargando: bienvenida hasta que vuelva a hablar.
      ultimoMensaje = Date.now();
      estado = null;
      firma = '';
    }
    pintar();
  });
  if (!enTableta()) canal.postMessage({ tipo: 'hola' });
}

// ------------------------------------------------------------- tableta: escuchar su pantalla

async function escucharTableta() {
  dejarDeEscuchar?.();
  dejarDeEscuchar = null;
  conectada = false;
  desconectadaPorAdmin = false;
  estado = null;
  firma = '';
  vistaAntes = '';
  pintar();
  try {
    const m = await tableta();
    await m.sinSesion();
    dejarDeEscuchar = m.observarPantalla(emparejamiento.pantalla, (datos) => {
      if (!datos) {
        conectada = true;
        desconectadaPorAdmin = true;
        estado = null;
        firma = '';
      } else {
        desconectadaPorAdmin = false;
        recibir(datos.estado, { servidor: datos.actualizadoMs });
      }
      pintar();
    }, (error) => console.warn('Pantalla del cliente (tableta)', error?.code ?? error));
  } catch (error) {
    console.warn('No se pudo conectar la tableta', error);
  }
}

// ------------------------------------------------------------- tableta: configurar (un administrador)

let temporizadorConfigurar = null;
let sesionAdmin = null; // { personal, cajas } mientras el administrador elige

function mensajeConfigurar(texto, tipo = 'error') {
  $('t-mensaje').hidden = !texto;
  $('t-mensaje').textContent = texto ?? '';
  $('t-mensaje').dataset.tipo = tipo;
}

function vigilarConfigurar() {
  clearTimeout(temporizadorConfigurar);
  temporizadorConfigurar = setTimeout(() => cerrarConfigurar(), CONFIGURAR_MS);
}

function abrirConfigurar() {
  configurando = true;
  sesionAdmin = null;
  vista('configurar');
  $('form-tableta').hidden = false;
  $('t-cajas').hidden = true;
  $('t-secreto').value = '';
  mensajeConfigurar(null);
  $('t-actual').textContent = enTableta() ? `Ahora esta tableta muestra ${emparejamiento.cajaNombre}.` : '';
  $('t-identificador').focus();
  vigilarConfigurar();
}

async function cerrarConfigurar() {
  clearTimeout(temporizadorConfigurar);
  if (sesionAdmin) await (await tableta()).sinSesion();
  sesionAdmin = null;
  configurando = false;
  vistaAntes = '';
  pintar();
}

function pintarCajas() {
  const lista = $('t-lista');
  lista.replaceChildren(...sesionAdmin.cajas.map((caja) => {
    const li = el('li', 'configurar-cliente__caja');
    const datos = el('div', 'configurar-cliente__datos');
    datos.append(el('strong', null, caja.nombre), el('span', null, caja.tienda), el('small', null, caja.conectada ? 'Ya tiene una tableta' : 'Sin tableta'));
    const usar = el('button', 'boton-cliente boton-cliente--principal', 'Mostrar esta caja');
    usar.type = 'button';
    usar.addEventListener('click', () => elegirCaja(caja));
    li.append(datos, usar);
    if (caja.conectada) {
      const quitar = el('button', 'boton-cliente', 'Desconectar tableta');
      quitar.type = 'button';
      quitar.addEventListener('click', () => desconectarCaja(caja));
      li.append(quitar);
    }
    return li;
  }));
}

async function elegirCaja(caja) {
  vigilarConfigurar();
  mensajeConfigurar('Emparejando…', 'info');
  try {
    const m = await tableta();
    emparejamiento = await m.emparejar(caja, sesionAdmin.personal);
    sesionAdmin = null;
    guardar(CLAVE_TABLETA, JSON.stringify(emparejamiento));
    guardar(CLAVE_TIENDA, emparejamiento.tienda);
    clearTimeout(temporizadorConfigurar);
    configurando = false;
    await escucharTableta();
  } catch (error) {
    mensajeConfigurar((await tableta()).mensajeDe(error));
  }
}

async function desconectarCaja(caja) {
  vigilarConfigurar();
  if (!window.confirm(`¿Desconectar la tableta de ${caja.nombre}? Esa caja deja de mandarle su ticket.`)) return;
  try {
    await (await tableta()).desconectar(caja);
    caja.conectada = false;
    pintarCajas();
    mensajeConfigurar(`${caja.nombre} ya no tiene tableta.`, 'ok');
  } catch (error) {
    mensajeConfigurar((await tableta()).mensajeDe(error));
  }
}

$('btn-tableta').addEventListener('click', abrirConfigurar);
$('btn-configurar').addEventListener('click', abrirConfigurar);
$('t-cancelar').addEventListener('click', cerrarConfigurar);
$('t-volver').addEventListener('click', cerrarConfigurar);
$('form-tableta').addEventListener('submit', async (e) => {
  e.preventDefault();
  vigilarConfigurar();
  const boton = $('t-entrar');
  boton.disabled = true;
  mensajeConfigurar('Comprobando…', 'info');
  try {
    const m = await tableta();
    sesionAdmin = await m.entrarAdmin($('t-identificador').value, $('t-secreto').value);
    mensajeConfigurar(null);
    $('form-tableta').hidden = true;
    $('t-cajas').hidden = false;
    pintarCajas();
  } catch (error) {
    mensajeConfigurar((await tableta()).mensajeDe(error));
  } finally {
    boton.disabled = false;
    $('t-secreto').value = '';
  }
});
document.addEventListener('pointerdown', () => { if (configurando) vigilarConfigurar(); });

// ------------------------------------------------------------- reloj, pantalla completa, cursor y pantalla encendida

function reloj() {
  const f = new Date();
  const h24 = f.getHours();
  $('reloj').textContent = `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(f.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
}

function alternarPantallaCompleta() {
  if (configurando) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('btn-completa').addEventListener('click', alternarPantallaCompleta);
document.addEventListener('dblclick', alternarPantallaCompleta);
document.addEventListener('fullscreenchange', () => {
  $('btn-completa').hidden = !!document.fullscreenElement;
  pintar();
});
window.addEventListener('online', pintar);
window.addEventListener('offline', pintar);

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
if (enTableta()) escucharTableta();
setInterval(() => {
  reloj();
  pintar(); // silencio de la caja, ticket viejo y fin del «gracias»
  if (canal && !enTableta() && (!conectada || Date.now() - ultimoMensaje > SILENCIO_MS)) canal.postMessage({ tipo: 'hola' });
}, 1000);
