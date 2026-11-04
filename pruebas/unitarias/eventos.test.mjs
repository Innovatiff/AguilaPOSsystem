import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIPOS_EVENTO, GRUPOS_EVENTO, infoEvento, milisDeMarca, horaConSegundos, cumpleFiltros } from '../../js/eventos.js';

describe('movimientos en vivo (js/eventos.js)', () => {
  it('los tipos son exactamente los que aceptan las reglas', () => {
    const reglas = readFileSync('firestore.rules', 'utf8');
    const lista = /function tiposEvento\(\) \{\s*return \[([^\]]+)\]/.exec(reglas)[1];
    const deReglas = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(TIPOS_EVENTO).sort(), deReglas);
  });
  it('cada tipo tiene etiqueta, chip y un grupo del filtro', () => {
    const grupos = new Set(GRUPOS_EVENTO.map(([clave]) => clave));
    for (const [tipo, info] of Object.entries(TIPOS_EVENTO)) {
      assert.ok(info.etiqueta, tipo);
      assert.ok(['neutro', 'abierto', 'alerta', 'aviso', 'info'].includes(info.chip), tipo);
      assert.ok(grupos.has(info.grupo), tipo);
    }
    assert.equal(infoEvento('venta_completada').etiqueta, 'Venta completada');
    assert.equal(infoEvento('pago').tono, 'ok');
    assert.equal(infoEvento('otra_cosa').etiqueta, 'Movimiento');
  });
  it('hora con segundos en formato de 12 horas', () => {
    assert.deepEqual(horaConSegundos(new Date(2026, 10, 4, 13, 16, 13)), { hora: '01:16:13', meridiano: 'p.m.' });
    assert.deepEqual(horaConSegundos(new Date(2026, 10, 4, 0, 5, 9)), { hora: '12:05:09', meridiano: 'a.m.' });
    assert.deepEqual(horaConSegundos(new Date(2026, 10, 4, 12, 0, 0)), { hora: '12:00:00', meridiano: 'p.m.' });
    assert.deepEqual(horaConSegundos(null), { hora: '--:--:--', meridiano: '' });
  });
  it('milisegundos de un Timestamp, un Date, un número o {seconds, nanoseconds}', () => {
    assert.equal(milisDeMarca({ toMillis: () => 42 }), 42);
    assert.equal(milisDeMarca(new Date(5)), 5);
    assert.equal(milisDeMarca(7), 7);
    assert.equal(milisDeMarca({ seconds: 2, nanoseconds: 5_000_000 }), 2005);
    assert.equal(milisDeMarca(undefined), null);
  });
  it('filtros por caja, asociado y grupo', () => {
    const e = { tipo: 'pago', caja: 'c1', cajero: '100123' };
    assert.ok(cumpleFiltros(e, {}));
    assert.ok(cumpleFiltros(e, { caja: 'c1', cajero: '100123', grupo: 'pagos' }));
    assert.ok(!cumpleFiltros(e, { caja: 'c2' }));
    assert.ok(!cumpleFiltros(e, { cajero: '100124' }));
    assert.ok(!cumpleFiltros(e, { grupo: 'ventas' }));
  });
});
