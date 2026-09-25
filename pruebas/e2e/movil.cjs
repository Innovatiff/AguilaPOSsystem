/**
 * Teléfono: menú plegable, resultados como tarjetas, ficha de consulta al
 * tocar, y escáner con la cámara (cámara falsa de Chromium con un UPC real).
 */
const path = require('node:path');
const c = require('./comun.cjs');
const { generarVideoUPC, argumentosCamaraFalsa } = require('./camara-falsa.cjs');

(async () => {
  const v = c.verificador('movil');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarEmpleadaCodigo();
  await c.sembrarCatalogoDemo();
  const erroresTotales = [];

  // videos para la cámara falsa: un UPC del catálogo y otro que no existe
  const generador = await c.abrirNavegador();
  const videoTajin = await generarVideoUPC(generador, '633148100013', path.join(c.SALIDA, 'camara-tajin.y4m'));
  const videoNuevo = await generarVideoUPC(generador, '036000291452', path.join(c.SALIDA, 'camara-nuevo.y4m'));
  await generador.close();

  // ---- 1) teléfono con la cámara apuntando a TAJIN
  let browser = await c.abrirNavegador({ args: argumentosCamaraFalsa(videoTajin) });
  let { ctx, page, errores } = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] });
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${c.SALIDA}/movil-login.png` });
  await c.entrar(page, c.EMPLEADA.codigo, c.EMPLEADA.nip);
  v.ok('el menú móvil está plegado y el botón de menú visible', await page.isVisible('.menu-boton') && await page.isHidden('#panel-navegacion'));
  await page.click('.menu-boton');
  v.ok('el botón despliega secciones y usuario', await page.isVisible('#panel-navegacion') && (await page.getAttribute('.menu-boton', 'aria-expanded')) === 'true');
  await page.screenshot({ path: `${c.SALIDA}/movil-menu.png` });
  await page.keyboard.press('Escape');
  v.ok('Escape lo pliega', await page.isHidden('#panel-navegacion'));

  await page.goto(`${c.BASE}/productos.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('el buscador no roba el foco en el teléfono (no salta el teclado)', await page.evaluate(() => document.activeElement?.id !== 'busqueda'));
  v.ok('el botón Escanear aparece porque hay cámara', await page.isVisible('#btn-escanear'));
  v.ok('los resultados se muestran como tarjetas (cuadrícula) sin cabecera de tabla', await page.$eval('#resultados tr', (tr) => getComputedStyle(tr).display === 'grid') && await page.$eval('.tabla--resultados thead', (th) => getComputedStyle(th).display === 'none'));
  v.ok('no hay desplazamiento horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${c.SALIDA}/movil-productos.png`, fullPage: true });

  await page.click('#resultados tr:has-text("CLASICO")');
  await page.waitForSelector('#detalle[open]');
  const detalle = c.texto(await page.innerText('#detalle'));
  v.ok('tocar un producto abre la ficha de consulta con precio grande, impuesto, UPC, tiendas y etiqueta', /CLASICO.*\$4\.99.*\+Tx.*UPC\s*633148100013.*Águila Talbot, Águila Erie/.test(detalle) && (await page.$$('#detalle-etiqueta .etiqueta')).length === 1, detalle.slice(0, 200));
  v.ok('la ficha no muestra el aviso de inactivo para un producto activo', !/Producto inactivo/.test(detalle));
  v.ok('la ficha ocupa toda la pantalla del teléfono', await page.$eval('#detalle', (d) => Math.round(d.getBoundingClientRect().width) === window.innerWidth));
  v.ok('la ficha avisa que la etiqueta está pendiente (nunca impresa)', /nunca se ha impreso/.test(detalle));
  await page.screenshot({ path: `${c.SALIDA}/movil-detalle.png` });
  await page.click('#detalle-editar');
  await page.waitForSelector('#editor[open]');
  v.ok('Editar abre el editor con los datos del producto', (await page.inputValue('#f-nombre')) === 'CLASICO' && !(await page.evaluate(() => document.getElementById('detalle').open)));
  await page.screenshot({ path: `${c.SALIDA}/movil-editor.png` });
  await page.click('#btn-cerrar');
  await page.waitForFunction(() => !document.getElementById('editor').open);

  await page.click('#btn-escanear');
  await page.waitForSelector('#escaner[open]');
  await page.screenshot({ path: `${c.SALIDA}/movil-escaner.png` });
  await page.waitForSelector('#detalle[open]', { timeout: 30000 });
  v.ok('el escáner lee el UPC de la cámara y abre la ficha del producto', /CLASICO/.test(await page.textContent('#detalle-titulo')) && !(await page.evaluate(() => document.getElementById('escaner').open)));
  v.ok('la ficha abierta desde el escáner ofrece «Escanear otro»', await page.isVisible('#detalle-escanear'));
  v.ok('la cámara se apaga al cerrar el escáner', await page.evaluate(() => document.getElementById('escaner-video').srcObject === null));
  await page.screenshot({ path: `${c.SALIDA}/movil-detalle-escaneado.png` });
  await page.click('#detalle-escanear');
  await page.waitForSelector('#escaner[open]');
  await page.waitForSelector('#detalle[open]', { timeout: 30000 });
  v.ok('«Escanear otro» vuelve a leer', /CLASICO/.test(await page.textContent('#detalle-titulo')));
  await page.click('#detalle-cerrar');
  erroresTotales.push(...errores);
  await ctx.close();
  await browser.close();

  // ---- 2) teléfono con la cámara apuntando a un UPC que no está en el catálogo
  browser = await c.abrirNavegador({ args: argumentosCamaraFalsa(videoNuevo) });
  ({ ctx, page, errores } = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] }));
  await c.entrar(page, c.EMPLEADA.codigo, c.EMPLEADA.nip);
  await page.goto(`${c.BASE}/productos.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.click('#btn-escanear');
  await page.waitForSelector('#escaner-oferta:not([hidden])', { timeout: 30000 });
  v.ok('un UPC desconocido ofrece crear el producto', /036000291452/.test(await page.textContent('#escaner-oferta-texto')));
  await page.screenshot({ path: `${c.SALIDA}/movil-escaner-nuevo.png` });
  await page.click('#escaner-crear');
  await page.waitForSelector('#editor[open]');
  v.ok('«Crear producto» abre el editor con el UPC ya puesto', (await page.inputValue('#f-upc')) === '036000291452' && /036000291452/.test(await page.textContent('#editor-titulo')));
  await page.fill('#f-nombre', 'MANGO');
  await page.fill('#f-marca', 'JUMEX');
  await page.fill('#f-precio', '1.99');
  await page.click('#btn-guardar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  let creado = null;
  for (let i = 0; i < 20 && !creado; i += 1) { const todos = await c.leerColeccion('products'); creado = [...todos.values()].find((p) => p.upc === '036000291452') ?? null; if (!creado) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('el producto creado desde el teléfono queda firmado con el código de la empleada', creado?.nombre === 'MANGO' && creado.actualizadoPor === '1023', JSON.stringify(creado && { nombre: creado.nombre, por: creado.actualizadoPor }));
  erroresTotales.push(...errores);
  await ctx.close();
  await browser.close();

  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
