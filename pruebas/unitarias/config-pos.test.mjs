import assert from 'node:assert/strict';
import {
  configConDefectos, validarDepartamento, armarConfigPos, CONFIG_POS_DEFECTO, DEPARTAMENTOS_DEFECTO, MAXIMO_DEPARTAMENTOS,
  nombreDepartamento, nombreDepartamentoPorId, nombreDeLinea,
} from '../../js/config-pos.js';
import { cargarIngles, fijarIdioma } from '../../js/idioma.js';

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
    assert.deepEqual(doc.departamentos, [{ id: 'carne', nombre: 'Carne', nombreEn: null, claseFiscal: 'tasaCero', color: 'rojo' }]);
    assert.equal(doc.actualizadoPor, 'admin@aguila.test');
    assert.equal(doc.actualizadoEn, fecha);
  });

  it('cada tecla puede tener su nombre en inglés (las de fábrica ya lo traen)', () => {
    assert.ok(DEPARTAMENTOS_DEFECTO.every((d) => typeof d.nombreEn === 'string' && d.nombreEn.length <= 30));
    // Una configuración guardada antes de existir el campo: las teclas de fábrica toman su nombre en inglés; las renombradas, no.
    const c = configConDefectos({ departamentos: [
      { id: 'carniceria', nombre: 'Carnicería', claseFiscal: 'tasaCero', color: 'rojo' },
      { id: 'panaderia', nombre: 'Pan dulce', claseFiscal: 'tasaCero', color: 'amarillo' },
      { id: 'tortilleria', nombre: 'Tortillería', nombreEn: ' Tortillas ', claseFiscal: 'tasaCero', color: 'amarillo' },
    ] });
    assert.deepEqual(c.departamentos.map((d) => d.nombreEn), ['Meat', null, 'Tortillas']);
    assert.equal(validarDepartamento({ id: 'ok-1', nombre: 'Tortillería', nombreEn: 'x'.repeat(31), claseFiscal: 'tasaCero', color: 'amarillo' }).length, 1);
    assert.deepEqual(validarDepartamento({ id: 'ok-1', nombre: 'Tortillería', nombreEn: null, claseFiscal: 'tasaCero', color: 'amarillo' }), []);
    const doc = armarConfigPos(c, 'admin@aguila.test', new Date(0));
    assert.deepEqual(doc.departamentos.map((d) => d.nombreEn), ['Meat', null, 'Tortillas']);
  });

  it('en inglés se ve el nombre en inglés; lo guardado en una venta, en español, queda tal cual', async () => {
    const { departamentos } = configConDefectos(null);
    const carne = departamentos.find((d) => d.id === 'carniceria');
    const libre = { productoId: null, departamento: 'carniceria', nombre: 'Carnicería' };
    const producto = { productoId: 'p1', departamento: null, nombre: 'TAJIN' };
    assert.equal(nombreDepartamento(carne), 'Carnicería');
    assert.equal(nombreDepartamentoPorId(departamentos, 'carniceria', 'Carne (nombre viejo)'), 'Carne (nombre viejo)');
    assert.equal(nombreDeLinea(libre, departamentos), 'Carnicería');
    await cargarIngles();
    fijarIdioma('en');
    try {
      assert.equal(nombreDepartamento(carne), 'Meat');
      assert.equal(nombreDepartamento({ ...carne, nombreEn: null }), 'Carnicería', 'sin nombre en inglés, el de siempre');
      assert.equal(nombreDepartamentoPorId(departamentos, 'carniceria', 'Carnicería'), 'Meat');
      assert.equal(nombreDepartamentoPorId(departamentos, 'ya-no-existe', 'Tortillería'), 'Tortillería');
      assert.equal(nombreDeLinea(libre, departamentos), 'Meat');
      assert.equal(nombreDeLinea(producto, departamentos), 'TAJIN');
    } finally {
      fijarIdioma(null);
    }
  });
});
