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
import { claveCajaValida } from './nip.js';
import { observarCatalogo, buscarPorUPC, esperarConfirmacion } from './productos.js';
import {
  leerConfigPos, leerCaja, listarCajas, leerTienda, leerTurno,
  observarConfigPos, observarCaja, observarTienda, observarTurno,
  turnosAbiertosDe, abrirTurno, cerrarTurno, leerTurnoCompleto,
  observarVentasDeTurno, observarMovimientosDeTurno, guardarVenta, registrarMovimiento,
  comprobarSecretoEnServidor, autorizarComoAdmin,
} from './pos-datos.js';
import { configConDefectos } from './config-pos.js';
import {
  LIMITES_TICKET, NOMBRE_METODO, calcularTicket, lineaDeProducto, lineaDeDepartamento, lineaAcumulable,
  importeBruto, dividirRedondeado, redondearEfectivo, gramosDesdeTexto, formatearPeso, cantidadDesdeTexto,
  puntosBaseDesdeTexto, formatearPorcentaje, nombreDeProducto, claveDia, folioVenta, folioDesdeTexto,
  armarVenta, validarVenta, interpretarCodigoBalanza,
} from './ticket.js';
import { resumirTurno, milisDe, NOMBRE_MOVIMIENTO } from './turnos.js';
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
    avisar('No se pudo imprimir. Revisa la impresora.', 'error');
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
const deLaTienda = (p, tienda) => !Array.isArray(p.tiendas) || p.tiendas.length === 0 || p.tiendas.includes(tienda);
const nombreConPresentacion = (p) => [nombreDeProducto(p), p.presentacion].filter(Boolean).join(' · ');
const precioProducto = (p) => (p.unidadVenta === 'peso' ? `${dinero(p.precioPorKgCentavos ?? 0)}/kg` : dinero(p.precioCentavos ?? 0));
const detalleProducto = (p) => [p.upc, p.plu ? `PLU ${p.plu}` : null, p.claseFiscal === 'gravado' ? '+Tx' : null, p.activo === false ? 'INACTIVO' : null]
  .filter(Boolean).join(' · ');

// ===================================================================== pantallas, barra y reloj

function mostrar(pantalla) {
  estado.pantalla = pantalla;
  for (const nombre of PANTALLAS) $(`pantalla-${nombre}`).hidden = nombre !== pantalla;
  pintarBarra();
}

function pintarBarra() {
  const a = estado.asignacion;
  const barraCaja = $('barra-caja');
  barraCaja.replaceChildren();
  if (a) barraCaja.append(h('strong', { text: a.nombre }), ` · ${a.tiendaNombre ?? a.tienda}`);
  const enVenta = estado.pantalla === 'venta' && !!estado.personal;
  $('barra-cajera').hidden = !enVenta;
  if (enVenta) $('barra-cajera').replaceChildren('Atiende: ', h('strong', { text: estado.personal.nombre }));
  $('btn-bloquear').hidden = !enVenta;
  document.title = a ? `${a.nombre} · Águila POS` : 'Caja · Águila POS';
  pintarRed();
}

function pintarRed() {
  const enLinea = navigator.onLine;
  const pendientes = estado.pantalla === 'venta' ? estado.pendientes : 0;
  let clave = 'en-linea';
  let texto = 'En línea';
  if (!enLinea) {
    clave = 'sin-conexion';
    texto = pendientes ? `Sin conexión · ${pendientes} por enviar` : 'Sin conexión';
  } else if (pendientes) {
    clave = 'enviando';
    texto = `Enviando ${pendientes}…`;
  }
  $('barra-estado').dataset.estado = clave;
  $('barra-estado-texto').textContent = texto;
}

const formatoFechaLarga = new Intl.DateTimeFormat('es-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
  $('config-titulo').textContent = renovar ? 'Un administrador debe configurar esta caja otra vez' : 'Esta computadora todavía no es una caja';
  $('config-nota').textContent = renovar
    ? 'Ahora cada colaborador entra solo con su NIP. Para eso, un administrador entra aquí una vez y elige la caja (puede ser la misma).'
    : 'Un administrador la asigna a una de las cajas dadas de alta en el back office (Cajas). Solo se hace una vez por computadora; después cada colaborador entra solo con su NIP.';
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
  boton.textContent = 'Comprobando…';
  try {
    const { personal } = await iniciarSesion($('config-identificador').value, $('config-secreto').value);
    if (personal.rol !== 'admin') {
      await cerrarSesionSilenciosa();
      throw fallo('Solo un administrador puede asignar esta computadora a una caja.');
    }
    // La clave de caja queda en el equipo: con ella, cada quien entra solo con su NIP.
    local.guardarClaveCaja(await obtenerClaveCaja(personal.usuario));
    const cajas = (await listarCajas()).filter((c) => c.activo);
    if (cajas.length === 0) {
      await cerrarSesionSilenciosa();
      mensajeConfigurar('No hay cajas activas. Da de alta las cajas en el back office (Cajas) y vuelve aquí.', 'aviso');
      return;
    }
    const nombres = new Map();
    for (const id of new Set(cajas.map((c) => c.tienda))) nombres.set(id, (await leerTienda(id).catch(() => null))?.nombre ?? id);
    const contenedor = $('config-cajas');
    contenedor.replaceChildren(
      h('p', { class: 'tarjeta-pos__nota', style: 'grid-column: 1 / -1; margin: 0', text: '¿Qué caja es esta computadora?' }),
      ...cajas.map((caja) => h('button', {
        type: 'button',
        onclick: () => asignar(caja, nombres.get(caja.tienda)),
      }, h('strong', { text: caja.nombre }), h('span', { text: nombres.get(caja.tienda) }),
      h('small', { text: caja.turnoActual ? `Turno abierto: ${caja.turnoCajeroNombre}` : 'Libre' }))),
    );
    $('form-configurar').hidden = true;
    contenedor.hidden = false;
    contenedor.querySelector('button')?.focus();
  } catch (error) {
    mensajeConfigurar(mensajeDe(error));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Continuar';
    $('config-secreto').value = '';
  }
}

async function asignar(caja, tiendaNombre) {
  estado.asignacion = { id: caja.id, nombre: caja.nombre, numero: caja.numero, tienda: caja.tienda, tiendaNombre: tiendaNombre ?? caja.tienda };
  local.guardarAsignacion(estado.asignacion);
  await cerrarSesionSilenciosa().catch(() => {});
  mostrarAcceso();
  avisar(`Esta computadora quedó asignada a ${caja.nombre}.`, 'ok');
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

function ocupadoAcceso(ocupado, texto = 'Entrar') {
  const boton = $('acceso-entrar');
  boton.disabled = ocupado;
  boton.textContent = ocupado ? texto : 'Entrar';
  $('acceso-nip').disabled = ocupado;
}

const CREDENCIAL_INCORRECTA = new Set(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials', 'caja/nip-incorrecto']);

/** Entrar solo con el NIP: la clave de la caja dice de quién es (js/nip.js). */
async function entrar() {
  if (entrando) return;
  const nip = $('acceso-nip').value.trim();
  if (!esNIP(nip)) {
    mensajeAcceso('Escribe tu NIP de 6 dígitos.');
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
  ocupadoAcceso(true, 'Entrando…');
  let enVenta = false;
  try {
    const { personal } = await iniciarSesionConNip(nip, clave);
    estado.personal = personal;
    enVenta = await prepararTurno(personal, nip);
  } catch (error) {
    registrarError(error);
    mensajeAcceso(CREDENCIAL_INCORRECTA.has(String(error?.code ?? '')) ? 'NIP incorrecto.' : mensajeDe(error));
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
  ocupadoAcceso(true, 'Revisando la caja…');
  let caja;
  try {
    caja = await leerCaja(estado.asignacion.id, { servidor: true });
  } catch {
    throw fallo('Sin conexión con el servidor: para abrir o retomar un turno se necesita internet.');
  }
  if (!caja) throw fallo('Esta caja ya no existe en el back office. Un administrador debe asignar la computadora a otra caja.');
  if (!caja.activo) throw fallo(`${caja.nombre} está desactivada en el back office.`);
  actualizarAsignacion(caja);

  if (caja.turnoActual) {
    if (caja.turnoCajero === personal.usuario) {
      const turno = await leerTurno(caja.turnoActual);
      if (!turno || turno.estado !== 'abierto') throw fallo('No se pudo recuperar tu turno. Inténtalo de nuevo.');
      await guardarVerificadorNip(personal, turno, nip);
      await iniciarVenta(turno);
      avisar(`Hola de nuevo, ${personal.nombre}. Tu turno sigue abierto desde las ${hora(turno.abiertoEn)}.`, 'ok');
      return true;
    }
    if (personal.rol === 'admin') {
      await cerrarTurnoAjeno(caja, personal);
      return false;
    }
    estadoAcceso(`Turno abierto de ${caja.turnoCajeroNombre} desde las ${hora(caja.turnoDesde)}.`, 'ocupada');
    throw fallo(`La caja está ocupada por ${caja.turnoCajeroNombre}. Debe cerrar su turno esa persona o un administrador.`);
  }

  const abiertos = await turnosAbiertosDe(personal.usuario);
  const otro = abiertos.find((t) => t.caja !== caja.id);
  if (otro) throw fallo(`Tienes un turno abierto en ${otro.cajaNombre} desde las ${hora(otro.abiertoEn)}. Ciérralo en esa caja antes de abrir otro.`);

  const [config, tienda] = await Promise.all([leerConfigPos().catch(() => estado.config), leerTienda(caja.tienda).catch(() => null)]);
  estado.config = config;
  if (tienda) actualizarAsignacion(caja, tienda.nombre);
  const fondo = await pedirFondo({ sugeridoCentavos: config.fondoSugeridoCentavos });
  if (fondo === null) {
    mensajeAcceso('No se abrió el turno.', 'info');
    return false;
  }
  ocupadoAcceso(true, 'Abriendo turno…');
  const turnoId = await abrirTurno({ caja, tienda, personal, fondoCentavos: fondo });
  const turno = await leerTurno(turnoId);
  await guardarVerificadorNip(personal, turno, nip);
  imprimirSeguro(comprobanteApertura(turno, { tienda, config }));
  await iniciarVenta(turno);
  avisar(`Turno abierto con ${dinero(fondo)} de fondo. ¡Buen turno, ${personal.nombre}!`, 'ok');
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

function nuevoTicket() {
  return {
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
    if (estado.pantalla === 'venta' && !estado.saliendo) avisar(`No se pudo leer ${nombre}: ${mensajeDe(error)}`, 'error');
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
  }, fallaListener('la configuración')));
  s.push(observarTienda(turno.tienda, (tienda) => {
    estado.tienda = tienda;
  }, fallaListener('la tienda')));
  s.push(observarCaja(turno.caja, (caja, meta) => {
    estado.caja = caja;
    if (caja && !meta.pendiente && !meta.desdeCache && caja.turnoActual !== turno.id) turnoCerradoFuera();
  }, fallaListener('la caja')));
  s.push(observarTurno(turno.id, (t, meta) => {
    if (!t) return;
    estado.turno = t;
    if (t.estado === 'cerrado' && !meta.pendiente) turnoCerradoFuera();
  }, fallaListener('el turno')));
  s.push(observarVentasDeTurno(turno.id, yo, (ventas, { pendientes }) => {
    estado.ventas = ventas;
    estado.pendientes = pendientes;
    pintarRed();
  }, fallaListener('las ventas del turno')));
  s.push(observarMovimientosDeTurno(turno.id, yo, (movimientos) => {
    estado.movimientos = movimientos;
  }, fallaListener('los movimientos de efectivo')));
  s.push(observarCatalogo(({ catalogo, desdeCache }) => {
    estado.catalogo = catalogo;
    if (!desdeCache || catalogo.size > 0) estado.catalogoListo = true;
    reindexar();
  }, fallaListener('el catálogo')));

  mostrar('venta');
  pintarDepartamentos();
  pintarTicket();
  pintarEntrada();
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
    titulo: 'Tu turno fue cerrado',
    texto: 'Un administrador cerró tu turno en esta caja. Las ventas que hiciste quedaron registradas en su corte.',
    nota: 'Para seguir vendiendo, entra de nuevo y abre un turno nuevo.',
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
    errorCaja('Para multiplicar, escribe la cantidad (1 a 999) y luego toca ×.');
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
    ? `Escanea el producto: se agregará ${estado.multiplicador} veces`
    : devolucion ? 'Escanea el artículo que regresa el cliente' : 'Escanea, o escribe código, PLU o nombre';
  $('entrada').classList.toggle('entrada--activa', texto !== '' || estado.multiplicador !== null);
  const mult = $('entrada-multiplicador');
  mult.hidden = estado.multiplicador === null;
  mult.textContent = estado.multiplicador ? `${estado.multiplicador} ×` : '';
  const monto = $('entrada-monto');
  const precio = texto.length <= 7 ? precioDeTexto(texto) : null;
  monto.hidden = precio === null || precio === 0;
  if (!monto.hidden) monto.textContent = `Depto. ${dinero(precio)}`;
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
    else if (estado.multiplicador) errorCaja('Escanea o escribe el producto que quieres multiplicar.');
    return;
  }
  if (/[a-zñáéíóúü]/i.test(texto)) {
    const elegido = estado.sugerencias[estado.sugerenciaActiva];
    if (!elegido) {
      errorCaja(`No hay productos que coincidan con «${texto}».`);
      return;
    }
    limpiarEntrada({ multiplicador: false });
    encolar(() => agregarProducto(elegido));
    return;
  }
  limpiarEntrada({ multiplicador: false });
  if (!/^\d+$/.test(texto)) {
    errorCaja(precioDeTexto(texto) !== null
      ? 'Para vender por departamento, escribe el precio y toca el departamento.'
      : `«${texto}» no es un código válido.`);
    return;
  }
  encolar(() => procesarCodigo(texto));
}

async function procesarCodigo(texto) {
  asegurarIndices();
  if (texto.length <= 5) {
    const producto = elegirDeTienda(estado.porPLU.get(texto));
    if (producto) return agregarProducto(producto);
    if (texto.length >= 4) throw fallo(`No hay ningún producto con el PLU ${texto}.`);
    throw fallo('Para vender por departamento, escribe el precio y toca el departamento.');
  }
  const folio = folioDesdeTexto(texto);
  const ventaFolio = folio ? estado.ventas.find((v) => v.folio === folio) : null;
  let upc;
  try {
    upc = normalizarUPC(texto);
  } catch {
    if (ventaFolio) return verTicket(ventaFolio);
    if (folio) throw fallo(`El ticket ${folio} no es de este turno. Para una devolución usa Devolución (F8).`);
    throw fallo(`Código no válido (${texto}). Vuelve a escanearlo.`);
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

function agregarLinea(linea) {
  if (estado.ticket.lineas.length >= LIMITES_TICKET.lineas) throw fallo('El ticket llegó al máximo de 300 líneas: cóbralo y abre otro.');
  if (estado.cobrado) ocultarCobrado();
  estado.ticket.lineas.push(linea);
  estado.seleccion = linea.id;
  estado.resaltar = linea.id;
  cambio();
  sonar('ok');
}

function pedirPeso(producto) {
  const precioKg = producto.precioPorKgCentavos;
  return pedirValor({
    titulo: nombreDeProducto(producto) || producto.nombre,
    etiqueta: 'Peso en kilos',
    nota: `${dinero(precioKg)} por kg${producto.claseFiscal === 'gravado' ? ` + ${estado.config.impuestoNombre}` : ''}. Pesa el producto y escribe los kilos (ej. 1.250).`,
    interpretar: gramosDesdeTexto,
    vista: (g) => `${formatearPeso(g)} × ${dinero(precioKg)}/kg = ${dinero(dividirRedondeado(g * precioKg, 1000))}`,
    decimal: true,
    aceptar: 'Agregar',
    maximo: 7,
  });
}

function pedirPrecio({ titulo, etiqueta = 'Precio', nota = null, inicial = '', aceptar = 'Aceptar' }) {
  return pedirValor({
    titulo,
    etiqueta,
    nota,
    inicial,
    interpretar: (texto) => {
      const centavos = centavosDesdeTexto(texto);
      if (centavos <= 0) throw new Error('El precio debe ser mayor que cero.');
      if (centavos > LIMITES_TICKET.precioCentavos) throw new Error('El precio es demasiado alto.');
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
  if (producto.activo === false) avisar(`«${nombreDeProducto(producto)}» está marcado como inactivo en el catálogo.`, 'aviso');

  if (precioEtiqueta !== null) {
    // Etiqueta de balanza: el importe viene impreso en el código.
    agregarLinea(lineaDeProducto({ ...producto, unidadVenta: 'pieza', upc: upc ?? producto.upc }, { cantidad: signo * (multiplicador ?? 1), precioCentavos: precioEtiqueta }));
    return;
  }
  if (producto.unidadVenta === 'peso') {
    if (multiplicador) avisar('Producto por peso: el multiplicador no aplica.', 'aviso');
    if (!Number.isSafeInteger(producto.precioPorKgCentavos) || producto.precioPorKgCentavos <= 0) {
      throw fallo(`«${nombreDeProducto(producto)}» no tiene precio por kilo en el catálogo. Véndelo por departamento.`);
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
      nota: 'Este producto no tiene precio en el catálogo: escribe el de la etiqueta. Avisa al administrador para corregirlo.',
      aceptar: 'Agregar',
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
    if (precio === null || precio <= 0) throw fallo('Escribe el precio con números (499 = $4.99) y toca el departamento.');
    limpiarEntrada({ multiplicador: false });
  }
  if (precio === null) {
    precio = await pedirPrecio({
      titulo: depto.nombre,
      nota: depto.claseFiscal === 'gravado' ? `Lleva ${estado.config.impuestoNombre}.` : 'Sin impuesto (tasa cero).',
      aceptar: 'Agregar',
    });
    if (precio === null) return;
  }
  if (precio > LIMITES_TICKET.precioCentavos) throw fallo('El precio es demasiado alto.');
  const devolucion = estado.ticket.modo === 'devolucion';
  const limite = estado.config.limiteVentaLibreCentavos;
  if (!devolucion && limite > 0 && precio > limite) {
    const autorizado = await asegurarAutorizacion('modificacion', `Venta libre de ${dinero(precio)} en ${depto.nombre} (más de ${dinero(limite)})`);
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
    detalle: d.claseFiscal === 'gravado' ? `+${estado.config.impuestoNombre}` : 'Sin impuesto',
  }));
  const elegido = await elegir({
    titulo: 'Producto no encontrado',
    texto: `El código ${upc} no está en el catálogo${precioCentavos ? ` (etiqueta de ${dinero(precioCentavos)})` : ''}. Puedes venderlo por departamento; avisa al administrador para darlo de alta.`,
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
    throw fallo('Toca primero una línea del ticket.');
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
      if (Math.abs(linea.cantidad) >= LIMITES_TICKET.cantidad) throw fallo('Máximo 999 piezas por línea.');
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
  return undefined;
}

async function cambiarCantidad(linea) {
  const signo = estado.ticket.modo === 'devolucion' ? -1 : 1;
  const cantidad = await pedirValor({
    titulo: linea.nombre,
    etiqueta: 'Cantidad de piezas',
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
}

async function cambiarPeso(linea) {
  const signo = estado.ticket.modo === 'devolucion' ? -1 : 1;
  const gramos = await pedirPeso({ nombre: linea.nombre, marca: '', precioPorKgCentavos: linea.precioUnitarioCentavos, claseFiscal: linea.claseFiscal });
  if (gramos === null) return;
  linea.pesoGramos = signo * gramos;
  estado.resaltar = linea.id;
  cambio();
}

async function cambiarPrecio(linea) {
  const devolucion = estado.ticket.modo === 'devolucion';
  const porKg = linea.unidad === 'peso' ? '/kg' : '';
  if (linea.departamento && !linea.productoId) {
    // Venta libre: el precio lo tecleó la cajera; corregirlo no es un cambio de precio del catálogo.
    const nuevo = await pedirPrecio({ titulo: `Corregir precio · ${linea.nombre}`, inicial: (linea.precioUnitarioCentavos / 100).toFixed(2) });
    if (nuevo === null) return;
    const limite = estado.config.limiteVentaLibreCentavos;
    if (!devolucion && limite > 0 && nuevo > limite) {
      const autorizado = await asegurarAutorizacion('modificacion', `Venta libre de ${dinero(nuevo)} en ${linea.nombre} (más de ${dinero(limite)})`);
      if (!autorizado) return;
    }
    linea.precioUnitarioCentavos = nuevo;
    estado.resaltar = linea.id;
    cambio();
    return;
  }
  const original = linea.precioOriginalCentavos ?? linea.precioUnitarioCentavos;
  const nuevo = await pedirPrecio({
    titulo: `Cambiar precio · ${linea.nombre}`,
    etiqueta: linea.unidad === 'peso' ? 'Precio nuevo por kg' : 'Precio nuevo',
    nota: `Precio del catálogo: ${dinero(original)}${porKg}. ${estado.personal.rol === 'admin' ? '' : 'Necesita la autorización de un administrador.'}`,
  });
  if (nuevo === null || nuevo === linea.precioUnitarioCentavos) return;
  const tipo = devolucion ? 'devolucion' : 'modificacion';
  const autorizado = await asegurarAutorizacion(tipo, `Cambio de precio: ${linea.nombre} ${dinero(original)}${porKg} → ${dinero(nuevo)}${porKg}`);
  if (!autorizado) return;
  linea.precioUnitarioCentavos = nuevo;
  linea.precioOriginalCentavos = nuevo === original ? null : original;
  estado.resaltar = linea.id;
  cambio();
}

function pedirDescuento({ titulo, baseCentavos }) {
  let tipo = 'porcentaje';
  let ctxDialogo = null;
  const campo = h('input', { id: 'descuento-valor', inputmode: 'none', autocomplete: 'off', maxlength: 8 });
  const etiqueta = h('label', { for: 'descuento-valor' });
  const previa = h('p', { class: 'dlg__nota', 'aria-live': 'polite' });
  const botonesTipo = [['porcentaje', 'Porcentaje (%)'], ['monto', 'Monto ($)']].map(([valor, texto]) => h('button', {
    type: 'button', class: 'opcion', dataset: { tipo: valor }, text: texto,
  }));
  const rapidos = h('div', { class: 'rapidos' }, [5, 10, 15, 20, 25, 50].map((p) => h('button', {
    type: 'button',
    class: 'btn',
    text: `${p} %`,
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
    if (centavos <= 0) throw new Error('El descuento debe ser mayor que cero.');
    if (centavos > baseCentavos) throw new Error(`El descuento no puede pasar de ${dinero(baseCentavos)}.`);
    return { tipo, centavos };
  }

  function pintar() {
    for (const b of botonesTipo) b.setAttribute('aria-pressed', String(b.dataset.tipo === tipo));
    etiqueta.textContent = tipo === 'porcentaje' ? 'Porcentaje de descuento' : 'Monto del descuento';
    rapidos.hidden = tipo !== 'porcentaje';
    try {
      const d = interpretar();
      const monto = d.tipo === 'porcentaje' ? Math.min(baseCentavos, dividirRedondeado(baseCentavos * d.puntosBase, 10000)) : d.centavos;
      previa.textContent = `Descuento de ${dinero(monto)} sobre ${dinero(baseCentavos)}.`;
    } catch {
      previa.textContent = `Sobre ${dinero(baseCentavos)}.`;
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
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: 'Aplicar descuento', valor: 'aceptar', principal: true },
    ],
    alAbrir: (ctx) => {
      ctxDialogo = ctx;
      campo.focus();
    },
    alPulsar: (_valor, ctx) => ctx.cerrar({ descuento: interpretar() }),
  }).then((r) => r?.descuento ?? null);
}

async function descuentoLinea(linea) {
  if (estado.ticket.modo === 'devolucion') throw fallo('Una devolución no lleva descuentos.');
  if (linea.descuento) {
    const opcion = await elegir({
      titulo: 'Descuento de la línea',
      texto: `${linea.nombre} tiene ${describirDescuento(linea.descuento)} de descuento.`,
      opciones: [{ texto: 'Cambiar el descuento', valor: 'cambiar' }, { texto: 'Quitar el descuento', valor: 'quitar' }],
    });
    if (!opcion) return;
    if (opcion === 'quitar') {
      linea.descuento = null;
      estado.resaltar = linea.id;
      cambio();
      return;
    }
  }
  const descuento = await pedirDescuento({ titulo: `Descuento · ${linea.nombre}`, baseCentavos: importeBruto(linea) });
  if (!descuento) return;
  const autorizado = await asegurarAutorizacion('modificacion', `Descuento de ${describirDescuento(descuento)} a ${linea.nombre}`);
  if (!autorizado) return;
  linea.descuento = descuento;
  estado.resaltar = linea.id;
  cambio();
}

async function descuentoTicket() {
  const t = estado.ticket;
  if (t.modo === 'devolucion') throw fallo('Una devolución no lleva descuentos.');
  if (t.lineas.length === 0) throw fallo('Agrega productos antes de hacer un descuento.');
  if (t.descuentoTicket) {
    const opcion = await elegir({
      titulo: 'Descuento al ticket',
      texto: `El ticket tiene ${describirDescuento(t.descuentoTicket)} de descuento.`,
      opciones: [{ texto: 'Cambiar el descuento', valor: 'cambiar' }, { texto: 'Quitar el descuento', valor: 'quitar' }],
    });
    if (!opcion) return;
    if (opcion === 'quitar') {
      t.descuentoTicket = null;
      cambio();
      return;
    }
  }
  const calculo = calcular();
  const descuento = await pedirDescuento({ titulo: 'Descuento a todo el ticket', baseCentavos: calculo.subtotalCentavos });
  if (!descuento) return;
  const autorizado = await asegurarAutorizacion('modificacion', `Descuento de ${describirDescuento(descuento)} a todo el ticket`);
  if (!autorizado) return;
  t.descuentoTicket = descuento;
  cambio();
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
  avisar(`Línea anulada: ${linea.nombre}`, 'info', 2200);
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
  avisar(`Autorizado por ${resultado.nombreAdmin}.`, 'ok');
  return true;
}

function pedirAutorizacion(tipo, detalle) {
  const nip = h('input', { id: 'aut-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 6 });
  return abrirDialogo({
    titulo: tipo === 'devolucion' ? 'Autorizar devolución' : 'Autorización de administrador',
    cuerpo: [
      h('p', { class: 'dlg__texto' }, h('strong', { text: detalle })),
      h('p', { class: 'dlg__nota', text: 'Un administrador escribe aquí su NIP. El turno de la cajera sigue abierto.' }),
      h('div', { class: 'campo-pos' }, h('label', { for: 'aut-nip', text: 'NIP del administrador' }), nip),
      tecladoNumerico({ destino: nip }),
    ],
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: 'Autorizar', valor: 'autorizar', principal: true },
    ],
    alAbrir: () => nip.focus(),
    alPulsar: async (_valor, ctx) => {
      if (!esNIP(nip.value)) throw new Error('Escribe el NIP de 6 dígitos del administrador.');
      if (!claveCajaValida(local.leerClaveCaja())) throw new Error('Esta caja todavía no tiene su clave: al cerrar el turno, un administrador debe configurarla otra vez («Asignar esta computadora a otra caja»).');
      if (!navigator.onLine) throw new Error('Sin conexión: para autorizar se necesita internet.');
      ctx.error('Comprobando…', 'info');
      try {
        const resultado = await autorizarComoAdmin({ nip: nip.value, claveCaja: local.leerClaveCaja(), tipo, turno: estado.turno, detalle });
        ctx.cerrar(resultado);
      } catch (error) {
        nip.value = '';
        throw new Error(CREDENCIAL_INCORRECTA.has(String(error?.code ?? '')) ? 'NIP incorrecto.' : mensajeDe(error));
      }
    },
  });
}

// ===================================================================== devolución, espera y cancelación

function pedirFolioOriginal() {
  const campo = h('input', { id: 'folio-original', autocomplete: 'off', maxlength: 20, placeholder: 'AAMMDD-CC-NNNN' });
  return abrirDialogo({
    titulo: 'Devolución',
    cuerpo: [
      h('p', { class: 'dlg__texto', text: 'Escanea el código de barras del recibo original o escribe su folio.' }),
      h('label', { for: 'folio-original', text: 'Folio del ticket original' }),
      campo,
      h('p', { class: 'dlg__nota', text: 'Si el cliente no trae recibo, toca «Sin recibo». La devolución necesita la autorización de un administrador.' }),
    ],
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: 'Sin recibo', valor: 'sin' },
      { texto: 'Continuar', valor: 'continuar', principal: true },
    ],
    alPulsar: (valor, ctx) => {
      if (valor === 'sin') {
        ctx.cerrar({ folio: '' });
        return;
      }
      const folio = folioDesdeTexto(campo.value);
      if (!folio) throw new Error('Folio no válido: escanea el código del recibo o escribe AAMMDD-CC-NNNN.');
      ctx.cerrar({ folio });
    },
  }).then((r) => (r ? r.folio : null));
}

async function alternarDevolucion() {
  const t = estado.ticket;
  if (t.modo === 'devolucion') {
    if (t.lineas.length) throw fallo('Cobra o cancela la devolución antes de volver a la venta.');
    estado.ticket = nuevoTicket();
    cambio();
    pintarEntrada();
    avisar('De vuelta a la venta normal.', 'info');
    return;
  }
  if (t.lineas.length) throw fallo('La devolución va en un ticket aparte: cobra o pon en espera este ticket primero.');
  const folio = await pedirFolioOriginal();
  if (folio === null) return;
  estado.ticket = { ...nuevoTicket(), modo: 'devolucion', ventaOriginal: folio || null };
  const autorizado = await asegurarAutorizacion('devolucion', folio ? `Devolución del ticket ${folio}` : 'Devolución sin recibo');
  if (!autorizado) {
    estado.ticket = nuevoTicket();
    cambio();
    return;
  }
  cambio();
  pintarEntrada();
  avisar('Modo devolución: escanea los artículos que regresa el cliente.', 'aviso');
}

function ticketsEnEspera() {
  return local.leerEspera(estado.turno.caja).filter((t) => t.turno === estado.turno.id);
}

function resumenTicket(ticket) {
  const c = calcular(ticket);
  return `${Math.abs(c.articulos)} artículo(s) · ${dinero(c.totalCentavos)}${ticket.modo === 'devolucion' ? ' · devolución' : ''}`;
}

function guardarEnEspera() {
  const lista = ticketsEnEspera();
  if (lista.length >= local.MAXIMO_EN_ESPERA) throw fallo(`Ya hay ${local.MAXIMO_EN_ESPERA} tickets en espera: recupera o cobra alguno.`);
  lista.push({ id: `e${Date.now().toString(36)}`, turno: estado.turno.id, guardadoEn: Date.now(), ticket: estado.ticket });
  local.guardarEspera(estado.turno.caja, lista);
  estado.ticket = nuevoTicket();
  estado.seleccion = null;
  cambio();
  pintarEntrada();
  avisar('Ticket en espera. Recupéralo con «En espera» (F6).', 'ok');
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
  avisar('Ticket recuperado.', 'ok');
}

async function enEspera() {
  const lista = ticketsEnEspera();
  const conLineas = estado.ticket.lineas.length > 0;
  if (lista.length === 0) {
    if (conLineas) guardarEnEspera();
    else avisar('No hay tickets en espera.', 'info');
    return;
  }
  const opciones = [];
  if (conLineas) opciones.push({ texto: 'Poner este ticket en espera', valor: 'guardar', detalle: resumenTicket(estado.ticket) });
  for (const t of lista) opciones.push({ texto: `Ticket de las ${hora(t.guardadoEn)}`, valor: t.id, detalle: resumenTicket(t.ticket) });
  const elegido = await elegir({
    titulo: 'Tickets en espera',
    texto: conLineas ? 'Si recuperas otro, el ticket actual queda en espera.' : 'Elige el ticket que quieres recuperar.',
    opciones,
  });
  if (!elegido) return;
  if (elegido === 'guardar') guardarEnEspera();
  else recuperarDeEspera(elegido);
}

function registrarCancelacion(ticket, motivo) {
  const total = Math.abs(calcular(ticket).totalCentavos);
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo: 'cancelacion', importeCentavos: total, motivo });
  movimiento.promesa.catch((error) => avisar(`No se pudo registrar la cancelación: ${mensajeDe(error)}`, 'error', 0));
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
    titulo: 'Cancelar ticket',
    texto: `Se cancela el ticket de ${Math.abs(calculo.articulos)} artículo(s) por ${dinero(calculo.totalCentavos)}.`,
    nota: 'La cancelación queda registrada en el corte del turno.',
    aceptar: 'Cancelar ticket',
    cancelar: 'Volver',
    peligro: true,
  });
  if (!seguro) return;
  registrarCancelacion(t, `${Math.abs(calculo.articulos)} artículo(s)`);
  estado.ticket = nuevoTicket();
  estado.seleccion = null;
  cambio();
  pintarEntrada();
  avisar('Ticket cancelado.', 'info');
}

// ===================================================================== cobro

async function cobrarTicket() {
  const t = estado.ticket;
  if (t.lineas.length === 0) return;
  const calculo = calcular();
  const devolucion = t.modo === 'devolucion';
  if (devolucion && calculo.totalCentavos >= 0) throw fallo('La devolución no tiene importe.');
  if (!devolucion && calculo.totalCentavos < 0) throw fallo('El total no puede ser negativo.');
  let pagos = [];
  if (calculo.totalCentavos !== 0) {
    pagos = await cobrar({ totalCentavos: calculo.totalCentavos, devolucion });
    if (pagos === null) return;
  } else {
    const seguro = await confirmar({ titulo: 'Ticket sin importe', texto: 'El total es $0.00. ¿Registrar el ticket así?', aceptar: 'Registrar' });
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
    throw fallo(`No se pudo registrar el ticket (${errores[0]}). Avisa a un administrador.`);
  }
  const { id, promesa } = guardarVenta(venta);
  promesa.catch((error) => {
    console.error(error);
    avisar(`El servidor rechazó el ticket ${venta.folio}: ${mensajeDe(error)}. Avisa a un administrador.`, 'error', 0);
  });
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

function imprimirVenta(venta, { copia = false } = {}) {
  imprimirSeguro(reciboVenta(venta, { tienda: estado.tienda, config: estado.config, copia }));
}

function mostrarCobrado(venta) {
  estado.cobrado = venta;
  const devolucion = venta.tipo === 'devolucion';
  const panel = $('ticket-cobrado');
  panel.dataset.tipo = venta.tipo;
  $('cobrado-titulo').textContent = devolucion ? 'Devolución registrada' : 'Venta registrada';
  $('cobrado-folio').textContent = `Ticket ${venta.folio}`;
  $('cobrado-total').textContent = dinero(Math.abs(venta.totalCentavos + venta.redondeoCentavos));
  $('cobrado-pago-titulo').textContent = devolucion ? 'Se devolvió' : 'Pagó';
  $('cobrado-pago').textContent = venta.pagos.length
    ? venta.pagos.map((p) => `${NOMBRE_METODO[p.metodo]} ${dinero(Math.abs(p.recibidoCentavos ?? p.importeCentavos))}`).join(' + ')
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
    titulo: `Ticket ${venta.folio}`,
    cuerpo: [h('div', { class: 'vista-recibo' }, vistaRecibo(venta))],
    botones: [
      { texto: 'Cerrar', valor: null, cerrar: true },
      { texto: 'Reimprimir', valor: 'reimprimir', principal: true },
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
    avisar('Todavía no hay tickets en este turno.', 'info');
    return;
  }
  let elegida = null;
  const vista = h('div', { class: 'vista-recibo', hidden: true });
  const lista = h('ul', { class: 'lista-pos' }, ventas.map((v) => h('li', null, h('button', { type: 'button', dataset: { id: v.id } },
    h('span', { text: `${v.folio}${v.tipo === 'devolucion' ? ' · devolución' : ''}` }),
    h('small', { text: `${hora(v.fecha)} · ${Math.abs(v.articulos)} art. · ${v.pagos.map((p) => NOMBRE_METODO[p.metodo]).join(' + ') || '—'}${v.pendiente ? ' · por enviar' : ''}` }),
    h('strong', { text: dinero(v.totalCentavos) })))));
  await abrirDialogo({
    titulo: `Tickets del turno (${ventas.length})`,
    clase: 'dlg--ancho',
    cuerpo: [h('div', { style: 'display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:start' },
      h('div', { style: 'max-height:62vh; overflow:auto' }, lista), vista)],
    botones: [
      { texto: 'Cerrar', valor: null, cerrar: true },
      { texto: 'Reimprimir', valor: 'reimprimir', principal: true },
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
      if (!elegida) throw new Error('Elige un ticket de la lista.');
      imprimirVenta(elegida, { copia: true });
      avisar(`Copia del ticket ${elegida.folio} enviada a la impresora.`, 'ok');
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
    throw fallo('El monto es mayor que el efectivo que debería haber en el cajón. Revisa el monto.');
  }
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo, importeCentavos: datos.importeCentavos, motivo: datos.motivo });
  movimiento.promesa.catch((error) => avisar(`No se pudo guardar el movimiento: ${mensajeDe(error)}`, 'error', 0));
  imprimirSeguro(comprobanteMovimiento(movimiento.datos, { tienda: estado.tienda, config: estado.config, turno: estado.turno }));
  avisar(`${NOMBRE_MOVIMIENTO[tipo]} de ${dinero(datos.importeCentavos)} registrado.`, 'ok');
}

async function abrirCajon() {
  const motivo = await pedirTexto({
    titulo: 'Abrir cajón',
    etiqueta: 'Motivo (opcional)',
    nota: 'Se imprime un comprobante (la impresora abre el cajón) y queda registrado en el corte.',
    aceptar: 'Abrir cajón',
  });
  if (motivo === null) return;
  const movimiento = registrarMovimiento({ turno: estado.turno, personal: estado.personal, tipo: 'apertura', importeCentavos: 0, motivo: motivo || null });
  movimiento.promesa.catch((error) => avisar(`No se pudo registrar la apertura: ${mensajeDe(error)}`, 'error', 0));
  imprimirSeguro(comprobanteMovimiento(movimiento.datos, { tienda: estado.tienda, config: estado.config, turno: estado.turno }));
}

async function corteX() {
  const resumen = resumenActual();
  const ocultar = estado.config.conteoCiego && estado.personal.rol !== 'admin';
  const imprimirX = () => imprimirSeguro(reciboTurno(estado.turno, resumen, { tienda: estado.tienda, config: estado.config, tipo: 'X', ocultarEfectivo: ocultar }));
  imprimirX();
  await mostrarCorte({ turno: estado.turno, resumen, tipo: 'X', pendientes: estado.pendientes, alReimprimir: imprimirX, terminar: 'Volver a vender', ocultarEsperado: ocultar });
}

/** Comprueba el NIP de quien tiene el turno: contra Firebase, o sin conexión contra el verificador local. */
async function verificarNip(nip) {
  if (!nip) throw new Error('Escribe tu NIP.');
  const guardado = local.leerVerificador(estado.turno.caja);
  const conVerificador = async () => {
    if (guardado?.usuario === estado.personal.usuario && await comprobarVerificador(nip, guardado)) return;
    throw new Error(guardado ? 'NIP incorrecto.' : 'Sin conexión y sin verificación guardada en este equipo: conecta la caja a internet.');
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
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(codigo)) throw new Error('NIP incorrecto.');
    throw new Error(mensajeDe(error));
  }
}

function confirmarConNip({ titulo, texto, aceptar = 'Confirmar' }) {
  const campo = h('input', { id: 'confirmar-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 72 });
  return abrirDialogo({
    titulo,
    cuerpo: [h('p', { class: 'dlg__texto', text: texto }), h('div', { class: 'campo-pos' }, h('label', { for: 'confirmar-nip', text: 'Tu NIP' }), campo), tecladoNumerico({ destino: campo })],
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: aceptar, valor: 'aceptar', principal: true },
    ],
    alPulsar: async (_valor, ctx) => {
      ctx.error('Comprobando…', 'info');
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
    throw fallo(`El servidor no aceptó el cierre del turno: ${mensajeDe(error)}`);
  }
  promesa.catch((error) => avisar(`El cierre del turno no se pudo guardar: ${mensajeDe(error)}. Avisa a un administrador.`, 'error', 0));
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
  if (estado.ticket.lineas.length) throw fallo('Cobra o cancela el ticket en curso antes de cerrar el turno.');
  const espera = ticketsEnEspera();
  const seguir = await confirmar({
    titulo: 'Cerrar turno',
    texto: `Vas a cerrar tu turno en ${estado.turno.cajaNombre}. Primero cuenta todo el efectivo del cajón.`,
    nota: espera.length ? `Hay ${espera.length} ticket(s) en espera: se cancelarán y quedarán registrados en el corte.` : null,
    aceptar: 'Contar el efectivo',
  });
  if (!seguir) return;
  const previo = resumenActual();
  const conteo = await contarEfectivo({
    titulo: 'Cierre de turno · conteo del efectivo',
    nota: 'Cuenta TODO el efectivo del cajón, incluido el fondo inicial.',
    esperadoCentavos: estado.config.conteoCiego ? null : previo.efectivo.esperadoCentavos,
  });
  if (!conteo) return;
  const confirmado = await confirmarConNip({
    titulo: 'Confirma el cierre',
    texto: `Efectivo contado: ${dinero(conteo.totalCentavos)}. Escribe tu NIP para cerrar el turno e imprimir tu corte.`,
    aceptar: 'Cerrar turno',
  });
  if (!confirmado) return;

  estado.cerrando = true;
  try {
    const movimientos = [...estado.movimientos];
    for (const t of espera) {
      const m = registrarCancelacion(t.ticket, 'Ticket en espera cancelado al cerrar el turno');
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
  await salir({ turnoCerrado: true, mensaje: 'Turno cerrado. ¡Gracias!', tipo: 'info' });
}

/** Un administrador cierra desde esta caja el turno que otra persona dejó abierto. */
async function cerrarTurnoAjeno(caja, admin) {
  const seguir = await confirmar({
    titulo: 'Caja ocupada',
    texto: `${caja.nombre} tiene abierto el turno de ${caja.turnoCajeroNombre} desde las ${hora(caja.turnoDesde)}.`,
    nota: 'Como administrador puedes cerrarlo aquí: cuentas el efectivo del cajón y se imprime su corte Z. Queda registrado como cierre hecho por ti.',
    aceptar: 'Cerrar ese turno',
    peligro: true,
  });
  if (!seguir) {
    mensajeAcceso('La caja sigue ocupada.', 'info');
    return;
  }
  ocupadoAcceso(true, 'Leyendo el turno…');
  const { turno, ventas, movimientos } = await leerTurnoCompleto(caja.turnoActual);
  if (!turno || turno.estado !== 'abierto') throw fallo('Ese turno ya no está abierto.');
  const [config, tienda] = await Promise.all([leerConfigPos().catch(() => estado.config), leerTienda(turno.tienda).catch(() => null)]);
  const previo = resumirTurno({ turno, ventas, movimientos, departamentos: config.departamentos });
  const conteo = await contarEfectivo({
    titulo: `Conteo · turno de ${turno.cajeroNombre}`,
    nota: 'Cuenta todo el efectivo del cajón, incluido el fondo inicial.',
    esperadoCentavos: previo.efectivo.esperadoCentavos,
    aceptar: 'Cerrar el turno',
  });
  if (!conteo) {
    mensajeAcceso('El turno sigue abierto.', 'info');
    return;
  }
  ocupadoAcceso(true, 'Cerrando el turno…');
  await completarCierre({ turno, ventas, movimientos, config, tienda, conteo, quien: admin.usuario, nota: `Cerrado en la caja por ${admin.nombre}` });
  mensajeAcceso(`Turno de ${turno.cajeroNombre} cerrado. La caja está libre.`, 'info');
}

// ===================================================================== bloqueo

function bloquear() {
  if (estado.pantalla !== 'venta' || document.getElementById('dlg-bloqueo')) return;
  estado.bloqueada = true;
  const campo = h('input', { id: 'bloqueo-nip', type: 'password', inputmode: 'none', autocomplete: 'off', maxlength: 72 });
  const mensaje = h('p', { class: 'mensaje-pos', role: 'alert', hidden: true });
  const boton = h('button', { type: 'submit', class: 'btn btn--primario btn--grande', text: 'Desbloquear' });
  const forma = h('form', { class: 'bloqueo__caja', novalidate: true },
    h('h2', null, icono('candado'), 'Caja bloqueada'),
    h('p', { class: 'dlg__texto', text: `Turno de ${estado.personal.nombre} (${estado.personal.usuario}) en ${estado.turno.cajaNombre}.` }),
    h('label', { for: 'bloqueo-nip', text: 'NIP' }),
    campo,
    tecladoNumerico({ destino: campo }),
    mensaje,
    boton,
    h('p', { class: 'dlg__nota', text: 'Para que otra persona use esta caja, primero se cierra este turno.' }));
  const dialogo = h('dialog', { class: 'dlg dlg--pantalla', id: 'dlg-bloqueo', 'aria-label': 'Caja bloqueada' }, h('div', { class: 'bloqueo' }, forma));
  dialogo.addEventListener('cancel', (e) => e.preventDefault());
  forma.addEventListener('submit', async (e) => {
    e.preventDefault();
    boton.disabled = true;
    mensaje.hidden = false;
    mensaje.dataset.tipo = 'info';
    mensaje.textContent = 'Comprobando…';
    try {
      await verificarNip(campo.value);
      dialogo.close();
      dialogo.remove();
      estado.bloqueada = false;
      avisar('Caja desbloqueada.', 'ok', 1800);
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
      h('small', { text: `${porPeso ? 'por kg' : 'cada uno'}${p.claseFiscal === 'gravado' ? ` + ${estado.config.impuestoNombre}` : ' · sin impuesto'}` })),
    h('div', { class: 'ficha-producto__detalle', text: [p.presentacion, p.descriptor].filter(Boolean).join(' · ') || ' ' }),
    h('div', { class: 'ficha-producto__detalle', text: detalleProducto(p) || ' ' }));
}

async function consultarPrecio() {
  const campo = h('input', { id: 'consulta-codigo', autocomplete: 'off', maxlength: 40, placeholder: 'Código, PLU o nombre' });
  const resultado = h('div', { 'aria-live': 'polite' });
  let encontrado = null;
  const r = await abrirDialogo({
    titulo: 'Consultar precio',
    clase: 'dlg--ancho',
    cuerpo: [h('label', { for: 'consulta-codigo', text: 'Escanea el producto o escribe su código, PLU o nombre' }), campo, resultado],
    botones: [
      { texto: 'Cerrar', valor: null, cerrar: true },
      { texto: 'Agregar al ticket', valor: 'agregar' },
      { texto: 'Consultar', valor: 'consultar', principal: true },
    ],
    alAbrir: (ctx) => {
      ctx.boton('agregar').disabled = true;
    },
    alPulsar: async (valor, ctx) => {
      if (valor === 'agregar') {
        if (!encontrado) throw new Error('Primero consulta un producto.');
        ctx.cerrar({ producto: encontrado });
        return;
      }
      const texto = campo.value.trim();
      if (!texto) throw new Error('Escanea o escribe un código.');
      encontrado = await encontrarProducto(texto);
      campo.select();
      if (!encontrado) {
        resultado.replaceChildren();
        sonar('error');
        throw new Error(`No se encontró ningún producto con «${texto}».`);
      }
      sonar('ok');
      resultado.replaceChildren(fichaProducto(encontrado));
      queueMicrotask(() => { ctx.boton('agregar').disabled = false; });
    },
  });
  if (r?.producto) await agregarProducto(r.producto);
}

async function buscarProducto() {
  const campo = h('input', { id: 'buscar-texto', autocomplete: 'off', maxlength: 60, placeholder: 'Nombre, marca, código o PLU' });
  const lista = h('ul', { class: 'lista-pos', style: 'max-height:56vh; overflow:auto' });
  let resultados = [];
  const pintar = () => {
    const texto = campo.value.trim();
    resultados = texto.length >= 2 ? buscarEnCatalogo(texto, 40) : [];
    lista.replaceChildren(...(resultados.length
      ? resultados.map((p, i) => h('li', null, h('button', { type: 'button', dataset: { indice: String(i) } },
        h('span', { text: nombreConPresentacion(p) }), h('small', { text: detalleProducto(p) || ' ' }), h('strong', { text: precioProducto(p) }))))
      : [h('li', { class: 'lista-pos__vacia', text: texto.length >= 2 ? 'Sin resultados' : 'Escribe al menos 2 letras' })]));
  };
  campo.addEventListener('input', pintar);
  const r = await abrirDialogo({
    titulo: 'Buscar producto',
    clase: 'dlg--ancho',
    cuerpo: [campo, lista],
    botones: [
      { texto: 'Cerrar', valor: null, cerrar: true },
      { texto: 'Agregar el primero', valor: 'primero', principal: true },
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
      if (!resultados.length) throw new Error('No hay resultados.');
      ctx.cerrar({ producto: resultados[0] });
    },
  });
  if (r?.producto) await agregarProducto(r.producto);
}

const ATAJOS = [
  ['F1', 'Esta ayuda'], ['F2', 'Consultar precio'], ['F3', 'Buscar producto'], ['F4 o Supr', 'Anular línea'],
  ['F5', 'Cantidad de la línea'], ['F6', 'Tickets en espera'], ['F7', 'Descuento al ticket'], ['F8', 'Devolución'],
  ['F9', 'Más funciones'], ['F10', 'Cobrar'], ['Ctrl + B', 'Bloquear la caja'], ['↑ ↓', 'Elegir línea'],
  ['+ / −', 'Una pieza más / menos'], ['3 × (o 3*)', 'Multiplicar el siguiente producto'], ['499 + depto.', 'Venta libre de $4.99'], ['Esc', 'Borrar lo escrito'],
];

function ayuda() {
  return abrirDialogo({
    titulo: 'Atajos de teclado',
    clase: 'dlg--ancho',
    cuerpo: [h('dl', { class: 'atajos' }, ATAJOS.map(([tecla, texto]) => h('div', null, h('dt', { text: texto }), h('dd', null, h('kbd', { text: tecla })))))],
    botones: [{ texto: 'Entendido', valor: true, principal: true }],
  });
}

function pantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => avisar('El navegador no permitió la pantalla completa.', 'aviso'));
}

const MENU_MAS = [
  { valor: 'reimprimir', texto: 'Reimprimir último ticket', icono: 'imprimir' },
  { valor: 'tickets', texto: 'Tickets del turno', icono: 'buscar' },
  { valor: 'cajon', texto: 'Abrir cajón', icono: 'cajon' },
  { valor: 'retiro', texto: 'Retiro de efectivo', icono: 'cobrar' },
  { valor: 'entrada', texto: 'Entrada de efectivo', icono: 'cobrar' },
  { valor: 'pago', texto: 'Pago desde caja', icono: 'tarjeta' },
  { valor: 'x', texto: 'Corte parcial (X)', icono: 'reloj' },
  { valor: 'bloquear', texto: 'Bloquear caja', icono: 'candado' },
  { valor: 'cerrar', texto: 'Cerrar turno', icono: 'cerrar', peligro: true },
  { valor: 'pantalla', texto: 'Pantalla completa', icono: 'flecha' },
  { valor: 'ayuda', texto: 'Atajos de teclado', icono: 'etiqueta' },
];

async function menuMas() {
  const rejilla = h('div', { class: 'menu-funciones' }, MENU_MAS.map((op) => h('button', {
    type: 'button',
    class: `btn${op.peligro ? ' btn--peligro-suave' : ''}`,
    dataset: { valor: op.valor },
  }, icono(op.icono), h('span', { text: op.texto }))));
  const elegido = await abrirDialogo({
    titulo: 'Más funciones',
    clase: 'dlg--ancho',
    cuerpo: [rejilla],
    botones: [{ texto: 'Volver', valor: null, cerrar: true }],
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
      if (!estado.ultimaVenta) throw fallo('Todavía no hay tickets en este turno.');
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
  if (l.departamento) marcas.push(h('span', { class: 'marca-precio', text: 'Venta libre' }));
  if (l.precioOriginalCentavos !== null && l.precioOriginalCentavos !== undefined) marcas.push(h('span', { class: 'marca-precio', text: `Precio cambiado · era ${dinero(l.precioOriginalCentavos)}` }));
  if (l.descuento) marcas.push(h('span', { class: 'marca-desc', text: `Desc. ${describirDescuento(l.descuento)}` }));
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
  $('ticket-numero').textContent = `Ticket ${String(numero).padStart(4, '0')}`;
  $('ticket-modo').hidden = !devolucion;
  $('ticket-modo').textContent = t.ventaOriginal ? `DEVOLUCIÓN · ${t.ventaOriginal}` : 'DEVOLUCIÓN';
  $('ticket-autorizado').hidden = !t.autorizacion;
  $('ticket-autorizado').textContent = t.autorizacion ? `Autorizó ${t.autorizacion.nombre}` : '';
  const articulos = Math.abs(calculo.articulos);
  $('ticket-articulos').textContent = `${articulos} artículo${articulos === 1 ? '' : 's'}`;

  const lista = $('ticket-lineas');
  lista.replaceChildren(...calculo.lineas.map(nodoLinea));
  $('ticket-vacio').hidden = t.lineas.length > 0;
  $('ticket-vacio-texto').textContent = devolucion ? 'Escanea los artículos que regresa el cliente' : 'Escanea un producto o escribe su código';

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
  $('tot-total-nombre').textContent = devolucion ? 'Total a devolver' : 'Total';
  $('tot-total').textContent = dinero(calculo.totalCentavos);
  $('tot-efectivo').textContent = dinero(redondearEfectivo(calculo.totalCentavos));

  const botonCobrar = $('btn-cobrar');
  botonCobrar.disabled = t.lineas.length === 0;
  botonCobrar.classList.toggle('btn--reembolsar', devolucion);
  $('btn-cobrar-texto').textContent = devolucion ? 'Reembolsar' : 'Cobrar';
  $('btn-cobrar-total').textContent = dinero(Math.abs(calculo.totalCentavos));

  const funciones = $('funciones');
  funciones.querySelector('[data-accion="devolucion"]').setAttribute('aria-pressed', String(devolucion));
  funciones.querySelector('[data-accion="descuento"]').disabled = devolucion;
  const espera = ticketsEnEspera().length;
  funciones.querySelector('[data-accion="espera"] span').textContent = espera ? `En espera (${espera})` : 'En espera';

  if (estado.resaltar || estado.seleccion) lista.querySelector('.linea--seleccionada, .linea--nueva')?.scrollIntoView({ block: 'nearest' });
  estado.resaltar = null;
}

function pintarDepartamentos() {
  const config = estado.config;
  $('deptos').replaceChildren(...config.departamentos.map((d) => h('button', {
    type: 'button',
    class: `depto depto--${d.color}`,
    dataset: { depto: d.id },
  }, h('span', { text: d.nombre }), h('small', { text: d.claseFiscal === 'gravado' ? `+${config.impuestoNombre}` : 'Sin impuesto' }))));
}

function construirTecladoVenta() {
  const teclas = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', 'Enter', '0', '00', '×'];
  const nombres = { '⌫': 'Borrar', C: 'Limpiar', '×': 'Multiplicar' };
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
      salir({ mensaje: 'La sesión se cerró. Entra de nuevo para seguir con tu turno.', tipo: 'aviso' });
    }
  });
}

// ===================================================================== arranque

async function arrancar() {
  conectarEventos();
  construirTecladoVenta();
  tic();
  estado.asignacion = local.leerAsignacion();
  if (!estado.asignacion) {
    mostrarConfigurar();
    return;
  }
  const sinClave = !claveCajaValida(local.leerClaveCaja());
  $('cargando-texto').textContent = 'Recuperando la sesión…';
  const usuario = await usuarioActual();
  if (usuario) {
    try {
      const personal = await fichaEfectiva(usuario);
      const caja = await leerCaja(estado.asignacion.id);
      if (caja?.turnoActual && caja.turnoCajero === personal.usuario) {
        const turno = await leerTurno(caja.turnoActual);
        if (turno?.estado === 'abierto') {
          estado.personal = personal;
          await iniciarVenta(turno, { bloqueada: true });
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
  $('cargando-texto').textContent = `No se pudo iniciar la caja: ${mensajeDe(error)}`;
});
