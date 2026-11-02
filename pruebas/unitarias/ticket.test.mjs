import assert from 'node:assert/strict';
import {
  dividirRedondeado, redondearEfectivo, repartirProporcional, gramosDesdeTexto, formatearPeso, cantidadDesdeTexto,
  puntosBaseDesdeTexto, formatearPorcentaje, formatearMonto, lineaDeProducto, lineaDeDepartamento, importeBruto,
  lineaAcumulable, calcularTicket, estadoCobro, registrarPago, armarVenta, validarVenta, requiereAutorizacion,
  folioVenta, digitosFolio, folioDesdeTexto, claveDia, interpretarCodigoBalanza, TASA_HST_BP, CAMPOS_VENTA,
} from '../../js/ticket.js';

const TAJIN = { id: 'p-tajin', upc: '633148100013', plu: null, nombre: 'Clasico', marca: 'Tajin', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', precioPorKgCentavos: null, claseFiscal: 'gravado' };
const AGUACATE = { id: 'p-aguacate', upc: null, plu: '4225', nombre: 'Aguacate', marca: null, presentacion: '', precioCentavos: 100, unidadVenta: 'peso', precioPorKgCentavos: 549, claseFiscal: 'tasaCero' };
const ABARROTES = { id: 'abarrotes', nombre: 'Abarrotes', claseFiscal: 'tasaCero' };

/** Cobra un ticket y arma la venta con datos de caja de prueba. */
function vender(calculo, pagos, extra = {}) {
  return armarVenta(calculo, pagos, {
    folio: '261102-01-0042', numero: 42, dia: '2026-11-02', turno: 't1', caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1,
    tienda: 'talbot', tiendaNombre: 'Águila Talbot', cajero: '100123', cajeroNombre: 'María', fecha: new Date(2026, 10, 2, 14, 32), ...extra,
  });
}

describe('aritmética entera', () => {
  it('divide redondeando la mitad lejos de cero', () => {
    assert.equal(dividirRedondeado(5, 2), 3);
    assert.equal(dividirRedondeado(-5, 2), -3);
    assert.equal(dividirRedondeado(4, 2), 2);
    assert.equal(dividirRedondeado(686250, 1000), 686);
    assert.equal(dividirRedondeado(686500, 1000), 687);
    assert.equal(dividirRedondeado(1, 3), 0);
    assert.equal(dividirRedondeado(2, 3), 1);
    assert.throws(() => dividirRedondeado(1.5, 2));
    assert.throws(() => dividirRedondeado(1, 0));
  });

  it('redondea el efectivo a 5 ¢ como en Canadá, también en devoluciones', () => {
    const casos = { 1000: 1000, 1001: 1000, 1002: 1000, 1003: 1005, 1004: 1005, 1005: 1005, 1006: 1005, 1007: 1005, 1008: 1010, 1009: 1010, 0: 0, 1: 0, 2: 0, 3: 5 };
    for (const [entrada, salida] of Object.entries(casos)) assert.equal(redondearEfectivo(Number(entrada)), salida, entrada);
    assert.equal(redondearEfectivo(-1003), -1005);
    assert.equal(redondearEfectivo(-1002), -1000);
  });

  it('reparte un descuento en partes enteras proporcionales que suman exacto', () => {
    assert.deepEqual(repartirProporcional(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(repartirProporcional(168, [998, 686]), [100, 68]);
    assert.deepEqual(repartirProporcional(0, [5, 5]), [0, 0]);
    assert.deepEqual(repartirProporcional(10, [0, 0]), [0, 0]);
    const grande = repartirProporcional(9_999_999, [9_000_000_001, 7, 3]);
    assert.equal(grande.reduce((a, b) => a + b, 0), 9_999_999);
  });
});

describe('lo que teclea la cajera', () => {
  it('lee pesos en kilos sin flotantes', () => {
    assert.equal(gramosDesdeTexto('1.25'), 1250);
    assert.equal(gramosDesdeTexto('1,250'), 1250);
    assert.equal(gramosDesdeTexto('0.5'), 500);
    assert.equal(gramosDesdeTexto('.5'), 500);
    assert.equal(gramosDesdeTexto('2'), 2000);
    assert.equal(gramosDesdeTexto('1.005 kg'), 1005);
    for (const malo of ['', '.', '0', '1.2345', 'abc', '100', '-1']) assert.throws(() => gramosDesdeTexto(malo), malo);
    assert.equal(formatearPeso(1250), '1.250 kg');
    assert.equal(formatearPeso(-500), '-0.500 kg');
  });

  it('lee cantidades, porcentajes y formatea montos con signo', () => {
    assert.equal(cantidadDesdeTexto('3'), 3);
    assert.throws(() => cantidadDesdeTexto('0'));
    assert.throws(() => cantidadDesdeTexto('1000'));
    assert.throws(() => cantidadDesdeTexto('2.5'));
    assert.equal(puntosBaseDesdeTexto('10'), 1000);
    assert.equal(puntosBaseDesdeTexto('12.5'), 1250);
    assert.equal(puntosBaseDesdeTexto('10%'), 1000);
    assert.equal(puntosBaseDesdeTexto('100'), 10000);
    assert.throws(() => puntosBaseDesdeTexto('0'));
    assert.throws(() => puntosBaseDesdeTexto('101'));
    assert.equal(formatearPorcentaje(1250), '12.5 %');
    assert.equal(formatearPorcentaje(1000), '10 %');
    assert.equal(formatearMonto(-499), '-$4.99');
    assert.equal(formatearMonto(123456), '$1,234.56');
  });
});

describe('líneas', () => {
  it('arma líneas por pieza, por peso y por departamento', () => {
    const tajin = lineaDeProducto(TAJIN, { cantidad: 2 });
    assert.equal(tajin.nombre, 'Tajin Clasico');
    assert.equal(importeBruto(tajin), 998);
    const aguacate = lineaDeProducto(AGUACATE, { pesoGramos: 1250 });
    assert.equal(aguacate.unidad, 'peso');
    assert.equal(aguacate.precioUnitarioCentavos, 549);
    assert.equal(importeBruto(aguacate), 686); // 1.25 kg × 5.49 = 6.8625
    assert.throws(() => lineaDeProducto(AGUACATE), /peso/);
    const varios = lineaDeDepartamento(ABARROTES, 350, { upc: '012345678905' });
    assert.equal(varios.departamento, 'abarrotes');
    assert.equal(varios.upc, '012345678905');
    assert.throws(() => lineaDeDepartamento(ABARROTES, 0));
  });

  it('suma piezas a la última línea solo si es el mismo producto sin cambios', () => {
    const linea = lineaDeProducto(TAJIN);
    assert.ok(lineaAcumulable(linea, TAJIN));
    assert.ok(!lineaAcumulable(linea, AGUACATE));
    assert.ok(!lineaAcumulable({ ...linea, descuento: { tipo: 'monto', centavos: 10 } }, TAJIN));
    assert.ok(!lineaAcumulable({ ...linea, precioOriginalCentavos: 600 }, TAJIN));
  });
});

describe('totales del ticket', () => {
  it('calcula el HST una vez sobre la base gravada', () => {
    const t = calcularTicket([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(AGUACATE, { pesoGramos: 1250 })]);
    assert.equal(t.brutoCentavos, 1684);
    assert.equal(t.subtotalCentavos, 1684);
    assert.equal(t.baseGravadaCentavos, 998);
    assert.equal(t.baseTasaCeroCentavos, 686);
    assert.equal(t.tasaImpuestoBP, TASA_HST_BP);
    assert.equal(t.impuestoCentavos, 130); // 998 × 13 % = 129.74
    assert.equal(t.totalCentavos, 1814);
    assert.equal(t.articulos, 3);
  });

  it('aplica descuentos de línea y de ticket antes del impuesto', () => {
    const tajin = { ...lineaDeProducto(TAJIN, { cantidad: 2 }), descuento: { tipo: 'porcentaje', puntosBase: 1000 } };
    const conLinea = calcularTicket([tajin, lineaDeProducto(AGUACATE, { pesoGramos: 1250 })]);
    assert.equal(conLinea.descuentoLineasCentavos, 100); // 99.8
    assert.equal(conLinea.subtotalCentavos, 1584);
    assert.equal(conLinea.impuestoCentavos, 117); // 898 × 13 % = 116.74

    const conTicket = calcularTicket([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(AGUACATE, { pesoGramos: 1250 })], { descuentoTicket: { tipo: 'porcentaje', puntosBase: 1000 } });
    assert.equal(conTicket.descuentoTicketCentavos, 168);
    assert.deepEqual(conTicket.lineas.map((l) => l.descuentoTicketCentavos), [100, 68]);
    assert.equal(conTicket.baseGravadaCentavos, 898);
    assert.equal(conTicket.baseTasaCeroCentavos, 618);
    assert.equal(conTicket.impuestoCentavos, 117);
    assert.equal(conTicket.totalCentavos, 1633);

    const tope = calcularTicket([lineaDeProducto(TAJIN)], { descuentoTicket: { tipo: 'monto', centavos: 10_000 } });
    assert.equal(tope.descuentoTicketCentavos, 499);
    assert.equal(tope.totalCentavos, 0);
  });

  it('una devolución lleva todo en negativo, impuesto incluido', () => {
    const t = calcularTicket([lineaDeProducto(TAJIN, { cantidad: -1 })], { descuentoTicket: { tipo: 'porcentaje', puntosBase: 1000 } });
    assert.equal(t.subtotalCentavos, -499);
    assert.equal(t.descuentoTicketCentavos, 0);
    assert.equal(t.impuestoCentavos, -65); // −64.87
    assert.equal(t.totalCentavos, -564);
    assert.equal(t.articulos, -1);
  });
});

describe('cobro', () => {
  const ticket = () => calcularTicket([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(AGUACATE, { pesoGramos: 1250 })]); // 18.14

  it('efectivo: redondea a 5 ¢, calcula el cambio y guarda el redondeo', () => {
    const t = ticket();
    const { pago, completo, cambioCentavos } = registrarPago(t.totalCentavos, [], { metodo: 'efectivo', montoCentavos: 2000 });
    assert.ok(completo);
    assert.equal(pago.importeCentavos, 1815);
    assert.equal(cambioCentavos, 185);
    const venta = vender(t, [pago]);
    assert.equal(venta.redondeoCentavos, 1);
    assert.equal(venta.porMetodo.efectivo, 1815);
    assert.equal(venta.cambioCentavos, 185);
    assert.deepEqual(validarVenta(venta), []);
  });

  it('efectivo exacto sin monto y montos que no terminan en 0 o 5', () => {
    const t = ticket();
    assert.equal(registrarPago(t.totalCentavos, [], { metodo: 'efectivo' }).pago.recibidoCentavos, 1815);
    assert.throws(() => registrarPago(t.totalCentavos, [], { metodo: 'efectivo', montoCentavos: 2001 }), /terminar en 0 o 5/);
  });

  it('pago mixto: parte en efectivo y el resto con tarjeta, exacto', () => {
    const t = ticket();
    const primero = registrarPago(t.totalCentavos, [], { metodo: 'efectivo', montoCentavos: 1000 });
    assert.ok(!primero.completo);
    assert.equal(estadoCobro(t.totalCentavos, [primero.pago]).pendienteCentavos, 814);
    const segundo = registrarPago(t.totalCentavos, [primero.pago], { metodo: 'debito' });
    assert.ok(segundo.completo);
    assert.equal(segundo.pago.importeCentavos, 814);
    const venta = vender(t, [primero.pago, segundo.pago]);
    assert.equal(venta.redondeoCentavos, 0);
    assert.deepEqual([venta.porMetodo.efectivo, venta.porMetodo.debito], [1000, 814]);
    assert.deepEqual(validarVenta(venta), []);
  });

  it('tarjeta primero y el resto en efectivo redondeado', () => {
    const t = ticket();
    const tarjeta = registrarPago(t.totalCentavos, [], { metodo: 'credito', montoCentavos: 1000 });
    const efectivo = registrarPago(t.totalCentavos, [tarjeta.pago], { metodo: 'efectivo', montoCentavos: 1000 });
    assert.ok(efectivo.completo);
    assert.equal(efectivo.pago.importeCentavos, 815);
    assert.equal(efectivo.cambioCentavos, 185);
    assert.equal(vender(t, [tarjeta.pago, efectivo.pago]).redondeoCentavos, 1);
  });

  it('una tarjeta nunca cobra de más y no se cobra un ticket ya pagado', () => {
    const t = ticket();
    const { pago, completo } = registrarPago(t.totalCentavos, [], { metodo: 'debito', montoCentavos: 99999 });
    assert.ok(completo);
    assert.equal(pago.importeCentavos, 1814);
    assert.throws(() => registrarPago(t.totalCentavos, [pago], { metodo: 'efectivo' }), /ya está pagado/);
  });

  it('devolución en efectivo redondeada o en tarjeta exacta', () => {
    const t = calcularTicket([lineaDeProducto(TAJIN, { cantidad: -1 })]); // −5.64
    const efectivo = registrarPago(t.totalCentavos, [], { metodo: 'efectivo' });
    assert.equal(efectivo.pago.importeCentavos, -565);
    const venta = vender(t, [efectivo.pago], { tipo: 'devolucion', autorizacion: 'a1', autorizadoPor: 'admin@aguila.test' });
    assert.equal(venta.redondeoCentavos, -1);
    assert.deepEqual(validarVenta(venta), []);
    assert.ok(requiereAutorizacion(venta));
    const tarjeta = registrarPago(t.totalCentavos, [], { metodo: 'debito' });
    assert.equal(tarjeta.pago.importeCentavos, -564);
  });

  it('un ticket en cero no necesita pago; uno pendiente no se puede guardar', () => {
    const cero = calcularTicket([lineaDeProducto(TAJIN)], { descuentoTicket: { tipo: 'porcentaje', puntosBase: 10000 } });
    assert.ok(estadoCobro(cero.totalCentavos, []).completo);
    assert.equal(vender(cero, []).pagos.length, 0);
    assert.throws(() => vender(ticket(), []), /Falta cobrar/);
  });
});

describe('documento de venta', () => {
  const t = calcularTicket([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(AGUACATE, { pesoGramos: 1250 })]);
  const venta = vender(t, [registrarPago(t.totalCentavos, [], { metodo: 'debito' }).pago]);

  it('lleva exactamente los campos del esquema (registradoEn lo pone el servidor)', () => {
    assert.deepEqual(Object.keys(venta).sort(), CAMPOS_VENTA.filter((c) => c !== 'registradoEn').sort());
    assert.equal(venta.tipo, 'venta');
    assert.equal(venta.lineas[1].pesoGramos, 1250);
    assert.equal(venta.lineas[1].cantidad, null);
    assert.ok(!requiereAutorizacion(venta));
  });

  it('la validación detecta totales alterados y campos de más', () => {
    assert.match(validarVenta({ ...venta, totalCentavos: venta.totalCentavos - 100 }).join(' '), /no cuadra/);
    assert.match(validarVenta({ ...venta, impuestoCentavos: 0, totalCentavos: venta.subtotalCentavos }).join(' '), /impuesto/);
    assert.match(validarVenta({ ...venta, extra: 1 }).join(' '), /de más/);
    const lineas = venta.lineas.map((l, i) => (i === 0 ? { ...l, importeCentavos: 1 } : l));
    assert.match(validarVenta({ ...venta, lineas }).join(' '), /Línea 1/);
    assert.match(validarVenta({ ...venta, tipo: 'devolucion' }).join(' '), /devolución/);
  });
});

describe('folio y códigos especiales', () => {
  it('folio legible y dígitos del código de barras del recibo', () => {
    const fecha = new Date(2026, 10, 2, 9, 5);
    assert.equal(folioVenta(fecha, 1, 42), '261102-01-0042');
    assert.equal(digitosFolio('261102-01-0042'), '261102010042');
    assert.equal(folioDesdeTexto('261102010042'), '261102-01-0042');
    assert.equal(folioDesdeTexto(' 261102-01-0042 '), '261102-01-0042');
    assert.equal(folioDesdeTexto('633148100013'.slice(0, 11)), null);
    assert.equal(claveDia(fecha), '2026-11-02');
    assert.throws(() => folioVenta(fecha, 100, 1));
    assert.throws(() => folioVenta(fecha, 1, 10000));
  });

  it('interpreta etiquetas de balanza con precio (prefijo 2)', () => {
    assert.deepEqual(interpretarCodigoBalanza('201234005995'), { plus: ['01234', '1234'], precioCentavos: 599 });
    assert.deepEqual(interpretarCodigoBalanza('212345012345'), { plus: ['12345'], precioCentavos: 1234 });
    assert.equal(interpretarCodigoBalanza('633148100013'), null);
    assert.equal(interpretarCodigoBalanza('201234000005'), null);
  });
});
