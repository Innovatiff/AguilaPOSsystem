/**
 * Productos (back office, solo administradores): catálogo con el escáner USB
 * como teclado, alta y edición con historial de precios, UPC duplicado,
 * desactivar y reactivar, service worker y manifest del back office, y
 * paginación.
 */
const c = require('./comun.cjs');
const OUT = c.SALIDA;

async function sembrar() {
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.rest('PATCH', 'stores/talbot', c.campos({ nombre: 'Águila Talbot', direccion: 'Talbot St', activo: true }));
  await c.rest('PATCH', 'stores/erie', c.campos({ nombre: 'Águila Erie', direccion: 'Erie St', activo: true }));
}

(async () => {
  const v = c.verificador('productos');
  await sembrar();
  const browser = await c.abrirNavegador();
  const { page, errores } = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 860 } });

  // el administrador entra y abre Productos desde la barra lateral
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  await page.click('nav a[href$="productos.html"]');
  await page.waitForURL(/productos\.html/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('la pestaña se llama «Productos · Águila POS» y la sección queda marcada en la barra lateral', (await page.title()) === 'Productos · Águila POS' && (await page.getAttribute('nav a[href$="productos.html"]', 'aria-current')) === 'page', await page.title());
  v.ok('catálogo sincronizado y vacío', /^0 productos · sincronizado$/.test(await page.textContent('#estado-catalogo')), await page.textContent('#estado-catalogo'));
  v.ok('el buscador tiene el foco al entrar', await page.evaluate(() => document.activeElement?.id === 'busqueda'));

  // escáner: UPC desconocido -> oferta -> crear
  await page.type('#busqueda', '633148100013');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#oferta-crear:not([hidden])');
  v.ok('UPC desconocido: se ofrece crear, con el foco en Crear', await page.evaluate(() => document.activeElement?.id === 'oferta-crear-btn'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#editor[open]');
  v.ok('editor abierto con el UPC prefijado', (await page.inputValue('#f-upc')) === '633148100013' && (await page.evaluate(() => document.activeElement?.id)) === 'f-marca');
  v.ok('tiendas activas marcadas por defecto', (await page.$$eval('#f-tiendas input:checked', (l) => l.length)) === 2);
  v.ok('la oferta de crear se oculta al abrir el editor', !(await page.isVisible('#oferta-crear')));
  v.ok('el precio por kilo está oculto para pieza', !(await page.isVisible('#campo-kilo')));
  await page.check('input[name="unidad"][value="peso"]');
  v.ok('y aparece al elegir peso', await page.isVisible('#campo-kilo'));
  await page.check('input[name="unidad"][value="pieza"]');
  await page.fill('#f-marca', 'TAJIN');
  await page.fill('#f-nombre', 'CLASICO');
  await page.fill('#f-presentacion', '142g');
  await page.fill('#f-precio', '4.99');
  await page.waitForTimeout(300);
  v.ok('vista previa con código de barras', (await page.$$('#vista-etiqueta svg.upca')).length === 1);
  await page.screenshot({ path: `${OUT}/e2e-editor-nuevo.png` });
  await page.press('#f-precio', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForSelector('.aviso--ok');
  v.ok('guardar con Enter crea el producto y avisa', /creado/.test(await page.textContent('.aviso--ok')), await page.textContent('.aviso--ok'));
  v.ok('el foco vuelve al buscador', await page.evaluate(() => document.activeElement?.id === 'busqueda'));

  // segundo producto sin UPC (plantilla B)
  await page.keyboard.press('Alt+n');
  await page.waitForSelector('dialog#editor[open]');
  await page.fill('#f-nombre', 'CHILE GUAJILLO');
  await page.fill('#f-precio', '5.00');
  await page.check('input[name="fiscal"][value="tasaCero"]');
  await page.press('#f-precio', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => /^2 productos/.test(document.getElementById('estado-catalogo').textContent));

  // búsqueda por texto y apertura con teclado
  await page.fill('#busqueda', 'taj');
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 1);
  const filaTexto = await page.textContent('#resultados tr');
  v.ok('búsqueda "taj" encuentra por marca', /CLASICO.*TAJIN · 142g.*633148100013.*\$4\.99\+Tx.*erie, talbot.*Activo/.test(filaTexto.replace(/\s+/g, ' ')), filaTexto.replace(/\s+/g, ' ').trim());
  await page.press('#busqueda', 'ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#editor[open]');
  v.ok('flecha abajo + Enter abre el producto en edición', /TAJIN CLASICO/.test(await page.textContent('#editor-titulo')));
  await page.waitForFunction(() => /Sin cambios de precio/.test(document.getElementById('historial').textContent), null, { timeout: 15000 });
  v.ok('historial vacío al inicio', true);

  // cambio de precio -> historial
  await page.fill('#f-precio', '5.49');
  await page.press('#f-precio', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => /\$5\.49\+Tx/.test(document.querySelector('#resultados')?.textContent ?? ''));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#editor[open]');
  await page.waitForFunction(() => /\$4\.99 → \$5\.49/.test(document.getElementById('historial').textContent), null, { timeout: 15000 });
  const textoHistorial = await page.textContent('#historial');
  v.ok('el historial muestra el cambio de precio con el usuario', /\$4\.99 → \$5\.49 · Alan \(admin\) \(admin@aguila\.test\)/.test(textoHistorial), textoHistorial.trim());
  const meta = await page.textContent('#meta');
  v.ok('meta muestra creado/actualizado y etiqueta nunca impresa', /Creado:.*Actualizado:.*admin@aguila\.test.*nunca impresa/.test(meta.replace(/\s+/g, ' ')));
  await page.screenshot({ path: `${OUT}/e2e-editor-edicion.png` });

  // guardar sin cambios
  await page.press('#f-nombre', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  v.ok('guardar sin cambios cierra y avisa "Sin cambios"', /Sin cambios/.test(await page.textContent('.avisos')));

  // verificación en Firestore vía REST
  const productosRest = await c.rest('GET', 'products');
  const tajin = productosRest.documents.find((d) => d.fields.nombre.stringValue === 'CLASICO');
  v.ok('Firestore: precio 549 y tokens de búsqueda', tajin.fields.precioCentavos.integerValue === '549' && tajin.fields.tokensBusqueda.arrayValue.values.some((v) => v.stringValue === 'tajin'));
  const historialRest = await c.rest('GET', 'priceHistory');
  const entrada = historialRest.documents?.[0];
  v.ok('Firestore: entrada de historial 499→549 con id producto_ms', !!entrada && entrada.fields.precioAnteriorCentavos.integerValue === '499' && entrada.fields.precioNuevoCentavos.integerValue === '549' && entrada.name.endsWith(`${tajin.name.split('/').pop()}_${new Date(entrada.fields.fecha.timestampValue).getTime()}`));

  // UPC duplicado
  await page.keyboard.press('Alt+n');
  await page.waitForSelector('dialog#editor[open]');
  await page.fill('#f-upc', '633148100013');
  await page.fill('#f-nombre', 'REPETIDO');
  await page.fill('#f-precio', '1.00');
  await page.press('#f-precio', 'Enter');
  await page.waitForSelector('#editor-aviso:not([hidden])');
  v.ok('UPC duplicado se rechaza antes de escribir', /ya pertenece a «TAJIN CLASICO»/.test(await page.textContent('#editor-aviso')), await page.textContent('#editor-aviso'));
  await page.fill('#f-nombre', ''); await page.fill('#f-upc', ''); await page.fill('#f-precio', '');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });

  // desactivar / ver inactivos / reactivar
  await page.fill('#busqueda', 'chile');
  await page.waitForFunction(() => { const filas = document.querySelectorAll('#resultados tr'); return filas.length === 1 && /CHILE/.test(filas[0].textContent); });
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  v.ok('con un solo resultado, Enter lo abre directamente', /CHILE GUAJILLO/.test(await page.textContent('#editor-titulo')));
  await page.click('#btn-desactivar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 0);
  v.ok('desactivado desaparece de la lista', true);
  await page.check('#ver-inactivos');
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 1);
  v.ok('"Ver inactivos" lo muestra como Inactivo', /Inactivo/.test(await page.textContent('#resultados tr')));
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  v.ok('el botón ofrece reactivar', (await page.textContent('#btn-desactivar')).includes('Reactivar'));
  await page.click('#btn-desactivar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => /Activo/.test(document.querySelector('#resultados tr')?.textContent ?? ''));
  v.ok('reactivado vuelve a Activo', true);

  // escáner con dígito verificador incorrecto
  await page.fill('#busqueda', '633148100014');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#aviso-busqueda:not([hidden])');
  v.ok('UPC con verificador incorrecto se explica', /verificador/.test(await page.textContent('#aviso-busqueda')), await page.textContent('#aviso-busqueda'));

  // escáner con UPC conocido abre directo
  await page.fill('#busqueda', '633148100013');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  v.ok('UPC conocido abre el producto directamente', /TAJIN CLASICO/.test(await page.textContent('#editor-titulo')));
  await page.keyboard.press('Escape');

  // service worker y caché
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const claves = await caches.keys();
    const config = await caches.match('js/config.js');
    const esquema = await caches.match('js/esquema.js');
    const vendor = await caches.match('vendor/firebase/12.19.0/firebase-firestore.js');
    return { activo: !!reg.active, claves, configEnCache: !!config, esquemaEnCache: !!esquema, vendorEnCache: !!vendor };
  });
  v.ok('service worker activo con caché versionada', sw.activo && sw.claves.some((clave) => clave.startsWith('catalogo-aguila-')), JSON.stringify(sw.claves));
  v.ok('config.js no está en la caché; la cáscara sí', !sw.configEnCache && sw.esquemaEnCache && sw.vendorEnCache);
  const manifiesto = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
  v.ok('manifest instalable del back office: «Águila POS · Back office», abre en el inicio, 3 íconos',
    manifiesto.name === 'Águila POS · Back office' && manifiesto.short_name === 'Águila POS' && manifiesto.start_url === 'index.html' && manifiesto.icons.length === 3,
    JSON.stringify({ name: manifiesto.name, short_name: manifiesto.short_name, start_url: manifiesto.start_url, iconos: manifiesto.icons?.length }));

  // paginación: 120 productos más (122 en total), páginas de 50
  for (let desde = 1; desde <= 120; desde += 20) {
    await Promise.all(Array.from({ length: 20 }, (_, i) => desde + i).map((n) => {
      const num = String(n).padStart(3, '0');
      return c.sembrarProducto(`p-pag-${num}`, { nombre: `PRODUCTO ${num}`, marca: 'PRUEBA', precioCentavos: 100 + n, tiendas: ['talbot'], tokensBusqueda: c.tokens(`PRODUCTO ${num}`, 'PRUEBA') });
    }));
  }
  await page.fill('#busqueda', '');
  await page.waitForFunction(() => /^122 productos/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 50);
  const resumen = () => page.textContent('#paginacion-resumen');
  v.ok('página 1: 50 filas y resumen "1–50 de 122 · página 1 de 3"', /1–50 de 122 · página 1 de 3/.test(await resumen()), await resumen());
  v.ok('Anterior deshabilitado en la primera página; números 1 2 3', await page.isDisabled('#pag-anterior') && (await page.$$eval('#pag-numeros button', (l) => l.map((b) => b.textContent).join(' '))) === '1 2 3');
  v.ok('la página actual lleva aria-current', (await page.getAttribute('#pag-numeros button:has-text("1")', 'aria-current')) === 'page');
  await page.click('#pag-siguiente');
  await page.waitForFunction(() => /página 2 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  const primeraFilaP2 = await page.textContent('#resultados tr:first-child');
  v.ok('Siguiente pasa a la página 2 (51–100) y sigue donde terminó la 1', /51–100 de 122/.test(await resumen()) && /PRODUCTO 049/.test(primeraFilaP2), primeraFilaP2.replace(/\s+/g, ' ').trim());
  await page.click('#pag-numeros button:has-text("3")');
  await page.waitForFunction(() => /página 3 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  v.ok('última página: 101–122, 22 filas, Siguiente deshabilitado', /101–122 de 122/.test(await resumen()) && (await page.$$eval('#resultados tr', (l) => l.length)) === 22 && await page.isDisabled('#pag-siguiente'));
  await page.focus('#resultados tr');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => /página 2 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  v.ok('↑ en la primera fila retrocede de página y enfoca la última fila', await page.evaluate(() => document.activeElement === document.querySelector('#resultados tr:last-child')));
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => /página 3 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  v.ok('↓ en la última fila avanza de página y enfoca la primera', await page.evaluate(() => document.activeElement === document.querySelector('#resultados tr:first-child')));
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => /página 2 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  await page.keyboard.press('Escape');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => /página 3 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  v.ok('Re Pág / Av Pág cambian de página desde la lista y desde el buscador', await page.evaluate(() => document.activeElement?.id === 'busqueda'));
  await page.fill('#busqueda', 'prueba');
  await page.waitForFunction(() => /1–50 de 120 · página 1 de 3/.test(document.getElementById('paginacion-resumen').textContent));
  v.ok('cambiar la búsqueda vuelve a la página 1', true);
  await page.selectOption('#por-pagina', '100');
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 100);
  v.ok('100 por página: "1–100 de 120 · página 1 de 2"', /1–100 de 120 · página 1 de 2/.test(await resumen()), await resumen());
  await page.reload(); // sin networkidle: el oyente de Firestore mantiene la conexión abierta
  await page.waitForSelector('#contenido:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 100, null, { timeout: 20000 });
  v.ok('el tamaño de página se recuerda al volver a entrar', (await page.inputValue('#por-pagina')) === '100' && /página 1 de 2/.test(await resumen()), await resumen());
  await page.fill('#busqueda', 'taj');
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 1);
  v.ok('con un solo resultado no hay botones de página y el resumen dice "1 resultado"', (await page.textContent('#paginacion-resumen')) === '1 resultado' && !(await page.isVisible('#paginacion-botones')));
  await page.screenshot({ path: `${OUT}/e2e-productos-paginacion.png`, fullPage: true });
  await page.fill('#busqueda', '');

  await page.screenshot({ path: `${OUT}/e2e-productos.png`, fullPage: true });
  await browser.close();
  v.terminar(errores);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
