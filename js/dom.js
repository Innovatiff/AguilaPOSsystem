/**
 * Construcción de DOM sin plantillas de texto (los datos nunca pasan por
 * innerHTML). La usan la caja y el back office.
 */

/**
 * Crea un elemento: h('div', { class: 'x', text: 'hola', onclick: fn, dataset: {…} }, …hijos)
 * Los atributos con valor null, undefined o false se omiten; true = atributo vacío.
 */
export function h(etiqueta, props = null, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'text') nodo.textContent = valor;
    else if (clave === 'dataset') Object.assign(nodo.dataset, valor);
    else if (clave.startsWith('on') && typeof valor === 'function') nodo.addEventListener(clave.slice(2), valor);
    else if (valor === true) nodo.setAttribute(clave, '');
    else nodo.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : String(hijo));
  }
  return nodo;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elemento SVG con atributos: s('rect', { x: 0, y: 0, width: 10, height: 10 }) */
export function s(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElementNS(SVG_NS, etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    nodo.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}
