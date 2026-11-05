// Idioma, antes de pintar nada (script clásico en <head>, sin módulos): en
// inglés, la página queda oculta hasta que js/traducir-pagina.js la traduce,
// para que no se vea un instante en español. Si algo falla, se muestra igual.
(function () {
  var ingles = false;
  try {
    ingles = window.localStorage.getItem('aguila.idioma') === 'en';
  } catch (e) {
    ingles = false;
  }
  var raiz = document.documentElement;
  raiz.lang = ingles ? 'en' : 'es';
  if (!ingles) return;
  raiz.classList.add('i18n-pendiente');
  var estilo = document.createElement('style');
  estilo.textContent = 'html.i18n-pendiente body{visibility:hidden}';
  document.head.appendChild(estilo);
  window.setTimeout(function () {
    raiz.classList.remove('i18n-pendiente');
  }, 2500);
}());
