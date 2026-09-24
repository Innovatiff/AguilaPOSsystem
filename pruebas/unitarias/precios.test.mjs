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

import { centavosDesdeTexto, textoDesdeCentavos } from '../../js/precios.js';

describe('centavosDesdeTexto', () => {
  it('convierte lo tecleado a centavos enteros', () => {
    assert.equal(centavosDesdeTexto('4.99'), 499);
    assert.equal(centavosDesdeTexto('4,99'), 499);
    assert.equal(centavosDesdeTexto('$5'), 500);
    assert.equal(centavosDesdeTexto('5.'), 500);
    assert.equal(centavosDesdeTexto('0.5'), 50);
    assert.equal(centavosDesdeTexto(' 12.30 '), 1230);
    assert.equal(centavosDesdeTexto('1,234.56'), 123456);
  });
  it('rechaza lo que no es un precio', () => {
    for (const malo of ['abc', '4.999', '-1', '', '4.9.9']) assert.throws(() => centavosDesdeTexto(malo), `debería rechazar "${malo}"`);
  });
  it('textoDesdeCentavos es la inversa para el campo de captura', () => {
    assert.equal(textoDesdeCentavos(499), '4.99');
    assert.equal(textoDesdeCentavos(500), '5.00');
    assert.equal(textoDesdeCentavos(5), '0.05');
  });
});

import { interpretarPrecio } from '../../js/precios.js';

describe('interpretarPrecio (captura rápida)', () => {
  it('lee el sufijo de clase fiscal pegado al precio', () => {
    assert.deepEqual(interpretarPrecio('4.99+'), { centavos: 499, claseFiscal: 'gravado' });
    assert.deepEqual(interpretarPrecio('4.99+tx'), { centavos: 499, claseFiscal: 'gravado' });
    assert.deepEqual(interpretarPrecio('4.99g'), { centavos: 499, claseFiscal: 'gravado' });
    assert.deepEqual(interpretarPrecio('5.00c'), { centavos: 500, claseFiscal: 'tasaCero' });
    assert.deepEqual(interpretarPrecio('5c'), { centavos: 500, claseFiscal: 'tasaCero' });
  });
  it('sin sufijo deja la clase en null; sin número falla', () => {
    assert.deepEqual(interpretarPrecio('1.89'), { centavos: 189, claseFiscal: null });
    assert.throws(() => interpretarPrecio('c'));
    assert.throws(() => interpretarPrecio('+'));
    assert.throws(() => interpretarPrecio('abc'));
  });
});
