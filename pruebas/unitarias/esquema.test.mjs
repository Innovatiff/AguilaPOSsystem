import assert from 'node:assert/strict';
import {
  tokensBusqueda, normalizarTexto, prepararConsulta, validarProducto, armarProducto,
  fechaISOLocal, idHistorialPrecio, pareceUPC, CAMPOS_PRODUCTO,
} from '../../js/esquema.js';

const productoValido = () => ({
  ...armarProducto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: ['talbot'] }, 'ana@aguila.test'),
  creadoEn: { seconds: 1 }, actualizadoEn: { seconds: 1 },
});

describe('normalizarTexto', () => {
  it('quita acentos y la eñe, pasa a minúsculas y colapsa espacios', () => {
    assert.equal(normalizarTexto('  Piña   COLADA Ándale '), 'pina colada andale');
  });
});

describe('tokensBusqueda', () => {
  it('genera todos los prefijos de 3 o más letras de cada palabra de nombre y marca', () => {
    assert.deepEqual(tokensBusqueda('Salsa Verde', 'La Costeña'), [
      'cos', 'cost', 'coste', 'costen', 'costena',
      'sal', 'sals', 'salsa',
      'ver', 'verd', 'verde',
    ]);
  });
  it('ignora palabras de menos de 3 letras y no repite tokens', () => {
    assert.deepEqual(tokensBusqueda('de la', null), []);
    assert.deepEqual(tokensBusqueda('Tajin', 'TAJIN'), ['taj', 'taji', 'tajin']);
  });
});

describe('prepararConsulta', () => {
  it('usa el término más largo para array-contains y deja el resto para filtrar', () => {
    assert.deepEqual(prepararConsulta('sal verde'), { termino: 'verde', resto: ['sal'] });
    assert.deepEqual(prepararConsulta('de'), { termino: null, resto: [] });
  });
});

describe('pareceUPC', () => {
  it('reconoce lo que teclea el escáner', () => {
    assert.equal(pareceUPC('633148100013'), true);
    assert.equal(pareceUPC('0633148100013'), true);
    assert.equal(pareceUPC('tajin'), false);
  });
});

describe('validarProducto', () => {
  it('acepta un producto completo y correcto', () => {
    assert.deepEqual(validarProducto(productoValido()), []);
  });
  it('rechaza campos de más y campos que faltan', () => {
    const conExtra = { ...productoValido(), color: 'rojo' };
    assert.match(validarProducto(conExtra).join(' '), /Campo no permitido: color/);
    const sinNombre = productoValido();
    delete sinNombre.nombre;
    assert.match(validarProducto(sinNombre).join(' '), /Falta el campo nombre/);
  });
  it('rechaza precios que no sean enteros en centavos', () => {
    assert.match(validarProducto({ ...productoValido(), precioCentavos: 4.99 }).join(' '), /entero en centavos/);
  });
  it('exige precio por kilo en productos por peso y lo prohíbe por pieza', () => {
    assert.match(validarProducto({ ...productoValido(), unidadVenta: 'peso' }).join(' '), /precio por kilo/);
    assert.deepEqual(validarProducto({ ...productoValido(), upc: null, unidadVenta: 'peso', precioPorKgCentavos: 1599, precioCentavos: 0 }), []);
    assert.match(validarProducto({ ...productoValido(), precioPorKgCentavos: 100 }).join(' '), /no lleva precio por kilo/);
  });
  it('valida UPC, PLU, clase fiscal y fecha de impresión', () => {
    assert.match(validarProducto({ ...productoValido(), upc: '12345' }).join(' '), /UPC/);
    assert.match(validarProducto({ ...productoValido(), plu: '12' }).join(' '), /PLU/);
    assert.match(validarProducto({ ...productoValido(), claseFiscal: 'exento' }).join(' '), /clase fiscal/);
    assert.match(validarProducto({ ...productoValido(), fechaUltimaImpresion: '24/09/2026' }).join(' '), /YYYY-MM-DD/);
  });
});

describe('armarProducto', () => {
  it('produce exactamente los campos del esquema (menos las marcas de tiempo) con los del POS en null', () => {
    const p = armarProducto({ nombre: 'Chile Guajillo', presentacion: '', precioCentavos: 500, claseFiscal: 'tasaCero' }, 'ANA@Aguila.test');
    const esperados = CAMPOS_PRODUCTO.filter((c) => c !== 'creadoEn' && c !== 'actualizadoEn');
    assert.deepEqual(Object.keys(p).sort(), [...esperados].sort());
    assert.equal(p.upc, null);
    assert.equal(p.existencias, null);
    assert.equal(p.costoCentavos, null);
    assert.equal(p.actualizadoPor, 'ana@aguila.test');
    assert.deepEqual(p.tokensBusqueda, ['chi', 'chil', 'chile', 'gua', 'guaj', 'guaji', 'guajil', 'guajill', 'guajillo']);
  });
});

describe('fechas e ids', () => {
  it('fechaISOLocal usa el reloj local en formato YYYY-MM-DD', () => {
    assert.equal(fechaISOLocal(new Date(2026, 8, 24, 23, 30)), '2026-09-24');
  });
  it('idHistorialPrecio combina producto y milisegundos', () => {
    assert.equal(idHistorialPrecio('abc', 1700000000000), 'abc_1700000000000');
    assert.throws(() => idHistorialPrecio('abc', 1.5));
  });
});
