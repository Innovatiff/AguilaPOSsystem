import assert from 'node:assert/strict';
import { generarClaveCaja, claveCajaValida, huellaNip, huellaPantalla, esHuella, BYTES_CLAVE } from '../../js/nip.js';

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
    await assert.rejects(() => huellaPantalla('no', 'talbot-1'), /Clave de caja/);
  });
  it('la pantalla del cliente de cada caja tiene su id: HMAC de la caja, distinto por caja y nunca igual a una huella de NIP', async () => {
    const { createHmac } = await import('node:crypto');
    const clave = generarClaveCaja();
    const p1 = await huellaPantalla(clave, 'talbot-1');
    assert.ok(esHuella(p1));
    assert.equal(p1, createHmac('sha256', Buffer.from(clave, 'base64')).update('pantalla:talbot-1').digest('hex'));
    assert.equal(await huellaPantalla(clave, 'talbot-1'), p1, 'la caja y la tableta calculan lo mismo');
    assert.notEqual(await huellaPantalla(clave, 'talbot-2'), p1);
    assert.notEqual(await huellaPantalla(generarClaveCaja(), 'talbot-1'), p1, 'sin la clave no se puede calcular');
    assert.notEqual(await huellaNip(clave, 'talbot-1'), p1);
  });
});
