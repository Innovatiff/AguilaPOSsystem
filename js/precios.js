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
