const { chromium } = require('playwright');
const c = require('./comun.cjs');
const OUT = c.SALIDA;
const BASE = 'http://127.0.0.1:5500';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-aguilapos/databases/(default)/documents';
const resultados = [];
const ok = (nombre, cond, extra = '') => resultados.push(`${cond ? 'ok  ' : 'FALLO'} ${nombre}${extra ? ' — ' + extra : ''}`);

const rest = (metodo, ruta, cuerpo) => fetch(`${FS}/${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then((r) => r.json());
async function sembrar() {
  await c.borrarTodo();
  await c.sembrarAdmin();
  await rest('PATCH', 'stores/talbot', { fields: { nombre: { stringValue: 'Águila Talbot' }, direccion: { stringValue: 'Talbot St' }, activo: { booleanValue: true } } });
  await rest('PATCH', 'stores/erie', { fields: { nombre: { stringValue: 'Águila Erie' }, direccion: { stringValue: 'Erie St' }, activo: { booleanValue: true } } });
}

(async () => {
  await sembrar();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`[console] ${m.text().slice(0, 160)}`); });
  page.on('dialog', (d) => d.accept());

  // login
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', 'admin@aguila.test');
  await page.fill('#secreto', 'Prueba1234');
  await page.press('#secreto', 'Enter');
  await page.waitForURL(/index\.html/);
  await page.click('nav a[href$="productos.html"]');
  await page.waitForURL(/productos\.html/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  ok('catálogo sincronizado y vacío', /^0 productos · sincronizado$/.test(await page.textContent('#estado-catalogo')), await page.textContent('#estado-catalogo'));
  ok('el buscador tiene el foco al entrar', await page.evaluate(() => document.activeElement?.id === 'busqueda'));

  // escáner: UPC desconocido -> oferta -> crear
  await page.type('#busqueda', '633148100013');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#oferta-crear:not([hidden])');
  ok('UPC desconocido: se ofrece crear, con el foco en Crear', await page.evaluate(() => document.activeElement?.id === 'oferta-crear-btn'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#editor[open]');
  ok('editor abierto con el UPC prefijado', (await page.inputValue('#f-upc')) === '633148100013' && (await page.evaluate(() => document.activeElement?.id)) === 'f-marca');
  ok('tiendas activas marcadas por defecto', (await page.$$eval('#f-tiendas input:checked', (l) => l.length)) === 2);
  ok('la oferta de crear se oculta al abrir el editor', !(await page.isVisible('#oferta-crear')));
  ok('el precio por kilo está oculto para pieza', !(await page.isVisible('#campo-kilo')));
  await page.check('input[name="unidad"][value="peso"]');
  ok('y aparece al elegir peso', await page.isVisible('#campo-kilo'));
  await page.check('input[name="unidad"][value="pieza"]');
  await page.fill('#f-marca', 'TAJIN');
  await page.fill('#f-nombre', 'CLASICO');
  await page.fill('#f-presentacion', '142g');
  await page.fill('#f-precio', '4.99');
  await page.waitForTimeout(300);
  ok('vista previa con código de barras', (await page.$$('#vista-etiqueta svg.upca')).length === 1);
  await page.screenshot({ path: `${OUT}/e2e-editor-nuevo.png` });
  await page.press('#f-precio', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForSelector('.aviso--ok');
  ok('guardar con Enter crea el producto y avisa', /creado/.test(await page.textContent('.aviso--ok')), await page.textContent('.aviso--ok'));
  ok('el foco vuelve al buscador', await page.evaluate(() => document.activeElement?.id === 'busqueda'));

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
  ok('búsqueda "taj" encuentra por marca', /CLASICO.*TAJIN · 142g.*633148100013.*\$4\.99\+Tx.*erie, talbot.*Activo/.test(filaTexto.replace(/\s+/g, ' ')), filaTexto.replace(/\s+/g, ' ').trim());
  await page.press('#busqueda', 'ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog#editor[open]');
  ok('flecha abajo + Enter abre el producto en edición', /TAJIN CLASICO/.test(await page.textContent('#editor-titulo')));
  await page.waitForFunction(() => /Sin cambios de precio/.test(document.getElementById('historial').textContent), null, { timeout: 15000 });
  ok('historial vacío al inicio', true);

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
  ok('el historial muestra el cambio de precio con el usuario', /\$4\.99 → \$5\.49 · Alan \(admin\) \(admin@aguila\.test\)/.test(textoHistorial), textoHistorial.trim());
  const meta = await page.textContent('#meta');
  ok('meta muestra creado/actualizado y etiqueta nunca impresa', /Creado:.*Actualizado:.*admin@aguila\.test.*nunca impresa/.test(meta.replace(/\s+/g, ' ')));
  await page.screenshot({ path: `${OUT}/e2e-editor-edicion.png` });

  // guardar sin cambios
  await page.press('#f-nombre', 'Enter');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  ok('guardar sin cambios cierra y avisa "Sin cambios"', /Sin cambios/.test(await page.textContent('.avisos')));

  // verificación en Firestore vía REST
  const productosRest = await rest('GET', 'products');
  const tajin = productosRest.documents.find((d) => d.fields.nombre.stringValue === 'CLASICO');
  ok('Firestore: precio 549 y tokens de búsqueda', tajin.fields.precioCentavos.integerValue === '549' && tajin.fields.tokensBusqueda.arrayValue.values.some((v) => v.stringValue === 'tajin'));
  const historialRest = await rest('GET', 'priceHistory');
  const entrada = historialRest.documents?.[0];
  ok('Firestore: entrada de historial 499→549 con id producto_ms', !!entrada && entrada.fields.precioAnteriorCentavos.integerValue === '499' && entrada.fields.precioNuevoCentavos.integerValue === '549' && entrada.name.endsWith(`${tajin.name.split('/').pop()}_${new Date(entrada.fields.fecha.timestampValue).getTime()}`));

  // UPC duplicado
  await page.keyboard.press('Alt+n');
  await page.waitForSelector('dialog#editor[open]');
  await page.fill('#f-upc', '633148100013');
  await page.fill('#f-nombre', 'REPETIDO');
  await page.fill('#f-precio', '1.00');
  await page.press('#f-precio', 'Enter');
  await page.waitForSelector('#editor-aviso:not([hidden])');
  ok('UPC duplicado se rechaza antes de escribir', /ya pertenece a «TAJIN CLASICO»/.test(await page.textContent('#editor-aviso')), await page.textContent('#editor-aviso'));
  await page.fill('#f-nombre', ''); await page.fill('#f-upc', ''); await page.fill('#f-precio', '');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });

  // desactivar / ver inactivos / reactivar
  await page.fill('#busqueda', 'chile');
  await page.waitForFunction(() => { const filas = document.querySelectorAll('#resultados tr'); return filas.length === 1 && /CHILE/.test(filas[0].textContent); });
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  ok('con un solo resultado, Enter lo abre directamente', /CHILE GUAJILLO/.test(await page.textContent('#editor-titulo')));
  await page.click('#btn-desactivar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 0);
  ok('desactivado desaparece de la lista', true);
  await page.check('#ver-inactivos');
  await page.waitForFunction(() => document.querySelectorAll('#resultados tr').length === 1);
  ok('"Ver inactivos" lo muestra como Inactivo', /Inactivo/.test(await page.textContent('#resultados tr')));
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  ok('el botón ofrece reactivar', (await page.textContent('#btn-desactivar')).includes('Reactivar'));
  await page.click('#btn-desactivar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 15000 });
  await page.waitForFunction(() => /Activo/.test(document.querySelector('#resultados tr')?.textContent ?? ''));
  ok('reactivado vuelve a Activo', true);

  // escáner con dígito verificador incorrecto
  await page.fill('#busqueda', '633148100014');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#aviso-busqueda:not([hidden])');
  ok('UPC con verificador incorrecto se explica', /verificador/.test(await page.textContent('#aviso-busqueda')), await page.textContent('#aviso-busqueda'));

  // escáner con UPC conocido abre directo
  await page.fill('#busqueda', '633148100013');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('dialog#editor[open]');
  ok('UPC conocido abre el producto directamente', /TAJIN CLASICO/.test(await page.textContent('#editor-titulo')));
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
  ok('service worker activo con caché versionada', sw.activo && sw.claves.some((c) => c.startsWith('catalogo-aguila-')), JSON.stringify(sw.claves));
  ok('config.js no está en la caché; la cáscara sí', !sw.configEnCache && sw.esquemaEnCache && sw.vendorEnCache);
  const manifiesto = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  ok('manifest instalable', manifiesto.name === 'Catálogo Águila' && manifiesto.icons.length === 3);

  await page.screenshot({ path: `${OUT}/e2e-productos.png`, fullPage: true });
  await browser.close();
  console.log('\n=== productos ===');
  console.log(resultados.join('\n'));
  console.log('\nErrores de consola/página:', errores.length ? '\n' + errores.join('\n') : 'ninguno');
  process.exitCode = resultados.some((r) => r.startsWith('FALLO')) ? 1 : 0;
})().catch((e) => { console.error('EXCEPCIÓN', e); console.log('\n=== productos ===');
  console.log(resultados.join('\n')); process.exit(1); });
