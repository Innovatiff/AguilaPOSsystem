/**
 * Traduce lo que viene escrito en la página (HTML estático) al idioma elegido:
 * textos, título y los atributos placeholder, title, aria-label y alt. Es el
 * primer módulo de cada página, así que corre antes de que las pantallas
 * pinten lo suyo (eso lo traducen ellas con t()). Un texto se traduce si su
 * versión exacta (espacios juntados) está en el diccionario; lo marcado con
 * data-sin-traducir (datos) se deja tal cual.
 */
import { enIngles, traducirTexto } from './idioma.js';

const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'];
const OMITIR = 'script, style, code, pre, [data-sin-traducir]';

const juntar = (texto) => texto.replace(/\s+/g, ' ').trim();

/** Traduce un texto conservando los espacios de los lados. */
function traducirConEspacios(original) {
  const limpio = juntar(original);
  if (!limpio) return original;
  const traducido = traducirTexto(limpio);
  if (traducido === limpio) return original;
  const inicio = /^\s*/.exec(original)[0] ? ' ' : '';
  const fin = /\s*$/.exec(original)[0] ? ' ' : '';
  return `${inicio}${traducido}${fin}`;
}

/** Una parte del título: primero su traducción como título («titulo|Entrar» → «Sign In»), si la hay. */
function traducirParteDeTitulo(parte) {
  const limpio = juntar(parte);
  const comoTitulo = traducirTexto(`titulo|${limpio}`);
  return comoTitulo === `titulo|${limpio}` ? traducirTexto(limpio) : comoTitulo;
}

/** «Movimientos en vivo · Águila POS» → «Live Activity · Águila POS». */
export function traducirTitulo(titulo) {
  return titulo.split(' · ').map(traducirParteDeTitulo).join(' · ');
}

/** Traduce el texto y los atributos de un trozo de la página (por defecto, toda). */
export function traducirPagina(raiz = document.body) {
  if (!enIngles() || !raiz) return;
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const nodos = [];
  for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) nodos.push(nodo);
  for (const nodo of nodos) {
    if (nodo.parentElement?.closest(OMITIR)) continue;
    const nuevo = traducirConEspacios(nodo.nodeValue);
    if (nuevo !== nodo.nodeValue) nodo.nodeValue = nuevo;
  }
  const elementos = raiz.querySelectorAll(ATRIBUTOS.map((a) => `[${a}]`).join(','));
  for (const el of [raiz, ...elementos]) {
    if (!el.getAttribute || el.closest(OMITIR)) continue;
    for (const atributo of ATRIBUTOS) {
      const valor = el.getAttribute(atributo);
      if (valor) el.setAttribute(atributo, traducirConEspacios(valor));
    }
  }
}

if (typeof document !== 'undefined') {
  if (enIngles()) {
    document.documentElement.lang = 'en';
    document.title = traducirTitulo(document.title);
    traducirPagina(document.body);
  }
  document.documentElement.classList.remove('i18n-pendiente');
}
