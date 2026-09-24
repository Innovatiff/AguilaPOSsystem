/**
 * Precios en CENTAVOS enteros. Nunca flotantes.
 */

/**
 * Formatea centavos como "$4.99" (siempre dos decimales, miles con coma).
 * @param {number} centavos entero ≥ 0
 * @returns {string}
 */
export function formatearPrecio(centavos) {
  if (!Number.isInteger(centavos) || centavos < 0) {
    throw new TypeError(`precioCentavos debe ser un entero ≥ 0; se recibió ${String(centavos)}`);
  }
  const dolares = Math.floor(centavos / 100);
  const resto = centavos % 100;
  const enteros = String(dolares).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${enteros}.${String(resto).padStart(2, '0')}`;
}

/**
 * Convierte lo que teclea el personal ("4.99", "4,99", "$5", "5.", "1,234.56")
 * en centavos enteros, sin pasar por flotantes. Lanza si no es un precio.
 * @param {string} texto
 * @returns {number}
 */
export function centavosDesdeTexto(texto) {
  let limpio = String(texto ?? '').trim().replace(/^\$/, '').replace(/\s+/g, '');
  if (limpio.includes(',') && limpio.includes('.')) limpio = limpio.replace(/,/g, ''); // coma de miles
  else limpio = limpio.replace(',', '.'); // coma decimal
  const coincidencia = /^(\d+)(?:\.(\d{0,2}))?$/.exec(limpio);
  if (!coincidencia) throw new Error('Precio no válido; escribe por ejemplo 4.99');
  const enteros = Number.parseInt(coincidencia[1], 10);
  const decimales = Number.parseInt((coincidencia[2] ?? '').padEnd(2, '0'), 10);
  return enteros * 100 + decimales;
}

/** Centavos → texto para un campo de captura: 499 → "4.99" (sin signo). */
export function textoDesdeCentavos(centavos) {
  if (!Number.isInteger(centavos) || centavos < 0) return '';
  return `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
}

/** Indicador impreso en la etiqueta según la clase fiscal. Siempre con esta grafía. */
export const INDICADOR_FISCAL = Object.freeze({
  gravado: '+Tx',
  tasaCero: 'c',
});

/**
 * @param {"gravado"|"tasaCero"} claseFiscal
 * @returns {string}
 */
export function indicadorFiscal(claseFiscal) {
  const indicador = INDICADOR_FISCAL[claseFiscal];
  if (indicador === undefined) {
    throw new Error(`claseFiscal desconocida: "${String(claseFiscal)}" (debe ser "gravado" o "tasaCero")`);
  }
  return indicador;
}
