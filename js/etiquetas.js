/**
 * Etiquetas de anaquel: elección de plantilla, render y ajuste de textos.
 * Las medidas físicas viven en css/etiquetas.css (variables :root, en mm).
 */
import { svgUPCA } from './upca.js';
import { formatearPrecio, indicadorFiscal } from './precios.js';

export const PLANTILLA = Object.freeze({
  CON_CODIGO: 'conCodigo',
  SIN_CODIGO: 'sinCodigo',
});

/**
 * Plantilla A si se vende por pieza y tiene UPC; plantilla B en cualquier otro caso.
 * @param {object} producto documento de products/{id}
 */
export function plantillaPara(producto) {
  const tieneUPC = typeof producto.upc === 'string' && producto.upc.trim() !== '';
  return producto.unidadVenta === 'pieza' && tieneUPC ? PLANTILLA.CON_CODIGO : PLANTILLA.SIN_CODIGO;
}

const FACTOR_A_MM = Object.freeze({
  mm: 1,
  cm: 10,
  in: 25.4,
  px: 25.4 / 96,
  pt: 25.4 / 72,
  pc: 25.4 / 6,
});

/**
 * Lee una variable CSS de longitud y la devuelve en milímetros.
 * @param {string} propiedad p. ej. "--barcode-modulo"
 * @param {Element} [elemento]
 */
export function leerMedidaMM(propiedad, elemento = document.documentElement) {
  const crudo = getComputedStyle(elemento).getPropertyValue(propiedad).trim();
  const coincidencia = /^(-?\d*\.?\d+)\s*(mm|cm|in|px|pt|pc)?$/i.exec(crudo);
  if (!coincidencia) {
    throw new Error(`${propiedad} debe ser una longitud, p. ej. "0.33mm"; vale "${crudo}"`);
  }
  return Number(coincidencia[1]) * FACTOR_A_MM[(coincidencia[2] || 'mm').toLowerCase()];
}

/** Medidas del código de barras según las variables CSS actuales. */
export function medidasCodigoBarras() {
  return {
    modulo: leerMedidaMM('--barcode-modulo'),
    quietZone: leerMedidaMM('--quiet-zone'),
    altoBarras: leerMedidaMM('--barcode-alto'),
    tamanoDigitos: leerMedidaMM('--barcode-digitos'),
  };
}

function crear(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

function nodoPrecio(producto) {
  const precio = crear('div', 'etiqueta__precio ajustable');
  precio.append(crear('span', 'etiqueta__importe', formatearPrecio(producto.precioCentavos)));
  precio.append(crear('span', 'etiqueta__fiscal', indicadorFiscal(producto.claseFiscal)));
  return precio;
}

/**
 * Construye la etiqueta de un producto. Después de insertarla en el
 * documento hay que llamar a ajustarEtiqueta() para encoger los textos
 * que no quepan.
 * @param {object} producto documento de products/{id}
 * @returns {HTMLElement}
 */
export function renderEtiqueta(producto) {
  const plantilla = plantillaPara(producto);
  const etiqueta = crear(
    'article',
    `etiqueta ${plantilla === PLANTILLA.CON_CODIGO ? 'etiqueta--con-codigo' : 'etiqueta--sin-codigo'}`,
  );
  etiqueta.dataset.plantilla = plantilla;

  if (plantilla === PLANTILLA.CON_CODIGO) {
    // 1. marca  2. barra invertida con nombre  3. descriptor opcional
    etiqueta.append(crear('div', 'etiqueta__marca ajustable', producto.marca ?? ''));
    const barra = crear('div', 'etiqueta__barra');
    barra.append(crear('span', 'etiqueta__nombre ajustable', producto.nombre));
    etiqueta.append(barra);
    const descriptor = (producto.descriptor ?? '').trim();
    if (descriptor !== '') etiqueta.append(crear('div', 'etiqueta__descriptor ajustable', descriptor));

    // 4. cuerpo: código a la izquierda, presentación y precio a la derecha
    const cuerpo = crear('div', 'etiqueta__cuerpo');
    const codigo = crear('div', 'etiqueta__codigo');
    codigo.append(svgUPCA(producto.upc, medidasCodigoBarras()));
    const derecha = crear('div', 'etiqueta__derecha');
    derecha.append(crear('div', 'etiqueta__presentacion ajustable', producto.presentacion ?? ''));
    derecha.append(nodoPrecio(producto));
    cuerpo.append(codigo, derecha);
    etiqueta.append(cuerpo);
  } else {
    etiqueta.append(crear('div', 'etiqueta__nombre-grande', producto.nombre));
    etiqueta.append(nodoPrecio(producto));
  }

  // 5. regla negra bajo el precio
  etiqueta.append(crear('div', 'etiqueta__regla'));
  return etiqueta;
}

const ESCALA_MINIMA = 0.5;
const HOLGURA = 0.97; // margen de seguridad frente a diferencias de rasterizado al imprimir

function anchoInterior(elemento) {
  const estilo = getComputedStyle(elemento);
  return (
    elemento.getBoundingClientRect().width -
    parseFloat(estilo.paddingLeft) -
    parseFloat(estilo.paddingRight)
  );
}

function anchoTexto(elemento) {
  const rango = document.createRange();
  rango.selectNodeContents(elemento);
  return rango.getBoundingClientRect().width;
}

/**
 * Reduce el tamaño de fuente de un texto de una sola línea hasta que quepa
 * en su contenedor (hasta la mitad del tamaño original).
 * @returns {number} escala aplicada (1 = sin cambios)
 */
export function ajustarAlAncho(elemento, contenedor = elemento.parentElement) {
  elemento.style.fontSize = '';
  const disponible = anchoInterior(contenedor) * HOLGURA;
  if (!(disponible > 0)) return 1;
  const base = parseFloat(getComputedStyle(elemento).fontSize);
  let escala = 1;
  for (let intento = 0; intento < 6; intento += 1) {
    const ancho = anchoTexto(elemento);
    if (ancho <= disponible) break;
    escala = Math.max(ESCALA_MINIMA, escala * (disponible / ancho));
    elemento.style.fontSize = `${(base * escala).toFixed(3)}px`;
    if (escala === ESCALA_MINIMA) break;
  }
  return escala;
}

/** Ajusta todos los textos marcados como .ajustable dentro de una etiqueta. */
export function ajustarEtiqueta(etiqueta) {
  etiqueta.querySelectorAll('.ajustable').forEach((elemento) => ajustarAlAncho(elemento));
}
