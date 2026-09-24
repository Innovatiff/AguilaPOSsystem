/**
 * Paso 1 · Página de prueba: las dos plantillas a tamaño real con datos reales.
 * Sin Firebase, sin autenticación, sin navegación.
 */
import { renderEtiqueta, ajustarEtiqueta, plantillaPara, leerMedidaMM } from './etiquetas.js';

// Solo campos del esquema products/{id}; los que la etiqueta no usa se omiten.
const MUESTRAS = [
  {
    id: 'muestra-tajin-clasico-142g',
    producto: {
      upc: '633148100013',
      plu: null,
      nombre: 'CLASICO',
      marca: 'TAJIN',
      descriptor: null,
      presentacion: '142g',
      precioCentavos: 499,
      unidadVenta: 'pieza',
      precioPorKgCentavos: null,
      claseFiscal: 'gravado',
      activo: true,
    },
  },
  {
    id: 'muestra-chile-guajillo',
    producto: {
      upc: null,
      plu: null,
      nombre: 'CHILE GUAJILLO',
      marca: null,
      descriptor: null,
      presentacion: '',
      precioCentavos: 500,
      unidadVenta: 'pieza',
      precioPorKgCentavos: null,
      claseFiscal: 'tasaCero',
      activo: true,
    },
  },
];

const TITULO_PLANTILLA = {
  conCodigo: 'Plantilla A · conCodigo (pieza con UPC)',
  sinCodigo: 'Plantilla B · sinCodigo (peso o sin UPC)',
};

function pintarMuestras() {
  const contenedor = document.getElementById('muestras');
  contenedor.replaceChildren();
  for (const { id, producto } of MUESTRAS) {
    const figura = document.createElement('figure');
    figura.className = 'muestra';
    figura.dataset.id = id;

    const pie = document.createElement('figcaption');
    pie.className = 'no-imprimir';
    pie.textContent = TITULO_PLANTILLA[plantillaPara(producto)];
    figura.append(pie);

    try {
      figura.append(renderEtiqueta(producto));
    } catch (error) {
      const aviso = document.createElement('p');
      aviso.className = 'error';
      aviso.textContent = `No se pudo generar la etiqueta: ${error.message}`;
      figura.append(aviso);
    }
    contenedor.append(figura);
  }
}

function ajustarTodas() {
  document.querySelectorAll('.etiqueta').forEach(ajustarEtiqueta);
}

function mostrarMedidas() {
  const mm = (propiedad) => leerMedidaMM(propiedad).toLocaleString('es-MX', { maximumFractionDigits: 3 });
  const util = (propiedad) =>
    (leerMedidaMM(propiedad) - 2 * leerMedidaMM('--borde-impresora')).toLocaleString('es-MX', {
      maximumFractionDigits: 3,
    });
  document.getElementById('medidas').textContent =
    `Etiqueta ${mm('--tag-ancho')} × ${mm('--tag-alto')} mm · ` +
    `área imprimible ${util('--tag-ancho')} × ${util('--tag-alto')} mm · ` +
    `módulo ${mm('--barcode-modulo')} mm · zona silenciosa ${mm('--quiet-zone')} mm · ` +
    `barras ${mm('--barcode-alto')} mm de alto`;
}

async function iniciar() {
  pintarMuestras();
  mostrarMedidas();
  try {
    // Medir solo con la fuente del precio ya cargada; si no, el ajuste sale mal.
    await Promise.all([document.fonts.load('700 16px Oswald'), document.fonts.ready]);
  } catch {
    // Sin Font Loading API: se ajusta con la fuente disponible.
  }
  ajustarTodas();

  document.getElementById('btn-imprimir').addEventListener('click', () => window.print());

  // Antes de imprimir se regenera todo con los valores actuales de las
  // variables CSS, por si se ajustaron desde las herramientas del navegador.
  window.addEventListener('beforeprint', () => {
    pintarMuestras();
    ajustarTodas();
  });
}

iniciar();
