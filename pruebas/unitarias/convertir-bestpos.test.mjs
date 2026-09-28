import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deCSV, planificarImportacion } from '../../js/csv.js';

// Reporte mínimo con las rarezas reales del export de BestPOS: título, ";" con
// comas de relleno, fila entera entrecomillada con fórmulas de Excel, códigos
// UPC-A / EAN-13 / UPC-E / PLU / inválidos / dobles lecturas / GS1 y fila Total.
const CABECERA = 'Product No.;Supplier Number;Description;Linked Product;Un/Box;Unit;Format;Bought Qty;Min Qty;Max Qty;On Hand;Reserved;Warehouse;Total Qty;Cost;Total Cost;Avg Cost;Total Avg;Margin;#1 Price;#2 Price;#3 Price;#4 Price;Retail Value;Ratio;Qty Sold;% Sold';
const fila = (codigo, descripcion, precio, proveedor = '') => `${codigo};${proveedor};${descripcion};;1;;;;;;0;;;0;$0.00;$0.00;$0.00;$0.00;0%;${precio};$0.00;$0.00;$0.00;$0.00;0%;0;0%,,,,`;
const REPORTE = [
  'REPORT - Inventory List,,,,',
  `${CABECERA},,,,`,
  fila('633148100013', 'Tajin Clasico 142g', '$2.99'),
  fila('7501000112494', 'Bimbo Pan Blanco Grande 680g', '$5.49'),
  fila('06742708', 'Coca Cola 2l', '$3.29'),
  fila('4011', 'Platano', '$0.79'),
  fila('100', 'Chile Ancho', '$4.99'),
  fila('860100103001', 'I12 Earphone', '$19.99'),
  fila('6331481000136331', 'Tajin Clasico 142g', '$2.99'), // doble lectura del mismo producto
  fila('6331481000137501', 'Jarritos Mandarina 370ml', '$1.75'), // doble lectura: el código real empieza por 7501
  fila('0107503034388142', 'Avocados', '$3.00'), // GS1 (01) + GTIN-14
  fila('095188002557', 'Tampico Citrus Punch 3.78l', '$0.00'),
  fila('042279591322', 'Suero Oral Naranja 1l042279794327', '$7.35', '0422797943270422'),
  '"063211012927;;""=""""V8 Original"";"" 340ml"""""";;1;;;;;;0;;;0;$0.00;$0.00;$0.00;$0.00;0%;$1.75;$0.00;$0.00;$0.00;$0.00;0%;0;0%",,,,',
  fila('7500435125987', 'Downy Pasion 750ml', '$6.99'),
  fila('', 'Total:', '$0.00'),
  '',
].join('\r\n');

describe('herramientas/convertir-bestpos.mjs', () => {
  let revision;
  let importar;
  let resumen;
  before(() => {
    const carpeta = mkdtempSync(join(tmpdir(), 'bestpos-'));
    const entrada = join(carpeta, 'Rapport.csv');
    writeFileSync(entrada, REPORTE, 'utf8');
    const r = spawnSync(process.execPath, ['herramientas/convertir-bestpos.mjs', entrada, '--tienda=talbot', `--salida=${carpeta}`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    resumen = r.stdout;
    importar = deCSV(readFileSync(join(carpeta, 'importar-bestpos-talbot.csv'), 'utf8'));
    const rev = deCSV(readFileSync(join(carpeta, 'revision-bestpos-talbot.csv'), 'utf8'));
    revision = rev.filas.map((f) => Object.fromEntries(rev.encabezados.map((c, i) => [c, f[i]])));
  });

  it('salta el título y la fila Total, y lee la fila entrecomillada con fórmulas', () => {
    assert.equal(revision.length, 13);
    const v8 = revision.find((r) => r.codigoOriginal === '063211012927');
    assert.equal(v8.marca, 'V8');
    assert.equal(v8.nombre, 'Original');
    assert.equal(v8.presentacion, '340ml');
    assert.equal(v8.precio, '1.75');
  });

  it('normaliza códigos: UPC-A, EAN-13, UPC-E, PLU, inválidos y GS1', () => {
    const por = Object.fromEntries(revision.map((r) => [r.codigoOriginal, r]));
    assert.equal(por['633148100013'].upc, '633148100013');
    assert.equal(por['7501000112494'].upc, '7501000112494');
    assert.equal(por['06742708'].upc, '067000004278');
    assert.equal(por['4011'].plu, '4011');
    assert.equal(por['100'].plu, '0100');
    assert.equal(por['860100103001'].upc, '');
    assert.match(por['860100103001'].avisos, /inválido/);
    assert.equal(por['0107503034388142'].upc, '7503034388142');
  });

  it('resuelve dobles lecturas: duplicado descartado, producto ajeno sin código', () => {
    const dup = revision.find((r) => r.codigoOriginal === '6331481000136331');
    assert.equal(dup.estado, 'excluido: duplicado');
    const ajeno = revision.find((r) => r.codigoOriginal === '6331481000137501');
    assert.equal(ajeno.estado, 'importar');
    assert.equal(ajeno.upc, '');
    assert.match(ajeno.avisos, /empieza por 7501/);
  });

  it('separa marca, nombre y presentación, y quita códigos pegados a la descripción', () => {
    const suero = revision.find((r) => r.codigoOriginal === '042279591322');
    assert.equal(suero.marca, 'Suero Oral');
    assert.equal(suero.nombre, 'Naranja');
    assert.equal(suero.presentacion, '1l');
    const coca = revision.find((r) => r.codigoOriginal === '06742708');
    assert.equal(coca.nombre, 'Coca Cola'); // la marca es todo el nombre: se queda como nombre
    assert.equal(coca.marca, '');
    assert.equal(coca.presentacion, '2l');
  });

  it('propone la clase fiscal y marca lo dudoso', () => {
    const por = Object.fromEntries(revision.map((r) => [r.codigoOriginal, r]));
    assert.equal(por['7500435125987'].claseFiscal, 'gravado'); // Downy
    assert.equal(por['06742708'].claseFiscal, 'gravado'); // gaseosa
    assert.equal(por['7501000112494'].claseFiscal, 'tasaCero'); // pan
    assert.equal(por['042279591322'].revisar, 'sí'); // suero
  });

  it('excluye precios en cero y produce un archivo que la app importa sin errores', () => {
    assert.equal(revision.find((r) => r.codigoOriginal === '095188002557').estado, 'excluido: precio en cero');
    assert.deepEqual(importar.encabezados, ['upc', 'plu', 'nombre', 'marca', 'presentacion', 'precioCentavos', 'unidadVenta', 'claseFiscal', 'tiendas']);
    assert.equal(importar.filas.length, 11);
    assert.ok(importar.filas.every((f) => f[8] === 'talbot' && f[6] === 'pieza'));
    const plan = planificarImportacion(importar, new Map(), 'migracion@prueba');
    assert.equal(plan.errores.length, 0);
    assert.equal(plan.crear.length, 11);
    assert.match(resumen, /a importar: 11/);
  });
});
