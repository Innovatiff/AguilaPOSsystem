import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  t, tc, tEs, idioma, enIngles, locale, meridiano, hora12, diaYHora, numero, traducirTexto, cargarIngles, fijarIdioma, faltantes,
} from '../../js/idioma.js';
import { PLANTILLAS_EVENTO, traducirTextoEvento } from '../../js/eventos.js';
import { nombreMetodo, formatearPorcentaje } from '../../js/ticket.js';
import { nombreMovimiento } from '../../js/turnos.js';
import { EN } from '../../js/i18n/en.js';
import { revisar } from '../../herramientas/revisar-idioma.mjs';

/** Corre `prueba` con la página en inglés y vuelve al español (el de siempre en Node). */
async function enInglesDurante(prueba) {
  await cargarIngles();
  fijarIdioma('en');
  try {
    return await prueba();
  } finally {
    fijarIdioma(null);
  }
}

const LAS_1_19_PM = new Date(2026, 10, 4, 13, 19, 5); // miércoles 4 de noviembre de 2026

describe('idioma (js/idioma.js, js/i18n/)', () => {
  it('en español todo sale tal cual, con sus {valores}', () => {
    assert.equal(idioma(), 'es');
    assert.equal(enIngles(), false);
    assert.equal(locale(), 'es-CA');
    assert.equal(t('Hola {nombre}, tienes {n} avisos', { nombre: 'Ana', n: 3 }), 'Hola Ana, tienes 3 avisos');
    assert.equal(tc('titulo', 'Cerrar turno'), 'Cerrar turno');
    assert.equal(traducirTexto('¡Gracias por su compra!'), '¡Gracias por su compra!');
    assert.equal(meridiano(9), 'a.m.');
    assert.equal(hora12(LAS_1_19_PM), '01:19 p.m.');
    assert.equal(hora12(LAS_1_19_PM, { segundos: true }), '01:19:05 p.m.');
    assert.equal(diaYHora(LAS_1_19_PM), 'mié, 4 de nov 01:19 p.m.');
    assert.equal(nombreMetodo('debito'), 'Débito');
    assert.equal(nombreMovimiento('retiro'), 'Retiro de efectivo');
    assert.equal(formatearPorcentaje(1300), '13 %');
  });

  it('en inglés: traduce, usa el contexto y lo que se guarda sigue en español', async () => {
    await enInglesDurante(() => {
      assert.equal(locale(), 'en-CA');
      assert.equal(t('Cancelar'), 'Cancel');
      assert.equal(t('Turno abierto con {fondo} de fondo', { fondo: '$100.00' }), 'Shift opened with a $100.00 float');
      assert.equal(tc('titulo', 'Cerrar turno'), 'Close Shift');
      assert.equal(tc('otro-contexto', 'Cerrar turno'), 'Close shift', 'sin la clave con contexto, la de siempre');
      assert.equal(tEs('Turno abierto con {fondo} de fondo', { fondo: '$100.00' }), 'Turno abierto con $100.00 de fondo');
      assert.equal(traducirTexto('¡Gracias por su compra!'), 'Thank you for your purchase!');
      assert.equal(traducirTexto('Gracias, vecino'), 'Gracias, vecino', 'lo que escribió la tienda va tal cual');
      assert.equal(t('Texto que nadie tradujo'), 'Texto que nadie tradujo');
      assert.ok(faltantes.has('Texto que nadie tradujo'), 'y queda anotado como faltante');
      assert.equal(meridiano(9), 'AM');
      assert.equal(hora12(LAS_1_19_PM), '01:19 PM');
      assert.equal(diaYHora(LAS_1_19_PM), 'Wed, Nov 4 01:19 PM');
      assert.equal(numero(12345), '12,345');
      assert.equal(nombreMetodo('debito'), 'Debit');
      assert.equal(nombreMovimiento('retiro'), 'Cash drop');
      assert.equal(formatearPorcentaje(1300), '13%');
    });
    assert.equal(t('Cancelar'), 'Cancelar', 'de vuelta en español');
    faltantes.delete('Texto que nadie tradujo');
  });

  it('todo lo que ve el usuario tiene inglés, con los mismos {valores}, y sin claves traducidas distinto', async () => {
    const { faltan, errores } = await revisar();
    assert.deepEqual(faltan, [], 'textos sin traducción (node herramientas/revisar-idioma.mjs)');
    assert.deepEqual(errores, [], 'errores del diccionario (node herramientas/revisar-idioma.mjs)');
  });

  it('cada plantilla de los movimientos en vivo tiene su inglés', () => {
    for (const plantilla of PLANTILLAS_EVENTO) assert.ok(plantilla in EN, plantilla);
  });

  it('lo que la caja guarda con tEs() se puede mostrar en inglés', () => {
    const caja = readFileSync('js/caja.js', 'utf8');
    const literales = [...caja.matchAll(/tEs\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    assert.ok(literales.length > 20, 'la caja escribe sus movimientos con tEs()');
    for (const texto of literales) assert.ok(texto in EN, texto);
  });

  it('los movimientos en vivo (guardados en español) se muestran en inglés', async () => {
    const casos = [
      ['Venta 261104-01-0002 completada — $5.07 (1 artículos, débito)', 'Sale 261104-01-0002 completed — $5.07 (1 item, debit)'],
      ['Venta 261104-01-0003 completada — $13.55 (3 artículos, efectivo + débito), cambio $6.45',
        'Sale 261104-01-0003 completed — $13.55 (3 items, cash + debit), change $6.45'],
      ['Retiro de efectivo de $20.00 — al banco', 'Cash drop: $20.00 — al banco'],
      ['Entrada de efectivo de $20.00', 'Cash in: $20.00'],
      ['Rosa Méndez autorizó: Descuento de 10 % a TAJIN CLASICO', 'Rosa Méndez approved: 10% discount on TAJIN CLASICO'],
      ['Ticket en espera — 3 artículo(s) · $12.50', 'Ticket on hold — 3 items · $12.50'],
      ['Ticket recuperado — 1 artículo(s) · $2.00 · devolución', 'Ticket resumed — 1 item · $2.00 · return'],
      ['Efectivo $20.00 en 261104-01-0003 (saldo $0.00)', 'Cash $20.00 on 261104-01-0003 (balance $0.00)'],
      ['Reembolso en efectivo $5.00 de 261104-01-0004', 'Refund in cash of $5.00 for 261104-01-0004'],
      ['Apertura de cajón sin venta', 'No sale, drawer opened'],
      ['3 artículo(s)', '3 items'],
      ['1 artículo(s)', '1 item'],
      ['Ticket en espera cancelado al cerrar el turno', 'Held ticket cancelled at shift close'],
      ['2× TAJIN CLASICO — $9.98', '2× TAJIN CLASICO — $9.98'],
      ['Un texto que no es de ninguna plantilla', 'Un texto que no es de ninguna plantilla'],
    ];
    await enInglesDurante(() => {
      for (const [guardado, ingles] of casos) assert.equal(traducirTextoEvento(guardado), ingles, guardado);
    });
    for (const [guardado] of casos) assert.equal(traducirTextoEvento(guardado), guardado, 'en español, tal cual');
  });
});
