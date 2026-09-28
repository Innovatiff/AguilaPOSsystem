import assert from 'node:assert/strict';
import { paginar, ventanaDePaginas, tamanoDePagina, TAMANOS_PAGINA, POR_PAGINA_DEFECTO } from '../../js/paginacion.js';

describe('paginar', () => {
  const lista = Array.from({ length: 122 }, (_, i) => i + 1);

  it('corta la página pedida y devuelve el rango en base 1', () => {
    const r = paginar(lista, 2, 50);
    assert.deepEqual([r.pagina, r.paginas, r.total, r.inicio, r.fin], [2, 3, 122, 51, 100]);
    assert.deepEqual([r.elementos[0], r.elementos.at(-1), r.elementos.length], [51, 100, 50]);
  });
  it('la última página lleva el resto', () => {
    const r = paginar(lista, 3, 50);
    assert.deepEqual([r.inicio, r.fin, r.elementos.length], [101, 122, 22]);
  });
  it('acota la página a [1, páginas] y tolera basura', () => {
    assert.equal(paginar(lista, 99, 50).pagina, 3);
    assert.equal(paginar(lista, 0, 50).pagina, 1);
    assert.equal(paginar(lista, NaN, 50).pagina, 1);
    assert.equal(paginar(lista, '2', '25').inicio, 26);
  });
  it('una lista vacía es una sola página vacía', () => {
    const r = paginar([], 4, 50);
    assert.deepEqual([r.pagina, r.paginas, r.total, r.inicio, r.fin, r.elementos], [1, 1, 0, 0, 0, []]);
  });
  it('un tamaño inválido no divide entre cero', () => {
    assert.equal(paginar(lista, 1, 0).paginas, 122);
    assert.equal(paginar(lista, 1, undefined).paginas, 122);
  });
});

describe('ventanaDePaginas', () => {
  it('con pocas páginas las lista todas', () => {
    assert.deepEqual(ventanaDePaginas(1, 1), [1]);
    assert.deepEqual(ventanaDePaginas(2, 3), [1, 2, 3]);
    assert.deepEqual(ventanaDePaginas(5, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('abre una ventana alrededor de la actual con huecos a ambos lados', () => {
    assert.deepEqual(ventanaDePaginas(20, 37), [1, null, 18, 19, 20, 21, 22, null, 37]);
  });
  it('cerca del inicio corre la ventana y no deja huecos de una sola página', () => {
    assert.deepEqual(ventanaDePaginas(1, 37), [1, 2, 3, 4, 5, 6, null, 37]);
    assert.deepEqual(ventanaDePaginas(5, 37), [1, 2, 3, 4, 5, 6, 7, null, 37]);
  });
  it('cerca del final igual', () => {
    assert.deepEqual(ventanaDePaginas(37, 37), [1, null, 32, 33, 34, 35, 36, 37]);
    assert.deepEqual(ventanaDePaginas(33, 37), [1, null, 31, 32, 33, 34, 35, 36, 37]);
  });
  it('siempre incluye la página actual y devuelve números crecientes', () => {
    for (let paginas = 1; paginas <= 60; paginas += 1) {
      for (let pagina = 1; pagina <= paginas; pagina += 1) {
        const v = ventanaDePaginas(pagina, paginas);
        assert.ok(v.includes(pagina), `${pagina}/${paginas}`);
        const numeros = v.filter((n) => n !== null);
        assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b));
        assert.equal(numeros[0], 1);
        assert.equal(numeros.at(-1), paginas);
      }
    }
  });
});

describe('tamanoDePagina', () => {
  it('acepta solo los tamaños ofrecidos y cae al de defecto', () => {
    assert.deepEqual([...TAMANOS_PAGINA], [25, 50, 100]);
    assert.equal(tamanoDePagina('100'), 100);
    assert.equal(tamanoDePagina(25), 25);
    assert.equal(tamanoDePagina('7'), POR_PAGINA_DEFECTO);
    assert.equal(tamanoDePagina(null), 50);
  });
});
