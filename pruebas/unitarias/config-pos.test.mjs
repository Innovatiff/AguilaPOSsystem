import assert from 'node:assert/strict';
import { configConDefectos, validarDepartamento, armarConfigPos, CONFIG_POS_DEFECTO, DEPARTAMENTOS_DEFECTO, MAXIMO_DEPARTAMENTOS } from '../../js/config-pos.js';

describe('configuración del POS', () => {
  it('sin documento usa los valores de fábrica (HST 13 %, fondo $150, recibo de 80 mm)', () => {
    const c = configConDefectos(null);
    assert.equal(c.impuestoNombre, 'HST');
    assert.equal(c.tasaImpuestoBP, 1300);
    assert.equal(c.fondoSugeridoCentavos, 15000);
    assert.equal(c.papelRecibo, 80);
    assert.equal(c.conteoCiego, true);
    assert.deepEqual(c.departamentos, DEPARTAMENTOS_DEFECTO);
  });

  it('corrige valores fuera de rango o de otro tipo', () => {
    const c = configConDefectos({ tasaImpuestoBP: 5000, fondoSugeridoCentavos: 12.5, papelRecibo: 60, conteoCiego: 'sí', impuestoNombre: '  ' });
    assert.equal(c.tasaImpuestoBP, CONFIG_POS_DEFECTO.tasaImpuestoBP);
    assert.equal(c.fondoSugeridoCentavos, CONFIG_POS_DEFECTO.fondoSugeridoCentavos);
    assert.equal(c.papelRecibo, 80);
    assert.equal(c.conteoCiego, true);
    assert.equal(c.impuestoNombre, 'HST');
    assert.equal(configConDefectos({ papelRecibo: 58 }).papelRecibo, 58);
  });

  it('descarta departamentos no válidos y limita a 24', () => {
    const buenos = Array.from({ length: 30 }, (_, i) => ({ id: `d-${i}`, nombre: `Depto ${i}`, claseFiscal: 'gravado', color: 'gris' }));
    const c = configConDefectos({ departamentos: [{ id: 'X', nombre: '', claseFiscal: 'otra', color: 'rosa' }, ...buenos] });
    assert.equal(c.departamentos.length, MAXIMO_DEPARTAMENTOS);
    assert.equal(c.departamentos[0].id, 'd-0');
    assert.deepEqual(validarDepartamento({ id: 'ok-1', nombre: 'Tortillería', claseFiscal: 'tasaCero', color: 'amarillo' }), []);
    assert.equal(validarDepartamento({ id: 'ok-1', nombre: 'x'.repeat(31), claseFiscal: 'tasaCero', color: 'amarillo' }).length, 1);
  });

  it('arma el documento con los campos exactos que exigen las reglas', () => {
    const fecha = new Date(0);
    const doc = armarConfigPos({ reciboPie: '¡Gracias!', departamentos: [{ id: 'carne', nombre: ' Carne ', claseFiscal: 'tasaCero', color: 'rojo', extra: 1 }] }, 'admin@aguila.test', fecha);
    assert.deepEqual(Object.keys(doc).sort(), ['actualizadoEn', 'actualizadoPor', 'conteoCiego', 'departamentos', 'fondoSugeridoCentavos', 'impuestoNombre', 'limiteVentaLibreCentavos', 'papelRecibo', 'reciboPie', 'tasaImpuestoBP'].sort());
    assert.deepEqual(doc.departamentos, [{ id: 'carne', nombre: 'Carne', claseFiscal: 'tasaCero', color: 'rojo' }]);
    assert.equal(doc.actualizadoPor, 'admin@aguila.test');
    assert.equal(doc.actualizadoEn, fecha);
  });
});
