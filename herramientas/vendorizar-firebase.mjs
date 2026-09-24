// Genera los paquetes ESM autocontenidos del SDK de Firebase en
// vendor/firebase/<versión>/ a partir del paquete npm "firebase".
// Se ejecuta una vez por versión (npm run vendorizar) y el resultado se sube
// al repositorio: la app no tiene paso de build ni llama a ningún CDN.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/firebase/package.json', 'utf8'));
const salida = `vendor/firebase/${version}`;
rmSync(salida, { recursive: true, force: true });
mkdirSync(salida, { recursive: true });

const resultado = await build({
  entryPoints: {
    'firebase-app': 'herramientas/entradas/firebase-app.js',
    'firebase-auth': 'herramientas/entradas/firebase-auth.js',
    'firebase-firestore': 'herramientas/entradas/firebase-firestore.js',
  },
  outdir: salida,
  bundle: true,
  format: 'esm',
  splitting: true,          // @firebase/app y utilidades quedan en un trozo compartido: una sola instancia
  platform: 'browser',
  target: ['chrome110'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  chunkNames: 'compartido-[hash]',
  metafile: true,
  logLevel: 'info',
});

// Licencia Apache-2.0 del SDK: se copia del paquete si viene incluida.
const candidatas = ['node_modules/firebase/LICENSE', 'node_modules/@firebase/app/LICENSE', 'node_modules/@firebase/util/LICENSE'];
const licencia = candidatas.find((ruta) => existsSync(ruta));
if (licencia) {
  copyFileSync(licencia, 'vendor/firebase/LICENSE');
} else {
  writeFileSync('vendor/firebase/LICENSE', 'Firebase JavaScript SDK · Copyright Google LLC · Apache License 2.0\nhttps://github.com/firebase/firebase-js-sdk/blob/main/LICENSE\n');
}
writeFileSync(
  `${salida}/VERSION.txt`,
  `firebase ${version}\nGenerado con herramientas/vendorizar-firebase.mjs (esbuild). Apache-2.0, ver ../LICENSE.\n`,
);
const archivos = Object.entries(resultado.metafile.outputs).map(([ruta, info]) => `${ruta} (${Math.round(info.bytes / 1024)} KB)`);
console.log(archivos.join('\n'));
