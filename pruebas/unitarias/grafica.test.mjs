import assert from 'node:assert/strict';
import { escalaBonita, dolaresEje } from '../../js/grafica.js';

describe('escala de las gráficas', () => {
  it('elige topes y pasos redondos', () => {
    assert.deepEqual(escalaBonita(48.18), { tope: 60, paso: 20 });
    assert.deepEqual(escalaBonita(144.76), { tope: 150, paso: 50 });
    assert.deepEqual(escalaBonita(100), { tope: 100, paso: 25 });
    assert.deepEqual(escalaBonita(0), { tope: 4, paso: 1 });
    const grande = escalaBonita(12345);
    assert.ok(grande.tope >= 12345 && Number.isInteger(grande.paso));
  });

  it('rotula el eje en dólares, compacto desde $10,000', () => {
    assert.equal(dolaresEje(0), '$0');
    assert.equal(dolaresEje(250), '$250');
    assert.equal(dolaresEje(1500), '$1,500');
    assert.equal(dolaresEje(12000), '$12K');
  });
});
