// Genera el paquete ESM autocontenido del decodificador de códigos de barras
// (ZXing para el navegador) en vendor/zxing/<versión>/ a partir de npm.
// Se ejecuta una vez por versión (npm run vendorizar:zxing) y el resultado se
// sube al repositorio: la app no tiene paso de build ni llama a ningún CDN.
// Solo lo usa el escáner con cámara (teléfonos); se carga bajo demanda.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/@zxing/browser/package.json', 'utf8'));
const { version: versionLibreria } = JSON.parse(readFileSync('node_modules/@zxing/library/package.json', 'utf8'));
const salida = `vendor/zxing/${version}`;
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

const resultado = await build({
  entryPoints: { 'zxing-browser': 'herramientas/entradas/zxing-browser.js' },
  outdir: salida,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome100', 'safari15', 'firefox100'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
});

copyFileSync('node_modules/@zxing/browser/LICENSE', 'vendor/zxing/LICENSE-zxing-browser.txt');
copyFileSync('node_modules/@zxing/library/LICENSE', 'vendor/zxing/LICENSE-zxing-library.txt');
writeFileSync(
  `${salida}/VERSION.txt`,
  `@zxing/browser ${version} + @zxing/library ${versionLibreria}\nGenerado con herramientas/vendorizar-zxing.mjs (esbuild). MIT / Apache-2.0, ver ../LICENSE-*.txt.\n`,
);
for (const [ruta, info] of Object.entries(resultado.metafile.outputs)) console.log(`${ruta} (${Math.round(info.bytes / 1024)} KB)`);
