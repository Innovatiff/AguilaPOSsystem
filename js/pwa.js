/** Registra el service worker (sw.js) que guarda la cáscara de la app. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}
