/**
 * Code 128, subconjunto C (pares de dígitos), para el código del recibo.
 * Con 12 dígitos son 6 símbolos: 101 módulos, ~38 mm a 0.375 mm por módulo,
 * cómodo en un rollo de 80 mm y legible por cualquier escáner de caja.
 * Módulo puro: produce la secuencia de módulos y un SVG.
 */

/** Anchos (barra, espacio, barra, espacio, barra, espacio) de los valores 0–106. */
const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const INICIO_C = 105;
const PARADA = 106;
export const ZONA_SILENCIO_MODULOS = 10;

/** Valores de símbolo (inicio, datos, verificador, parada) para una cadena de dígitos de longitud par. */
export function simbolosCode128C(digitos) {
  const texto = String(digitos ?? '');
  if (!/^(?:[0-9]{2})+$/.test(texto)) throw new Error('Code 128 C necesita un número par de dígitos.');
  const datos = [];
  for (let i = 0; i < texto.length; i += 2) datos.push(Number.parseInt(texto.slice(i, i + 2), 10));
  const suma = datos.reduce((acc, valor, i) => acc + valor * (i + 1), INICIO_C);
  return [INICIO_C, ...datos, suma % 103, PARADA];
}

/** Secuencia de módulos ("1" barra, "0" espacio), sin zonas de silencio. */
export function modulosCode128C(digitos) {
  let salida = '';
  for (const valor of simbolosCode128C(digitos)) {
    const anchos = PATRONES[valor];
    for (let i = 0; i < anchos.length; i += 1) salida += (i % 2 === 0 ? '1' : '0').repeat(Number(anchos[i]));
  }
  return salida;
}

/**
 * SVG del código (sin texto; el recibo pone el folio debajo).
 * @param {string} digitos
 * @param {{ moduloMM?: number, altoMM?: number }} [medidas]
 */
export function svgCode128C(digitos, { moduloMM = 0.375, altoMM = 10 } = {}) {
  const modulos = modulosCode128C(digitos);
  const total = modulos.length + 2 * ZONA_SILENCIO_MODULOS;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('xmlns', ns);
  svg.setAttribute('viewBox', `0 0 ${total} 10`);
  svg.setAttribute('width', `${(total * moduloMM).toFixed(3)}mm`);
  svg.setAttribute('height', `${altoMM}mm`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', 'codigo-recibo');
  svg.setAttribute('data-digitos', String(digitos));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Código ${digitos}`);
  let x = ZONA_SILENCIO_MODULOS;
  let d = '';
  for (let i = 0; i < modulos.length; ) {
    if (modulos[i] === '1') {
      let ancho = 0;
      while (modulos[i + ancho] === '1') ancho += 1;
      d += `M${x + i} 0h${ancho}v10h-${ancho}z`;
      i += ancho;
    } else {
      i += 1;
    }
  }
  const camino = document.createElementNS(ns, 'path');
  camino.setAttribute('d', d);
  camino.setAttribute('fill', '#000');
  svg.append(camino);
  return svg;
}
