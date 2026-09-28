import assert from 'node:assert/strict';
import { modulosUPCA, modulosEAN13, modulosGTIN, normalizarUPC, tipoDeCodigo, digitoVerificadorUPCA, digitoVerificadorGTIN, expandirUPCE, MODULOS_UPCA, MODULOS_CODIGO } from '../../js/upca.js';

// Anchos (espacio, barra, espacio, barra) de cada dígito según la norma UPC.
const ANCHOS = { 0: '3211', 1: '2221', 2: '2122', 3: '1411', 4: '1132', 5: '1231', 6: '1114', 7: '1312', 8: '1213', 9: '3112' };
const corridas = (s) => s.match(/0+|1+/g).map((r) => r.length).join('');

describe('UPC-A', () => {
  it('calcula el dígito verificador', () => {
    assert.equal(digitoVerificadorUPCA('63314810001'), 3);
    assert.equal(digitoVerificadorUPCA('03600029145'), 2);
  });
  it('normaliza y rechaza códigos inválidos', () => {
    assert.equal(normalizarUPC('0633148100013'), '633148100013', 'un EAN-13 que empieza por 0 es un UPC-A');
    assert.equal(normalizarUPC(' 633148 100013 '), '633148100013');
    for (const malo of ['63314810001', '633148100014', '7501234567890', '75012345678931', 'abc', '', null]) {
      assert.throws(() => normalizarUPC(malo), `debería rechazar ${JSON.stringify(malo)}`);
    }
    assert.throws(() => normalizarUPC('96385074'), /EAN-8/);
    assert.throws(() => normalizarUPC('633148100014'), /verificador incorrecto/);
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

describe('EAN-13', () => {
  it('calcula el dígito verificador GTIN con pesos 3 y 1 desde la derecha', () => {
    assert.equal(digitoVerificadorGTIN('400638133393'), 1);
    assert.equal(digitoVerificadorGTIN('750123456789'), 3);
    assert.equal(digitoVerificadorGTIN('63314810001'), 3, 'con 11 dígitos coincide con el UPC-A');
    assert.throws(() => digitoVerificadorGTIN('1234567'));
  });
  it('normaliza un EAN-13 a sus 13 dígitos y lo distingue del UPC-A', () => {
    assert.equal(normalizarUPC('4006381333931'), '4006381333931');
    assert.equal(normalizarUPC('7501234567893'), '7501234567893');
    assert.equal(tipoDeCodigo('7501234567893'), 'EAN-13');
    assert.equal(tipoDeCodigo('0633148100013'), 'UPC-A');
    assert.throws(() => normalizarUPC('7501234567890'), /verificador incorrecto/);
  });
  it('codifica 95 módulos: paridad L/G a la izquierda según el primer dígito, R a la derecha', () => {
    const ean = '4006381333931'; // primer dígito 4 → paridad LGLLGG
    const bits = modulosEAN13(ean);
    assert.equal(bits.length, MODULOS_CODIGO);
    assert.ok(bits.startsWith('101') && bits.endsWith('101') && bits.slice(45, 50) === '01010');
    const paridad = 'LGLLGG';
    const invertir = (anchos) => [...anchos].reverse().join('');
    for (let i = 0; i < 6; i += 1) {
      const seg = bits.slice(3 + i * 7, 10 + i * 7);
      const digito = ean[1 + i];
      const unos = [...seg].filter((b) => b === '1').length;
      assert.equal(seg[0], '0', 'la izquierda empieza en espacio');
      if (paridad[i] === 'L') {
        assert.equal(unos % 2, 1, `dígito ${i + 2}: paridad impar (L)`);
        assert.equal(corridas(seg), ANCHOS[digito]);
      } else {
        assert.equal(unos % 2, 0, `dígito ${i + 2}: paridad par (G)`);
        assert.equal(corridas(seg), invertir(ANCHOS[digito]), 'G es el patrón R leído al revés');
      }
    }
    for (let i = 0; i < 6; i += 1) {
      const seg = bits.slice(50 + i * 7, 57 + i * 7);
      assert.equal(seg[0], '1');
      assert.equal(corridas(seg), ANCHOS[ean[7 + i]]);
      assert.equal([...seg].filter((b) => b === '1').length % 2, 0, 'paridad par a la derecha');
    }
    // La lectura real la comprueba el escenario móvil: ZXing (decodificador independiente)
    // lee este mismo símbolo dibujado por js/upca.js desde la cámara falsa.
  });
  it('modulosGTIN elige el símbolo por la longitud; modulosUPCA rechaza un EAN-13', () => {
    assert.equal(modulosGTIN('633148100013'), modulosUPCA('633148100013'));
    assert.equal(modulosGTIN('4006381333931'), modulosEAN13('4006381333931'));
    assert.throws(() => modulosUPCA('4006381333931'), /EAN-13/);
    assert.equal(MODULOS_UPCA, MODULOS_CODIGO);
  });
});

describe('UPC-E', () => {
  it('expande los cuatro casos de compresión al UPC-A de 12 dígitos', () => {
    assert.equal(expandirUPCE('01234565'), '012345000065', 'último dígito 5-9: cinco de fabricante y el propio dígito');
    assert.equal(expandirUPCE('06742708'), '067000004278', 'último dígito 0-2: dos de fabricante + ese dígito (Coca-Cola 067000)');
    assert.equal(expandirUPCE('01234531'), '012300000451', 'último dígito 3');
    assert.equal(expandirUPCE('01234548'), '012340000058', 'último dígito 4');
    assert.throws(() => expandirUPCE('96385074'), /no es un UPC-E/);
  });
  it('normalizarUPC acepta un UPC-E con verificador correcto y rechaza uno alterado', () => {
    assert.equal(normalizarUPC('06742708'), '067000004278');
    assert.equal(normalizarUPC('01234565'), '012345000065');
    assert.throws(() => normalizarUPC('06742709'), /verificador incorrecto/);
  });
});
