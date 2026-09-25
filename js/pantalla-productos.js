/**
 * Pantalla de productos: búsqueda por teclado o escáner, alta, edición y
 * desactivación. Todo alcanzable sin ratón.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import {
  observarCatalogo, observarTiendas, buscarPorUPC, observarProducto, observarHistorial,
  crearProducto, actualizarProducto, esperarConfirmacion,
} from './productos.js';
import { coincideBusqueda, diferenciasProducto, validarProducto, armarProducto, pareceUPC } from './esquema.js';
import { normalizarUPC } from './upca.js';
import { formatearPrecio, indicadorFiscal, centavosDesdeTexto, textoDesdeCentavos } from './precios.js';
import { renderEtiqueta, ajustarEtiqueta } from './etiquetas.js';
import { camaraDisponible, abrirEscaner, mensajeCamara, confirmarLectura } from './escaner.js';
import { cargarNombres, nombreDeUsuario } from './personal.js';

const MAXIMO_RESULTADOS = 100;

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'productos.html' });

const $ = (id) => document.getElementById(id);
const busqueda = $('busqueda');
const verInactivos = $('ver-inactivos');
const estadoCatalogo = $('estado-catalogo');
const cuerpoResultados = $('resultados');
const sinResultados = $('sin-resultados');
const recorte = $('recorte');
const avisoBusqueda = $('aviso-busqueda');
const oferta = $('oferta-crear');
const editor = $('editor');
const form = $('form-producto');
const avisoEditor = $('editor-aviso');
const btnGuardar = $('btn-guardar');
const btnDesactivar = $('btn-desactivar');
const campoKilo = $('campo-kilo');
const casillasTiendas = $('f-tiendas');
const vistaEtiqueta = $('vista-etiqueta');
const vistaAviso = $('vista-aviso');
const meta = $('meta');
const historial = $('historial');
const detalle = $('detalle');
const escaner = $('escaner');

/** Pantalla táctil o angosta: se abre la ficha de consulta en lugar del editor, y no se roba el foco al teclado. */
const esMovil = () => window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;

const VACIO = Object.freeze({
  upc: null, plu: null, nombre: '', marca: null, descriptor: null, presentacion: '',
  precioCentavos: null, unidadVenta: 'pieza', precioPorKgCentavos: null, claseFiscal: 'gravado',
  tiendas: null, proveedor: null, activo: true,
});

// ------------------------------------------------------------- estado
let catalogo = new Map();
let catalogoConfiable = false; // hay datos del servidor o una caché previa
let ordenados = null;
let tiendas = [];
let temporizadorBusqueda = null;
let temporizadorVista = null;
const estado = { modo: null, actual: null, inicial: '', guardando: false, dejarDeObservar: null, dejarDeObservarHistorial: null, tiendasSeleccion: null };

const formatoFecha = new Intl.DateTimeFormat('es-CA', { dateStyle: 'medium', timeStyle: 'short' });
const fecha = (marca) => (marca && typeof marca.toDate === 'function' ? formatoFecha.format(marca.toDate()) : '—');
const nombreCompleto = (p) => [p.marca, p.nombre].filter(Boolean).join(' ');
const precioConIndicador = (p) => `${formatearPrecio(p.precioCentavos)}${indicadorFiscal(p.claseFiscal)}`;

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function mostrarMensaje(elemento, texto) {
  elemento.textContent = texto;
  elemento.hidden = !texto;
}

// ------------------------------------------------------------- catálogo
observarCatalogo(
  ({ catalogo: mapa, desdeCache, pendientes }) => {
    catalogo = mapa;
    ordenados = null;
    catalogoConfiable = !desdeCache || mapa.size > 0;
    const n = mapa.size;
    const origen = desdeCache ? (pendientes ? 'datos locales, con cambios por enviar' : 'datos locales') : 'sincronizado';
    estadoCatalogo.textContent = `${n} producto${n === 1 ? '' : 's'} · ${origen}`;
    pintarResultados();
  },
  (error) => avisar(`No se pudo cargar el catálogo: ${mensajeError(error)}`, 'error', 0),
);

observarTiendas(
  (lista) => {
    tiendas = lista;
    pintarCasillasTiendas();
  },
  (error) => avisar(`No se pudieron cargar las tiendas: ${mensajeError(error)}`, 'error', 0),
);

document.getElementById('contenido').hidden = false;
if (!esMovil()) busqueda.focus();
cargarNombres().then(() => {
  if (estado.actual && editor.open) pintarMeta(estado.actual);
});

function listaOrdenada() {
  if (!ordenados) ordenados = [...catalogo.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return ordenados;
}

// ------------------------------------------------------------- búsqueda
function pintarResultados() {
  const termino = busqueda.value.trim();
  const incluirInactivos = verInactivos.checked;
  const lista = [];
  let total = 0;
  for (const producto of listaOrdenada()) {
    if (!incluirInactivos && !producto.activo) continue;
    if (termino && !coincideBusqueda(producto, termino)) continue;
    total += 1;
    if (lista.length < MAXIMO_RESULTADOS) lista.push(producto);
  }
  cuerpoResultados.replaceChildren(...lista.map(fila));
  if (lista.length === 0 && catalogo.size === 0) {
    mostrarMensaje(sinResultados, 'El catálogo está vacío. Escanea un producto o pulsa Alt+N para crear el primero.');
  } else {
    mostrarMensaje(sinResultados, lista.length === 0 ? `Sin resultados para «${termino}».` : '');
  }
  mostrarMensaje(recorte, total > MAXIMO_RESULTADOS ? `Se muestran ${MAXIMO_RESULTADOS} de ${total}. Afina la búsqueda.` : '');
}

function fila(producto) {
  const tr = document.createElement('tr');
  tr.tabIndex = 0;
  tr.dataset.id = producto.id;
  if (!producto.activo) tr.className = 'inactivo';

  const nombre = crear('td');
  nombre.append(crear('strong', '', producto.nombre));
  const secundario = [producto.marca, producto.presentacion].filter(Boolean).join(' · ');
  if (secundario) nombre.append(crear('span', 'secundario', secundario));

  const codigo = producto.upc ?? (producto.plu ? `PLU ${producto.plu}` : '—');
  const precio = producto.unidadVenta === 'peso' && producto.precioPorKgCentavos
    ? `${formatearPrecio(producto.precioPorKgCentavos)}/kg`
    : precioConIndicador(producto);
  tr.append(nombre, crear('td', '', codigo), crear('td', '', precio), crear('td', '', producto.tiendas.join(', ') || '—'), crear('td', '', producto.activo ? 'Activo' : 'Inactivo'));
  tr.addEventListener('click', () => abrirSegunDispositivo(producto.id));
  tr.addEventListener('keydown', teclasFila);
  return tr;
}

function teclasFila(evento) {
  const tr = evento.currentTarget;
  const filas = [...cuerpoResultados.querySelectorAll('tr')];
  const indice = filas.indexOf(tr);
  const ir = (destino) => { evento.preventDefault(); destino?.focus(); };
  switch (evento.key) {
    case 'ArrowDown': ir(filas[indice + 1]); break;
    case 'ArrowUp': indice === 0 ? ir(busqueda) : ir(filas[indice - 1]); break;
    case 'Home': ir(filas[0]); break;
    case 'End': ir(filas[filas.length - 1]); break;
    case 'Enter':
    case ' ': evento.preventDefault(); abrirSegunDispositivo(tr.dataset.id); break;
    case 'Escape': ir(busqueda); break;
    default:
  }
}

busqueda.addEventListener('input', () => {
  ocultarOferta();
  mostrarMensaje(avisoBusqueda, '');
  clearTimeout(temporizadorBusqueda);
  temporizadorBusqueda = setTimeout(pintarResultados, 120);
});

busqueda.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') {
    evento.preventDefault();
    alEnterEnBusqueda();
  } else if (evento.key === 'ArrowDown') {
    const primera = cuerpoResultados.querySelector('tr');
    if (primera) {
      evento.preventDefault();
      primera.focus();
    }
  } else if (evento.key === 'Escape') {
    busqueda.value = '';
    ocultarOferta();
    pintarResultados();
  }
});

verInactivos.addEventListener('change', pintarResultados);

async function alEnterEnBusqueda() {
  clearTimeout(temporizadorBusqueda);
  pintarResultados(); // resultados al día aunque el repintado diferido no haya corrido
  const texto = busqueda.value.trim();
  if (pareceUPC(texto)) {
    await procesarCodigo(texto);
    return;
  }
  const filas = cuerpoResultados.querySelectorAll('tr');
  if (filas.length === 1) abrirSegunDispositivo(filas[0].dataset.id);
  else if (filas.length > 1) filas[0].focus();
}

/** Lo que teclea el escáner: abre el producto o propone crearlo. */
async function procesarCodigo(texto) {
  let codigo;
  try {
    codigo = normalizarUPC(texto);
  } catch (error) {
    mostrarMensaje(avisoBusqueda, error.message);
    busqueda.select();
    return;
  }
  let encontrado = [...catalogo.values()].find((p) => p.upc === codigo) ?? null;
  if (!encontrado && !catalogoConfiable) {
    try {
      encontrado = (await buscarPorUPC(codigo))[0] ?? null;
    } catch (error) {
      mostrarMensaje(avisoBusqueda, `No se pudo comprobar el UPC: ${mensajeError(error)}`);
      return;
    }
  }
  if (encontrado) {
    abrirSegunDispositivo(encontrado.id);
    return;
  }
  ofrecerCrear(codigo);
}

/** En estaciones abre el editor directamente; en teléfonos, la ficha de consulta. */
function abrirSegunDispositivo(id) {
  if (esMovil()) abrirDetalle(id);
  else abrirProducto(id);
}

function ofrecerCrear(codigo) {
  $('oferta-upc').textContent = codigo;
  oferta.hidden = false;
  oferta.dataset.upc = codigo;
  $('oferta-crear-btn').focus();
}

function ocultarOferta() {
  oferta.hidden = true;
  delete oferta.dataset.upc;
}

$('oferta-crear-btn').addEventListener('click', () => {
  const upc = oferta.dataset.upc;
  ocultarOferta();
  abrirNuevo({ upc });
});
$('oferta-cancelar-btn').addEventListener('click', () => {
  ocultarOferta();
  busqueda.focus();
  busqueda.select();
});
oferta.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') {
    evento.preventDefault();
    ocultarOferta();
    busqueda.focus();
    busqueda.select();
  }
});

$('btn-nuevo').addEventListener('click', () => abrirNuevo());

document.addEventListener('keydown', (evento) => {
  if (evento.altKey && !evento.ctrlKey && !evento.metaKey && evento.key.toLowerCase() === 'n') {
    evento.preventDefault();
    if (!editor.open) abrirNuevo();
  } else if (evento.key === '/' && !editor.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    evento.preventDefault();
    busqueda.focus();
    busqueda.select();
  }
});

// ------------------------------------------------------------- editor
function pintarCasillasTiendas() {
  const existentes = casillasTiendas.querySelectorAll('input');
  // Si ya había casillas, se respeta lo que marcó el personal; si no, la
  // selección pendiente (la del producto abierto, o las tiendas activas).
  const marcadas = existentes.length > 0
    ? new Set([...existentes].filter((c) => c.checked).map((c) => c.value))
    : new Set(estado.tiendasSeleccion ?? tiendas.filter((t) => t.activo).map((t) => t.id));
  casillasTiendas.replaceChildren();
  if (tiendas.length === 0) {
    casillasTiendas.append(crear('span', 'nota', 'Sin tiendas registradas (Administración → Tiendas).'));
    return;
  }
  for (const tienda of tiendas) {
    const etiqueta = crear('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.value = tienda.id;
    casilla.checked = marcadas.has(tienda.id);
    etiqueta.append(casilla, ` ${tienda.nombre}${tienda.activo ? '' : ' (inactiva)'}`);
    casillasTiendas.append(etiqueta);
  }
}

function marcarTiendas(ids) {
  estado.tiendasSeleccion = ids;
  const objetivo = ids ?? tiendas.filter((t) => t.activo).map((t) => t.id);
  for (const casilla of casillasTiendas.querySelectorAll('input')) casilla.checked = objetivo.includes(casilla.value);
}

function llenarFormulario(p) {
  $('f-upc').value = p.upc ?? '';
  $('f-plu').value = p.plu ?? '';
  $('f-marca').value = p.marca ?? '';
  $('f-nombre').value = p.nombre ?? '';
  $('f-descriptor').value = p.descriptor ?? '';
  $('f-presentacion').value = p.presentacion ?? '';
  form.unidad.value = p.unidadVenta ?? 'pieza';
  $('f-precio').value = p.precioCentavos == null ? '' : textoDesdeCentavos(p.precioCentavos);
  $('f-precio-kg').value = p.precioPorKgCentavos == null ? '' : textoDesdeCentavos(p.precioPorKgCentavos);
  form.fiscal.value = p.claseFiscal ?? 'gravado';
  $('f-proveedor').value = p.proveedor ?? '';
  // Producto nuevo (tiendas null): todas las tiendas activas marcadas por defecto.
  marcarTiendas(p.tiendas ?? null);
  actualizarUnidad();
}

class ErrorCampo extends Error {
  constructor(mensaje, campo) {
    super(mensaje);
    this.campo = campo;
  }
}

/** Lee el formulario ya normalizado; lanza ErrorCampo con el campo a corregir. */
function leerFormulario() {
  const upcTexto = $('f-upc').value.trim();
  let upc = null;
  if (upcTexto !== '') {
    try {
      upc = normalizarUPC(upcTexto);
    } catch (error) {
      throw new ErrorCampo(error.message, $('f-upc'));
    }
  }
  const pluTexto = $('f-plu').value.trim();
  if (pluTexto !== '' && !/^\d{4,5}$/.test(pluTexto)) throw new ErrorCampo('El PLU debe tener 4 o 5 dígitos.', $('f-plu'));
  const nombre = $('f-nombre').value.trim();
  if (nombre === '') throw new ErrorCampo('El nombre es obligatorio: es la barra negra de la etiqueta.', $('f-nombre'));
  const unidadVenta = form.unidad.value;
  let precioCentavos;
  try {
    precioCentavos = centavosDesdeTexto($('f-precio').value);
  } catch (error) {
    throw new ErrorCampo(error.message, $('f-precio'));
  }
  let precioPorKgCentavos = null;
  if (unidadVenta === 'peso') {
    try {
      precioPorKgCentavos = centavosDesdeTexto($('f-precio-kg').value);
    } catch (error) {
      throw new ErrorCampo(`Precio por kilo: ${error.message}`, $('f-precio-kg'));
    }
  }
  return {
    upc,
    plu: pluTexto || null,
    nombre,
    marca: $('f-marca').value,
    descriptor: $('f-descriptor').value,
    presentacion: $('f-presentacion').value,
    precioCentavos,
    unidadVenta,
    precioPorKgCentavos,
    claseFiscal: form.fiscal.value,
    tiendas: [...casillasTiendas.querySelectorAll('input:checked')].map((c) => c.value),
    proveedor: $('f-proveedor').value,
  };
}

const huellaFormulario = () => JSON.stringify([...new FormData(form).entries()].concat([[...form.querySelectorAll('input')].map((i) => (i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value))]));
const sucio = () => huellaFormulario() !== estado.inicial;

function actualizarUnidad() {
  const peso = form.unidad.value === 'peso';
  campoKilo.hidden = !peso;
  $('f-precio-kg').required = peso;
}
for (const radio of form.querySelectorAll('input[name="unidad"]')) radio.addEventListener('change', actualizarUnidad);

function enfocar(elemento) {
  setTimeout(() => {
    elemento.focus();
    if (typeof elemento.select === 'function') elemento.select();
  }, 0);
}

function mostrarAvisoEditor(texto, tipo = 'error') {
  avisoEditor.textContent = texto;
  avisoEditor.className = `mensaje editor__aviso mensaje--${tipo}`;
  avisoEditor.hidden = !texto;
}

function dejarDeObservarProducto() {
  estado.dejarDeObservar?.();
  estado.dejarDeObservarHistorial?.();
  estado.dejarDeObservar = null;
  estado.dejarDeObservarHistorial = null;
}

function abrirNuevo(prefijado = {}) {
  dejarDeObservarProducto();
  estado.modo = 'crear';
  estado.actual = null;
  $('editor-titulo').textContent = prefijado.upc ? `Nuevo producto · UPC ${prefijado.upc}` : 'Nuevo producto';
  btnDesactivar.hidden = true;
  meta.replaceChildren();
  historial.replaceChildren(crear('li', 'nota', 'Sin cambios de precio.'));
  llenarFormulario({ ...VACIO, ...prefijado });
  mostrarEditor();
  enfocar(prefijado.upc ? $('f-marca') : $('f-upc'));
}

function abrirProducto(id) {
  const producto = catalogo.get(id);
  if (!producto) return;
  dejarDeObservarProducto();
  estado.modo = 'editar';
  estado.actual = producto;
  $('editor-titulo').textContent = nombreCompleto(producto);
  btnDesactivar.hidden = false;
  btnDesactivar.textContent = producto.activo ? 'Desactivar producto' : 'Reactivar producto';
  llenarFormulario(producto);
  pintarMeta(producto);
  historial.replaceChildren(crear('li', 'nota', 'Cargando…'));
  estado.dejarDeObservarHistorial = observarHistorial(
    id,
    (entradas) => {
      historial.replaceChildren(
        ...(entradas.length === 0
          ? [crear('li', 'nota', 'Sin cambios de precio.')]
          : entradas.slice(0, 10).map((e) => crear('li', '', `${fecha(e.fecha)} · ${formatearPrecio(e.precioAnteriorCentavos)} → ${formatearPrecio(e.precioNuevoCentavos)} · ${nombreDeUsuario(e.usuario)}`))),
      );
    },
    (error) => historial.replaceChildren(crear('li', 'nota', `No se pudo cargar el historial: ${mensajeError(error)}`)),
  );
  estado.dejarDeObservar = observarProducto(id, (remoto, metadatos) => {
    if (!remoto || metadatos.hasPendingWrites || estado.guardando || !estado.actual) return;
    if (remoto.actualizadoEn?.toMillis?.() !== estado.actual.actualizadoEn?.toMillis?.()) {
      mostrarAvisoEditor(`${nombreDeUsuario(remoto.actualizadoPor)} acaba de cambiar este producto en otra estación. Ciérralo y ábrelo de nuevo antes de guardar.`, 'error');
    }
  });
  mostrarEditor();
  enfocar($('f-nombre'));
}

function mostrarEditor() {
  mostrarAvisoEditor('');
  if (!editor.open) editor.showModal();
  estado.inicial = huellaFormulario();
  actualizarVista();
}

function cerrarEditor() {
  dejarDeObservarProducto();
  if (editor.open) editor.close();
}

editor.addEventListener('close', () => {
  dejarDeObservarProducto();
  if (esMovil()) return;
  busqueda.focus();
  busqueda.select();
});

editor.addEventListener('cancel', (evento) => {
  if (sucio() && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) evento.preventDefault();
});

$('btn-cerrar').addEventListener('click', () => {
  if (sucio() && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
  cerrarEditor();
});

// El escáner también puede escribir dentro del editor: Enter en el UPC no guarda, pasa al siguiente campo.
$('f-upc').addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter') return;
  evento.preventDefault();
  const campo = evento.currentTarget;
  if (campo.value.trim() !== '') {
    try {
      campo.value = normalizarUPC(campo.value);
      mostrarAvisoEditor('');
    } catch (error) {
      mostrarAvisoEditor(error.message);
      campo.select();
      return;
    }
  }
  $('f-marca').focus();
});

form.addEventListener('input', () => {
  clearTimeout(temporizadorVista);
  temporizadorVista = setTimeout(actualizarVista, 150);
});

function pintarMeta(p) {
  meta.replaceChildren();
  meta.append(crear('div', '', `Creado: ${fecha(p.creadoEn)}`));
  meta.append(crear('div', '', `Actualizado: ${fecha(p.actualizadoEn)} por ${nombreDeUsuario(p.actualizadoPor)}`));
  if (p.ultimoPrecioImpresoCentavos == null) {
    meta.append(crear('div', '', 'Etiqueta: nunca impresa.'));
  } else {
    const pendiente = p.ultimoPrecioImpresoCentavos !== p.precioCentavos ? ' · pendiente de reimprimir' : '';
    meta.append(crear('div', '', `Etiqueta: impresa el ${p.fechaUltimaImpresion} con ${formatearPrecio(p.ultimoPrecioImpresoCentavos)}${pendiente}.`));
  }
}

/** Vista previa de la etiqueta con lo capturado hasta ahora (tolerante a campos incompletos). */
function actualizarVista() {
  let upc = null;
  let notaUPC = '';
  const upcTexto = $('f-upc').value.trim();
  if (upcTexto) {
    try {
      upc = normalizarUPC(upcTexto);
    } catch (error) {
      notaUPC = `Sin código de barras en la vista: ${error.message}`;
    }
  }
  let precioCentavos = 0;
  try {
    precioCentavos = centavosDesdeTexto($('f-precio').value);
  } catch {
    precioCentavos = 0;
  }
  const datos = {
    upc,
    nombre: $('f-nombre').value.trim() || 'NOMBRE',
    marca: $('f-marca').value,
    descriptor: $('f-descriptor').value,
    presentacion: $('f-presentacion').value,
    precioCentavos,
    unidadVenta: form.unidad.value,
    precioPorKgCentavos: 1,
    claseFiscal: form.fiscal.value,
  };
  try {
    const etiqueta = renderEtiqueta(armarProducto(datos, personal.usuario));
    vistaEtiqueta.replaceChildren(etiqueta);
    ajustarEtiqueta(etiqueta);
    mostrarMensaje(vistaAviso, notaUPC);
  } catch (error) {
    vistaEtiqueta.replaceChildren();
    mostrarMensaje(vistaAviso, `Vista previa no disponible: ${error.message}`);
  }
}

// ------------------------------------------------------------- guardar
async function upcDuplicado(upc) {
  if (!upc) return null;
  const idActual = estado.actual?.id ?? null;
  const enMemoria = [...catalogo.values()].find((p) => p.upc === upc && p.id !== idActual);
  if (enMemoria) return enMemoria;
  if (catalogoConfiable) return null;
  try {
    return (await buscarPorUPC(upc)).find((p) => p.id !== idActual) ?? null;
  } catch {
    return null;
  }
}

function vigilarRechazo(promesa, nombre, cambioPrecio = false) {
  promesa.catch((error) => {
    const detalle = error?.code === 'permission-denied' && cambioPrecio
      ? 'el precio cambió en otra estación; ábrelo de nuevo y revisa'
      : mensajeError(error);
    avisar(`No se guardó «${nombre}»: ${detalle}`, 'error', 0);
  });
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await guardar();
});

async function guardar() {
  if (estado.guardando) return;
  let datos;
  try {
    datos = leerFormulario();
  } catch (error) {
    mostrarAvisoEditor(error.message);
    error.campo?.focus();
    return;
  }
  const preparado = armarProducto(
    {
      ...datos,
      activo: estado.actual?.activo ?? true,
      ultimoPrecioImpresoCentavos: estado.actual?.ultimoPrecioImpresoCentavos ?? null,
      fechaUltimaImpresion: estado.actual?.fechaUltimaImpresion ?? null,
    },
    personal.usuario,
  );
  const errores = validarProducto({ ...preparado, creadoEn: {}, actualizadoEn: {} });
  if (errores.length > 0) {
    mostrarAvisoEditor(errores.join(' '));
    return;
  }
  const duplicado = await upcDuplicado(preparado.upc);
  if (duplicado) {
    mostrarAvisoEditor(
      `El UPC ${preparado.upc} ya pertenece a «${nombreCompleto(duplicado)}»${duplicado.activo ? '' : ' (inactivo: reactívalo en lugar de crear otro)'}.`,
    );
    $('f-upc').focus();
    return;
  }

  estado.guardando = true;
  btnGuardar.disabled = true;
  try {
    if (estado.modo === 'crear') {
      const { producto, promesa } = crearProducto(preparado, personal.usuario);
      promesa.catch(() => {});
      const resultado = await esperarConfirmacion(promesa);
      if (resultado === 'pendiente') vigilarRechazo(promesa, producto.nombre);
      avisar(
        resultado === 'confirmado' ? `«${nombreCompleto(producto)}» creado.` : `«${nombreCompleto(producto)}» guardado en este equipo; se enviará al recuperar la señal.`,
        resultado === 'confirmado' ? 'ok' : 'info',
      );
    } else {
      const cambios = diferenciasProducto(estado.actual, preparado);
      if (Object.keys(cambios).length === 0) {
        avisar('Sin cambios.', 'info', 2500);
        estado.inicial = huellaFormulario();
        cerrarEditor();
        return;
      }
      const { promesa, cambioPrecio } = actualizarProducto(estado.actual, cambios, personal.usuario);
      promesa.catch(() => {});
      const resultado = await esperarConfirmacion(promesa);
      if (resultado === 'pendiente') vigilarRechazo(promesa, estado.actual.nombre, cambioPrecio);
      avisar(
        resultado === 'confirmado' ? `«${nombreCompleto(preparado)}» guardado.` : `«${nombreCompleto(preparado)}» guardado en este equipo; se enviará al recuperar la señal.`,
        resultado === 'confirmado' ? 'ok' : 'info',
      );
    }
    estado.inicial = huellaFormulario();
    cerrarEditor();
  } catch (error) {
    mostrarAvisoEditor(
      error?.code === 'permission-denied' && estado.modo === 'editar'
        ? 'El servidor rechazó el cambio. Si cambiaste el precio, puede que otra estación lo haya cambiado antes: cierra y vuelve a abrir el producto.'
        : mensajeError(error),
    );
  } finally {
    estado.guardando = false;
    btnGuardar.disabled = false;
  }
}

btnDesactivar.addEventListener('click', async () => {
  const producto = estado.actual;
  if (!producto || estado.guardando) return;
  const activar = !producto.activo;
  if (!activar && !window.confirm(`¿Desactivar «${nombreCompleto(producto)}»? Dejará de salir en búsquedas e impresiones; se puede reactivar.`)) return;
  estado.guardando = true;
  btnDesactivar.disabled = true;
  try {
    const { promesa } = actualizarProducto(producto, { activo: activar }, personal.usuario);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa);
    if (resultado === 'pendiente') vigilarRechazo(promesa, producto.nombre);
    avisar(`«${nombreCompleto(producto)}» ${activar ? 'reactivado' : 'desactivado'}${resultado === 'pendiente' ? ' (se enviará al recuperar la señal)' : ''}.`, activar ? 'ok' : 'info');
    estado.inicial = huellaFormulario();
    cerrarEditor();
  } catch (error) {
    mostrarAvisoEditor(mensajeError(error));
  } finally {
    estado.guardando = false;
    btnDesactivar.disabled = false;
  }
});

// ------------------------------------------------------------- ficha de consulta (teléfonos y escáner)
const estadoDetalle = { id: null, dejarDeObservar: null, dejarDeObservarHistorial: null, desdeEscaner: false };

function filaFicha(lista, termino, valor) {
  const dt = crear('dt', '', termino);
  const dd = crear('dd', '', valor);
  lista.append(dt, dd);
}

function pintarDetalle(p) {
  $('detalle-titulo').textContent = p.nombre;
  $('detalle-sub').textContent = [p.marca, p.presentacion, p.descriptor].filter(Boolean).join(' · ') || ' ';
  const porPeso = p.unidadVenta === 'peso' && p.precioPorKgCentavos;
  $('detalle-precio').textContent = porPeso ? `${formatearPrecio(p.precioPorKgCentavos)}/kg` : formatearPrecio(p.precioCentavos);
  $('detalle-fiscal').textContent = indicadorFiscal(p.claseFiscal);
  $('detalle-kilo').hidden = !porPeso;
  if (porPeso) $('detalle-kilo').textContent = `Precio de referencia en etiqueta: ${formatearPrecio(p.precioCentavos)}`;
  $('detalle-inactivo').hidden = p.activo;
  const pendiente = p.activo && p.ultimoPrecioImpresoCentavos !== p.precioCentavos;
  $('detalle-pendiente').hidden = !pendiente;
  if (pendiente) {
    $('detalle-pendiente').textContent = p.ultimoPrecioImpresoCentavos == null
      ? 'Etiqueta pendiente: nunca se ha impreso.'
      : `Etiqueta pendiente: la última se imprimió con ${formatearPrecio(p.ultimoPrecioImpresoCentavos)} el ${p.fechaUltimaImpresion}.`;
  }
  const contenedor = $('detalle-etiqueta');
  contenedor.replaceChildren();
  try {
    const etiqueta = renderEtiqueta(p);
    contenedor.append(etiqueta);
    if (detalle.open) ajustarEtiqueta(etiqueta);
  } catch {
    contenedor.append(crear('span', 'nota', 'Sin vista de etiqueta.'));
  }
  const datos = $('detalle-datos');
  datos.replaceChildren();
  filaFicha(datos, 'UPC', p.upc ?? 'Sin UPC');
  if (p.plu) filaFicha(datos, 'PLU', p.plu);
  filaFicha(datos, 'Clase fiscal', p.claseFiscal === 'gravado' ? 'Gravado (+Tx)' : 'Tasa cero');
  filaFicha(datos, 'Unidad', p.unidadVenta === 'peso' ? 'Por peso' : 'Por pieza');
  filaFicha(datos, 'Tiendas', p.tiendas.map((id) => tiendas.find((t) => t.id === id)?.nombre ?? id).join(', ') || 'Ninguna');
  if (p.proveedor) filaFicha(datos, 'Proveedor', p.proveedor);
  filaFicha(datos, 'Última etiqueta', p.ultimoPrecioImpresoCentavos == null ? 'Nunca impresa' : `${formatearPrecio(p.ultimoPrecioImpresoCentavos)} · ${p.fechaUltimaImpresion}`);
  filaFicha(datos, 'Actualizado', `${fecha(p.actualizadoEn)} · ${nombreDeUsuario(p.actualizadoPor)}`);
}

function dejarDeObservarDetalle() {
  estadoDetalle.dejarDeObservar?.();
  estadoDetalle.dejarDeObservarHistorial?.();
  estadoDetalle.dejarDeObservar = null;
  estadoDetalle.dejarDeObservarHistorial = null;
}

function abrirDetalle(id, { desdeEscaner = false } = {}) {
  const producto = catalogo.get(id);
  if (!producto) return;
  dejarDeObservarDetalle();
  estadoDetalle.id = id;
  estadoDetalle.desdeEscaner = desdeEscaner;
  $('detalle-escanear').hidden = !desdeEscaner;
  pintarDetalle(producto);
  const lista = $('detalle-historial');
  lista.replaceChildren(crear('li', 'nota', 'Cargando…'));
  estadoDetalle.dejarDeObservarHistorial = observarHistorial(
    id,
    (entradas) => {
      lista.replaceChildren(
        ...(entradas.length === 0
          ? [crear('li', 'nota', 'Sin cambios de precio.')]
          : entradas.slice(0, 8).map((e) => crear('li', '', `${fecha(e.fecha)} · ${formatearPrecio(e.precioAnteriorCentavos)} → ${formatearPrecio(e.precioNuevoCentavos)} · ${nombreDeUsuario(e.usuario)}`))),
      );
    },
    (error) => lista.replaceChildren(crear('li', 'nota', `No se pudo cargar el historial: ${mensajeError(error)}`)),
  );
  // La ficha se refresca sola si otra estación cambia el producto.
  estadoDetalle.dejarDeObservar = observarProducto(id, (remoto) => {
    if (remoto && estadoDetalle.id === id) pintarDetalle({ id, ...remoto });
  });
  if (!detalle.open) detalle.showModal();
  const etiqueta = $('detalle-etiqueta').querySelector('.etiqueta');
  if (etiqueta) ajustarEtiqueta(etiqueta);
  $('detalle-cuerpo')?.scrollTo?.(0, 0);
  setTimeout(() => $('detalle-editar').focus(), 0);
}

function cerrarDetalle() {
  if (detalle.open) detalle.close();
}

detalle.addEventListener('close', () => {
  dejarDeObservarDetalle();
  estadoDetalle.id = null;
});
$('detalle-cerrar').addEventListener('click', cerrarDetalle);
$('detalle-editar').addEventListener('click', () => {
  const id = estadoDetalle.id;
  cerrarDetalle();
  if (id) abrirProducto(id);
});
$('detalle-escanear').addEventListener('click', () => {
  cerrarDetalle();
  abrirEscanerUI();
});

// ------------------------------------------------------------- escáner con cámara
const estadoEscaner = { controles: null, abriendo: false, linterna: false };
const btnEscanear = $('btn-escanear');
const video = $('escaner-video');
const escanerEstado = $('escaner-estado');
const escanerOferta = $('escaner-oferta');

if (camaraDisponible()) btnEscanear.hidden = false;

function estadoDelEscaner(texto, tipo = '') {
  escanerEstado.textContent = texto;
  escanerEstado.className = `escaner__estado${tipo ? ` escaner__estado--${tipo}` : ''}`;
}

async function abrirEscanerUI() {
  if (estadoEscaner.abriendo) return;
  estadoEscaner.abriendo = true;
  escanerOferta.hidden = true;
  $('escaner-linterna').hidden = true;
  estadoDelEscaner('Iniciando cámara…');
  if (!escaner.open) escaner.showModal();
  try {
    estadoEscaner.controles = await abrirEscaner(video, {
      alDetectar: alLeerCodigo,
      alError: (error) => estadoDelEscaner(mensajeCamara(error), 'error'),
    });
    estadoDelEscaner('Apunta al código de barras');
    $('escaner-linterna').hidden = !estadoEscaner.controles.tieneLinterna;
  } catch (error) {
    estadoDelEscaner(mensajeCamara(error), 'error');
  } finally {
    estadoEscaner.abriendo = false;
  }
}

function cerrarEscaner() {
  if (escaner.open) escaner.close();
}

escaner.addEventListener('close', () => {
  estadoEscaner.controles?.detener();
  estadoEscaner.controles = null;
  estadoEscaner.linterna = false;
  $('escaner-linterna').setAttribute('aria-pressed', 'false');
});

async function alLeerCodigo({ texto }) {
  const controles = estadoEscaner.controles;
  controles?.pausar();
  confirmarLectura();
  let codigo;
  try {
    codigo = normalizarUPC(texto);
  } catch (error) {
    estadoDelEscaner(`${texto}: ${error.message}`, 'error');
    setTimeout(() => {
      if (escaner.open && escanerOferta.hidden) {
        estadoDelEscaner('Apunta al código de barras');
        controles?.reanudar();
      }
    }, 2200);
    return;
  }
  let encontrado = [...catalogo.values()].find((p) => p.upc === codigo) ?? null;
  if (!encontrado && !catalogoConfiable) {
    try {
      encontrado = (await buscarPorUPC(codigo))[0] ?? null;
    } catch {
      encontrado = null;
    }
  }
  if (encontrado) {
    cerrarEscaner();
    abrirDetalle(encontrado.id, { desdeEscaner: true });
    return;
  }
  estadoDelEscaner(`UPC ${codigo}`);
  $('escaner-oferta-texto').textContent = `No hay ningún producto con el UPC ${codigo}.`;
  escanerOferta.hidden = false;
  escanerOferta.dataset.upc = codigo;
  $('escaner-crear').focus();
}

btnEscanear.addEventListener('click', abrirEscanerUI);
$('escaner-cerrar').addEventListener('click', cerrarEscaner);
$('escaner-teclear').addEventListener('click', () => {
  cerrarEscaner();
  busqueda.focus();
});
$('escaner-seguir').addEventListener('click', () => {
  escanerOferta.hidden = true;
  delete escanerOferta.dataset.upc;
  estadoDelEscaner('Apunta al código de barras');
  estadoEscaner.controles?.reanudar();
});
$('escaner-crear').addEventListener('click', () => {
  const upc = escanerOferta.dataset.upc;
  cerrarEscaner();
  abrirNuevo({ upc });
});
$('escaner-linterna').addEventListener('click', async () => {
  const controles = estadoEscaner.controles;
  if (!controles) return;
  const encender = !estadoEscaner.linterna;
  if (await controles.linterna(encender)) {
    estadoEscaner.linterna = encender;
    $('escaner-linterna').setAttribute('aria-pressed', String(encender));
  }
});
