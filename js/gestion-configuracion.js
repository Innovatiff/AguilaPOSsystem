/**
 * Back office · Configuración del POS (config/pos): impuesto, fondo sugerido,
 * límite de venta libre, conteo a ciegas, recibo y teclas de departamento.
 * Vista previa del recibo y de las teclas mientras se edita.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { h } from './dom.js';
import { observarConfigPos, guardarConfigPos } from './pos-datos.js';
import { observarTiendas } from './productos.js';
import { COLORES_DEPARTAMENTO, MAXIMO_DEPARTAMENTOS, configConDefectos, validarDepartamento } from './config-pos.js';
import { calcularTicket, lineaDeProducto, lineaDeDepartamento, registrarPago, armarVenta, puntosBaseDesdeTexto, formatearPorcentaje, folioVenta, claveDia } from './ticket.js';
import { centavosDesdeTexto, textoDesdeCentavos } from './precios.js';
import { normalizarTexto } from './esquema.js';
import { reciboVenta } from './recibo.js';
import { mostrarMensaje } from './bo.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'gestion/configuracion.html' });

const $ = (id) => document.getElementById(id);
/** Los mismos colores que las teclas de la caja (css/caja.css). */
const COLOR_TECLA = Object.freeze({ verde: '#2e7d4f', naranja: '#d26a12', rojo: '#b8322c', azul: '#2b5fb4', amarillo: '#b58a00', morado: '#6d43b3', turquesa: '#11808a', gris: '#59626e' });
const NOMBRE_COLOR = Object.freeze({ verde: 'Verde', naranja: 'Naranja', rojo: 'Rojo', azul: 'Azul', amarillo: 'Amarillo', morado: 'Morado', turquesa: 'Turquesa', gris: 'Gris' });

let guardada = null; // configuración tal como está en Firestore
let departamentos = []; // en edición
let tienda = null;
let sucio = false;

$('contenido').hidden = false;

// ------------------------------------------------------------- formulario ↔ datos

function identificadorDe(nombre, usados) {
  const base = normalizarTexto(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'depto';
  let id = base.length >= 2 ? base : `${base}-d`;
  for (let n = 2; usados.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

function cargarFormulario(config) {
  $('k-impuesto-nombre').value = config.impuestoNombre;
  $('k-tasa').value = formatearPorcentaje(config.tasaImpuestoBP).replace(' %', '');
  $('k-fondo').value = textoDesdeCentavos(config.fondoSugeridoCentavos);
  $('k-limite').value = textoDesdeCentavos(config.limiteVentaLibreCentavos);
  $('k-ciego').checked = config.conteoCiego;
  for (const radio of document.querySelectorAll('input[name="papel"]')) radio.checked = Number(radio.value) === config.papelRecibo;
  $('k-pie').value = config.reciboPie;
  departamentos = config.departamentos.map((d) => ({ ...d }));
  pintarDepartamentos();
}

function tasaDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (limpio === '0') return 0;
  const puntos = puntosBaseDesdeTexto(limpio);
  if (puntos > 3000) throw new Error('La tasa máxima es 30 %.');
  return puntos;
}

function montoDesdeTexto(texto, campo) {
  try {
    return centavosDesdeTexto(texto);
  } catch {
    throw new Error(`${campo}: escribe un monto, por ejemplo 150.00`);
  }
}

/** Lee el formulario; lanza Error con el mensaje si algo no es válido. */
function leerFormulario() {
  const impuestoNombre = $('k-impuesto-nombre').value.trim();
  if (!impuestoNombre) throw new Error('Escribe el nombre del impuesto (p. ej. HST).');
  let tasaImpuestoBP;
  try {
    tasaImpuestoBP = tasaDesdeTexto($('k-tasa').value);
  } catch (error) {
    throw new Error(`Tasa: ${error.message}`);
  }
  const datos = {
    impuestoNombre,
    tasaImpuestoBP,
    fondoSugeridoCentavos: montoDesdeTexto($('k-fondo').value, 'Fondo sugerido'),
    limiteVentaLibreCentavos: montoDesdeTexto($('k-limite').value, 'Límite de venta libre'),
    conteoCiego: $('k-ciego').checked,
    papelRecibo: Number(document.querySelector('input[name="papel"]:checked')?.value ?? 80),
    reciboPie: $('k-pie').value.trim(),
    departamentos: departamentos.map((d) => ({ id: d.id, nombre: d.nombre.trim(), claseFiscal: d.claseFiscal, color: d.color })),
  };
  if (datos.departamentos.length === 0) throw new Error('Deja al menos una tecla de departamento.');
  for (const [i, d] of datos.departamentos.entries()) {
    const errores = validarDepartamento(d);
    if (errores.length) throw new Error(`Departamento ${i + 1}: ${errores[0]}.`);
  }
  return datos;
}

// ------------------------------------------------------------- departamentos

function pintarDepartamentos() {
  $('deptos-contador').textContent = `${departamentos.length} de ${MAXIMO_DEPARTAMENTOS}`;
  $('btn-agregar-depto').disabled = departamentos.length >= MAXIMO_DEPARTAMENTOS;
  $('tabla-deptos').tBodies[0].replaceChildren(...departamentos.map((d, i) => {
    const nombre = h('input', { type: 'text', value: d.nombre, maxlength: 30, required: true, 'aria-label': `Nombre del departamento ${i + 1}` });
    nombre.addEventListener('input', () => {
      d.nombre = nombre.value;
      cambio();
    });
    const impuesto = h('select', { 'aria-label': `Impuesto del departamento ${i + 1}` },
      h('option', { value: 'gravado', text: 'Con impuesto (+Tx)', selected: d.claseFiscal === 'gravado' }),
      h('option', { value: 'tasaCero', text: 'Sin impuesto', selected: d.claseFiscal === 'tasaCero' }));
    impuesto.addEventListener('change', () => {
      d.claseFiscal = impuesto.value;
      cambio();
    });
    const muestra = h('span', { class: 'muestra-color muestra-color--grande', style: `background:${COLOR_TECLA[d.color]}` });
    const color = h('select', { 'aria-label': `Color del departamento ${i + 1}` }, COLORES_DEPARTAMENTO.map((c) => h('option', { value: c, text: NOMBRE_COLOR[c], selected: d.color === c })));
    color.addEventListener('change', () => {
      d.color = color.value;
      muestra.style.background = COLOR_TECLA[d.color];
      cambio();
    });
    const mover = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= departamentos.length) return;
      [departamentos[i], departamentos[j]] = [departamentos[j], departamentos[i]];
      pintarDepartamentos();
      cambio();
    };
    return h('tr', null,
      h('td', { class: 'orden' },
        h('button', { type: 'button', class: 'boton boton--pequeno', text: '↑', 'aria-label': 'Subir', disabled: i === 0, onclick: () => mover(-1) }),
        h('button', { type: 'button', class: 'boton boton--pequeno', text: '↓', 'aria-label': 'Bajar', disabled: i === departamentos.length - 1, onclick: () => mover(1) })),
      h('td', null, nombre, h('span', { class: 'secundario monoespaciada', text: d.id })),
      h('td', null, impuesto),
      h('td', { class: 'celda-color' }, muestra, color),
      h('td', null, h('button', {
        type: 'button',
        class: 'boton boton--pequeno',
        text: 'Quitar',
        onclick: () => {
          departamentos.splice(i, 1);
          pintarDepartamentos();
          cambio();
        },
      })));
  }));
}

$('btn-agregar-depto').addEventListener('click', () => {
  if (departamentos.length >= MAXIMO_DEPARTAMENTOS) return;
  const usados = new Set(departamentos.map((d) => d.id));
  const nombre = 'Nuevo departamento';
  departamentos.push({ id: identificadorDe(`${nombre}-${Date.now().toString(36).slice(-3)}`, usados), nombre, claseFiscal: 'gravado', color: 'gris' });
  pintarDepartamentos();
  cambio();
  const filas = $('tabla-deptos').tBodies[0].rows;
  filas[filas.length - 1]?.querySelector('input')?.select();
});

// ------------------------------------------------------------- vista previa

function pintarVista() {
  let config;
  try {
    config = configConDefectos(leerFormulario());
  } catch {
    config = configConDefectos(guardada);
  }
  const demo = [
    lineaDeProducto({ id: 'demo-1', upc: '633148100013', nombre: 'Clásico', marca: 'Tajín', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' }, { cantidad: 2 }),
    lineaDeProducto({ id: 'demo-2', plu: '4225', nombre: 'Aguacate', presentacion: '', precioCentavos: 100, unidadVenta: 'peso', precioPorKgCentavos: 549, claseFiscal: 'tasaCero' }, { pesoGramos: 1250 }),
    lineaDeDepartamento(config.departamentos[0], 350),
  ];
  const calculo = calcularTicket(demo, { tasaImpuestoBP: config.tasaImpuestoBP });
  const { pago } = registrarPago(calculo.totalCentavos, [], { metodo: 'efectivo', montoCentavos: Math.ceil(calculo.totalCentavos / 1000) * 1000 + 1000 });
  const ahora = new Date();
  const venta = armarVenta(calculo, [pago], {
    folio: folioVenta(ahora, 1, 42), numero: 42, dia: claveDia(ahora), tipo: 'venta', turno: 'demo', caja: 'demo', cajaNombre: 'Caja 1',
    numeroCaja: 1, tienda: tienda?.id ?? 'demo', tiendaNombre: tienda?.nombre ?? 'Águila Marketplace', cajero: '100123', cajeroNombre: 'María', fecha: ahora,
  });
  const recibo = reciboVenta(venta, { tienda, config });
  recibo.classList.add('recibo--vista');
  $('vista-recibo').replaceChildren(recibo);
  $('vista-deptos').replaceChildren(...config.departamentos.map((d) => h('span', {
    class: 'tecla-demo',
    style: `background:${COLOR_TECLA[d.color]}`,
  }, h('strong', { text: d.nombre }), h('small', { text: d.claseFiscal === 'gravado' ? `+${config.impuestoNombre}` : 'Sin impuesto' }))));
}

// ------------------------------------------------------------- guardar

function cambio() {
  sucio = true;
  $('k-estado').textContent = 'Cambios sin guardar';
  mostrarMensaje($('k-mensaje'), '', '');
  pintarVista();
}

$('form-config').addEventListener('input', (e) => {
  if (e.target.closest('#tabla-deptos')) return; // las filas avisan solas
  cambio();
});
$('form-config').addEventListener('change', (e) => {
  if (e.target.matches('input[type="radio"], input[type="checkbox"]')) cambio();
});

$('form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  let datos;
  try {
    datos = leerFormulario();
  } catch (error) {
    mostrarMensaje($('k-mensaje'), 'error', error.message);
    return;
  }
  $('k-guardar').disabled = true;
  try {
    await guardarConfigPos(datos, personal.usuario);
    sucio = false;
    $('k-estado').textContent = '';
    mostrarMensaje($('k-mensaje'), 'ok', 'Configuración guardada. Las cajas ya la están usando.');
  } catch (error) {
    mostrarMensaje($('k-mensaje'), 'error', `No se pudo guardar: ${mensajeError(error)}`);
  } finally {
    $('k-guardar').disabled = false;
  }
});

$('k-descartar').addEventListener('click', () => {
  cargarFormulario(configConDefectos(guardada));
  sucio = false;
  $('k-estado').textContent = '';
  mostrarMensaje($('k-mensaje'), '', '');
  pintarVista();
});

window.addEventListener('beforeunload', (e) => {
  if (sucio) e.preventDefault();
});

observarConfigPos((config, existe) => {
  guardada = existe ? config : null;
  if (!sucio) {
    cargarFormulario(config);
    pintarVista();
    if (!existe) $('k-estado').textContent = 'Valores de fábrica: guarda para fijarlos';
  }
}, (error) => mostrarMensaje($('k-mensaje'), 'error', `No se pudo leer la configuración: ${mensajeError(error)}`));

observarTiendas((lista) => {
  tienda = lista.find((t) => t.activo) ?? lista[0] ?? null;
  pintarVista();
}, () => {});
