/**
 * Teléfono (cámara falsa de Chromium con un código real):
 * - el personal consulta precios en caja/consulta.html: escanea con la cámara
 *   (UPC-A, EAN-13 y un código que no está) o busca por nombre;
 * - el administrador usa el back office en el teléfono: menú plegable,
 *   resultados como tarjetas, ficha al tocar, editor, escáner y alta de un
 *   producto desde un código que no está, que la consulta encuentra enseguida.
 */
const path = require('node:path');
const c = require('./comun.cjs');
const { generarVideoUPC, argumentosCamaraFalsa } = require('./camara-falsa.cjs');

/** La empleada abre la consulta de precios en el teléfono y entra con su código y NIP. */
async function abrirConsulta(browser) {
  const sesion = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] });
  await c.entrarConsulta(sesion.page, c.EMPLEADA.correo, c.EMPLEADA.nip);
  await sesion.page.waitForFunction(() => /Catálogo al día/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  return sesion;
}

/** Escanea con la cámara en la consulta: espera a que el escáner lea y se cierre, y devuelve lo que muestra. */
async function escanearEnConsulta(page, captura = null) {
  await page.click('#btn-camara');
  await page.waitForSelector('#escaner[open]');
  if (captura) await page.screenshot({ path: `${c.SALIDA}/${captura}` });
  await page.waitForFunction(() => !document.getElementById('escaner').open
    && (!document.getElementById('tarjeta').hidden || !document.getElementById('no-encontrado').hidden), null, { timeout: 30000 });
  return { ...(await c.tarjetaConsulta(page)), leido: await page.inputValue('#buscar') };
}

/** El administrador entra al back office en el teléfono y abre Productos. */
async function abrirProductosAdmin(browser) {
  const sesion = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] });
  await c.entrar(sesion.page, c.ADMIN.correo, c.ADMIN.contrasena);
  await sesion.page.goto(`${c.BASE}/productos.html`);
  await sesion.page.waitForSelector('#contenido:not([hidden])');
  await sesion.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  return sesion;
}

(async () => {
  const v = c.verificador('movil');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarEmpleadaCodigo();
  await c.sembrarCatalogoDemo();
  await c.sembrarProducto('p-valentina', { upc: '7501234567893', nombre: 'SALSA PICANTE', marca: 'VALENTINA', presentacion: '370mL', precioCentavos: 349, tiendas: ['talbot', 'erie'], tokensBusqueda: c.tokens('SALSA PICANTE', 'VALENTINA') });
  const erroresTotales = [];

  // videos para la cámara falsa: un UPC del catálogo, otro que no existe y un EAN-13
  const generador = await c.abrirNavegador();
  const videoTajin = await generarVideoUPC(generador, '633148100013', path.join(c.SALIDA, 'camara-tajin.y4m'));
  const videoNuevo = await generarVideoUPC(generador, '036000291452', path.join(c.SALIDA, 'camara-nuevo.y4m'));
  const videoEAN = await generarVideoUPC(generador, '7501234567893', path.join(c.SALIDA, 'camara-ean13.y4m'));
  await generador.close();

  // ---- 1) teléfono con la cámara apuntando a TAJIN
  let browser = await c.abrirNavegador({ args: argumentosCamaraFalsa(videoTajin) });

  // la empleada consulta precios
  let empleada = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] });
  await empleada.page.goto(`${c.BASE}/caja/consulta.html`);
  await empleada.page.waitForSelector('#form-acceso:not([hidden])');
  await empleada.page.screenshot({ path: `${c.SALIDA}/movil-consulta-acceso.png` });
  const nombre = await c.entrarConsulta(empleada.page, c.EMPLEADA.correo, c.EMPLEADA.nip);
  v.ok('la empleada entra a la consulta de precios con su correo y NIP', nombre === c.EMPLEADA.nombre, nombre);
  await empleada.page.waitForFunction(() => /Catálogo al día/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('el buscador no roba el foco en el teléfono (no salta el teclado)', await empleada.page.evaluate(() => document.activeElement?.id !== 'buscar'));
  v.ok('el botón Escanear aparece porque hay cámara', await empleada.page.isVisible('#btn-camara'));
  let tarjeta = await escanearEnConsulta(empleada.page, 'movil-consulta-escaner.png');
  v.ok('la cámara lee el UPC y muestra el precio grande, con impuesto y código', tarjeta.nombre === 'TAJIN CLASICO' && tarjeta.precio === '$4.99' && tarjeta.unidad === 'c/u' && /^\+Tx/.test(tarjeta.fiscal) && /633148100013 · UPC-A/.test(tarjeta.datos) && !tarjeta.inactivo && tarjeta.leido === '633148100013', JSON.stringify(tarjeta));
  v.ok('la cámara se apaga al cerrar el escáner', await empleada.page.evaluate(() => document.getElementById('escaner-video').srcObject === null));
  v.ok('no hay desplazamiento horizontal', await empleada.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await empleada.page.screenshot({ path: `${c.SALIDA}/movil-consulta-precio.png` });
  await empleada.page.fill('#buscar', 'guaj');
  await empleada.page.waitForSelector('#resultados button');
  const lista = await empleada.page.$$eval('#resultados button', (botones) => botones.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
  v.ok('con dos letras o más, la búsqueda por nombre lista los productos con su precio', lista.length === 1 && /CHILE GUAJILLO.*\$10\.99\/kg/.test(lista[0]) && await empleada.page.isHidden('#tarjeta'), lista.join(' | '));
  await empleada.page.screenshot({ path: `${c.SALIDA}/movil-consulta-lista.png` });
  await empleada.page.click('#resultados button:has-text("CHILE GUAJILLO")');
  await empleada.page.waitForSelector('#tarjeta:not([hidden])');
  tarjeta = await c.tarjetaConsulta(empleada.page);
  v.ok('tocar un resultado muestra su precio: por kilo y sin impuesto', tarjeta.nombre === 'CHILE GUAJILLO' && tarjeta.precio === '$10.99' && tarjeta.unidad === 'por kg' && tarjeta.fiscal === 'Sin impuesto' && /Etiqueta de referencia\s*\$5\.00/.test(tarjeta.datos), JSON.stringify(tarjeta));
  // si el admin cambia el precio mientras la ficha está en pantalla, la ficha se actualiza sola (sin volver a listar)
  await c.rest('PATCH', 'products/p-chile?updateMask.fieldPaths=precioPorKgCentavos', c.campos({ precioPorKgCentavos: 1199 }));
  const actualizada = await empleada.page.waitForFunction(() => document.getElementById('t-precio').textContent === '$11.99', null, { timeout: 15000 }).then(() => true).catch(() => false);
  v.ok('la ficha en pantalla se actualiza cuando cambia el precio, sin reaparecer la lista', actualizada && (await empleada.page.$$('#resultados li')).length === 0, await empleada.page.textContent('#t-precio'));
  erroresTotales.push(...empleada.errores);
  await empleada.ctx.close();

  // el administrador, en el back office desde el teléfono
  let admin = await c.nuevaPagina(browser, { movil: true, permissions: ['camera'] });
  await admin.page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await admin.page.screenshot({ path: `${c.SALIDA}/movil-login.png` });
  await c.entrar(admin.page, c.ADMIN.correo, c.ADMIN.contrasena);
  v.ok('el menú móvil del back office está plegado y el botón de menú visible', await admin.page.isVisible('.menu-boton') && await admin.page.isHidden('#panel-navegacion'));
  await admin.page.click('.menu-boton');
  v.ok('el botón despliega secciones, la caja y el usuario', await admin.page.isVisible('#panel-navegacion') && (await admin.page.getAttribute('.menu-boton', 'aria-expanded')) === 'true'
    && await admin.page.isVisible('nav a[href$="productos.html"]') && await admin.page.isVisible('.nav-caja') && /Alan \(admin\)/.test(await admin.page.textContent('.usuario__nombre')));
  await admin.page.screenshot({ path: `${c.SALIDA}/movil-menu.png` });
  await admin.page.keyboard.press('Escape');
  v.ok('Escape lo pliega', await admin.page.isHidden('#panel-navegacion') && (await admin.page.getAttribute('.menu-boton', 'aria-expanded')) === 'false');

  await admin.page.goto(`${c.BASE}/productos.html`);
  await admin.page.waitForSelector('#contenido:not([hidden])');
  await admin.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  let page = admin.page;
  v.ok('en Productos el buscador no roba el foco en el teléfono', await page.evaluate(() => document.activeElement?.id !== 'busqueda'));
  v.ok('el botón Escanear aparece porque hay cámara', await page.isVisible('#btn-escanear'));
  v.ok('los resultados se muestran como tarjetas (cuadrícula) sin cabecera de tabla', await page.$eval('#resultados tr', (tr) => getComputedStyle(tr).display === 'grid') && await page.$eval('.tabla--resultados thead', (th) => getComputedStyle(th).display === 'none'));
  v.ok('no hay desplazamiento horizontal en Productos', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${c.SALIDA}/movil-productos.png`, fullPage: true });

  await page.click('#resultados tr:has-text("CLASICO")');
  await page.waitForSelector('#detalle[open]');
  const detalle = c.texto(await page.innerText('#detalle'));
  v.ok('tocar un producto abre la ficha de consulta con precio grande, impuesto, UPC, tiendas y etiqueta', /CLASICO.*\$4\.99.*\+Tx.*Código\s*633148100013 · UPC-A.*Águila Talbot, Águila Erie/.test(detalle) && (await page.$$('#detalle-etiqueta .etiqueta')).length === 1, detalle.slice(0, 200));
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
  v.ok('la cámara del back office se apaga al cerrar el escáner', await page.evaluate(() => document.getElementById('escaner-video').srcObject === null));
  await page.screenshot({ path: `${c.SALIDA}/movil-detalle-escaneado.png` });
  await page.click('#detalle-escanear');
  await page.waitForSelector('#escaner[open]');
  await page.waitForSelector('#detalle[open]', { timeout: 30000 });
  v.ok('«Escanear otro» vuelve a leer', /CLASICO/.test(await page.textContent('#detalle-titulo')));
  await page.click('#detalle-cerrar');
  erroresTotales.push(...admin.errores);
  await admin.ctx.close();
  await browser.close();

  // ---- 2) teléfono con la cámara apuntando a un UPC que no está en el catálogo
  browser = await c.abrirNavegador({ args: argumentosCamaraFalsa(videoNuevo) });
  empleada = await abrirConsulta(browser);
  tarjeta = await escanearEnConsulta(empleada.page);
  v.ok('en la consulta, un UPC desconocido dice que no está y que se avise al administrador', /036000291452/.test(tarjeta.noEncontrado ?? '') && /Avisa al administrador/.test(tarjeta.noEncontrado ?? ''), JSON.stringify(tarjeta));
  await empleada.page.screenshot({ path: `${c.SALIDA}/movil-consulta-no-encontrado.png` });

  admin = await abrirProductosAdmin(browser);
  page = admin.page;
  await page.click('#btn-escanear');
  await page.waitForSelector('#escaner-oferta:not([hidden])', { timeout: 30000 });
  v.ok('en el back office, un UPC desconocido ofrece crear el producto', /036000291452/.test(await page.textContent('#escaner-oferta-texto')));
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
  v.ok('el producto creado desde el teléfono queda firmado por el administrador', creado?.nombre === 'MANGO' && creado.actualizadoPor === c.ADMIN.correo, JSON.stringify(creado && { nombre: creado.nombre, por: creado.actualizadoPor }));
  erroresTotales.push(...admin.errores);
  await admin.ctx.close();

  await empleada.page.waitForFunction(() => /· 6 productos/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  tarjeta = await escanearEnConsulta(empleada.page);
  v.ok('la consulta de la empleada encuentra enseguida el producto que el admin acaba de crear', tarjeta.nombre === 'JUMEX MANGO' && tarjeta.precio === '$1.99', JSON.stringify(tarjeta));
  erroresTotales.push(...empleada.errores);
  await empleada.ctx.close();
  await browser.close();

  // ---- 3) teléfono con la cámara apuntando a un EAN-13 (producto mexicano, prefijo 750)
  browser = await c.abrirNavegador({ args: argumentosCamaraFalsa(videoEAN) });
  empleada = await abrirConsulta(browser);
  tarjeta = await escanearEnConsulta(empleada.page);
  v.ok('la consulta lee un EAN-13 (750…) y muestra su precio', tarjeta.nombre === 'VALENTINA SALSA PICANTE' && tarjeta.precio === '$3.49' && /7501234567893 · EAN-13/.test(tarjeta.datos), JSON.stringify(tarjeta));
  erroresTotales.push(...empleada.errores);
  await empleada.ctx.close();

  admin = await abrirProductosAdmin(browser);
  page = admin.page;
  await page.click('#btn-escanear');
  await page.waitForSelector('#detalle[open]', { timeout: 30000 });
  const detalleEAN = c.texto(await page.innerText('#detalle'));
  v.ok('en el back office la cámara lee el EAN-13 y abre su ficha; la etiqueta lleva código de barras EAN-13', /SALSA PICANTE.*\$3\.49.*7501234567893 · EAN-13/.test(detalleEAN) && (await page.$$('#detalle-etiqueta svg.ean13')).length === 1, detalleEAN.slice(0, 160));
  await page.screenshot({ path: `${c.SALIDA}/movil-detalle-ean13.png` });
  erroresTotales.push(...admin.errores);
  await admin.ctx.close();
  await browser.close();

  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
