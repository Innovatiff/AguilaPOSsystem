/**
 * Service worker de Catálogo Águila.
 *
 * - Guarda la cáscara de las dos apps, el back office y la caja registradora
 *   (/caja/): páginas, CSS, JS, SDK y decodificador vendidos, fuente, iconos.
 *   Sin red, la caja sigue abriendo y vendiendo desde la caché.
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
  'ventas.html',
  'turnos.html',
  'reportes.html',
  'productos.html',
  'captura.html',
  'imprimir.html',
  'cuenta.html',
  'prueba-etiquetas.html',
  'gestion/index.html',
  'gestion/empleados.html',
  'gestion/cajas.html',
  'gestion/tiendas.html',
  'gestion/configuracion.html',
  'gestion/datos.html',
  'caja/',
  'caja/index.html',
  'manifest.webmanifest',
  'caja/manifest.webmanifest',
  'css/base.css',
  'css/caja.css',
  'css/etiquetas.css',
  'css/recibo.css',
  'fonts/Oswald-Variable.woff2',
  'icons/icono-180.png',
  'icons/icono-192.png',
  'icons/icono-512.png',
  'icons/icono-maskable-512.png',
  'js/auth.js',
  'js/avisos.js',
  'js/bo.js',
  'js/bo-reportes.js',
  'js/bo-turnos.js',
  'js/bo-ventas.js',
  'js/caja.js',
  'js/caja-local.js',
  'js/caja-pago.js',
  'js/caja-turno.js',
  'js/caja-ui.js',
  'js/code128.js',
  'js/config-pos.js',
  'js/csv.js',
  'js/cuenta.js',
  'js/cuentas.js',
  'js/dom.js',
  'js/escaner.js',
  'js/esquema.js',
  'js/etiquetas.js',
  'js/firebase.js',
  'js/gestion-cajas.js',
  'js/gestion-configuracion.js',
  'js/gestion-datos.js',
  'js/gestion-empleados.js',
  'js/gestion-tiendas.js',
  'js/grafica.js',
  'js/identidad.js',
  'js/inicio.js',
  'js/login.js',
  'js/nav.js',
  'js/paginacion.js',
  'js/pantalla-captura.js',
  'js/pantalla-imprimir.js',
  'js/pantalla-productos.js',
  'js/personal.js',
  'js/pos-datos.js',
  'js/precios.js',
  'js/productos.js',
  'js/recibo.js',
  'js/ticket.js',
  'js/turnos.js',
  'js/prueba-etiquetas.js',
  'js/pwa.js',
  'js/upca.js',
  'js/verificador.js',
  'vendor/firebase/12.19.0/firebase-app.js',
  'vendor/firebase/12.19.0/firebase-auth.js',
  'vendor/firebase/12.19.0/firebase-firestore.js',
  'vendor/firebase/12.19.0/compartido-7XAY5J2H.js',
  'vendor/zxing/0.2.1/zxing-browser.js',
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
      // Sin red: la caja abre su propia pantalla; el resto, el inicio.
      const enCaja = new URL(request.url).pathname.includes('/caja/');
      const inicio = await cache.match(enCaja ? 'caja/index.html' : 'index.html');
      if (inicio) return inicio;
    }
    throw error;
  }
}
