import assert from 'node:assert/strict';
import { lineaDeProducto, lineaDeDepartamento, calcularTicket, registrarPago, armarVenta } from '../../js/ticket.js';
import {
  resumirTurno, sumarResumenes, diferenciasResumen, minutosTurno, formatearDuracion, totalConteo, ventasNetas,
  milisDe, claveArticulo, efectoMovimiento,
} from '../../js/turnos.js';

const TAJIN = { id: 'p-tajin', upc: '633148100013', nombre: 'Clasico', marca: 'Tajin', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' };
const AGUACATE = { id: 'p-aguacate', plu: '4225', nombre: 'Aguacate', presentacion: '', precioCentavos: 100, unidadVenta: 'peso', precioPorKgCentavos: 549, claseFiscal: 'tasaCero' };
const CARNE = { id: 'carniceria', nombre: 'Carnicería', claseFiscal: 'tasaCero' };

const turno = { fondoInicialCentavos: 15000, abiertoEn: new Date(2026, 10, 2, 8, 2), cerradoEn: null };
let numero = 0;
function venta(lineas, metodo, monto, extra = {}, hora = 9) {
  numero += 1;
  const calculo = calcularTicket(lineas);
  const { pago } = registrarPago(calculo.totalCentavos, [], { metodo, montoCentavos: monto });
  return armarVenta(calculo, [pago], {
    folio: `261102-01-${String(numero).padStart(4, '0')}`, numero, dia: '2026-11-02', turno: 't1', caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1,
    tienda: 'talbot', tiendaNombre: 'Talbot', cajero: '100123', cajeroNombre: 'María', fecha: new Date(2026, 10, 2, hora, 15), ...extra,
  });
}

describe('resumen del turno', () => {
  const ventas = [
    venta([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(AGUACATE, { pesoGramos: 1250 })], 'efectivo', 2000, {}, 9), // 18.14 → 18.15
    venta([lineaDeDepartamento(CARNE, 1250, { cantidad: 1 })], 'debito', 0, {}, 9), // 12.50
    venta([lineaDeProducto(TAJIN, { cantidad: -1 })], 'efectivo', 0, { tipo: 'devolucion', autorizacion: 'a1', autorizadoPor: 'admin' }, 11), // −5.64 → −5.65
  ];
  ventas[0].lineasAnuladas = 1;
  ventas[0].lineasAnuladasCentavos = 299;
  const movimientos = [
    { tipo: 'retiro', importeCentavos: 1000 },
    { tipo: 'entrada', importeCentavos: 500 },
    { tipo: 'apertura', importeCentavos: 0 },
    { tipo: 'cancelacion', importeCentavos: 731 },
  ];
  const r = resumirTurno({ turno, ventas, movimientos, departamentos: [CARNE], hasta: new Date(2026, 10, 2, 16, 15).getTime() });

  it('cuenta ventas, devoluciones y totales con impuesto', () => {
    assert.equal(r.ventas, 2);
    assert.equal(r.devoluciones, 1);
    assert.equal(r.totalCentavos, 1814 + 1250 - 564);
    assert.equal(r.devolucionesCentavos, 564);
    assert.equal(r.impuestoCentavos, 130 - 65);
    assert.equal(ventasNetas(r), 998 + 686 + 1250 - 499);
    assert.equal(r.redondeoCentavos, 1 - 1);
    assert.equal(r.autorizadas, 1);
    assert.equal(r.primerFolio, '261102-01-0001');
    assert.equal(r.ultimoFolio, '261102-01-0003');
  });

  it('cuadra el efectivo esperado: fondo + ventas − devoluciones − retiros + entradas', () => {
    assert.deepEqual(r.porMetodo, { efectivo: 1815 - 565, debito: 1250, credito: 0, otro: 0 });
    assert.equal(r.efectivo.ventasCentavos, 1815);
    assert.equal(r.efectivo.devolucionesCentavos, 565);
    assert.equal(r.efectivo.esperadoCentavos, 15000 + 1815 - 565 - 1000 + 500);
    assert.equal(r.aperturasCajon, 1);
    assert.deepEqual([r.cancelaciones, r.cancelacionesCentavos], [1, 731]);
    assert.deepEqual([r.lineasAnuladas, r.lineasAnuladasCentavos], [1, 299]);
  });

  it('acumula por hora, por departamento y por producto (piezas y gramos)', () => {
    assert.deepEqual(r.porHora['09'], { ventas: 2, totalCentavos: 1814 + 1250 });
    assert.deepEqual(r.porHora['11'], { ventas: 0, totalCentavos: -564 });
    assert.deepEqual(r.porDepartamento.carniceria, { nombre: 'Carnicería', netoCentavos: 1250, articulos: 1 });
    assert.equal(r.productos['p_p-tajin'].cantidad, 1);
    assert.equal(r.productos['p_p-tajin'].netoCentavos, 998 - 499);
    assert.equal(r.productos['p_p-aguacate'].pesoGramos, 1250);
    assert.equal(r.minutos, 8 * 60 + 13);
  });

  it('suma turnos y detecta diferencias con un resumen recalculado', () => {
    const doble = sumarResumenes([r, r]);
    assert.equal(doble.totalCentavos, 2 * r.totalCentavos);
    assert.equal(doble.productos['p_p-tajin'].cantidad, 2);
    assert.equal(doble.porHora['09'].ventas, 4);
    assert.equal(doble.efectivo.esperadoCentavos, 2 * r.efectivo.esperadoCentavos);
    assert.deepEqual(diferenciasResumen(r, r), []);
    const alterado = { ...r, totalCentavos: r.totalCentavos + 100, porMetodo: { ...r.porMetodo, efectivo: 0 } };
    assert.deepEqual(diferenciasResumen(alterado, r).map((d) => d.campo), ['totalCentavos', 'porMetodo.efectivo']);
  });
});

describe('utilidades de turno', () => {
  it('duración, conteo de efectivo y fechas', () => {
    assert.equal(formatearDuracion(493), '8 h 13 min');
    assert.equal(formatearDuracion(45), '45 min');
    assert.equal(formatearDuracion(60), '1 h 00 min');
    assert.equal(totalConteo({ 10000: 1, 2000: 3, 25: 4, 5: 2 }), 10000 + 6000 + 100 + 10);
    assert.throws(() => totalConteo({ 1: 3 }), /Denominación/);
    assert.throws(() => totalConteo({ 2000: -1 }), /Cantidad/);
    assert.equal(minutosTurno({ abiertoEn: 0, cerradoEn: 90 * 60000 }), 90);
    assert.equal(milisDe({ seconds: 2, nanoseconds: 5e6 }), 2005);
    assert.equal(milisDe({ toMillis: () => 7 }), 7);
    assert.equal(claveArticulo({ productoId: null, upc: null, departamento: 'carniceria' }), 'd_carniceria');
    assert.equal(efectoMovimiento({ tipo: 'retiro', importeCentavos: 500 }), -500);
    assert.equal(efectoMovimiento({ tipo: 'apertura', importeCentavos: 0 }), 0);
  });
});
