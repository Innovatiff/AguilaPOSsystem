/**
 * Pantalla de productos: búsqueda por teclado o escáner, alta, edición y
 * desactivación. Todo alcanzable sin ratón.
 *
 * La usan el back office (administradores) y la app Catálogo. En el Catálogo,
 * quien no es administrador nunca pone ni cambia precios, unidad de venta ni
 * clase fiscal, y no da de baja: un producto nuevo se envía como solicitud de
 * alta (sin precio) y quitar uno se pide al administrador (js/solicitudes.js).
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { t, tc, locale } from './idioma.js';
import {
  observarCatalogo, observarTiendas, buscarPorUPC, observarProducto, observarHistorial,
  crearProducto, actualizarProducto, esperarConfirmacion,
} from './productos.js';
import { coincideBusqueda, diferenciasProducto, validarProducto, armarProducto, pareceUPC } from './esquema.js';
import { normalizarUPC, tipoDeCodigo } from './upca.js';
import { formatearPrecio, indicadorFiscal, centavosDesdeTexto, textoDesdeCentavos } from './precios.js';
import { renderEtiqueta, ajustarEtiqueta } from './etiquetas.js';
import { camaraDisponible, abrirEscaner, mensajeCamara, confirmarLectura } from './escaner.js';
import { cargarNombres, nombreDeUsuario } from './personal.js';
import { paginar, ventanaDePaginas, tamanoDePagina } from './paginacion.js';
import { pedirAlta, pedirBaja, observarSolicitudes } from './solicitudes.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'productos.html' });
const esAdmin = personal.rol === 'admin';

const $ = (id) => document.getElementById(id);
const busqueda = $('busqueda');
const verInactivos = $('ver-inactivos');
const estadoCatalogo = $('estado-catalogo');
const cuerpoResultados = $('resultados');
const sinResultados = $('sin-resultados');
const tabla = document.querySelector('.tabla--resultados');
const paginacion = $('paginacion');
const resumenPaginacion = $('paginacion-resumen');
const botonesPaginacion = $('paginacion-botones');
const numerosPaginacion = $('pag-numeros');
const btnAnterior = $('pag-anterior');
const btnSiguiente = $('pag-siguiente');
const selectorTamano = $('por-pagina');
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

// Personal del Catálogo (no admin): pide altas y bajas en lugar de hacerlas.
const pideAlAdmin = !esAdmin;
const altasPendientes = new Map(); // upc → solicitud de alta pendiente
if (pideAlAdmin) {
  $('btn-nuevo').firstChild.textContent = t('Pedir alta de producto') + ' ';
  $('oferta-crear-btn').firstChild.textContent = t('Pedir alta con este UPC') + ' ';
  $('escaner-crear').textContent = t('Pedir alta con este UPC');
  observarSolicitudes('pendiente', (lista) => {
    altasPendientes.clear();
    for (const s of lista) if (s.tipo === 'alta' && s.producto?.upc) altasPendientes.set(s.producto.upc, s);
  }, () => {});
}
const textoAltaPendiente = (upc, s) => t('Ya se pidió el alta del UPC {upc} ({nombre}): falta que un administrador le ponga precio.', { upc, nombre: s.creadaPorNombre });

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
const leerPreferencia = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardarPreferencia = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ } };
let pagina = 1;
let porPagina = tamanoDePagina(leerPreferencia('productos.porPagina'));
let ultimoResultado = null; // última salida de paginar(): total, página, elementos en pantalla
let ultimoFiltro = null; // término + 'ver inactivos' del último pintado; si cambia, se vuelve a la página 1
const estado = { modo: null, actual: null, inicial: '', guardando: false, dejarDeObservar: null, dejarDeObservarHistorial: null, tiendasSeleccion: null };

const formatoFecha = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' });
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
    const origen = desdeCache ? (pendientes ? t('datos locales, con cambios por enviar') : t('datos locales')) : t('sincronizado');
    estadoCatalogo.textContent = `${n === 1 ? t('{n} producto', { n }) : t('{n} productos', { n })} · ${origen}`;
    pintarResultados();
  },
  (error) => avisar(t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) }), 'error', 0),
);

observarTiendas(
  (lista) => {
    tiendas = lista;
    pintarCasillasTiendas();
  },
  (error) => avisar(t('No se pudieron cargar las tiendas: {error}', { error: mensajeError(error) }), 'error', 0),
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
/**
 * Pinta la página actual de resultados. Cambiar el filtro vuelve a la página 1;
 * una actualización del catálogo conserva la página (acotada al total).
 *   irA: página a mostrar · enfocarFila: 'primera' | 'ultima' · desplazar: subir a la tabla si quedó arriba
 */
function pintarResultados({ irA = null, enfocarFila = null, desplazar = false } = {}) {
  const termino = busqueda.value.trim();
  const incluirInactivos = verInactivos.checked;
  const filtro = `${incluirInactivos ? '1' : '0'}|${termino}`;
  if (filtro !== ultimoFiltro) pagina = 1;
  ultimoFiltro = filtro;
  if (irA !== null) pagina = irA;
  const filtrados = [];
  for (const producto of listaOrdenada()) {
    if (!incluirInactivos && !producto.activo) continue;
    if (termino && !coincideBusqueda(producto, termino)) continue;
    filtrados.push(producto);
  }
  const resultado = paginar(filtrados, pagina, porPagina);
  pagina = resultado.pagina;
  ultimoResultado = resultado;
  cuerpoResultados.replaceChildren(...resultado.elementos.map(fila));
  if (resultado.total === 0 && catalogo.size === 0) {
    mostrarMensaje(sinResultados, t('El catálogo está vacío. Escanea un producto o pulsa Alt+N para crear el primero.'));
  } else if (resultado.total === 0) {
    mostrarMensaje(sinResultados, termino ? t('Sin resultados para «{termino}».', { termino }) : t('No hay productos activos. Marca «Ver inactivos» para verlos todos.'));
  } else {
    mostrarMensaje(sinResultados, '');
  }
  pintarPaginacion(resultado);
  if (desplazar && tabla.getBoundingClientRect().top < 0) tabla.scrollIntoView({ block: 'start' });
  if (enfocarFila === 'primera') cuerpoResultados.querySelector('tr')?.focus();
  else if (enfocarFila === 'ultima') cuerpoResultados.querySelector('tr:last-child')?.focus();
}

function pintarPaginacion(r) {
  paginacion.hidden = r.total === 0;
  if (r.total === 0) return;
  const rango = r.inicio === r.fin ? `${r.inicio}` : `${r.inicio}–${r.fin}`;
  resumenPaginacion.textContent = r.paginas > 1
    ? t('{rango} de {total} · página {pagina} de {paginas}', { rango, total: r.total, pagina: r.pagina, paginas: r.paginas })
    : (r.total === 1 ? t('{n} resultado', { n: r.total }) : t('{n} resultados', { n: r.total }));
  botonesPaginacion.hidden = r.paginas <= 1;
  if (r.paginas <= 1) {
    numerosPaginacion.replaceChildren();
    return;
  }
  // Si el foco estaba en el paginador, se conserva en el botón equivalente tras repintar.
  const enfocado = document.activeElement;
  const teclaPrevia = paginacion.contains(enfocado) ? (enfocado.dataset.tecla ?? null) : null;
  btnAnterior.disabled = r.pagina <= 1;
  btnSiguiente.disabled = r.pagina >= r.paginas;
  numerosPaginacion.replaceChildren(...ventanaDePaginas(r.pagina, r.paginas).map((n) => {
    if (n === null) return crear('span', 'paginacion__hueco', '…');
    const boton = crear('button', 'paginacion__numero', String(n));
    boton.type = 'button';
    boton.dataset.tecla = `p${n}`;
    boton.setAttribute('aria-label', t('Página {n}', { n }));
    if (n === r.pagina) boton.setAttribute('aria-current', 'page');
    else boton.addEventListener('click', () => irAPagina(n));
    return boton;
  }));
  if (teclaPrevia) {
    const destino = paginacion.querySelector(`[data-tecla="${teclaPrevia}"]`);
    (destino && !destino.disabled ? destino : paginacion.querySelector('[aria-current="page"]'))?.focus({ preventScroll: true });
  }
}

function irAPagina(n) {
  pintarResultados({ irA: n, desplazar: true });
}

btnAnterior.addEventListener('click', () => irAPagina(pagina - 1));
btnSiguiente.addEventListener('click', () => irAPagina(pagina + 1));

selectorTamano.value = String(porPagina);
selectorTamano.addEventListener('change', () => {
  const primero = Math.max((ultimoResultado?.inicio ?? 1) - 1, 0);
  porPagina = tamanoDePagina(selectorTamano.value);
  selectorTamano.value = String(porPagina);
  guardarPreferencia('productos.porPagina', String(porPagina));
  // La página nueva es la que contiene el primer producto que se estaba viendo.
  pintarResultados({ irA: Math.floor(primero / porPagina) + 1 });
});

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
  tr.append(nombre, crear('td', '', codigo), crear('td', '', precio), crear('td', '', producto.tiendas.join(', ') || '—'), crear('td', '', producto.activo ? t('Activo') : t('Inactivo')));
  tr.addEventListener('click', () => abrirSegunDispositivo(producto.id));
  tr.addEventListener('keydown', teclasFila);
  return tr;
}

function teclasFila(evento) {
  const tr = evento.currentTarget;
  const filas = [...cuerpoResultados.querySelectorAll('tr')];
  const indice = filas.indexOf(tr);
  const ir = (destino) => { evento.preventDefault(); destino?.focus(); };
  const { pagina: actual, paginas } = ultimoResultado ?? { pagina: 1, paginas: 1 };
  const cambiarPagina = (destino, enfocarFila) => { evento.preventDefault(); pintarResultados({ irA: destino, enfocarFila }); };
  switch (evento.key) {
    case 'ArrowDown':
      if (indice < filas.length - 1) ir(filas[indice + 1]);
      else if (actual < paginas) cambiarPagina(actual + 1, 'primera'); // de la última fila se sigue en la página siguiente
      else evento.preventDefault();
      break;
    case 'ArrowUp':
      if (indice > 0) ir(filas[indice - 1]);
      else if (actual > 1) cambiarPagina(actual - 1, 'ultima');
      else ir(busqueda);
      break;
    case 'PageDown':
      if (actual < paginas) cambiarPagina(actual + 1, 'primera');
      else evento.preventDefault();
      break;
    case 'PageUp':
      if (actual > 1) cambiarPagina(actual - 1, 'primera');
      else evento.preventDefault();
      break;
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
  } else if (evento.key === 'PageDown' || evento.key === 'PageUp') {
    const r = ultimoResultado;
    if (r && r.paginas > 1) {
      evento.preventDefault();
      const destino = evento.key === 'PageDown' ? Math.min(r.pagina + 1, r.paginas) : Math.max(r.pagina - 1, 1);
      if (destino !== r.pagina) pintarResultados({ irA: destino });
    }
  } else if (evento.key === 'Escape') {
    busqueda.value = '';
    ocultarOferta();
    pintarResultados();
  }
});

verInactivos.addEventListener('change', () => pintarResultados());

async function alEnterEnBusqueda() {
  clearTimeout(temporizadorBusqueda);
  pintarResultados(); // resultados al día aunque el repintado diferido no haya corrido
  const texto = busqueda.value.trim();
  if (pareceUPC(texto)) {
    await procesarCodigo(texto);
    return;
  }
  const r = ultimoResultado;
  if (r?.total === 1) abrirSegunDispositivo(r.elementos[0].id);
  else if (r && r.total > 1) cuerpoResultados.querySelector('tr')?.focus();
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
      mostrarMensaje(avisoBusqueda, t('No se pudo comprobar el UPC: {error}', { error: mensajeError(error) }));
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
  const pendiente = pideAlAdmin ? altasPendientes.get(codigo) : null;
  if (pendiente) {
    mostrarMensaje(avisoBusqueda, textoAltaPendiente(codigo, pendiente));
    return;
  }
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
    : new Set(estado.tiendasSeleccion ?? tiendas.filter((tienda) => tienda.activo).map((tienda) => tienda.id));
  casillasTiendas.replaceChildren();
  if (tiendas.length === 0) {
    casillasTiendas.append(crear('span', 'nota', t('Sin tiendas registradas (Administración → Tiendas).')));
    return;
  }
  for (const tienda of tiendas) {
    const etiqueta = crear('label');
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.value = tienda.id;
    casilla.checked = marcadas.has(tienda.id);
    etiqueta.append(casilla, ` ${tienda.nombre}${tienda.activo ? '' : ` ${t('(inactiva)')}`}`);
    casillasTiendas.append(etiqueta);
  }
}

function marcarTiendas(ids) {
  estado.tiendasSeleccion = ids;
  const objetivo = ids ?? tiendas.filter((tienda) => tienda.activo).map((tienda) => tienda.id);
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

/** Solo un administrador cambia el precio (y la unidad de venta) de un producto existente; los demás lo ven en solo lectura. */
const CAMPOS_PRECIO = ['precioCentavos', 'precioPorKgCentavos', 'unidadVenta', 'claseFiscal'];
const NOTA_PRECIO_BLOQUEADO = t('El precio, la unidad de venta y la clase fiscal solo los cambia un administrador. Lo demás sí se puede editar.');
const NOTA_PRECIO_SOLICITUD = t('Sin precio: el precio y la clase fiscal los pone un administrador. El producto entra al catálogo cuando aprueba la solicitud.');
function bloquearPrecio(bloqueado) {
  $('f-precio').readOnly = bloqueado;
  $('f-precio-kg').readOnly = bloqueado;
  for (const radio of form.querySelectorAll('input[name="unidad"], input[name="fiscal"]')) radio.disabled = bloqueado;
  $('nota-precio').hidden = !bloqueado;
  $('nota-precio').querySelector('.nota').textContent = NOTA_PRECIO_BLOQUEADO;
}
/** Solicitud de alta: sin campos de precio ni clase fiscal (la unidad de venta sí se propone). */
function ocultarPrecio(oculto) {
  $('f-precio').closest('.campo').hidden = oculto;
  form.querySelector('input[name="fiscal"]').closest('fieldset').hidden = oculto;
  for (const radio of form.querySelectorAll('input[name="unidad"]')) radio.disabled = false;
  actualizarUnidad();
  if (oculto) {
    $('nota-precio').hidden = false;
    $('nota-precio').querySelector('.nota').textContent = NOTA_PRECIO_SOLICITUD;
  }
  btnGuardar.firstChild.textContent = `${oculto ? t('Enviar solicitud') : t('Guardar')} `;
  $('editor-lateral').hidden = oculto; // sin precio no hay etiqueta ni historial que mostrar
  $('nota-pie').textContent = pideAlAdmin
    ? (oculto ? t('La solicitud la revisa un administrador.') : t('El precio solo lo cambia un administrador.'))
    : t('Los cambios de precio quedan en el historial.');
}

class ErrorCampo extends Error {
  constructor(mensaje, campo) {
    super(mensaje);
    this.campo = campo;
  }
}

/** Lee el formulario ya normalizado; lanza ErrorCampo con el campo a corregir. */
function leerFormulario({ sinPrecio = false } = {}) {
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
  if (pluTexto !== '' && !/^\d{4,5}$/.test(pluTexto)) throw new ErrorCampo(t('El PLU debe tener 4 o 5 dígitos.'), $('f-plu'));
  const nombre = $('f-nombre').value.trim();
  if (nombre === '') throw new ErrorCampo(t('El nombre es obligatorio: es la barra negra de la etiqueta.'), $('f-nombre'));
  const unidadVenta = form.unidad.value;
  let precioCentavos = null;
  if (!sinPrecio) {
    try {
      precioCentavos = centavosDesdeTexto($('f-precio').value);
    } catch (error) {
      throw new ErrorCampo(error.message, $('f-precio'));
    }
  }
  let precioPorKgCentavos = null;
  if (unidadVenta === 'peso' && !sinPrecio) {
    try {
      precioPorKgCentavos = centavosDesdeTexto($('f-precio-kg').value);
    } catch (error) {
      throw new ErrorCampo(t('Precio por kilo: {error}', { error: error.message }), $('f-precio-kg'));
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
  const peso = form.unidad.value === 'peso' && estado.modo !== 'solicitar';
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
  estado.modo = pideAlAdmin ? 'solicitar' : 'crear';
  estado.actual = null;
  $('editor-titulo').textContent = pideAlAdmin
    ? (prefijado.upc ? t('Pedir alta · UPC {upc}', { upc: prefijado.upc }) : tc('titulo', 'Pedir alta de producto'))
    : (prefijado.upc ? t('Nuevo producto · UPC {upc}', { upc: prefijado.upc }) : tc('titulo', 'Nuevo producto'));
  btnDesactivar.hidden = true;
  meta.replaceChildren();
  historial.replaceChildren(crear('li', 'nota', t('Sin cambios de precio.')));
  llenarFormulario({ ...VACIO, ...prefijado });
  bloquearPrecio(false); // el precio inicial lo pone quien captura (en el Catálogo, nadie: lo pone el admin al aprobar)
  ocultarPrecio(pideAlAdmin);
  btnGuardar.disabled = false;
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
  btnDesactivar.hidden = pideAlAdmin && !producto.activo;
  btnDesactivar.textContent = pideAlAdmin ? t('Pedir que se quite') : (producto.activo ? t('Desactivar producto') : t('Reactivar producto'));
  llenarFormulario(producto);
  ocultarPrecio(false);
  bloquearPrecio(!esAdmin);
  btnGuardar.disabled = pideAlAdmin && !producto.activo;
  pintarMeta(producto);
  historial.replaceChildren(crear('li', 'nota', t('Cargando…')));
  estado.dejarDeObservarHistorial = observarHistorial(
    id,
    (entradas) => {
      historial.replaceChildren(
        ...(entradas.length === 0
          ? [crear('li', 'nota', t('Sin cambios de precio.'))]
          : entradas.slice(0, 10).map((e) => crear('li', '', `${fecha(e.fecha)} · ${formatearPrecio(e.precioAnteriorCentavos)} → ${formatearPrecio(e.precioNuevoCentavos)} · ${nombreDeUsuario(e.usuario)}`))),
      );
    },
    (error) => historial.replaceChildren(crear('li', 'nota', t('No se pudo cargar el historial: {error}', { error: mensajeError(error) }))),
  );
  estado.dejarDeObservar = observarProducto(id, (remoto, metadatos) => {
    if (!remoto || metadatos.hasPendingWrites || estado.guardando || !estado.actual) return;
    if (remoto.actualizadoEn?.toMillis?.() !== estado.actual.actualizadoEn?.toMillis?.()) {
      mostrarAvisoEditor(t('{nombre} acaba de cambiar este producto en otra estación. Ciérralo y ábrelo de nuevo antes de guardar.', { nombre: nombreDeUsuario(remoto.actualizadoPor) }), 'error');
    }
  });
  mostrarEditor();
  enfocar($('f-nombre'));
}

function mostrarEditor() {
  mostrarAvisoEditor(pideAlAdmin && estado.modo === 'editar' && estado.actual?.activo === false
    ? t('Producto inactivo: solo un administrador lo puede reactivar o editar.')
    : '', 'aviso');
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
  if (sucio() && !window.confirm(t('Hay cambios sin guardar. ¿Descartarlos?'))) evento.preventDefault();
});

$('btn-cerrar').addEventListener('click', () => {
  if (sucio() && !window.confirm(t('Hay cambios sin guardar. ¿Descartarlos?'))) return;
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
  meta.append(crear('div', '', t('Creado: {fecha}', { fecha: fecha(p.creadoEn) })));
  meta.append(crear('div', '', t('Actualizado: {fecha} por {nombre}', { fecha: fecha(p.actualizadoEn), nombre: nombreDeUsuario(p.actualizadoPor) })));
  if (p.ultimoPrecioImpresoCentavos == null) {
    meta.append(crear('div', '', t('Etiqueta: nunca impresa.')));
  } else {
    const pendiente = p.ultimoPrecioImpresoCentavos !== p.precioCentavos ? ' · ' + t('pendiente de reimprimir') : '';
    meta.append(crear('div', '', t('Etiqueta: impresa el {fecha} con {precio}{pendiente}.', { fecha: String(p.fechaUltimaImpresion), precio: formatearPrecio(p.ultimoPrecioImpresoCentavos), pendiente })));
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
      notaUPC = t('Sin código de barras en la vista: {error}', { error: error.message });
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
    nombre: $('f-nombre').value.trim() || t('NOMBRE'),
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
    mostrarMensaje(vistaAviso, t('Vista previa no disponible: {error}', { error: error.message }));
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
      ? t('el precio cambió en otra estación; ábrelo de nuevo y revisa')
      : mensajeError(error);
    avisar(t('No se guardó «{nombre}»: {detalle}', { nombre, detalle }), 'error', 0);
  });
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await guardar();
});

/** Personal del Catálogo: envía el producto nuevo, sin precio, como solicitud de alta. */
async function solicitarAlta() {
  let datos;
  try {
    datos = leerFormulario({ sinPrecio: true });
  } catch (error) {
    mostrarAvisoEditor(error.message);
    error.campo?.focus();
    return;
  }
  if (datos.upc) {
    const duplicado = await upcDuplicado(datos.upc);
    if (duplicado) {
      const valores = { upc: datos.upc, nombre: nombreCompleto(duplicado) };
      mostrarAvisoEditor(duplicado.activo
        ? t('El UPC {upc} ya pertenece a «{nombre}».', valores)
        : t('El UPC {upc} ya pertenece a «{nombre}» (inactivo: pide a un administrador que lo reactive).', valores));
      $('f-upc').focus();
      return;
    }
    const pendiente = altasPendientes.get(datos.upc);
    if (pendiente) {
      mostrarAvisoEditor(textoAltaPendiente(datos.upc, pendiente));
      return;
    }
  }
  estado.guardando = true;
  btnGuardar.disabled = true;
  try {
    const { promesa } = pedirAlta(datos, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa);
    if (resultado === 'pendiente') vigilarRechazo(promesa, datos.nombre);
    avisar(t('Solicitud enviada: «{nombre}» entra al catálogo cuando un administrador le ponga precio.', { nombre: datos.nombre }), resultado === 'confirmado' ? 'ok' : 'info');
    estado.inicial = huellaFormulario();
    cerrarEditor();
  } catch (error) {
    mostrarAvisoEditor(mensajeError(error));
  } finally {
    estado.guardando = false;
    btnGuardar.disabled = false;
  }
}

async function guardar() {
  if (estado.guardando) return;
  if (estado.modo === 'solicitar') {
    await solicitarAlta();
    return;
  }
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
    const valores = { upc: preparado.upc, nombre: nombreCompleto(duplicado) };
    mostrarAvisoEditor(duplicado.activo
      ? t('El UPC {upc} ya pertenece a «{nombre}».', valores)
      : t('El UPC {upc} ya pertenece a «{nombre}» (inactivo: reactívalo en lugar de crear otro).', valores));
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
      const nombre = nombreCompleto(producto);
      avisar(
        resultado === 'confirmado' ? t('«{nombre}» creado.', { nombre }) : t('«{nombre}» guardado en este equipo; se enviará al recuperar la señal.', { nombre }),
        resultado === 'confirmado' ? 'ok' : 'info',
      );
    } else {
      const cambios = diferenciasProducto(estado.actual, preparado);
      if (!esAdmin && CAMPOS_PRECIO.some((campo) => campo in cambios)) {
        mostrarAvisoEditor(t('Solo un administrador puede cambiar el precio, la unidad de venta o la clase fiscal. Déjalos como estaban y guarda lo demás.'));
        return;
      }
      if (Object.keys(cambios).length === 0) {
        avisar(t('Sin cambios.'), 'info', 2500);
        estado.inicial = huellaFormulario();
        cerrarEditor();
        return;
      }
      const { promesa, cambioPrecio } = actualizarProducto(estado.actual, cambios, personal.usuario);
      promesa.catch(() => {});
      const resultado = await esperarConfirmacion(promesa);
      if (resultado === 'pendiente') vigilarRechazo(promesa, estado.actual.nombre, cambioPrecio);
      const nombre = nombreCompleto(preparado);
      avisar(
        resultado === 'confirmado' ? t('«{nombre}» guardado.', { nombre }) : t('«{nombre}» guardado en este equipo; se enviará al recuperar la señal.', { nombre }),
        resultado === 'confirmado' ? 'ok' : 'info',
      );
    }
    estado.inicial = huellaFormulario();
    cerrarEditor();
  } catch (error) {
    mostrarAvisoEditor(
      error?.code === 'permission-denied' && estado.modo === 'editar'
        ? (esAdmin
          ? t('El servidor rechazó el cambio. Si cambiaste el precio, puede que otra estación lo haya cambiado antes: cierra y vuelve a abrir el producto.')
          : t('El servidor rechazó el cambio: el precio, la unidad de venta y la clase fiscal solo los cambia un administrador.'))
        : mensajeError(error),
    );
  } finally {
    estado.guardando = false;
    btnGuardar.disabled = false;
  }
}

/** Personal del Catálogo: pide al administrador que quite el producto. */
async function pedirQueSeQuite(producto) {
  const motivo = window.prompt(t('¿Por qué hay que quitar «{nombre}» del catálogo? (lo revisa un administrador)', { nombre: nombreCompleto(producto) }), '');
  if (motivo === null) return;
  estado.guardando = true;
  btnDesactivar.disabled = true;
  try {
    const { promesa } = pedirBaja(producto, motivo, personal);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa);
    if (resultado === 'pendiente') vigilarRechazo(promesa, producto.nombre);
    avisar(t('Solicitud enviada: un administrador decidirá si «{nombre}» se quita del catálogo.', { nombre: nombreCompleto(producto) }), resultado === 'confirmado' ? 'ok' : 'info');
    cerrarEditor();
  } catch (error) {
    mostrarAvisoEditor(mensajeError(error));
  } finally {
    estado.guardando = false;
    btnDesactivar.disabled = false;
  }
}

btnDesactivar.addEventListener('click', async () => {
  const producto = estado.actual;
  if (!producto || estado.guardando) return;
  if (pideAlAdmin) {
    await pedirQueSeQuite(producto);
    return;
  }
  const activar = !producto.activo;
  if (!activar && !window.confirm(t('¿Desactivar «{nombre}»? Dejará de salir en búsquedas e impresiones; se puede reactivar.', { nombre: nombreCompleto(producto) }))) return;
  estado.guardando = true;
  btnDesactivar.disabled = true;
  try {
    const { promesa } = actualizarProducto(producto, { activo: activar }, personal.usuario);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa);
    if (resultado === 'pendiente') vigilarRechazo(promesa, producto.nombre);
    const valores = { nombre: nombreCompleto(producto), pendiente: resultado === 'pendiente' ? ' ' + t('(se enviará al recuperar la señal)') : '' };
    avisar(activar ? t('«{nombre}» reactivado{pendiente}.', valores) : t('«{nombre}» desactivado{pendiente}.', valores), activar ? 'ok' : 'info');
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
  if (porPeso) $('detalle-kilo').textContent = t('Precio de referencia en etiqueta: {precio}', { precio: formatearPrecio(p.precioCentavos) });
  $('detalle-inactivo').hidden = p.activo;
  const pendiente = p.activo && p.ultimoPrecioImpresoCentavos !== p.precioCentavos;
  $('detalle-pendiente').hidden = !pendiente;
  if (pendiente) {
    $('detalle-pendiente').textContent = p.ultimoPrecioImpresoCentavos == null
      ? t('Etiqueta pendiente: nunca se ha impreso.')
      : t('Etiqueta pendiente: la última se imprimió con {precio} el {fecha}.', { precio: formatearPrecio(p.ultimoPrecioImpresoCentavos), fecha: String(p.fechaUltimaImpresion) });
  }
  const contenedor = $('detalle-etiqueta');
  contenedor.replaceChildren();
  try {
    const etiqueta = renderEtiqueta(p);
    contenedor.append(etiqueta);
    if (detalle.open) ajustarEtiqueta(etiqueta);
  } catch {
    contenedor.append(crear('span', 'nota', t('Sin vista de etiqueta.')));
  }
  const datos = $('detalle-datos');
  datos.replaceChildren();
  filaFicha(datos, t('Código'), p.upc ? `${p.upc} · ${tipoDeCodigo(p.upc)}` : t('Sin código de barras'));
  if (p.plu) filaFicha(datos, 'PLU', p.plu);
  filaFicha(datos, t('Clase fiscal'), p.claseFiscal === 'gravado' ? t('Gravado (+Tx)') : t('Tasa cero'));
  filaFicha(datos, t('Unidad'), p.unidadVenta === 'peso' ? t('Por peso') : t('Por pieza'));
  filaFicha(datos, t('Tiendas'), p.tiendas.map((id) => tiendas.find((tienda) => tienda.id === id)?.nombre ?? id).join(', ') || t('Ninguna'));
  if (p.proveedor) filaFicha(datos, t('Proveedor'), p.proveedor);
  filaFicha(datos, t('Última etiqueta'), p.ultimoPrecioImpresoCentavos == null ? t('Nunca impresa') : `${formatearPrecio(p.ultimoPrecioImpresoCentavos)} · ${p.fechaUltimaImpresion}`);
  filaFicha(datos, t('Actualizado'), `${fecha(p.actualizadoEn)} · ${nombreDeUsuario(p.actualizadoPor)}`);
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
  lista.replaceChildren(crear('li', 'nota', t('Cargando…')));
  estadoDetalle.dejarDeObservarHistorial = observarHistorial(
    id,
    (entradas) => {
      lista.replaceChildren(
        ...(entradas.length === 0
          ? [crear('li', 'nota', t('Sin cambios de precio.'))]
          : entradas.slice(0, 8).map((e) => crear('li', '', `${fecha(e.fecha)} · ${formatearPrecio(e.precioAnteriorCentavos)} → ${formatearPrecio(e.precioNuevoCentavos)} · ${nombreDeUsuario(e.usuario)}`))),
      );
    },
    (error) => lista.replaceChildren(crear('li', 'nota', t('No se pudo cargar el historial: {error}', { error: mensajeError(error) }))),
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
  estadoDelEscaner(t('Iniciando cámara…'));
  if (!escaner.open) escaner.showModal();
  try {
    estadoEscaner.controles = await abrirEscaner(video, {
      alDetectar: alLeerCodigo,
      alError: (error) => estadoDelEscaner(mensajeCamara(error), 'error'),
    });
    estadoDelEscaner(t('Apunta al código de barras'));
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
        estadoDelEscaner(t('Apunta al código de barras'));
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
  const pendiente = pideAlAdmin ? altasPendientes.get(codigo) : null;
  $('escaner-crear').hidden = Boolean(pendiente);
  $('escaner-oferta-texto').textContent = pendiente ? textoAltaPendiente(codigo, pendiente) : t('No hay ningún producto con el UPC {codigo}.', { codigo });
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
  estadoDelEscaner(t('Apunta al código de barras'));
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
