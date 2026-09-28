/**
 * Paginación de listas en memoria: pura, sin DOM, para que la pantalla de
 * productos (y cualquier otra) corte sus resultados en páginas y pinte los
 * botones sin repetir la aritmética.
 */

/** Tamaños de página que se ofrecen a la persona. */
export const TAMANOS_PAGINA = Object.freeze([25, 50, 100]);
export const POR_PAGINA_DEFECTO = 50;

/** Normaliza un tamaño de página leído de una preferencia guardada. */
export function tamanoDePagina(valor, porDefecto = POR_PAGINA_DEFECTO) {
  const n = Number(valor);
  return TAMANOS_PAGINA.includes(n) ? n : porDefecto;
}

/**
 * Corta `lista` en la página pedida. La página se acota a [1, páginas], así
 * que un filtro que deja menos resultados nunca deja la vista en blanco.
 * `inicio` y `fin` van en base 1 (0 y 0 cuando no hay nada).
 */
export function paginar(lista, pagina, porPagina) {
  const total = lista.length;
  const tamano = Math.max(1, Math.trunc(Number(porPagina)) || 1);
  const paginas = Math.max(1, Math.ceil(total / tamano));
  const actual = Math.min(Math.max(1, Math.trunc(Number(pagina)) || 1), paginas);
  const desde = (actual - 1) * tamano;
  const elementos = lista.slice(desde, desde + tamano);
  return {
    pagina: actual,
    paginas,
    total,
    inicio: total === 0 ? 0 : desde + 1,
    fin: desde + elementos.length,
    elementos,
  };
}

/**
 * Números de página que se muestran como botones: la primera, la última y
 * una ventana de `alrededor` páginas a cada lado de la actual. Un hueco de
 * varias páginas se marca con null; un hueco de una sola página se muestra.
 *   ventanaDePaginas(20, 37) → [1, null, 18, 19, 20, 21, 22, null, 37]
 */
export function ventanaDePaginas(pagina, paginas, alrededor = 2) {
  const ancho = 2 * alrededor + 1;
  if (paginas <= ancho + 4) return Array.from({ length: paginas }, (_, i) => i + 1);
  let desde = Math.max(2, pagina - alrededor);
  let hasta = Math.min(paginas - 1, pagina + alrededor);
  // Cerca de los extremos la ventana se corre para mostrar siempre el mismo número de botones.
  if (hasta - desde + 1 < ancho) {
    if (desde === 2) hasta = Math.min(paginas - 1, desde + ancho - 1);
    else desde = Math.max(2, hasta - ancho + 1);
  }
  const salida = [1];
  if (desde === 3) salida.push(2);
  else if (desde > 3) salida.push(null);
  for (let n = desde; n <= hasta; n += 1) salida.push(n);
  if (hasta === paginas - 2) salida.push(paginas - 1);
  else if (hasta < paginas - 2) salida.push(null);
  salida.push(paginas);
  return salida;
}
