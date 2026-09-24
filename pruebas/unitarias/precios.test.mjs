import assert from 'node:assert/strict';
import { formatearPrecio, indicadorFiscal } from '../../js/precios.js';

describe('precios', () => {
  it('formatea centavos enteros con dos decimales y miles con coma', () => {
    assert.equal(formatearPrecio(499), '$4.99');
    assert.equal(formatearPrecio(500), '$5.00');
    assert.equal(formatearPrecio(5), '$0.05');
    assert.equal(formatearPrecio(123456), '$1,234.56');
  });
  it('rechaza flotantes, negativos y textos', () => {
    for (const malo of [4.99, -1, '499', NaN, null]) assert.throws(() => formatearPrecio(malo));
  });
  it('deriva el indicador fiscal de la clase, con la grafía exacta', () => {
    assert.equal(indicadorFiscal('gravado'), '+Tx');
    assert.equal(indicadorFiscal('tasaCero'), 'c');
    assert.throws(() => indicadorFiscal('exento'));
  });
});
