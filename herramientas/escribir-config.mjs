// Netlify: genera js/config.js en el despliegue a partir de la variable de
// entorno FIREBASE_WEB_CONFIG (el objeto de configuración web del SDK, tal
// cual lo muestra la consola de Firebase, con o sin comillas en las claves).
// Así las claves nunca se suben al repositorio. Si js/config.js ya existe
// (desarrollo local) y no hay variable, no se toca nada.
import { existsSync, writeFileSync } from 'node:fs';

const crudo = process.env.FIREBASE_WEB_CONFIG;
const destino = 'js/config.js';

if (!crudo) {
  if (existsSync(destino)) {
    console.log(`${destino} ya existe y no hay FIREBASE_WEB_CONFIG: se conserva.`);
    process.exit(0);
  }
  console.error('Falta la variable de entorno FIREBASE_WEB_CONFIG (Netlify → Site configuration → Environment variables).');
  process.exit(1);
}

let config;
try {
  // Acepta JSON estricto o el literal de JavaScript que muestra la consola.
  config = new Function(`return (${crudo});`)();
} catch (error) {
  console.error('FIREBASE_WEB_CONFIG no se pudo interpretar como objeto:', error.message);
  process.exit(1);
}

const requeridas = ['apiKey', 'authDomain', 'projectId', 'appId'];
const faltantes = requeridas.filter((clave) => typeof config?.[clave] !== 'string' || config[clave] === '');
if (faltantes.length > 0) {
  console.error(`FIREBASE_WEB_CONFIG incompleta; faltan: ${faltantes.join(', ')}`);
  process.exit(1);
}

const permitidas = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const limpia = Object.fromEntries(permitidas.filter((clave) => clave in config).map((clave) => [clave, String(config[clave])]));

writeFileSync(
  destino,
  `// Generado en el despliegue a partir de FIREBASE_WEB_CONFIG. No editar a mano.\n` +
    `export const firebaseConfig = ${JSON.stringify(limpia, null, 2)};\n` +
    `export const emuladores = null;\n`,
);
console.log(`${destino} generado para el proyecto ${limpia.projectId}.`);
