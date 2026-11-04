import assert from 'node:assert/strict';
import {
  LIMITES_RECEPCION, nombreCompleto, piezasDesdeTexto, kilosDesdeTexto, textoKilos, separarMultiplicador, lineaDeRecepcion,
  lineaSinRegistrar, claveDeLinea, erroresDeLinea, armarRecepcion, textoCantidades, textoLinea, cumpleFiltrosRecepcion,
  lineasVisibles, resumirPorProducto, totalesRecepciones, filasCSVRecepciones,
} from '../../js/inventario.js';

const TORTILLAS = { id: 'p-tortillas', upc: '012345678905', plu: null, marca: 'Mission', nombre: 'Tortillas de maíz', presentacion: '30 pzas', unidadVenta: 'pieza' };
const CHILES = { id: 'p-poblano', upc: null, plu: '4705', marca: '', nombre: 'Chiles poblanos', presentacion: '', unidadVenta: 'peso' };
const PERSONAL = { usuario: '100123', nombre: 'Ana Ramírez' };

const marca = (milis) => ({ toMillis: () => milis });

describe('inventario: lo que se teclea', () => {
  it('nombre completo: marca, nombre y presentación', () => {
    assert.equal(nombreCompleto(TORTILLAS), 'Mission Tortillas de maíz 30 pzas');
    assert.equal(nombreCompleto(CHILES), 'Chiles poblanos');
    assert.equal(nombreCompleto({}), 'Producto');
  });
  it('piezas: enteros de 1 a 99 999', () => {
    assert.equal(piezasDesdeTexto(' 24 '), 24);
    assert.equal(piezasDesdeTexto('99999'), 99999);
    for (const malo of ['0', '-3', '2.5', '100000', '', 'doce']) assert.throws(() => piezasDesdeTexto(malo), /.+/, malo);
  });
  it('kilos → gramos enteros, sin flotantes', () => {
    assert.equal(kilosDesdeTexto('12.5'), 12500);
    assert.equal(kilosDesdeTexto('0,750'), 750);
    assert.equal(kilosDesdeTexto('25 kg'), 25000);
    assert.equal(kilosDesdeTexto('.5'), 500);
    assert.equal(kilosDesdeTexto('1.001'), 1001);
    for (const malo of ['0', '', '.', '1.0001', 'abc', '-2', '123456']) assert.throws(() => kilosDesdeTexto(malo), /.+/, malo);
    assert.equal(textoKilos(12500), '12.5');
    assert.equal(textoKilos(1001), '1.001');
    assert.equal(textoKilos(3000), '3');
    assert.equal(textoKilos(null), '');
  });
  it('multiplicador «24*código»', () => {
    assert.deepEqual(separarMultiplicador('24*012345678905'), { cantidad: 24, codigo: '012345678905' });
    assert.deepEqual(separarMultiplicador('6 x tortillas'), { cantidad: 6, codigo: 'tortillas' });
    assert.deepEqual(separarMultiplicador('012345678905'), { cantidad: null, codigo: '012345678905' });
    assert.deepEqual(separarMultiplicador('  '), { cantidad: null, codigo: '' });
    assert.throws(() => separarMultiplicador('0*012345678905'), /al menos 1/);
  });
});

describe('inventario: líneas y entregas', () => {
  it('línea por pieza y por peso', () => {
    assert.deepEqual(lineaDeRecepcion(TORTILLAS), { producto: 'p-tortillas', nombre: 'Mission Tortillas de maíz 30 pzas', upc: '012345678905', plu: null, cantidad: 1, pesoGramos: null });
    assert.deepEqual(lineaDeRecepcion(TORTILLAS, { cantidad: 24 }).cantidad, 24);
    const peso = lineaDeRecepcion(CHILES);
    assert.equal(peso.cantidad, null);
    assert.equal(peso.pesoGramos, null);
    assert.deepEqual(erroresDeLinea(peso), ['falta el peso']);
    assert.deepEqual(erroresDeLinea({ ...peso, pesoGramos: 1530 }), []);
  });
  it('lo que no está en el catálogo entra con el nombre tecleado', () => {
    const l = lineaSinRegistrar({ upc: '036000291452', nombre: '  Salsa   nueva ' });
    assert.deepEqual(l, { producto: null, nombre: 'Salsa nueva', upc: '036000291452', plu: null, cantidad: 1, pesoGramos: null });
    assert.equal(claveDeLinea(l), 'u:036000291452');
    assert.equal(claveDeLinea(lineaDeRecepcion(TORTILLAS)), 'p:p-tortillas');
    assert.throws(() => lineaSinRegistrar({ upc: '1', nombre: ' ' }), /nombre/);
  });
  it('armarRecepcion: totales, líneas juntas, textos limpios y lo que piden las reglas', () => {
    const r = armarRecepcion({
      lineas: [lineaDeRecepcion(TORTILLAS, { cantidad: 24 }), { ...lineaDeRecepcion(CHILES), pesoGramos: 1530 }, lineaDeRecepcion(TORTILLAS, { cantidad: 6 })],
      tienda: 'talbot',
      proveedor: '  Bimbo  ',
      referencia: '',
      nota: null,
    }, PERSONAL);
    assert.deepEqual(Object.keys(r).sort(), ['anulada', 'anuladaEn', 'anuladaPor', 'gramos', 'lineas', 'nota', 'piezas', 'productos', 'proveedor', 'recibidoPor', 'recibidoPorNombre', 'referencia', 'tienda'].sort());
    assert.equal(r.productos, 2);
    assert.equal(r.lineas.length, 2);
    assert.equal(r.lineas[0].cantidad, 30);
    assert.equal(r.piezas, 30);
    assert.equal(r.gramos, 1530);
    assert.equal(r.proveedor, 'Bimbo');
    assert.equal(r.referencia, null);
    assert.equal(r.recibidoPor, '100123');
    assert.equal(r.recibidoPorNombre, 'Ana Ramírez');
    assert.equal(r.anulada, false);
    for (const l of r.lineas) assert.ok(Number.isInteger(l.cantidad ?? l.pesoGramos));
  });
  it('armarRecepcion rechaza lo que no cuadra', () => {
    assert.throws(() => armarRecepcion({ lineas: [] }, PERSONAL), /al menos un producto/);
    assert.throws(() => armarRecepcion({ lineas: [lineaDeRecepcion(CHILES)] }, PERSONAL), /falta el peso/);
    assert.throws(() => armarRecepcion({ lineas: [lineaDeRecepcion(TORTILLAS)], tienda: 'Tienda Uno' }, PERSONAL), /tienda/);
    assert.throws(() => armarRecepcion({ lineas: [{ ...lineaDeRecepcion(TORTILLAS), cantidad: 2.5 }] }, PERSONAL), /cantidad no válida/);
    assert.throws(() => armarRecepcion({ lineas: [lineaDeRecepcion(TORTILLAS, { cantidad: 60000 }), lineaDeRecepcion(TORTILLAS, { cantidad: 60000 })] }, PERSONAL), /como máximo/);
    const muchas = Array.from({ length: LIMITES_RECEPCION.lineas + 1 }, (_, i) => lineaSinRegistrar({ upc: String(i), nombre: `Cosa ${i}` }));
    assert.throws(() => armarRecepcion({ lineas: muchas }, PERSONAL), /como máximo 300/);
  });
  it('textos de cantidades', () => {
    assert.equal(textoCantidades({ piezas: 1 }), '1 pieza');
    assert.equal(textoCantidades({ piezas: 48, gramos: 12500 }), '48 piezas · 12.500 kg');
    assert.equal(textoCantidades({}), '—');
    assert.equal(textoLinea({ cantidad: null, pesoGramos: 1530 }), '1.530 kg');
  });
});

describe('inventario: lo que llegó', () => {
  const r1 = { id: 'r1', tienda: 'talbot', proveedor: 'Bimbo', referencia: 'F-100', fecha: marca(1000), anulada: false, piezas: 30, gramos: 0, lineas: [lineaDeRecepcion(TORTILLAS, { cantidad: 30 })], recibidoPorNombre: 'Ana' };
  const r2 = { id: 'r2', tienda: 'centro', proveedor: 'Verduras Sol', referencia: null, fecha: marca(3000), anulada: false, piezas: 12, gramos: 1530, lineas: [lineaDeRecepcion(TORTILLAS, { cantidad: 12 }), { ...lineaDeRecepcion(CHILES), pesoGramos: 1530 }], recibidoPorNombre: 'Luis' };
  const r3 = { id: 'r3', tienda: null, proveedor: 'Bimbo', referencia: null, fecha: marca(2000), anulada: true, piezas: 99, gramos: 0, lineas: [lineaDeRecepcion(TORTILLAS, { cantidad: 99 })], recibidoPorNombre: 'Ana' };

  it('por producto: suma piezas y kilos, cuenta entregas, sin las anuladas', () => {
    const resumen = resumirPorProducto([r1, r2, r3]);
    assert.equal(resumen.length, 2);
    const [chiles, tortillas] = resumen;
    assert.equal(chiles.nombre, 'Chiles poblanos');
    assert.equal(chiles.gramos, 1530);
    assert.equal(tortillas.piezas, 42);
    assert.equal(tortillas.entregas, 2);
    assert.equal(tortillas.ultima, 3000);
    assert.deepEqual(tortillas.proveedores, ['Bimbo', 'Verduras Sol']);
  });
  it('filtros: tienda, sin tienda, proveedor y búsqueda en líneas, proveedor o factura', () => {
    assert.ok(cumpleFiltrosRecepcion(r1, { tienda: 'talbot' }));
    assert.ok(!cumpleFiltrosRecepcion(r2, { tienda: 'talbot' }));
    assert.ok(cumpleFiltrosRecepcion(r3, { tienda: '-' }));
    assert.ok(!cumpleFiltrosRecepcion(r1, { tienda: '-' }));
    assert.ok(cumpleFiltrosRecepcion(r1, { proveedor: 'bimbo' }));
    assert.ok(cumpleFiltrosRecepcion(r2, { buscar: 'poblano' }));
    assert.ok(cumpleFiltrosRecepcion(r1, { buscar: 'f-100' }));
    assert.ok(!cumpleFiltrosRecepcion(r1, { buscar: 'poblano' }));
  });
  it('con búsqueda cuentan solo las líneas que coinciden; si coincidió el proveedor, todas', () => {
    assert.deepEqual(lineasVisibles(r2, 'poblano').map((l) => l.nombre), ['Chiles poblanos']);
    assert.equal(lineasVisibles(r2, 'verduras').length, 2);
    assert.deepEqual(lineasVisibles(r1, 'poblano'), []);
    assert.equal(lineasVisibles(r1, '').length, 1);
    const t = totalesRecepciones([r1, r2, r3], { buscar: 'poblano' });
    assert.deepEqual(t, { entregas: 1, anuladas: 0, piezas: 0, gramos: 1530, productos: 1 });
    assert.deepEqual(totalesRecepciones([r1, r2, r3], { buscar: 'bimbo' }), { entregas: 1, anuladas: 1, piezas: 30, gramos: 0, productos: 1 });
    assert.deepEqual(totalesRecepciones([r1, r2, r3]), { entregas: 2, anuladas: 1, piezas: 42, gramos: 1530, productos: 2 });
    assert.equal(resumirPorProducto([r1, r2], { buscar: 'poblano' }).length, 1);
  });
  it('CSV: una fila por línea, de la más antigua a la más reciente', () => {
    const filas = filasCSVRecepciones([r2, r1, r3], { fechaTexto: (f) => String(f.toMillis()), nombreTienda: (id) => id.toUpperCase() });
    assert.equal(filas[0].join(','), 'fecha,tienda,proveedor,referencia,recibio,producto,upc,plu,piezas,kg,estado,nota');
    assert.equal(filas.length, 5);
    assert.deepEqual(filas[1].slice(0, 3), ['1000', 'TALBOT', 'Bimbo']);
    assert.equal(filas[2][10], 'anulada');
    assert.deepEqual(filas[4].slice(5, 10), ['Chiles poblanos', '', '4705', '', '1.53']);
  });
});
