import assert from 'node:assert/strict';
import {
  LIMITES_RECEPCION, nombreCompleto, piezasDesdeTexto, kilosDesdeTexto, textoKilos, separarMultiplicador, lineaDeRecepcion,
  lineaSinRegistrar, claveDeLinea, erroresDeLinea, armarRecepcion, textoCantidades, textoLinea, cumpleFiltrosRecepcion,
  lineasVisibles, resumirPorProducto, totalesRecepciones, filasCSVRecepciones,
  conteoDesdeTexto, textoTotal, textoDesglose, caducidadDesdeTexto, origenDesdeTexto, paisEnPantalla, paisesSugeridos, estadoCaducidad, armarAjuste,
  totalExistencia, filasExistencias, filasCSVExistencias, cantidadActual, movidoDesdeConteo, textoMovido,
  movimientosDeVenta, movimientosDeRecepcion, cuentaDesdeConteo,
} from '../../js/inventario.js';
import { cargarIngles, fijarIdioma } from '../../js/idioma.js';

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

describe('existencias: ajuste rápido de la tienda y la bodega', () => {
  it('cajas × lo que trae cada una + sueltas = total; todo vacío = ese lugar no se contó', () => {
    assert.deepEqual(conteoDesdeTexto({ cajas: '3', porCaja: '12', sueltas: '4' }), { cajas: 3, porCaja: 12, sueltas: 4, total: 40 });
    assert.deepEqual(conteoDesdeTexto({ cajas: '10', porCaja: '24' }), { cajas: 10, porCaja: 24, sueltas: null, total: 240 });
    assert.deepEqual(conteoDesdeTexto({ sueltas: '7' }), { cajas: null, porCaja: null, sueltas: 7, total: 7 });
    assert.deepEqual(conteoDesdeTexto({ sueltas: '0' }), { cajas: null, porCaja: null, sueltas: 0, total: 0 }, 'no hay ninguna también es un conteo');
    assert.deepEqual(conteoDesdeTexto({ cajas: '0', sueltas: '5' }), { cajas: null, porCaja: null, sueltas: 5, total: 5 }, '«0 cajas» sin más no cuenta');
    assert.equal(conteoDesdeTexto({ cajas: ' ', porCaja: '', sueltas: '' }), null);
    assert.equal(conteoDesdeTexto(), null);
  });
  it('por peso: kilos por caja y kilos sueltos, en gramos', () => {
    assert.deepEqual(conteoDesdeTexto({ cajas: '2', porCaja: '10', sueltas: '1.5' }, { porPeso: true }), { cajas: 2, porCaja: 10000, sueltas: 1500, total: 21500 });
    assert.deepEqual(conteoDesdeTexto({ sueltas: '0' }, { porPeso: true }), { cajas: null, porCaja: null, sueltas: 0, total: 0 });
  });
  it('lo que no se puede contar se explica', () => {
    assert.throws(() => conteoDesdeTexto({ cajas: '3' }), /piezas trae cada caja/);
    assert.throws(() => conteoDesdeTexto({ cajas: '3' }, { porPeso: true }), /kilos trae cada caja/);
    assert.equal(conteoDesdeTexto({ porCaja: '12' }), null, 'solo lo que trae cada caja (del conteo anterior): ese lugar no se contó');
    assert.throws(() => conteoDesdeTexto({ cajas: '2.5', porCaja: '12' }), /Cajas/);
    assert.throws(() => conteoDesdeTexto({ cajas: '1', porCaja: '0' }), /Piezas por caja/);
    assert.throws(() => conteoDesdeTexto({ sueltas: '-3' }), /Sueltas/);
    assert.throws(() => conteoDesdeTexto({ cajas: '99999', porCaja: '99999999' }), /demasiado grande/);
  });
  it('cómo se lee: total y desglose', () => {
    assert.equal(textoTotal(40, false), '40 piezas');
    assert.equal(textoTotal(1, false), '1 pieza');
    assert.equal(textoTotal(21500, true), '21.500 kg');
    assert.equal(textoTotal(null, false), '—');
    assert.equal(textoDesglose({ cajas: 3, porCaja: 12, sueltas: 4 }, false), '3 cajas × 12 + 4');
    assert.equal(textoDesglose({ cajas: 1, porCaja: 10000, sueltas: null }, true), '1 caja × 10.000 kg');
    assert.equal(textoDesglose({ cajas: null, porCaja: null, sueltas: 7 }, false), '');
  });
  it('caducidad (fecha que existe) y país de procedencia', () => {
    assert.equal(caducidadDesdeTexto('2027-01-15'), '2027-01-15');
    assert.equal(caducidadDesdeTexto(''), null);
    assert.throws(() => caducidadDesdeTexto('2027-02-30'), /caducidad/);
    assert.throws(() => caducidadDesdeTexto('mañana'), /caducidad/);
    assert.equal(origenDesdeTexto('  México  '), 'México');
    assert.equal(origenDesdeTexto('mexico'), 'México', 'un país de la lista se guarda con su nombre');
    assert.equal(origenDesdeTexto(' Oaxaca '), 'Oaxaca', 'lo demás, como se escribió');
    assert.equal(origenDesdeTexto(' '), null);
    assert.equal(paisEnPantalla('Estados Unidos'), 'Estados Unidos');
    assert.equal(paisEnPantalla(null), null);
    assert.equal(estadoCaducidad('2026-11-11', '2026-11-12'), 'vencido');
    assert.equal(estadoCaducidad('2026-11-12', '2026-11-12'), 'pronto');
    assert.equal(estadoCaducidad('2026-11-19', '2026-11-12'), 'pronto');
    assert.equal(estadoCaducidad('2026-11-20', '2026-11-12'), null);
    assert.equal(estadoCaducidad(null, '2026-11-12'), null);
  });
  it('el ajuste se guarda con la identidad del producto y solo los lugares contados', () => {
    const tienda = conteoDesdeTexto({ cajas: '3', porCaja: '12', sueltas: '4' });
    const { id, datos } = armarAjuste({ producto: TORTILLAS, tienda: 'talbot', enTienda: tienda, caducidad: '2027-01-15', origen: 'México' }, PERSONAL);
    assert.equal(id, 'talbot__p-tortillas');
    assert.deepEqual(datos, {
      tienda: 'talbot', producto: 'p-tortillas', nombre: 'Mission Tortillas de maíz 30 pzas', upc: '012345678905', plu: null, porPeso: false,
      caducidad: '2027-01-15', origen: 'México', actualizadoPor: '100123', actualizadoPorNombre: 'Ana Ramírez',
      enTienda: { cajas: 3, porCaja: 12, sueltas: 4, total: 40, contadoPor: '100123', contadoPorNombre: 'Ana Ramírez' },
      vendidoTienda: 0,
    });
    assert.ok(!('enBodega' in datos) && !('recibidoBodega' in datos), 'la bodega no se contó: no se escribe (queda como estaba, con lo recibido)');
    assert.equal(armarAjuste({ producto: TORTILLAS, tienda: 'talbot', enBodega: tienda }, PERSONAL).datos.recibidoBodega, 0, 'contar la bodega pone en cero lo recibido');
    const soloPeso = armarAjuste({ producto: CHILES, tienda: 'talbot' }, PERSONAL).datos;
    assert.equal(soloPeso.porPeso, true);
    assert.ok(!('caducidad' in soloPeso) && !('origen' in soloPeso), 'caducidad y país sin tocar: no se escriben (no pisan lo de otra persona)');
    const borrados = armarAjuste({ producto: CHILES, tienda: 'talbot', caducidad: null, origen: null }, PERSONAL).datos;
    assert.ok(borrados.caducidad === null && borrados.origen === null, 'borrarlos sí se escribe');
    assert.throws(() => armarAjuste({ producto: TORTILLAS, tienda: '' }, PERSONAL), /tienda/);
    assert.throws(() => armarAjuste({ producto: { nombre: 'sin id' }, tienda: 'talbot' }, PERSONAL), /producto/);
  });
  it('la tabla: total de tienda y bodega, búsqueda, lo que caduca pronto y el CSV', () => {
    const lista = [
      { tienda: 'talbot', nombre: 'Tortillas', upc: '012345678905', porPeso: false, caducidad: '2026-11-14', origen: 'México', enTienda: { total: 40, contadoEn: marca(1) }, enBodega: { total: 120, contadoEn: marca(2) } },
      { tienda: 'talbot', nombre: 'Chiles poblanos', plu: '4705', porPeso: true, caducidad: null, origen: 'Guatemala', enBodega: { total: 21500, contadoEn: marca(3) } },
      { tienda: 'talbot', nombre: 'Aguacate', porPeso: true, caducidad: '2027-01-01', origen: null },
    ];
    assert.equal(totalExistencia(lista[0]), 160);
    assert.equal(totalExistencia(lista[1]), 21500);
    assert.equal(totalExistencia(lista[2]), null);
    assert.deepEqual(filasExistencias(lista).map((e) => e.nombre), ['Aguacate', 'Chiles poblanos', 'Tortillas']);
    assert.deepEqual(filasExistencias(lista, { buscar: 'guatemala' }).map((e) => e.nombre), ['Chiles poblanos']);
    assert.deepEqual(filasExistencias(lista, { porCaducar: true, hoy: '2026-11-12' }).map((e) => e.nombre), ['Tortillas']);
    const csv = filasCSVExistencias(filasExistencias(lista), { fechaTexto: (m) => `t${m.toMillis()}`, nombreTienda: () => 'Talbot' });
    assert.deepEqual(csv[0], ['tienda', 'producto', 'upc', 'plu', 'unidad', 'en_tienda', 'vendido_desde_conteo', 'en_bodega', 'recibido_desde_conteo', 'total',
      'caducidad', 'origen', 'contado_tienda', 'contado_bodega']);
    assert.deepEqual(csv[2], ['Talbot', 'Chiles poblanos', '', '4705', 'kg', '', '', '21.5', '', '21.5', '', 'Guatemala', '', 't3']);
    assert.deepEqual(csv[3], ['Talbot', 'Tortillas', '012345678905', '', 'piezas', 40, '', 120, '', 160, '2026-11-14', 'México', 't1', 't2']);
  });
  it('lo que hay ahora: lo contado menos lo vendido (tienda) y más lo recibido (bodega)', () => {
    const e = { porPeso: false, enTienda: { total: 40 }, enBodega: { total: 120 }, vendidoTienda: 12, recibidoBodega: 48 };
    assert.equal(movidoDesdeConteo(e, 'enTienda'), 12);
    assert.equal(cantidadActual(e, 'enTienda'), 28);
    assert.equal(cantidadActual(e, 'enBodega'), 168);
    assert.equal(totalExistencia(e), 196);
    assert.equal(textoMovido(e, 'enTienda'), 'Vendido desde el conteo: 12 piezas');
    assert.equal(textoMovido(e, 'enBodega'), 'Recibido desde el conteo: 48 piezas');
    assert.equal(textoMovido({ ...e, vendidoTienda: -2 }, 'enTienda'), 'Devuelto desde el conteo: 2 piezas', 'más devoluciones que ventas');
    assert.equal(textoMovido({ ...e, vendidoTienda: 0 }, 'enTienda'), '');
    // Sin conteo: lo movido se dice, pero no hay cuánto hay.
    const sinConteo = { porPeso: true, vendidoTienda: 1750, recibidoBodega: 12500 };
    assert.equal(cantidadActual(sinConteo, 'enTienda'), null);
    assert.equal(totalExistencia(sinConteo), null);
    assert.equal(textoMovido(sinConteo, 'enTienda'), 'Vendido: 1.750 kg');
    assert.equal(textoMovido(sinConteo, 'enBodega'), 'Recibido: 12.500 kg');
    assert.equal(cantidadActual({ ...e, vendidoTienda: 45 }, 'enTienda'), -5, 'puede quedar en negativo (se surtió sin contar): se ve para contar de nuevo');
    const csv = filasCSVExistencias([{ ...e, tienda: 't', nombre: 'Tortillas' }, { ...sinConteo, tienda: 't', nombre: 'Chiles', enBodega: { total: 500 }, recibidoBodega: -1000 }], { fechaTexto: String, nombreTienda: () => 'T' });
    assert.deepEqual(csv[1].slice(5, 10), [28, 12, 168, 48, 196]);
    assert.deepEqual(csv[2].slice(5, 10), ['', '1.75', '-0.5', '-1', '-0.5']);
  });
  it('lo que mueve una venta de la caja: por producto, en piezas o en gramos; la devolución al revés', () => {
    const catalogo = new Map([
      ['p-tortillas', TORTILLAS],
      ['p-poblano', { ...CHILES, precioPorKgCentavos: 2198 }],
    ]);
    const producto = (id) => catalogo.get(id) ?? null;
    const linea = (extra) => ({ productoId: null, unidad: 'pieza', cantidad: 1, pesoGramos: null, precioUnitarioCentavos: 100, ...extra });
    const venta = {
      tipo: 'venta',
      lineas: [
        linea({ productoId: 'p-tortillas', cantidad: 2 }),
        linea({ departamento: 'abarrotes' }), // venta libre: no cuenta
        linea({ productoId: 'p-tortillas', cantidad: 3 }),
        linea({ productoId: 'p-poblano', unidad: 'peso', cantidad: null, pesoGramos: 1250 }),
        linea({ productoId: 'p-poblano', cantidad: 1, precioUnitarioCentavos: 1099 }), // etiqueta de balanza: $10.99 a $21.98/kg = 500 g
        linea({ productoId: 'p-borrado', cantidad: 4 }), // ya no está en el catálogo
      ],
    };
    assert.deepEqual(movimientosDeVenta(venta, producto), [
      { producto: 'p-tortillas', linea: 0, cantidad: 5 },
      { producto: 'p-poblano', linea: 3, cantidad: 1750 },
    ]);
    const devolucion = { tipo: 'devolucion', lineas: [linea({ productoId: 'p-tortillas', cantidad: -1 }), linea({ productoId: 'p-poblano', unidad: 'peso', cantidad: null, pesoGramos: -500 })] };
    assert.deepEqual(movimientosDeVenta(devolucion, producto), [{ producto: 'p-tortillas', linea: 0, cantidad: -1 }, { producto: 'p-poblano', linea: 1, cantidad: -500 }]);
    assert.deepEqual(movimientosDeVenta({ lineas: [linea({ productoId: 'p-poblano', cantidad: 1 })] }, (id) => (id === 'p-poblano' ? CHILES : null)), [], 'por peso sin precio por kilo: no se sabe cuánto');
  });
  it('un movimiento cuenta solo donde hay existencias y si pasó después del último conteo de ese lugar', () => {
    const e = { enTienda: { total: 40, contadoEn: marca(1000) } };
    assert.equal(cuentaDesdeConteo(e, 'enTienda', 2000), true, 'vendido después del conteo');
    assert.equal(cuentaDesdeConteo(e, 'enTienda', 500), false, 'vendido antes: ya está en el conteo');
    assert.equal(cuentaDesdeConteo(e, 'enTienda', 1000), false);
    assert.equal(cuentaDesdeConteo(e, 'enBodega', 500), true, 'la bodega no se ha contado: cuenta');
    assert.equal(cuentaDesdeConteo(null, 'enTienda', 2000), false, 'sin existencias en esa tienda: no se manda nada');
    assert.equal(cuentaDesdeConteo(e, 'enTienda', Number.NaN), false);
  });
  it('lo que mueve una entrega: renglón por renglón, solo lo del catálogo y con tienda', () => {
    const recepcion = {
      tienda: 'talbot',
      lineas: [
        lineaDeRecepcion(TORTILLAS, { cantidad: 24 }),
        lineaSinRegistrar({ upc: '036000291452', nombre: 'Galletas', cantidad: 6 }),
        lineaDeRecepcion(CHILES, { pesoGramos: 12500 }),
      ],
    };
    assert.deepEqual(movimientosDeRecepcion(recepcion), [
      { producto: 'p-tortillas', linea: 0, cantidad: 24, nombre: 'Mission Tortillas de maíz 30 pzas', upc: '012345678905', plu: null, porPeso: false },
      { producto: 'p-poblano', linea: 2, cantidad: 12500, nombre: 'Chiles poblanos', upc: null, plu: '4705', porPeso: true },
    ]);
    assert.deepEqual(movimientosDeRecepcion({ ...recepcion, tienda: null }), [], 'sin tienda no suma a ninguna bodega');
  });
  it('en inglés: los textos y el CSV', async () => {
    await cargarIngles();
    fijarIdioma('en');
    try {
      assert.equal(textoTotal(40, false), '40 pieces');
      assert.equal(textoDesglose({ cajas: 3, porCaja: 12, sueltas: 4 }, false), '3 boxes × 12 + 4');
      assert.throws(() => conteoDesdeTexto({ cajas: '3' }), /how many pieces come in each box/);
      assert.equal(filasCSVExistencias([], { fechaTexto: String, nombreTienda: String })[0][5], 'in_store');
      // los países: en inglés se ven en inglés, pero se guardan igual que en español
      assert.ok(paisesSugeridos().includes('United States') && paisesSugeridos().includes('Mexico'));
      assert.equal(origenDesdeTexto('United States'), 'Estados Unidos');
      assert.equal(origenDesdeTexto('Mexico'), 'México');
      assert.equal(paisEnPantalla('Estados Unidos'), 'United States');
      assert.equal(paisEnPantalla('Oaxaca'), 'Oaxaca');
      const enIngles = [{ tienda: 't', nombre: 'Frijol', porPeso: false, origen: 'Estados Unidos' }];
      assert.equal(filasExistencias(enIngles, { buscar: 'united' }).length, 1, 'se busca por el nombre que se ve');
      assert.equal(filasCSVExistencias(enIngles, { fechaTexto: String, nombreTienda: String })[1][11], 'United States');
      assert.equal(textoMovido({ porPeso: false, enTienda: { total: 40 }, vendidoTienda: 12 }, 'enTienda'), 'Sold since the count: 12 pieces');
      assert.equal(textoMovido({ porPeso: true, recibidoBodega: 12500 }, 'enBodega'), 'Received: 12.500 kg');
    } finally {
      fijarIdioma(null);
    }
  });
});

