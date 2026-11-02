/**
 * Etiquetas (back office, solo administradores): pendientes por tienda,
 * selección con teclado y ratón, vista previa, salida impresa (una etiqueta
 * por hoja, centrada como en la página de prueba) y confirmación que marca
 * los productos como impresos con el precio que salió en papel.
 */
const fs = require('node:fs');
const c = require('./comun.cjs');
const OUT = c.SALIDA;

async function sembrar() {
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.rest('PATCH', 'stores/talbot', c.campos({ nombre: 'Águila Talbot', direccion: 'Talbot St', activo: true }));
  await c.rest('PATCH', 'stores/erie', c.campos({ nombre: 'Águila Erie', direccion: 'Erie St', activo: true }));
  await c.sembrarProducto('p-tajin', { upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', descriptor: 'Chile, limón y sal · sin gluten', presentacion: '142g', precioCentavos: 549, tiendas: ['talbot', 'erie'], tokensBusqueda: ['cla', 'clas', 'clasi', 'clasic', 'clasico', 'taj', 'taji', 'tajin'] });
  await c.sembrarProducto('p-chile', { nombre: 'CHILE GUAJILLO', precioCentavos: 500, claseFiscal: 'tasaCero', tiendas: ['talbot'], ultimoPrecioImpresoCentavos: 500, fechaUltimaImpresion: '2026-09-20', tokensBusqueda: ['chi', 'chil', 'chile', 'gua', 'guaj', 'guaji', 'guajil', 'guajill', 'guajillo'] });
  await c.sembrarProducto('p-jumex', { upc: '036000291452', nombre: 'MANGO', marca: 'JUMEX', presentacion: '335mL', precioCentavos: 199, tiendas: ['erie'], ultimoPrecioImpresoCentavos: 179, fechaUltimaImpresion: '2026-09-01', tokensBusqueda: ['man', 'mang', 'mango', 'jum', 'jume', 'jumex'] });
  await c.sembrarProducto('p-viejo', { nombre: 'DESCONTINUADO', precioCentavos: 300, tiendas: ['talbot'], activo: false, tokensBusqueda: ['des'] });
  await c.sembrarProducto('p-suelto', { nombre: 'PILONCILLO', precioCentavos: 250, tiendas: [], tokensBusqueda: ['pil', 'pilo', 'pilon', 'pilonc', 'pilonci', 'piloncil', 'piloncill', 'piloncillo'] });
}

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const v = c.verificador('imprimir');
  await sembrar();
  const browser = await c.abrirNavegador();
  const { ctx, page, errores } = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 900 } });

  // el administrador entra y abre «Etiquetas» desde la barra lateral
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  v.ok('la barra lateral llama «Etiquetas» a la impresión de etiquetas', c.texto(await page.textContent('nav a[href$="imprimir.html"]')) === 'Etiquetas', c.texto(await page.textContent('nav a[href$="imprimir.html"]')));
  await page.click('nav a[href$="imprimir.html"]');
  await page.waitForURL(/imprimir\.html/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 3);
  v.ok('la pestaña se llama «Imprimir etiquetas · Águila POS» y la sección queda marcada en la barra lateral', (await page.title()) === 'Imprimir etiquetas · Águila POS' && (await page.getAttribute('nav a[href$="imprimir.html"]', 'aria-current')) === 'page', await page.title());

  const grupos = await page.$$eval('#grupos .grupo', (secs) => secs.map((s) => [s.querySelector('.grupo__titulo span').textContent, s.querySelectorAll('tbody tr').length, [...s.querySelectorAll('tbody tr strong')].map((e) => e.textContent).join(',')]));
  v.ok('grupos por tienda con solo pendientes activos', JSON.stringify(grupos) === JSON.stringify([['Águila Erie', 2, 'CLASICO,MANGO'], ['Águila Talbot', 1, 'CLASICO'], ['Sin tienda asignada', 1, 'PILONCILLO']]), JSON.stringify(grupos));
  v.ok('el botón de vista previa está deshabilitado sin selección', await page.isDisabled('#btn-vista'));
  await page.screenshot({ path: `${OUT}/e2e-imprimir-lista.png`, fullPage: true });

  await page.keyboard.press('Alt+a');
  await page.waitForFunction(() => /^4 etiquetas seleccionadas$/.test(document.getElementById('contador').textContent));
  v.ok('Alt+A selecciona las 4 etiquetas (una por tienda)', true);
  v.ok('las casillas "Todas" quedan marcadas', (await page.$$eval('#grupos input.todas', (l) => l.every((casilla) => casilla.checked))));

  // añadir a mano un producto no pendiente por UPC del escáner: CHILE no tiene UPC; usamos JUMEX ya pendiente? No: añadimos CHILE por nombre y comprobamos el UPC inválido
  await page.fill('#agregar', 'chile');
  await page.press('#agregar', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 4);
  v.ok('añadir a mano crea el grupo "Añadidos a mano" y lo selecciona', /5 etiquetas/.test(await page.textContent('#contador')));
  await page.fill('#agregar', '633148100014');
  await page.press('#agregar', 'Enter');
  await page.waitForSelector('.aviso--error');
  v.ok('UPC con verificador incorrecto al añadir se avisa', /verificador/.test(await page.textContent('.aviso--error')));

  // quitar JUMEX (erie) de la selección con clic en la fila
  await page.click('#grupos .grupo[data-grupo="erie"] tbody tr:nth-child(2) td:nth-child(2)');
  await page.waitForFunction(() => /^4 etiquetas/.test(document.getElementById('contador').textContent));
  v.ok('clic en la fila quita una etiqueta; la casilla "Todas" de Erie queda indeterminada', await page.$eval('#grupos .grupo[data-grupo="erie"] input.todas', (casilla) => casilla.indeterminate));

  // vista previa
  await page.keyboard.press('Alt+p');
  await page.waitForSelector('#vista:not([hidden])');
  const enVista = await page.$$eval('#hoja .etiqueta', (l) => l.map((e) => e.dataset.id));
  v.ok('la vista previa tiene 4 etiquetas en orden de grupo (TAJIN sale dos veces)', JSON.stringify(enVista) === JSON.stringify(['p-tajin', 'p-tajin', 'p-suelto', 'p-chile']), JSON.stringify(enVista));
  v.ok('el foco está en Imprimir', await page.evaluate(() => document.activeElement?.id === 'btn-imprimir'));
  v.ok('las etiquetas con UPC llevan código de barras', (await page.$$('#hoja svg.upca')).length === 2);
  const precios = await page.$$eval('#hoja .etiqueta__precio', (l) => l.map((e) => { const r = document.createRange(); r.selectNodeContents(e); return [Math.round(r.getBoundingClientRect().width), Math.round(e.parentElement.getBoundingClientRect().width)]; }));
  v.ok('los precios se ajustan al ancho de su columna (sin recortar +Tx)', precios.every(([texto, columna]) => texto <= columna), JSON.stringify(precios));
  await page.screenshot({ path: `${OUT}/e2e-imprimir-vista.png`, fullPage: true });

  // salida impresa: etiqueta 62x32 y hoja carta
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/lote-etiqueta.pdf`, width: '28.9mm', height: '58.9mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.pdf({ path: `${OUT}/lote-carta.pdf`, width: '215.9mm', height: '279.4mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  // Páginas del PDF (objetos /Type /Page): una etiqueta nunca debe partirse en dos hojas,
  // ni siquiera con descriptor, ni con las reglas de pantalla angosta (la hoja mide 59 mm).
  const paginasPDF = (ruta) => (fs.readFileSync(ruta).toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const paginasLote = paginasPDF(`${OUT}/lote-etiqueta.pdf`);
  v.ok('en la impresora de etiquetas sale exactamente una hoja por etiqueta (TAJIN lleva descriptor)', paginasLote === enVista.length, `${paginasLote} hojas para ${enVista.length} etiquetas`);
  v.ok('en hoja carta caben todas en una página', paginasPDF(`${OUT}/lote-carta.pdf`) === 1, `${paginasPDF(`${OUT}/lote-carta.pdf`)} páginas`);
  // La hoja que entrega el driver de la Brother es la etiqueta completa (62 × 32 mm, apaisada):
  // ahí cada etiqueta debe ir centrada en su hoja, como en la página de prueba.
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${OUT}/lote-62x32.pdf`, width: '32mm', height: '62mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  v.ok('con la hoja real de 62 × 32 mm también sale exactamente una hoja por etiqueta', paginasPDF(`${OUT}/lote-62x32.pdf`) === enVista.length, `${paginasPDF(`${OUT}/lote-62x32.pdf`)} hojas`);
  // Posición en la hoja: con una ventana del tamaño de la hoja (62 × 32 mm en px CSS) y medios de
  // impresión, el diseño es el que va al papel. Se compara más abajo con la página de prueba.
  const HOJA = { width: Math.round(62 / 25.4 * 96), height: Math.round(32 / 25.4 * 96) };
  const posicion = async (pagina, selector) => {
    await pagina.setViewportSize(HOJA);
    await pagina.emulateMedia({ media: 'print' });
    const r = await pagina.$eval(selector, (e) => { const b = e.getBoundingClientRect(); return { arriba: Math.round(b.top * 10) / 10, izquierda: Math.round(b.left * 10) / 10, alto: Math.round(b.height * 10) / 10 }; });
    await pagina.emulateMedia({ media: 'screen' });
    await pagina.setViewportSize({ width: 1280, height: 900 });
    return r;
  };
  const enLote = await posicion(page, '#hoja .etiqueta');

  // Esc vuelve a la selección sin perderla; Alt+P vuelve a la vista
  await page.keyboard.press('Escape');
  await page.waitForSelector('#seleccion:not([hidden])');
  v.ok('Esc vuelve a la selección conservándola', /^4 etiquetas/.test(await page.textContent('#contador')));
  await page.keyboard.press('Alt+p');
  await page.waitForSelector('#vista:not([hidden])');

  // imprimir (sin diálogo real en headless): se simula el cierre del diálogo
  await page.evaluate(() => { window.print = () => setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirmacion:not([hidden])');
  v.ok('tras el diálogo se pregunta si salieron bien, con el foco en Sí', /4 etiquetas/.test(await page.textContent('#confirmacion-texto')) && (await page.evaluate(() => document.activeElement?.id === 'btn-confirmar')));
  // "No" vuelve a la vista con Imprimir enfocado
  await page.keyboard.press('Escape');
  v.ok('"No" vuelve a la vista previa', await page.evaluate(() => document.getElementById('confirmacion').hidden && document.activeElement?.id === 'btn-imprimir'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirmacion:not([hidden])');

  // otra estación cambia el precio de TAJIN mientras las etiquetas están en la impresora
  await c.rest('PATCH', 'products/p-tajin?updateMask.fieldPaths=precioCentavos', c.campos({ precioCentavos: 599 }));
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.aviso')].some((a) => /marcad/.test(a.textContent)), null, { timeout: 15000 });
  const avisoMarcado = await page.evaluate(() => [...document.querySelectorAll('.aviso')].map((a) => a.textContent).find((t) => /marcad/.test(t)));
  v.ok('al confirmar se marcan 3 productos (TAJIN una sola vez)', /3 productos marcados como impresos/.test(avisoMarcado), avisoMarcado);
  await page.waitForSelector('#seleccion:not([hidden])');

  const doc = async (id) => (await c.rest('GET', `products/${id}`)).fields;
  const tajin = await doc('p-tajin'); const chile = await doc('p-chile'); const suelto = await doc('p-suelto'); const jumex = await doc('p-jumex');
  v.ok('TAJIN registra el precio que se imprimió (549), no el nuevo (599)', tajin.ultimoPrecioImpresoCentavos.integerValue === '549' && tajin.fechaUltimaImpresion.stringValue === hoy() && tajin.precioCentavos.integerValue === '599');
  v.ok('CHILE y PILONCILLO quedan marcados hoy; JUMEX (no impreso) intacto', chile.fechaUltimaImpresion.stringValue === hoy() && suelto.ultimoPrecioImpresoCentavos.integerValue === '250' && jumex.ultimoPrecioImpresoCentavos.integerValue === '179' && jumex.fechaUltimaImpresion.stringValue === '2026-09-01');
  v.ok('actualizadoPor es quien imprimió', tajin.actualizadoPor.stringValue === 'admin@aguila.test');

  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length === 2);
  const despues = await page.$$eval('#grupos .grupo', (secs) => secs.map((s) => [s.querySelector('.grupo__titulo span').textContent, [...s.querySelectorAll('tbody tr strong')].map((e) => e.textContent).join(',')]));
  v.ok('después quedan pendientes TAJIN (precio cambió) y JUMEX; PILONCILLO y el añadido a mano desaparecen', JSON.stringify(despues) === JSON.stringify([['Águila Erie', 'CLASICO,MANGO'], ['Águila Talbot', 'CLASICO']]), JSON.stringify(despues));
  v.ok('la selección queda vacía', /^0 etiquetas/.test(await page.textContent('#contador')));

  // la página de prueba del paso 1 sigue imprimiendo una etiqueta por hoja
  const p2 = await ctx.newPage();
  await p2.goto(`${c.BASE}/prueba-etiquetas.html`, { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => document.querySelectorAll('.etiqueta').length === 2);
  await p2.emulateMedia({ media: 'print' });
  await p2.pdf({ path: `${OUT}/prueba.pdf`, width: '28.9mm', height: '58.9mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });
  v.ok('la página de prueba imprime sus dos etiquetas en dos hojas', paginasPDF(`${OUT}/prueba.pdf`) === 2, `${paginasPDF(`${OUT}/prueba.pdf`)} hojas`);
  await p2.pdf({ path: `${OUT}/prueba-62x32.pdf`, width: '32mm', height: '62mm', margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: true });

  // Misma posición en la hoja que la página de prueba (verificada en la impresora):
  // la etiqueta del lote debe quedar centrada, no pegada al borde superior.
  const enPrueba = await posicion(p2, '.muestra .etiqueta');
  v.ok('en la hoja de 62 × 32 la etiqueta del lote queda donde la de la página de prueba (centrada, no pegada arriba)',
    Math.abs(enLote.arriba - enPrueba.arriba) <= 1 && Math.abs(enLote.izquierda - enPrueba.izquierda) <= 1 && enLote.arriba >= 4,
    `lote ${JSON.stringify(enLote)} · prueba ${JSON.stringify(enPrueba)}`);

  await browser.close();
  v.terminar(errores);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
