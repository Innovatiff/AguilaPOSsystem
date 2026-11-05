/**
 * Caja registradora (/caja/): la pantalla de venta de Águila POS.
 *
 * Flujo: un administrador asigna la computadora a una caja (una sola vez) →
 * la cajera entra con su código y NIP y abre su turno con el fondo de cambio →
 * escanea y cobra → al terminar cuenta el efectivo, confirma con su NIP y se
 * imprime su corte Z con lo vendido y sus horas en la caja.
 *
 * El escáner USB escribe como un teclado: en la pantalla de venta no hay campo
 * de texto, todo lo que se teclea (o escanea) va a la línea de entrada y se
 * procesa con Enter. Los recibos salen por el diálogo de impresión del
 * navegador (o directo con Chrome en --kiosk-printing).
 */
import { auth, onAuthStateChanged, Timestamp } from './firebase.js';
import { iniciarSesion, iniciarSesionConNip, fichaEfectiva, usuarioActual, mensajeError, cerrarSesionSilenciosa } from './auth.js';
import { obtenerClaveCaja } from './clave-caja.js';
import { claveCajaValida, huellaPantalla } from './nip.js';
import { observarCatalogo, buscarPorUPC, esperarConfirmacion } from './productos.js';
import {
  leerConfigPos, leerCaja, listarCajas, leerTienda, leerTurno,
  observarConfigPos, observarCaja, observarTienda, observarTurno,
  turnosAbiertosDe, abrirTurno, cerrarTurno, leerTurnoCompleto,
  observarVentasDeTurno, observarMovimientosDeTurno, guardarVenta, registrarMovimiento, registrarEvento,
  comprobarSecretoEnServidor, autorizarComoAdmin,
} from './pos-datos.js';
import { configConDefectos } from './config-pos.js';
import {
  LIMITES_TICKET, NOMBRE_METODO, calcularTicket, lineaDeProducto, lineaDeDepartamento, lineaAcumulable,
  importeBruto, dividirRedondeado, redondearEfectivo, gramosDesdeTexto, formatearPeso, cantidadDesdeTexto,
  puntosBaseDesdeTexto, formatearPorcentaje, nombreDeProducto, claveDia, folioVenta, folioDesdeTexto,
  armarVenta, validarVenta, interpretarCodigoBalanza, nombreMetodo,
} from './ticket.js';
import { resumirTurno, milisDe, NOMBRE_MOVIMIENTO, nombreMovimiento } from './turnos.js';
import { reciboVenta, reciboTurno, comprobanteMovimiento, comprobanteApertura, imprimir } from './recibo.js';
import { crearVerificador, comprobarVerificador } from './verificador.js';
import * as local from './caja-local.js';
import {
  h, icono, dinero, avisar, sonar, abrirDialogo, confirmar, informar, pedirValor, pedirTexto, elegir,
  tecladoNumerico, hayDialogoAbierto,
} from './caja-ui.js';
import { cobrar } from './caja-pago.js';
import { pedirFondo, contarEfectivo, pedirMovimiento, mostrarCorte } from './caja-turno.js';
import { normalizarUPC } from './upca.js';
import { palabras } from './esquema.js';
import { centavosDesdeTexto } from './precios.js';
import { esNIP } from './identidad.js';
import { CANAL_CLIENTE, LATIDO_MS, RETRASO_TABLETA_MS, REVISAR_TABLETA_MS, estadoCliente } from './pantalla-cliente.js';
import { hayTableta, actualizarPantalla } from './pantalla-remota.js';
// En este archivo «t» es el ticket en muchas funciones: la traducción se llama tx().
// Lo que se guarda (movimientos en vivo) va siempre en español, con tEs() y las
// plantillas de js/eventos.js; en pantalla se traduce con traducirTextoEvento().
import { t as tx, tc, tEs, locale } from './idioma.js';
import { botonIdioma } from './boton-idioma.js';
import { traducirTextoEvento } from './eventos.js';

const $ = (id) => document.getElementById(id);
const PANTALLAS = ['cargando', 'configurar', 'acceso', 'venta'];
/** Si el servidor no confirma en este tiempo, la escritura sigue en cola (sin conexión). */
const ESPERA_CONFIRMACION_MS = 8000;

const estado = {
  pantalla: 'cargando',
  asignacion: null, // { id, nombre, numero, tienda, tiendaNombre } guardado en el equipo
  personal: null, // ficha efectiva de quien tiene la sesión
  turno: null,
  caja: null,
  tienda: null,
  config: configConDefectos(null),
  catalogo: new Map(),
  catalogoListo: false,
  porUPC: new Map(),
  porPLU: new Map(),
  ventas: [],
  movimientos: [],
  pendientes: 0,
  ticket: null,
  seleccion: null,
  resaltar: null,
  entrada: '',
  multiplicador: null,
  sugerencias: [],
  sugerenciaActiva: 0,
  ultimaVenta: null,
  cobrado: null,
  bloqueada: false,
  cerrando: false,
  cerradoFuera: false,
  saliendo: false,
  suscripciones: [],
};

// ===================================================================== utilidades

const fallo = (texto) => Object.assign(new Error(texto), { code: 'caja/aviso' });

function mensajeDe(error) {
  const codigo = String(error?.code ?? '');
  if (codigo.startsWith('caja/')) return error.message;
  if (codigo.startsWith('auth/') || codigo.startsWith('catalogo/') || ['permission-denied', 'unavailable'].includes(codigo)) return mensajeError(error);
  return error?.message || mensajeError(error);
}

/** Errores que se explican a la cajera (NIP equivocado, sin conexión…): no ensucian la consola. */
function registrarError(error) {
  const codigo = String(error?.code ?? '');
  if (!/^(caja|auth|catalogo)\//.test(codigo)) console.error(error);
}

function errorCaja(texto) {
  sonar('error');
  avisar(texto, 'error');
}

/** "08:02" en hora local. */
function hora(valor) {
  const ms = milisDe(valor);
  if (ms === null) return '—';
  const fecha = new Date(ms);
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

function imprimirSeguro(nodos) {
  try {
    imprimir(nodos);
  } catch (error) {
    console.error(error);
    avisar(tx('No se pudo imprimir. Revisa la impresora.'), 'error');
  }
}

let cola = Promise.resolve();
/** Las acciones de la caja se ejecutan en orden (un escaneo no se adelanta a otro). */
function encolar(tarea) {
  cola = cola.then(tarea).catch((error) => {
    registrarError(error);
    errorCaja(mensajeDe(error));
  });
  return cola;
}

const describirDescuento = (d) => (d.tipo === 'porcentaje' ? formatearPorcentaje(d.puntosBase) : dinero(d.centavos));
/** El descuento como se guarda en los movimientos en vivo: siempre como en español («10 %»). */
const descuentoGuardado = (d) => describirDescuento(d).replace(/(\d)%$/, '$1 %');
const deLaTienda = (p, tienda) => !Array.isArray(p.tiendas) || p.tiendas.length === 0 || p.tiendas.includes(tienda);
const nombreConPresentacion = (p) => [nombreDeProducto(p), p.presentacion].filter(Boolean).join(' · ');
const precioProducto = (p) => (p.unidadVenta === 'peso' ? `${dinero(p.precioPorKgCentavos ?? 0)}/kg` : dinero(p.precioCentavos ?? 0));
const detalleProducto = (p) => [p.upc, p.plu ? `PLU ${p.plu}` : null, p.claseFiscal === 'gravado' ? '+Tx' : null, p.activo === false ? tx('INACTIVO') : null]
  .filter(Boolean).join(' · ');

// ===================================================================== pantallas, barra y reloj

function mostrar(pantalla) {
  estado.pantalla = pantalla;
  for (const nombre of PANTALLAS) $(`pantalla-${nombre}`).hidden = nombre !== pantalla;
  pintarBarra();
  avisarCliente();
}

function pintarBarra() {
  const a = estado.asignacion;
  const barraCaja = $('barra-caja');
  barraCaja.replaceChildren();
  if (a) barraCaja.append(h('strong', { text: a.nombre }), ` · ${a.tiendaNombre ?? a.tienda}`);
  const enVenta = estado.pantalla === 'venta' && !!estado.personal;
  $('barra-cajera').hidden = !enVenta;
  if (enVenta) $('barra-cajera').replaceChildren(`${tx('Atiende:')} `, h('strong', { text: estado.personal.nombre }));
  $('btn-bloquear').hidden = !enVenta;
  document.title = a ? `${a.nombre} · Águila POS` : `${tx('Caja')} · Águila POS`;
  pintarRed();
}

function pintarRed() {
  const enLinea = navigator.onLine;
  const pendientes = estado.pantalla === 'venta' ? estado.pendientes : 0;
  let clave = 'en-linea';
  let texto = tx('En línea');
  if (!enLinea) {
    clave = 'sin-conexion';
    texto = pendientes ? tx('Sin conexión · {n} por enviar', { n: pendientes }) : tx('Sin conexión');
  } else if (pendientes) {
    clave = 'enviando';
    texto = tx('Enviando {n}…', { n: pendientes });
  }
  $('barra-estado').dataset.estado = clave;
  $('barra-estado-texto').textContent = texto;
}

const formatoFechaLarga = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function tic() {
  const ahora = new Date();
  const hhmm = hora(ahora.getTime());
  $('barra-reloj').textContent = hhmm;
  $('acceso-reloj').textContent = hhmm;
  const fecha = formatoFechaLarga.format(ahora);
  $('acceso-fecha').textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
}

// ===================================================================== asignar la computadora a una caja

/** `renovar`: la caja ya estaba asignada pero le falta la clave para entrar solo con el NIP. */
function mostrarConfigurar({ renovar = false } = {}) {
  detenerVenta();
  mostrar('configurar');
  $('form-configurar').hidden = false;
  $('config-cajas').hidden = true;
  $('config-mensaje').hidden = true;
  $('config-secreto').value = '';
  $('config-titulo').textContent = renovar ? tx('Un administrador debe configurar esta caja otra vez') : tx('Esta computadora todavía no es una caja');
  $('config-nota').textContent = renovar
    ? tx('Ahora cada colaborador entra solo con su NIP. Para eso, un administrador entra aquí una vez y elige la caja (puede ser la misma).')
    : tx('Un administrador la asigna a una de las cajas dadas de alta en el back office (Cajas). Solo se hace una vez por computadora; después cada colaborador entra solo con su NIP.');
  $('config-identificador').focus();
}

function mensajeConfigurar(texto, tipo = 'error') {
  const m = $('config-mensaje');
  m.hidden = !texto;
  m.textContent = texto ?? '';
  if (tipo === 'error') delete m.dataset.tipo;
  else m.dataset.tipo = tipo;
}

async function configurar(evento) {
  evento.preventDefault();
  const boton = $('config-entrar');
  mensajeConfigurar(null);
  boton.disabled = true;
  boton.textContent = tx('Comprobando…');
  try {
    const { personal } = await iniciarSesion($('config-identificador').value, $('config-secreto').value);
    if (personal.rol !== 'admin') {
      await cerrarSesionSilenciosa();
      throw fallo(tx('Solo un administrador puede asignar esta computadora a una caja.'));
    }
    // La clave de caja queda en el equipo: con ella, cada quien entra solo con su NIP.
    local.guardarClaveCaja(await obtenerClaveCaja(personal.usuario));
    const cajas = (await listarCajas()).filter((c) => c.activo);
    if (cajas.length === 0) {
      await cerrarSesionSilenciosa();
      mensajeConfigurar(tx('No hay cajas activas. Da de alta las cajas en el back office (Cajas) y vuelve aquí.'), 'aviso');
      return;
    }
    const nombres = new Map();
    for (const id of new Set(cajas.map((c) => c.tienda))) nombres.set(id, (await leerTienda(id).catch(() => null))?.nombre ?? id);
    const contenedor = $('config-cajas');
    contenedor.replaceChildren(
      h('p', { class: 'tarjeta-pos__nota', style: 'grid-column: 1 / -1; margin: 0', text: tx('¿Qué caja es esta computadora?') }),
      ...cajas.map((caja) => h('button', {
        type: 'button',
        onclick: () => asignar(caja, nombres.get(caja.tienda)),
      }, h('strong', { text: caja.nombre }), h('span', { text: nombres.get(caja.tienda) }),
      h('small', { text: caja.turnoActual ? tx('Turno abierto: {nombre}', { nombre: caja.turnoCajeroNombre }) : tx('Libre') }))),
    );
    $('form-configurar').hidden = true;
    contenedor.hidden = false;
    contenedor.querySelector('button')?.focus();
  } catch (error) {
    mensajeConfigurar(mensajeDe(error));
  } finally {
    boton.disabled = false;
    boton.textContent = tx('Continuar');
    $('config-secreto').value = '';
  }
}

async function asignar(caja, tiendaNombre) {
  estado.asignacion = { id: caja.id, nombre: caja.nombre, numero: caja.numero, tienda: caja.tienda, tiendaNombre: tiendaNombre ?? caja.tienda };
  Object.assign(tableta, { id: null, activa: false, enviado: '' }); // otra caja, otra pantalla del cliente
  local.guardarAsignacion(estado.asignacion);
  await cerrarSesionSilenciosa().catch(() => {});
  mostrarAcceso();
  avisar(tx('Esta computadora quedó asignada a {caja}.', { caja: caja.nombre }), 'ok');
}

/** Si el administrador renombró la caja o la cambió de número, se actualiza lo guardado en el equipo. */
function actualizarAsignacion(caja, tiendaNombre = null) {
  const a = estado.asignacion;
  const nueva = { ...a, nombre: caja.nombre, numero: caja.numero, tienda: caja.tienda, tiendaNombre: tiendaNombre ?? a.tiendaNombre };
  if (JSON.stringify(nueva) !== JSON.stringify(a)) {
    estado.asignacion = nueva;
    local.guardarAsignacion(nueva);
    pintarBarra();
  }
}

// ===================================================================== acceso: abrir o retomar turno

let campoAccesoActivo = null;
let entrando = false;

function mostrarAcceso({ mensaje = null, tipo = 'error' } = {}) {
  detenerVenta();
  estado.personal = null;
  estado.turno = null;
  mostrar('acceso');
  const a = estado.asignacion;
  $('acceso-caja').textContent = a.nombre;
  $('acceso-tienda').textContent = a.tiendaNombre ?? a.tienda;
  estadoAcceso(null);
  $('acceso-nip').value = '';
  ocupadoAcceso(false);
  mensajeAcceso(mensaje, tipo);
  $('acceso-nip').focus();
}

function mensajeAcceso(texto, tipo = 'error') {
  const m = $('acceso-mensaje');
  m.hidden = !texto;
  m.textContent = texto ?? '';
  if (tipo === 'error') delete m.dataset.tipo;
  else m.dataset.tipo = tipo;
}

function estadoAcceso(texto, tipo = '') {
  const p = $('acceso-estado');
  p.hidden = !texto;
  p.textContent = texto ?? '';
  p.dataset.tipo = tipo;
}

function ocupadoAcceso(ocupado, texto = tx('Entrar')) {
  const boton = $('acceso-entrar');
  boton.disabled = ocupado;
  boton.textContent = ocupado ? texto : tx('Entrar');
  $('acceso-nip').disabled = ocupado;
}

const CREDENCIAL_INCORRECTA = new Set(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials', 'caja/nip-incorrecto']);

/** Entrar solo con el NIP: la clave de la caja dice de quién es (js/nip.js). */
async function entrar() {
  if (entrando) return;
  const nip = $('acceso-nip').value.trim();
  if (!esNIP(nip)) {
    mensajeAcceso(tx('Escribe tu NIP de 6 dígitos.'));
    $('acceso-nip').focus();
    return;
  }
  const clave = local.leerClaveCaja();
  if (!claveCajaValida(clave)) {
    mostrarConfigurar({ renovar: true });
    return;
  }
  entrando = true;
  mensajeAcceso(null);
  ocupadoAcceso(true, tx('Entrando…'));
  let enVenta = false;
  try {
    const { personal } = await iniciarSesionConNip(nip, clave);
    estado.personal = personal;
    enVenta = await prepararTurno(personal, nip);
  } catch (error) {
    registrarError(error);
    mensajeAcceso(CREDENCIAL_INCORRECTA.has(String(error?.code ?? '')) ? tx('NIP incorrecto.') : mensajeDe(error));
  } finally {
    entrando = false;
    if (!enVenta) {
      await cerrarSesionSilenciosa().catch(() => {});
      estado.personal = null;
      ocupadoAcceso(false);
      $('acceso-nip').value = '';
      $('acceso-nip').focus();
    }
  }
}

/** Después de entrar: retoma el turno propio, abre uno nuevo o, si es admin, cierra el de otra persona. */
async function prepararTurno(personal, nip) {
  ocupadoAcceso(true, tx('Revisando la caja…'));
  let caja;
  try {
    caja = await leerCaja(estado.asignacion.id, { servidor: true });
  } catch {
    throw fallo(tx('Sin conexión con el servidor: para abrir o retomar un turno se necesita internet.'));
  }
  if (!caja) throw fallo(tx('Esta caja ya no existe en el back office. Un administrador debe asignar la computadora a otra caja.'));
  if (!caja.activo) throw fallo(tx('{caja} está desactivada en el back office.', { caja: caja.nombre }));
  actualizarAsignacion(caja);

  if (caja.turnoActual) {
    if (caja.turnoCajero === personal.usuario) {
      const turno = await leerTurno(caja.turnoActual);
      if (!turno || turno.estado !== 'abierto') throw fallo(tx('No se pudo recuperar tu turno. Inténtalo de nuevo.'));
      await guardarVerificadorNip(personal, turno, nip);
      await iniciarVenta(turno);
      avisar(tx('Hola de nuevo, {nombre}. Tu turno sigue abierto desde las {hora}.', { nombre: personal.nombre, hora: hora(turno.abiertoEn) }), 'ok');
      return true;
    }
    if (personal.rol === 'admin') {
      await cerrarTurnoAjeno(caja, personal);
      return false;
    }
    estadoAcceso(tx('Turno abierto de {nombre} desde las {hora}.', { nombre: caja.turnoCajeroNombre, hora: hora(caja.turnoDesde) }), 'ocupada');
    throw fallo(tx('La caja está ocupada por {nombre}. Debe cerrar su turno esa persona o un administrador.', { nombre: caja.turnoCajeroNombre }));
  }

  const abiertos = await turnosAbiertosDe(personal.usuario);
  const otro = abiertos.find((t) => t.caja !== caja.id);
  if (otro) throw fallo(tx('Tienes un turno abierto en {caja} desde las {hora}. Ciérralo en esa caja antes de abrir otro.', { caja: otro.cajaNombre, hora: hora(otro.abiertoEn) }));

  const [config, tienda] = await Promise.all([leerConfigPos().catch(() => estado.config), leerTienda(caja.tienda).catch(() => null)]);
  estado.config = config;
  if (tienda) actualizarAsignacion(caja, tienda.nombre);
  const fondo = await pedirFondo({ sugeridoCentavos: config.fondoSugeridoCentavos });
  if (fondo === null) {
    mensajeAcceso(tx('No se abrió el turno.'), 'info');
    return false;
  }
  ocupadoAcceso(true, tx('Abriendo turno…'));
  const turnoId = await abrirTurno({ caja, tienda, personal, fondoCentavos: fondo });
  const turno = await leerTurno(turnoId);
  registrarEvento({ turno, personal, tipo: 'turno_abierto', texto: tEs('Turno abierto con {fondo} de fondo', { fondo: dinero(fondo) }), importeCentavos: fondo });
  await guardarVerificadorNip(personal, turno, nip);
  imprimirSeguro(comprobanteApertura(turno, { tienda, config }));
  await iniciarVenta(turno);
  avisar(tx('Turno abierto con {fondo} de fondo. ¡Buen turno, {nombre}!', { fondo: dinero(fondo), nombre: personal.nombre }), 'ok');
  return true;
}

/** Hash del NIP para poder desbloquear la caja sin conexión (nunca se guarda el NIP). */
async function guardarVerificadorNip(personal, turno, nip) {
  try {
    const verificador = await crearVerificador(nip);
    local.guardarVerificador(turno.caja, { usuario: personal.usuario, turno: turno.id, ...verificador });
  } catch (error) {
    console.warn('No se pudo guardar el verificador del NIP', error);
  }
}

// ===================================================================== venta: arranque y salida

/** Identificador local del ticket: une sus movimientos en vivo (eventos/) en el historial de auditoría. */
const idTicket = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function nuevoTicket() {
  return {
    id: idTicket(),
    turno: estado.turno?.id ?? null,
    lineas: [],
    descuentoTicket: null,
    modo: 'venta',
    ventaOriginal: null,
    autorizacion: null,
    lineasAnuladas: 0,
    lineasAnuladasCentavos: 0,
  };
}

function fallaListener(nombre) {
  return (error) => {
    console.error(`Falló la lectura de ${nombre}`, error);
    if (estado.pantalla === 'venta' && !estado.saliendo) avisar(tx('No se pudo leer {nombre}: {error}', { nombre, error: mensajeDe(error) }), 'error');
  };
}

async function iniciarVenta(turno, { bloqueada = false } = {}) {
  detenerVenta();
  cola = Promise.resolve();
  estado.turno = turno;
  estado.cerrando = false;
  estado.cerradoFuera = false;
  estado.saliendo = false;
  const guardado = local.leerTicket(turno.caja);
  estado.ticket = guardado?.turno === turno.id && Array.isArray(guardado.lineas) ? { ...nuevoTicket(), ...guardado } : nuevoTicket();
  estado.seleccion = null;
  estado.entrada = '';
  estado.multiplicador = null;
  estado.cobrado = null;
  estado.ultimaVenta = null;
  $('ticket-cobrado').hidden = true;

  const yo = estado.personal.usuario;
  const s = estado.suscripciones;
  s.push(observarConfigPos((config) => {
    estado.config = config;
    pintarDepartamentos();
    pintarTicket();
  }, fallaListener(tx('la configuración'))));
  s.push(observarTienda(turno.tienda, (tienda) => {
    estado.tienda = tienda;
  }, fallaListener(tx('la tienda'))));
  s.push(observarCaja(turno.caja, (caja, meta) => {
    estado.caja = caja;
    if (caja && !meta.pendiente && !meta.desdeCache && caja.turnoActual !== turno.id) turnoCerradoFuera();
  }, fallaListener(tx('la caja'))));
  s.push(observarTurno(turno.id, (t, meta) => {
    if (!t) return;
    estado.turno = t;
    if (t.estado === 'cerrado' && !meta.pendiente) turnoCerradoFuera();
  }, fallaListener(tx('el turno'))));
  s.push(observarVentasDeTurno(turno.id, yo, (ventas, { pendientes }) => {
    estado.ventas = ventas;
    estado.pendientes = pendientes;
    pintarRed();
  }, fallaListener(tx('las ventas del turno'))));
  s.push(observarMovimientosDeTurno(turno.id, yo, (movimientos) => {
    estado.movimientos = movimientos;
  }, fallaListener(tx('los movimientos de efectivo'))));
  s.push(observarCatalogo(({ catalogo, desdeCache }) => {
    estado.catalogo = catalogo;
    if (!desdeCache || catalogo.size > 0) estado.catalogoListo = true;
    reindexar();
  }, fallaListener(tx('el catálogo'))));

  mostrar('venta');
  pintarDepartamentos();
  pintarTicket();
  pintarEntrada();
  revisarTableta();
  if (bloqueada) bloquear();
}

function detenerVenta() {
  for (const dejar of estado.suscripciones.splice(0)) {
    try {
      dejar();
    } catch {
      // ya detenido
    }
  }
  estado.catalogo = new Map();
  estado.catalogoListo = false;
  estado.porUPC = new Map();
  estado.porPLU = new Map();
  estado.ventas = [];
  estado.movimientos = [];
  estado.pendientes = 0;
  estado.sugerencias = [];
  document.getElementById('dlg-bloqueo')?.remove();
  estado.bloqueada = false;
}

/** Cierra la sesión y vuelve a la pantalla de acceso. Con `turnoCerrado` borra lo local del turno. */
async function salir({ turnoCerrado = false, mensaje = null, tipo = 'info' } = {}) {
  if (estado.saliendo) return;
  estado.saliendo = true;
  const cajaId = estado.asignacion?.id;
  // La tableta del cliente queda en «Caja cerrada» ahora, que aún hay sesión para escribirle.
  await Promise.race([publicarTableta({ inmediato: true, cerrada: true }), new Promise((listo) => { setTimeout(listo, 2500); })]);
  detenerVenta();
  if (turnoCerrado && cajaId) {
    local.borrarTicket(cajaId);
    local.borrarEspera(cajaId);
    local.borrarVerificador(cajaId);
  }
  try {
    await cerrarSesionSilenciosa();
  } catch {
    // sin sesión
  }
  estado.personal = null;
  estado.turno = null;
  estado.ticket = null;
  estado.cerrando = false;
  mostrarAcceso({ mensaje, tipo });
  estado.saliendo = false;
}

/** El turno se cerró desde otro lugar (un administrador, desde el back office o desde otra caja). */
async function turnoCerradoFuera() {
  if (estado.cerrando || estado.cerradoFuera || estado.saliendo || estado.pantalla !== 'venta') return;
  estado.cerradoFuera = true;
  for (const dialogo of document.querySelectorAll('dialog[open]')) {
    dialogo.close();
    dialogo.remove();
  }
  estado.bloqueada = false;
  await informar({
    titulo: tx('Tu turno fue cerrado'),
    texto: tx('Un administrador cerró tu turno en esta caja. Las ventas que hiciste quedaron registradas en su corte.'),
    nota: tx('Para seguir vendiendo, entra de nuevo y abre un turno nuevo.'),
  });
  await salir({ turnoCerrado: true });
}

// ===================================================================== catálogo

const indicesBusqueda = new WeakMap();

function indiceDe(producto) {
  let indice = indicesBusqueda.get(producto);
  if (!indice) {
    indice = {
      palabras: [...palabras(producto.nombre), ...palabras(producto.marca)],
      codigos: [producto.upc, producto.plu].filter((c) => typeof c === 'string' && c !== ''),
    };
    indicesBusqueda.set(producto, indice);
  }
  return indice;
}

let indicePendiente = false;

function reindexar() {
  indicePendiente = true;
  setTimeout(asegurarIndices, 30);
}

function asegurarIndices() {
  if (!indicePendiente) return;
  indicePendiente = false;
  const porUPC = new Map();
  const porPLU = new Map();
  for (const p of estado.catalogo.values()) {
    if (p.upc) {
      if (!porUPC.has(p.upc)) porUPC.set(p.upc, []);
      porUPC.get(p.upc).push(p);
    }
    if (p.plu) {
      if (!porPLU.has(p.plu)) porPLU.set(p.plu, []);
      porPLU.get(p.plu).push(p);
    }
  }
  estado.porUPC = porUPC;
  estado.porPLU = porPLU;
  if (estado.entrada) pintarEntrada();
}

/** Entre varios productos con el mismo código: el activo y de esta tienda. */
function elegirDeTienda(lista) {
  if (!lista?.length) return null;
  const tienda = estado.turno?.tienda;
  const orden = [...lista].sort((a, b) => (a.activo === false) - (b.activo === false) || deLaTienda(b, tienda) - deLaTienda(a, tienda));
  return orden[0];
}

function buscarEnCatalogo(consulta, maximo = 8) {
  const terminos = palabras(consulta);
  if (terminos.length === 0) return [];
  const tienda = estado.turno?.tienda;
  const encontrados = [];
  for (const p of estado.catalogo.values()) {
    const { palabras: w, codigos } = indiceDe(p);
    if (terminos.every((t) => w.some((x) => x.startsWith(t)) || codigos.some((c) => c.startsWith(t)))) encontrados.push(p);
  }
  const puntaje = (p) => (p.activo === false ? 4 : 0) + (deLaTienda(p, tienda) ? 0 : 2) + (indiceDe(p).palabras[0]?.startsWith(terminos[0]) ? 0 : 1);
  return encontrados
    .sort((a, b) => puntaje(a) - puntaje(b) || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, maximo);
}

/** Producto por PLU, código de barras (también etiqueta de balanza) o nombre. */
async function encontrarProducto(texto) {
  asegurarIndices();
  const limpio = String(texto ?? '').trim();
  if (/^\d{4,5}$/.test(limpio)) return elegirDeTienda(estado.porPLU.get(limpio));
  if (/^\d+$/.test(limpio)) {
    let upc;
    try {
      upc = normalizarUPC(limpio);
    } catch {
      return null;
    }
    let producto = elegirDeTienda(estado.porUPC.get(upc));
    if (!producto && !estado.catalogoListo) producto = elegirDeTienda(await buscarPorUPC(upc).catch(() => []));
    if (producto) return producto;
    const balanza = interpretarCodigoBalanza(upc);
    for (const plu of balanza?.plus ?? []) {
      const deBalanza = elegirDeTienda(estado.porPLU.get(plu));
      if (deBalanza) return deBalanza;
    }
    return null;
  }
  return buscarEnCatalogo(limpio, 1)[0] ?? null;
}

// ===================================================================== línea de entrada (teclado y escáner)

/** "499" → 499 ¢ (centavos implícitos, como en una registradora); "4.99" → 499. */
function precioDeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (/^\d{1,7}$/.test(limpio)) return Number.parseInt(limpio, 10);
  if (/^\d{0,5}\.\d{0,2}$/.test(limpio) && limpio !== '.') {
    try {
      return centavosDesdeTexto(limpio.startsWith('.') ? `0${limpio}` : limpio);
    } catch {
      return null;
    }
  }
  return null;
}

function escribir(caracter) {
  if (estado.cobrado) ocultarCobrado();
  if (caracter === '*' || caracter === '×' || ((caracter === 'x' || caracter === 'X') && /^\d{1,3}$/.test(estado.entrada))) {
    fijarMultiplicador();
    return;
  }
  if (estado.entrada.length >= 40) return;
  if (caracter === ' ' && estado.entrada === '') return;
  estado.entrada += caracter;
  estado.sugerenciaActiva = 0;
  pintarEntrada();
}

function fijarMultiplicador() {
  const texto = estado.entrada.trim();
  if (!/^\d{1,3}$/.test(texto) || Number(texto) < 1) {
    errorCaja(tx('Para multiplicar, escribe la cantidad (1 a 999) y luego toca ×.'));
    return;
  }
  estado.multiplicador = Number(texto);
  estado.entrada = '';
  pintarEntrada();
}

function borrarCaracter() {
  if (estado.entrada) estado.entrada = estado.entrada.slice(0, -1);
  else estado.multiplicador = null;
  pintarEntrada();
}

function limpiarEntrada({ multiplicador = true } = {}) {
  estado.entrada = '';
  if (multiplicador) estado.multiplicador = null;
  estado.sugerencias = [];
  estado.sugerenciaActiva = 0;
  pintarEntrada();
}

function tomarMultiplicador() {
  const m = estado.multiplicador;
  estado.multiplicador = null;
  pintarEntrada();
  return m;
}

function pintarEntrada() {
  const texto = estado.entrada;
  $('entrada-texto').textContent = texto;
  const pista = $('entrada-pista');
  pista.hidden = texto !== '';
  const devolucion = estado.ticket?.modo === 'devolucion';
  pista.textContent = estado.multiplicador
    ? tx('Escanea el producto: se agregará {n} veces', { n: estado.multiplicador })
    : devolucion ? tx('Escanea el artículo que regresa el cliente') : tx('Escanea, o escribe código, PLU o nombre');
  $('entrada').classList.toggle('entrada--activa', texto !== '' || estado.multiplicador !== null);
  const mult = $('entrada-multiplicador');
  mult.hidden = estado.multiplicador === null;
  mult.textContent = estado.multiplicador ? `${estado.multiplicador} ×` : '';
  const monto = $('entrada-monto');
  const precio = texto.length <= 7 ? precioDeTexto(texto) : null;
  monto.hidden = precio === null || precio === 0;
  if (!monto.hidden) monto.textContent = tx('Depto. {precio}', { precio: dinero(precio) });
  const conLetras = /[a-zñáéíóúü]/i.test(texto);
  estado.sugerencias = conLetras && texto.trim().length >= 2 ? buscarEnCatalogo(texto, 8) : [];
  if (estado.sugerenciaActiva >= estado.sugerencias.length) estado.sugerenciaActiva = 0;
  pintarSugerencias();
}

function pintarSugerencias() {
  const caja = $('sugerencias');
  if (estado.sugerencias.length === 0) {
    caja.hidden = true;
    caja.replaceChildren();
    return;
  }
  caja.hidden = false;
  caja.replaceChildren(...estado.sugerencias.map((p, i) => h('button', {
    type: 'button',
    class: 'sugerencia',
    role: 'option',
    'aria-selected': String(i === estado.sugerenciaActiva),
    dataset: { indice: String(i) },
  }, nombreConPresentacion(p), h('small', { text: detalleProducto(p) || ' ' }), h('strong', { text: precioProducto(p) }))));
}

function procesarEntrada() {
  const texto = estado.entrada.trim();
  if (texto === '') {
    if (estado.cobrado) ocultarCobrado();
    else if (estado.multiplicador) errorCaja(tx('Escanea o escribe el producto que quieres multiplicar.'));
    return;
  }
  if (/[a-zñáéíóúü]/i.test(texto)) {
    const elegido = estado.sugerencias[estado.sugerenciaActiva];
    if (!elegido) {
      errorCaja(tx('No hay productos que coincidan con «{texto}».', { texto }));
      return;
    }
    limpiarEntrada({ multiplicador: false });
    encolar(() => agregarProducto(elegido));
    return;
  }
  limpiarEntrada({ multiplicador: false });
  if (!/^\d+$/.test(texto)) {
    errorCaja(precioDeTexto(texto) !== null
      ? tx('Para vender por departamento, escribe el precio y toca el departamento.')
      : tx('«{texto}» no es un código válido.', { texto }));
    return;
  }
  encolar(() => procesarCodigo(texto));
}

async function procesarCodigo(texto) {
  asegurarIndices();
  if (texto.length <= 5) {
    const producto = elegirDeTienda(estado.porPLU.get(texto));
    if (producto) return agregarProducto(producto);
    if (texto.length >= 4) throw fallo(tx('No hay ningún producto con el PLU {plu}.', { plu: texto }));
    throw fallo(tx('Para vender por departamento, escribe el precio y toca el departamento.'));
  }
  const folio = folioDesdeTexto(texto);
  const ventaFolio = folio ? estado.ventas.find((v) => v.folio === folio) : null;
  let upc;
  try {
    upc = normalizarUPC(texto);
  } catch {
    if (ventaFolio) return verTicket(ventaFolio);
    if (folio) throw fallo(tx('El ticket {folio} no es de este turno. Para una devolución usa Devolución (F8).', { folio }));
    throw fallo(tx('Código no válido ({codigo}). Vuelve a escanearlo.', { codigo: texto }));
  }
  let producto = elegirDeTienda(estado.porUPC.get(upc));
  if (!producto && !estado.catalogoListo) producto = elegirDeTienda(await buscarPorUPC(upc).catch(() => []));
  if (producto) return agregarProducto(producto);
  if (ventaFolio) return verTicket(ventaFolio);
  const balanza = interpretarCodigoBalanza(upc);
  if (balanza) {
    for (const plu of balanza.plus) {
      const deBalanza = elegirDeTienda(estado.porPLU.get(plu));
      if (deBalanza) return agregarProducto(deBalanza, { precioEtiqueta: balanza.precioCentavos, upc });
    }
    return venderSinCatalogo(upc, balanza.precioCentavos);
  }
  return venderSinCatalogo(upc);
}

// ===================================================================== ticket: agregar y modificar líneas

function calcular(ticket = estado.ticket) {
  return calcularTicket(ticket.lineas, { descuentoTicket: ticket.descuentoTicket, tasaImpuestoBP: estado.config.tasaImpuestoBP });
}

/** Guarda el ticket en el equipo y vuelve a pintar. */
function cambio() {
  if (estado.turno && estado.ticket) local.guardarTicket(estado.turno.caja, { ...estado.ticket, turno: estado.turno.id });
  pintarTicket();
}

// ---------------------------------------------------------------- pantalla del cliente

/**
 * Canal con la pantalla del cliente (caja/cliente.html, js/cliente.js) abierta
 * en esta misma computadora: en cada cambio del ticket, del cobro o de la
 * pantalla de la caja se le manda lo que debe ver el cliente, y cada
 * LATIDO_MS otra vez (así sabe que la caja sigue abierta). Si no hay pantalla
 * del cliente abierta, nadie escucha y no pasa nada.
 */
const canalCliente = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL_CLIENTE) : null;
let cobroCliente = null; // lo que muestra el diálogo de cobro mientras está abierto
let ultimaCliente = null; // id de la última línea agregada o cambiada: la pantalla la muestra en grande

function estadoParaCliente({ cerrada = false } = {}) {
  const base = {
    tienda: estado.tienda?.nombre ?? estado.turno?.tiendaNombre ?? estado.asignacion?.tiendaNombre ?? '',
    caja: estado.asignacion?.nombre ?? '',
    atiende: estado.personal?.nombre ?? null,
    config: estado.config,
  };
  if (cerrada || estado.pantalla !== 'venta' || !estado.turno || !estado.ticket) return estadoCliente({ ...base, fase: 'cerrada' });
  const t = estado.ticket;
  if (t.lineas.length === 0) {
    return estado.cobrado ? estadoCliente({ ...base, fase: 'cobrado', venta: estado.cobrado }) : estadoCliente({ ...base, fase: 'libre' });
  }
  return estadoCliente({ ...base, fase: cobroCliente ? 'cobro' : 'venta', ticket: t, calculo: calcular(), ultima: ultimaCliente, cobro: cobroCliente });
}

function avisarCliente() {
  if (canalCliente) {
    try {
      canalCliente.postMessage({ tipo: 'estado', estado: estadoParaCliente() });
    } catch (error) {
      console.warn('No se pudo avisar a la pantalla del cliente', error);
    }
  }
  publicarTableta();
}

/**
 * Tableta del cliente (pantallas/{huella} en Firestore, js/pantalla-remota.js):
 * si un administrador emparejó una tableta con esta caja, lo mismo se le manda
 * por internet. Agrupado (como mucho una escritura cada RETRASO_TABLETA_MS) y
 * solo si cambió: el latido no escribe nada. Sin conexión no se encola nada
 * (lo de hace un rato no le sirve al cliente); al volver la señal se manda lo
 * de ese momento.
 */
const tableta = { id: null, activa: false, enviado: '', temporizador: null, revisando: null };

async function idTableta() {
  if (tableta.id) return tableta.id;
  const clave = local.leerClaveCaja();
  if (!estado.asignacion?.id || !claveCajaValida(clave)) return null;
  tableta.id = await huellaPantalla(clave, estado.asignacion.id);
  return tableta.id;
}

/**
 * ¿Hay una tableta emparejada con esta caja? Al entrar a vender, al abrir
 * «Pantalla del cliente» y, mientras no tiene, cada REVISAR_TABLETA_MS. Con
 * tableta no hace falta mirar: si la desconectan, la siguiente escritura falla.
 */
function revisarTableta() {
  if (tableta.revisando) return tableta.revisando;
  tableta.revisando = (async () => {
    try {
      const id = await idTableta();
      if (!id || !navigator.onLine) return tableta.activa;
      const antes = tableta.activa;
      tableta.activa = await hayTableta(id);
      if (tableta.activa && !antes) {
        tableta.enviado = '';
        publicarTableta();
      }
    } catch (error) {
      console.warn('Pantalla del cliente (tableta)', error?.code ?? error);
    } finally {
      tableta.revisando = null;
    }
    return tableta.activa;
  })();
  return tableta.revisando;
}

function publicarTableta({ inmediato = false, cerrada = false } = {}) {
  if (!tableta.activa || !tableta.id || !estado.personal || !estado.asignacion || !navigator.onLine) return Promise.resolve();
  clearTimeout(tableta.temporizador);
  const enviar = () => {
    if (!tableta.activa || !estado.personal) return Promise.resolve();
    const contenido = estadoParaCliente({ cerrada });
    const firma = JSON.stringify(contenido);
    if (firma === tableta.enviado) return Promise.resolve();
    tableta.enviado = firma;
    return actualizarPantalla(tableta.id, { caja: estado.asignacion.id, cajero: estado.personal.usuario, estado: contenido }).catch((error) => {
      tableta.enviado = '';
      if (error?.code === 'not-found') tableta.activa = false; // un administrador desconectó la tableta
      else console.warn('Pantalla del cliente (tableta)', error?.code ?? error);
    });
  };
  if (inmediato) return enviar();
  tableta.temporizador = setTimeout(enviar, RETRASO_TABLETA_MS);
  return Promise.resolve();
}

window.addEventListener('online', () => {
  tableta.enviado = '';
  publicarTableta();
});
setInterval(() => {
  if (estado.pantalla === 'venta' && !tableta.activa) revisarTableta();
}, REVISAR_TABLETA_MS);

if (canalCliente) {
  canalCliente.addEventListener('message', ({ data }) => {
    if (data?.tipo === 'hola') avisarCliente(); // una pantalla recién abierta pide lo de ahora
  });
  setInterval(avisarCliente, LATIDO_MS);
  window.addEventListener('pagehide', () => canalCliente.postMessage({ tipo: 'adios' }));
}

/**
 * «Pantalla del cliente»: abrirla en esta computadora (segunda pantalla) y,
 * para una tableta, si ya hay una emparejada y cómo emparejarla.
 */
function pantallaDelCliente() {
  const direccion = new URL('cliente.html', window.location.href).href;
  const estadoTableta = h('p', { class: 'dlg__texto', id: 'estado-tableta', text: tx('Tableta: comprobando…') });
  revisarTableta().then((activa) => {
    estadoTableta.textContent = activa
      ? tx('Tableta: emparejada con {caja}. Lo que se escanea se ve también en la tableta.', { caja: estado.asignacion?.nombre ?? tx('esta caja') })
      : tx('Tableta: ninguna emparejada con esta caja.');
    estadoTableta.dataset.activa = String(activa);
  });
  return abrirDialogo({
    titulo: tx('Pantalla del cliente'),
    clase: 'dlg--ancho',
    cuerpo: [
      h('p', { class: 'dlg__texto', text: tx('En esta computadora: una segunda pantalla conectada a la caja. Se abre en otra ventana que se lleva a esa pantalla.') }),
      estadoTableta,
      h('p', { class: 'dlg__nota' }, `${tx('Para usar una tableta: en la tableta abre')} `, h('strong', { text: direccion }),
        tx(', toca «Usar en una tableta» y un administrador elige esta caja. Solo se hace una vez.')),
    ],
    botones: [
      { texto: tx('Volver'), valor: null, cerrar: true },
      { texto: tx('Abrir en esta computadora'), valor: 'ventana', principal: true },
    ],
    alPulsar: (valor, ctx) => {
      if (valor !== 'ventana') return;
      abrirPantallaCliente(); // dentro del toque: el navegador deja abrir la ventana
      ctx.cerrar(valor);
    },
  });
}

/** Abre la pantalla del cliente en otra ventana y, si el navegador lo permite, la lleva a la otra pantalla. */
function abrirPantallaCliente() {
  const ventana = window.open(new URL('cliente.html', window.location.href).href, 'aguila-pantalla-cliente', 'popup=yes,width=1024,height=640');
  if (!ventana) throw fallo(tx('El navegador bloqueó la ventana: permite las ventanas emergentes para la caja, o abre caja/cliente.html en la pantalla del cliente.'));
  llevarAOtraPantalla(ventana);
  avisarCliente();
  avisar(tx('Pantalla del cliente abierta. Llévala a la pantalla que ve el cliente y toca «Pantalla completa».'), 'info', 7000);
}

/** Chrome y Edge, con el permiso de «administración de ventanas»: la ventana va sola a la otra pantalla, a lo ancho. */
async function llevarAOtraPantalla(ventana) {
  try {
    if (!('getScreenDetails' in window)) return;
    const detalles = await Promise.race([window.getScreenDetails(), new Promise((_, rechazar) => { setTimeout(() => rechazar(new Error('sin respuesta')), 20000); })]);
    const otra = detalles.screens.find((s) => s !== detalles.currentScreen);
    if (!otra || ventana.closed) return;
    ventana.moveTo(otra.availLeft, otra.availTop);
    ventana.resizeTo(otra.availWidth, otra.availHeight);
  } catch {
    // sin permiso o una sola pantalla: la ventana queda donde la abrió el navegador
  }
}

// ---------------------------------------------------------------- movimientos en vivo

/** Un movimiento de la caja (ver registrarEvento). Por defecto, del ticket en curso. */
function evento(tipo, texto, { importeCentavos = null, folio = null, ticket = estado.ticket } = {}) {
  registrarEvento({ turno: estado.turno, personal: estado.personal, tipo, texto, importeCentavos, folio, ticket: ticket?.id ?? null });
}

/** "2× TAJIN CLASICO", "1.530 kg CHILES POBLANOS" (`piezas`: las que se agregaron, si no es toda la línea). */
function cantidadYNombre(linea, piezas = linea.cantidad) {
  return linea.unidad === 'peso' ? `${formatearPeso(Math.abs(linea.pesoGramos))} ${linea.nombre}` : `${Math.abs(piezas)}× ${linea.nombre}`;
}

/** Importe de la línea (o de `piezas` de ella) antes de descuentos, en positivo. */
function importeDe(linea, piezas = null) {
  if (piezas !== null && linea.unidad !== 'peso') return Math.abs(piezas) * linea.precioUnitarioCentavos;
  return Math.abs(importeBruto(linea));
}

function eventoArticulo(linea, piezas = linea.cantidad) {
  const importe = importeDe(linea, piezas);
  evento('articulo', `${cantidadYNombre(linea, piezas)} — ${dinero(importe)}`, { importeCentavos: importe });
}

function eventoCantidad(linea) {
  const importe = importeDe(linea);
  evento('cantidad', tEs('Ahora {articulo} — {importe}', { articulo: cantidadYNombre(linea), importe: dinero(importe) }), { importeCentavos: importe });
}

function agregarLinea(linea) {
  if (estado.ticket.lineas.length >= LIMITES_TICKET.lineas) throw fallo(tx('El ticket llegó al máximo de 300 líneas: cóbralo y abre otro.'));
  if (estado.cobrado) ocultarCobrado();
  const primera = estado.ticket.lineas.length === 0 && estado.ticket.modo !== 'devolucion';
  estado.ticket.lineas.push(linea);
  estado.seleccion = linea.id;
  estado.resaltar = linea.id;
  cambio();
  sonar('ok');
  if (primera) evento('venta_iniciada', tEs('Venta iniciada en {caja}', { caja: estado.turno.cajaNombre }));
  eventoArticulo(linea);
}

function pedirPeso(producto) {
  const precioKg = producto.precioPorKgCentavos;
  return pedirValor({
    titulo: nombreDeProducto(producto) || producto.nombre,
    etiqueta: tx('Peso en kilos'),
    nota: `${tx('{precio} por kg', { precio: dinero(precioKg) })}${producto.claseFiscal === 'gravado' ? ` + ${estado.config.impuestoNombre}` : ''}. ${tx('Pesa el producto y escribe los kilos (ej. 1.250).')}`,
    interpretar: gramosDesdeTexto,
    vista: (g) => `${formatearPeso(g)} × ${dinero(precioKg)}/kg = ${dinero(dividirRedondeado(g * precioKg, 1000))}`,
    decimal: true,
    aceptar: tx('Agregar'),
    maximo: 7,
  });
}

function pedirPrecio({ titulo, etiqueta = tx('Precio'), nota = null, inicial = '', aceptar = tx('Aceptar') }) {
  return pedirValor({
    titulo,
    etiqueta,
    nota,
    inicial,
    interpretar: (texto) => {
      const centavos = centavosDesdeTexto(texto);
      if (centavos <= 0) throw new Error(tx('El precio debe ser mayor que cero.'));
      if (centavos > LIMITES_TICKET.precioCentavos) throw new Error(tx('El precio es demasiado alto.'));
      return centavos;
    },
    vista: (c) => dinero(c),
    decimal: true,
    aceptar,
    maximo: 9,
  });
}

async function agregarProducto(producto, { precioEtiqueta = null, upc = null } = {}) {
  if (estado.cobrado) ocultarCobrado();
  const devolucion = estado.ticket.modo === 'devolucion';
  const signo = devolucion ? -1 : 1;
  const multiplicador = tomarMultiplicador();
  if (producto.activo === false) avisar(tx('«{nombre}» está marcado como inactivo en el catálogo.', { nombre: nombreDeProducto(producto) }), 'aviso');

  if (precioEtiqueta !== null) {
    // Etiqueta de balanza: el importe viene impreso en el código.
    agregarLinea(lineaDeProducto({ ...producto, unidadVenta: 'pieza', upc: upc ?? producto.upc }, { cantidad: signo * (multiplicador ?? 1), precioCentavos: precioEtiqueta }));
    return;
  }
  if (producto.unidadVenta === 'peso') {
    if (multiplicador) avisar(tx('Producto por peso: el multiplicador no aplica.'), 'aviso');
    if (!Number.isSafeInteger(producto.precioPorKgCentavos) || producto.precioPorKgCentavos <= 0) {
      throw fallo(tx('«{nombre}» no tiene precio por kilo en el catálogo. Véndelo por departamento.', { nombre: nombreDeProducto(producto) }));
    }
    const gramos = await pedirPeso(producto);
    if (gramos === null) return;
    agregarLinea(lineaDeProducto(producto, { pesoGramos: signo * gramos }));
    return;
  }
  const cantidad = multiplicador ?? 1;
  let precio = null;
  if (!Number.isSafeInteger(producto.precioCentavos) || producto.precioCentavos <= 0) {
    precio = await pedirPrecio({
      titulo: nombreDeProducto(producto),
      nota: tx('Este producto no tiene precio en el catálogo: escribe el de la etiqueta. Avisa al administrador para corregirlo.'),
      aceptar: tx('Agregar'),
    });
    if (precio === null) return;
  } else if (!devolucion) {
    const existente = estado.ticket.lineas.find((l) => lineaAcumulable(l, producto) && l.cantidad + cantidad <= LIMITES_TICKET.cantidad);
    if (existente) {
      existente.cantidad += cantidad;
      estado.seleccion = existente.id;
      estado.resaltar = existente.id;
      cambio();
      sonar('ok');
      eventoArticulo(existente, cantidad);
      return;
    }
  }
  agregarLinea(lineaDeProducto(producto, { cantidad: signo * cantidad, precioCentavos: precio }));
}

async function venderDepartamento(depto, { precioCentavos = null, upc = null } = {}) {
  if (estado.cobrado) ocultarCobrado();
  let precio = precioCentavos;
  if (precio === null && estado.entrada.trim() !== '') {
    precio = precioDeTexto(estado.entrada);
    if (precio === null || precio <= 0) throw fallo(tx('Escribe el precio con números (499 = $4.99) y toca el departamento.'));
    limpiarEntrada({ multiplicador: false });
  }
  if (precio === null) {
    precio = await pedirPrecio({
      titulo: depto.nombre,
      nota: depto.claseFiscal === 'gravado' ? tx('Lleva {impuesto}.', { impuesto: estado.config.impuestoNombre }) : tx('Sin impuesto (tasa cero).'),
      aceptar: tx('Agregar'),
    });
    if (precio === null) return;
  }
  if (precio > LIMITES_TICKET.precioCentavos) throw fallo(tx('El precio es demasiado alto.'));
  const devolucion = estado.ticket.modo === 'devolucion';
  const limite = estado.config.limiteVentaLibreCentavos;
  if (!devolucion && limite > 0 && precio > limite) {
    const autorizado = await asegurarAutorizacion('modificacion', tEs('Venta libre de {importe} en {nombre} (más de {limite})', { importe: dinero(precio), nombre: depto.nombre, limite: dinero(limite) }));
    if (!autorizado) return;
  }
  const cantidad = tomarMultiplicador() ?? 1;
  agregarLinea(lineaDeDepartamento(depto, precio, { cantidad: (devolucion ? -1 : 1) * cantidad, upc }));
}

async function venderSinCatalogo(upc, precioCentavos = null) {
  sonar('error');
  const opciones = estado.config.departamentos.map((d) => ({
    texto: d.nombre,
    valor: d.id,
    detalle: d.claseFiscal === 'gravado' ? `+${estado.config.impuestoNombre}` : tx('Sin impuesto'),
  }));
  const elegido = await elegir({
    titulo: tx('Producto no encontrado'),
    texto: `${tx('El código {codigo} no está en el catálogo', { codigo: upc })}${precioCentavos ? ` ${tx('(etiqueta de {precio})', { precio: dinero(precioCentavos) })}` : ''}. ${tx('Puedes venderlo por departamento; avisa al administrador para darlo de alta.')}`,
    opciones,
  });
  if (!elegido) {
    tomarMultiplicador();
    return;
  }
  const depto = estado.config.departamentos.find((d) => d.id === elegido);
  await venderDepartamento(depto, { precioCentavos, upc });
}

function lineaSeleccionada() {
  return estado.ticket.lineas.find((l) => l.id === estado.seleccion) ?? null;
}

async function accionLinea(accion) {
  const linea = lineaSeleccionada() ?? (accion === 'anular-linea' || accion === 'cantidad' ? estado.ticket.lineas.at(-1) : null);
  if (!linea) {
    if (estado.ticket.lineas.length === 0) return;
    throw fallo(tx('Toca primero una línea del ticket.'));
  }
  estado.seleccion = linea.id;
  const devolucion = estado.ticket.modo === 'devolucion';
  const signo = devolucion ? -1 : 1;
  switch (accion) {
    case 'menos':
      if (linea.unidad === 'peso') return cambiarPeso(linea);
      if (Math.abs(linea.cantidad) <= 1) return anularLinea(linea);
      linea.cantidad -= signo;
      break;
    case 'mas-uno':
      if (linea.unidad === 'peso') return cambiarPeso(linea);
      if (Math.abs(linea.cantidad) >= LIMITES_TICKET.cantidad) throw fallo(tx('Máximo 999 piezas por línea.'));
      linea.cantidad += signo;
      break;
    case 'cantidad':
      return linea.unidad === 'peso' ? cambiarPeso(linea) : cambiarCantidad(linea);
    case 'precio':
      return cambiarPrecio(linea);
    case 'descuento-linea':
      return descuentoLinea(linea);
    case 'anular-linea':
      return anularLinea(linea);
    default:
      return undefined;
  }
  estado.resaltar = linea.id;
  cambio();
  eventoCantidad(linea);
  return undefined;
}

async function cambiarCantidad(linea) {
  const signo = estado.ticket.modo === 'devolucion' ? -1 : 1;
  const cantidad = await pedirValor({
    titulo: linea.nombre,
    etiqueta: tx('Cantidad de piezas'),
    inicial: String(Math.abs(linea.cantidad)),
    interpretar: cantidadDesdeTexto,
    vista: (n) => `${n} × ${dinero(linea.precioUnitarioCentavos)} = ${dinero(n * linea.precioUnitarioCentavos)}`,
    decimal: false,
    maximo: 3,
  });
  if (cantidad === null) return;
  linea.cantidad = signo * cantidad;
  estado.resaltar = linea.id;
  cambio();
  eventoCantidad(linea);
}

async function cambiarPeso(linea) {
  const signo = estado.ticket.modo === 'devolucion' ? -1 : 1;
  const gramos = await pedirPeso({ nombre: linea.nombre, marca: '', precioPorKgCentavos: linea.precioUnitarioCentavos, claseFiscal: linea.claseFiscal });
  if (gramos === null) return;
  linea.pesoGramos = signo * gramos;
  estado.resaltar = linea.id;
  cambio();
  eventoCantidad(linea);
}

async function cambiarPrecio(linea) {
  const devolucion = estado.ticket.modo === 'devolucion';
  const porKg = linea.unidad === 'peso' ? '/kg' : '';
  if (linea.departamento && !linea.productoId) {
    // Venta libre: el precio lo tecleó la cajera; corregirlo no es un cambio de precio del catálogo.
    const nuevo = await pedirPrecio({ titulo: `${tx('Corregir precio')} · ${linea.nombre}`, inicial: (linea.precioUnitarioCentavos / 100).toFixed(2) });
    if (nuevo === null) return;
    const limite = estado.config.limiteVentaLibreCentavos;
    if (!devolucion && limite > 0 && nuevo > limite) {
      const autorizado = await asegurarAutorizacion('modificacion', tEs('Venta libre de {importe} en {nombre} (más de {limite})', { importe: dinero(nuevo), nombre: linea.nombre, limite: dinero(limite) }));
      if (!autorizado) return;
    }
    const antes = linea.precioUnitarioCentavos;
    linea.precioUnitarioCentavos = nuevo;
    estado.resaltar = linea.id;
    cambio();
    evento('precio', tEs('{nombre}: precio tecleado corregido de {antes} a {nuevo}', { nombre: linea.nombre, antes: dinero(antes), nuevo: dinero(nuevo) }), { importeCentavos: nuevo });
    return;
  }
  const original = linea.precioOriginalCentavos ?? linea.precioUnitarioCentavos;
  const nuevo = await pedirPrecio({
    titulo: `${tx('Cambiar precio')} · ${linea.nombre}`,
    etiqueta: linea.unidad === 'peso' ? tx('Precio nuevo por kg') : tx('Precio nuevo'),
    nota: `${tx('Precio del catálogo: {precio}.', { precio: `${dinero(original)}${porKg}` })} ${estado.personal.rol === 'admin' ? '' : tx('Necesita la autorización de un administrador.')}`,
  });
  if (nuevo === null || nuevo === linea.precioUnitarioCentavos) return;
  const tipo = devolucion ? 'devolucion' : 'modificacion';
  const autorizado = await asegurarAutorizacion(tipo, tEs('Cambio de precio: {nombre} {antes} → {nuevo}', { nombre: linea.nombre, antes: `${dinero(original)}${porKg}`, nuevo: `${dinero(nuevo)}${porKg}` }));
  if (!autorizado) return;
  const anterior = linea.precioUnitarioCentavos;
  linea.precioUnitarioCentavos = nuevo;
  linea.precioOriginalCentavos = nuevo === original ? null : original;
  estado.resaltar = linea.id;
  cambio();
  evento('precio', tEs('{nombre}: {antes} → {nuevo} (catálogo {original})', {
    nombre: linea.nombre, antes: `${dinero(anterior)}${porKg}`, nuevo: `${dinero(nuevo)}${porKg}`, original: `${dinero(original)}${porKg}`,
  }), { importeCentavos: nuevo });
}

function pedirDescuento({ titulo, baseCentavos }) {
  let tipo = 'porcentaje';
  let ctxDialogo = null;
  const campo = h('input', { id: 'descuento-valor', inputmode: 'none', autocomplete: 'off', maxlength: 8 });
  const etiqueta = h('label', { for: 'descuento-valor' });
  const previa = h('p', { class: 'dlg__nota', 'aria-live': 'polite' });
  const botonesTipo = [['porcentaje', tx('Porcentaje (%)')], ['monto', tx('Monto ($)')]].map(([valor, texto]) => h('button', {
    type: 'button', class: 'opcion', dataset: { tipo: valor }, text: texto,
  }));
  const rapidos = h('div', { class: 'rapidos' }, [5, 10, 15, 20, 25, 50].map((p) => h('button', {
    type: 'button',
    class: 'btn',
    text: formatearPorcentaje(p * 100),
    onclick: () => {
      tipo = 'porcentaje';
      campo.value = String(p);
      pintar();
      ctxDialogo?.pulsar('aceptar');
    },
  })));

  function interpretar() {
    if (tipo === 'porcentaje') return { tipo, puntosBase: puntosBaseDesdeTexto(campo.value) };
    const centavos = centavosDesdeTexto(campo.value);
    if (centavos <= 0) throw new Error(tx('El descuento debe ser mayor que cero.'));
    if (centavos > baseCentavos) throw new Error(tx('El descuento no puede pasar de {monto}.', { monto: dinero(baseCentavos) }));
    return { tipo, centavos };
  }

  function pintar() {
    for (const b of botonesTipo) b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
    etiqueta.textContent = tipo === 'porcentaje' ? tx('Porcentaje de descuento') : tx('Monto del descuento');
    rapidos.hidden = tipo !== 'porcentaje';
    try {
      const d = interpretar();
      const monto = d.tipo === 'porcentaje' ? Math.min(baseCentavos, dividirRedondeado(baseCentavos * d.puntosBase, 10000)) : d.centavos;
      previa.textContent = tx('Descuento de {monto} sobre {base}.', { monto: dinero(monto), base: dinero(baseCentavos) });
    } catch {
      previa.textContent = tx('Sobre {base}.', { base: dinero(baseCentavos) });
    }
  }

  for (const b of botonesTipo) {
    b.addEventListener('click', () => {
      tipo = b.dataset.tipo;
      campo.value = '';
      pintar();
      campo.focus();
    });
  }
  campo.addEventListener('input', pintar);
  pintar();
  return abrirDialogo({
    titulo,
    cuerpo: [h('div', { class: 'opciones' }, botonesTipo), h('div', { class: 'campo-monto' }, etiqueta, campo), previa, rapidos, tecladoNumerico({ destino: campo, decimal: true })],
    botones: [
      { texto: tx('Cancelar'), valor: null, cerrar: true },
      { texto: tx('Aplicar descuento'), valor: 'aceptar', principal: true },
    ],
    alAbrir: (ctx) => {
      ctxDialogo = ctx;
      campo.focus();
    },
    alPulsar: (_valor, ctx) => ctx.cerrar({ descuento: interpretar() }),
  }).then((r) => r?.descuento ?? null);
}

async function descuentoLinea(linea) {
  if (estado.ticket.modo === 'devolucion') throw fallo(tx('Una devolución no lleva descuentos.'));
  if (linea.descuento) {
    const opcion = await elegir({
      titulo: tx('Descuento de la línea'),
      texto: tx('{nombre} tiene {descuento} de descuento.', { nombre: linea.nombre, descuento: describirDescuento(linea.descuento) }),
      opciones: [{ texto: tx('Cambiar el descuento'), valor: 'cambiar' }, { texto: tx('Quitar el descuento'), valor: 'quitar' }],
    });
    if (!opcion) return;
    if (opcion === 'quitar') {
      linea.descuento = null;
      estado.resaltar = linea.id;
      cambio();
      evento('descuento', tEs('Se quitó el descuento de {nombre}', { nombre: linea.nombre }));
      return;
    }
  }
  const descuento = await pedirDescuento({ titulo: `${tx('Descuento')} · ${linea.nombre}`, baseCentavos: importeBruto(linea) });
  if (!descuento) return;
  const autorizado = await asegurarAutorizacion('modificacion', tEs('Descuento de {descuento} a {nombre}', { descuento: descuentoGuardado(descuento), nombre: linea.nombre }));
  if (!autorizado) return;
  linea.descuento = descuento;
  estado.resaltar = linea.id;
  cambio();
  evento('descuento', tEs('Descuento de {descuento} a {nombre}', { descuento: descuentoGuardado(descuento), nombre: linea.nombre }));
}

async function descuentoTicket() {
  const t = estado.ticket;
  if (t.modo === 'devolucion') throw fallo(tx('Una devolución no lleva descuentos.'));
  if (t.lineas.length === 0) throw fallo(tx('Agrega productos antes de hacer un descuento.'));
  if (t.descuentoTicket) {
    const opcion = await elegir({
      titulo: tx('Descuento al ticket'),
      texto: tx('El ticket tiene {descuento} de descuento.', { descuento: describirDescuento(t.descuentoTicket) }),
      opciones: [{ texto: tx('Cambiar el descuento'), valor: 'cambiar' }, { texto: tx('Quitar el descuento'), valor: 'quitar' }],
    });
    if (!opcion) return;
    if (opcion === 'quitar') {
      t.descuentoTicket = null;
      cambio();
      evento('descuento', tEs('Se quitó el descuento a todo el ticket'));
      return;
    }
  }
  const calculo = calcular();
  const descuento = await pedirDescuento({ titulo: tx('Descuento a todo el ticket'), baseCentavos: calculo.subtotalCentavos });
  if (!descuento) return;
  const autorizado = await asegurarAutorizacion('modificacion', tEs('Descuento de {descuento} a todo el ticket', { descuento: descuentoGuardado(descuento) }));
  if (!autorizado) return;
  t.descuentoTicket = descuento;
  cambio();
  evento('descuento', tEs('Descuento de {descuento} a todo el ticket', { descuento: descuentoGuardado(descuento) }));
}

function anularLinea(linea) {
  const t = estado.ticket;
  const detalle = calcular().lineas.find((l) => l.id === linea.id);
  t.lineas = t.lineas.filter((l) => l.id !== linea.id);
  t.lineasAnuladas += 1;
  t.lineasAnuladasCentavos += Math.abs(detalle?.importeCentavos ?? 0);
  if (t.lineas.length === 0) t.descuentoTicket = null;
  estado.seleccion = null;
  cambio();
  avisar(tx('Línea anulada: {nombre}', { nombre: linea.nombre }), 'info', 2200);
  const importe = Math.abs(detalle?.importeCentavos ?? importeDe(linea));
  evento('articulo_anulado', `${cantidadYNombre(linea)} — ${dinero(importe)}`, { importeCentavos: importe });
}

function moverSeleccion(delta) {
  const lineas = estado.ticket.lineas;
  if (lineas.length === 0) return;
  const indice = lineas.findIndex((l) => l.id === estado.seleccion);
  const siguiente = indice === -1 ? lineas.length - 1 : Math.min(lineas.length - 1, Math.max(0, indice + delta));
  estado.seleccion = lineas[siguiente].id;
  pintarTicket();
}

// ===================================================================== autorizaciones

/** Pide la autorización de un administrador (una vez por ticket); el admin que vende no la necesita. */
async function asegurarAutorizacion(tipo, detalle) {
  if (estado.personal.rol === 'admin') return true;
  const actual = estado.ticket.autorizacion;
  if (actual?.tipo === tipo) return true;
  const resultado = await pedirAutorizacion(tipo, detalle);
  if (!resultado) return false;
  estado.ticket.autorizacion = { id: resultado.id, admin: resultado.admin, nombre: resultado.nombreAdmin, tipo };
  cambio();
  avisar(tx('Autorizado por {nombre}.', { nombre: resultado.nombreAdmin }), 'ok');
  evento('autorizacion', tEs('{admin} autorizó: {detalle}', { admin: resultado.nombreAdmin, detalle }));
  return true;
}

function pedirAutorizacion(tipo, detalle) {
  const nip = h('input', { id: 'aut-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 6 });
  return abrirDialogo({
    titulo: tipo === 'devolucion' ? tx('Autorizar devolución') : tx('Autorización de administrador'),
    cuerpo: [
      h('p', { class: 'dlg__texto' }, h('strong', { text: traducirTextoEvento(detalle) })),
      h('p', { class: 'dlg__nota', text: tx('Un administrador escribe aquí su NIP. El turno de la cajera sigue abierto.') }),
      h('div', { class: 'campo-pos' }, h('label', { for: 'aut-nip', text: tx('NIP del administrador') }), nip),
      tecladoNumerico({ destino: nip }),
    ],
    botones: [
      { texto: tx('Cancelar'), valor: null, cerrar: true },
      { texto: tx('Autorizar'), valor: 'autorizar', principal: true },
    ],
    alAbrir: () => nip.focus(),
    alPulsar: async (_valor, ctx) => {
      if (!esNIP(nip.value)) throw new Error(tx('Escribe el NIP de 6 dígitos del administrador.'));
      if (!claveCajaValida(local.leerClaveCaja())) throw new Error(tx('Esta caja todavía no tiene su clave: al cerrar el turno, un administrador debe configurarla otra vez («Asignar esta computadora a otra caja»).'));
      if (!navigator.onLine) throw new Error(tx('Sin conexión: para autorizar se necesita internet.'));
      ctx.error(tx('Comprobando…'), 'info');
      try {
        const resultado = await autorizarComoAdmin({ nip: nip.value, claveCaja: local.leerClaveCaja(), tipo, turno: estado.turno, detalle });
        ctx.cerrar(resultado);
      } catch (error) {
        nip.value = '';
        throw new Error(CREDENCIAL_INCORRECTA.has(String(error?.code ?? '')) ? tx('NIP incorrecto.') : mensajeDe(error));
      }
    },
  });
}

// ===================================================================== devolución, espera y cancelación

function pedirFolioOriginal() {
  const campo = h('input', { id: 'folio-original', autocomplete: 'off', maxlength: 20, placeholder: tx('AAMMDD-CC-NNNN') });
  return abrirDialogo({
    titulo: tx('Devolución'),
    cuerpo: [
      h('p', { class: 'dlg__texto', text: tx('Escanea el código de barras del recibo original o escribe su folio.') }),
      h('label', { for: 'folio-original', text: tx('Folio del ticket original') }),
      campo,
      h('p', { class: 'dlg__nota', text: tx('Si el cliente no trae recibo, toca «Sin recibo». La devolución necesita la autorización de un administrador.') }),
    ],
    botones: [
      { texto: tx('Cancelar'), valor: null, cerrar: true },
      { texto: tx('Sin recibo'), valor: 'sin' },
      { texto: tx('Continuar'), valor: 'continuar', principal: true },
    ],
    alPulsar: (valor, ctx) => {
      if (valor === 'sin') {
        ctx.cerrar({ folio: '' });
        return;
      }
      const folio = folioDesdeTexto(campo.value);
      if (!folio) throw new Error(tx('Folio no válido: escanea el código del recibo o escribe AAMMDD-CC-NNNN.'));
      ctx.cerrar({ folio });
    },
  }).then((r) => (r ? r.folio : null));
}

async function alternarDevolucion() {
  const t = estado.ticket;
  if (t.modo === 'devolucion') {
    if (t.lineas.length) throw fallo(tx('Cobra o cancela la devolución antes de volver a la venta.'));
    estado.ticket = nuevoTicket();
    cambio();
    pintarEntrada();
    avisar(tx('De vuelta a la venta normal.'), 'info');
    return;
  }
  if (t.lineas.length) throw fallo(tx('La devolución va en un ticket aparte: cobra o pon en espera este ticket primero.'));
  const folio = await pedirFolioOriginal();
  if (folio === null) return;
  estado.ticket = { ...nuevoTicket(), modo: 'devolucion', ventaOriginal: folio || null };
  const autorizado = await asegurarAutorizacion('devolucion', folio ? tEs('Devolución del ticket {folio}', { folio }) : tEs('Devolución sin recibo'));
  if (!autorizado) {
    estado.ticket = nuevoTicket();
    cambio();
    return;
  }
  cambio();
  pintarEntrada();
  avisar(tx('Modo devolución: escanea los artículos que regresa el cliente.'), 'aviso');
  evento('devolucion_iniciada', folio ? tEs('Devolución del ticket {folio}', { folio }) : tEs('Devolución sin recibo'));
}

function ticketsEnEspera() {
  return local.leerEspera(estado.turno.caja).filter((t) => t.turno === estado.turno.id);
}

/** «3 artículo(s) · $12.50» como se guarda en los movimientos en vivo (para mostrarlo: traducirTextoEvento). */
function resumenTicket(ticket) {
  const c = calcular(ticket);
  const valores = { articulos: Math.abs(c.articulos), total: dinero(c.totalCentavos) };
  return ticket.modo === 'devolucion' ? tEs('{articulos} artículo(s) · {total} · devolución', valores) : tEs('{articulos} artículo(s) · {total}', valores);
}

function guardarEnEspera() {
  const lista = ticketsEnEspera();
  if (lista.length >= local.MAXIMO_EN_ESPERA) throw fallo(tx('Ya hay {n} tickets en espera: recupera o cobra alguno.', { n: local.MAXIMO_EN_ESPERA }));
  lista.push({ id: `e${Date.now().toString(36)}`, turno: estado.turno.id, guardadoEn: Date.now(), ticket: estado.ticket });
  local.guardarEspera(estado.turno.caja, lista);
  evento('espera', tEs('Ticket en espera — {resumen}', { resumen: resumenTicket(estado.ticket) }));
  estado.ticket = nuevoTicket();
  estado.seleccion = null;
  cambio();
  pintarEntrada();
  avisar(tx('Ticket en espera. Recupéralo con «En espera» (F6).'), 'ok');
}

function recuperarDeEspera(id) {
  let lista = ticketsEnEspera();
  const elegido = lista.find((t) => t.id === id);
  if (!elegido) return;
  lista = lista.filter((t) => t.id !== id);
  if (estado.ticket.lineas.length) lista.push({ id: `e${Date.now().toString(36)}`, turno: estado.turno.id, guardadoEn: Date.now(), ticket: estado.ticket });
  local.guardarEspera(estado.turno.caja, lista);
  estado.ticket = { ...nuevoTicket(), ...elegido.ticket };
  estado.seleccion = null;
  cambio();
  pintarEntrada();
  avisar(tx('Ticket recuperado.'), 'ok');
  evento('recuperada', tEs('Ticket recuperado — {resumen}', { resumen: resumenTicket(estado.ticket) }));
}

async function enEspera() {
  const lista = ticketsEnEspera();
  const conLineas = estado.ticket.lineas.length > 0;
  if (lista.length === 0) {
    if (conLineas) guardarEnEspera();
    else avisar(tx('No hay tickets en espera.'), 'info');
    return;
  }
  const opciones = [];
  if (conLineas) opciones.push({ texto: tx('Poner este ticket en espera'), valor: 'guardar', detalle: traducirTextoEvento(resumenTicket(estado.ticket)) });
  for (const t of lista) opciones.push({ texto: tx('Ticket de las {hora}', { hora: hora(t.guardadoEn) }), valor: t.id, detalle: traducirTextoEvento(resumenTicket(t.ticket)) });
  const elegido = await elegir({
    titulo: tx('Tickets en espera'),
    texto: conLineas ? tx('Si recuperas otro, el ticket actual queda en espera.') : tx('Elige el ticket que quieres recuperar.'),
    opciones,
  });
  if (!elegido) return;
  if (elegido === 'guardar') guardarEnEspera();
  else recuperarDeEspera(elegido);
}

function registrarCancelacion(ticket, motivo) {
  const total = Math.abs(calcular(ticket).totalCentavos);
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo: 'cancelacion', importeCentavos: total, motivo });
  movimiento.promesa.catch((error) => avisar(tx('No se pudo registrar la cancelación: {error}', { error: mensajeDe(error) }), 'error', 0));
  return movimiento;
}

async function cancelarTicket() {
  const t = estado.ticket;
  if (t.lineas.length === 0) {
    if (t.modo === 'devolucion' || t.descuentoTicket || t.autorizacion) {
      estado.ticket = nuevoTicket();
      cambio();
      pintarEntrada();
    }
    return;
  }
  const calculo = calcular();
  const seguro = await confirmar({
    titulo: tc('titulo', 'Cancelar ticket'),
    texto: Math.abs(calculo.articulos) === 1
      ? tc('1', 'Se cancela el ticket de {articulos} artículo(s) por {total}.', { articulos: 1, total: dinero(calculo.totalCentavos) })
      : tx('Se cancela el ticket de {articulos} artículo(s) por {total}.', { articulos: Math.abs(calculo.articulos), total: dinero(calculo.totalCentavos) }),
    nota: tx('La cancelación queda registrada en el corte del turno.'),
    aceptar: tx('Cancelar ticket'),
    cancelar: tx('Volver'),
    peligro: true,
  });
  if (!seguro) return;
  registrarCancelacion(t, tEs('{articulos} artículo(s)', { articulos: Math.abs(calculo.articulos) }));
  evento('venta_cancelada', tEs('Venta cancelada — {total} ({articulos} artículos)', { total: dinero(Math.abs(calculo.totalCentavos)), articulos: Math.abs(calculo.articulos) }),
    { importeCentavos: Math.abs(calculo.totalCentavos), ticket: t });
  estado.ticket = nuevoTicket();
  estado.seleccion = null;
  cambio();
  pintarEntrada();
  avisar(tx('Ticket cancelado.'), 'info');
}

// ===================================================================== cobro

async function cobrarTicket() {
  const t = estado.ticket;
  if (t.lineas.length === 0) return;
  const calculo = calcular();
  const devolucion = t.modo === 'devolucion';
  if (devolucion && calculo.totalCentavos >= 0) throw fallo(tx('La devolución no tiene importe.'));
  if (!devolucion && calculo.totalCentavos < 0) throw fallo(tx('El total no puede ser negativo.'));
  let pagos = [];
  if (calculo.totalCentavos !== 0) {
    try {
      pagos = await cobrar({
        totalCentavos: calculo.totalCentavos,
        devolucion,
        alCambiar: (cobro) => {
          cobroCliente = cobro;
          avisarCliente();
        },
      });
    } finally {
      cobroCliente = null;
    }
    if (pagos === null) {
      avisarCliente();
      return;
    }
  } else {
    const seguro = await confirmar({ titulo: tx('Ticket sin importe'), texto: tx('El total es $0.00. ¿Registrar el ticket así?'), aceptar: tx('Registrar') });
    if (!seguro) return;
  }
  finalizarVenta(calculo, pagos);
}

function finalizarVenta(calculo, pagos) {
  const t = estado.ticket;
  const turno = estado.turno;
  const tipo = t.modo === 'devolucion' ? 'devolucion' : 'venta';
  const ahora = new Date();
  const dia = claveDia(ahora);
  const numero = local.tomarNumero(turno.caja, dia);
  const autorizacion = t.autorizacion?.tipo === (tipo === 'devolucion' ? 'devolucion' : 'modificacion') ? t.autorizacion : null;
  const venta = armarVenta(calculo, pagos, {
    folio: folioVenta(ahora, turno.numeroCaja, numero),
    numero,
    dia,
    tipo,
    turno: turno.id,
    caja: turno.caja,
    cajaNombre: turno.cajaNombre,
    numeroCaja: turno.numeroCaja,
    tienda: turno.tienda,
    tiendaNombre: turno.tiendaNombre,
    cajero: estado.personal.usuario,
    cajeroNombre: estado.personal.nombre,
    fecha: Timestamp.fromDate(ahora),
    lineasAnuladas: t.lineasAnuladas,
    lineasAnuladasCentavos: t.lineasAnuladasCentavos,
    autorizacion: autorizacion?.id ?? null,
    autorizadoPor: autorizacion?.admin ?? null,
    ventaOriginal: tipo === 'devolucion' ? t.ventaOriginal : null,
  });
  const errores = validarVenta(venta);
  if (errores.length) {
    console.error('Venta no válida', errores, venta);
    throw fallo(tx('No se pudo registrar el ticket ({error}). Avisa a un administrador.', { error: errores[0] }));
  }
  const { id, promesa } = guardarVenta(venta);
  promesa.catch((error) => {
    console.error(error);
    avisar(tx('El servidor rechazó el ticket {folio}: {error}. Avisa a un administrador.', { folio: venta.folio, error: mensajeDe(error) }), 'error', 0);
  });
  eventosDeCobro(venta, t);
  estado.ultimaVenta = { id, ...venta };
  estado.ticket = nuevoTicket();
  estado.seleccion = null;
  local.guardarTicket(turno.caja, estado.ticket);
  imprimirVenta(venta);
  mostrarCobrado(venta);
  pintarTicket();
  pintarEntrada();
  sonar('venta');
}

/** Movimientos en vivo del cobro: cada pago con lo que queda por cobrar, y la venta (o devolución) completada. */
function eventosDeCobro(venta, ticket) {
  const devolucion = venta.tipo === 'devolucion';
  let saldo = Math.abs(venta.totalCentavos + venta.redondeoCentavos);
  for (const p of venta.pagos) {
    saldo = Math.max(0, saldo - Math.abs(p.importeCentavos));
    const metodo = NOMBRE_METODO[p.metodo] ?? p.metodo;
    const monto = Math.abs(p.metodo === 'efectivo' && p.recibidoCentavos ? p.recibidoCentavos : p.importeCentavos);
    evento('pago', devolucion
      ? tEs('Reembolso en {metodo} {importe} de {folio}', { metodo: metodo.toLowerCase(), importe: dinero(Math.abs(p.importeCentavos)), folio: venta.folio })
      : tEs('{metodo} {monto} en {folio} (saldo {saldo})', { metodo, monto: dinero(monto), folio: venta.folio, saldo: dinero(saldo) }),
    { importeCentavos: p.importeCentavos, folio: venta.folio, ticket });
  }
  const metodos = [...new Set(venta.pagos.map((p) => (NOMBRE_METODO[p.metodo] ?? p.metodo).toLowerCase()))].join(' + ') || tEs('sin pago');
  const valores = { folio: venta.folio, total: dinero(venta.totalCentavos), articulos: Math.abs(venta.articulos), metodos };
  if (devolucion) {
    evento('devolucion_completada', venta.ventaOriginal
      ? tEs('Devolución {folio} — {total} ({articulos} artículos, reembolso {metodos}), del ticket {original}', { ...valores, original: venta.ventaOriginal })
      : tEs('Devolución {folio} — {total} ({articulos} artículos, reembolso {metodos})', valores),
    { importeCentavos: venta.totalCentavos, folio: venta.folio, ticket });
  } else {
    evento('venta_completada', venta.cambioCentavos > 0
      ? tEs('Venta {folio} completada — {total} ({articulos} artículos, {metodos}), cambio {cambio}', { ...valores, cambio: dinero(venta.cambioCentavos) })
      : tEs('Venta {folio} completada — {total} ({articulos} artículos, {metodos})', valores),
    { importeCentavos: venta.totalCentavos, folio: venta.folio, ticket });
  }
}

function imprimirVenta(venta, { copia = false } = {}) {
  imprimirSeguro(reciboVenta(venta, { tienda: estado.tienda, config: estado.config, copia }));
}

function mostrarCobrado(venta) {
  estado.cobrado = venta;
  const devolucion = venta.tipo === 'devolucion';
  const panel = $('ticket-cobrado');
  panel.dataset.tipo = venta.tipo;
  $('cobrado-titulo').textContent = devolucion ? tx('Devolución registrada') : tx('Venta registrada');
  $('cobrado-folio').textContent = tx('Ticket {numero}', { numero: venta.folio });
  $('cobrado-total').textContent = dinero(Math.abs(venta.totalCentavos + venta.redondeoCentavos));
  $('cobrado-pago-titulo').textContent = devolucion ? tx('Se devolvió') : tx('Pagó');
  $('cobrado-pago').textContent = venta.pagos.length
    ? venta.pagos.map((p) => `${nombreMetodo(p.metodo)} ${dinero(Math.abs(p.recibidoCentavos ?? p.importeCentavos))}`).join(' + ')
    : '—';
  $('cobrado-cambio-bloque').hidden = venta.cambioCentavos <= 0;
  $('cobrado-cambio').textContent = dinero(venta.cambioCentavos);
  panel.hidden = false;
}

function ocultarCobrado() {
  if (!estado.cobrado) return;
  estado.cobrado = null;
  $('ticket-cobrado').hidden = true;
  pintarTicket();
}

// ===================================================================== tickets del turno

function vistaRecibo(venta) {
  const recibo = reciboVenta(venta, { tienda: estado.tienda, config: estado.config });
  recibo.classList.add('recibo--vista');
  return recibo;
}

async function verTicket(venta) {
  await abrirDialogo({
    titulo: tx('Ticket {numero}', { numero: venta.folio }),
    cuerpo: [h('div', { class: 'vista-recibo' }, vistaRecibo(venta))],
    botones: [
      { texto: tx('Cerrar'), valor: null, cerrar: true },
      { texto: tx('Reimprimir'), valor: 'reimprimir', principal: true },
    ],
    alPulsar: (_valor, ctx) => {
      imprimirVenta(venta, { copia: true });
      ctx.cerrar(true);
    },
  });
}

async function ticketsDelTurno() {
  const ventas = [...estado.ventas].sort((a, b) => (milisDe(b.fecha) ?? 0) - (milisDe(a.fecha) ?? 0));
  if (ventas.length === 0) {
    avisar(tx('Todavía no hay tickets en este turno.'), 'info');
    return;
  }
  let elegida = null;
  const vista = h('div', { class: 'vista-recibo', hidden: true });
  const lista = h('ul', { class: 'lista-pos' }, ventas.map((v) => h('li', null, h('button', { type: 'button', dataset: { id: v.id } },
    h('span', { text: `${v.folio}${v.tipo === 'devolucion' ? ` · ${tx('devolución')}` : ''}` }),
    h('small', {
      text: `${hora(v.fecha)} · ${Math.abs(v.articulos) === 1 ? tc('1', '{n} art.', { n: 1 }) : tx('{n} art.', { n: Math.abs(v.articulos) })} · ${v.pagos.map((p) => nombreMetodo(p.metodo)).join(' + ') || '—'}${v.pendiente ? ` · ${tx('por enviar')}` : ''}`,
    }),
    h('strong', { text: dinero(v.totalCentavos) })))));
  await abrirDialogo({
    titulo: tx('Tickets del turno ({n})', { n: ventas.length }),
    clase: 'dlg--ancho',
    cuerpo: [h('div', { style: 'display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:start' },
      h('div', { style: 'max-height:62vh; overflow:auto' }, lista), vista)],
    botones: [
      { texto: tx('Cerrar'), valor: null, cerrar: true },
      { texto: tx('Reimprimir'), valor: 'reimprimir', principal: true },
    ],
    alAbrir: (ctx) => {
      ctx.boton('reimprimir').disabled = true;
      lista.addEventListener('click', (e) => {
        const boton = e.target.closest('button[data-id]');
        if (!boton) return;
        elegida = ventas.find((v) => v.id === boton.dataset.id);
        for (const b of lista.querySelectorAll('button')) b.setAttribute('aria-current', String(b === boton));
        vista.hidden = false;
        vista.replaceChildren(vistaRecibo(elegida));
        ctx.boton('reimprimir').disabled = false;
      });
    },
    alPulsar: () => {
      if (!elegida) throw new Error(tx('Elige un ticket de la lista.'));
      imprimirVenta(elegida, { copia: true });
      avisar(tx('Copia del ticket {folio} enviada a la impresora.', { folio: elegida.folio }), 'ok');
    },
  });
}

// ===================================================================== efectivo: movimientos, cajón, cortes

function resumenActual() {
  return resumirTurno({ turno: estado.turno, ventas: estado.ventas, movimientos: estado.movimientos, departamentos: estado.config.departamentos });
}

async function movimientoEfectivo(tipo) {
  const datos = await pedirMovimiento(tipo);
  if (!datos) return;
  if (tipo !== 'entrada' && datos.importeCentavos > resumenActual().efectivo.esperadoCentavos) {
    throw fallo(tx('El monto es mayor que el efectivo que debería haber en el cajón. Revisa el monto.'));
  }
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo, importeCentavos: datos.importeCentavos, motivo: datos.motivo });
  movimiento.promesa.catch((error) => avisar(tx('No se pudo guardar el movimiento: {error}', { error: mensajeDe(error) }), 'error', 0));
  imprimirSeguro(comprobanteMovimiento(movimiento.datos, { tienda: estado.tienda, config: estado.config, turno: estado.turno }));
  avisar(tx('{movimiento} de {importe} registrado.', { movimiento: nombreMovimiento(tipo), importe: dinero(datos.importeCentavos) }), 'ok');
  const valores = { movimiento: NOMBRE_MOVIMIENTO[tipo], importe: dinero(datos.importeCentavos), motivo: datos.motivo };
  evento('efectivo', datos.motivo ? tEs('{movimiento} de {importe} — {motivo}', valores) : tEs('{movimiento} de {importe}', valores), { importeCentavos: datos.importeCentavos, ticket: null });
}

async function abrirCajon() {
  const motivo = await pedirTexto({
    titulo: tc('titulo', 'Abrir cajón'),
    etiqueta: tx('Motivo (opcional)'),
    nota: tx('Se imprime un comprobante (la impresora abre el cajón) y queda registrado en el corte.'),
    aceptar: tx('Abrir cajón'),
  });
  if (motivo === null) return;
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo: 'apertura', importeCentavos: 0, motivo: motivo || null });
  movimiento.promesa.catch((error) => avisar(tx('No se pudo registrar la apertura: {error}', { error: mensajeDe(error) }), 'error', 0));
  imprimirSeguro(comprobanteMovimiento(movimiento.datos, { tienda: estado.tienda, config: estado.config, turno: estado.turno }));
  evento('efectivo', motivo ? tEs('Apertura de cajón sin venta — {motivo}', { motivo }) : tEs('Apertura de cajón sin venta'), { importeCentavos: 0, ticket: null });
}

async function corteX() {
  const resumen = resumenActual();
  const ocultar = estado.config.conteoCiego && estado.personal.rol !== 'admin';
  const imprimirX = () => imprimirSeguro(reciboTurno(estado.turno, resumen, { tienda: estado.tienda, config: estado.config, tipo: 'X', ocultarEfectivo: ocultar }));
  imprimirX();
  await mostrarCorte({ turno: estado.turno, resumen, tipo: 'X', pendientes: estado.pendientes, alReimprimir: imprimirX, terminar: tx('Volver a vender'), ocultarEsperado: ocultar });
}

/** Comprueba el NIP de quien tiene el turno: contra Firebase, o sin conexión contra el verificador local. */
async function verificarNip(nip) {
  if (!nip) throw new Error(tx('Escribe tu NIP.'));
  const guardado = local.leerVerificador(estado.turno.caja);
  const conVerificador = async () => {
    if (guardado?.usuario === estado.personal.usuario && await comprobarVerificador(nip, guardado)) return;
    throw new Error(guardado ? tx('NIP incorrecto.') : tx('Sin conexión y sin verificación guardada en este equipo: conecta la caja a internet.'));
  };
  if (!navigator.onLine) return conVerificador();
  try {
    await Promise.race([
      comprobarSecretoEnServidor(nip),
      new Promise((_, rechazar) => setTimeout(() => rechazar(Object.assign(new Error('tiempo'), { code: 'auth/network-request-failed' })), 7000)),
    ]);
    return undefined;
  } catch (error) {
    const codigo = String(error?.code ?? '');
    if (codigo === 'auth/network-request-failed') return conVerificador();
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(codigo)) throw new Error(tx('NIP incorrecto.'));
    throw new Error(mensajeDe(error));
  }
}

function confirmarConNip({ titulo, texto, aceptar = tx('Confirmar') }) {
  const campo = h('input', { id: 'confirmar-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 72 });
  return abrirDialogo({
    titulo,
    cuerpo: [h('p', { class: 'dlg__texto', text: texto }), h('div', { class: 'campo-pos' }, h('label', { for: 'confirmar-nip', text: tx('Tu NIP') }), campo), tecladoNumerico({ destino: campo })],
    botones: [
      { texto: tx('Cancelar'), valor: null, cerrar: true },
      { texto: aceptar, valor: 'aceptar', principal: true },
    ],
    alPulsar: async (_valor, ctx) => {
      ctx.error(tx('Comprobando…'), 'info');
      try {
        await verificarNip(campo.value);
      } catch (error) {
        campo.value = '';
        campo.focus();
        throw error;
      }
      ctx.cerrar(true);
    },
  }).then((r) => r === true);
}

/**
 * Cierra un turno: resumen, lote turno + caja, corte Z impreso y en pantalla.
 * Sin conexión el cierre queda en cola y se envía al volver la red.
 */
async function completarCierre({ turno, ventas, movimientos, config, tienda, conteo, quien, nota = null, pendientesPrevios = 0 }) {
  const ahora = Date.now();
  const resumen = resumirTurno({ turno, ventas, movimientos, departamentos: config.departamentos, hasta: ahora });
  const diferencia = conteo.totalCentavos - resumen.efectivo.esperadoCentavos;
  const promesa = cerrarTurno({ turno, resumen, contadoCentavos: conteo.totalCentavos, conteo: conteo.conteo, diferenciaCentavos: diferencia, nota, quien });
  let resultado;
  try {
    resultado = await esperarConfirmacion(promesa, ESPERA_CONFIRMACION_MS);
  } catch (error) {
    throw fallo(tx('El servidor no aceptó el cierre del turno: {error}', { error: mensajeDe(error) }));
  }
  promesa.catch((error) => avisar(tx('El cierre del turno no se pudo guardar: {error}. Avisa a un administrador.', { error: mensajeDe(error) }), 'error', 0));
  const cifras = { vendido: dinero(resumen.totalCentavos), contado: dinero(conteo.totalCentavos), diferencia: dinero(diferencia) };
  registrarEvento({
    turno,
    personal: estado.personal,
    tipo: 'turno_cerrado',
    texto: quien !== turno.cajero
      ? tEs('Turno de {cajera} cerrado por {quien} — vendido {vendido}, contado {contado}, diferencia {diferencia}', { cajera: turno.cajeroNombre, quien: estado.personal?.nombre ?? quien, ...cifras })
      : tEs('Turno cerrado — vendido {vendido}, contado {contado}, diferencia {diferencia}', cifras),
    importeCentavos: conteo.totalCentavos,
  });
  const cerrado = { ...turno, estado: 'cerrado', cerradoEn: ahora, cerradoPor: quien, cierreForzado: quien !== turno.cajero, efectivoContadoCentavos: conteo.totalCentavos };
  const imprimirZ = () => imprimirSeguro(reciboTurno(cerrado, resumen, { tienda, config, tipo: 'Z', contadoCentavos: conteo.totalCentavos, ahora }));
  imprimirZ();
  await mostrarCorte({
    turno: cerrado,
    resumen,
    tipo: 'Z',
    contadoCentavos: conteo.totalCentavos,
    pendientes: pendientesPrevios + (resultado === 'pendiente' ? 1 : 0),
    alReimprimir: imprimirZ,
  });
}

async function cerrarMiTurno() {
  if (estado.ticket.lineas.length) throw fallo(tx('Cobra o cancela el ticket en curso antes de cerrar el turno.'));
  const espera = ticketsEnEspera();
  const seguir = await confirmar({
    titulo: tc('titulo', 'Cerrar turno'),
    texto: tx('Vas a cerrar tu turno en {caja}. Primero cuenta todo el efectivo del cajón.', { caja: estado.turno.cajaNombre }),
    nota: espera.length === 0 ? null
      : espera.length === 1 ? tc('1', 'Hay {n} ticket(s) en espera: se cancelarán y quedarán registrados en el corte.', { n: 1 })
        : tx('Hay {n} ticket(s) en espera: se cancelarán y quedarán registrados en el corte.', { n: espera.length }),
    aceptar: tx('Contar el efectivo'),
  });
  if (!seguir) return;
  const previo = resumenActual();
  const conteo = await contarEfectivo({
    titulo: tx('Cierre de turno · conteo del efectivo'),
    nota: tx('Cuenta TODO el efectivo del cajón, incluido el fondo inicial.'),
    esperadoCentavos: estado.config.conteoCiego ? null : previo.efectivo.esperadoCentavos,
  });
  if (!conteo) return;
  const confirmado = await confirmarConNip({
    titulo: tx('Confirma el cierre'),
    texto: tx('Efectivo contado: {monto}. Escribe tu NIP para cerrar el turno e imprimir tu corte.', { monto: dinero(conteo.totalCentavos) }),
    aceptar: tx('Cerrar turno'),
  });
  if (!confirmado) return;

  estado.cerrando = true;
  try {
    const movimientos = [...estado.movimientos];
    for (const t of espera) {
      const m = registrarCancelacion(t.ticket, tEs('Ticket en espera cancelado al cerrar el turno'));
      evento('venta_cancelada', tEs('Ticket en espera cancelado al cerrar el turno — {importe}', { importe: dinero(m.datos.importeCentavos) }),
        { importeCentavos: m.datos.importeCentavos, ticket: t.ticket });
      if (!movimientos.some((x) => x.id === m.id)) movimientos.push({ id: m.id, ...m.datos });
    }
    local.borrarEspera(estado.turno.caja);
    await completarCierre({
      turno: estado.turno,
      ventas: estado.ventas,
      movimientos,
      config: estado.config,
      tienda: estado.tienda,
      conteo,
      quien: estado.personal.usuario,
      pendientesPrevios: estado.pendientes,
    });
  } catch (error) {
    estado.cerrando = false;
    throw error;
  }
  await salir({ turnoCerrado: true, mensaje: tx('Turno cerrado. ¡Gracias!'), tipo: 'info' });
}

/** Un administrador cierra desde esta caja el turno que otra persona dejó abierto. */
async function cerrarTurnoAjeno(caja, admin) {
  const seguir = await confirmar({
    titulo: tx('Caja ocupada'),
    texto: tx('{caja} tiene abierto el turno de {nombre} desde las {hora}.', { caja: caja.nombre, nombre: caja.turnoCajeroNombre, hora: hora(caja.turnoDesde) }),
    nota: tx('Como administrador puedes cerrarlo aquí: cuentas el efectivo del cajón y se imprime su corte Z. Queda registrado como cierre hecho por ti.'),
    aceptar: tx('Cerrar ese turno'),
    peligro: true,
  });
  if (!seguir) {
    mensajeAcceso(tx('La caja sigue ocupada.'), 'info');
    return;
  }
  ocupadoAcceso(true, tx('Leyendo el turno…'));
  const { turno, ventas, movimientos } = await leerTurnoCompleto(caja.turnoActual);
  if (!turno || turno.estado !== 'abierto') throw fallo(tx('Ese turno ya no está abierto.'));
  const [config, tienda] = await Promise.all([leerConfigPos().catch(() => estado.config), leerTienda(turno.tienda).catch(() => null)]);
  const previo = resumirTurno({ turno, ventas, movimientos, departamentos: config.departamentos });
  const conteo = await contarEfectivo({
    titulo: tx('Conteo · turno de {nombre}', { nombre: turno.cajeroNombre }),
    nota: tx('Cuenta todo el efectivo del cajón, incluido el fondo inicial.'),
    esperadoCentavos: previo.efectivo.esperadoCentavos,
    aceptar: tx('Cerrar el turno'),
  });
  if (!conteo) {
    mensajeAcceso(tx('El turno sigue abierto.'), 'info');
    return;
  }
  ocupadoAcceso(true, tx('Cerrando el turno…'));
  await completarCierre({ turno, ventas, movimientos, config, tienda, conteo, quien: admin.usuario, nota: tx('Cerrado en la caja por {nombre}', { nombre: admin.nombre }) });
  mensajeAcceso(tx('Turno de {nombre} cerrado. La caja está libre.', { nombre: turno.cajeroNombre }), 'info');
}

// ===================================================================== bloqueo

function bloquear() {
  if (estado.pantalla !== 'venta' || document.getElementById('dlg-bloqueo')) return;
  estado.bloqueada = true;
  const campo = h('input', { id: 'bloqueo-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 72 });
  const mensaje = h('p', { class: 'mensaje-pos', role: 'alert', hidden: true });
  const boton = h('button', { type: 'submit', class: 'btn btn--primario btn--grande', text: tx('Desbloquear') });
  const forma = h('form', { class: 'bloqueo__caja', novalidate: true },
    h('h2', null, icono('candado'), tx('Caja bloqueada')),
    h('p', { class: 'dlg__texto', text: tx('Turno de {nombre} ({usuario}) en {caja}.', { nombre: estado.personal.nombre, usuario: estado.personal.usuario, caja: estado.turno.cajaNombre }) }),
    h('label', { for: 'bloqueo-nip', text: tx('NIP') }),
    campo,
    tecladoNumerico({ destino: campo }),
    mensaje,
    boton,
    h('p', { class: 'dlg__nota', text: tx('Para que otra persona use esta caja, primero se cierra este turno.') }));
  const dialogo = h('dialog', { class: 'dlg dlg--pantalla', id: 'dlg-bloqueo', 'aria-label': tx('Caja bloqueada') }, h('div', { class: 'bloqueo' }, forma));
  dialogo.addEventListener('cancel', (e) => e.preventDefault());
  forma.addEventListener('submit', async (e) => {
    e.preventDefault();
    boton.disabled = true;
    mensaje.hidden = false;
    mensaje.dataset.tipo = 'info';
    mensaje.textContent = tx('Comprobando…');
    try {
      await verificarNip(campo.value);
      dialogo.close();
      dialogo.remove();
      estado.bloqueada = false;
      avisar(tx('Caja desbloqueada.'), 'ok', 1800);
    } catch (error) {
      delete mensaje.dataset.tipo;
      mensaje.textContent = error.message;
      campo.value = '';
      campo.focus();
      sonar('error');
    } finally {
      boton.disabled = false;
    }
  });
  document.body.append(dialogo);
  dialogo.showModal();
  campo.focus();
}

// ===================================================================== consultas, búsqueda, menú y ayuda

function fichaProducto(p) {
  const porPeso = p.unidadVenta === 'peso';
  return h('div', { class: 'ficha-producto' },
    h('div', { class: 'ficha-producto__nombre', text: nombreDeProducto(p) }),
    h('div', { class: 'ficha-producto__precio' }, porPeso ? `${dinero(p.precioPorKgCentavos ?? 0)}` : dinero(p.precioCentavos ?? 0),
      h('small', { text: `${porPeso ? tx('por kg') : tx('cada uno')}${p.claseFiscal === 'gravado' ? ` + ${estado.config.impuestoNombre}` : ` · ${tx('sin impuesto')}`}` })),
    h('div', { class: 'ficha-producto__detalle', text: [p.presentacion, p.descriptor].filter(Boolean).join(' · ') || ' ' }),
    h('div', { class: 'ficha-producto__detalle', text: detalleProducto(p) || ' ' }));
}

async function consultarPrecio() {
  const campo = h('input', { id: 'consulta-codigo', autocomplete: 'off', maxlength: 40, placeholder: tx('Código, PLU o nombre') });
  const resultado = h('div', { 'aria-live': 'polite' });
  let encontrado = null;
  const r = await abrirDialogo({
    titulo: tx('Consultar precio'),
    clase: 'dlg--ancho',
    cuerpo: [h('label', { for: 'consulta-codigo', text: tx('Escanea el producto o escribe su código, PLU o nombre') }), campo, resultado],
    botones: [
      { texto: tx('Cerrar'), valor: null, cerrar: true },
      { texto: tx('Agregar al ticket'), valor: 'agregar' },
      { texto: tc('dialogo', 'Consultar'), valor: 'consultar', principal: true },
    ],
    alAbrir: (ctx) => {
      ctx.boton('agregar').disabled = true;
    },
    alPulsar: async (valor, ctx) => {
      if (valor === 'agregar') {
        if (!encontrado) throw new Error(tx('Primero consulta un producto.'));
        ctx.cerrar({ producto: encontrado });
        return;
      }
      const texto = campo.value.trim();
      if (!texto) throw new Error(tx('Escanea o escribe un código.'));
      encontrado = await encontrarProducto(texto);
      campo.select();
      if (!encontrado) {
        resultado.replaceChildren();
        sonar('error');
        throw new Error(tx('No se encontró ningún producto con «{texto}».', { texto }));
      }
      sonar('ok');
      resultado.replaceChildren(fichaProducto(encontrado));
      queueMicrotask(() => { ctx.boton('agregar').disabled = false; });
    },
  });
  if (r?.producto) await agregarProducto(r.producto);
}

async function buscarProducto() {
  const campo = h('input', { id: 'buscar-texto', autocomplete: 'off', maxlength: 60, placeholder: tx('Nombre, marca, código o PLU') });
  const lista = h('ul', { class: 'lista-pos', style: 'max-height:56vh; overflow:auto' });
  let resultados = [];
  const pintar = () => {
    const texto = campo.value.trim();
    resultados = texto.length >= 2 ? buscarEnCatalogo(texto, 40) : [];
    lista.replaceChildren(...(resultados.length
      ? resultados.map((p, i) => h('li', null, h('button', { type: 'button', dataset: { indice: String(i) } },
        h('span', { text: nombreConPresentacion(p) }), h('small', { text: detalleProducto(p) || ' ' }), h('strong', { text: precioProducto(p) }))))
      : [h('li', { class: 'lista-pos__vacia', text: texto.length >= 2 ? tx('Sin resultados') : tx('Escribe al menos 2 letras') })]));
  };
  campo.addEventListener('input', pintar);
  const r = await abrirDialogo({
    titulo: tx('Buscar producto'),
    clase: 'dlg--ancho',
    cuerpo: [campo, lista],
    botones: [
      { texto: tx('Cerrar'), valor: null, cerrar: true },
      { texto: tx('Agregar el primero'), valor: 'primero', principal: true },
    ],
    alAbrir: (ctx) => {
      pintar();
      lista.addEventListener('click', (e) => {
        const boton = e.target.closest('button[data-indice]');
        if (boton) ctx.cerrar({ producto: resultados[Number(boton.dataset.indice)] });
      });
      campo.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          lista.querySelector('button')?.focus();
        }
      });
    },
    alPulsar: (_valor, ctx) => {
      if (!resultados.length) throw new Error(tx('No hay resultados.'));
      ctx.cerrar({ producto: resultados[0] });
    },
  });
  if (r?.producto) await agregarProducto(r.producto);
}

const ATAJOS = [
  ['F1', tx('Esta ayuda')], ['F2', tx('Consultar precio')], ['F3', tx('Buscar producto')], [tx('F4 o Supr'), tx('Anular línea')],
  ['F5', tx('Cantidad de la línea')], ['F6', tx('Tickets en espera')], ['F7', tx('Descuento al ticket')], ['F8', tx('Devolución')],
  ['F9', tx('Más funciones')], ['F10', tx('Cobrar')], ['Ctrl + B', tx('Bloquear la caja')], ['↑ ↓', tx('Elegir línea')],
  ['+ / −', tx('Una pieza más / menos')], [tx('3 × (o 3*)'), tx('Multiplicar el siguiente producto')],
  [tx('499 + depto.'), tx('Venta libre de $4.99')], ['Esc', tx('Borrar lo escrito')],
];

function ayuda() {
  return abrirDialogo({
    titulo: tx('Atajos de teclado'),
    clase: 'dlg--ancho',
    cuerpo: [h('dl', { class: 'atajos' }, ATAJOS.map(([tecla, texto]) => h('div', null, h('dt', { text: texto }), h('dd', null, h('kbd', { text: tecla })))))],
    botones: [{ texto: tx('Entendido'), valor: true, principal: true }],
  });
}

function pantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => avisar(tx('El navegador no permitió la pantalla completa.'), 'aviso'));
}

const MENU_MAS = [
  { valor: 'reimprimir', texto: tx('Reimprimir último ticket'), icono: 'imprimir' },
  { valor: 'tickets', texto: tx('Tickets del turno'), icono: 'buscar' },
  { valor: 'cajon', texto: tx('Abrir cajón'), icono: 'cajon' },
  { valor: 'retiro', texto: tx('Retiro de efectivo'), icono: 'cobrar' },
  { valor: 'entrada', texto: tx('Entrada de efectivo'), icono: 'cobrar' },
  { valor: 'pago', texto: tx('Pago desde caja'), icono: 'tarjeta' },
  { valor: 'x', texto: tx('Corte parcial (X)'), icono: 'reloj' },
  { valor: 'bloquear', texto: tx('Bloquear caja'), icono: 'candado' },
  { valor: 'cerrar', texto: tx('Cerrar turno'), icono: 'cerrar', peligro: true },
  { valor: 'cliente', texto: tc('menu', 'Pantalla del cliente'), icono: 'pantalla' },
  { valor: 'pantalla', texto: tx('Pantalla completa'), icono: 'flecha' },
  { valor: 'ayuda', texto: tx('Atajos de teclado'), icono: 'etiqueta' },
];

async function menuMas() {
  const rejilla = h('div', { class: 'menu-funciones' }, MENU_MAS.map((op) => h('button', {
    type: 'button',
    class: `btn${op.peligro ? ' btn--peligro-suave' : ''}`,
    dataset: { valor: op.valor },
  }, icono(op.icono), h('span', { text: op.texto }))));
  const elegido = await abrirDialogo({
    titulo: tx('Más funciones'),
    clase: 'dlg--ancho',
    cuerpo: [rejilla],
    botones: [{ texto: tx('Volver'), valor: null, cerrar: true }],
    alAbrir: (ctx) => {
      rejilla.addEventListener('click', (e) => {
        const boton = e.target.closest('[data-valor]');
        if (boton) ctx.cerrar(boton.dataset.valor);
      });
      rejilla.querySelector('button')?.focus();
    },
  });
  switch (elegido) {
    case 'reimprimir':
      if (!estado.ultimaVenta) throw fallo(tx('Todavía no hay tickets en este turno.'));
      imprimirVenta(estado.ultimaVenta, { copia: true });
      return undefined;
    case 'tickets': return ticketsDelTurno();
    case 'cajon': return abrirCajon();
    case 'retiro':
    case 'entrada':
    case 'pago':
      return movimientoEfectivo(elegido);
    case 'x': return corteX();
    case 'bloquear': return bloquear();
    case 'cerrar': return cerrarMiTurno();
    case 'cliente': return pantallaDelCliente();
    case 'pantalla': return pantallaCompleta();
    case 'ayuda': return ayuda();
    default: return undefined;
  }
}

// ===================================================================== pintar el ticket

function nodoLinea(l) {
  const clases = ['linea'];
  if (l.id === estado.seleccion) clases.push('linea--seleccionada');
  if (l.id === estado.resaltar) clases.push('linea--nueva');
  if ((l.cantidad ?? 0) < 0 || (l.pesoGramos ?? 0) < 0) clases.push('linea--negativa');
  const detalle = l.unidad === 'peso'
    ? `${formatearPeso(l.pesoGramos)} × ${dinero(l.precioUnitarioCentavos)}/kg`
    : `${l.cantidad} × ${dinero(l.precioUnitarioCentavos)}`;
  const marcas = [];
  if (l.claseFiscal === 'gravado') marcas.push(h('span', { class: 'marca-tx', text: '+Tx' }));
  if (l.departamento) marcas.push(h('span', { class: 'marca-precio', text: tc('linea', 'Venta libre') }));
  if (l.precioOriginalCentavos !== null && l.precioOriginalCentavos !== undefined) marcas.push(h('span', { class: 'marca-precio', text: tx('Precio cambiado · era {precio}', { precio: dinero(l.precioOriginalCentavos) }) }));
  if (l.descuento) marcas.push(h('span', { class: 'marca-desc', text: tx('Desc. {descuento}', { descuento: describirDescuento(l.descuento) }) }));
  const importe = h('span', { class: 'linea__importe' });
  if (l.descuentoCentavos > 0) importe.append(h('s', { text: dinero(l.importeBrutoCentavos) }));
  importe.append(dinero(l.importeCentavos));
  return h('li', { class: clases.join(' '), dataset: { id: l.id } },
    h('div', { class: 'linea__nombre' }, l.nombre, l.presentacion ? h('span', { class: 'linea__pres', text: l.presentacion }) : null),
    importe,
    h('div', { class: 'linea__detalle' }, h('span', { text: detalle }), marcas));
}

function pintarTicket() {
  const t = estado.ticket;
  if (!t || !estado.turno) return;
  const calculo = calcular();
  const devolucion = t.modo === 'devolucion';
  document.querySelector('.ticket').classList.toggle('ticket--devolucion', devolucion);
  const numero = local.proximoNumero(estado.turno.caja, claveDia());
  $('ticket-numero').textContent = tx('Ticket {numero}', { numero: String(numero).padStart(4, '0') });
  $('ticket-modo').hidden = !devolucion;
  $('ticket-modo').textContent = t.ventaOriginal ? `${tx('DEVOLUCIÓN')} · ${t.ventaOriginal}` : tx('DEVOLUCIÓN');
  $('ticket-autorizado').hidden = !t.autorizacion;
  $('ticket-autorizado').textContent = t.autorizacion ? tx('Autorizó {nombre}', { nombre: t.autorizacion.nombre }) : '';
  const articulos = Math.abs(calculo.articulos);
  $('ticket-articulos').textContent = articulos === 1 ? tx('{n} artículo', { n: articulos }) : tx('{n} artículos', { n: articulos });

  const lista = $('ticket-lineas');
  lista.replaceChildren(...calculo.lineas.map(nodoLinea));
  $('ticket-vacio').hidden = t.lineas.length > 0;
  $('ticket-vacio-texto').textContent = devolucion ? tx('Escanea los artículos que regresa el cliente') : tx('Escanea un producto o escribe su código');

  if (!t.lineas.some((l) => l.id === estado.seleccion)) estado.seleccion = null;
  const seleccionada = lineaSeleccionada();
  $('acciones-linea').hidden = !seleccionada || !!estado.cobrado;
  if (seleccionada) {
    const botonDescuento = $('acciones-linea').querySelector('[data-accion="descuento-linea"]');
    botonDescuento.disabled = devolucion;
  }

  $('tot-subtotal').textContent = dinero(calculo.subtotalCentavos);
  $('fila-descuento').hidden = calculo.descuentoTicketCentavos === 0;
  $('tot-descuento').textContent = `${dinero(-calculo.descuentoTicketCentavos)}${t.descuentoTicket?.tipo === 'porcentaje' ? ` (${formatearPorcentaje(t.descuentoTicket.puntosBase)})` : ''}`;
  $('tot-impuesto-nombre').textContent = `${estado.config.impuestoNombre} ${formatearPorcentaje(estado.config.tasaImpuestoBP)}`;
  $('tot-impuesto').textContent = dinero(calculo.impuestoCentavos);
  $('tot-total-nombre').textContent = devolucion ? tx('Total a devolver') : tx('Total');
  $('tot-total').textContent = dinero(calculo.totalCentavos);
  $('tot-efectivo').textContent = dinero(redondearEfectivo(calculo.totalCentavos));

  const botonCobrar = $('btn-cobrar');
  botonCobrar.disabled = t.lineas.length === 0;
  botonCobrar.classList.toggle('btn--reembolsar', devolucion);
  $('btn-cobrar-texto').textContent = devolucion ? tx('Reembolsar') : tx('Cobrar');
  $('btn-cobrar-total').textContent = dinero(Math.abs(calculo.totalCentavos));

  const funciones = $('funciones');
  funciones.querySelector('[data-accion="devolucion"]').setAttribute('aria-pressed', String(devolucion));
  funciones.querySelector('[data-accion="descuento"]').disabled = devolucion;
  const espera = ticketsEnEspera().length;
  funciones.querySelector('[data-accion="espera"] span').textContent = espera ? tx('En espera ({n})', { n: espera }) : tx('En espera');

  if (estado.resaltar || estado.seleccion) lista.querySelector('.linea--seleccionada, .linea--nueva')?.scrollIntoView({ block: 'nearest' });
  if (estado.resaltar) ultimaCliente = estado.resaltar;
  estado.resaltar = null;
  avisarCliente();
}

function pintarDepartamentos() {
  const config = estado.config;
  $('deptos').replaceChildren(...config.departamentos.map((d) => h('button', {
    type: 'button',
    class: `depto depto--${d.color}`,
    dataset: { depto: d.id },
  }, h('span', { text: d.nombre }), h('small', { text: d.claseFiscal === 'gravado' ? `+${config.impuestoNombre}` : tx('Sin impuesto') }))));
}

function construirTecladoVenta() {
  const teclas = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', 'Enter', '0', '00', '×'];
  const nombres = { '⌫': tx('Borrar'), C: tx('Limpiar'), '×': tx('Multiplicar') };
  $('teclado-venta').replaceChildren(...teclas.map((t) => h('button', {
    type: 'button',
    class: `tecla${t === 'Enter' ? ' tecla--enter' : ['⌫', 'C', '×'].includes(t) ? ' tecla--accion' : ''}`,
    dataset: { tecla: t },
    'aria-label': nombres[t] ?? t,
    text: t,
  })));
}

// ===================================================================== eventos

const FUNCIONES = {
  buscar: buscarProducto,
  consultar: consultarPrecio,
  espera: enEspera,
  descuento: descuentoTicket,
  devolucion: alternarDevolucion,
  mas: menuMas,
};

const TECLAS_FUNCION = {
  F1: ayuda,
  F2: consultarPrecio,
  F3: buscarProducto,
  F4: () => accionLinea('anular-linea'),
  F5: () => accionLinea('cantidad'),
  F6: enEspera,
  F7: descuentoTicket,
  F8: alternarDevolucion,
  F9: menuMas,
  F10: cobrarTicket,
};

function alTeclear(e) {
  if (estado.pantalla !== 'venta') return;
  if (hayDialogoAbierto()) {
    if (/^F\d{1,2}$/.test(e.key) && e.key !== 'F11' && e.key !== 'F12') e.preventDefault();
    return;
  }
  const tecla = e.key;
  if (TECLAS_FUNCION[tecla]) {
    e.preventDefault();
    encolar(TECLAS_FUNCION[tecla]);
    return;
  }
  if (e.ctrlKey && tecla.toLowerCase() === 'b') {
    e.preventDefault();
    bloquear();
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  switch (tecla) {
    case 'Enter':
      e.preventDefault();
      procesarEntrada();
      return;
    case 'Escape':
      e.preventDefault();
      if (estado.entrada || estado.multiplicador) limpiarEntrada();
      else if (estado.cobrado) ocultarCobrado();
      else if (estado.seleccion) {
        estado.seleccion = null;
        pintarTicket();
      }
      return;
    case 'Backspace':
      e.preventDefault();
      borrarCaracter();
      return;
    case 'Delete':
      e.preventDefault();
      encolar(() => accionLinea('anular-linea'));
      return;
    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const delta = tecla === 'ArrowUp' ? -1 : 1;
      if (estado.sugerencias.length) {
        estado.sugerenciaActiva = (estado.sugerenciaActiva + delta + estado.sugerencias.length) % estado.sugerencias.length;
        pintarSugerencias();
      } else {
        moverSeleccion(delta);
      }
      return;
    }
    case '+':
    case '-':
      if (estado.entrada === '') {
        e.preventDefault();
        encolar(() => accionLinea(tecla === '+' ? 'mas-uno' : 'menos'));
        return;
      }
      break;
    default:
      break;
  }
  if (tecla.length === 1) {
    e.preventDefault();
    escribir(tecla);
  }
}

function conectarEventos() {
  document.addEventListener('keydown', alTeclear);
  window.addEventListener('online', pintarRed);
  window.addEventListener('offline', pintarRed);
  setInterval(tic, 1000);

  $('form-configurar').addEventListener('submit', configurar);
  $('btn-reconfigurar').addEventListener('click', mostrarConfigurar);

  // Acceso: solo el NIP, con teclado en pantalla; al sexto dígito entra solo
  const teclado = tecladoNumerico({ destino: () => campoAccesoActivo ?? $('acceso-nip'), clase: 'teclado--acceso' });
  teclado.id = 'teclado-acceso';
  $('teclado-acceso').replaceWith(teclado);
  $('acceso-nip').setAttribute('inputmode', 'none');
  $('acceso-nip').addEventListener('focus', () => { campoAccesoActivo = $('acceso-nip'); });
  $('acceso-nip').addEventListener('input', () => {
    if (esNIP($('acceso-nip').value)) entrar();
  });
  $('form-acceso').addEventListener('submit', (e) => {
    e.preventDefault();
    entrar();
  });

  // Pantalla de venta: los botones no se quedan con el foco (Enter es del escáner)
  $('pantalla-venta').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  $('teclado-venta').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-tecla]');
    if (!boton) return;
    const t = boton.dataset.tecla;
    if (t === 'Enter') procesarEntrada();
    else if (t === '⌫') borrarCaracter();
    else if (t === 'C') limpiarEntrada();
    else if (t === '×') fijarMultiplicador();
    else for (const c of t) escribir(c);
  });
  $('deptos').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-depto]');
    if (!boton) return;
    const depto = estado.config.departamentos.find((d) => d.id === boton.dataset.depto);
    if (depto) encolar(() => venderDepartamento(depto));
  });
  $('sugerencias').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-indice]');
    if (!boton) return;
    const producto = estado.sugerencias[Number(boton.dataset.indice)];
    limpiarEntrada({ multiplicador: false });
    if (producto) encolar(() => agregarProducto(producto));
  });
  $('ticket-lineas').addEventListener('click', (e) => {
    const linea = e.target.closest('.linea');
    if (!linea) return;
    estado.seleccion = linea.dataset.id;
    pintarTicket();
  });
  $('acciones-linea').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (boton) encolar(() => accionLinea(boton.dataset.accion));
  });
  $('funciones').addEventListener('click', (e) => {
    const boton = e.target.closest('[data-accion]');
    if (boton && FUNCIONES[boton.dataset.accion]) encolar(FUNCIONES[boton.dataset.accion]);
  });
  $('btn-cobrar').addEventListener('click', () => encolar(cobrarTicket));
  $('btn-cancelar-ticket').addEventListener('click', () => encolar(cancelarTicket));
  $('btn-bloquear').addEventListener('click', bloquear);
  $('btn-reimprimir').addEventListener('click', () => {
    if (estado.cobrado) imprimirVenta(estado.cobrado, { copia: true });
  });
  $('btn-nuevo-ticket').addEventListener('click', ocultarCobrado);

  onAuthStateChanged(auth, (usuario) => {
    if (!usuario && estado.pantalla === 'venta' && !estado.saliendo && !estado.cerrando) {
      salir({ mensaje: tx('La sesión se cerró. Entra de nuevo para seguir con tu turno.'), tipo: 'aviso' });
    }
  });
}

// ===================================================================== idioma

/**
 * Botón de idioma en la barra. Cambiar de idioma recarga la página: el ticket
 * en curso y los de espera están guardados en el equipo y, si la caja estaba
 * vendiendo (sin bloquear), vuelve sin pedir el NIP. Desde ahí todo sale en el
 * idioma nuevo, también lo que se imprime; lo que se guarda (movimientos en
 * vivo) sigue en español.
 */
const CLAVE_SIN_BLOQUEO = 'aguila.caja.idiomaSinBloqueo';
const VIGENCIA_SIN_BLOQUEO_MS = 30 * 1000;

function botonIdiomaCaja() {
  return botonIdioma({
    clase: 'barra__boton barra__idioma',
    antesDeRecargar: () => {
      if (estado.pantalla !== 'venta' || estado.bloqueada || !estado.turno || hayDialogoAbierto()) return;
      try {
        sessionStorage.setItem(CLAVE_SIN_BLOQUEO, JSON.stringify({ turno: estado.turno.id, hasta: Date.now() + VIGENCIA_SIN_BLOQUEO_MS }));
      } catch {
        // sin almacenamiento: al volver pide el NIP, como en cualquier recarga
      }
    },
  });
}

/** El turno que se retoma sin bloquear (una sola vez, recién cambiado el idioma), o null. */
function tomarSinBloqueo() {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_SIN_BLOQUEO) ?? 'null');
    sessionStorage.removeItem(CLAVE_SIN_BLOQUEO);
    return guardado && typeof guardado.turno === 'string' && Date.now() <= guardado.hasta ? guardado.turno : null;
  } catch {
    return null;
  }
}

// ===================================================================== arranque

async function arrancar() {
  const sinBloqueo = tomarSinBloqueo();
  $('barra-reloj').after(botonIdiomaCaja());
  conectarEventos();
  construirTecladoVenta();
  tic();
  estado.asignacion = local.leerAsignacion();
  if (!estado.asignacion) {
    mostrarConfigurar();
    return;
  }
  const sinClave = !claveCajaValida(local.leerClaveCaja());
  $('cargando-texto').textContent = tx('Recuperando la sesión…');
  const usuario = await usuarioActual();
  if (usuario) {
    try {
      const personal = await fichaEfectiva(usuario);
      const caja = await leerCaja(estado.asignacion.id);
      if (caja?.turnoActual && caja.turnoCajero === personal.usuario) {
        const turno = await leerTurno(caja.turnoActual);
        if (turno?.estado === 'abierto') {
          estado.personal = personal;
          await iniciarVenta(turno, { bloqueada: sinBloqueo !== turno.id });
          return;
        }
      }
    } catch (error) {
      console.warn('No se pudo retomar la sesión', error);
    }
    await cerrarSesionSilenciosa().catch(() => {});
  }
  if (sinClave) {
    mostrarConfigurar({ renovar: true });
    return;
  }
  mostrarAcceso();
}

arrancar().catch((error) => {
  console.error(error);
  $('cargando-texto').textContent = tx('No se pudo iniciar la caja: {error}', { error: mensajeDe(error) });
});
