import assert from 'node:assert/strict';
import { generarClaveCaja, claveCajaValida, huellaNip, esHuella, BYTES_CLAVE } from '../../js/nip.js';

describe('NIP de caja: huella con la clave de caja', () => {
  it('la clave es base64 de 32 bytes aleatorios', () => {
    const a = generarClaveCaja();
    const b = generarClaveCaja();
    assert.ok(claveCajaValida(a) && claveCajaValida(b));
    assert.notEqual(a, b);
    assert.equal(Buffer.from(a, 'base64').length, BYTES_CLAVE);
    assert.ok(!claveCajaValida('corta') && !claveCajaValida(null) && !claveCajaValida(Buffer.alloc(16).toString('base64')));
  });
  it('la huella es estable para la misma clave y NIP, y cambia con cualquiera de los dos', async () => {
    const clave = generarClaveCaja();
    const h1 = await huellaNip(clave, '482913');
    assert.ok(esHuella(h1));
    assert.equal(await huellaNip(clave, ' 482913 '), h1, 'ignora espacios');
    assert.notEqual(await huellaNip(clave, '482914'), h1);
    assert.notEqual(await huellaNip(generarClaveCaja(), '482913'), h1, 'sin la clave no se puede calcular');
  });
  it('coincide con HMAC-SHA-256 estándar (la caja y el back office deben dar lo mismo)', async () => {
    const { createHmac } = await import('node:crypto');
    const clave = generarClaveCaja();
    const esperada = createHmac('sha256', Buffer.from(clave, 'base64')).update('nip:735146').digest('hex');
    assert.equal(await huellaNip(clave, '735146'), esperada);
  });
  it('rechaza una clave inválida', async () => {
    await assert.rejects(() => huellaNip('no', '482913'), /Clave de caja/);
  });
});
