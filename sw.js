/**
 * Service worker de Catálogo Águila.
 *
 * - Guarda la cáscara de la app (páginas, CSS, JS, SDK vendido, fuente, iconos).
 * - NUNCA guarda js/config.js ni nada que no sea de este mismo origen: las
 *   llamadas a Firestore y Auth (googleapis.com) pasan de largo, sin caché.
 * - La caché lleva versión: en cada despliegue Netlify sustituye __VERSION__
 *   por el commit (herramientas/sellar-sw.mjs); al activarse la versión nueva
 *   se borran las anteriores.
 * - Estrategia: red primero para páginas, CSS y JS (los despliegues se ven en
 *   la siguiente carga); caché primero para vendor/ y fonts/ (inmutables).
 *   Sin red, todo se sirve de la caché.
 *
 * Al añadir archivos a la app, añadirlos también a CASCARA.
 */
const VERSION = '__VERSION__';
const CACHE = `catalogo-aguila-${VERSION}`;
const PREFIJO = 'catalogo-aguila-';
const NUNCA_CACHEAR = /\/js\/config\.js$/;
const INMUTABLES = /\/(vendor|fonts)\//;

const CASCARA = [
  './',
  'index.html',
  'login.html',
  'productos.html',
  'captura.html',
  'imprimir.html',
  'administracion.html',
  'prueba-etiquetas.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/etiquetas.css',
  'fonts/Oswald-Variable.woff2',
  'icons/icono-192.png',
  'icons/icono-512.png',
  'icons/icono-maskable-512.png',
  'js/administracion.js',
  'js/auth.js',
  'js/avisos.js',
  'js/esquema.js',
  'js/etiquetas.js',
  'js/firebase.js',
  'js/inicio.js',
  'js/login.js',
  'js/nav.js',
  'js/pantalla-captura.js',
  'js/pantalla-imprimir.js',
  'js/pantalla-productos.js',
  'js/precios.js',
  'js/productos.js',
  'js/prueba-etiquetas.js',
  'js/pwa.js',
  'js/upca.js',
  'vendor/firebase/12.19.0/firebase-app.js',
  'vendor/firebase/12.19.0/firebase-auth.js',
  'vendor/firebase/12.19.0/firebase-firestore.js',
  'vendor/firebase/12.19.0/compartido-7XAY5J2H.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CASCARA)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((clave) => clave.startsWith(PREFIJO) && clave !== CACHE).map((clave) => caches.delete(clave))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firestore, Auth, etc.: directo a la red
  if (NUNCA_CACHEAR.test(url.pathname)) return; // config.js: siempre de la red
  evento.respondWith(INMUTABLES.test(url.pathname) ? cachePrimero(request) : redPrimero(request));
});

async function cachePrimero(request) {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta.ok) cache.put(request, respuesta.clone());
  return respuesta;
}

async function redPrimero(request) {
  const cache = await caches.open(CACHE);
  try {
    const respuesta = await fetch(request);
    if (respuesta.ok) cache.put(request, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(request, { ignoreSearch: true });
    if (guardada) return guardada;
    if (request.mode === 'navigate') {
      const inicio = await cache.match('index.html');
      if (inicio) return inicio;
    }
    throw error;
  }
}
