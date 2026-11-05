/**
 * Botón para cambiar de idioma: muestra el otro idioma («English» o
 * «Español»), lo guarda en este navegador y recarga la página (todo se vuelve
 * a pintar en el idioma nuevo, también lo que se imprima después).
 * `antesDeRecargar` deja que la pantalla guarde algo antes (la caja lo usa
 * para no bloquearse al volver).
 */
import { idioma, guardarIdioma } from './idioma.js';

const GLOBO = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18';

export function botonIdioma({ clase = 'boton-idioma', antesDeRecargar = null } = {}) {
  const otro = idioma() === 'en' ? 'es' : 'en';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase;
  boton.lang = otro;
  boton.dataset.idioma = otro;
  boton.setAttribute('aria-label', otro === 'en' ? 'Switch to English' : 'Cambiar a español');
  boton.title = boton.getAttribute('aria-label');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'boton-idioma__icono');
  const trazo = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trazo.setAttribute('d', GLOBO);
  svg.append(trazo);
  const texto = document.createElement('span');
  texto.textContent = otro === 'en' ? 'English' : 'Español';
  boton.append(svg, texto);
  boton.addEventListener('click', () => {
    guardarIdioma(otro);
    antesDeRecargar?.(otro);
    window.location.reload();
  });
  return boton;
}
