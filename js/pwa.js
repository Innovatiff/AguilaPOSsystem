/** Registra el service worker (sw.js, en la raíz) desde cualquier página, también las de gestion/. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch((error) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}
