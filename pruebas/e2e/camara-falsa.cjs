/**
 * Video Y4M con un código UPC-A para la cámara falsa de Chromium
 * (--use-fake-device-for-media-stream --use-file-for-fake-video-capture=…).
 * Las barras se dibujan con js/upca.js dentro de una página del propio sitio,
 * para no duplicar la codificación.
 */
const fs = require('node:fs');
const { BASE } = require('./comun.cjs');

/**
 * @param {import('playwright').Browser} browser navegador ya abierto (sin cámara falsa)
 * @param {string} upc 12 dígitos
 * @param {string} ruta archivo .y4m de salida
 */
async function generarVideoUPC(browser, upc, ruta, { ancho = 640, alto = 480, cuadros = 2 } = {}) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/prueba-etiquetas.html`, { waitUntil: 'domcontentloaded' });
  const gris = await page.evaluate(async ({ upc, ancho, alto }) => {
    const { modulosUPCA } = await import('./js/upca.js');
    const modulos = [...modulosUPCA(upc)].map(Number);
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
    const anchoModulo = 4;
    const x0 = Math.round((ancho - modulos.length * anchoModulo) / 2);
    const y0 = Math.round(alto * 0.28);
    const altura = Math.round(alto * 0.44);
    ctx.fillStyle = '#000000';
    modulos.forEach((m, i) => { if (m) ctx.fillRect(x0 + i * anchoModulo, y0, anchoModulo, altura); });
    const datos = ctx.getImageData(0, 0, ancho, alto).data;
    const salida = [];
    for (let i = 0; i < ancho * alto; i += 1) salida.push(datos[i * 4]);
    return salida;
  }, { upc, ancho, alto });
  await page.close();

  const y = Buffer.alloc(ancho * alto);
  for (let i = 0; i < y.length; i += 1) y[i] = 16 + Math.round((gris[i] * 219) / 255);
  const uv = Buffer.alloc((ancho / 2) * (alto / 2), 128);
  const cuadro = Buffer.concat([Buffer.from('FRAME\n'), y, uv, uv]);
  const cabecera = Buffer.from(`YUV4MPEG2 W${ancho} H${alto} F30:1 Ip A1:1 C420jpeg\n`);
  fs.writeFileSync(ruta, Buffer.concat([cabecera, ...Array.from({ length: cuadros }, () => cuadro)]));
  return ruta;
}

/** Argumentos de Chromium para que getUserMedia entregue ese video sin preguntar. */
const argumentosCamaraFalsa = (rutaY4M) => ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${rutaY4M}`, '--use-fake-ui-for-media-stream'];

module.exports = { generarVideoUPC, argumentosCamaraFalsa };
