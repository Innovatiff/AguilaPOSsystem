/**
 * Impresión por lotes: etiquetas pendientes agrupadas por tienda, selección,
 * vista previa, una sola impresión y registro del precio impreso solo para
 * las etiquetas que realmente salieron.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarCatalogo, observarTiendas, marcarImpresos, esperarConfirmacion } from './productos.js';
import { pendienteImpresion, agruparPorTienda, coincideBusqueda, pareceUPC } from './esquema.js';
import { normalizarUPC } from './upca.js';
import { formatearPrecio, indicadorFiscal } from './precios.js';
import { renderEtiqueta, ajustarEtiqueta } from './etiquetas.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'imprimir.html' });

const $ = (id) => document.getElementById(id);
const grupos = $('grupos');
const contador = $('contador');
const btnVista = $('btn-vista');
const seleccionSeccion = $('seleccion');
const vistaSeccion = $('vista');
const hoja = $('hoja');
const confirmacion = $('confirmacion');
const agregar = $('agregar');
const sugerencias = $('sugerencias');

const SIN_TIENDA = 'sin-tienda';
const MANUAL = 'manual';

let catalogo = new Map();
let tiendas = [];
const seleccion = new Set(); // claves "grupo|productId"
const manuales = new Map(); // productId → true (añadidos a mano)
let impresion = null; // instantánea de lo que se mandó a imprimir
let modo = 'seleccion';
let temporizadorSugerencias = null;

const clave = (grupo, id) => `${grupo}|${id}`;
const nombreCompleto = (p) => [p.marca, p.nombre].filter(Boolean).join(' ');
const precioTexto = (p) => `${formatearPrecio(p.precioCentavos)}${indicadorFiscal(p.claseFiscal)}`;

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// ------------------------------------------------------------- datos
observarCatalogo(
  ({ catalogo: mapa, desdeCache, pendientes }) => {
    catalogo = mapa;
    const origen = desdeCache ? (pendientes ? 'datos locales, con cambios por enviar' : 'datos locales') : 'sincronizado';
    $('estado-catalogo').textContent = `${mapa.size} producto${mapa.size === 1 ? '' : 's'} · ${origen}`;
    if (modo === 'seleccion') pintarSeleccion();
  },
  (error) => avisar(`No se pudo cargar el catálogo: ${mensajeError(error)}`, 'error', 0),
);

observarTiendas(
  (lista) => {
    tiendas = lista;
    if (modo === 'seleccion') pintarSeleccion();
  },
  (error) => avisar(`No se pudieron cargar las tiendas: ${mensajeError(error)}`, 'error', 0),
);

$('contenido').hidden = false;

/** Grupos a mostrar: pendientes por tienda + añadidos a mano. */
function calcularGrupos() {
  const pendientes = [...catalogo.values()].filter(pendienteImpresion);
  const lista = agruparPorTienda(pendientes, tiendas).map((g) => ({
    id: g.tienda ? g.tienda.id : SIN_TIENDA,
    titulo: g.tienda ? g.tienda.nombre : 'Sin tienda asignada',
    productos: g.productos,
  }));
  const aMano = [...manuales.keys()].map((id) => catalogo.get(id)).filter((p) => p && p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (aMano.length > 0) lista.push({ id: MANUAL, titulo: 'Añadidos a mano', productos: aMano });
  return lista;
}

function clavesDisponibles() {
  const claves = new Set();
  for (const grupo of calcularGrupos()) for (const p of grupo.productos) claves.add(clave(grupo.id, p.id));
  return claves;
}

// ------------------------------------------------------------- selección
function pintarSeleccion() {
  const lista = calcularGrupos();
  const disponibles = new Set();
  for (const grupo of lista) for (const p of grupo.productos) disponibles.add(clave(grupo.id, p.id));
  for (const c of [...seleccion]) if (!disponibles.has(c)) seleccion.delete(c);

  grupos.replaceChildren(...lista.map(seccionGrupo));
  $('sin-pendientes').hidden = lista.length > 0;
  actualizarContador();
}

function seccionGrupo(grupo) {
  const seccion = crear('section', 'grupo');
  seccion.dataset.grupo = grupo.id;
  const titulo = crear('h2', 'grupo__titulo');
  titulo.append(crear('span', '', grupo.titulo), crear('span', 'contador', `${grupo.productos.length} etiqueta${grupo.productos.length === 1 ? '' : 's'}`));
  const todas = crear('label', 'casilla');
  const casillaTodas = document.createElement('input');
  casillaTodas.type = 'checkbox';
  casillaTodas.className = 'todas';
  const marcadas = grupo.productos.filter((p) => seleccion.has(clave(grupo.id, p.id))).length;
  casillaTodas.checked = marcadas === grupo.productos.length;
  casillaTodas.indeterminate = marcadas > 0 && marcadas < grupo.productos.length;
  casillaTodas.addEventListener('change', () => {
    for (const p of grupo.productos) {
      if (casillaTodas.checked) seleccion.add(clave(grupo.id, p.id));
      else seleccion.delete(clave(grupo.id, p.id));
    }
    pintarSeleccion();
  });
  todas.append(casillaTodas, ' Todas');
  titulo.append(todas);
  seccion.append(titulo);

  const tabla = crear('table', 'tabla tabla--seleccion');
  const cabeza = crear('thead');
  const filaCabeza = crear('tr');
  for (const t of ['', 'Producto', 'Código', 'Precio actual', 'Última etiqueta', '']) filaCabeza.append(crear('th', '', t));
  cabeza.append(filaCabeza);
  const cuerpo = crear('tbody');
  for (const p of grupo.productos) cuerpo.append(filaProducto(grupo, p));
  tabla.append(cabeza, cuerpo);
  seccion.append(tabla);
  return seccion;
}

function filaProducto(grupo, p) {
  const c = clave(grupo.id, p.id);
  const tr = crear('tr');
  const celdaCasilla = crear('td');
  const casilla = document.createElement('input');
  casilla.type = 'checkbox';
  casilla.checked = seleccion.has(c);
  casilla.setAttribute('aria-label', `Imprimir ${nombreCompleto(p)}`);
  casilla.addEventListener('change', () => {
    if (casilla.checked) seleccion.add(c);
    else seleccion.delete(c);
    pintarSeleccion();
  });
  celdaCasilla.append(casilla);

  const nombre = crear('td');
  nombre.append(crear('strong', '', p.nombre));
  const secundario = [p.marca, p.presentacion].filter(Boolean).join(' · ');
  if (secundario) nombre.append(crear('span', 'secundario', secundario));

  const ultima = p.ultimoPrecioImpresoCentavos == null
    ? 'Nunca impresa'
    : `${formatearPrecio(p.ultimoPrecioImpresoCentavos)} · ${p.fechaUltimaImpresion ?? '—'}`;
  const acciones = crear('td');
  if (grupo.id === MANUAL) {
    const quitar = crear('button', 'boton boton--pequeno', 'Quitar');
    quitar.type = 'button';
    quitar.addEventListener('click', (evento) => {
      evento.stopPropagation();
      manuales.delete(p.id);
      seleccion.delete(c);
      pintarSeleccion();
    });
    acciones.append(quitar);
  }
  tr.append(celdaCasilla, nombre, crear('td', '', p.upc ?? (p.plu ? `PLU ${p.plu}` : '—')), crear('td', '', precioTexto(p)), crear('td', '', ultima), acciones);
  tr.addEventListener('click', (evento) => {
    if (evento.target === casilla || evento.target.tagName === 'BUTTON') return;
    casilla.checked = !casilla.checked;
    casilla.dispatchEvent(new Event('change'));
  });
  return tr;
}

function actualizarContador() {
  const n = seleccion.size;
  contador.textContent = `${n} etiqueta${n === 1 ? '' : 's'} seleccionada${n === 1 ? '' : 's'}`;
  btnVista.disabled = n === 0;
}

$('btn-todo').addEventListener('click', () => {
  for (const c of clavesDisponibles()) seleccion.add(c);
  pintarSeleccion();
});
$('btn-nada').addEventListener('click', () => {
  seleccion.clear();
  pintarSeleccion();
});

// ------------------------------------------------------------- añadir a mano
function anadirManual(producto) {
  if (!producto.activo) {
    avisar(`«${nombreCompleto(producto)}» está inactivo; reactívalo en Productos antes de imprimirlo.`, 'error');
    return;
  }
  manuales.set(producto.id, true);
  seleccion.add(clave(MANUAL, producto.id));
  agregar.value = '';
  sugerencias.hidden = true;
  pintarSeleccion();
  avisar(`«${nombreCompleto(producto)}» añadido a la impresión.`, 'ok', 2500);
  agregar.focus();
}

function candidatos(texto) {
  return [...catalogo.values()]
    .filter((p) => p.activo && coincideBusqueda(p, texto))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, 8);
}

function pintarSugerencias() {
  const texto = agregar.value.trim();
  if (texto === '' || pareceUPC(texto)) {
    sugerencias.hidden = true;
    return;
  }
  const lista = candidatos(texto);
  sugerencias.replaceChildren(
    ...(lista.length === 0
      ? [crear('span', 'nota', 'Sin coincidencias.')]
      : lista.map((p) => {
        const b = crear('button', 'boton boton--pequeno', `${nombreCompleto(p)} · ${precioTexto(p)}`);
        b.type = 'button';
        b.addEventListener('click', () => anadirManual(p));
        return b;
      })),
  );
  sugerencias.hidden = false;
}

agregar.addEventListener('input', () => {
  clearTimeout(temporizadorSugerencias);
  temporizadorSugerencias = setTimeout(pintarSugerencias, 120);
});

agregar.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') {
    agregar.value = '';
    sugerencias.hidden = true;
    return;
  }
  if (evento.key !== 'Enter') return;
  evento.preventDefault();
  const texto = agregar.value.trim();
  if (texto === '') return;
  if (pareceUPC(texto)) {
    let codigo;
    try {
      codigo = normalizarUPC(texto);
    } catch (error) {
      avisar(error.message, 'error');
      agregar.select();
      return;
    }
    const producto = [...catalogo.values()].find((p) => p.upc === codigo);
    if (!producto) {
      avisar(`No hay ningún producto con el UPC ${codigo}. Créalo en Productos.`, 'error');
      agregar.select();
      return;
    }
    anadirManual(producto);
    return;
  }
  const lista = candidatos(texto);
  if (lista.length === 0) {
    avisar(`Sin coincidencias para «${texto}».`, 'error');
    return;
  }
  anadirManual(lista[0]);
});

// ------------------------------------------------------------- vista previa e impresión
function ordenSeleccion() {
  const items = [];
  for (const grupo of calcularGrupos()) {
    for (const p of grupo.productos) {
      const c = clave(grupo.id, p.id);
      if (seleccion.has(c)) items.push({ clave: c, grupo: grupo.id, producto: { ...p, tiendas: [...p.tiendas] } });
    }
  }
  return items;
}

function mostrarVista() {
  const items = ordenSeleccion();
  if (items.length === 0) return;
  impresion = items;
  // Primero se muestra la sección: los textos solo pueden ajustarse a su
  // ancho cuando la etiqueta ya tiene medidas en pantalla.
  modo = 'vista';
  confirmacion.hidden = true;
  seleccionSeccion.hidden = true;
  vistaSeccion.hidden = false;
  hoja.replaceChildren();
  let fallidas = 0;
  for (const item of items) {
    try {
      const etiqueta = renderEtiqueta(item.producto);
      etiqueta.dataset.id = item.producto.id;
      hoja.append(etiqueta);
    } catch (error) {
      fallidas += 1;
      console.error('Etiqueta no generada', item.producto.id, error);
    }
  }
  for (const etiqueta of hoja.querySelectorAll('.etiqueta')) ajustarEtiqueta(etiqueta);
  if (fallidas > 0) avisar(`${fallidas} etiqueta${fallidas === 1 ? '' : 's'} no se pudo generar; revisa el UPC de esos productos.`, 'error', 0);
  $('titulo-vista').textContent = `Vista previa · ${hoja.childElementCount} etiqueta${hoja.childElementCount === 1 ? '' : 's'}`;
  $('btn-imprimir').focus();
}

function volverASeleccion() {
  modo = 'seleccion';
  impresion = null;
  vistaSeccion.hidden = true;
  seleccionSeccion.hidden = false;
  pintarSeleccion();
  btnVista.focus();
}

function imprimir() {
  if (modo !== 'vista' || !impresion) return;
  confirmacion.hidden = true;
  window.addEventListener('afterprint', pedirConfirmacion, { once: true });
  window.print();
}

function pedirConfirmacion() {
  if (modo !== 'vista' || !impresion) return;
  modo = 'confirmar';
  const n = hoja.childElementCount;
  $('confirmacion-texto').textContent = `¿Salieron bien las ${n} etiqueta${n === 1 ? '' : 's'}? Al confirmar se registra el precio impreso de cada producto.`;
  confirmacion.hidden = false;
  $('btn-confirmar').focus();
}

async function confirmarImpresion() {
  if (modo !== 'confirmar' || !impresion) return;
  const items = impresion.filter((i) => hoja.querySelector(`.etiqueta[data-id="${i.producto.id}"]`)).map((i) => ({ id: i.producto.id, precioCentavos: i.producto.precioCentavos }));
  $('btn-confirmar').disabled = true;
  try {
    const { promesa, cantidad, fecha } = marcarImpresos(items, personal.usuario);
    promesa.catch(() => {});
    const resultado = await esperarConfirmacion(promesa, 4000);
    if (resultado === 'pendiente') promesa.catch((error) => avisar(`No se pudo registrar la impresión: ${mensajeError(error)}`, 'error', 0));
    avisar(
      resultado === 'confirmado'
        ? `${cantidad} producto${cantidad === 1 ? '' : 's'} marcado${cantidad === 1 ? '' : 's'} como impreso${cantidad === 1 ? '' : 's'} (${fecha}).`
        : `${cantidad} producto${cantidad === 1 ? '' : 's'} marcado${cantidad === 1 ? '' : 's'} en este equipo; se enviará al recuperar la señal.`,
      resultado === 'confirmado' ? 'ok' : 'info',
      6000,
    );
    for (const i of impresion) {
      seleccion.delete(i.clave);
      if (i.grupo === MANUAL) manuales.delete(i.producto.id);
    }
    volverASeleccion();
  } catch (error) {
    avisar(`No se pudo registrar la impresión: ${mensajeError(error)}`, 'error', 0);
    modo = 'confirmar';
  } finally {
    $('btn-confirmar').disabled = false;
  }
}

function rechazarImpresion() {
  confirmacion.hidden = true;
  modo = 'vista';
  $('btn-imprimir').focus();
}

btnVista.addEventListener('click', mostrarVista);
$('btn-volver').addEventListener('click', volverASeleccion);
$('btn-imprimir').addEventListener('click', imprimir);
$('btn-confirmar').addEventListener('click', confirmarImpresion);
$('btn-rechazar').addEventListener('click', rechazarImpresion);

document.addEventListener('keydown', (evento) => {
  const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (evento.altKey && !evento.ctrlKey && evento.key.toLowerCase() === 'a' && modo === 'seleccion') {
    evento.preventDefault();
    $('btn-todo').click();
  } else if (evento.altKey && !evento.ctrlKey && evento.key.toLowerCase() === 'p') {
    evento.preventDefault();
    if (modo === 'seleccion') mostrarVista();
    else if (modo === 'vista') imprimir();
  } else if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'p') {
    // Ctrl+P: no imprimir la pantalla de selección; llevar al flujo correcto.
    evento.preventDefault();
    if (modo === 'seleccion') mostrarVista();
    else if (modo === 'vista') imprimir();
  } else if (evento.key === 'Escape' && !enCampo) {
    if (modo === 'confirmar') rechazarImpresion();
    else if (modo === 'vista') volverASeleccion();
  }
});
