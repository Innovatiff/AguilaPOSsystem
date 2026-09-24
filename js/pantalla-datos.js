/**
 * Importar / exportar el catálogo en CSV (solo administradores).
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarCatalogo, importarPlan } from './productos.js';
import { exportarCatalogo, plantillaCSV, nombreArchivoExportacion, deCSV, planificarImportacion } from './csv.js';
import { formatearPrecio } from './precios.js';

const { personal } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal, activa: 'datos.html' });

const $ = (id) => document.getElementById(id);
const archivo = $('archivo');
const seccionPlan = $('plan');
const btnImportar = $('btn-importar');
const progreso = $('progreso');
const MAXIMO_FILAS_VISTA = 50;

let catalogo = new Map();
let catalogoListo = false;
let plan = null;
let importando = false;

observarCatalogo(
  ({ catalogo: mapa, desdeCache, pendientes }) => {
    catalogo = mapa;
    catalogoListo = !desdeCache || mapa.size > 0;
    const origen = desdeCache ? (pendientes ? 'datos locales, con cambios por enviar' : 'datos locales') : 'sincronizado';
    $('estado-catalogo').textContent = `${mapa.size} producto${mapa.size === 1 ? '' : 's'} · ${origen}`;
  },
  (error) => avisar(`No se pudo cargar el catálogo: ${mensajeError(error)}`, 'error', 0),
);
$('contenido').hidden = false;

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function descargar(nombre, contenido) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------- exportar
$('btn-exportar').addEventListener('click', () => {
  if (!catalogoListo) {
    avisar('El catálogo todavía no termina de cargar.', 'error');
    return;
  }
  const productos = [...catalogo.values()];
  descargar(nombreArchivoExportacion(), exportarCatalogo(productos));
  avisar(`Exportados ${productos.length} productos.`, 'ok');
});

$('btn-plantilla').addEventListener('click', () => descargar('plantilla-catalogo-aguila.csv', plantillaCSV()));

// ------------------------------------------------------------- importar
archivo.addEventListener('change', async () => {
  const [seleccionado] = archivo.files;
  if (!seleccionado) return;
  try {
    const texto = await seleccionado.text();
    const leido = deCSV(texto);
    plan = planificarImportacion(leido, catalogo, personal.email);
    pintarPlan(seleccionado.name, leido);
  } catch (error) {
    avisar(`No se pudo leer el archivo: ${error.message}`, 'error', 0);
  }
});

function describirCambios(cambios) {
  return Object.entries(cambios).map(([campo, valor]) => {
    if (campo.endsWith('Centavos') && Number.isInteger(valor)) return `${campo} → ${formatearPrecio(valor)}`;
    if (Array.isArray(valor)) return `${campo} → ${valor.join('|') || '(ninguna)'}`;
    return `${campo} → ${valor === null ? '(vacío)' : String(valor)}`;
  }).join(' · ');
}

function pintarPlan(nombreArchivo, leido) {
  seccionPlan.hidden = false;
  progreso.hidden = true;
  const total = plan.crear.length + plan.actualizar.length;
  $('plan-resumen').textContent =
    `${nombreArchivo}: ${leido.filas.length} filas. ` +
    `Crear ${plan.crear.length} · actualizar ${plan.actualizar.length} · sin cambios ${plan.sinCambios} · con error ${plan.errores.length}. ` +
    `Columnas leídas: ${plan.columnas.join(', ')}.`;
  $('plan-avisos').replaceChildren(...plan.avisos.map((a) => crear('li', '', a)));

  const detalle = $('plan-errores-detalle');
  detalle.hidden = plan.errores.length === 0;
  detalle.open = plan.errores.length > 0 && total === 0;
  $('plan-errores-titulo').textContent = `${plan.errores.length} fila${plan.errores.length === 1 ? '' : 's'} con error (se omitirán)`;
  $('plan-errores').replaceChildren(...plan.errores.slice(0, 200).map((e) => crear('li', '', `Línea ${e.linea}: ${e.mensaje}`)));

  const filas = [
    ...plan.crear.map((c) => ['Crear', c.linea, c.nombre, `${c.datos.upc ?? 'sin UPC'} · ${formatearPrecio(c.datos.precioCentavos)} · ${c.datos.tiendas.join('|') || 'sin tienda'}`]),
    ...plan.actualizar.map((a) => ['Actualizar', a.linea, a.nombre, describirCambios(a.cambios)]),
  ].sort((a, b) => a[1] - b[1]);
  const tabla = $('plan-tabla');
  tabla.hidden = filas.length === 0;
  tabla.querySelector('tbody').replaceChildren(...filas.slice(0, MAXIMO_FILAS_VISTA).map(([accion, linea, nombre, cambios]) => {
    const tr = crear('tr');
    tr.append(crear('td', '', String(linea)), crear('td', '', accion), crear('td', '', nombre), crear('td', '', cambios));
    return tr;
  }));
  const recorte = $('plan-recorte');
  recorte.hidden = filas.length <= MAXIMO_FILAS_VISTA;
  recorte.textContent = `Se muestran ${MAXIMO_FILAS_VISTA} de ${filas.length} cambios.`;

  btnImportar.disabled = total === 0;
  btnImportar.textContent = total === 0 ? 'Nada que importar' : `Importar ${total} cambio${total === 1 ? '' : 's'}`;
  if (total > 0) btnImportar.focus();
}

$('btn-cancelar').addEventListener('click', () => {
  archivo.value = '';
  plan = null;
  seccionPlan.hidden = true;
  archivo.focus();
});

btnImportar.addEventListener('click', async () => {
  if (!plan || importando) return;
  const total = plan.crear.length + plan.actualizar.length;
  if (total === 0) return;
  importando = true;
  btnImportar.disabled = true;
  progreso.hidden = false;
  progreso.className = 'mensaje mensaje--info';
  progreso.textContent = `Importando 0 de ${total}…`;
  try {
    const resumen = await importarPlan(plan, personal.email, (avance) => {
      progreso.textContent = `Importando ${avance.hechos} de ${avance.total}… (${avance.confirmados} confirmados${avance.pendientes ? `, ${avance.pendientes} pendientes de enviar` : ''}${avance.fallidos ? `, ${avance.fallidos} rechazados` : ''})`;
    });
    const partes = [`${resumen.confirmados} confirmado${resumen.confirmados === 1 ? '' : 's'}`];
    if (resumen.pendientes) partes.push(`${resumen.pendientes} guardado${resumen.pendientes === 1 ? '' : 's'} en este equipo, pendientes de enviar`);
    if (resumen.fallidos) partes.push(`${resumen.fallidos} rechazado${resumen.fallidos === 1 ? '' : 's'} por el servidor (líneas ${resumen.errores.flatMap((e) => e.lineas).join(', ')})`);
    progreso.className = `mensaje ${resumen.fallidos ? 'mensaje--error' : 'mensaje--ok'}`;
    progreso.textContent = `Importación terminada: ${partes.join(' · ')}.`;
    avisar(`Importación terminada: ${resumen.hechos} cambios.`, resumen.fallidos ? 'error' : 'ok', 6000);
    plan = null;
    archivo.value = '';
  } catch (error) {
    progreso.className = 'mensaje mensaje--error';
    progreso.textContent = `La importación se detuvo: ${mensajeError(error)}`;
  } finally {
    importando = false;
  }
});
