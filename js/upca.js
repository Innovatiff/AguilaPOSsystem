/**
 * UPC-A → SVG en línea con medidas físicas en milímetros.
 *
 * Sin dependencias. Sigue las GS1 General Specifications:
 *   guarda 101 · 6 dígitos en codificación L · guarda central 01010 ·
 *   6 dígitos en codificación R · guarda 101  =  95 módulos.
 * Las guardas bajan 5 módulos más que las barras de los dígitos y los
 * dígitos legibles van debajo: el primero a la izquierda del símbolo,
 * cinco bajo cada mitad y el verificador a la derecha.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Patrones L (paridad impar): empiezan en espacio, terminan en barra. */
const CODIGOS_L = Object.freeze([
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]);

/** Patrones R: complemento bit a bit de los L. */
const CODIGOS_R = Object.freeze(
  CODIGOS_L.map((patron) => patron.replace(/[01]/g, (bit) => (bit === '1' ? '0' : '1'))),
);

const GUARDA_LATERAL = '101';
const GUARDA_CENTRAL = '01010';

export const MODULOS_UPCA = 95;
export const QUIET_ZONE_MINIMA_MODULOS = 9;
const EXTENSION_GUARDAS_MODULOS = 5;

/** Módulos ocupados por guardas (inicio 0-2, centro 45-49, fin 92-94). */
function esGuarda(indice) {
  return indice < 3 || (indice >= 45 && indice < 50) || indice >= 92;
}

/**
 * Dígito verificador de un UPC-A a partir de sus 11 primeros dígitos.
 * @param {string} once
 * @returns {number}
 */
export function digitoVerificadorUPCA(once) {
  if (!/^\d{11}$/.test(once)) {
    throw new Error('Se necesitan exactamente 11 dígitos para calcular el verificador');
  }
  let suma = 0;
  for (let i = 0; i < 11; i += 1) {
    const digito = once.charCodeAt(i) - 48;
    suma += i % 2 === 0 ? digito * 3 : digito;
  }
  return (10 - (suma % 10)) % 10;
}

/**
 * Valida y normaliza un UPC-A a sus 12 dígitos.
 * Acepta 12 dígitos, o 13 con cero inicial (forma EAN-13 de un UPC-A).
 * No completa códigos de 11 dígitos: un dígito perdido al teclear no debe
 * convertirse en silencio en otro código válido.
 * @param {unknown} entrada
 * @returns {string} 12 dígitos
 */
export function normalizarUPC(entrada) {
  const texto = String(entrada ?? '').replace(/\s+/g, '');
  if (texto === '') throw new Error('El UPC está vacío');
  if (!/^\d+$/.test(texto)) throw new Error(`El UPC "${texto}" contiene caracteres que no son dígitos`);

  let digitos = texto;
  if (digitos.length === 13) {
    if (digitos[0] !== '0') {
      throw new Error(`"${texto}" es un EAN-13, no un UPC-A (todavía no se imprime)`);
    }
    digitos = digitos.slice(1);
  }
  if (digitos.length !== 12) {
    throw new Error(`El UPC-A debe tener 12 dígitos; "${texto}" tiene ${texto.length}`);
  }
  const esperado = digitoVerificadorUPCA(digitos.slice(0, 11));
  if (esperado !== digitos.charCodeAt(11) - 48) {
    throw new Error(`Dígito verificador incorrecto en "${texto}" (debería terminar en ${esperado})`);
  }
  return digitos;
}

/**
 * Secuencia de 95 módulos ('1' barra, '0' espacio) de un UPC-A.
 * @param {string} upc
 * @returns {string}
 */
export function modulosUPCA(upc) {
  const digitos = normalizarUPC(upc);
  let bits = GUARDA_LATERAL;
  for (let i = 0; i < 6; i += 1) bits += CODIGOS_L[digitos.charCodeAt(i) - 48];
  bits += GUARDA_CENTRAL;
  for (let i = 6; i < 12; i += 1) bits += CODIGOS_R[digitos.charCodeAt(i) - 48];
  bits += GUARDA_LATERAL;
  return bits;
}

const redondear = (valor) => Math.round(valor * 1000) / 1000;

function elementoSVG(nombre, atributos) {
  const elemento = document.createElementNS(SVG_NS, nombre);
  for (const [clave, valor] of Object.entries(atributos)) {
    elemento.setAttribute(clave, String(valor));
  }
  return elemento;
}

/**
 * Genera el UPC-A como elemento <svg> con unidades físicas (mm).
 *
 * @param {string} upc  12 dígitos (o 13 con cero inicial)
 * @param {object} medidas  todas en milímetros
 * @param {number} medidas.modulo        ancho del módulo X (0.33 = 100 %)
 * @param {number} medidas.quietZone     zona silenciosa a cada lado (≥ 9 módulos)
 * @param {number} medidas.altoBarras    alto de las barras de los dígitos
 * @param {number} medidas.tamanoDigitos tamaño de fuente de los dígitos legibles
 * @param {string} [medidas.fuenteDigitos]
 * @returns {SVGSVGElement}
 */
export function svgUPCA(upc, medidas) {
  const {
    modulo,
    quietZone,
    altoBarras,
    tamanoDigitos,
    fuenteDigitos = 'Arial, Helvetica, sans-serif',
  } = medidas;

  for (const [nombre, valor] of Object.entries({ modulo, quietZone, altoBarras, tamanoDigitos })) {
    if (!(Number.isFinite(valor) && valor > 0)) {
      throw new Error(`Medida inválida para el código de barras: ${nombre} = ${String(valor)}`);
    }
  }
  if (quietZone < QUIET_ZONE_MINIMA_MODULOS * modulo) {
    console.warn(
      `Zona silenciosa de ${quietZone} mm menor que ${QUIET_ZONE_MINIMA_MODULOS} módulos ` +
        `(${redondear(QUIET_ZONE_MINIMA_MODULOS * modulo)} mm): puede fallar la lectura`,
    );
  }

  const codigo = normalizarUPC(upc);
  const bits = modulosUPCA(codigo);
  const X = modulo;
  const extensionGuardas = EXTENSION_GUARDAS_MODULOS * X;
  const lineaBase = altoBarras + extensionGuardas; // los dígitos apoyan donde acaban las guardas
  const ancho = MODULOS_UPCA * X + 2 * quietZone;
  const alto = lineaBase + tamanoDigitos * 0.15;

  const svg = elementoSVG('svg', {
    xmlns: SVG_NS,
    width: `${redondear(ancho)}mm`,
    height: `${redondear(alto)}mm`,
    viewBox: `0 0 ${redondear(ancho)} ${redondear(alto)}`,
    role: 'img',
    'aria-label': `UPC ${codigo}`,
    class: 'upca',
    'data-upc': codigo,
  });

  // Fondo blanco explícito: el código necesita blanco real detrás.
  svg.append(elementoSVG('rect', { x: 0, y: 0, width: redondear(ancho), height: redondear(alto), fill: '#fff' }));

  // Barras: se agrupan los módulos '1' consecutivos del mismo tipo en un solo rect.
  let i = 0;
  while (i < MODULOS_UPCA) {
    if (bits[i] !== '1') {
      i += 1;
      continue;
    }
    const guarda = esGuarda(i);
    let j = i;
    while (j < MODULOS_UPCA && bits[j] === '1' && esGuarda(j) === guarda) j += 1;
    svg.append(
      elementoSVG('rect', {
        x: redondear(quietZone + i * X),
        y: 0,
        width: redondear((j - i) * X),
        height: redondear(guarda ? lineaBase : altoBarras),
        fill: '#000',
      }),
    );
    i = j;
  }

  // Dígitos legibles.
  const digito = (caracter, x) => {
    const texto = elementoSVG('text', {
      x: redondear(x),
      y: redondear(lineaBase),
      'text-anchor': 'middle',
      'font-family': fuenteDigitos,
      'font-size': redondear(tamanoDigitos),
      fill: '#000',
    });
    texto.textContent = caracter;
    svg.append(texto);
  };
  const celda = (42 * X) / 5; // cada mitad tiene 42 módulos para 5 dígitos
  digito(codigo[0], quietZone - 4 * X);
  for (let k = 0; k < 5; k += 1) digito(codigo[1 + k], quietZone + 3 * X + (k + 0.5) * celda);
  for (let k = 0; k < 5; k += 1) digito(codigo[6 + k], quietZone + 50 * X + (k + 0.5) * celda);
  digito(codigo[11], quietZone + MODULOS_UPCA * X + 4 * X);

  return svg;
}
