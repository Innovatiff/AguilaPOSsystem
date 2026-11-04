// App Catálogo (catalogo/): sus pantallas de productos, captura, etiquetas e inventario son
// las mismas del back office (js/pantalla-*.js deciden según la app y el rol),
// así que sus páginas se generan a partir de las del back office: rutas un
// nivel más arriba, título y nombre de la app. Sin build: el resultado se sube.
//   node herramientas/paginas-catalogo.mjs
// pruebas/unitarias/catalogo.test.mjs comprueba que estén al día.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PAGINAS = Object.freeze([
  { fuente: 'productos.html', destino: 'catalogo/index.html', titulo: 'Productos' },
  { fuente: 'captura.html', destino: 'catalogo/captura.html', titulo: 'Captura rápida' },
  { fuente: 'imprimir.html', destino: 'catalogo/etiquetas.html', titulo: 'Etiquetas' },
  { fuente: 'inventario.html', destino: 'catalogo/inventario.html', titulo: 'Recibir mercancía' },
]);

const AVISO = '<!-- Generada por herramientas/paginas-catalogo.mjs a partir de la página del back office. No editar a mano. -->';

/** HTML de la página del Catálogo a partir del de la página del back office. */
export function paginaDeCatalogo(html, { titulo }) {
  return html
    .replace(/^<!DOCTYPE html>\n/, `<!DOCTYPE html>\n${AVISO}\n`)
    .replace(/(href|src)="(css|js|icons|vendor|fonts)\//g, '$1="../$2/')
    .replace(/<title>[^<]*<\/title>/, `<title>${titulo} · Águila Catálogo</title>`)
    .replace('<meta name="apple-mobile-web-app-title" content="Águila POS">', '<meta name="apple-mobile-web-app-title" content="Catálogo">');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const pagina of PAGINAS) {
    writeFileSync(pagina.destino, paginaDeCatalogo(readFileSync(pagina.fuente, 'utf8'), pagina));
    console.log(`${pagina.destino} ← ${pagina.fuente}`);
  }
}
