/**
 * Acceso al back office, solo para administradores: correo + contraseña,
 * correo + NIP (y el código antiguo + NIP), la barra lateral, el personal que
 * no es administrador (se le manda a la caja, a la consulta de precios o a la
 * app Catálogo; el NIP lo cambia un administrador), cuentas no registradas,
 * desactivadas, fichas anteriores a Gestión y modo sin conexión.
 */
const c = require('./comun.cjs');

const SOLO_ADMIN = 'El back office es solo para administradores. Para vender, usa la caja; para ver un precio, la consulta de precios; para el catálogo, la app Catálogo.';
const SIN_REGISTRO = 'Esta cuenta no está registrada. Pide a un administrador que te dé de alta en el back office (Empleados).';
const SECCIONES = [
  'index.html', 'movimientos.html', 'transacciones.html', 'turnos.html', 'reportes.html',
  'productos.html', 'solicitudes.html', 'inventario.html', 'captura.html', 'imprimir.html', 'prueba-etiquetas.html', 'gestion/datos.html',
  'gestion/empleados.html', 'gestion/cajas.html', 'gestion/tiendas.html', 'gestion/configuracion.html',
];

/**
 * Sesión de la empleada en la instancia de Firebase del back office, como la que quedó guardada
 * en un navegador desde antes de que el back office fuera solo para administradores: login.html
 * ya no la deja abrir, así que se abre con el SDK de la propia página.
 */
async function sesionGuardadaDeEmpleada(page) {
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async ({ correo, nip }) => {
    const { auth, signInWithEmailAndPassword } = await import('./js/firebase.js');
    await signInWithEmailAndPassword(auth, correo, nip);
  }, { correo: c.correoDeCodigo(c.EMPLEADA.codigo), nip: c.EMPLEADA.nip });
}

(async () => {
  const v = c.verificador('acceso');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarEmpleadaCodigo();
  await c.sembrarEmpleadaCodigo({ codigo: '100199', nip: '905531', nombre: 'Ex empleado', activo: false });
  await c.crearCuentaAuth('legado@aguila.test', 'Legado1234');
  await c.rest('PATCH', 'staff/legado%40aguila.test', c.campos({ nombre: 'Gerente legado', rol: 'admin', activo: true }));
  await c.crearCuentaAuth('carlos@aguila.test', 'Carlos1234'); // cuenta sin ficha
  await c.sembrarCatalogoDemo();

  const browser = await c.abrirNavegador();
  const erroresTotales = [];

  // 1) admin por correo: contraseña incorrecta, luego correcta; inicio y barra lateral
  let { ctx, page, errores } = await c.nuevaPagina(browser);
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', c.ADMIN.correo);
  v.ok('con un correo, el segundo campo se llama «NIP o contraseña» y aparece «Olvidé mi contraseña»', (await page.textContent('#secreto-etiqueta')) === 'NIP o contraseña' && await page.isVisible('#btn-olvide'));
  let mensaje = await c.entrar(page, c.ADMIN.correo, 'incorrecta', { esperarError: true });
  v.ok('contraseña incorrecta muestra mensaje claro', /Correo, NIP o contraseña incorrectos/.test(mensaje), mensaje);
  await page.screenshot({ path: `${c.SALIDA}/acceso-login-error.png` });
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  v.ok('el admin llega al inicio del back office («Inicio · Águila POS»)', /\/index\.html$/.test(page.url()) && (await page.title()) === 'Inicio · Águila POS', `${page.url()} · ${await page.title()}`);
  const saludo = c.texto(await page.textContent('#saludo'));
  v.ok('el inicio es el tablero de ventas de hoy (saludo y cifras), sin la tarjeta de Gestión ni el aviso de antes',
    /, Alan$/.test(saludo) && await page.isVisible('#kpi-total') && (await page.$$('#tarjeta-gestion, #aviso')).length === 0, saludo);
  v.ok('en pantalla ancha la navegación es una barra lateral a la vista, sin botón de menú', await page.isVisible('#panel-navegacion') && await page.isHidden('.menu-boton'));
  const usuario = {
    nombre: await page.textContent('.usuario__nombre strong'),
    rol: await page.textContent('.usuario__nombre span'),
    href: await page.getAttribute('.usuario__nombre', 'href'),
  };
  v.ok('la barra muestra nombre y rol, con enlace a Mi cuenta', usuario.nombre === 'Alan (admin)' && usuario.rol === 'Administrador · Mi cuenta' && /\/cuenta\.html$/.test(usuario.href), JSON.stringify(usuario));
  const secciones = await page.$$eval('#navegacion nav a', (enlaces) => enlaces.map((a) => a.pathname.replace(/^\//, '')));
  const grupos = await page.$$eval('#navegacion .nav-grupo__titulo', (titulos) => titulos.map((t) => t.textContent));
  v.ok('la barra lateral agrupa todas las secciones del back office en Ventas, Catálogo y Administración',
    JSON.stringify(secciones) === JSON.stringify(SECCIONES) && grupos.join() === 'Ventas,Catálogo,Administración', `${grupos.join()} · ${secciones.join(' ')}`);
  v.ok('«Etiquetas» lleva a imprimir.html y ya no hay enlace a la antigua portada de Gestión',
    c.texto(await page.textContent('#navegacion nav a[href$="imprimir.html"]')) === 'Etiquetas' && (await page.$$('a[href$="gestion/index.html"]')).length === 0);
  v.ok('la barra ofrece abrir la caja y cerrar sesión', /\/caja\/$/.test(await page.getAttribute('.nav-caja', 'href')) && await page.isVisible('#navegacion button:has-text("Cerrar sesión")'));
  await page.screenshot({ path: `${c.SALIDA}/acceso-inicio-admin.png` });
  erroresTotales.push(...errores);
  await ctx.close();

  // 2) empleada con correo + NIP: el back office la rechaza y la manda a la caja, la consulta o el Catálogo
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', c.EMPLEADA.codigo);
  v.ok('con un código antiguo, el segundo campo se llama NIP, es numérico y no hay «Olvidé mi contraseña»', (await page.textContent('#secreto-etiqueta')) === 'NIP' && (await page.getAttribute('#secreto', 'inputmode')) === 'numeric' && !(await page.isVisible('#btn-olvide')));
  mensaje = await c.entrar(page, c.EMPLEADA.correo, '000000', { esperarError: true });
  v.ok('correo con NIP incorrecto muestra mensaje propio', /Correo, NIP o contraseña incorrectos/.test(mensaje), mensaje);
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' }); // sin el mensaje anterior
  mensaje = await c.entrar(page, ` ${c.EMPLEADA.correo.toUpperCase()} `, c.EMPLEADA.nip, { esperarError: true });
  v.ok('con su correo (en mayúsculas y con espacios) y NIP correctos, la empleada no entra: el back office es solo para administradores',
    mensaje === SOLO_ADMIN && /\/login\.html$/.test(page.url()), mensaje);
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  mensaje = await c.entrar(page, c.EMPLEADA.codigo, c.EMPLEADA.nip, { esperarError: true });
  v.ok('con el código antiguo y el NIP tampoco entra (compatibilidad)', mensaje === SOLO_ADMIN, mensaje);
  v.ok('login le ofrece ir a la caja, a la consulta de precios y al Catálogo', await page.isVisible('a[href="caja/"]') && await page.isVisible('a[href="caja/consulta.html"]') && await page.isVisible('a[href="catalogo/"]'));
  await page.screenshot({ path: `${c.SALIDA}/acceso-solo-admin.png` });
  await page.goto(`${c.BASE}/index.html`);
  await page.waitForURL(/login\.html/, { timeout: 20000 });
  v.ok('el rechazo no deja la sesión abierta: el inicio vuelve a pedir acceso, sin motivo', /\/login\.html\?volver=index\.html$/.test(page.url()), page.url());

  // una sesión de empleada guardada en el navegador tampoco sirve: cada página del back office la cierra
  await sesionGuardadaDeEmpleada(page);
  await page.goto(`${c.BASE}/gestion/empleados.html`);
  await page.waitForURL(/login\.html\?.*motivo=/, { timeout: 20000 });
  await page.waitForSelector('#mensaje.mensaje--error');
  v.ok('si una sesión de empleada llega a Empleados por URL, se cierra y vuelve a login con motivo solo-admin',
    /\/login\.html\?volver=gestion%2Fempleados\.html&motivo=solo-admin$/.test(page.url()) && c.texto(await page.textContent('#mensaje')) === SOLO_ADMIN, page.url());
  await sesionGuardadaDeEmpleada(page);
  await page.goto(`${c.BASE}/cuenta.html`);
  await page.waitForURL(/login\.html\?.*motivo=/, { timeout: 20000 });
  v.ok('Mi cuenta también es solo para administradores', /\/login\.html\?volver=cuenta\.html&motivo=solo-admin$/.test(page.url()), page.url());

  // la empleada sigue el enlace a la consulta de precios (sesión aparte) y entra con su correo y su NIP
  await page.click('a[href="caja/consulta.html"]');
  await page.waitForURL(/\/caja\/consulta\.html$/);
  const errorConsulta = await c.entrarConsulta(page, c.EMPLEADA.correo, '000000', { esperarError: true });
  v.ok('en la consulta, un NIP equivocado no entra', /Correo o NIP incorrectos/.test(errorConsulta), errorConsulta);
  const nombreConsulta = await c.entrarConsulta(page, c.EMPLEADA.correo, c.EMPLEADA.nip);
  v.ok('en la consulta de precios la empleada entra con su correo y NIP; el NIP ya no se cambia ahí (lo cambia un administrador)',
    nombreConsulta === c.EMPLEADA.nombre && (await page.$$('#btn-nip, #dialogo-nip')).length === 0, nombreConsulta);
  await page.screenshot({ path: `${c.SALIDA}/acceso-consulta-nip.png` });
  erroresTotales.push(...errores);
  await ctx.close();

  // 3) cuenta autenticada sin ficha: no entra
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  mensaje = await c.entrar(page, 'carlos@aguila.test', 'Carlos1234', { esperarError: true });
  v.ok('una cuenta sin ficha es rechazada con explicación', mensaje === SIN_REGISTRO && /login\.html/.test(page.url()), mensaje);
  erroresTotales.push(...errores);
  await ctx.close();

  // 4) código desactivado: no entra
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  mensaje = await c.entrar(page, '100199', '905531', { esperarError: true });
  v.ok('un código desactivado es rechazado', /desactivado/.test(mensaje), mensaje);
  erroresTotales.push(...errores);
  await ctx.close();

  // 5) ficha anterior a Gestión (correo, sin correoAuth): entra, y el inicio la completa
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await page.goto(`${c.BASE}/gestion/empleados.html`);
  await page.waitForURL(/login\.html\?volver=gestion%2Fempleados\.html/, { timeout: 20000 });
  v.ok('sin sesión, una página del back office redirige a login con volver=', true);
  await c.entrar(page, 'legado@aguila.test', 'Legado1234');
  v.ok('tras entrar vuelve a la página pedida', /gestion\/empleados\.html/.test(page.url()), page.url());
  await page.goto(`${c.BASE}/gestion/index.html`, { waitUntil: 'commit' });
  await page.waitForURL(`${c.BASE}/index.html`, { timeout: 20000 });
  await page.waitForSelector('#contenido:not([hidden])');
  v.ok('la antigua portada de Gestión (gestion/index.html) lleva al inicio del back office', true);
  await page.waitForFunction(() => ['ind-productos', 'ind-pendientes', 'ind-empleados', 'ind-tiendas'].every((id) => document.getElementById(id).textContent !== '—'), null, { timeout: 20000 });
  let legado = null;
  for (let i = 0; i < 20 && !legado?.correoAuth; i += 1) { legado = await c.leerDoc('staff/legado%40aguila.test'); if (!legado?.correoAuth) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('el inicio completa la ficha anterior del propio gerente (tipo correo, activo, admin)', legado?.correoAuth === 'legado@aguila.test' && legado.tipo === 'correo' && legado.rol === 'admin' && legado.activo === true && legado.cuentaVersion === 1, JSON.stringify(legado));
  const indicadores = Object.fromEntries(await Promise.all(['productos', 'pendientes', 'empleados', 'tiendas'].map(async (k) => [k, await page.textContent(`#ind-${k}`)])));
  v.ok('el inicio muestra catálogo y personal con números (4 productos activos, 3 etiquetas por imprimir, 3 personas con acceso, 2 tiendas)',
    indicadores.productos === '4' && indicadores.pendientes === '3' && indicadores.empleados === '3' && indicadores.tiendas === '2', JSON.stringify(indicadores));
  await page.screenshot({ path: `${c.SALIDA}/acceso-inicio-legado.png`, fullPage: true });
  erroresTotales.push(...errores);
  await ctx.close();

  // 6) sesión guardada + caché: el admin recarga el inicio sin conexión con los emuladores
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  await ctx.route(/127\.0\.0\.1:(8080|9099)\//, (ruta) => ruta.abort('internetdisconnected'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  let offlineOk = false;
  try {
    await page.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
    offlineOk = /Alan \(admin\)/.test(await page.textContent('#navegacion'));
  } catch { /* no abrió */ }
  v.ok('con la sesión guardada y la ficha en caché, el inicio abre sin conexión', offlineOk, page.url());
  erroresTotales.push(...errores);
  await ctx.close();

  await browser.close();
  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
