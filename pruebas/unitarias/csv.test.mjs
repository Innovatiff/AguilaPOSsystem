import assert from 'node:assert/strict';
import {
  aCSV, deCSV, serializarProducto, exportarCatalogo, plantillaCSV, interpretarCelda, planificarImportacion,
  COLUMNAS_EXPORTACION, COLUMNAS_IMPORTABLES,
} from '../../js/csv.js';

const marca = (ms) => ({ toDate: () => new Date(ms) });
const producto = (extra) => ({
  id: 'p1', upc: '633148100013', plu: null, nombre: 'CLASICO', marca: 'TAJIN', descriptor: null, presentacion: '142g',
  precioCentavos: 499, unidadVenta: 'pieza', precioPorKgCentavos: null, claseFiscal: 'gravado', tiendas: ['talbot'],
  existencias: null, costoCentavos: null, proveedor: null, activo: true, ultimoPrecioImpresoCentavos: null, fechaUltimaImpresion: null,
  tokensBusqueda: ['taj'], creadoEn: marca(1_700_000_000_000), actualizadoEn: marca(1_700_000_000_000), actualizadoPor: 'ana@aguila.test', ...extra,
});

describe('aCSV / deCSV', () => {
  it('escapa comas, comillas y saltos de línea, y lee de vuelta lo mismo', () => {
    const filas = [['a', 'b'], ['con, coma', 'con "comillas"'], ['multi\nlínea', 'acentos ñ á'], ['', '0']];
    const texto = aCSV(filas);
    assert.ok(texto.startsWith('﻿'));
    assert.ok(texto.includes('"con, coma","con ""comillas"""'));
    const leido = deCSV(texto);
    assert.equal(leido.delimitador, ',');
    assert.deepEqual([leido.encabezados, ...leido.filas], filas);
  });
  it('detecta punto y coma y tabulador', () => {
    assert.deepEqual(deCSV('a;b\r\n1;2\r\n').filas, [['1', '2']]);
    assert.deepEqual(deCSV('a\tb\n1\t2').filas, [['1', '2']]);
  });
  it('ignora filas vacías finales', () => {
    assert.equal(deCSV('a,b\n1,2\n\n,\n').filas.length, 1);
  });
});

describe('exportación', () => {
  it('serializa con el orden de columnas del esquema, tiendas con | y fechas ISO', () => {
    const fila = serializarProducto(producto({ tiendas: ['talbot', 'erie'], activo: false }));
    assert.equal(fila.length, COLUMNAS_EXPORTACION.length);
    assert.equal(fila[COLUMNAS_EXPORTACION.indexOf('tiendas')], 'talbot|erie');
    assert.equal(fila[COLUMNAS_EXPORTACION.indexOf('activo')], 'false');
    assert.equal(fila[COLUMNAS_EXPORTACION.indexOf('creadoEn')], '2023-11-14T22:13:20.000Z');
    assert.equal(fila[COLUMNAS_EXPORTACION.indexOf('plu')], '');
  });
  it('exportarCatalogo ordena por nombre y no incluye tokens', () => {
    const csv = exportarCatalogo([producto({ id: 'b', nombre: 'ZANAHORIA' }), producto({ id: 'a', nombre: 'AJO' })]);
    const leido = deCSV(csv);
    assert.deepEqual(leido.encabezados, [...COLUMNAS_EXPORTACION]);
    assert.equal(leido.filas[0][3], 'AJO');
    assert.ok(!leido.encabezados.includes('tokensBusqueda'));
  });
  it('la plantilla trae solo los encabezados importables sin id', () => {
    const leido = deCSV(plantillaCSV());
    assert.deepEqual(leido.encabezados, COLUMNAS_IMPORTABLES.filter((c) => c !== 'id'));
    assert.equal(leido.filas.length, 0);
  });
});

describe('interpretarCelda', () => {
  it('UPC: completa el cero que quita Excel y rechaza notación científica', () => {
    assert.equal(interpretarCelda('upc', '36000291452'), '036000291452');
    assert.throws(() => interpretarCelda('upc', '6.33148E+11'), /notación científica/);
    assert.equal(interpretarCelda('upc', ''), null);
  });
  it('centavos enteros; los decimales se rechazan con mensaje claro', () => {
    assert.equal(interpretarCelda('precioCentavos', '499'), 499);
    assert.throws(() => interpretarCelda('precioCentavos', '4.99'), /entero en centavos/);
  });
  it('clase fiscal, unidad, activo y tiendas con sus variantes', () => {
    assert.equal(interpretarCelda('claseFiscal', 'Tasa Cero'), 'tasaCero');
    assert.equal(interpretarCelda('claseFiscal', '+Tx'), 'gravado');
    assert.throws(() => interpretarCelda('claseFiscal', 'exento'));
    assert.equal(interpretarCelda('unidadVenta', 'PESO'), 'peso');
    assert.equal(interpretarCelda('activo', 'sí'), true);
    assert.equal(interpretarCelda('activo', '0'), false);
    assert.deepEqual(interpretarCelda('tiendas', 'talbot | erie'), ['talbot', 'erie']);
    assert.deepEqual(interpretarCelda('tiendas', ''), []);
  });
});

describe('planificarImportacion', () => {
  const catalogo = new Map([['p1', producto()], ['p2', producto({ id: 'p2', upc: '036000291452', nombre: 'MANGO', marca: 'JUMEX', presentacion: '335mL', precioCentavos: 199 })]]);
  const archivo = (encabezados, filas) => ({ encabezados, filas });

  it('actualiza por upc solo los campos que cambian y crea los nuevos', () => {
    const plan = planificarImportacion(archivo(
      ['upc', 'nombre', 'marca', 'presentacion', 'precioCentavos', 'claseFiscal', 'tiendas'],
      [
        ['633148100013', 'CLASICO', 'TAJIN', '142g', '549', 'gravado', 'talbot'],
        ['049000006346', 'COCA COLA', 'COCA-COLA', '355mL', '199', 'gravado', 'erie|talbot'],
        ['036000291452', 'MANGO', 'JUMEX', '335mL', '199', 'gravado', 'talbot'],
      ],
    ), catalogo, 'ana@aguila.test');
    assert.deepEqual(plan.errores, []);
    assert.equal(plan.actualizar.length, 1);
    assert.deepEqual(plan.actualizar[0].cambios, { precioCentavos: 549 });
    assert.equal(plan.crear.length, 1);
    assert.equal(plan.crear[0].datos.nombre, 'COCA COLA');
    assert.deepEqual(plan.crear[0].datos.tiendas, ['erie', 'talbot']);
    assert.equal(plan.crear[0].datos.actualizadoPor, 'ana@aguila.test');
    assert.equal(plan.sinCambios, 1);
  });
  it('con id actualiza ese producto aunque cambie el upc; columnas ausentes no se tocan', () => {
    const plan = planificarImportacion(archivo(['id', 'precioCentavos'], [['p2', '249']]), catalogo, 'ana@aguila.test');
    assert.deepEqual(plan.actualizar.map((a) => [a.actual.id, a.cambios]), [['p2', { precioCentavos: 249 }]]);
  });
  it('reporta errores por fila sin detener el resto', () => {
    const plan = planificarImportacion(archivo(
      ['id', 'upc', 'nombre', 'precioCentavos', 'claseFiscal'],
      [
        ['nope', '', 'X', '100', 'gravado'],
        ['', '049000006346', 'PEPSI', '1.99', 'gravado'],
        ['', '049000006347', 'MAL UPC', '100', 'gravado'],
        ['', '012000001291', 'SIN CLASE', '100', 'exento'],
        ['', '028400064057', 'BIEN', '100', 'tasaCero'],
        ['', '028400064057', 'REPETIDO', '100', 'tasaCero'],
        ['p1', '036000291452', 'ROBA UPC', '100', 'gravado'],
        ['p2', '', 'MANGO', '199', 'gravado'],
        ['p2', '', 'MANGO OTRA VEZ', '199', 'gravado'],
      ],
    ), catalogo, 'ana@aguila.test');
    assert.deepEqual(plan.errores.map((e) => e.linea), [2, 3, 4, 5, 7, 8, 10]);
    assert.match(plan.errores[0].mensaje, /no existe ningún producto con id/);
    assert.match(plan.errores[1].mensaje, /entero en centavos/);
    assert.match(plan.errores[2].mensaje, /verificador/);
    assert.match(plan.errores[3].mensaje, /claseFiscal/);
    assert.match(plan.errores[4].mensaje, /más de una vez/);
    assert.match(plan.errores[5].mensaje, /ya pertenece a otro producto/);
    assert.match(plan.errores[6].mensaje, /ya aparece en la línea 9/);
    assert.equal(plan.crear.length, 1);
    assert.equal(plan.sinCambios, 1);
  });
  it('para crear hace falta nombre, precioCentavos y claseFiscal; avisa de columnas ignoradas', () => {
    const plan = planificarImportacion(archivo(['upc', 'nombre', 'precioCentavos', 'existencias', 'color'], [['049000006346', 'COCA', '199', '5', 'roja']]), catalogo, 'ana@aguila.test');
    assert.equal(plan.errores.length, 1);
    assert.match(plan.errores[0].mensaje, /columna claseFiscal/);
    assert.ok(plan.avisos.some((a) => /existencias/.test(a)));
    assert.ok(plan.avisos.some((a) => /color/.test(a)));
  });
  it('un archivo sin columnas del esquema se rechaza', () => {
    const plan = planificarImportacion(archivo(['foo', 'bar'], [['1', '2']]), catalogo, 'ana@aguila.test');
    assert.equal(plan.errores.length, 1);
  });
  it('celda activo vacía deja el valor; "false" desactiva; upc vacío nunca borra el UPC', () => {
    const plan = planificarImportacion(archivo(['id', 'activo', 'upc'], [['p1', '', ''], ['p2', 'false', '']]), catalogo, 'ana@aguila.test');
    assert.equal(plan.sinCambios, 1);
    assert.deepEqual(plan.actualizar[0].cambios, { activo: false });
  });
});
