/**
 * Captura rápida: cargar el catálogo recorriendo los anaqueles.
 * Escanear → nombre → marca → presentación → precio (+clase fiscal) → Enter.
 * Solo teclado. El guardado no espera al servidor: la fila entra en la
 * bitácora al instante y su marca cambia cuando Firestore confirma.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarCatalogo, observarTiendas, crearProducto, actualizarProducto } from './productos.js';
import { armarProducto, validarProducto, diferenciasProducto } from './esquema.js';
import { normalizarUPC } from './upca.js';
import { interpretarPrecio, formatearPrecio, indicadorFiscal, textoDesdeCentavos } from './precios.js';
import { renderEtiqueta, ajustarEtiqueta } from './etiquetas.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'captura.html' });

const $ = (id) => document.getElementById(id);
const form = $('form-captura');
const campos = {
  upc: $('c-upc'),
  nombre: $('c-nombre'),
  marca: $('c-marca'),
  presentacion: $('c-presentacion'),
  precio: $('c-precio'),
};
const radiosClase = [...form.querySelectorAll('input[name="clase"]')];
const selectTienda = $('tienda');
const casillaOtras = $('otras-tiendas');
const banner = $('banner');
const bitacora = $('bitacora');
const contador = $('contador');
const btnCorregir = $('btn-corregir');
const vistaEtiqueta = $('vista-etiqueta');

const PREFERENCIAS = { tienda: 'captura.tienda', otras: 'captura.otras', clase: 'captura.clase' };
const leerPreferencia = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardarPreferencia = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } };

let catalogo = new Map();
let porUPC = new Map();
let tiendas = [];
let existente = null; // producto ya en el catálogo para el UPC escaneado
let accionPendiente = null; // 'siguiente' | 'agregar' | 'reactivar'
let modo = 'captura'; // 'captura' | 'corregir'
let corrigiendo = null;
let ultimo = null; // último producto creado o tocado, para F4
let capturados = 0;
let temporizadorVista = null;
let temporizadorListas = null;

const nombreCompleto = (p) => [p.marca, p.nombre].filter(Boolean).join(' ');
const precioTexto = (p) => `${formatearPrecio(p.precioCentavos)}${indicadorFiscal(p.claseFiscal)}`;
const tiendaActual = () => selectTienda.value || null;
const nombreTienda = (id) => tiendas.find((t) => t.id === id)?.nombre ?? id;
const horaCorta = () => new Date().toLocaleTimeString('es-CA', { hour: '2-digit', minute: '2-digit' });

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function mostrarBanner(tipo, texto) {
  banner.textContent = texto;
  banner.className = `mensaje banner mensaje--${tipo}`;
  banner.hidden = !texto;
}

// ------------------------------------------------------------- datos
observarCatalogo(
  ({ catalogo: mapa, desdeCache, pendientes }) => {
    catalogo = mapa;
    porUPC = new Map();
    for (const p of mapa.values()) if (p.upc) porUPC.set(p.upc, p);
    const origen = desdeCache ? (pendientes ? 'datos locales, con cambios por enviar' : 'datos locales') : 'sincronizado';
    $('estado-catalogo').textContent = `${mapa.size} producto${mapa.size === 1 ? '' : 's'} · ${origen}`;
    clearTimeout(temporizadorListas);
    temporizadorListas = setTimeout(pintarListas, 400);
  },
  (error) => avisar(`No se pudo cargar el catálogo: ${mensajeError(error)}`, 'error', 0),
);

observarTiendas(
  (lista) => {
    tiendas = lista;
    const activas = lista.filter((t) => t.activo);
    const preferida = leerPreferencia(PREFERENCIAS.tienda);
    const seleccionada = selectTienda.value || preferida;
    selectTienda.replaceChildren(...activas.map((t) => new Option(t.nombre, t.id)));
    if (activas.length === 0) selectTienda.append(new Option('Sin tiendas registradas', ''));
    if (seleccionada && activas.some((t) => t.id === seleccionada)) selectTienda.value = seleccionada;
    guardarPreferencia(PREFERENCIAS.tienda, selectTienda.value);
  },
  (error) => avisar(`No se pudieron cargar las tiendas: ${mensajeError(error)}`, 'error', 0),
);

selectTienda.addEventListener('change', () => guardarPreferencia(PREFERENCIAS.tienda, selectTienda.value));
casillaOtras.checked = leerPreferencia(PREFERENCIAS.otras) === '1';
casillaOtras.addEventListener('change', () => guardarPreferencia(PREFERENCIAS.otras, casillaOtras.checked ? '1' : '0'));

function pintarListas() {
  const marcas = new Set();
  const presentaciones = new Set();
  for (const p of catalogo.values()) {
    if (p.marca) marcas.add(p.marca);
    if (p.presentacion) presentaciones.add(p.presentacion);
  }
  const opciones = (conjunto) => [...conjunto].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 1000).map((v) => new Option(v));
  $('marcas').replaceChildren(...opciones(marcas));
  $('presentaciones').replaceChildren(...opciones(presentaciones));
}

// ------------------------------------------------------------- formulario
function claseSeleccionada() {
  return radiosClase.find((r) => r.checked)?.value ?? null;
}

function seleccionarClase(valor) {
  for (const radio of radiosClase) radio.checked = radio.value === valor;
  guardarPreferencia(PREFERENCIAS.clase, valor);
}

function tiendasParaNuevo() {
  const actual = tiendaActual();
  if (casillaOtras.checked) return tiendas.filter((t) => t.activo).map((t) => t.id);
  return actual ? [actual] : [];
}

function limpiar({ conservarUPC = false } = {}) {
  if (!conservarUPC) campos.upc.value = '';
  campos.upc.readOnly = false;
  campos.nombre.value = '';
  campos.marca.value = '';
  campos.presentacion.value = '';
  campos.precio.value = '';
  seleccionarClase(leerPreferencia(PREFERENCIAS.clase) || 'gravado');
  existente = null;
  accionPendiente = null;
  modo = 'captura';
  corrigiendo = null;
  mostrarBanner('', '');
  actualizarVista();
  campos.upc.focus();
  campos.upc.select();
}

$('btn-limpiar').addEventListener('click', () => limpiar());

// UPC: Enter busca; si hay una acción pendiente (ya existe), Enter la ejecuta.
campos.upc.addEventListener('input', () => {
  existente = null;
  accionPendiente = null;
  mostrarBanner('', '');
});

campos.upc.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter') return;
  evento.preventDefault();
  if (accionPendiente) {
    ejecutarAccionPendiente();
    return;
  }
  alEnterUPC();
});

function alEnterUPC() {
  const texto = campos.upc.value.trim();
  existente = null;
  if (texto === '') {
    mostrarBanner('info', 'Producto sin código de barras. Escribe el nombre.');
    campos.nombre.focus();
    return;
  }
  let codigo;
  try {
    codigo = normalizarUPC(texto);
  } catch (error) {
    mostrarBanner('error', error.message);
    campos.upc.select();
    return;
  }
  campos.upc.value = codigo;
  const producto = porUPC.get(codigo);
  if (!producto) {
    mostrarBanner('ok', `UPC ${codigo}: nuevo. Escribe los datos.`);
    campos.nombre.focus();
    actualizarVista();
    return;
  }
  existente = producto;
  const tienda = tiendaActual();
  const resumen = `${nombreCompleto(producto)} · ${precioTexto(producto)}`;
  if (!producto.activo) {
    accionPendiente = 'reactivar';
    mostrarBanner('aviso', `${resumen} está INACTIVO. Enter: reactivar${tienda ? ` y agregar a ${nombreTienda(tienda)}` : ''} · Esc: omitir`);
  } else if (tienda && !producto.tiendas.includes(tienda)) {
    accionPendiente = 'agregar';
    mostrarBanner('aviso', `${resumen} ya está en el catálogo pero no en ${nombreTienda(tienda)}. Enter: agregar a esta tienda · Esc: omitir`);
  } else {
    accionPendiente = 'siguiente';
    mostrarBanner('ok', `Ya está: ${resumen}${tienda ? ` · en ${nombreTienda(tienda)}` : ''}. Enter: siguiente · F4: corregir`);
  }
  ultimo = { id: producto.id };
  btnCorregir.disabled = false;
  campos.upc.select();
}

function ejecutarAccionPendiente() {
  const producto = existente;
  const accion = accionPendiente;
  accionPendiente = null;
  if (!producto || accion === 'siguiente') {
    limpiar();
    return;
  }
  const tienda = tiendaActual();
  const cambios = {};
  if (tienda && !producto.tiendas.includes(tienda)) cambios.tiendas = [...producto.tiendas, tienda];
  if (accion === 'reactivar') cambios.activo = true;
  if (Object.keys(cambios).length === 0) {
    limpiar();
    return;
  }
  const { promesa } = actualizarProducto(producto, cambios, personal.usuario);
  const detalle = accion === 'reactivar' ? `Reactivado${cambios.tiendas ? ` y agregado a ${nombreTienda(tienda)}` : ''}` : `Agregado a ${nombreTienda(tienda)}`;
  registrar(promesa, detalle, { ...producto, ...cambios });
  ultimo = { id: producto.id };
  limpiar();
}

// Campos de texto: Enter pasa al siguiente (con un respiro para que la lista de sugerencias aplique su valor).
const SIGUIENTE = { nombre: 'marca', marca: 'presentacion', presentacion: 'precio' };
for (const [nombre, siguiente] of Object.entries(SIGUIENTE)) {
  campos[nombre].addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    setTimeout(() => campos[siguiente].focus(), 0);
  });
}

// Precio: con sufijo (+ / c) guarda directo; sin sufijo pasa a la clase fiscal.
campos.precio.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter') return;
  evento.preventDefault();
  let interpretado;
  try {
    interpretado = interpretarPrecio(campos.precio.value);
  } catch (error) {
    mostrarBanner('error', error.message);
    campos.precio.select();
    return;
  }
  if (interpretado.claseFiscal) {
    seleccionarClase(interpretado.claseFiscal);
    campos.precio.value = textoDesdeCentavos(interpretado.centavos);
    guardar();
    return;
  }
  (radiosClase.find((r) => r.checked) ?? radiosClase[0]).focus();
});

for (const radio of radiosClase) {
  radio.addEventListener('keydown', (evento) => {
    const tecla = evento.key.toLowerCase();
    if (tecla === 'g' || tecla === '+') {
      evento.preventDefault();
      seleccionarClase('gravado');
      radiosClase[0].focus();
    } else if (tecla === 'c') {
      evento.preventDefault();
      seleccionarClase('tasaCero');
      radiosClase[1].focus();
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      seleccionarClase(radio.value);
      guardar();
    }
  });
  radio.addEventListener('change', () => guardarPreferencia(PREFERENCIAS.clase, radio.value));
}

form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  guardar();
});

form.addEventListener('input', () => {
  clearTimeout(temporizadorVista);
  temporizadorVista = setTimeout(actualizarVista, 150);
});

// ------------------------------------------------------------- guardar
function leerFormulario() {
  const upcTexto = campos.upc.value.trim();
  const upc = upcTexto === '' ? null : normalizarUPC(upcTexto);
  const nombre = campos.nombre.value.trim();
  if (nombre === '') throw Object.assign(new Error('Falta el nombre.'), { campo: campos.nombre });
  let interpretado;
  try {
    interpretado = interpretarPrecio(campos.precio.value);
  } catch (error) {
    throw Object.assign(error, { campo: campos.precio });
  }
  if (interpretado.claseFiscal) seleccionarClase(interpretado.claseFiscal);
  const claseFiscal = claseSeleccionada();
  if (!claseFiscal) throw Object.assign(new Error('Elige la clase fiscal: G o C.'), { campo: radiosClase[0] });
  return {
    upc,
    plu: null,
    nombre,
    marca: campos.marca.value,
    descriptor: null,
    presentacion: campos.presentacion.value,
    precioCentavos: interpretado.centavos,
    unidadVenta: 'pieza',
    precioPorKgCentavos: null,
    claseFiscal,
    proveedor: null,
  };
}

function guardar() {
  let datos;
  try {
    datos = leerFormulario();
  } catch (error) {
    mostrarBanner('error', error.message);
    error.campo?.focus();
    if (typeof error.campo?.select === 'function') error.campo.select();
    return;
  }

  if (modo === 'corregir' && corrigiendo) {
    const base = catalogo.get(corrigiendo.id) ?? corrigiendo;
    const preparado = armarProducto({ ...datos, tiendas: base.tiendas, activo: base.activo, ultimoPrecioImpresoCentavos: base.ultimoPrecioImpresoCentavos, fechaUltimaImpresion: base.fechaUltimaImpresion, descriptor: base.descriptor, proveedor: base.proveedor, plu: base.plu, unidadVenta: base.unidadVenta, precioPorKgCentavos: base.precioPorKgCentavos }, personal.usuario);
    const errores = validarProducto({ ...preparado, creadoEn: {}, actualizadoEn: {} });
    if (errores.length > 0) {
      mostrarBanner('error', errores.join(' '));
      return;
    }
    const cambios = diferenciasProducto(base, preparado);
    if (Object.keys(cambios).length === 0) {
      mostrarBanner('info', 'Sin cambios.');
      limpiar();
      return;
    }
    const { promesa, cambioPrecio } = actualizarProducto(base, cambios, personal.usuario);
    registrar(promesa, cambioPrecio ? 'Corregido (precio con historial)' : 'Corregido', { ...base, ...preparado }, cambioPrecio);
    ultimo = { id: base.id };
    limpiar();
    return;
  }

  if (datos.upc && porUPC.has(datos.upc)) {
    existente = porUPC.get(datos.upc);
    mostrarBanner('error', `El UPC ${datos.upc} ya es de «${nombreCompleto(existente)}». Escanéalo de nuevo para agregarlo a la tienda o corregirlo.`);
    campos.upc.focus();
    campos.upc.select();
    return;
  }
  const preparado = armarProducto({ ...datos, tiendas: tiendasParaNuevo(), activo: true }, personal.usuario);
  const errores = validarProducto({ ...preparado, creadoEn: {}, actualizadoEn: {} });
  if (errores.length > 0) {
    mostrarBanner('error', errores.join(' '));
    return;
  }
  const { id, producto, promesa } = crearProducto(preparado, personal.usuario);
  const conId = { id, ...producto };
  catalogo.set(id, conId);
  if (producto.upc) porUPC.set(producto.upc, conId); // evita duplicar si se vuelve a escanear antes de que llegue la confirmación
  capturados += 1;
  contador.textContent = String(capturados);
  registrar(promesa, `Creado · ${producto.tiendas.map(nombreTienda).join(', ') || 'sin tienda'}`, conId);
  ultimo = { id };
  btnCorregir.disabled = false;
  limpiar();
}

/** Fila en la bitácora que se confirma o marca en rojo cuando responde el servidor. */
function registrar(promesa, detalle, producto, cambioPrecio = false) {
  const fila = crear('li');
  const estado = crear('span', 'estado estado--pendiente', '⋯');
  estado.title = 'Enviando…';
  const texto = crear('span');
  texto.append(crear('strong', '', nombreCompleto(producto)), ` · ${precioTexto(producto)}`, crear('br'), crear('span', 'detalle', `${horaCorta()} · ${detalle}`));
  fila.append(estado, texto);
  bitacora.prepend(fila);
  while (bitacora.childElementCount > 30) bitacora.lastElementChild.remove();
  promesa.then(
    () => {
      estado.textContent = '✓';
      estado.className = 'estado estado--ok';
      estado.title = 'Guardado en el servidor';
    },
    (error) => {
      estado.textContent = '!';
      estado.className = 'estado estado--error';
      estado.title = mensajeError(error);
      const motivo = error?.code === 'permission-denied' && cambioPrecio ? 'el precio cambió en otra estación' : mensajeError(error);
      avisar(`No se guardó «${nombreCompleto(producto)}»: ${motivo}`, 'error', 0);
    },
  );
}

// ------------------------------------------------------------- corregir el último (F4)
function corregirUltimo() {
  if (!ultimo) return;
  const producto = catalogo.get(ultimo.id);
  if (!producto) {
    avisar('Ese producto ya no está disponible para corregir.', 'error');
    return;
  }
  modo = 'corregir';
  corrigiendo = producto;
  existente = null;
  accionPendiente = null;
  campos.upc.value = producto.upc ?? '';
  campos.upc.readOnly = true;
  campos.nombre.value = producto.nombre;
  campos.marca.value = producto.marca ?? '';
  campos.presentacion.value = producto.presentacion ?? '';
  campos.precio.value = textoDesdeCentavos(producto.precioCentavos);
  seleccionarClase(producto.claseFiscal);
  mostrarBanner('info', `Corrigiendo «${nombreCompleto(producto)}». Enter en la clase fiscal guarda · Esc cancela. Un precio distinto queda en el historial.`);
  actualizarVista();
  campos.nombre.focus();
  campos.nombre.select();
}

btnCorregir.addEventListener('click', corregirUltimo);

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'F4') {
    evento.preventDefault();
    corregirUltimo();
  } else if (evento.key === 'Escape') {
    evento.preventDefault();
    limpiar();
  }
});

// ------------------------------------------------------------- vista previa
function actualizarVista() {
  let upc = null;
  const upcTexto = campos.upc.value.trim();
  if (upcTexto) {
    try {
      upc = normalizarUPC(upcTexto);
    } catch {
      upc = null;
    }
  }
  let precioCentavos = 0;
  let claseFiscal = claseSeleccionada() ?? 'gravado';
  try {
    const interpretado = interpretarPrecio(campos.precio.value);
    precioCentavos = interpretado.centavos;
    if (interpretado.claseFiscal) claseFiscal = interpretado.claseFiscal;
  } catch {
    precioCentavos = 0;
  }
  try {
    const etiqueta = renderEtiqueta(armarProducto({
      upc,
      nombre: campos.nombre.value.trim() || 'NOMBRE',
      marca: campos.marca.value,
      presentacion: campos.presentacion.value,
      precioCentavos,
      unidadVenta: 'pieza',
      claseFiscal,
    }, personal.usuario));
    vistaEtiqueta.replaceChildren(etiqueta);
    ajustarEtiqueta(etiqueta);
  } catch {
    vistaEtiqueta.replaceChildren();
  }
}

// ------------------------------------------------------------- arranque
seleccionarClase(leerPreferencia(PREFERENCIAS.clase) || 'gravado');
$('contenido').hidden = false;
actualizarVista();
campos.upc.focus();
