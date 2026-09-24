import assert from 'node:assert/strict';
import { modulosUPCA, normalizarUPC, digitoVerificadorUPCA, MODULOS_UPCA } from '../../js/upca.js';

// Anchos (espacio, barra, espacio, barra) de cada dígito según la norma UPC.
const ANCHOS = { 0: '3211', 1: '2221', 2: '2122', 3: '1411', 4: '1132', 5: '1231', 6: '1114', 7: '1312', 8: '1213', 9: '3112' };
const corridas = (s) => s.match(/0+|1+/g).map((r) => r.length).join('');

describe('UPC-A', () => {
  it('calcula el dígito verificador', () => {
    assert.equal(digitoVerificadorUPCA('63314810001'), 3);
    assert.equal(digitoVerificadorUPCA('03600029145'), 2);
  });
  it('normaliza y rechaza códigos inválidos', () => {
    assert.equal(normalizarUPC('0633148100013'), '633148100013');
    for (const malo of ['63314810001', '633148100014', '7501234567890', 'abc', '', null]) {
      assert.throws(() => normalizarUPC(malo), `debería rechazar ${JSON.stringify(malo)}`);
    }
  });
  it('codifica 95 módulos con guardas y los patrones L/R de la norma', () => {
    const upc = '633148100013';
    const bits = modulosUPCA(upc);
    assert.equal(bits.length, MODULOS_UPCA);
    assert.ok(bits.startsWith('101') && bits.endsWith('101') && bits.slice(45, 50) === '01010');
    for (let i = 0; i < 6; i += 1) {
      const seg = bits.slice(3 + i * 7, 10 + i * 7);
      assert.equal(seg[0], '0');
      assert.equal(corridas(seg), ANCHOS[upc[i]]);
      assert.equal([...seg].filter((b) => b === '1').length % 2, 1, 'paridad impar a la izquierda');
    }
    for (let i = 0; i < 6; i += 1) {
      const seg = bits.slice(50 + i * 7, 57 + i * 7);
      assert.equal(seg[0], '1');
      assert.equal(corridas(seg), ANCHOS[upc[6 + i]]);
      assert.equal([...seg].filter((b) => b === '1').length % 2, 0, 'paridad par a la derecha');
    }
  });
});
