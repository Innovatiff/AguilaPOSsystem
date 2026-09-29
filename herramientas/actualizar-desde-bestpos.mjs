#!/usr/bin/env node
/**
 * Segunda (y siguientes) cargas desde BestPOS: compara lo que ya hay en el
 * catálogo con el CSV recién convertido y separa lo que hay que CREAR de lo
 * que solo cambia de PRECIO, para no duplicar productos ni pisar lo que el
 * personal ya corrigió a mano (marca, nombre, clase fiscal, tiendas…).
 *
 *   node herramientas/actualizar-desde-bestpos.mjs --anterior=<csv> --nuevo=<csv> [--salida=migracion] [--nombre=<sufijo>]
 *
 * --anterior  Lo que ya está en el catálogo: la exportación de Gestión →
 *             Importar / exportar (trae la columna id: es lo más exacto y
 *             permite emparejar también por PLU y por nombre), o, a falta de
 *             ella, el CSV que se importó la vez anterior (sin id: solo se
 *             empareja por UPC).
 * --nuevo     El importar-*.csv que produce convertir-bestpos.mjs con el reporte nuevo.
 *
 * Escribe en --salida:
 *   crear-<sufijo>.csv       productos del reporte que no están en el catálogo (todas las columnas)
 *   precios-<sufijo>.csv     productos que ya existen y cambian de precio (id o upc + precioCentavos)
 *   pendientes-<sufijo>.txt  lo que no se resuelve solo: cambios de precio en productos que solo se
 *                            pudieron reconocer por PLU o nombre sin tener su id, y productos del
 *                            catálogo que ya no aparecen en el reporte
 * Los dos CSV se validan con el planificador de la app antes de escribirse.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { aCSV, deCSV, interpretarCelda, planificarImportacion, COLUMNAS_IMPORTABLES } from '../js/csv.js';
import { armarProducto, normalizarTexto } from '../js/esquema.js';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto = '') => (args.find((a) => a.startsWith(`--${nombre}=`)) ?? `=${porDefecto}`).split('=').slice(1).join('=');
const rutaAnterior = opcion('anterior');
const rutaNuevo = opcion('nuevo');
const salida = opcion('salida', 'migracion');
const sufijo = opcion('nombre', 'bestpos');
if (!rutaAnterior || !rutaNuevo) {
  console.error('Uso: node herramientas/actualizar-desde-bestpos.mjs --anterior=<exportación o importación previa> --nuevo=<importar-*.csv> [--salida=carpeta] [--nombre=sufijo]');
  process.exit(1);
}
const USUARIO = 'migracion@bestpos'; // solo para validar con el planificador; la app firma con quien importa

/** Filas de un CSV como objetos {columna: texto}, con las columnas tal cual vienen. */
function leerTabla(ruta) {
  const tabla = deCSV(readFileSync(ruta, 'utf8'));
  const encabezados = tabla.encabezados.map((e) => e.replace(/^﻿/, '').trim());
  return { encabezados, filas: tabla.filas.filter((f) => f.some((v) => String(v ?? '').trim() !== '')).map((f) => Object.fromEntries(encabezados.map((e, i) => [e, f[i] ?? '']))) };
}

/** Un producto con los tipos de la app a partir de una fila de CSV (exportación o importación). */
function productoDeFila(fila) {
  const datos = {};
  for (const columna of COLUMNAS_IMPORTABLES) {
    if (columna === 'id' || !(columna in fila)) continue;
    datos[columna] = interpretarCelda(columna, fila[columna]);
  }
  if (datos.unidadVenta == null) datos.unidadVenta = 'pieza';
  if (datos.activo == null) datos.activo = true;
  return armarProducto(datos, USUARIO);
}

const claveNombre = (p) => normalizarTexto([p.marca, p.nombre, p.presentacion].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------- catálogo anterior
const anterior = leerTabla(rutaAnterior);
const conId = anterior.encabezados.includes('id');
const catalogo = new Map(); // id → producto (id real de la exportación, o uno provisional)
anterior.filas.forEach((fila, i) => {
  let producto;
  try {
    producto = productoDeFila(fila);
  } catch (error) {
    throw new Error(`--anterior línea ${i + 2}: ${error.message}`);
  }
  const id = conId ? fila.id : `anterior-${i + 2}`;
  catalogo.set(id, { id, ...producto });
});
const porUPC = new Map();
const porPLU = new Map();
const porNombre = new Map();
for (const p of catalogo.values()) {
  if (p.upc) porUPC.set(p.upc, p);
  if (p.plu) porPLU.set(p.plu, [...(porPLU.get(p.plu) ?? []), p]);
  const clave = claveNombre(p);
  porNombre.set(clave, [...(porNombre.get(clave) ?? []), p]);
}

// ------------------------------------------------------------- reporte nuevo
const nuevo = leerTabla(rutaNuevo);
if (!nuevo.encabezados.includes('precioCentavos')) throw new Error('--nuevo no tiene la columna precioCentavos: debe ser el importar-*.csv del conversor.');
const crear = [];
const precios = [];
const pendientes = [];
const emparejados = new Set();
const unico = (lista) => (lista && lista.length === 1 ? lista[0] : null);

for (const fila of nuevo.filas) {
  const producto = productoDeFila(fila);
  let actual = null;
  let via = null;
  if (producto.upc && porUPC.has(producto.upc)) {
    actual = porUPC.get(producto.upc);
    via = 'upc';
  } else if (!producto.upc && producto.plu && unico(porPLU.get(producto.plu))) {
    actual = unico(porPLU.get(producto.plu));
    via = 'plu';
  } else if (!producto.upc && !producto.plu && unico(porNombre.get(claveNombre(producto)))) {
    actual = unico(porNombre.get(claveNombre(producto)));
    via = 'nombre';
  }
  if (!actual) {
    crear.push(fila);
    continue;
  }
  emparejados.add(actual.id);
  if (actual.precioCentavos === producto.precioCentavos) continue;
  const cambio = `${[actual.marca, actual.nombre].filter(Boolean).join(' ')}: ${(actual.precioCentavos / 100).toFixed(2)} → ${(producto.precioCentavos / 100).toFixed(2)}`;
  if (conId) precios.push([actual.id, String(producto.precioCentavos)]);
  else if (via === 'upc') precios.push([producto.upc, String(producto.precioCentavos)]);
  else pendientes.push(`cambiar a mano (reconocido por ${via}, sin id): ${via === 'plu' ? `PLU ${producto.plu} ` : ''}${cambio}`);
}

const desaparecidos = [...catalogo.values()].filter((p) => !emparejados.has(p.id) && p.activo !== false);
for (const p of desaparecidos) pendientes.push(`ya no aparece en el reporte (¿desactivar?): ${p.upc ?? (p.plu ? `PLU ${p.plu}` : 'sin código')} ${[p.marca, p.nombre, p.presentacion].filter(Boolean).join(' ')}`);

// ------------------------------------------------------------- validar y escribir
mkdirSync(salida, { recursive: true });
const textoCrear = aCSV([nuevo.encabezados, ...crear.map((f) => nuevo.encabezados.map((e) => f[e] ?? ''))]);
const planCrear = planificarImportacion(deCSV(textoCrear), new Map(), USUARIO);
if (planCrear.errores.length > 0) {
  console.error(`crear: ${planCrear.errores.length} filas con error según la app`);
  for (const e of planCrear.errores.slice(0, 10)) console.error(`  línea ${e.linea}: ${e.mensaje}`);
  process.exit(2);
}
const textoPrecios = aCSV([[conId ? 'id' : 'upc', 'precioCentavos'], ...precios]);
const planPrecios = planificarImportacion(deCSV(textoPrecios), catalogo, USUARIO);
if (planPrecios.errores.length > 0 || planPrecios.crear.length > 0 || planPrecios.actualizar.length !== precios.length) {
  console.error(`precios: el planificador no reconoce todas las filas como actualizaciones (errores ${planPrecios.errores.length}, crear ${planPrecios.crear.length}, actualizar ${planPrecios.actualizar.length} de ${precios.length})`);
  for (const e of planPrecios.errores.slice(0, 10)) console.error(`  línea ${e.linea}: ${e.mensaje}`);
  process.exit(2);
}
writeFileSync(join(salida, `crear-${sufijo}.csv`), textoCrear);
writeFileSync(join(salida, `precios-${sufijo}.csv`), textoPrecios);
writeFileSync(join(salida, `pendientes-${sufijo}.txt`), `${pendientes.length === 0 ? 'Nada pendiente.' : pendientes.join('\n')}\n`);

const resumen = [
  `Catálogo anterior: ${catalogo.size} productos (${conId ? 'exportación con id' : 'importación previa, sin id: solo se empareja por UPC'})`,
  `Reporte nuevo: ${nuevo.filas.length} productos`,
  `  ya existen: ${emparejados.size} · de ellos cambian de precio: ${precios.length}`,
  `  nuevos a crear: ${crear.length}`,
  `  pendientes a mano: ${pendientes.length}`,
  '',
  `Archivos en ${salida}/: crear-${sufijo}.csv · precios-${sufijo}.csv · pendientes-${sufijo}.txt`,
];
console.log(resumen.join('\n'));
