import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { simbolosCode128C, modulosCode128C, ZONA_SILENCIO_MODULOS } from '../../js/code128.js';

const require = createRequire(import.meta.url);
const { Code128Reader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } = require('@zxing/library');

/** Decodifica la secuencia de módulos como lo haría un escáner (ZXing). */
function decodificar(modulos, pixelesPorModulo = 3) {
  const lineaCompleta = '0'.repeat(ZONA_SILENCIO_MODULOS) + modulos + '0'.repeat(ZONA_SILENCIO_MODULOS);
  const ancho = lineaCompleta.length * pixelesPorModulo;
  const alto = 24;
  const luminancias = new Uint8ClampedArray(ancho * alto);
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) luminancias[y * ancho + x] = lineaCompleta[Math.floor(x / pixelesPorModulo)] === '1' ? 0 : 255;
  }
  const imagen = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminancias, ancho, alto)));
  return new Code128Reader().decode(imagen).getText();
}

describe('Code 128 C (código del recibo)', () => {
  it('calcula el verificador módulo 103 (ejemplo de la norma)', () => {
    // 1234 → inicio C (105) + 12 + 34 → (105 + 12·1 + 34·2) % 103 = 82
    assert.deepEqual(simbolosCode128C('1234'), [105, 12, 34, 82, 106]);
  });

  it('cada símbolo mide 11 módulos y la parada 13', () => {
    const modulos = modulosCode128C('261102010042');
    assert.equal(modulos.length, 11 * 8 + 13);
    assert.ok(modulos.startsWith('11010011100')); // inicio C: 211232
    assert.ok(modulos.endsWith('1100011101011')); // parada: 2331112
  });

  it('rechaza longitudes impares o caracteres que no son dígitos', () => {
    assert.throws(() => modulosCode128C('123'));
    assert.throws(() => modulosCode128C('12a4'));
    assert.throws(() => modulosCode128C(''));
  });

  it('un escáner lee el folio del recibo', () => {
    assert.equal(decodificar(modulosCode128C('261102010042')), '261102010042');
  });

  it('todos los valores 00–99 se leen bien (tabla de patrones completa)', () => {
    for (let i = 0; i < 100; i += 4) {
      const digitos = [i, i + 1, i + 2, i + 3].map((n) => String(n % 100).padStart(2, '0')).join('');
      assert.equal(decodificar(modulosCode128C(digitos)), digitos, digitos);
    }
  });
});
