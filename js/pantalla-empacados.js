/**
 * Empacados en tienda (back office y app Catálogo): lo que se empaca aquí
 * (chicharrón de harina, chiles secos…) con su propio código de barras.
 *
 * Crear: nombre (en español, sin marca), precio, peso neto (g o kg), si lleva
 * impuesto, si es picante, procedencia y tiendas; al guardar se crea el
 * producto con un código nuevo (4…) y su empacados/{id}. El personal del
 * Catálogo los crea y les cambia el precio él mismo (solo a estos). Sin peso
 * neto (los guardados antes de que existiera) no se imprime hasta editarlo.
 *
 * Imprimir: fecha de empaque y cuántas etiquetas (5, 10, 20…); todas salen en
 * una sola impresión, una por etiqueta física. Al confirmar que salieron bien
 * se anota el precio impreso (como en Etiquetas).
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { t, locale } from './idioma.js';
import { observarCatalogo, observarTiendas, esperarConfirmacion, marcarImpresos } from './productos.js';
import { observarEmpacados, crearEmpacado, actualizarEmpacado } from './empacados.js';
import {
  nuevoCodigoEmpacado, armarEmpacado, cambiosEmpacado, cantidadEtiquetas, CANTIDADES_RAPIDAS, LIMITES_EMPACADO,
  textoPesoNeto, partesPesoNeto,
} from './empaque.js';
import { paisesSugeridos, paisEnPantalla } from './inventario.js';
import { formatearPrecio, indicadorFiscal, textoDesdeCentavos } from './precios.js';
import { renderEtiquetaEmpaque, ajustarEtiqueta } from './etiquetas.js';
import { normalizarTexto, fechaISOLocal } from './esquema.js';
import { chip, mostrarMensaje } from './bo.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'empacados.html' });

const $ = (id) => document.getElementById(id);
const avisar = (tipo, texto) => mostrarMensaje($('mensaje'), tipo, texto);
const avisarEnDialogo = (tipo, texto) => mostrarMensaje($('empacado-mensaje'), tipo, texto);
const dialogo = $('dlg-empacado');
const hoja = $('hoja');

let catalogo = new Map();
let empacados = new Map();
let tiendas = [];
let seleccionado = null; // id del producto cuyas etiquetas se imprimen
let editando = null; // id del producto que se edita (null: uno nuevo)
let impreso = null; // { id, nombre, precioCentavos, cantidad, fecha } esperando «¿salieron bien?»

const tiendasActivas = () => tiendas.filter((tienda) => tienda.activo !== false);
const nombreTienda = (id) => tiendas.find((tienda) => tienda.id === id)?.nombre ?? id;
const procedenciaEnPantalla = (p) => (p?.frase === 'producto'
  ? t('Producto de {pais}', { pais: paisEnPantalla(p.pais) ?? '' })
  : t('Hecho en {pais}', { pais: paisEnPantalla(p?.pais) ?? '' }));

/** Los empacados con su producto, ordenados por nombre. */
function listaEmpacados() {
  return [...empacados.values()]
    .map((e) => ({ empacado: e, producto: catalogo.get(e.id) }))
    .filter((x) => x.producto)
    .sort((a, b) => String(a.producto.nombre).localeCompare(String(b.producto.nombre), 'es'));
}

// ------------------------------------------------------------- la lista

function pintarLista() {
  const terminos = normalizarTexto($('buscar').value).split(' ').filter(Boolean);
  const todos = listaEmpacados();
  const filas = todos.filter(({ producto }) => {
    const texto = normalizarTexto(`${producto.nombre} ${producto.upc ?? ''}`);
    return terminos.every((termino) => texto.includes(termino));
  });
  $('contador').textContent = todos.length ? (todos.length === 1 ? t('{n} producto', { n: 1 }) : t('{n} productos', { n: todos.length })) : '';
  $('tabla-empacados').hidden = filas.length === 0;
  $('vacio').hidden = filas.length > 0;
  $('vacio').textContent = todos.length
    ? t('Nada con esa búsqueda.')
    : t('Todavía no hay productos empacados en tienda. Toca «Nuevo producto empacado» para crear el primero.');
  $('tabla-empacados').tBodies[0].replaceChildren(...filas.map(({ producto, empacado }) => h('tr', {
    tabindex: 0,
    dataset: { id: producto.id },
    class: producto.id === seleccionado ? 'fila--resaltada' : null,
  },
  h('td', null, producto.nombre,
    producto.activo === false ? [' ', chip(t('inactivo'), 'neutro')] : null,
    producto.pendiente || empacado.pendiente ? [' ', chip(t('Por enviar'), 'aviso')] : null),
  h('td', { class: 'num' }, textoPesoNeto(empacado.pesoNetoGramos) || chip(t('Sin peso'), 'aviso')),
  h('td', { class: 'num' }, `${formatearPrecio(producto.precioCentavos)} `, h('span', { class: 'secundario', text: indicadorFiscal(producto.claseFiscal) })),
  h('td', null, empacado.picante ? chip(t('Picante'), 'alerta') : t('No')),
  h('td', { text: procedenciaEnPantalla(empacado.procedencia) }),
  h('td', { class: 'monoespaciada', text: producto.upc ?? '—' }),
  h('td', { text: (producto.tiendas ?? []).map(nombreTienda).join(', ') || '—' }))));
}

function elegirDeTabla(e) {
  const fila = e.target.closest('tr[data-id]');
  if (fila) seleccionar(fila.dataset.id);
}
$('tabla-empacados').addEventListener('click', elegirDeTabla);
$('tabla-empacados').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') elegirDeTabla(e);
});
$('buscar').addEventListener('input', pintarLista);

// ------------------------------------------------------------- imprimir

function seleccionar(id) {
  seleccionado = id;
  impreso = null;
  $('confirmacion').hidden = true;
  $('panel-imprimir').hidden = false;
  if (!$('i-fecha').value) $('i-fecha').value = fechaISOLocal();
  pintarImpresion();
  pintarLista();
  $('panel-imprimir').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('i-cantidad').focus();
  $('i-cantidad').select();
}

/** La etiqueta de muestra (con la fecha elegida) y el texto del botón. */
function pintarImpresion() {
  const producto = catalogo.get(seleccionado);
  const empacado = empacados.get(seleccionado);
  if (!producto || !empacado) {
    $('panel-imprimir').hidden = true;
    return;
  }
  $('i-nombre').textContent = producto.nombre;
  const peso = textoPesoNeto(empacado.pesoNetoGramos);
  $('i-detalle').textContent = ` · ${[peso, `${formatearPrecio(producto.precioCentavos)} ${indicadorFiscal(producto.claseFiscal)}`, producto.upc].filter(Boolean).join(' · ')}`;
  // Sin peso neto no se imprime: la etiqueta lo debe llevar (se agrega en «Editar producto»).
  $('i-sin-peso').hidden = Boolean(peso);
  $('btn-imprimir').disabled = !peso;
  let n = null;
  try {
    n = cantidadEtiquetas($('i-cantidad').value);
  } catch {
    // se avisa al imprimir
  }
  $('btn-imprimir').textContent = n === 1 ? t('Imprimir 1 etiqueta') : t('Imprimir {n} etiquetas', { n: n ?? '…' });
  const vista = $('vista-etiqueta');
  try {
    const etiqueta = renderEtiquetaEmpaque(producto, empacado, $('i-fecha').value);
    vista.replaceChildren(etiqueta);
    ajustarEtiqueta(etiqueta);
  } catch (error) {
    vista.replaceChildren(h('p', { class: 'nota', text: error.message }));
  }
}

$('cantidades-rapidas').replaceChildren(...CANTIDADES_RAPIDAS.map((n) => h('button', {
  type: 'button', class: 'boton boton--secundario', dataset: { cantidad: n }, text: String(n),
})));
$('cantidades-rapidas').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-cantidad]');
  if (!boton) return;
  $('i-cantidad').value = boton.dataset.cantidad;
  pintarImpresion();
  $('btn-imprimir').focus();
});
$('i-cantidad').addEventListener('input', pintarImpresion);
$('i-fecha').addEventListener('input', pintarImpresion);
$('btn-cerrar-impresion').addEventListener('click', () => {
  seleccionado = null;
  $('panel-imprimir').hidden = true;
  pintarLista();
});
$('btn-editar').addEventListener('click', () => abrirEditor(seleccionado));

$('form-imprimir').addEventListener('submit', (e) => {
  e.preventDefault();
  const producto = catalogo.get(seleccionado);
  if (!producto || $('btn-imprimir').disabled) return;
  let cantidad;
  try {
    cantidad = cantidadEtiquetas($('i-cantidad').value);
  } catch (error) {
    avisar('error', error.message);
    $('i-cantidad').focus();
    return;
  }
  const muestra = $('vista-etiqueta').querySelector('.etiqueta');
  if (!muestra) {
    avisar('error', t('Elige la fecha de empaque.'));
    $('i-fecha').focus();
    return;
  }
  // La muestra ya está ajustada a su ancho: cada etiqueta es una copia exacta, cada una en su hoja.
  hoja.replaceChildren(...Array.from({ length: cantidad }, () => h('div', { class: 'hoja-etiquetas__pagina' }, muestra.cloneNode(true))));
  impreso = { id: producto.id, nombre: producto.nombre, precioCentavos: producto.precioCentavos, cantidad, fecha: $('i-fecha').value };
  avisar('', '');
  $('confirmacion').hidden = true;
  window.addEventListener('afterprint', preguntarSiSalieron, { once: true });
  window.print();
});

function preguntarSiSalieron() {
  if (!impreso) return;
  $('confirmacion-texto').textContent = impreso.cantidad === 1
    ? t('¿Salió bien la etiqueta de {nombre}?', { nombre: impreso.nombre })
    : t('¿Salieron bien las {n} etiquetas de {nombre}?', { n: impreso.cantidad, nombre: impreso.nombre });
  $('confirmacion').hidden = false;
  $('btn-confirmar').focus();
}

$('btn-confirmar').addEventListener('click', async () => {
  if (!impreso) return;
  const { id, nombre, precioCentavos, cantidad } = impreso;
  impreso = null;
  $('confirmacion').hidden = true;
  // Como en Etiquetas: queda anotado el precio que salió impreso.
  const { promesa } = marcarImpresos([{ id, precioCentavos }], personal.usuario);
  promesa.catch((error) => avisar('error', t('No se pudo registrar la impresión: {error}', { error: mensajeError(error) })));
  avisar('ok', cantidad === 1 ? t('Listo: 1 etiqueta de {nombre}.', { nombre }) : t('Listo: {n} etiquetas de {nombre}.', { n: cantidad, nombre }));
  hoja.replaceChildren();
  $('i-cantidad').focus();
});
$('btn-rechazar').addEventListener('click', () => {
  $('confirmacion').hidden = true;
  $('btn-imprimir').focus();
});

// ------------------------------------------------------------- crear y editar

function pintarTiendasDelEditor(elegidas) {
  const activas = tiendasActivas();
  const caja = $('e-tiendas');
  caja.replaceChildren(h('legend', { text: t('¿En qué tiendas se vende?') }),
    ...activas.map((tienda) => h('label', null,
      h('input', { type: 'checkbox', value: tienda.id, checked: elegidas.includes(tienda.id) }), ` ${tienda.nombre}`)));
  if (activas.length === 0) caja.append(h('span', { class: 'nota', text: t('Primero da de alta una tienda (Administración → Tiendas).') }));
}

const marcado = (nombre) => document.querySelector(`input[name="${nombre}"]:checked`)?.value ?? null;
function marcar(nombre, valor) {
  for (const radio of document.querySelectorAll(`input[name="${nombre}"]`)) radio.checked = radio.value === valor;
}

function abrirEditor(id = null) {
  editando = id;
  const producto = id ? catalogo.get(id) : null;
  const empacado = id ? empacados.get(id) : null;
  if (id && (!producto || !empacado)) return;
  avisarEnDialogo('', '');
  $('empacado-titulo').textContent = producto ? t('Editar producto empacado') : t('Nuevo producto empacado');
  $('e-nombre').value = producto?.nombre ?? '';
  $('e-precio').value = producto ? textoDesdeCentavos(producto.precioCentavos) : '';
  marcar('e-impuesto', producto?.claseFiscal ?? null);
  marcar('e-picante', empacado ? (empacado.picante ? 'si' : 'no') : null);
  marcar('e-frase', empacado?.procedencia?.frase ?? 'hecho');
  const peso = partesPesoNeto(empacado?.pesoNetoGramos);
  $('e-peso').value = peso.texto;
  $('e-peso-unidad').value = peso.unidad;
  $('e-pais').value = empacado ? (paisEnPantalla(empacado.procedencia?.pais) ?? '') : '';
  const activas = tiendasActivas().map((tienda) => tienda.id);
  const propias = activas.includes(personal.tienda) ? [personal.tienda] : activas;
  pintarTiendasDelEditor(producto ? (producto.tiendas ?? []) : propias);
  $('e-codigo-nota').textContent = producto
    ? t('Código de barras: {codigo} (no cambia).', { codigo: producto.upc })
    : t('Al guardar se crea su código de barras.');
  $('empacado-guardar').textContent = producto ? t('Guardar') : t('Guardar e imprimir etiquetas');
  $('lista-paises').replaceChildren(...[...paisesSugeridos()].sort((a, b) => a.localeCompare(b, locale())).map((p) => h('option', { value: p })));
  if (!dialogo.open) dialogo.showModal();
  $('e-nombre').focus();
}

$('btn-nuevo').addEventListener('click', () => abrirEditor(null));
$('empacado-cerrar').addEventListener('click', () => dialogo.close());

$('form-empacado').addEventListener('submit', async (e) => {
  e.preventDefault();
  let armado;
  try {
    armado = armarEmpacado({
      nombre: $('e-nombre').value,
      precio: $('e-precio').value,
      claseFiscal: marcado('e-impuesto'),
      picante: { si: true, no: false }[marcado('e-picante')] ?? null,
      frase: marcado('e-frase'),
      pais: $('e-pais').value,
      peso: $('e-peso').value,
      unidadPeso: $('e-peso-unidad').value,
      tiendas: [...$('e-tiendas').querySelectorAll('input:checked')].map((casilla) => casilla.value),
    });
  } catch (error) {
    avisarEnDialogo('error', error.message);
    return;
  }
  $('empacado-guardar').disabled = true;
  try {
    if (editando) await guardarCambios(armado);
    else await crearNuevo(armado);
  } finally {
    $('empacado-guardar').disabled = false;
  }
});

async function crearNuevo(armado) {
  const ocupados = new Set([...catalogo.values()].map((p) => p.upc).filter(Boolean));
  let creado;
  try {
    creado = crearEmpacado({ ...armado, upc: nuevoCodigoEmpacado(ocupados) }, personal.usuario);
  } catch (error) {
    avisarEnDialogo('error', error.message);
    return;
  }
  creado.promesa.catch((error) => avisar('error', t('No se guardó «{nombre}»: {error}', { nombre: armado.producto.nombre, error: mensajeError(error) })));
  try {
    const estado = await esperarConfirmacion(creado.promesa);
    dialogo.close();
    const listo = t('Listo: «{nombre}» con su código {codigo}. Ahora imprime sus etiquetas.', { nombre: creado.producto.nombre, codigo: creado.producto.upc });
    avisar('ok', estado === 'pendiente' ? `${listo} ${t('Sin señal: se enviará en cuanto vuelva.')}` : listo);
    // Mientras llega del catálogo en vivo, se imprime con lo que se acaba de guardar.
    if (!catalogo.has(creado.id)) catalogo.set(creado.id, creado.producto);
    if (!empacados.has(creado.id)) empacados.set(creado.id, { id: creado.id, ...armado.empacado });
    seleccionar(creado.id);
  } catch (error) {
    avisarEnDialogo('error', t('No se guardó «{nombre}»: {error}', { nombre: armado.producto.nombre, error: mensajeError(error) }));
  }
}

async function guardarCambios(armado) {
  const actual = catalogo.get(editando);
  const cambios = cambiosEmpacado(actual, empacados.get(editando), armado);
  if (Object.keys(cambios.cambiosProducto).length === 0 && !cambios.empacado) {
    dialogo.close();
    return;
  }
  const { promesa } = actualizarEmpacado({ actual, ...cambios }, personal.usuario);
  promesa.catch((error) => avisar('error', t('No se guardó «{nombre}»: {error}', { nombre: armado.producto.nombre, error: mensajeError(error) })));
  try {
    const estado = await esperarConfirmacion(promesa);
    dialogo.close();
    const listo = t('Guardado: {nombre}.', { nombre: armado.producto.nombre });
    avisar('ok', estado === 'pendiente' ? `${listo} ${t('Sin señal: se enviará en cuanto vuelva.')}` : listo);
    if (seleccionado === actual.id) pintarImpresion();
  } catch (error) {
    avisarEnDialogo('error', t('No se guardó «{nombre}»: {error}', { nombre: armado.producto.nombre, error: mensajeError(error) }));
  }
}

// ------------------------------------------------------------- arranque

$('contenido').hidden = false;
$('i-fecha').value = fechaISOLocal();
$('e-pais').maxLength = LIMITES_EMPACADO.pais;

observarCatalogo(({ catalogo: mapa, desdeCache }) => {
  catalogo = mapa;
  $('estado-catalogo').hidden = !(desdeCache && mapa.size === 0);
  pintarLista();
  if (seleccionado) pintarImpresion();
}, (error) => avisar('error', t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) })));

observarEmpacados((mapa) => {
  empacados = mapa;
  pintarLista();
  if (seleccionado) pintarImpresion();
}, (error) => avisar('error', t('No se pudieron cargar los empacados: {error}', { error: mensajeError(error) })));

observarTiendas((lista) => {
  tiendas = lista;
  pintarLista();
}, () => {});
