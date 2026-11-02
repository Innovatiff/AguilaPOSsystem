import assert from 'node:assert/strict';
import { crearVerificador, comprobarVerificador } from '../../js/verificador.js';

describe('verificador local del NIP', () => {
  it('acepta el NIP correcto y rechaza cualquier otro', async () => {
    const v = await crearVerificador('482913', 1000);
    assert.equal(v.iteraciones, 1000);
    assert.ok(!JSON.stringify(v).includes('482913'), 'el NIP nunca se guarda');
    assert.equal(await comprobarVerificador('482913', v), true);
    assert.equal(await comprobarVerificador('482914', v), false);
    assert.equal(await comprobarVerificador('', v), false);
  });

  it('cada verificador lleva su propia sal', async () => {
    const a = await crearVerificador('482913', 1000);
    const b = await crearVerificador('482913', 1000);
    assert.notEqual(a.sal, b.sal);
    assert.notEqual(a.hash, b.hash);
  });

  it('un verificador ausente o dañado nunca coincide', async () => {
    assert.equal(await comprobarVerificador('482913', null), false);
    assert.equal(await comprobarVerificador('482913', { sal: 'x', hash: 'y' }), false);
    assert.equal(await comprobarVerificador('482913', { sal: '%%%', hash: '%%%', iteraciones: 1000 }), false);
  });
});
