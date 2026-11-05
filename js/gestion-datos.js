/**
 * Back office · Importar / exportar el catálogo en CSV (solo administradores).
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarCatalogo, importarPlan } from './productos.js';
import { exportarCatalogo, plantillaCSV, nombreArchivoExportacion, deCSV, planificarImportacion } from './csv.js';
import { formatearPrecio } from './precios.js';
import { t, tc } from './idioma.js';

const { personal } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal, activa: 'gestion/datos.html' });

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
    const origen = desdeCache ? (pendientes ? t('datos locales, con cambios por enviar') : t('datos locales')) : t('sincronizado');
    $('estado-catalogo').textContent = mapa.size === 1
      ? t('{n} producto · {origen}', { n: mapa.size, origen })
      : t('{n} productos · {origen}', { n: mapa.size, origen });
  },
  (error) => avisar(t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) }), 'error', 0),
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
    avisar(t('El catálogo todavía no termina de cargar.'), 'error');
    return;
  }
  const productos = [...catalogo.values()];
  descargar(nombreArchivoExportacion(), exportarCatalogo(productos));
  avisar(productos.length === 1
    ? tc('singular', 'Exportados {n} productos.', { n: productos.length })
    : t('Exportados {n} productos.', { n: productos.length }), 'ok');
});

$('btn-plantilla').addEventListener('click', () => descargar('plantilla-catalogo-aguila.csv', plantillaCSV()));

// ------------------------------------------------------------- importar
archivo.addEventListener('change', async () => {
  const [seleccionado] = archivo.files;
  if (!seleccionado) return;
  try {
    const texto = await seleccionado.text();
    const leido = deCSV(texto);
    plan = planificarImportacion(leido, catalogo, personal.usuario);
    pintarPlan(seleccionado.name, leido);
  } catch (error) {
    avisar(t('No se pudo leer el archivo: {error}', { error: error.message }), 'error', 0);
  }
});

function describirCambios(cambios) {
  return Object.entries(cambios).map(([campo, valor]) => {
    if (campo.endsWith('Centavos') && Number.isInteger(valor)) return `${campo} → ${formatearPrecio(valor)}`;
    if (Array.isArray(valor)) return `${campo} → ${valor.join('|') || t('(ninguna)')}`;
    const texto = valor === null ? t('(vacío)') : String(valor);
    return `${campo} → ${texto}`;
  }).join(' · ');
}

function pintarPlan(nombreArchivo, leido) {
  seccionPlan.hidden = false;
  progreso.hidden = true;
  const total = plan.crear.length + plan.actualizar.length;
  const valores = {
    archivo: nombreArchivo, filas: leido.filas.length, crear: plan.crear.length, actualizar: plan.actualizar.length,
    sinCambios: plan.sinCambios, errores: plan.errores.length, columnas: plan.columnas.join(', '),
  };
  $('plan-resumen').textContent = leido.filas.length === 1
    ? tc('singular', '{archivo}: {filas} filas. Crear {crear} · actualizar {actualizar} · sin cambios {sinCambios} · con error {errores}. Columnas leídas: {columnas}.', valores)
    : t('{archivo}: {filas} filas. Crear {crear} · actualizar {actualizar} · sin cambios {sinCambios} · con error {errores}. Columnas leídas: {columnas}.', valores);
  $('plan-avisos').replaceChildren(...plan.avisos.map((a) => crear('li', '', a)));

  const detalle = $('plan-errores-detalle');
  detalle.hidden = plan.errores.length === 0;
  detalle.open = plan.errores.length > 0 && total === 0;
  $('plan-errores-titulo').textContent = plan.errores.length === 1
    ? t('{n} fila con error (se omitirán)', { n: plan.errores.length })
    : t('{n} filas con error (se omitirán)', { n: plan.errores.length });
  $('plan-errores').replaceChildren(...plan.errores.slice(0, 200).map((e) => crear('li', '', t('Línea {linea}: {mensaje}', { linea: e.linea, mensaje: e.mensaje }))));

  const filas = [
    ...plan.crear.map((c) => [t('Crear'), c.linea, c.nombre, [c.datos.upc ?? t('sin UPC'), formatearPrecio(c.datos.precioCentavos), c.datos.tiendas.join('|') || t('sin tienda')].join(' · ')]),
    ...plan.actualizar.map((a) => [t('Actualizar'), a.linea, a.nombre, describirCambios(a.cambios)]),
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
  recorte.textContent = t('Se muestran {n} de {total} cambios.', { n: MAXIMO_FILAS_VISTA, total: filas.length });

  btnImportar.disabled = total === 0;
  btnImportar.textContent = total === 0 ? t('Nada que importar') : total === 1 ? t('Importar {n} cambio', { n: total }) : t('Importar {n} cambios', { n: total });
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
  progreso.textContent = t('Importando {hechos} de {total}…', { hechos: 0, total });
  try {
    const resumen = await importarPlan(plan, personal.usuario, (avance) => {
      const detalle = [t('{n} confirmados', { n: avance.confirmados })];
      if (avance.pendientes) detalle.push(t('{n} pendientes de enviar', { n: avance.pendientes }));
      if (avance.fallidos) detalle.push(t('{n} rechazados', { n: avance.fallidos }));
      progreso.textContent = t('Importando {hechos} de {total}… ({detalle})', { hechos: avance.hechos, total: avance.total, detalle: detalle.join(', ') });
    });
    const partes = [resumen.confirmados === 1 ? t('{n} confirmado', { n: 1 }) : t('{n} confirmados', { n: resumen.confirmados })];
    if (resumen.pendientes) {
      partes.push(resumen.pendientes === 1
        ? t('{n} guardado en este equipo, pendientes de enviar', { n: 1 })
        : t('{n} guardados en este equipo, pendientes de enviar', { n: resumen.pendientes }));
    }
    if (resumen.fallidos) {
      const lineas = resumen.errores.flatMap((e) => e.lineas).join(', ');
      partes.push(resumen.fallidos === 1
        ? t('{n} rechazado por el servidor (líneas {lineas})', { n: 1, lineas })
        : t('{n} rechazados por el servidor (líneas {lineas})', { n: resumen.fallidos, lineas }));
    }
    progreso.className = `mensaje ${resumen.fallidos ? 'mensaje--error' : 'mensaje--ok'}`;
    progreso.textContent = t('Importación terminada: {resumen}.', { resumen: partes.join(' · ') });
    avisar(resumen.hechos === 1
      ? tc('singular', 'Importación terminada: {n} cambios.', { n: 1 })
      : t('Importación terminada: {n} cambios.', { n: resumen.hechos }), resumen.fallidos ? 'error' : 'ok', 6000);
    plan = null;
    archivo.value = '';
  } catch (error) {
    progreso.className = 'mensaje mensaje--error';
    progreso.textContent = t('La importación se detuvo: {error}', { error: mensajeError(error) });
  } finally {
    importando = false;
  }
});
