/**
 * Gráficas del back office en SVG, sin librerías:
 *  - columnas de una sola serie (ventas por hora, por día);
 *  - barra segmentada fina (partes de un total, p. ej. formas de pago).
 *
 * Especificación de las marcas: columnas de 24 px como máximo con el extremo
 * de datos redondeado (4 px) y la base recta; cuadrícula de línea fina y
 * sólida; textos con colores de texto (nunca el de la serie); un solo valor
 * rotulado (el máximo); tooltip al pasar el puntero y con el foco del teclado
 * sobre toda la franja de cada columna. Cada gráfica tiene su tabla
 * equivalente en la página (los valores nunca dependen del tooltip).
 */
import { h, s } from './dom.js';
import { t } from './idioma.js';

/** Porcentaje entero para mostrar: "13 %" en español, "13%" en inglés. */
const porcentaje = (n) => t('{n} %', { n });

/** Escala de números redondos: tope y paso para unas 4 divisiones. */
export function escalaBonita(maximo, divisiones = 4) {
  if (!(maximo > 0)) return { tope: divisiones, paso: 1 };
  const bruto = maximo / divisiones;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto - 1e-9);
  return { tope: paso * Math.ceil(maximo / paso - 1e-9), paso };
}

/** Dólares para el eje: $0 · $250 · $1,500 · $12K. */
export function dolaresEje(dolares) {
  if (dolares >= 10000) return `$${Math.round(dolares / 1000).toLocaleString('en-CA')}K`;
  return `$${dolares.toLocaleString('en-CA', { maximumFractionDigits: 2 })}`;
}

/** Trayecto de una columna con las esquinas de arriba redondeadas y la base recta. */
function trayectoColumna(x, y, ancho, alto, radio = 4) {
  const r = Math.min(radio, alto, ancho / 2);
  return `M${x},${y + alto}V${y + r}Q${x},${y} ${x + r},${y}H${x + ancho - r}Q${x + ancho},${y} ${x + ancho},${y + r}V${y + alto}Z`;
}

/**
 * Columnas de una serie.
 * @param {HTMLElement} contenedor
 * @param {{ descripcion: string, alto?: number, formatoValor: (centavos: number) => string }} opciones
 * @returns {{ actualizar: (datos: Array<{ etiqueta: string, valor: number, detalle?: string }>) => void }}
 *   `valor` en centavos (entero ≥ 0).
 */
export function graficaColumnas(contenedor, { descripcion, alto = 230, formatoValor }) {
  contenedor.classList.add('grafica');
  const lienzo = h('div', { class: 'grafica__lienzo' });
  const tooltip = h('div', { class: 'grafica__tooltip', role: 'status', hidden: true });
  contenedor.replaceChildren(lienzo, tooltip);
  let datos = [];
  let ancho = 0;

  function mostrarTooltip(dato, x, y) {
    tooltip.replaceChildren(
      h('strong', { text: formatoValor(dato.valor) }),
      h('span', { text: dato.etiqueta }),
      dato.detalle ? h('span', { class: 'grafica__tooltip-detalle', text: dato.detalle }) : null,
    );
    tooltip.hidden = false;
    const caja = tooltip.getBoundingClientRect();
    const izquierda = Math.min(Math.max(0, x - caja.width / 2), Math.max(0, ancho - caja.width));
    tooltip.style.left = `${izquierda}px`;
    tooltip.style.top = `${Math.max(0, y - caja.height - 10)}px`;
  }

  function dibujar() {
    ancho = Math.floor(contenedor.clientWidth);
    if (ancho <= 0) return;
    const maximo = Math.max(0, ...datos.map((d) => d.valor));
    const { tope, paso } = escalaBonita(maximo / 100);
    const marcas = [];
    for (let v = 0; v <= tope + 1e-9; v += paso) marcas.push(v);
    const etiquetasEje = marcas.map(dolaresEje);
    const izquierda = Math.max(...etiquetasEje.map((etiqueta) => etiqueta.length)) * 7 + 12;
    const arriba = 18;
    const abajo = 24;
    const derecha = 6;
    const anchoPlano = Math.max(10, ancho - izquierda - derecha);
    const altoPlano = alto - arriba - abajo;
    const yDe = (dolares) => arriba + altoPlano - (dolares / tope) * altoPlano;
    const franja = datos.length ? anchoPlano / datos.length : anchoPlano;
    const anchoColumna = Math.max(4, Math.min(24, franja * 0.6));
    const cadaCuanto = Math.max(1, Math.ceil(30 / franja));

    const svg = s('svg', { width: ancho, height: alto, viewBox: `0 0 ${ancho} ${alto}`, role: 'group', 'aria-label': descripcion });
    const rejilla = s('g', { class: 'grafica__rejilla' });
    marcas.forEach((v, i) => {
      const y = Math.round(yDe(v)) + 0.5;
      rejilla.append(
        s('line', { x1: izquierda, x2: ancho - derecha, y1: y, y2: y, class: i === 0 ? 'grafica__base' : 'grafica__linea' }),
        s('text', { x: izquierda - 8, y: y + 4, 'text-anchor': 'end', class: 'grafica__eje' }, etiquetasEje[i]),
      );
    });
    svg.append(rejilla);

    const indiceMaximo = maximo > 0 ? datos.findIndex((d) => d.valor === maximo) : -1;
    datos.forEach((dato, i) => {
      const centro = izquierda + franja * (i + 0.5);
      const grupo = s('g', {
        class: 'grafica__columna',
        tabindex: 0,
        role: 'img',
        'aria-label': `${dato.etiqueta}: ${formatoValor(dato.valor)}${dato.detalle ? `, ${dato.detalle}` : ''}`,
      });
      grupo.append(s('rect', { x: izquierda + franja * i, y: arriba, width: franja, height: altoPlano, class: 'grafica__zona' }));
      if (dato.valor > 0) {
        const y = yDe(dato.valor / 100);
        const altoBarra = arriba + altoPlano - y;
        grupo.append(s('path', { d: trayectoColumna(centro - anchoColumna / 2, y, anchoColumna, Math.max(1, altoBarra)), class: 'grafica__barra' }));
        if (i === indiceMaximo) grupo.append(s('text', { x: centro, y: y - 6, 'text-anchor': 'middle', class: 'grafica__valor' }, formatoValor(dato.valor)));
      }
      if (i % cadaCuanto === 0) grupo.append(s('text', { x: centro, y: alto - 6, 'text-anchor': 'middle', class: 'grafica__eje' }, dato.etiqueta));
      const alPasar = () => {
        grupo.classList.add('grafica__columna--activa');
        mostrarTooltip(dato, centro, dato.valor > 0 ? yDe(dato.valor / 100) : arriba + altoPlano);
      };
      const alSalir = () => {
        grupo.classList.remove('grafica__columna--activa');
        tooltip.hidden = true;
      };
      grupo.addEventListener('pointerenter', alPasar);
      grupo.addEventListener('pointerleave', alSalir);
      grupo.addEventListener('focus', alPasar);
      grupo.addEventListener('blur', alSalir);
      svg.append(grupo);
    });
    lienzo.replaceChildren(svg);
  }

  if (typeof ResizeObserver !== 'undefined') {
    let anterior = 0;
    new ResizeObserver(() => {
      const actual = Math.floor(contenedor.clientWidth);
      if (actual !== anterior) {
        anterior = actual;
        dibujar();
      }
    }).observe(contenedor);
  }

  return {
    actualizar(nuevos) {
      datos = nuevos;
      dibujar();
    },
  };
}

/**
 * Barra segmentada fina (8 px, extremos redondos, sin texto): las partes de un
 * total. Los nombres y montos van en la lista de al lado, con su muestra de color.
 * @param {Array<{ nombre: string, valor: number, color: string, texto?: string }>} partes
 */
export function barraSegmentada(partes, descripcion) {
  const total = partes.reduce((acc, p) => acc + Math.max(0, p.valor), 0);
  const barra = h('div', { class: 'segmentos', role: 'img' });
  const nombre = partes.filter((p) => p.valor > 0).map((p) => `${p.nombre} ${p.texto ?? ''} (${porcentaje(Math.round((p.valor / total) * 100))})`).join(', ');
  barra.setAttribute('aria-label', total > 0 ? `${descripcion}: ${nombre}` : t('{descripcion}: sin datos', { descripcion }));
  if (total <= 0) {
    barra.classList.add('segmentos--vacia');
    return barra;
  }
  for (const p of partes) {
    if (p.valor <= 0) continue;
    const parte = h('span', { class: 'segmentos__parte', title: `${p.nombre}: ${p.texto ?? ''} (${porcentaje(Math.round((p.valor / total) * 100))})` });
    parte.style.flexGrow = String(p.valor);
    parte.style.background = p.color;
    barra.append(parte);
  }
  return barra;
}
