const { chromium } = require('playwright');
const c = require('./comun.cjs');
const OUT = c.SALIDA;
const BASE = 'http://127.0.0.1:5500';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-aguilapos/databases/(default)/documents';
const resultados = [];
const ok = (nombre, cond, extra = '') => resultados.push(`${cond ? 'ok  ' : 'FALLO'} ${nombre}${extra ? ' — ' + extra : ''}`);
const rest = (metodo, ruta, cuerpo) => fetch(`${FS}/${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then((r) => r.json());

// JS → valores REST de Firestore
function valor(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  throw new Error('tipo no soportado');
}
const campos = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, valor(v)])) });

function producto(extra) {
  const ahora = new Date();
  return {
    upc: null, plu: null, nombre: 'X', marca: null, descriptor: null, presentacion: '', precioCentavos: 100, unidadVenta: 'pieza',
    precioPorKgCentavos: null, claseFiscal: 'gravado', tiendas: [], existencias: null, costoCentavos: null, proveedor: null, activo: true,
    ultimoPrecioImpresoCentavos: null, fechaUltimaImpresion: null, tokensBusqueda: [], creadoEn: ahora, actualizadoEn: ahora, actualizadoPor: 'admin@aguila.test',
    ...extra,
  };
}

async function sembrar() {
  await c.borrarTodo();
  await c.sembrarAdmin();
  await rest('PATCH', 'stores/talbot', campos({ nombre: 'Águila Talbot', direccion: 'Talbot St', activo: true }));
  await rest('PATCH', 'stores/erie', campos({ nombre: 'Águila Erie', direccion: 'Erie St', activo: true }));
  await rest('PATCH', 'products/p-tajin', campos(producto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 549, tiendas: ['talbot', 'erie'], tokensBusqueda: ['cla', 'clas', 'clasi', 'clasic', 'clasico', 'taj', 'taji', 'tajin'] })));
  await rest('PATCH', 'products/p-chile', campos(producto({ nombre: 'CHILE GUAJILLO', precioCentavos: 500, claseFiscal: 'tasaCero', tiendas: ['talbot'], ultimoPrecioImpresoCentavos: 500, fechaUltimaImpresion: '2026-09-20', tokensBusqueda: ['chi', 'chil', 'chile', 'gua', 'guaj', 'guaji', 'guajil', 'guajill', 'guajillo'] })));
  await rest('PATCH', 'products/p-jumex', campos(producto({ upc: '036000291452', nombre: 'MANGO', marca: 'JUMEX', presentacion: '335mL', precioCentavos: 199, tiendas: ['erie'], ultimoPrecioImpresoCentavos: 179, fechaUltimaImpresion: '2026-09-01', tokensBusqueda: ['man', 'mang', 'mango', 'jum', 'jume', 'jumex'] })));
  await rest('PATCH', 'products/p-viejo', campos(producto({ nombre: 'DESCONTINUADO', precioCentavos: 300, tiendas: ['talbot'], activo: false, tokensBusqueda: ['des'] })));
  await rest('PATCH', 'products/p-suelto', campos(producto({ nombre: 'PILONCILLO', precioCentavos: 250, tiendas: [], tokensBusqueda: ['pil', 'pilo', 'pilon', 'pilonc', 'pilonci', 'piloncil', 'piloncill', 'piloncillo'] })));
}

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  await sembrar();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`[console] ${m.text().slice(0, 160)}`); });

  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', 'admin@aguila.test'); await page.fill('#secreto', 'Prueba1234'); await page.press('#secreto', 'Enter');
  await page.waitForURL(/index\.html/);
  await page.click('nav a[href$="imprimir.html"]');
  await page.waitForURL(/imprimir\.html/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 3);

  const grupos = await page.$$eval('#grupos .grupo', (secs) => secs.map((s) => [s.querySelector('.grupo__titulo span').textContent, s.querySelectorAll('tbody tr').length, [...s.querySelectorAll('tbody tr strong')].map((e) => e.textContent).join(',')]));
  ok('grupos por tienda con solo pendientes activos', JSON.stringify(grupos) === JSON.stringify([['Águila Erie', 2, 'CLASICO,MANGO'], ['Águila Talbot', 1, 'CLASICO'], ['Sin tienda asignada', 1, 'PILONCILLO']]), JSON.stringify(grupos));
  ok('el botón de vista previa está deshabilitado sin selección', await page.isDisabled('#btn-vista'));
  await page.screenshot({ path: `${OUT}/e2e-imprimir-lista.png`, fullPage: true });

  await page.keyboard.press('Alt+a');
  await page.waitForFunction(() => /^4 etiquetas seleccionadas$/.test(document.getElementById('contador').textContent));
  ok('Alt+A selecciona las 4 etiquetas (una por tienda)', true);
  ok('las casillas "Todas" quedan marcadas', (await page.$$eval('#grupos input.todas', (l) => l.every((c) => c.checked))));

  // añadir a mano un producto no pendiente por UPC del escáner: CHILE no tiene UPC; usamos JUMEX ya pendiente? No: añadimos CHILE por nombre y comprobamos el UPC inválido
  await page.fill('#agregar', 'chile');
  await page.press('#agregar', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 4);
  ok('añadir a mano crea el grupo "Añadidos a mano" y lo selecciona', /5 etiquetas/.test(await page.textContent('#contador')));
  await page.fill('#agregar', '633148100014');
  await page.press('#agregar', 'Enter');
  await page.waitForSelector('.aviso--error');
  ok('UPC con verificador incorrecto al añadir se avisa', /verificador/.test(await page.textContent('.aviso--error')));

  // quitar JUMEX (erie) de la selección con clic en la fila
  await page.click('#grupos .grupo[data-grupo="erie"] tbody tr:nth-child(2) td:nth-child(2)');
  await page.waitForFunction(() => /^4 etiquetas/.test(document.getElementById('contador').textContent));
  ok('clic en la fila quita una etiqueta; la casilla "Todas" de Erie queda indeterminada', await page.$eval('#grupos .grupo[data-grupo="erie"] input.todas', (c) => c.indeterminate));

  // vista previa
  await page.keyboard.press('Alt+p');
  await page.waitForSelector('#vista:not([hidden])');
  const enVista = await page.$$eval('#hoja .etiqueta', (l) => l.map((e) => e.dataset.id));
  ok('la vista previa tiene 4 etiquetas en orden de grupo (TAJIN sale dos veces)', JSON.stringify(enVista) === JSON.stringify(['p-tajin', 'p-tajin', 'p-suelto', 'p-chile']), JSON.stringify(enVista));
  ok('el foco está en Imprimir', await page.evaluate(() => document.activeElement?.id === 'btn-imprimir'));
  ok('las etiquetas con UPC llevan código de barras', (await page.$$('#hoja svg.upca')).length === 2);
  const precios = await page.$$eval('#hoja .etiqueta__precio', (l) => l.map((e) => { const r = document.createRange(); r.selectNodeContents(e); return [Math.round(r.getBoundingClientRect().width), Math.round(e.parentElement.getBoundingClientRect().width)]; }));
  ok('los precios se ajustan al ancho de su columna (sin recortar +Tx)', precios.every(([texto, columna]) => texto <= columna), JSON.stringify(precios));
  await page.screenshot({ path: `${OUT}/e2e-imprimir-vista.png`, fullPage: true });

  // salida impresa: etiqueta 62x32 y hoja carta
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/lote-etiqueta.pdf`, width: '28.9mm', height: '58.9mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.pdf({ path: `${OUT}/lote-carta.pdf`, width: '215.9mm', height: '279.4mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });

  // Esc vuelve a la selección sin perderla; Alt+P vuelve a la vista
  await page.keyboard.press('Escape');
  await page.waitForSelector('#seleccion:not([hidden])');
  ok('Esc vuelve a la selección conservándola', /^4 etiquetas/.test(await page.textContent('#contador')));
  await page.keyboard.press('Alt+p');
  await page.waitForSelector('#vista:not([hidden])');

  // imprimir (sin diálogo real en headless): se simula el cierre del diálogo
  await page.evaluate(() => { window.print = () => setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirmacion:not([hidden])');
  ok('tras el diálogo se pregunta si salieron bien, con el foco en Sí', /4 etiquetas/.test(await page.textContent('#confirmacion-texto')) && (await page.evaluate(() => document.activeElement?.id === 'btn-confirmar')));
  // "No" vuelve a la vista con Imprimir enfocado
  await page.keyboard.press('Escape');
  ok('"No" vuelve a la vista previa', await page.evaluate(() => document.getElementById('confirmacion').hidden && document.activeElement?.id === 'btn-imprimir'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirmacion:not([hidden])');

  // otra estación cambia el precio de TAJIN mientras las etiquetas están en la impresora
  await rest('PATCH', 'products/p-tajin?updateMask.fieldPaths=precioCentavos', campos({ precioCentavos: 599 }));
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.aviso')].some((a) => /marcad/.test(a.textContent)), null, { timeout: 15000 });
  const avisoMarcado = await page.evaluate(() => [...document.querySelectorAll('.aviso')].map((a) => a.textContent).find((t) => /marcad/.test(t)));
  ok('al confirmar se marcan 3 productos (TAJIN una sola vez)', /3 productos marcados como impresos/.test(avisoMarcado), avisoMarcado);
  await page.waitForSelector('#seleccion:not([hidden])');

  const doc = async (id) => (await rest('GET', `products/${id}`)).fields;
  const tajin = await doc('p-tajin'); const chile = await doc('p-chile'); const suelto = await doc('p-suelto'); const jumex = await doc('p-jumex');
  ok('TAJIN registra el precio que se imprimió (549), no el nuevo (599)', tajin.ultimoPrecioImpresoCentavos.integerValue === '549' && tajin.fechaUltimaImpresion.stringValue === hoy() && tajin.precioCentavos.integerValue === '599');
  ok('CHILE y PILONCILLO quedan marcados hoy; JUMEX (no impreso) intacto', chile.fechaUltimaImpresion.stringValue === hoy() && suelto.ultimoPrecioImpresoCentavos.integerValue === '250' && jumex.ultimoPrecioImpresoCentavos.integerValue === '179' && jumex.fechaUltimaImpresion.stringValue === '2026-09-01');
  ok('actualizadoPor es quien imprimió', tajin.actualizadoPor.stringValue === 'admin@aguila.test');

  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 2);
  const despues = await page.$$eval('#grupos .grupo', (secs) => secs.map((s) => [s.querySelector('.grupo__titulo span').textContent, [...s.querySelectorAll('tbody tr strong')].map((e) => e.textContent).join(',')]));
  ok('después quedan pendientes TAJIN (precio cambió) y JUMEX; PILONCILLO y el añadido a mano desaparecen', JSON.stringify(despues) === JSON.stringify([['Águila Erie', 'CLASICO,MANGO'], ['Águila Talbot', 'CLASICO']]), JSON.stringify(despues));
  ok('la selección queda vacía', /^0 etiquetas/.test(await page.textContent('#contador')));

  // la página de prueba del paso 1 sigue imprimiendo una etiqueta por hoja
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/prueba-etiquetas.html`, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => document.querySelectorAll('.etiqueta').length === 2);
  await p2.emulateMedia({ media: 'print' });
  await p2.pdf({ path: `${OUT}/prueba.pdf`, width: '28.9mm', height: '58.9mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });

  await browser.close();
  console.log('\n=== imprimir ===');
  console.log(resultados.join('\n'));
  console.log('\nErrores de consola/página:', errores.length ? '\n' + errores.join('\n') : 'ninguno');
  process.exitCode = resultados.some((r) => r.startsWith('FALLO')) ? 1 : 0;
})().catch((e) => { console.error('EXCEPCIÓN', e); console.log('\n=== imprimir ===');
  console.log(resultados.join('\n')); process.exit(1); });
