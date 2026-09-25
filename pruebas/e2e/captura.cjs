const { chromium } = require('playwright');
const c = require('./comun.cjs');
const OUT = c.SALIDA;
const BASE = 'http://127.0.0.1:5500';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-aguilapos/databases/(default)/documents';
const resultados = [];
const ok = (nombre, cond, extra = '') => resultados.push(`${cond ? 'ok  ' : 'FALLO'} ${nombre}${extra ? ' — ' + extra : ''}`);
const rest = (metodo, ruta, cuerpo) => fetch(`${FS}/${ruta}`, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined }).then((r) => r.json());
function valor(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  throw new Error('tipo');
}
const campos = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, valor(v)])) });
const producto = (extra) => ({ upc: null, plu: null, nombre: 'X', marca: null, descriptor: null, presentacion: '', precioCentavos: 100, unidadVenta: 'pieza', precioPorKgCentavos: null, claseFiscal: 'gravado', tiendas: [], existencias: null, costoCentavos: null, proveedor: null, activo: true, ultimoPrecioImpresoCentavos: null, fechaUltimaImpresion: null, tokensBusqueda: [], creadoEn: new Date(), actualizadoEn: new Date(), actualizadoPor: 'admin@aguila.test', ...extra });
const leerDoc = async (id) => (await rest('GET', `products/${id}`)).fields;
const listaStr = (campo) => (campo?.arrayValue?.values ?? []).map((v) => v.stringValue);

async function sembrar() {
  await c.borrarTodo();
  await c.sembrarAdmin();
  await rest('PATCH', 'stores/talbot', campos({ nombre: 'Águila Talbot', direccion: '', activo: true }));
  await rest('PATCH', 'stores/erie', campos({ nombre: 'Águila Erie', direccion: '', activo: true }));
  await rest('PATCH', 'products/p-tajin', campos(producto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, tiendas: ['talbot'] })));
  await rest('PATCH', 'products/p-jumex', campos(producto({ upc: '036000291452', nombre: 'MANGO', marca: 'JUMEX', presentacion: '335mL', precioCentavos: 199, tiendas: ['erie'], activo: false })));
}

(async () => {
  await sembrar();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errores.push(`[console] ${m.text().slice(0, 160)}`); });
  const escribir = async (sel, texto) => { await page.fill(sel, texto); await page.press(sel, 'Enter'); };
  const activo = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.value || document.activeElement?.tagName);
  // El guardado no espera al servidor: antes de leer por REST hay que esperar la confirmación (✓) en la bitácora.
  const confirmadas = (n) => page.waitForFunction((n) => document.querySelectorAll('#bitacora .estado--ok').length >= n && document.querySelectorAll('#bitacora .estado--error').length === 0, n, { timeout: 15000 });

  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', 'admin@aguila.test'); await page.fill('#secreto', 'Prueba1234'); await page.press('#secreto', 'Enter');
  await page.waitForURL(/index\.html/);
  await page.click('nav a[href$="captura.html"]');
  await page.waitForURL(/captura\.html/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#tienda option').length === 2);
  ok('el UPC tiene el foco al entrar', (await activo()) === 'c-upc');
  await page.selectOption('#tienda', 'erie');
  ok('la tienda se recuerda en el equipo', (await page.evaluate(() => localStorage.getItem('captura.tienda'))) === 'erie');
  await page.focus('#c-upc');

  // 1) producto nuevo, precio con sufijo +
  await escribir('#c-upc', '049000006346');
  ok('UPC nuevo: pasa al nombre', (await activo()) === 'c-nombre' && /nuevo/.test(await page.textContent('#banner')));
  await escribir('#c-nombre', 'COCA COLA');
  await page.waitForFunction(() => document.activeElement?.id === 'c-marca');
  await escribir('#c-marca', 'COCA-COLA');
  await page.waitForFunction(() => document.activeElement?.id === 'c-presentacion');
  await escribir('#c-presentacion', '355mL');
  await page.waitForFunction(() => document.activeElement?.id === 'c-precio');
  await escribir('#c-precio', '1.99+');
  await page.waitForFunction(() => document.getElementById('contador').textContent === '1');
  ok('"1.99+" y Enter guardan directo: contador 1, foco de vuelta en el UPC, formulario limpio', (await activo()) === 'c-upc' && (await page.inputValue('#c-nombre')) === '' && (await page.inputValue('#c-upc')) === '');
  await page.waitForFunction(() => document.querySelector('#bitacora .estado--ok'), null, { timeout: 15000 });
  const fila1 = await page.textContent('#bitacora li');
  ok('la bitácora confirma el guardado con tienda', /COCA-COLA COCA COLA · \$1\.99\+Tx.*Creado · Águila Erie/.test(fila1.replace(/\s+/g, ' ')), fila1.replace(/\s+/g, ' ').trim());
  const productos = await rest('GET', 'products');
  const coca = productos.documents.find((d) => d.fields.upc?.stringValue === '049000006346');
  ok('Firestore: COCA COLA con tienda erie, gravado, 199 centavos y tokens', !!coca && listaStr(coca.fields.tiendas).join() === 'erie' && coca.fields.claseFiscal.stringValue === 'gravado' && coca.fields.precioCentavos.integerValue === '199' && listaStr(coca.fields.tokensBusqueda).includes('coca'));

  // 2) existente en otra tienda: Enter agrega
  await escribir('#c-upc', '633148100013');
  ok('existente fuera de esta tienda: ofrece agregar', /no en Águila Erie. Enter: agregar/.test(await page.textContent('#banner')));
  await page.press('#c-upc', 'Enter');
  await page.waitForFunction(() => /Agregado a Águila Erie/.test(document.getElementById('bitacora').textContent));
  await confirmadas(2);
  const tajin = await leerDoc('p-tajin');
  ok('Firestore: TAJIN ahora en talbot y erie', listaStr(tajin.tiendas).sort().join() === 'erie,talbot');

  // 3) existente ya en la tienda: Enter siguiente
  await escribir('#c-upc', '633148100013');
  ok('ya está en esta tienda: Enter siguiente', /Ya está:.*en Águila Erie. Enter: siguiente/.test(await page.textContent('#banner')));
  await page.press('#c-upc', 'Enter');
  ok('y limpia el UPC', (await page.inputValue('#c-upc')) === '' && (await activo()) === 'c-upc');

  // 4) inactivo: Enter reactiva
  await escribir('#c-upc', '036000291452');
  ok('inactivo: ofrece reactivar', /INACTIVO. Enter: reactivar/.test(await page.textContent('#banner')));
  await page.press('#c-upc', 'Enter');
  await page.waitForFunction(() => /Reactivado/.test(document.getElementById('bitacora').textContent));
  await confirmadas(3);
  const jumex = await leerDoc('p-jumex');
  ok('Firestore: JUMEX reactivado', jumex.activo.booleanValue === true && listaStr(jumex.tiendas).includes('erie'));

  // 5) sin código, tasa cero con sufijo c
  await page.press('#c-upc', 'Enter');
  ok('Enter sin código pasa al nombre', (await activo()) === 'c-nombre' && /sin código/.test(await page.textContent('#banner')));
  await escribir('#c-nombre', 'CHILE GUAJILLO');
  await page.waitForFunction(() => document.activeElement?.id === 'c-marca');
  await page.press('#c-marca', 'Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'c-presentacion');
  await page.press('#c-presentacion', 'Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'c-precio');
  await escribir('#c-precio', '5.00c');
  await page.waitForFunction(() => document.getElementById('contador').textContent === '2');
  ok('sin UPC guardado como tasa cero; la clase queda pegajosa en tasa cero', (await page.isChecked('input[name="clase"][value="tasaCero"]')));
  await confirmadas(4);
  const chile = (await rest('GET', 'products')).documents.find((d) => d.fields.nombre.stringValue === 'CHILE GUAJILLO');
  ok('Firestore: CHILE sin UPC, tasaCero, 500', chile.fields.upc.nullValue === null && chile.fields.claseFiscal.stringValue === 'tasaCero' && chile.fields.precioCentavos.integerValue === '500');

  // 6) precio sin sufijo: pasa a la clase; G elige gravado; Enter guarda
  await escribir('#c-upc', '012000001291');
  await escribir('#c-nombre', 'PEPSI');
  await page.waitForFunction(() => document.activeElement?.id === 'c-marca');
  await page.press('#c-marca', 'Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'c-presentacion');
  await page.press('#c-presentacion', 'Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'c-precio');
  await escribir('#c-precio', '1.89');
  ok('sin sufijo el foco pasa a la clase fiscal (la pegajosa: tasa cero)', (await activo()) === 'tasaCero');
  await page.keyboard.press('g');
  ok('G selecciona gravado', await page.isChecked('input[name="clase"][value="gravado"]'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('contador').textContent === '3');
  await confirmadas(5);
  const pepsi = (await rest('GET', 'products')).documents.find((d) => d.fields.upc?.stringValue === '012000001291');
  ok('Firestore: PEPSI gravado 189', pepsi.fields.claseFiscal.stringValue === 'gravado' && pepsi.fields.precioCentavos.integerValue === '189');

  // 7) precio inválido se queda en el campo; Esc limpia
  await escribir('#c-upc', '028400064057');
  await escribir('#c-nombre', 'PAPAS');
  await page.waitForFunction(() => document.activeElement?.id === 'c-marca');
  await page.press('#c-marca', 'Enter'); await page.waitForFunction(() => document.activeElement?.id === 'c-presentacion');
  await page.press('#c-presentacion', 'Enter'); await page.waitForFunction(() => document.activeElement?.id === 'c-precio');
  await escribir('#c-precio', 'abc');
  ok('precio inválido: mensaje y foco en precio', (await activo()) === 'c-precio' && /Precio no válido/.test(await page.textContent('#banner')));
  await page.keyboard.press('Escape');
  ok('Esc limpia y vuelve al UPC', (await page.inputValue('#c-nombre')) === '' && (await activo()) === 'c-upc');
  await page.screenshot({ path: `${OUT}/e2e-captura.png`, fullPage: true });

  // 8) F4 corrige el último (PEPSI): cambio de precio con historial
  await page.keyboard.press('F4');
  ok('F4 carga el último producto en modo corrección', /Corrigiendo «PEPSI»/.test(await page.textContent('#banner')) && (await page.inputValue('#c-precio')) === '1.89' && (await page.evaluate(() => document.getElementById('c-upc').readOnly)));
  await page.fill('#c-precio', '1.99');
  await page.press('#c-precio', 'Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Corregido \(precio con historial\)/.test(document.getElementById('bitacora').textContent));
  await page.waitForFunction(() => document.querySelectorAll('#bitacora .estado--ok').length >= 6, null, { timeout: 15000 });
  const pepsi2 = (await rest('GET', 'products')).documents.find((d) => d.fields.upc?.stringValue === '012000001291');
  const historial = await rest('GET', 'priceHistory');
  ok('Firestore: PEPSI 199 con entrada de historial 189→199', pepsi2.fields.precioCentavos.integerValue === '199' && (historial.documents ?? []).some((d) => d.fields.precioAnteriorCentavos.integerValue === '189' && d.fields.precioNuevoCentavos.integerValue === '199'));

  // 9) duplicado por UPC en el formulario (tecleado sin Enter en el UPC)
  await page.fill('#c-upc', '049000006346');
  await page.fill('#c-nombre', 'OTRA COCA');
  await page.fill('#c-precio', '2.00+');
  await page.press('#c-precio', 'Enter');
  ok('un UPC ya usado no crea un duplicado', /ya es de «COCA-COLA COCA COLA»/.test(await page.textContent('#banner')));
  await page.keyboard.press('Escape');

  ok('ninguna fila de la bitácora quedó en error', (await page.$$('#bitacora .estado--error')).length === 0);
  await page.screenshot({ path: `${OUT}/e2e-captura-final.png`, fullPage: true });
  await browser.close();
  console.log('\n=== captura ===');
  console.log(resultados.join('\n'));
  console.log('\nErrores de consola/página:', errores.length ? '\n' + errores.join('\n') : 'ninguno');
  process.exitCode = resultados.some((r) => r.startsWith('FALLO')) ? 1 : 0;
})().catch((e) => { console.error('EXCEPCIÓN', e); console.log('\n=== captura ===');
  console.log(resultados.join('\n')); process.exit(1); });
