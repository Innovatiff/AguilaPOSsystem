import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aCSV, deCSV } from '../../js/csv.js';

const CABECERA = ['upc', 'plu', 'nombre', 'marca', 'presentacion', 'precioCentavos', 'unidadVenta', 'claseFiscal', 'tiendas'];
const NUEVO = aCSV([
  CABECERA,
  ['633148100013', '', 'Clasico', 'Tajin', '142g', '549', 'pieza', 'gravado', 'talbot'], // existe, sube de precio
  ['049000006346', '', 'Coca Cola', '', '355ml', '199', 'pieza', 'gravado', 'talbot'], // existe, mismo precio
  ['', '4011', 'Platano', '', '', '89', 'pieza', 'tasaCero', 'talbot'], // existe por PLU, cambia de precio
  ['', '', 'Chile Ancho', '', '', '499', 'pieza', 'tasaCero', 'talbot'], // existe por nombre, mismo precio
  ['7501000112494', '', 'Pan Blanco', 'Bimbo', '680g', '549', 'pieza', 'tasaCero', 'talbot'], // nuevo
]);

function correr(anterior, nombre) {
  const carpeta = mkdtempSync(join(tmpdir(), 'actualizar-'));
  writeFileSync(join(carpeta, 'anterior.csv'), anterior);
  writeFileSync(join(carpeta, 'nuevo.csv'), NUEVO);
  const r = spawnSync(process.execPath, ['herramientas/actualizar-desde-bestpos.mjs', `--anterior=${join(carpeta, 'anterior.csv')}`, `--nuevo=${join(carpeta, 'nuevo.csv')}`, `--salida=${carpeta}`, `--nombre=${nombre}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return {
    salida: r.stdout,
    crear: deCSV(readFileSync(join(carpeta, `crear-${nombre}.csv`), 'utf8')),
    precios: deCSV(readFileSync(join(carpeta, `precios-${nombre}.csv`), 'utf8')),
    pendientes: readFileSync(join(carpeta, `pendientes-${nombre}.txt`), 'utf8'),
  };
}

describe('herramientas/actualizar-desde-bestpos.mjs', () => {
  it('con la importación previa (sin id) empareja por UPC y deja lo demás como pendiente', () => {
    const anterior = aCSV([
      CABECERA,
      ['633148100013', '', 'Clasico', 'Tajin', '142g', '499', 'pieza', 'gravado', 'talbot'],
      ['049000006346', '', 'Coca Cola', '', '355ml', '199', 'pieza', 'gravado', 'talbot'],
      ['', '4011', 'Platano', '', '', '79', 'pieza', 'tasaCero', 'talbot'],
      ['', '', 'Chile Ancho', '', '', '499', 'pieza', 'tasaCero', 'talbot'],
      ['074734040014', '', 'Harina De Maiz', 'Maseca', '1.8kg', '549', 'pieza', 'tasaCero', 'talbot'], // ya no viene en el reporte
    ]);
    const r = correr(anterior, 'sinid');
    assert.deepEqual(r.crear.encabezados, CABECERA);
    assert.deepEqual(r.crear.filas.map((f) => f[0]), ['7501000112494']);
    assert.deepEqual(r.precios.encabezados, ['upc', 'precioCentavos']);
    assert.deepEqual(r.precios.filas, [['633148100013', '549']]);
    assert.match(r.pendientes, /cambiar a mano \(reconocido por plu, sin id\): PLU 4011 Platano: 0\.79 → 0\.89/);
    assert.match(r.pendientes, /ya no aparece en el reporte .*074734040014 Maseca Harina De Maiz 1\.8kg/);
    assert.match(r.salida, /ya existen: 4 · de ellos cambian de precio: 1/);
    assert.match(r.salida, /nuevos a crear: 1/);
  });

  it('con la exportación de Gestión (con id) actualiza por id también lo reconocido por PLU o nombre', () => {
    const anterior = aCSV([
      ['id', ...CABECERA, 'activo', 'creadoEn'],
      ['p-tajin', '633148100013', '', 'CLASICO', 'TAJIN', '142g', '499', 'pieza', 'gravado', 'talbot|erie', 'true', '2026-09-20T12:00:00.000Z'],
      ['p-coca', '049000006346', '', 'Coca Cola', '', '355ml', '199', 'pieza', 'gravado', 'talbot', 'true', '2026-09-20T12:00:00.000Z'],
      ['p-platano', '', '4011', 'Platano', '', '', '79', 'pieza', 'tasaCero', 'talbot', 'true', '2026-09-20T12:00:00.000Z'],
      ['p-ancho', '', '', 'Chile Ancho', '', '', '499', 'pieza', 'tasaCero', 'talbot', 'true', '2026-09-20T12:00:00.000Z'],
      ['p-viejo', '074734040014', '', 'Harina', 'Maseca', '', '549', 'pieza', 'tasaCero', 'talbot', 'false', '2026-09-20T12:00:00.000Z'], // inactivo: no se reclama
    ]);
    const r = correr(anterior, 'conid');
    assert.deepEqual(r.crear.filas.map((f) => f[0]), ['7501000112494']);
    assert.deepEqual(r.precios.encabezados, ['id', 'precioCentavos']);
    assert.deepEqual(r.precios.filas, [['p-tajin', '549'], ['p-platano', '89']]);
    assert.equal(r.pendientes.trim(), 'Nada pendiente.');
  });
});
