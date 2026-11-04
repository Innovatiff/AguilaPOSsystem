import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PAGINAS, paginaDeCatalogo } from '../../herramientas/paginas-catalogo.mjs';

describe('app Catálogo: páginas generadas', () => {
  for (const pagina of PAGINAS) {
    it(`${pagina.destino} está al día con ${pagina.fuente} (node herramientas/paginas-catalogo.mjs)`, () => {
      assert.equal(readFileSync(pagina.destino, 'utf8'), paginaDeCatalogo(readFileSync(pagina.fuente, 'utf8'), pagina));
    });
  }
  it('las rutas suben un nivel y no queda ninguna relativa a la raíz', () => {
    const html = paginaDeCatalogo(readFileSync('productos.html', 'utf8'), PAGINAS[0]);
    assert.match(html, /src="\.\.\/js\/pantalla-productos\.js"/);
    assert.match(html, /href="\.\.\/css\/base\.css"/);
    assert.doesNotMatch(html, /(href|src)="(css|js|icons)\//);
    assert.match(html, /<title>Productos · Águila Catálogo<\/title>/);
  });
  it('ninguna página del Catálogo enlaza al back office', () => {
    for (const ruta of ['catalogo/index.html', 'catalogo/captura.html', 'catalogo/etiquetas.html', 'catalogo/inventario.html', 'catalogo/solicitudes.html', 'catalogo/entrar.html']) {
      const html = readFileSync(ruta, 'utf8');
      assert.doesNotMatch(html, /href="(\.\.\/)?(index|ventas|movimientos|transacciones|inventario|turnos|reportes|productos|captura|imprimir|solicitudes|cuenta)\.html"/, ruta);
      assert.doesNotMatch(html, /href="(\.\.\/)?gestion\//, ruta);
    }
  });
});
