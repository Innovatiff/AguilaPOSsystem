import assert from 'node:assert/strict';
import { lineaDeProducto, calcularTicket, registrarPago, armarVenta, estadoCobro } from '../../js/ticket.js';
import { configConDefectos } from '../../js/config-pos.js';
import { estadoCliente, lineaCliente, primerNombre, esEstadoValido, MAXIMO_LINEAS } from '../../js/pantalla-cliente.js';

const TAJIN = { id: 'p-tajin', upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' };
const COCA = { id: 'p-coca', upc: '049000006346', nombre: 'COCA COLA', marca: 'COCA-COLA', presentacion: '355mL', precioCentavos: 199, unidadVenta: 'pieza', claseFiscal: 'gravado' };
const AGUACATE = { id: 'p-aguacate', plu: '4225', nombre: 'AGUACATE HASS', presentacion: '', precioCentavos: 100, unidadVenta: 'peso', precioPorKgCentavos: 549, claseFiscal: 'tasaCero' };
const config = configConDefectos({ reciboPie: '¡Gracias por su compra!\nVuelva pronto' });
const base = { tienda: 'El Águila Market', caja: 'Caja 1', atiende: 'María José López', config };

function ticket(lineas, extra = {}) {
  const t = { lineas, descuentoTicket: null, modo: 'venta', ...extra };
  return { ticket: t, calculo: calcularTicket(t.lineas, { descuentoTicket: t.descuentoTicket }) };
}

describe('pantalla del cliente (js/pantalla-cliente.js)', () => {
  it('el cliente ve solo el primer nombre de quien atiende, nunca un correo', () => {
    assert.equal(primerNombre('María José López'), 'María');
    assert.equal(primerNombre('admin@aguila.test'), '');
    assert.equal(primerNombre(null), '');
  });

  it('caja cerrada y lista: tienda, caja y mensaje, sin ticket', () => {
    const cerrada = estadoCliente({ ...base, fase: 'cerrada' });
    assert.deepEqual(cerrada, { v: 1, fase: 'cerrada', tienda: 'El Águila Market', caja: 'Caja 1', atiende: '', mensaje: '¡Gracias por su compra!' });
    const libre = estadoCliente({ ...base, fase: 'libre' });
    assert.equal(libre.atiende, 'María');
    assert.ok(esEstadoValido(cerrada) && esEstadoValido(libre));
  });

  it('ticket en curso: cada línea con cantidad × precio e importe, la última en grande y los totales', () => {
    const tajin = lineaDeProducto(TAJIN, { cantidad: 2 });
    const coca = lineaDeProducto(COCA, { cantidad: 3 });
    const aguacate = lineaDeProducto(AGUACATE, { pesoGramos: 1250 });
    const { ticket: t, calculo } = ticket([tajin, coca, aguacate]);
    const e = estadoCliente({ ...base, fase: 'venta', ticket: t, calculo, ultima: coca.id });
    assert.equal(e.fase, 'venta');
    assert.deepEqual(e.lineas.map((l) => [l.nombre, l.detalle, l.importe]), [
      ['TAJIN CLASICO 142g', '2 × $4.99', '$9.98'],
      ['COCA-COLA COCA COLA 355mL', '3 × $1.99', '$5.97'],
      ['AGUACATE HASS', '1.250 kg × $5.49/kg', '$6.86'],
    ]);
    assert.equal(e.ultima.nombre, 'COCA-COLA COCA COLA 355mL');
    assert.equal(e.articulos, 6);
    assert.equal(e.subtotal, '$22.81');
    assert.equal(e.impuestoNombre, 'HST 13 %');
    assert.equal(e.impuesto, '$2.07');
    assert.equal(e.total, '$24.88');
    assert.equal(e.totalEfectivo, '$24.90');
    assert.equal(e.descuento, null);
    assert.ok(esEstadoValido(e));
  });

  it('sin «última» conocida, se muestra en grande la última línea', () => {
    const { ticket: t, calculo } = ticket([lineaDeProducto(TAJIN), lineaDeProducto(COCA)]);
    assert.equal(estadoCliente({ ...base, fase: 'venta', ticket: t, calculo, ultima: 'ya-no-existe' }).ultima.nombre, 'COCA-COLA COCA COLA 355mL');
  });

  it('descuentos: importe tachado, el descuento a la vista y lo que ahorra', () => {
    const tajin = { ...lineaDeProducto(TAJIN), descuento: { tipo: 'porcentaje', puntosBase: 1000 } };
    const { ticket: t, calculo } = ticket([tajin], { descuentoTicket: { tipo: 'monto', centavos: 100 } });
    const e = estadoCliente({ ...base, fase: 'venta', ticket: t, calculo });
    assert.deepEqual(lineaCliente(calculo.lineas[0]), {
      id: tajin.id, nombre: 'TAJIN CLASICO 142g', detalle: '1 × $4.99', importe: '$4.49', antes: '$4.99', descuento: 'Descuento 10 %', negativa: false,
    });
    assert.equal(e.descuento, '-$1.00');
    assert.equal(e.ahorro, '$1.50');
  });

  it('devolución: importes negativos y la marca de devolución', () => {
    const { ticket: t, calculo } = ticket([lineaDeProducto(TAJIN, { cantidad: -1 })], { modo: 'devolucion' });
    const e = estadoCliente({ ...base, fase: 'venta', ticket: t, calculo });
    assert.equal(e.devolucion, true);
    assert.equal(e.lineas[0].negativa, true);
    assert.equal(e.total, '-$5.64');
  });

  it('cobro: lo pagado y lo que falta (en efectivo, redondeado a 5 ¢)', () => {
    const { ticket: t, calculo } = ticket([lineaDeProducto(TAJIN, { cantidad: 2 })]);
    const total = calculo.totalCentavos; // 11.28
    const { pago } = registrarPago(total, [], { metodo: 'debito', montoCentavos: 500 });
    const cobro = { totalCentavos: total, pagos: [pago], metodo: 'efectivo', ...estadoCobro(total, [pago]) };
    const e = estadoCliente({ ...base, fase: 'cobro', ticket: t, calculo, cobro });
    assert.equal(e.fase, 'cobro');
    assert.deepEqual(e.cobro, { metodo: 'Efectivo', tarjeta: false, pagado: '$5.00', falta: '$6.30', pagos: [{ metodo: 'Débito', importe: '$5.00' }] });
    const conTarjeta = estadoCliente({ ...base, fase: 'cobro', ticket: t, calculo, cobro: { ...cobro, metodo: 'credito' } });
    assert.equal(conTarjeta.cobro.falta, '$6.28');
    assert.equal(conTarjeta.cobro.tarjeta, true);
    assert.equal(estadoCliente({ ...base, fase: 'cobro', ticket: t, calculo }).fase, 'venta');
  });

  it('cobrado: gracias, lo que pagó y su cambio', () => {
    const calculo = calcularTicket([lineaDeProducto(TAJIN, { cantidad: 2 }), lineaDeProducto(COCA)]);
    const { pago } = registrarPago(calculo.totalCentavos, [], { metodo: 'efectivo', montoCentavos: 2000 });
    const venta = armarVenta(calculo, [pago], {
      folio: '261104-01-0007', numero: 7, dia: '2026-11-04', tipo: 'venta', turno: 't1', caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1,
      tienda: 'talbot', tiendaNombre: 'El Águila Market', cajero: '100123', cajeroNombre: 'María', fecha: new Date(),
    });
    const e = estadoCliente({ ...base, fase: 'cobrado', venta });
    assert.equal(e.folio, '261104-01-0007');
    assert.equal(e.total, '$13.55');
    assert.deepEqual(e.pagos, [{ metodo: 'Efectivo', importe: '$20.00' }]);
    assert.equal(e.cambio, '$6.45');
    assert.equal(e.mensaje, '¡Gracias por su compra!');
    assert.ok(esEstadoValido(e));
  });

  it('un ticket muy largo manda solo las últimas líneas y cuántas quedan arriba', () => {
    const lineas = Array.from({ length: MAXIMO_LINEAS + 5 }, (_, i) => lineaDeProducto({ ...COCA, id: `p${i}` }));
    const { ticket: t, calculo } = ticket(lineas);
    const e = estadoCliente({ ...base, fase: 'venta', ticket: t, calculo });
    assert.equal(e.lineas.length, MAXIMO_LINEAS);
    assert.equal(e.ocultas, 5);
  });

  it('rechaza fases desconocidas y estados mal formados', () => {
    assert.throws(() => estadoCliente({ ...base, fase: 'otra' }), /Fase desconocida/);
    assert.throws(() => estadoCliente({ ...base, fase: 'venta' }), /Falta el ticket/);
    assert.ok(!esEstadoValido({ v: 1, fase: 'venta' }));
    assert.ok(!esEstadoValido({ v: 2, fase: 'libre' }));
    assert.ok(!esEstadoValido(null));
  });
});
