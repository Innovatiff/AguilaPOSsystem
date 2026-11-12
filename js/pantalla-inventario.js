/**
 * Inventario: recibir mercancía y ver lo que llegó.
 *
 * - Recibir: tienda, proveedor, factura o remisión y nota; los productos se
 *   escanean (el escáner USB escribe como teclado y termina con Enter; en el
 *   teléfono, la cámara) o se buscan por PLU o nombre. Escanear otra vez el
 *   mismo producto suma una pieza; «24*» antes del código suma 24. Los de
 *   peso piden los kilos. Lo que no está en el catálogo entra con el nombre
 *   que se teclee. Lo capturado se guarda en este navegador hasta registrarlo.
 * - Lo que llegó: por producto (cuánto, en cuántas entregas, cuándo fue la
 *   última, de qué proveedores) y entrega por entrega, en vivo, con filtros y
 *   CSV. Un administrador puede anular una entrada.
 *
 * - Existencias: cuánto hay de cada producto en la tienda y en la bodega (el
 *   último conteo de cada lugar), su caducidad y su país de procedencia; se
 *   anotan con «Ajuste rápido» (escanear y escribir; todo opcional).
 *
 * Es la misma pantalla en el back office (Inventario) y en la app Catálogo
 * (Recibir mercancía, para el personal con permiso; sin anular).
 */
import { requerirPersonal, mensajeError, EN_CATALOGO } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarCatalogo, observarTiendas, esperarConfirmacion } from './productos.js';
import { registrarRecepcion, observarRecepciones, anularRecepcion } from './recepciones.js';
import { guardarAjuste, observarExistencias } from './existencias.js';
import {
  LIMITES_RECEPCION, piezasDesdeTexto, kilosDesdeTexto, textoKilos, separarMultiplicador, esDePeso, lineaDeRecepcion,
  lineaSinRegistrar, claveDeLinea, erroresDeLinea, armarRecepcion, textoCantidades, textoLinea, cumpleFiltrosRecepcion,
  lineasVisibles, resumirPorProducto, totalesRecepciones, filasCSVRecepciones, nombreCompleto,
  LUGARES, conteoDesdeTexto, textoTotal, textoDesglose, caducidadDesdeTexto, origenDesdeTexto, paisEnPantalla, paisesSugeridos, estadoCaducidad, armarAjuste,
  totalExistencia, filasExistencias, filasCSVExistencias,
} from './inventario.js';
import { coincideBusqueda } from './esquema.js';
import { formatearPeso } from './ticket.js';
import { normalizarUPC } from './upca.js';
import { camaraDisponible, abrirEscaner, mensajeCamara, confirmarLectura } from './escaner.js';
import {
  claveDia, sumarDias, inicioDia, diasEntre, chip, mostrarMensaje, descargarCSV, fechaHora, cuando, filaDato,
} from './bo.js';
import { t, tc, numero, locale } from './idioma.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'inventario.html' });
const esAdmin = personal.rol === 'admin';

const $ = (id) => document.getElementById(id);
const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DIAS = 92;
const BORRADOR = 'inventario.borrador';
const TIENDA = 'inventario.tienda';
const leer = (clave) => { try { return localStorage.getItem(clave); } catch { return null; } };
const guardar = (clave, valor) => {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch { /* sin almacenamiento: no pasa nada */ }
};

if (EN_CATALOGO) $('titulo-pagina').textContent = t('Recibir mercancía');

let catalogo = new Map();
let porUPC = new Map();
let porPLU = new Map();
let tiendas = [];
let lineas = []; // la entrada en captura, lo último arriba
let resaltar = null; // clave de la línea recién tocada
let pendienteNuevo = null; // { upc, cantidad } de un código que no está en el catálogo
let sugeridos = [];
let activo = -1;
let cantidadSugerida = null;

// ===================================================================== recibir

function indexar() {
  porUPC = new Map();
  porPLU = new Map();
  for (const p of catalogo.values()) {
    if (p.upc) porUPC.set(p.upc, [...(porUPC.get(p.upc) ?? []), p]);
    if (p.plu) porPLU.set(p.plu, [...(porPLU.get(p.plu) ?? []), p]);
  }
}

/** Entre varios productos con el mismo código: el activo y de la tienda elegida. */
function elegir(lista) {
  if (!lista?.length) return null;
  const tienda = $('r-tienda').value;
  const enTienda = (p) => (tienda && p.tiendas?.includes(tienda) ? 1 : 0);
  return [...lista].sort((a, b) => (a.activo === false) - (b.activo === false) || enTienda(b) - enTienda(a))[0];
}

function buscar(consulta, maximo = 8) {
  const encontrados = [];
  for (const p of catalogo.values()) if (coincideBusqueda(p, consulta)) encontrados.push(p);
  return encontrados
    .sort((a, b) => (a.activo === false) - (b.activo === false) || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, maximo);
}

const codigoDe = (l) => l.upc ?? (l.plu ? `PLU ${l.plu}` : '');
const avisar = (tipo, texto) => mostrarMensaje($('mensaje'), tipo, texto);
/** "1 producto" · "12 productos". */
const textoProductos = (n) => (n === 1 ? t('{n} producto', { n }) : t('{n} productos', { n }));

function guardarBorrador() {
  const datos = { lineas, proveedor: $('r-proveedor').value, referencia: $('r-referencia').value, nota: $('r-nota').value };
  const vacio = lineas.length === 0 && !datos.proveedor && !datos.referencia && !datos.nota;
  guardar(BORRADOR, vacio ? null : JSON.stringify(datos));
}

function recuperarBorrador() {
  try {
    const datos = JSON.parse(leer(BORRADOR) ?? 'null');
    if (!datos || !Array.isArray(datos.lineas)) return;
    lineas = datos.lineas.filter((l) => l && typeof l.nombre === 'string').slice(0, LIMITES_RECEPCION.lineas);
    $('r-proveedor').value = datos.proveedor ?? '';
    $('r-referencia').value = datos.referencia ?? '';
    $('r-nota').value = datos.nota ?? '';
    if (lineas.length) {
      avisar('info', lineas.length === 1
        ? t('Se recuperó la entrada que quedó sin registrar ({n} producto).', { n: lineas.length })
        : t('Se recuperó la entrada que quedó sin registrar ({n} productos).', { n: lineas.length }));
    }
  } catch {
    guardar(BORRADOR, null);
  }
}

function pintarTotales() {
  const piezas = lineas.reduce((s, l) => s + (l.pesoGramos === null && Number.isInteger(l.cantidad) ? l.cantidad : 0), 0);
  const gramos = lineas.reduce((s, l) => s + (Number.isInteger(l.pesoGramos) ? l.pesoGramos : 0), 0);
  const conError = lineas.filter((l) => erroresDeLinea(l).length > 0).length;
  const partes = lineas.length ? [textoProductos(lineas.length), textoCantidades({ piezas, gramos })] : [];
  if (lineas.length && conError) partes.push(conError === 1 ? t('falta 1 cantidad') : t('faltan {n} cantidades', { n: conError }));
  $('lineas-total').textContent = partes.join(' · ');
  $('btn-registrar').disabled = lineas.length === 0 || conError > 0;
  $('btn-descartar').disabled = lineas.length === 0;
}

function campoCantidad(l) {
  const peso = l.pesoGramos !== null || l.cantidad === null;
  const entrada = h('input', {
    class: 'recepcion__cantidad',
    inputmode: peso ? 'decimal' : 'numeric',
    autocomplete: 'off',
    value: peso ? textoKilos(l.pesoGramos) : String(l.cantidad ?? ''),
    placeholder: peso ? '0.000' : '',
    'aria-label': peso ? t('Kilos de {nombre}', { nombre: l.nombre }) : t('Piezas de {nombre}', { nombre: l.nombre }),
    'aria-invalid': erroresDeLinea(l).length ? 'true' : null,
    dataset: { clave: claveDeLinea(l) },
  });
  entrada.addEventListener('input', () => {
    try {
      if (peso) l.pesoGramos = kilosDesdeTexto(entrada.value);
      else l.cantidad = piezasDesdeTexto(entrada.value);
      entrada.removeAttribute('aria-invalid');
      entrada.title = '';
    } catch (error) {
      if (peso) l.pesoGramos = null;
      else l.cantidad = null;
      entrada.setAttribute('aria-invalid', 'true');
      entrada.title = error.message;
    }
    pintarTotales();
    guardarBorrador();
  });
  entrada.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('r-codigo').focus();
    }
  });
  return h('span', { class: 'recepcion__medida' }, entrada, h('span', { text: peso ? 'kg' : t('pzas') }));
}

function pintarLineas() {
  const cuerpo = $('tabla-lineas').tBodies[0];
  cuerpo.replaceChildren(...lineas.map((l) => {
    const clave = claveDeLinea(l);
    return h('tr', { class: clave === resaltar ? 'fila--resaltada' : null, dataset: { clave } },
      h('td', null,
        h('span', { class: 'recepcion__nombre', text: l.nombre }),
        l.producto ? null : [' ', chip(t('Sin registrar'), 'aviso')],
        h('span', { class: 'recepcion__codigo-linea monoespaciada', text: codigoDe(l) || t('sin código') })),
      h('td', { class: 'num' }, campoCantidad(l)),
      h('td', { class: 'num' }, h('button', { type: 'button', class: 'boton boton--enlace', 'aria-label': t('Quitar {nombre}', { nombre: l.nombre }), title: t('Quitar'), dataset: { quitar: clave }, text: t('Quitar') })));
  }));
  $('tabla-lineas').hidden = lineas.length === 0;
  $('lineas-vacio').hidden = lineas.length > 0;
  pintarTotales();
}

function enfocarCantidad(clave) {
  const entrada = $('tabla-lineas').querySelector(`input[data-clave="${CSS.escape(clave)}"]`);
  entrada?.focus();
  entrada?.select();
}

function ocultarSugerencias() {
  sugeridos = [];
  activo = -1;
  $('sugerencias').hidden = true;
  $('sugerencias').replaceChildren();
  $('r-codigo').removeAttribute('aria-activedescendant');
}

function ocultarNuevo() {
  pendienteNuevo = null;
  $('form-nuevo').hidden = true;
}

/** Agrega un producto del catálogo (o suma a su línea). */
function agregar(producto, cantidad = null) {
  ocultarSugerencias();
  ocultarNuevo();
  const nueva = lineaDeRecepcion(producto, { cantidad });
  const clave = claveDeLinea(nueva);
  const indice = lineas.findIndex((l) => claveDeLinea(l) === clave);
  let linea = nueva;
  if (indice >= 0) {
    [linea] = lineas.splice(indice, 1);
    if (linea.pesoGramos === null && linea.cantidad !== null) {
      linea.cantidad = Math.min((linea.cantidad ?? 0) + (cantidad ?? 1), LIMITES_RECEPCION.piezas);
    }
  } else if (lineas.length >= LIMITES_RECEPCION.lineas) {
    avisar('error', t('Una entrada lleva como máximo {n} productos: registra esta y sigue en otra.', { n: LIMITES_RECEPCION.lineas }));
    return;
  }
  lineas.unshift(linea);
  resaltar = clave;
  $('r-codigo').value = '';
  pintarLineas();
  guardarBorrador();
  if (esDePeso(producto) || linea.cantidad === null) {
    avisar('info', t('{nombre}: escribe los kilos que llegaron.', { nombre: linea.nombre }));
    enfocarCantidad(clave);
  } else {
    avisar('', '');
    $('r-codigo').focus();
  }
}

/** Un código que no está en el catálogo: se puede recibir con el nombre que se teclee. */
function ofrecerNuevo(upc, cantidad) {
  ocultarSugerencias();
  pendienteNuevo = { upc, cantidad: cantidad ?? 1 };
  $('nuevo-texto').textContent = t('El código {upc} no está en el catálogo. Si llegó, escribe qué es y entra a la entrega como «sin registrar» (después se da de alta en Productos o Captura rápida).', { upc });
  $('nuevo-nombre').value = '';
  $('form-nuevo').hidden = false;
  $('nuevo-nombre').focus();
}

function procesar(texto) {
  let separado;
  try {
    separado = separarMultiplicador(texto);
  } catch (error) {
    avisar('error', error.message);
    return;
  }
  const { cantidad, codigo } = separado;
  if (codigo === '') return;
  if (/^\d{4,5}$/.test(codigo)) {
    const producto = elegir(porPLU.get(codigo));
    if (producto) agregar(producto, cantidad);
    else avisar('error', t('No hay ningún producto con el PLU {plu}.', { plu: codigo }));
    return;
  }
  if (/^\d+$/.test(codigo)) {
    let upc;
    try {
      upc = normalizarUPC(codigo);
    } catch (error) {
      avisar('error', error.message);
      $('r-codigo').select();
      return;
    }
    const producto = elegir(porUPC.get(upc));
    if (producto) agregar(producto, cantidad);
    else ofrecerNuevo(upc, cantidad);
    return;
  }
  const lista = activo >= 0 && sugeridos.length ? [sugeridos[activo]] : buscar(codigo);
  if (lista.length === 0) {
    avisar('error', t('No se encontró «{codigo}» en el catálogo.', { codigo }));
    return;
  }
  agregar(lista[0], cantidad);
}

function pintarSugerencias() {
  const lista = $('sugerencias');
  lista.replaceChildren(...sugeridos.map((p, i) => h('li', {
    id: `sugerencia-${i}`,
    role: 'option',
    class: 'recepcion__sugerencia',
    'aria-selected': String(i === activo),
    dataset: { indice: i },
  },
  h('strong', { text: [p.marca, p.nombre].filter(Boolean).join(' ') }),
  h('span', { class: 'secundario', text: [p.presentacion, p.upc ?? (p.plu ? `PLU ${p.plu}` : ''), esDePeso(p) ? t('por kilo') : '', p.activo === false ? t('inactivo') : ''].filter(Boolean).join(' · ') }))));
  lista.hidden = sugeridos.length === 0;
  if (activo >= 0) $('r-codigo').setAttribute('aria-activedescendant', `sugerencia-${activo}`);
  else $('r-codigo').removeAttribute('aria-activedescendant');
}

$('r-codigo').addEventListener('input', () => {
  let codigo;
  try {
    ({ cantidad: cantidadSugerida, codigo } = separarMultiplicador($('r-codigo').value));
  } catch {
    codigo = '';
  }
  if (codigo.length < 2 || /^\d+$/.test(codigo)) {
    ocultarSugerencias();
    return;
  }
  sugeridos = buscar(codigo);
  activo = sugeridos.length ? 0 : -1;
  pintarSugerencias();
});

$('r-codigo').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugeridos.length) return;
    e.preventDefault();
    activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + sugeridos.length) % sugeridos.length;
    pintarSugerencias();
  } else if (e.key === 'Escape') {
    $('r-codigo').value = '';
    ocultarSugerencias();
  }
});

$('form-codigo').addEventListener('submit', (e) => {
  e.preventDefault();
  procesar($('r-codigo').value);
});

$('sugerencias').addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco
$('sugerencias').addEventListener('click', (e) => {
  const opcion = e.target.closest('[data-indice]');
  if (!opcion) return;
  const producto = sugeridos[Number(opcion.dataset.indice)];
  if (producto) agregar(producto, cantidadSugerida);
});

$('form-nuevo').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendienteNuevo) return;
  let linea;
  try {
    linea = lineaSinRegistrar({ upc: pendienteNuevo.upc, nombre: $('nuevo-nombre').value, cantidad: pendienteNuevo.cantidad });
  } catch (error) {
    avisar('error', error.message);
    $('nuevo-nombre').focus();
    return;
  }
  const clave = claveDeLinea(linea);
  const indice = lineas.findIndex((l) => claveDeLinea(l) === clave);
  if (indice >= 0) {
    const [previa] = lineas.splice(indice, 1);
    previa.cantidad = Math.min((previa.cantidad ?? 0) + linea.cantidad, LIMITES_RECEPCION.piezas);
    linea = previa;
  }
  lineas.unshift(linea);
  resaltar = clave;
  ocultarNuevo();
  $('r-codigo').value = '';
  avisar('', '');
  pintarLineas();
  guardarBorrador();
  $('r-codigo').focus();
});
$('nuevo-cancelar').addEventListener('click', () => {
  ocultarNuevo();
  $('r-codigo').select();
  $('r-codigo').focus();
});

$('tabla-lineas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-quitar]');
  if (!boton) return;
  lineas = lineas.filter((l) => claveDeLinea(l) !== boton.dataset.quitar);
  pintarLineas();
  guardarBorrador();
  $('r-codigo').focus();
});

for (const id of ['r-proveedor', 'r-referencia', 'r-nota']) $(id).addEventListener('input', guardarBorrador);
$('form-datos').addEventListener('submit', (e) => e.preventDefault());
$('r-tienda').addEventListener('change', () => guardar(TIENDA, $('r-tienda').value || null));

function limpiarEntrada() {
  lineas = [];
  resaltar = null;
  $('r-proveedor').value = '';
  $('r-referencia').value = '';
  $('r-nota').value = '';
  ocultarNuevo();
  ocultarSugerencias();
  pintarLineas();
  guardar(BORRADOR, null);
}

$('btn-descartar').addEventListener('click', () => {
  if (lineas.length && !window.confirm(t('¿Descartar los productos capturados de esta entrada?'))) return;
  limpiarEntrada();
  avisar('', '');
  $('r-codigo').focus();
});

$('btn-registrar').addEventListener('click', async () => {
  let datos;
  try {
    datos = armarRecepcion({
      lineas: [...lineas].reverse(), // en el orden en que se escanearon
      tienda: $('r-tienda').value || null,
      proveedor: $('r-proveedor').value,
      referencia: $('r-referencia').value,
      nota: $('r-nota').value,
    }, personal);
  } catch (error) {
    avisar('error', error.message);
    return;
  }
  $('btn-registrar').disabled = true;
  const { promesa } = registrarRecepcion(datos);
  promesa.catch((error) => avisar('error', t('La entrada no se guardó: {error}', { error: mensajeError(error) })));
  try {
    const estado = await esperarConfirmacion(promesa);
    limpiarEntrada();
    const valores = { productos: textoProductos(datos.productos), cantidades: textoCantidades(datos), proveedor: datos.proveedor };
    const registrada = datos.proveedor
      ? t('Entrada registrada: {productos}, {cantidades} de {proveedor}.', valores)
      : t('Entrada registrada: {productos}, {cantidades}.', valores);
    avisar('ok', estado === 'pendiente' ? [registrada, t('Sin señal: se enviará en cuanto vuelva.')].join(' ') : registrada);
    $('r-codigo').focus();
  } catch (error) {
    avisar('error', t('No se pudo registrar la entrada: {error}', { error: mensajeError(error) }));
    pintarTotales();
  }
});

// ------------------------------------------------------------- cámara

const escaner = $('escaner');
const camara = { controles: null, abriendo: false, linterna: false, alLeer: null };

function estadoCamara(texto, tipo = '') {
  $('escaner-estado').textContent = texto;
  $('escaner-estado').className = `escaner__estado${tipo ? ` escaner__estado--${tipo}` : ''}`;
}

/** Abre la cámara; `alLeer(texto)` recibe cada código leído (recibir mercancía o el ajuste rápido). */
async function abrirCamara(alLeer) {
  if (camara.abriendo) return;
  camara.abriendo = true;
  camara.alLeer = alLeer;
  $('escaner-linterna').hidden = true;
  estadoCamara(t('Iniciando cámara…'));
  if (!escaner.open) escaner.showModal();
  try {
    camara.controles = await abrirEscaner($('escaner-video'), {
      alDetectar: ({ texto }) => {
        confirmarLectura();
        camara.alLeer?.(texto);
      },
      alError: (error) => estadoCamara(mensajeCamara(error), 'error'),
    });
    estadoCamara(t('Apunta al código de barras'));
    $('escaner-linterna').hidden = !camara.controles.tieneLinterna;
  } catch (error) {
    estadoCamara(mensajeCamara(error), 'error');
  } finally {
    camara.abriendo = false;
  }
}

$('btn-camara').hidden = !camaraDisponible();
$('btn-camara').addEventListener('click', () => abrirCamara((texto) => {
  procesar(texto);
  estadoCamara(t('Leído {codigo}. Apunta al siguiente o cierra.', { codigo: texto }), 'ok');
  if (pendienteNuevo || lineas[0]?.cantidad === null) escaner.close();
}));
$('escaner-cerrar').addEventListener('click', () => escaner.close());
escaner.addEventListener('close', () => {
  camara.controles?.detener();
  camara.controles = null;
  camara.alLeer = null;
  camara.linterna = false;
  $('escaner-linterna').setAttribute('aria-pressed', 'false');
});
$('escaner-linterna').addEventListener('click', async () => {
  camara.linterna = !camara.linterna;
  const ok = await camara.controles?.linterna(camara.linterna);
  $('escaner-linterna').setAttribute('aria-pressed', String(!!ok && camara.linterna));
});

// ===================================================================== lo que llegó

const hoy = claveDia();
let desde = sumarDias(hoy, -6);
let hasta = hoy;
let recepciones = [];
let visibles = [];
let dejarDeEscuchar = null;

const nombreTienda = (id) => tiendas.find((tienda) => tienda.id === id)?.nombre ?? id;
const filtros = () => ({ tienda: $('f-tienda').value, proveedor: $('f-proveedor').value, buscar: $('f-buscar').value });

function llenarSelect(select, pares, todos) {
  const actual = select.value;
  select.replaceChildren(h('option', { value: '', text: todos }), ...pares.map(([valor, texto]) => h('option', { value: valor, text: texto })));
  select.value = pares.some(([valor]) => valor === actual) ? actual : '';
}

function kpi(etiqueta, valor, detalle = '') {
  return h('article', { class: 'kpi' },
    h('span', { class: 'kpi__etiqueta', text: etiqueta }),
    h('strong', { class: 'kpi__valor', text: valor }),
    detalle ? h('span', { class: 'kpi__detalle', text: detalle }) : null);
}

function pintarHistorial() {
  const enUso = new Set(recepciones.map((r) => r.tienda).filter(Boolean));
  const paresTienda = tiendas.filter((tienda) => tienda.activo !== false || enUso.has(tienda.id)).map((tienda) => [tienda.id, tienda.nombre]);
  for (const id of enUso) if (!paresTienda.some(([valor]) => valor === id)) paresTienda.push([id, id]);
  if (recepciones.some((r) => !r.tienda)) paresTienda.push(['-', t('Sin tienda')]);
  llenarSelect($('f-tienda'), paresTienda, t('Todas'));
  const proveedores = [...new Set(recepciones.map((r) => r.proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  llenarSelect($('f-proveedor'), proveedores.map((p) => [p, p]), t('Todos'));

  const f = filtros();
  visibles = recepciones.filter((r) => cumpleFiltrosRecepcion(r, f));
  const resumen = resumirPorProducto(visibles, { buscar: f.buscar });
  const totales = totalesRecepciones(visibles, { buscar: f.buscar });

  $('kpis').replaceChildren(
    kpi(t('Entregas'), String(totales.entregas), totales.anuladas
      ? (totales.anuladas === 1 ? t('{n} anulada (no cuentan)', { n: totales.anuladas }) : t('{n} anuladas (no cuentan)', { n: totales.anuladas }))
      : (desde === hasta ? t('del día') : t('en el periodo'))),
    kpi(t('Piezas recibidas'), numero(totales.piezas)),
    kpi(t('Kilos recibidos'), totales.gramos ? formatearPeso(totales.gramos) : '0 kg', t('productos a granel')),
    kpi(t('Productos distintos'), String(totales.productos)),
  );

  $('contador-productos').textContent = resumen.length ? textoProductos(resumen.length) : '';
  $('tabla-productos').hidden = resumen.length === 0;
  $('vacio-productos').hidden = resumen.length > 0;
  $('tabla-productos').tBodies[0].replaceChildren(...resumen.map((p) => h('tr', null,
    h('td', null, p.nombre, p.producto ? null : [' ', chip(t('Sin registrar'), 'aviso')]),
    h('td', { class: 'monoespaciada', text: p.upc ?? (p.plu ? `PLU ${p.plu}` : '—') }),
    h('td', { class: 'num' }, h('strong', { text: textoCantidades(p) })),
    h('td', { class: 'num', text: String(p.entregas) }),
    h('td', { text: cuando(p.ultima) }),
    h('td', { text: p.proveedores.join(', ') || '—' }))));

  $('contador-entregas').textContent = visibles.length
    ? (visibles.length === 1 ? t('{n} entrega', { n: visibles.length }) : t('{n} entregas', { n: visibles.length }))
    : '';
  $('tabla-entregas').hidden = visibles.length === 0;
  $('vacio-entregas').hidden = visibles.length > 0;
  $('tabla-entregas').tBodies[0].replaceChildren(...visibles.map((r) => h('tr', { tabindex: 0, class: r.anulada ? 'fila--anulada' : null, dataset: { id: r.id } },
    h('td', { text: cuando(r.fecha) }),
    h('td', { text: r.tienda ? nombreTienda(r.tienda) : '—' }),
    h('td', { text: r.proveedor ?? '—' }),
    h('td', { class: 'monoespaciada', text: r.referencia ?? '—' }),
    h('td', { text: r.recibidoPorNombre }),
    h('td', { class: 'num', text: String(r.productos) }),
    h('td', { class: `num${r.anulada ? ' tachado' : ''}`, text: textoCantidades(r) }),
    h('td', null, r.anulada ? chip(t('Anulada'), 'alerta') : chip(t('Recibida'), 'abierto'), r.pendiente ? [' ', chip(t('Por enviar'), 'aviso')] : null))));

  // Proveedores conocidos para el campo de la entrada (los del catálogo y los de las entregas).
  const conocidos = new Set(proveedores);
  for (const p of catalogo.values()) if (p.proveedor) conocidos.add(p.proveedor);
  $('lista-proveedores').replaceChildren(...[...conocidos].sort((a, b) => a.localeCompare(b, 'es')).slice(0, 200).map((p) => h('option', { value: p })));
}

function ajustarRango() {
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diasEntre(desde, hasta).length > MAXIMO_DIAS) {
    desde = sumarDias(hasta, -(MAXIMO_DIAS - 1));
    avisar('aviso', t('Se muestran como máximo {n} días: desde el {desde}.', { n: MAXIMO_DIAS, desde }));
  }
  $('f-desde').value = desde;
  $('f-hasta').value = hasta;
}

function escuchar() {
  dejarDeEscuchar?.();
  ajustarRango();
  recepciones = [];
  for (const boton of document.querySelectorAll('[data-rango]')) {
    boton.setAttribute('aria-pressed', String(hasta === claveDia() && desde === sumarDias(hasta, -(Number(boton.dataset.rango) - 1))));
  }
  dejarDeEscuchar = observarRecepciones({ desde: inicioDia(desde), hasta: inicioDia(sumarDias(hasta, 1)) }, (lista) => {
    recepciones = lista;
    pintarHistorial();
  }, (error) => avisar('error', t('No se pudieron cargar las entregas: {error}', { error: mensajeError(error) })));
  pintarHistorial();
}

for (const boton of document.querySelectorAll('[data-rango]')) {
  boton.addEventListener('click', () => {
    hasta = claveDia();
    desde = sumarDias(hasta, -(Number(boton.dataset.rango) - 1));
    escuchar();
  });
}
for (const id of ['f-desde', 'f-hasta']) {
  $(id).addEventListener('change', () => {
    if (!REGEX_DIA.test($('f-desde').value) || !REGEX_DIA.test($('f-hasta').value)) return;
    desde = $('f-desde').value;
    hasta = $('f-hasta').value;
    escuchar();
  });
}
for (const id of ['f-tienda', 'f-proveedor']) $(id).addEventListener('change', pintarHistorial);
$('f-buscar').addEventListener('input', pintarHistorial);
$('filtros').addEventListener('submit', (e) => e.preventDefault());

$('btn-exportar').addEventListener('click', () => {
  pintarHistorial();
  const filas = filasCSVRecepciones(visibles, { fechaTexto: fechaHora, nombreTienda, buscar: filtros().buscar });
  descargarCSV(`entradas-${desde}${hasta !== desde ? `-a-${hasta}` : ''}.csv`, filas);
});

// ------------------------------------------------------------- detalle de una entrega

function abrirEntrega(r) {
  const lineasTabla = h('table', { class: 'tabla tabla--compacta' },
    h('thead', null, h('tr', null, h('th', { text: t('Producto') }), h('th', { text: t('Código') }), h('th', { class: 'num', text: t('Cantidad') }))),
    h('tbody', null, (r.lineas ?? []).map((l) => h('tr', null,
      h('td', null, l.nombre, l.producto ? null : [' ', chip(t('Sin registrar'), 'aviso')]),
      h('td', { class: 'monoespaciada', text: codigoDe(l) || '—' }),
      h('td', { class: 'num', text: textoLinea(l) })))),
    h('tfoot', null, h('tr', null, h('td', { colspan: 2, text: textoProductos(r.productos) }), h('td', { class: 'num', text: textoCantidades(r) }))));
  const anular = esAdmin && !r.anulada
    ? h('button', { type: 'button', class: 'boton boton--peligro', id: 'btn-anular-entrega', text: t('Anular entrada') })
    : null;
  const titulo = t('Entrega del {fecha}', { fecha: cuando(r.fecha) });
  const dialogo = h('dialog', { class: 'editor editor--entrega', 'aria-label': t('Entrega') },
    h('div', { class: 'editor__form' },
      h('header', { class: 'editor__cabecera' },
        h('h2', null, `${titulo} `, r.anulada ? chip(t('Anulada'), 'alerta') : chip(t('Recibida'), 'abierto')),
        h('button', { type: 'button', class: 'boton boton--secundario', 'data-cerrar': '', text: t('Cerrar') })),
      h('div', { class: 'editor__cuerpo editor__cuerpo--simple' },
        h('dl', { class: 'ficha ficha--compacta' },
          filaDato(t('Fecha'), fechaHora(r.fecha)),
          filaDato(t('Tienda'), r.tienda ? nombreTienda(r.tienda) : '—'),
          filaDato(t('Proveedor'), r.proveedor ?? '—'),
          filaDato(t('Factura o remisión'), r.referencia ?? '—'),
          filaDato(t('Recibió'), r.recibidoPorNombre),
          r.nota ? filaDato(t('Nota'), r.nota) : null,
          r.anulada ? filaDato(t('Anulada'), `${r.anuladaEn ? fechaHora(r.anuladaEn) : ''} (${r.anuladaPor})`) : null),
        h('div', { class: 'tabla-desplazable' }, lineasTabla),
        anular ? h('div', { class: 'acciones' }, anular) : null)));
  dialogo.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar]')) dialogo.close();
  });
  anular?.addEventListener('click', async () => {
    if (!window.confirm(t('¿Anular esta entrada? Seguirá a la vista, tachada, y dejará de contar en lo que llegó.'))) return;
    anular.disabled = true;
    try {
      await anularRecepcion(r.id, personal.usuario);
      dialogo.close();
      avisar('ok', r.proveedor ? t('Entrada anulada ({proveedor}).', { proveedor: r.proveedor }) : t('Entrada anulada.'));
    } catch (error) {
      anular.disabled = false;
      avisar('error', t('No se pudo anular la entrada: {error}', { error: mensajeError(error) }));
    }
  });
  dialogo.addEventListener('close', () => dialogo.remove());
  document.body.append(dialogo);
  dialogo.showModal();
}

function entregaElegida(e) {
  const fila = e.target.closest('tr[data-id]');
  return fila ? visibles.find((r) => r.id === fila.dataset.id) : null;
}
$('tabla-entregas').addEventListener('click', (e) => {
  const r = entregaElegida(e);
  if (r) abrirEntrega(r);
});
$('tabla-entregas').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const r = entregaElegida(e);
  if (r) abrirEntrega(r);
});

// ===================================================================== existencias: tienda y bodega (Ajuste rápido)
//
// «Ajuste rápido»: se escanea (o se escribe) el código del producto y se anota
// cuánto hay en la tienda y en la bodega (cajas × lo que trae cada caja +
// sueltas), la fecha de caducidad y el país de procedencia. Todo es opcional:
// lo que se deja vacío no cambia. La tabla de existencias muestra el último
// conteo de cada lugar de la tienda elegida, en vivo.

let existencias = []; // las de la tienda elegida
let tiendaExistencias = '';
let dejarExistencias = null;
let ajuste = null; // { producto, propuesto } mientras se capturan sus datos
let sugeridosAjuste = [];
let activoAjuste = -1;

const dlgAjuste = $('dlg-ajuste');
const LUGARES_AJUSTE = Object.freeze([['t', 'enTienda'], ['b', 'enBodega']]);
// Sugerencias del campo «País de procedencia» (en el idioma elegido; se guarda lo que se escriba).

const milisDe = (marca) => (typeof marca?.toMillis === 'function' ? marca.toMillis() : 0);
/** '2027-01-15' → «15 ene 2027» / «Jan 15, 2027». */
const fechaCaducidad = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const mensajeAjuste = (tipo, texto) => mostrarMensaje($('ajuste-mensaje'), tipo, texto);
const existenciaDe = (productoId) => existencias.find((e) => e.producto === productoId) ?? null;

function celdaLugar(e, conteo) {
  if (!conteo) return h('td', { class: 'num secundario', text: '—' });
  const desglose = textoDesglose(conteo, e.porPeso);
  return h('td', { class: 'num' },
    h('span', { class: 'existencias__cantidad', text: textoTotal(conteo.total, e.porPeso) }),
    desglose ? h('span', { class: 'existencias__desglose', text: desglose }) : null);
}

function celdaCaducidad(caducidad, hoy) {
  if (!caducidad) return h('td', { text: '—' });
  const estado = estadoCaducidad(caducidad, hoy);
  const aviso = estado === 'vencido' ? chip(t('Caducado'), 'alerta') : estado === 'pronto' ? chip(t('Caduca pronto'), 'aviso') : null;
  return h('td', null, fechaCaducidad(caducidad), aviso ? [' ', aviso] : null);
}

function celdaUltimoConteo(e) {
  const ultimo = LUGARES.map((lugar) => e[lugar]).filter((c) => c?.contadoEn).sort((a, b) => milisDe(b.contadoEn) - milisDe(a.contadoEn))[0];
  if (!ultimo) return h('td', { text: '—' });
  return h('td', null, h('span', { text: cuando(ultimo.contadoEn) }), h('span', { class: 'existencias__quien', text: ultimo.contadoPorNombre }));
}

function pintarExistencias() {
  const hoy = claveDia();
  const filas = filasExistencias(existencias, { buscar: $('e-buscar').value, porCaducar: $('e-caducar').checked, hoy });
  $('contador-existencias').textContent = existencias.length ? textoProductos(filas.length) : '';
  $('tabla-existencias').hidden = filas.length === 0;
  $('vacio-existencias').hidden = filas.length > 0;
  if (!$('e-tienda').value) $('vacio-existencias').textContent = t('Primero da de alta una tienda (Administración → Tiendas).');
  else if (existencias.length) $('vacio-existencias').textContent = t('Nada con esos filtros.');
  else $('vacio-existencias').textContent = t('Todavía no se ha contado nada en esta tienda. Toca «Ajuste rápido» para empezar.');
  $('tabla-existencias').tBodies[0].replaceChildren(...filas.map((e) => h('tr', { tabindex: 0, dataset: { producto: e.producto } },
    h('td', null, e.nombre, e.pendiente ? [' ', chip(t('Por enviar'), 'aviso')] : null),
    h('td', { class: 'monoespaciada', text: e.upc ?? (e.plu ? `PLU ${e.plu}` : '—') }),
    celdaLugar(e, e.enTienda),
    celdaLugar(e, e.enBodega),
    h('td', { class: 'num' }, h('strong', { text: textoTotal(totalExistencia(e), e.porPeso) })),
    celdaCaducidad(e.caducidad, hoy),
    h('td', { text: paisEnPantalla(e.origen) ?? '—' }),
    celdaUltimoConteo(e))));
  const paises = new Set(paisesSugeridos());
  for (const e of existencias) if (e.origen) paises.add(paisEnPantalla(e.origen));
  $('lista-paises').replaceChildren(...[...paises].sort((a, b) => a.localeCompare(b, locale())).map((p) => h('option', { value: p })));
  if (ajuste && dlgAjuste.open) pintarAhora();
}

function escucharExistencias() {
  const tienda = $('e-tienda').value;
  if (tienda === tiendaExistencias && (dejarExistencias || !tienda)) return;
  dejarExistencias?.();
  dejarExistencias = null;
  tiendaExistencias = tienda;
  existencias = [];
  pintarExistencias();
  if (!tienda) return;
  dejarExistencias = observarExistencias(tienda, (lista) => {
    existencias = lista;
    pintarExistencias();
    refrescarAjuste();
  }, (error) => avisar('error', t('No se pudieron cargar las existencias: {error}', { error: mensajeError(error) })));
}

/** Las tiendas activas en el filtro de la tabla y en el ajuste (sin elegir si solo hay una). */
function llenarTiendasExistencias() {
  const activas = tiendas.filter((tienda) => tienda.activo !== false);
  const actual = $('e-tienda').value || $('r-tienda').value || leer(TIENDA) || personal.tienda || '';
  const opciones = () => activas.map((tienda) => h('option', { value: tienda.id, text: tienda.nombre }));
  $('e-tienda').replaceChildren(...opciones());
  $('ajuste-tienda').replaceChildren(...opciones());
  $('e-tienda').value = activas.some((tienda) => tienda.id === actual) ? actual : (activas[0]?.id ?? '');
  $('ajuste-tienda').value = $('e-tienda').value;
  $('ajuste-campo-tienda').hidden = activas.length <= 1;
  escucharExistencias();
}

$('e-tienda').addEventListener('change', () => {
  $('ajuste-tienda').value = $('e-tienda').value;
  escucharExistencias();
});
$('e-buscar').addEventListener('input', pintarExistencias);
$('e-caducar').addEventListener('change', pintarExistencias);
$('filtros-existencias').addEventListener('submit', (e) => e.preventDefault());
$('btn-exportar-existencias').addEventListener('click', () => {
  const filas = filasExistencias(existencias, { buscar: $('e-buscar').value, porCaducar: $('e-caducar').checked, hoy: claveDia() });
  descargarCSV(`${t('existencias')}-${$('e-tienda').value || 'tienda'}-${claveDia()}.csv`, filasCSVExistencias(filas, { fechaTexto: fechaHora, nombreTienda }));
});

function abrirDesdeTabla(e) {
  const fila = e.target.closest('tr[data-producto]');
  if (!fila) return;
  const producto = catalogo.get(fila.dataset.producto);
  if (!producto) {
    avisar('error', t('Ese producto ya no está en el catálogo.'));
    return;
  }
  abrirAjuste(producto);
}
$('tabla-existencias').addEventListener('click', abrirDesdeTabla);
$('tabla-existencias').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') abrirDesdeTabla(e);
});

// ------------------------------------------------------------- el diálogo

function abrirAjuste(producto = null) {
  $('ajuste-tienda').value = $('e-tienda').value;
  mensajeAjuste('', '');
  if (!dlgAjuste.open) dlgAjuste.showModal();
  if (producto) elegirParaAjuste(producto);
  else pasoBuscar();
}

function ocultarSugerenciasAjuste() {
  sugeridosAjuste = [];
  activoAjuste = -1;
  $('ajuste-sugerencias').hidden = true;
  $('ajuste-sugerencias').replaceChildren();
  $('ajuste-codigo').removeAttribute('aria-activedescendant');
}

function pasoBuscar() {
  ajuste = null;
  $('ajuste-datos').hidden = true;
  $('ajuste-buscar').hidden = false;
  $('ajuste-codigo').value = '';
  ocultarSugerenciasAjuste();
  $('ajuste-codigo').focus();
}

function textoAhora(e, lugar) {
  const conteo = e?.[lugar];
  if (!conteo) return t('Sin contar todavía.');
  const desglose = textoDesglose(conteo, e.porPeso);
  const cantidad = desglose ? `${textoTotal(conteo.total, e.porPeso)} (${desglose})` : textoTotal(conteo.total, e.porPeso);
  return t('Ahora: {cantidad} · contado {cuando} por {quien}', { cantidad, cuando: cuando(conteo.contadoEn), quien: conteo.contadoPorNombre });
}

function pintarAhora() {
  const e = existenciaDe(ajuste.producto.id);
  for (const [x, lugar] of LUGARES_AJUSTE) $(`ajuste-${x}-ahora`).textContent = textoAhora(e, lugar);
}

const leerLugar = (x, porPeso) => conteoDesdeTexto(
  { cajas: $(`ajuste-${x}-cajas`).value, porCaja: $(`ajuste-${x}-porcaja`).value, sueltas: $(`ajuste-${x}-sueltas`).value },
  { porPeso },
);

function pintarTotalesAjuste() {
  if (!ajuste) return;
  const porPeso = esDePeso(ajuste.producto);
  for (const [x] of LUGARES_AJUSTE) {
    const salida = $(`ajuste-${x}-total`);
    try {
      const conteo = leerLugar(x, porPeso);
      delete salida.dataset.error;
      salida.textContent = conteo ? `= ${textoTotal(conteo.total, porPeso)}` : '';
    } catch (error) {
      salida.dataset.error = '';
      salida.textContent = error.message;
    }
  }
}

/**
 * Lo que el diálogo propone a partir del último conteo (id del campo → texto):
 * lo que trae cada caja (casi no cambia), la caducidad y el país. Lo propuesto
 * que nadie toca no se escribe: no pisa lo que otra persona guarde mientras tanto.
 */
function propuestosDe(producto) {
  const e = existenciaDe(producto.id);
  const porPeso = esDePeso(producto);
  const valores = { 'ajuste-caducidad': e?.caducidad ?? '', 'ajuste-origen': paisEnPantalla(e?.origen) ?? '' };
  for (const [x, lugar] of LUGARES_AJUSTE) {
    const porCaja = e?.[lugar]?.porCaja ?? e?.enTienda?.porCaja ?? e?.enBodega?.porCaja ?? null;
    valores[`ajuste-${x}-porcaja`] = Number.isInteger(porCaja) ? (porPeso ? textoKilos(porCaja) : String(porCaja)) : '';
  }
  return valores;
}

const cambiadoEnAjuste = (id) => $(id).value.trim() !== ajuste.propuesto[id];

/**
 * Llegó un conteo nuevo con el diálogo abierto (otra persona, otra tienda
 * elegida, o el propio guardado): se actualiza «Ahora» y lo propuesto que no
 * se ha tocado; lo que la persona ya escribió se respeta.
 */
function refrescarAjuste() {
  if (!ajuste || !dlgAjuste.open || $('ajuste-datos').hidden) return;
  for (const [id, valor] of Object.entries(propuestosDe(ajuste.producto))) {
    if (cambiadoEnAjuste(id)) continue;
    const x = /^ajuste-([tb])-porcaja$/.exec(id)?.[1];
    if (x && ($(`ajuste-${x}-cajas`).value.trim() || $(`ajuste-${x}-sueltas`).value.trim())) continue;
    $(id).value = valor;
    ajuste.propuesto[id] = valor;
  }
  pintarAhora();
  pintarTotalesAjuste();
}

function elegirParaAjuste(producto) {
  if (!$('ajuste-tienda').value) {
    mensajeAjuste('error', t('Elige la tienda.'));
    return;
  }
  ajuste = { producto, propuesto: propuestosDe(producto) };
  ocultarSugerenciasAjuste();
  const porPeso = esDePeso(producto);
  $('ajuste-buscar').hidden = true;
  $('ajuste-datos').hidden = false;
  $('ajuste-nombre').textContent = nombreCompleto(producto);
  $('ajuste-detalle').textContent = [
    producto.upc ?? (producto.plu ? `PLU ${producto.plu}` : ''), porPeso ? t('por kilo') : '', producto.activo === false ? t('inactivo') : '',
    tiendas.length > 1 ? nombreTienda($('ajuste-tienda').value) : '',
  ].filter(Boolean).join(' · ');
  for (const [x] of LUGARES_AJUSTE) {
    document.querySelector(`label[for="ajuste-${x}-cajas"]`).textContent = tc('bultos', 'Cajas');
    document.querySelector(`label[for="ajuste-${x}-porcaja"]`).textContent = porPeso ? t('Kilos por caja') : t('Piezas por caja');
    document.querySelector(`label[for="ajuste-${x}-sueltas"]`).textContent = porPeso ? t('Kilos sueltos') : t('Sueltas');
    $(`ajuste-${x}-porcaja`).inputMode = porPeso ? 'decimal' : 'numeric';
    $(`ajuste-${x}-sueltas`).inputMode = porPeso ? 'decimal' : 'numeric';
    $(`ajuste-${x}-cajas`).value = '';
    $(`ajuste-${x}-sueltas`).value = '';
  }
  for (const [id, valor] of Object.entries(ajuste.propuesto)) $(id).value = valor;
  pintarAhora();
  pintarTotalesAjuste();
  $('ajuste-t-cajas').focus();
}

function procesarAjuste(texto) {
  const codigo = String(texto ?? '').trim();
  if (codigo === '') return;
  mensajeAjuste('', '');
  if (/^\d{4,5}$/.test(codigo)) {
    const producto = elegir(porPLU.get(codigo));
    if (producto) elegirParaAjuste(producto);
    else mensajeAjuste('error', t('No hay ningún producto con el PLU {plu}.', { plu: codigo }));
    return;
  }
  if (/^\d+$/.test(codigo)) {
    let upc;
    try {
      upc = normalizarUPC(codigo);
    } catch (error) {
      mensajeAjuste('error', error.message);
      $('ajuste-codigo').select();
      return;
    }
    const producto = elegir(porUPC.get(upc));
    if (producto) {
      elegirParaAjuste(producto);
    } else {
      mensajeAjuste('error', t('El código {upc} no está en el catálogo: dalo de alta (Productos o Captura rápida) para poder contarlo.', { upc }));
      $('ajuste-codigo').select();
    }
    return;
  }
  const lista = activoAjuste >= 0 && sugeridosAjuste.length ? [sugeridosAjuste[activoAjuste]] : buscar(codigo);
  if (lista.length === 0) {
    mensajeAjuste('error', t('No se encontró «{codigo}» en el catálogo.', { codigo }));
    return;
  }
  elegirParaAjuste(lista[0]);
}

function pintarSugerenciasAjuste() {
  const lista = $('ajuste-sugerencias');
  lista.replaceChildren(...sugeridosAjuste.map((p, i) => h('li', {
    id: `ajuste-sugerencia-${i}`,
    role: 'option',
    class: 'recepcion__sugerencia',
    'aria-selected': String(i === activoAjuste),
    dataset: { indice: i },
  },
  h('strong', { text: [p.marca, p.nombre].filter(Boolean).join(' ') }),
  h('span', { class: 'secundario', text: [p.presentacion, p.upc ?? (p.plu ? `PLU ${p.plu}` : ''), esDePeso(p) ? t('por kilo') : '', p.activo === false ? t('inactivo') : ''].filter(Boolean).join(' · ') }))));
  lista.hidden = sugeridosAjuste.length === 0;
  if (activoAjuste >= 0) $('ajuste-codigo').setAttribute('aria-activedescendant', `ajuste-sugerencia-${activoAjuste}`);
  else $('ajuste-codigo').removeAttribute('aria-activedescendant');
}

$('ajuste-codigo').addEventListener('input', () => {
  const codigo = $('ajuste-codigo').value.trim();
  if (codigo.length < 2 || /^\d+$/.test(codigo)) {
    ocultarSugerenciasAjuste();
    return;
  }
  sugeridosAjuste = buscar(codigo);
  activoAjuste = sugeridosAjuste.length ? 0 : -1;
  pintarSugerenciasAjuste();
});
$('ajuste-codigo').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!sugeridosAjuste.length) return;
    e.preventDefault();
    activoAjuste = (activoAjuste + (e.key === 'ArrowDown' ? 1 : -1) + sugeridosAjuste.length) % sugeridosAjuste.length;
    pintarSugerenciasAjuste();
  }
});
$('ajuste-buscar').addEventListener('submit', (e) => {
  e.preventDefault();
  procesarAjuste($('ajuste-codigo').value);
});
$('ajuste-sugerencias').addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco
$('ajuste-sugerencias').addEventListener('click', (e) => {
  const opcion = e.target.closest('[data-indice]');
  const producto = opcion ? sugeridosAjuste[Number(opcion.dataset.indice)] : null;
  if (producto) elegirParaAjuste(producto);
});
$('ajuste-tienda').addEventListener('change', () => {
  $('e-tienda').value = $('ajuste-tienda').value;
  escucharExistencias();
  if (ajuste) elegirParaAjuste(ajuste.producto);
});
for (const [x] of LUGARES_AJUSTE) {
  for (const campo of ['cajas', 'porcaja', 'sueltas']) $(`ajuste-${x}-${campo}`).addEventListener('input', pintarTotalesAjuste);
}

/** «En la tienda: 40 piezas · En la bodega: 120 piezas» de lo que se guardó. */
function resumenAjuste(datos) {
  const partes = [];
  if (datos.enTienda) partes.push(t('En la tienda: {cantidad}', { cantidad: textoTotal(datos.enTienda.total, datos.porPeso) }));
  if (datos.enBodega) partes.push(t('En la bodega: {cantidad}', { cantidad: textoTotal(datos.enBodega.total, datos.porPeso) }));
  return partes.join(' · ');
}

$('ajuste-datos').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ajuste) return;
  // Con el escáner USB, un código escaneado en un campo de cantidad llega con Enter: no se guarda como cantidad.
  const enfocado = document.activeElement;
  if (enfocado?.matches?.('.ajuste__cuenta input') && /^\d{8,14}$/.test(enfocado.value.trim())) {
    enfocado.value = '';
    pintarTotalesAjuste();
    mensajeAjuste('error', t('Eso parece un código de barras: guarda este producto (o toca «Otro producto») antes de escanear el siguiente.'));
    return;
  }
  const porPeso = esDePeso(ajuste.producto);
  const contados = {};
  for (const [x, lugar] of LUGARES_AJUSTE) {
    try {
      contados[lugar] = leerLugar(x, porPeso);
    } catch (error) {
      mensajeAjuste('error', lugar === 'enTienda'
        ? t('En la tienda: {error}', { error: error.message })
        : t('En la bodega: {error}', { error: error.message }));
      $(`ajuste-${x}-cajas`).focus();
      return;
    }
  }
  let caducidad;
  try {
    caducidad = caducidadDesdeTexto($('ajuste-caducidad').value);
  } catch (error) {
    mensajeAjuste('error', error.message);
    $('ajuste-caducidad').focus();
    return;
  }
  const origen = origenDesdeTexto($('ajuste-origen').value);
  const cambioCaducidad = cambiadoEnAjuste('ajuste-caducidad');
  const cambioOrigen = cambiadoEnAjuste('ajuste-origen');
  if (!contados.enTienda && !contados.enBodega && !cambioCaducidad && !cambioOrigen) {
    mensajeAjuste('aviso', t('No hay nada que guardar: escribe cuántas hay, la fecha de caducidad o el país.'));
    $('ajuste-t-cajas').focus();
    return;
  }
  let armado;
  try {
    armado = armarAjuste({
      producto: ajuste.producto, tienda: $('ajuste-tienda').value, ...contados,
      caducidad: cambioCaducidad ? caducidad : undefined, origen: cambioOrigen ? origen : undefined,
    }, personal);
  } catch (error) {
    mensajeAjuste('error', error.message);
    return;
  }
  $('ajuste-guardar').disabled = true;
  const { promesa } = guardarAjuste(armado);
  promesa.catch((error) => avisar('error', t('El ajuste de {producto} no se guardó: {error}', { producto: armado.datos.nombre, error: mensajeError(error) })));
  try {
    const estado = await esperarConfirmacion(promesa);
    const resumen = resumenAjuste(armado.datos);
    const guardado = [t('Guardado: {producto}.', { producto: armado.datos.nombre }), resumen].filter(Boolean).join(' ');
    pasoBuscar();
    mensajeAjuste('ok', estado === 'pendiente' ? `${guardado} ${t('Sin señal: se enviará en cuanto vuelva.')}` : guardado);
  } catch (error) {
    mensajeAjuste('error', t('No se pudo guardar el ajuste: {error}', { error: mensajeError(error) }));
  } finally {
    $('ajuste-guardar').disabled = false;
  }
});

$('ajuste-otro').addEventListener('click', () => {
  mensajeAjuste('', '');
  pasoBuscar();
});
$('ajuste-cerrar').addEventListener('click', () => dlgAjuste.close());
dlgAjuste.addEventListener('close', () => {
  ajuste = null;
  ocultarSugerenciasAjuste();
});
$('btn-ajuste').addEventListener('click', () => abrirAjuste());
$('ajuste-camara').hidden = !camaraDisponible();
$('ajuste-camara').addEventListener('click', () => abrirCamara((texto) => {
  escaner.close();
  procesarAjuste(texto);
}));

// ===================================================================== arranque

$('contenido').hidden = false;
recuperarBorrador();
pintarLineas();

observarTiendas((lista) => {
  tiendas = lista;
  const actual = $('r-tienda').value || leer(TIENDA) || '';
  const activas = lista.filter((tienda) => tienda.activo !== false);
  $('r-tienda').replaceChildren(h('option', { value: '', text: t('Sin especificar') }), ...activas.map((tienda) => h('option', { value: tienda.id, text: tienda.nombre })));
  $('r-tienda').value = activas.some((tienda) => tienda.id === actual) ? actual : (activas.length === 1 ? activas[0].id : '');
  llenarTiendasExistencias();
  pintarHistorial();
}, () => {});

observarCatalogo(({ catalogo: mapa }) => {
  catalogo = mapa;
  indexar();
}, (error) => avisar('error', t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) })));

escuchar();
$('r-codigo').focus();
