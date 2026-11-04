/**
 * Utilidades compartidas por los escenarios de extremo a extremo (Playwright).
 *
 * Entorno (lo levanta ejecutar.sh): emuladores de Auth (9099) y Firestore
 * (8080) del proyecto demo-aguilapos, y el sitio servido en el puerto 5500
 * desde una copia con js/config.js apuntando a los emuladores.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const { chromium } = require('playwright');

const BASE = process.env.BASE_E2E ?? 'http://127.0.0.1:5500';
const PROYECTO = 'demo-aguilapos';
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROYECTO}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const SALIDA = path.join(__dirname, 'salida');
fs.mkdirSync(SALIDA, { recursive: true });

const DOMINIO_CODIGOS = 'codigo.aguilapos.firebaseapp.com'; // igual que js/identidad.js
const correoDeCodigo = (codigo, version = 1) => `${codigo}${version > 1 ? `.${version}` : ''}@${DOMINIO_CODIGOS}`;

const ADMIN = { correo: 'admin@aguila.test', contrasena: 'Prueba1234', nombre: 'Alan (admin)' };
const EMPLEADA = { codigo: '100123', nip: '482913', nombre: 'María López', tienda: 'talbot', correo: 'maria@aguila.test' };

/** Clave de caja fija de las pruebas (secretos/caja) y huella de un NIP con ella (igual que js/nip.js). */
const CLAVE_CAJA = Buffer.alloc(32, 7).toString('base64');
const huellaNip = (nip, clave = CLAVE_CAJA) => createHmac('sha256', Buffer.from(clave, 'base64')).update(`nip:${nip}`).digest('hex');

// ------------------------------------------------------------- Firestore REST (propietario, sin reglas)
function valor(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valor) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)])) } };
  throw new Error(`tipo no soportado: ${typeof v}`);
}
const campos = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, valor(v)])) });

function leerValor(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(leerValor);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, leerValor(x)]));
  return v;
}

async function rest(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${FIRESTORE}/${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  return texto ? JSON.parse(texto) : {};
}

/** Documento como objeto JS (o null si no existe). */
async function leerDoc(ruta) {
  const d = await rest('GET', ruta);
  if (!d.fields) return null;
  return Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, leerValor(v)]));
}

/** Documentos de una colección: Map id → objeto. */
async function leerColeccion(nombre) {
  const r = await rest('GET', `${nombre}?pageSize=300`);
  const mapa = new Map();
  for (const d of r.documents ?? []) mapa.set(d.name.split('/').pop(), Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, leerValor(v)])));
  return mapa;
}

/** Deja los dos emuladores vacíos: cada escenario parte de cero. */
async function borrarTodo() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROYECTO}/accounts`, { method: 'DELETE' });
}

// ------------------------------------------------------------- Auth REST
async function crearCuentaAuth(email, password) {
  const r = await fetch(`${AUTH}/accounts:signUp?key=demo-clave`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return r.json();
}

/** Inicio de sesión por REST: sirve para comprobar que una cuenta y su NIP existen. */
async function entrarAuthREST(email, password) {
  const r = await fetch(`${AUTH}/accounts:signInWithPassword?key=demo-clave`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { ok: r.ok, ...(await r.json()) };
}

// ------------------------------------------------------------- semillas
const AHORA = new Date('2026-09-20T12:00:00Z');

/** Ficha completa de staff/{usuario} (mismo esquema que js/identidad.js). */
function ficha({ usuario, tipo, nombre, rol = 'empleado', activo = true, tienda = null, cuentaVersion = 1, por = ADMIN.correo, correo = null, catalogo = false }) {
  const tipoReal = tipo ?? (/^[0-9]+$/.test(usuario) ? 'codigo' : 'correo');
  return {
    usuario, tipo: tipoReal, correoAuth: tipoReal === 'codigo' ? correoDeCodigo(usuario, cuentaVersion) : usuario,
    nombre, rol, activo, tienda, creadoEn: AHORA, actualizadoEn: AHORA, actualizadoPor: por, cuentaVersion,
    correo: tipoReal === 'correo' ? usuario : correo, catalogo,
  };
}

/** secretos/caja con la clave fija de las pruebas (la cajas configuradas la guardan). */
async function sembrarClaveCaja() {
  await rest('PATCH', 'secretos/caja', campos({ clave: CLAVE_CAJA, creadaEn: AHORA, creadaPor: ADMIN.correo }));
}

async function sembrarAdmin() {
  await crearCuentaAuth(ADMIN.correo, ADMIN.contrasena);
  await rest('PATCH', `staff/${encodeURIComponent(ADMIN.correo)}`, campos(ficha({ usuario: ADMIN.correo, nombre: ADMIN.nombre, rol: 'admin' })));
}

/**
 * Colaborador completo, como lo deja Empleados: cuenta de su número con el NIP,
 * ficha (correo y permiso de catálogo), accesos, correos/{correo} y la huella
 * del NIP (nips/{huella}) para entrar solo con el NIP en la caja.
 */
async function sembrarEmpleadaCodigo({
  codigo = EMPLEADA.codigo, nip = EMPLEADA.nip, nombre = EMPLEADA.nombre, tienda = EMPLEADA.tienda, activo = true, cuentaVersion = 1,
  rol = 'empleado', correo = codigo === EMPLEADA.codigo ? EMPLEADA.correo : `${codigo}@aguila.test`, catalogo = false,
} = {}) {
  await crearCuentaAuth(correoDeCodigo(codigo, cuentaVersion), nip);
  await rest('PATCH', `staff/${codigo}`, campos(ficha({ usuario: codigo, nombre, tienda, activo, cuentaVersion, rol, correo, catalogo })));
  await rest('PATCH', `accesos/${codigo}`, campos({ version: cuentaVersion }));
  if (correo) await rest('PATCH', `correos/${encodeURIComponent(correo)}`, campos({ codigo }));
  await rest('PATCH', `nips/${huellaNip(nip)}`, campos({ codigo, version: cuentaVersion }));
}

async function sembrarTiendas() {
  await rest('PATCH', 'stores/talbot', campos({ nombre: 'Águila Talbot', direccion: '24 Talbot St W, Leamington', activo: true }));
  await rest('PATCH', 'stores/erie', campos({ nombre: 'Águila Erie', direccion: '', activo: true }));
}

/** Documento completo de un producto, con valores por defecto. */
function producto(extra = {}) {
  return {
    upc: null, plu: null, nombre: 'X', marca: null, descriptor: null, presentacion: '', precioCentavos: 100, unidadVenta: 'pieza',
    precioPorKgCentavos: null, claseFiscal: 'gravado', tiendas: [], existencias: null, costoCentavos: null, proveedor: null, activo: true,
    ultimoPrecioImpresoCentavos: null, fechaUltimaImpresion: null, tokensBusqueda: [], creadoEn: AHORA, actualizadoEn: AHORA, actualizadoPor: ADMIN.correo,
    ...extra,
  };
}

const sembrarProducto = (id, extra) => rest('PATCH', `products/${id}`, campos(producto(extra)));

/** Prefijos de búsqueda como los calcula js/esquema.js (para semillas realistas). */
function tokens(nombre, marca) {
  const salida = new Set();
  for (const palabra of `${nombre} ${marca ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean)) {
    for (let i = 3; i <= palabra.length; i += 1) salida.add(palabra.slice(0, i));
  }
  return [...salida];
}

/** Catálogo pequeño y realista: se usa en varios escenarios. */
async function sembrarCatalogoDemo() {
  await sembrarProducto('p-tajin', { upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, tiendas: ['talbot', 'erie'], tokensBusqueda: tokens('CLASICO', 'TAJIN') });
  await sembrarProducto('p-chile', { nombre: 'CHILE GUAJILLO', unidadVenta: 'peso', precioCentavos: 500, precioPorKgCentavos: 1099, claseFiscal: 'tasaCero', tiendas: ['talbot'], tokensBusqueda: tokens('CHILE GUAJILLO') });
  await sembrarProducto('p-coca', { upc: '049000006346', nombre: 'COCA COLA', marca: 'COCA-COLA', presentacion: '355mL', precioCentavos: 199, tiendas: ['talbot', 'erie'], tokensBusqueda: tokens('COCA COLA', 'COCA-COLA') });
  await sembrarProducto('p-maseca', { upc: '074734040014', nombre: 'HARINA DE MAIZ', marca: 'MASECA', presentacion: '1.8kg', precioCentavos: 549, claseFiscal: 'tasaCero', tiendas: ['talbot', 'erie'], ultimoPrecioImpresoCentavos: 549, fechaUltimaImpresion: '2026-09-20', tokensBusqueda: tokens('HARINA DE MAIZ', 'MASECA') });
}

// ------------------------------------------------------------- navegador
/**
 * Chromium de Playwright. Si el navegador que espera esta versión de Playwright
 * no está instalado pero el equipo trae otro Chromium (CHROMIUM_E2E, o el de
 * /opt/pw-browsers/chromium en los contenedores de CI), se usa ese.
 */
function ejecutableChromium() {
  if (process.env.CHROMIUM_E2E) return process.env.CHROMIUM_E2E;
  const propio = chromium.executablePath();
  if (propio && fs.existsSync(propio)) return null;
  return fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null;
}

async function abrirNavegador({ args = [] } = {}) {
  const ejecutable = ejecutableChromium();
  return chromium.launch(ejecutable ? { args, executablePath: ejecutable } : { args });
}

const MOVIL = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

/** Contexto + página con captura de errores de consola. `movil: true` emula un teléfono. */
async function nuevaPagina(browser, { movil = false, ...opciones } = {}) {
  const ctx = await browser.newContext(movil ? { ...MOVIL, ...opciones } : { viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2, ...opciones });
  const page = await ctx.newPage();
  const errores = [];
  // Respuestas 400 de Auth (credenciales malas a propósito) y la red cortada en las
  // pruebas sin conexión salen en la consola como "Failed to load resource": no son fallos.
  const BENIGNOS = /Failed to load resource|Could not reach Cloud Firestore backend|ERR_INTERNET_DISCONNECTED/;
  page.on('pageerror', (e) => errores.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !BENIGNOS.test(m.text())) errores.push(`[console] ${m.text().slice(0, 200)}`); });
  // Se aceptan todos; un prompt recibe page.respuestaPrompt (si la prueba la fija) o vacío.
  page.on('dialog', (d) => { console.log(`  [diálogo ${d.type()}] ${d.message()}`); d.accept(d.type() === 'prompt' ? (page.respuestaPrompt ?? '') : undefined); });
  return { ctx, page, errores };
}

/** Rellena el formulario de acceso y espera a salir de login.html (o a un mensaje si `esperarError`). */
async function entrar(page, identificador, secreto, { esperarError = false } = {}) {
  if (!/login\.html/.test(page.url())) await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', identificador);
  await page.fill('#secreto', secreto);
  await page.press('#secreto', 'Enter');
  if (esperarError) {
    await page.waitForSelector('#mensaje.mensaje--error', { timeout: 20000 });
    return (await page.textContent('#mensaje')).trim();
  }
  try {
    await page.waitForURL((url) => !/login\.html/.test(url.toString()), { timeout: 20000 });
  } catch (error) {
    const mensaje = await page.textContent('#mensaje').catch(() => '');
    throw new Error(`no se pudo entrar como ${identificador}: sigue en ${page.url()} · mensaje: «${String(mensaje).trim()}»`);
  }
  await page.waitForSelector('#contenido:not([hidden])', { timeout: 20000 });
  return page.url();
}

/**
 * Entra a la consulta de precios (caja/consulta.html: su propia sesión, aparte del back office)
 * con correo y NIP. Espera la vista de consulta y devuelve el nombre que muestra, o el mensaje de
 * error si `esperarError`.
 */
async function entrarConsulta(page, correo, nip, { esperarError = false } = {}) {
  const codigo = correo;
  if (!/\/caja\/consulta\.html/.test(page.url())) await page.goto(`${BASE}/caja/consulta.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#form-acceso:not([hidden])', { timeout: 20000 });
  await page.fill('#correo', correo);
  await page.fill('#nip', nip);
  await page.click('#btn-entrar');
  // Al entrar se oculta el formulario; si no, la consulta vacía el NIP y muestra el mensaje.
  await page.waitForFunction(() => !document.getElementById('vista-consulta').hidden
    || (document.getElementById('nip').value === '' && !document.getElementById('btn-entrar').disabled), null, { timeout: 20000 });
  const entro = await page.isVisible('#vista-consulta');
  const mensaje = entro ? '' : texto(await page.textContent('#mensaje-acceso'));
  if (esperarError) {
    if (entro) throw new Error(`${codigo} entró a la consulta de precios y se esperaba un error`);
    return mensaje;
  }
  if (!entro) throw new Error(`no se pudo entrar a la consulta de precios como ${codigo} · mensaje: «${mensaje}»`);
  return texto(await page.textContent('#usuario'));
}

/** Lo que muestra la consulta de precios: la tarjeta del producto, o el aviso de «no encontrado». */
function tarjetaConsulta(page) {
  return page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
    const visible = (id) => !document.getElementById(id).hidden;
    return visible('tarjeta')
      ? { nombre: t('t-nombre'), sub: t('t-sub'), precio: t('t-precio'), unidad: t('t-unidad'), fiscal: t('t-fiscal'), datos: t('t-datos'), inactivo: visible('t-inactivo') }
      : { noEncontrado: visible('no-encontrado') ? t('no-encontrado') : null };
  });
}

/**
 * Busca en la consulta de precios como el escáner USB (código o nombre, y Enter) una vez que el
 * catálogo está al día; devuelve la tarjeta o el aviso (ver tarjetaConsulta). Para búsquedas que
 * dan un solo producto o ninguno: con varios, la consulta solo lista los resultados.
 */
async function consultarPrecio(page, busqueda) {
  await page.waitForFunction(() => /Catálogo al día/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.fill('#buscar', busqueda); // al escribir se ocultan la tarjeta y el aviso anteriores
  await page.press('#buscar', 'Enter');
  await page.waitForFunction(() => !document.getElementById('tarjeta').hidden || !document.getElementById('no-encontrado').hidden, null, { timeout: 15000 });
  return tarjetaConsulta(page);
}

// ------------------------------------------------------------- resultados
function verificador(nombreEscenario) {
  const resultados = [];
  return {
    ok(nombre, condicion, extra = '') {
      resultados.push(`${condicion ? 'ok  ' : 'FALLO'} ${nombre}${extra ? ` — ${extra}` : ''}`);
    },
    terminar(errores = []) {
      console.log(`\n=== ${nombreEscenario} ===`);
      console.log(resultados.join('\n'));
      console.log(`Errores de consola/página: ${errores.length ? `\n${errores.join('\n')}` : 'ninguno'}`);
      const fallos = resultados.filter((r) => r.startsWith('FALLO')).length;
      console.log(`${resultados.length - fallos}/${resultados.length} comprobaciones correctas`);
      if (fallos > 0 || errores.length > 0) process.exitCode = 1;
    },
  };
}

const texto = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

module.exports = {
  BASE, SALIDA, ADMIN, EMPLEADA, DOMINIO_CODIGOS, correoDeCodigo, CLAVE_CAJA, huellaNip, sembrarClaveCaja,
  rest, campos, leerDoc, leerColeccion, borrarTodo, crearCuentaAuth, entrarAuthREST,
  ficha, sembrarAdmin, sembrarEmpleadaCodigo, sembrarTiendas, producto, sembrarProducto, sembrarCatalogoDemo, tokens,
  abrirNavegador, nuevaPagina, entrar, entrarConsulta, tarjetaConsulta, consultarPrecio, verificador, texto,
};
