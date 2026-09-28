/**
 * Códigos de barras de producto (GTIN) → SVG en línea con medidas físicas en mm.
 *
 * Símbolos admitidos, ambos de 95 módulos (ocupan lo mismo en la etiqueta):
 *   UPC-A  · 12 dígitos · guarda 101 · 6 dígitos en L · guarda central 01010 ·
 *            6 dígitos en R · guarda 101.
 *   EAN-13 · 13 dígitos · igual, salvo que el primer dígito no se codifica en
 *            barras: fija la paridad (L o G) de los seis dígitos de la izquierda.
 * Un EAN-13 que empieza por 0 es la forma de 13 dígitos de un UPC-A: se
 * normaliza a sus 12 dígitos. Un UPC-E (8 dígitos que empiezan por 0 o 1, la
 * forma comprimida de un UPC-A) se expande a sus 12 dígitos. Los EAN-8 no se
 * admiten.
 *
 * Sin dependencias. Sigue las GS1 General Specifications: las guardas bajan
 * 5 módulos más que las barras de los dígitos y los dígitos legibles van
 * debajo, el primero a la izquierda del símbolo.
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

/** Patrones G (paridad par): los R leídos al revés. Solo los usa el EAN-13. */
const CODIGOS_G = Object.freeze(CODIGOS_R.map((patron) => [...patron].reverse().join('')));

/** EAN-13: paridad de los seis dígitos de la izquierda según el primer dígito. */
const PARIDAD_EAN13 = Object.freeze([
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]);

const GUARDA_LATERAL = '101';
const GUARDA_CENTRAL = '01010';

export const MODULOS_CODIGO = 95;
/** @deprecated Mismo valor que MODULOS_CODIGO; se conserva por compatibilidad. */
export const MODULOS_UPCA = MODULOS_CODIGO;
export const QUIET_ZONE_MINIMA_MODULOS = 9;
const EXTENSION_GUARDAS_MODULOS = 5;

export const TIPO_CODIGO = Object.freeze({ UPCA: 'UPC-A', EAN13: 'EAN-13' });

/** Módulos ocupados por guardas (inicio 0-2, centro 45-49, fin 92-94). */
function esGuarda(indice) {
  return indice < 3 || (indice >= 45 && indice < 50) || indice >= 92;
}

/**
 * Dígito verificador GTIN (módulo 10, pesos 3 y 1 desde la derecha) del
 * cuerpo de un código: 11 dígitos para UPC-A, 12 para EAN-13.
 * @param {string} cuerpo
 * @returns {number}
 */
export function digitoVerificadorGTIN(cuerpo) {
  if (!/^\d{11,12}$/.test(cuerpo)) {
    throw new Error('Se necesitan 11 dígitos (UPC-A) o 12 (EAN-13) para calcular el verificador');
  }
  const n = cuerpo.length;
  let suma = 0;
  for (let i = 0; i < n; i += 1) {
    const digito = cuerpo.charCodeAt(i) - 48;
    suma += (n - 1 - i) % 2 === 0 ? digito * 3 : digito;
  }
  return (10 - (suma % 10)) % 10;
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
  return digitoVerificadorGTIN(once);
}

/**
 * Valida y normaliza un código de producto a su forma canónica:
 * 12 dígitos si es UPC-A (también un EAN-13 que empiece por 0), 13 si es EAN-13.
 * No completa códigos de 11 dígitos: un dígito perdido al teclear no debe
 * convertirse en silencio en otro código válido.
 * @param {unknown} entrada
 * @returns {string} 12 o 13 dígitos
 */
export function normalizarUPC(entrada) {
  const texto = String(entrada ?? '').replace(/\s+/g, '');
  if (texto === '') throw new Error('El UPC está vacío');
  if (!/^\d+$/.test(texto)) throw new Error(`El UPC "${texto}" contiene caracteres que no son dígitos`);

  let digitos = texto;
  if (digitos.length === 13 && digitos[0] === '0') digitos = digitos.slice(1); // forma EAN-13 de un UPC-A
  if (digitos.length === 8) {
    if (digitos[0] !== '0' && digitos[0] !== '1') {
      throw new Error(`"${texto}" es un EAN-8, que todavía no se admite`);
    }
    digitos = expandirUPCE(digitos); // UPC-E: forma comprimida de un UPC-A
  }
  if (digitos.length !== 12 && digitos.length !== 13) {
    throw new Error(`El código debe tener 12 dígitos (UPC-A) o 13 (EAN-13); "${texto}" tiene ${texto.length}`);
  }
  const esperado = digitoVerificadorGTIN(digitos.slice(0, -1));
  if (esperado !== digitos.charCodeAt(digitos.length - 1) - 48) {
    throw new Error(`Dígito verificador incorrecto en "${texto}" (debería terminar en ${esperado})`);
  }
  return digitos;
}

/**
 * Expande un UPC-E (8 dígitos: sistema 0 o 1, seis de datos y verificador)
 * al UPC-A de 12 dígitos que comprime. El verificador se conserva y se
 * comprueba después sobre el código expandido.
 * @param {string} ocho
 * @returns {string} 12 dígitos
 */
export function expandirUPCE(ocho) {
  if (!/^[01]\d{7}$/.test(ocho)) throw new Error(`"${ocho}" no es un UPC-E (8 dígitos que empiezan por 0 o 1)`);
  const sistema = ocho[0];
  const d = ocho.slice(1, 7);
  const verificador = ocho[7];
  const ultimo = d[5];
  let cuerpo;
  if (ultimo === '0' || ultimo === '1' || ultimo === '2') cuerpo = `${d.slice(0, 2)}${ultimo}0000${d.slice(2, 5)}`;
  else if (ultimo === '3') cuerpo = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (ultimo === '4') cuerpo = `${d.slice(0, 4)}00000${d[4]}`;
  else cuerpo = `${d.slice(0, 5)}0000${ultimo}`;
  return `${sistema}${cuerpo}${verificador}`;
}

/** Alias con nombre neutro: el campo se sigue llamando upc, pero admite EAN-13 y UPC-E. */
export const normalizarCodigo = normalizarUPC;

/** 'UPC-A' o 'EAN-13' según la forma canónica del código. */
export function tipoDeCodigo(codigo) {
  return normalizarUPC(codigo).length === 13 ? TIPO_CODIGO.EAN13 : TIPO_CODIGO.UPCA;
}

/**
 * Secuencia de 95 módulos ('1' barra, '0' espacio) de un UPC-A.
 * @param {string} upc 12 dígitos (o 13 con cero inicial)
 */
export function modulosUPCA(upc) {
  const digitos = normalizarUPC(upc);
  if (digitos.length !== 12) throw new Error(`"${upc}" es un EAN-13; usa modulosEAN13 o modulosGTIN`);
  let bits = GUARDA_LATERAL;
  for (let i = 0; i < 6; i += 1) bits += CODIGOS_L[digitos.charCodeAt(i) - 48];
  bits += GUARDA_CENTRAL;
  for (let i = 6; i < 12; i += 1) bits += CODIGOS_R[digitos.charCodeAt(i) - 48];
  bits += GUARDA_LATERAL;
  return bits;
}

/**
 * Secuencia de 95 módulos de un EAN-13: el primer dígito decide la paridad
 * (L o G) de los dígitos 2 a 7; los dígitos 8 a 13 van en R.
 * @param {string} ean 13 dígitos que no empiezan por 0
 */
export function modulosEAN13(ean) {
  const digitos = normalizarUPC(ean);
  if (digitos.length !== 13) throw new Error(`"${ean}" es un UPC-A; usa modulosUPCA o modulosGTIN`);
  const paridad = PARIDAD_EAN13[digitos.charCodeAt(0) - 48];
  let bits = GUARDA_LATERAL;
  for (let i = 1; i <= 6; i += 1) {
    const tabla = paridad[i - 1] === 'L' ? CODIGOS_L : CODIGOS_G;
    bits += tabla[digitos.charCodeAt(i) - 48];
  }
  bits += GUARDA_CENTRAL;
  for (let i = 7; i < 13; i += 1) bits += CODIGOS_R[digitos.charCodeAt(i) - 48];
  bits += GUARDA_LATERAL;
  return bits;
}

/** Módulos de cualquiera de los dos símbolos, según el código. */
export function modulosGTIN(codigo) {
  const digitos = normalizarUPC(codigo);
  return digitos.length === 13 ? modulosEAN13(digitos) : modulosUPCA(digitos);
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
 * Genera el código de barras (UPC-A o EAN-13) como elemento <svg> con
 * unidades físicas (mm).
 *
 * @param {string} codigo  12 dígitos (UPC-A) o 13 (EAN-13)
 * @param {object} medidas  todas en milímetros
 * @param {number} medidas.modulo        ancho del módulo X (0.33 = 100 %)
 * @param {number} medidas.quietZone     zona silenciosa a cada lado (≥ 9 módulos)
 * @param {number} medidas.altoBarras    alto de las barras de los dígitos
 * @param {number} medidas.tamanoDigitos tamaño de fuente de los dígitos legibles
 * @param {string} [medidas.fuenteDigitos]
 * @returns {SVGSVGElement}
 */
export function svgCodigoBarras(codigo, medidas) {
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

  const digitos = normalizarUPC(codigo);
  const tipo = digitos.length === 13 ? TIPO_CODIGO.EAN13 : TIPO_CODIGO.UPCA;
  const bits = modulosGTIN(digitos);
  const X = modulo;
  const extensionGuardas = EXTENSION_GUARDAS_MODULOS * X;
  const lineaBase = altoBarras + extensionGuardas; // los dígitos apoyan donde acaban las guardas
  const ancho = MODULOS_CODIGO * X + 2 * quietZone;
  const alto = lineaBase + tamanoDigitos * 0.15;

  const svg = elementoSVG('svg', {
    xmlns: SVG_NS,
    width: `${redondear(ancho)}mm`,
    height: `${redondear(alto)}mm`,
    viewBox: `0 0 ${redondear(ancho)} ${redondear(alto)}`,
    role: 'img',
    'aria-label': `${tipo} ${digitos}`,
    class: `codigo-barras ${tipo === TIPO_CODIGO.EAN13 ? 'ean13' : 'upca'}`,
    'data-upc': digitos,
    'data-tipo': tipo,
  });

  // Fondo blanco explícito: el código necesita blanco real detrás.
  svg.append(elementoSVG('rect', { x: 0, y: 0, width: redondear(ancho), height: redondear(alto), fill: '#fff' }));

  // Barras: se agrupan los módulos '1' consecutivos del mismo tipo en un solo rect.
  let i = 0;
  while (i < MODULOS_CODIGO) {
    if (bits[i] !== '1') {
      i += 1;
      continue;
    }
    const guarda = esGuarda(i);
    let j = i;
    while (j < MODULOS_CODIGO && bits[j] === '1' && esGuarda(j) === guarda) j += 1;
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
  if (tipo === TIPO_CODIGO.UPCA) {
    // Primero y último fuera del símbolo; cinco bajo cada mitad de 42 módulos.
    const celda = (42 * X) / 5;
    digito(digitos[0], quietZone - 4 * X);
    for (let k = 0; k < 5; k += 1) digito(digitos[1 + k], quietZone + 3 * X + (k + 0.5) * celda);
    for (let k = 0; k < 5; k += 1) digito(digitos[6 + k], quietZone + 50 * X + (k + 0.5) * celda);
    digito(digitos[11], quietZone + MODULOS_CODIGO * X + 4 * X);
  } else {
    // El primero fuera, a la izquierda; seis bajo cada mitad.
    const celda = (42 * X) / 6;
    digito(digitos[0], quietZone - 4 * X);
    for (let k = 0; k < 6; k += 1) digito(digitos[1 + k], quietZone + 3 * X + (k + 0.5) * celda);
    for (let k = 0; k < 6; k += 1) digito(digitos[7 + k], quietZone + 50 * X + (k + 0.5) * celda);
  }

  return svg;
}

/** @deprecated Nombre anterior; genera también EAN-13. */
export const svgUPCA = svgCodigoBarras;
