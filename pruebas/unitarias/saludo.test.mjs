import assert from 'node:assert/strict';
import { saludo } from '../../js/bo.js';

describe('saludo del inicio del back office', () => {
  it('saluda por el primer nombre según la hora', () => {
    assert.equal(saludo('María López', new Date(2026, 10, 3, 9)), 'Buenos días, María');
    assert.equal(saludo('Alan (admin)', new Date(2026, 10, 3, 15)), 'Buenas tardes, Alan');
    assert.equal(saludo('  Rosa   Méndez ', new Date(2026, 10, 3, 21)), 'Buenas noches, Rosa');
  });

  it('no usa un correo como nombre: sin nombre puesto, solo el saludo', () => {
    assert.equal(saludo('gerente@ejemplo.com', new Date(2026, 10, 3, 9)), 'Buenos días');
    assert.equal(saludo('', new Date(2026, 10, 3, 15)), 'Buenas tardes');
    assert.equal(saludo(undefined, new Date(2026, 10, 3, 21)), 'Buenas noches');
  });
});
