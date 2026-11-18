import assert from 'node:assert/strict';
import {
  nuevoCodigoEmpacado, armarEmpacado, cambiosEmpacado, cantidadEtiquetas, procedenciaEnIngles, fechaEmpaqueEnIngles,
  textoPicante, textosEtiquetaEmpaque, PAISES_EN_INGLES, REGEX_CODIGO_EMPACADO,
} from '../../js/empaque.js';
import { normalizarUPC } from '../../js/upca.js';
import { paisesSugeridos } from '../../js/inventario.js';
import { cargarIngles, fijarIdioma } from '../../js/idioma.js';

const CAPTURA = { nombre: '  Chicharrón   de harina ', precio: '3.99', claseFiscal: 'gravado', picante: false, frase: 'hecho', pais: 'mexico', tiendas: ['talbot', 'talbot'] };

describe('empacados en la tienda: código, captura y etiqueta', () => {
  it('el código nuevo es un UPC-A válido que empieza por 4 y no repite uno del catálogo', () => {
    const codigo = nuevoCodigoEmpacado();
    assert.match(codigo, REGEX_CODIGO_EMPACADO);
    assert.equal(normalizarUPC(codigo), codigo, 'el dígito verificador cuadra');
    // Con dígitos fijos: primero sale 4 + diez 1, que ya existe; luego 4 + diez 2.
    const fijos = [...'1111111111', ...'2222222222'].map(Number);
    const azar = () => fijos.shift();
    const ocupado = nuevoCodigoEmpacado(new Set(), () => 1);
    const otro = nuevoCodigoEmpacado(new Set([ocupado]), azar);
    assert.equal(otro.slice(0, 11), '42222222222');
    assert.throws(() => nuevoCodigoEmpacado(new Set([ocupado]), () => 1), /código nuevo/);
  });

  it('lo capturado: nombre limpio, precio en centavos, país como se guarda, tiendas sin repetir', () => {
    const { producto, empacado } = armarEmpacado(CAPTURA);
    assert.deepEqual(producto, {
      nombre: 'Chicharrón de harina', marca: null, descriptor: null, presentacion: '', plu: null,
      precioCentavos: 399, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: ['talbot'], proveedor: null, activo: true,
    });
    assert.deepEqual(empacado, { picante: false, procedencia: { frase: 'hecho', pais: 'México' } });
    assert.equal(armarEmpacado({ ...CAPTURA, pais: 'Oaxaca' }).empacado.procedencia.pais, 'Oaxaca', 'un país fuera de la lista, como se escribió');
  });

  it('lo que falta se dice: nada se supone (impuesto, picante, país, tienda)', () => {
    assert.throws(() => armarEmpacado({ ...CAPTURA, nombre: ' ' }), /nombre/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, precio: '' }), /precio/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, precio: '0' }), /mayor que cero/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, precio: 'tres' }), /Precio no válido/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, claseFiscal: null }), /impuesto/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, picante: null }), /picante/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, frase: 'otra' }), /Hecho en/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, pais: '' }), /país/);
    assert.throws(() => armarEmpacado({ ...CAPTURA, tiendas: [] }), /tienda/);
  });

  it('al editar: solo lo que cambió del producto, y el empacado solo si cambió', () => {
    const actual = { id: 'e1', nombre: 'Chicharrón de harina', precioCentavos: 399, claseFiscal: 'gravado', tiendas: ['talbot'] };
    const empacadoActual = { picante: false, procedencia: { frase: 'hecho', pais: 'México' } };
    assert.deepEqual(cambiosEmpacado(actual, empacadoActual, armarEmpacado(CAPTURA)), { cambiosProducto: {}, empacado: null });
    const otro = armarEmpacado({ ...CAPTURA, precio: '4.49', picante: true, tiendas: ['erie', 'talbot'] });
    assert.deepEqual(cambiosEmpacado(actual, empacadoActual, otro), {
      cambiosProducto: { precioCentavos: 449, tiendas: ['erie', 'talbot'] },
      empacado: { picante: true, procedencia: { frase: 'hecho', pais: 'México' } },
    });
  });

  it('cuántas etiquetas: de 1 a 200 de una vez', () => {
    assert.equal(cantidadEtiquetas(' 20 '), 20);
    assert.equal(cantidadEtiquetas('200'), 200);
    for (const malo of ['0', '201', '2.5', '', 'diez']) assert.throws(() => cantidadEtiquetas(malo), /de 1 a 200/, malo);
  });

  it('la etiqueta va en inglés (salvo el nombre), sin importar el idioma de la pantalla', async () => {
    assert.equal(procedenciaEnIngles({ frase: 'hecho', pais: 'Canadá' }), 'Made in Canada');
    assert.equal(procedenciaEnIngles({ frase: 'producto', pais: 'México' }), 'Product of Mexico');
    assert.equal(procedenciaEnIngles({ frase: 'producto', pais: 'Estados Unidos' }), 'Product of USA');
    assert.equal(procedenciaEnIngles({ frase: 'hecho', pais: 'Oaxaca' }), 'Made in Oaxaca');
    assert.equal(fechaEmpaqueEnIngles('2026-11-18'), 'Packed on Nov 18, 2026');
    assert.throws(() => fechaEmpaqueEnIngles('2026-02-30'), /fecha de empaque/);
    assert.equal(textoPicante(true), 'Spicy');
    assert.equal(textoPicante(false), 'Not spicy');
    const producto = { nombre: 'CHILE PASILLA', upc: '412345678906' };
    const empacado = { picante: true, procedencia: { frase: 'producto', pais: 'México' } };
    const esperado = { nombre: 'CHILE PASILLA', procedencia: 'Product of Mexico', picante: 'Spicy', fecha: 'Packed on Nov 18, 2026', codigo: '412345678906' };
    assert.deepEqual(textosEtiquetaEmpaque(producto, empacado, '2026-11-18'), esperado);
    await cargarIngles();
    fijarIdioma('en');
    try {
      assert.deepEqual(textosEtiquetaEmpaque(producto, empacado, '2026-11-18'), esperado, 'con la pantalla en inglés, igual');
      assert.equal(armarEmpacado({ ...CAPTURA, pais: 'United States' }).empacado.procedencia.pais, 'Estados Unidos', 'el país elegido en inglés se guarda igual');
    } finally {
      fijarIdioma(null);
    }
  });

  it('cada país que se sugiere tiene su nombre en inglés para la etiqueta', () => {
    assert.deepEqual([...paisesSugeridos()].sort(), Object.keys(PAISES_EN_INGLES).sort());
  });
});
