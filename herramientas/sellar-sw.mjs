// Netlify: sella sw.js con la versión del despliegue (commit) para que la
// caché del service worker cambie en cada publicación y las viejas se borren.
import { readFileSync, writeFileSync } from 'node:fs';

const ruta = 'sw.js';
const contenido = readFileSync(ruta, 'utf8');
if (!contenido.includes('__VERSION__')) {
  console.log('sw.js ya estaba sellado.');
  process.exit(0);
}
const version =
  (process.env.COMMIT_REF || '').slice(0, 12) || new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
writeFileSync(ruta, contenido.replace('__VERSION__', version));
console.log(`sw.js sellado con la versión ${version}.`);
