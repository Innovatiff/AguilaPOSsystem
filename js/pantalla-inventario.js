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
 * Es la misma pantalla en el back office (Inventario) y en la app Catálogo
 * (Recibir mercancía, para el personal con permiso; sin anular).
 */
import { requerirPersonal, mensajeError, EN_CATALOGO } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarCatalogo, observarTiendas, esperarConfirmacion } from './productos.js';
import { registrarRecepcion, observarRecepciones, anularRecepcion } from './recepciones.js';
import {
  LIMITES_RECEPCION, piezasDesdeTexto, kilosDesdeTexto, textoKilos, separarMultiplicador, esDePeso, lineaDeRecepcion,
  lineaSinRegistrar, claveDeLinea, erroresDeLinea, armarRecepcion, textoCantidades, textoLinea, cumpleFiltrosRecepcion,
  lineasVisibles, resumirPorProducto, totalesRecepciones, filasCSVRecepciones,
} from './inventario.js';
import { coincideBusqueda } from './esquema.js';
import { formatearPeso } from './ticket.js';
import { normalizarUPC } from './upca.js';
import { camaraDisponible, abrirEscaner, mensajeCamara, confirmarLectura } from './escaner.js';
import {
  claveDia, sumarDias, inicioDia, diasEntre, chip, mostrarMensaje, descargarCSV, fechaHora, cuando, filaDato,
} from './bo.js';
import { t, numero } from './idioma.js';

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
const camara = { controles: null, abriendo: false, linterna: false };

function estadoCamara(texto, tipo = '') {
  $('escaner-estado').textContent = texto;
  $('escaner-estado').className = `escaner__estado${tipo ? ` escaner__estado--${tipo}` : ''}`;
}

$('btn-camara').hidden = !camaraDisponible();
$('btn-camara').addEventListener('click', async () => {
  if (camara.abriendo) return;
  camara.abriendo = true;
  $('escaner-linterna').hidden = true;
  estadoCamara(t('Iniciando cámara…'));
  if (!escaner.open) escaner.showModal();
  try {
    camara.controles = await abrirEscaner($('escaner-video'), {
      alDetectar: ({ texto }) => {
        confirmarLectura();
        procesar(texto);
        estadoCamara(t('Leído {codigo}. Apunta al siguiente o cierra.', { codigo: texto }), 'ok');
        if (pendienteNuevo || lineas[0]?.cantidad === null) escaner.close();
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
});
$('escaner-cerrar').addEventListener('click', () => escaner.close());
escaner.addEventListener('close', () => {
  camara.controles?.detener();
  camara.controles = null;
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
  pintarHistorial();
}, () => {});

observarCatalogo(({ catalogo: mapa }) => {
  catalogo = mapa;
  indexar();
}, (error) => avisar('error', t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) })));

escuchar();
$('r-codigo').focus();
