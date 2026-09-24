import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

describe('service worker', () => {
  const codigo = readFileSync('sw.js', 'utf8');
  const lista = /const CASCARA = \[([\s\S]*?)\];/.exec(codigo)[1];
  const archivos = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((r) => r !== './');

  it('todos los archivos de la cáscara existen', () => {
    const faltan = archivos.filter((ruta) => !existsSync(ruta));
    assert.deepEqual(faltan, []);
  });
  it('nunca precachea js/config.js ni sw.js', () => {
    assert.ok(!archivos.includes('js/config.js'));
    assert.ok(!archivos.includes('sw.js'));
    assert.match(codigo, /NUNCA_CACHEAR = \/\\\/js\\\/config\\\.js\$\//);
  });
  it('incluye todos los módulos de js/ salvo config', () => {
    const modulos = ['administracion', 'auth', 'avisos', 'csv', 'esquema', 'etiquetas', 'firebase', 'inicio', 'login', 'nav', 'pantalla-captura', 'pantalla-datos', 'pantalla-imprimir', 'pantalla-productos', 'precios', 'productos', 'prueba-etiquetas', 'pwa', 'upca'];
    for (const m of modulos) assert.ok(archivos.includes(`js/${m}.js`), `falta js/${m}.js`);
  });
  it('lleva la marca de versión que sella el despliegue', () => {
    assert.match(codigo, /const VERSION = '__VERSION__'/);
  });
});
