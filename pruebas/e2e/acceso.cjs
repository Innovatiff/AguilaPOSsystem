/**
 * Acceso: código + NIP, correo + contraseña, cuentas no registradas,
 * desactivadas, fichas anteriores a Gestión, guardia de Gestión y modo sin conexión.
 */
const c = require('./comun.cjs');

(async () => {
  const v = c.verificador('acceso');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarEmpleadaCodigo();
  await c.sembrarEmpleadaCodigo({ codigo: '1099', nip: '905531', nombre: 'Ex empleado', activo: false });
  await c.crearCuentaAuth('legado@aguila.test', 'Legado1234');
  await c.rest('PATCH', 'staff/legado%40aguila.test', c.campos({ nombre: 'Gerente legado', rol: 'admin', activo: true }));
  await c.crearCuentaAuth('carlos@aguila.test', 'Carlos1234'); // cuenta sin ficha
  await c.sembrarCatalogoDemo();

  const browser = await c.abrirNavegador();
  const erroresTotales = [];

  // 1) admin por correo: contraseña incorrecta, luego correcta
  let { ctx, page, errores } = await c.nuevaPagina(browser);
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', c.ADMIN.correo);
  v.ok('con un correo, el segundo campo se llama Contraseña y aparece «Olvidé mi contraseña»', (await page.textContent('#secreto-etiqueta')) === 'Contraseña' && await page.isVisible('#btn-olvide'));
  let mensaje = await c.entrar(page, c.ADMIN.correo, 'incorrecta', { esperarError: true });
  v.ok('contraseña incorrecta muestra mensaje claro', /Correo o contraseña incorrectos/.test(mensaje), mensaje);
  await page.screenshot({ path: `${c.SALIDA}/acceso-login-error.png` });
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  v.ok('el admin llega a inicio', /index\.html/.test(page.url()), page.url());
  const nav = c.texto(await page.textContent('#navegacion'));
  v.ok('la barra muestra nombre y rol', /Alan \(admin\) · administrador/.test(nav), nav);
  v.ok('el admin ve el enlace y la tarjeta de Gestión', (await page.$$('nav a[href$="gestion/index.html"]')).length === 1 && await page.isVisible('#tarjeta-gestion'));
  v.ok('la barra ya no ofrece Administración ni Importar/exportar en el catálogo', !/Administración|Importar/.test(nav));
  await page.screenshot({ path: `${c.SALIDA}/acceso-inicio-admin.png` });
  erroresTotales.push(...errores);
  await ctx.close();

  // 2) empleada por código: NIP incorrecto, luego correcto; sin Gestión
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await page.goto(`${c.BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.fill('#identificador', c.EMPLEADA.codigo);
  v.ok('con un código, el segundo campo se llama NIP, es numérico y no hay «Olvidé mi contraseña»', (await page.textContent('#secreto-etiqueta')) === 'NIP' && (await page.getAttribute('#secreto', 'inputmode')) === 'numeric' && !(await page.isVisible('#btn-olvide')));
  mensaje = await c.entrar(page, c.EMPLEADA.codigo, '000000', { esperarError: true });
  v.ok('NIP incorrecto muestra mensaje propio', /Código o NIP incorrectos/.test(mensaje), mensaje);
  await c.entrar(page, ` ${c.EMPLEADA.codigo} `, c.EMPLEADA.nip);
  const navEmpleada = c.texto(await page.textContent('#navegacion'));
  v.ok('la empleada entra con su código (con espacios alrededor) y ve su nombre', /María López · empleado/.test(navEmpleada), navEmpleada);
  v.ok('la empleada no ve Gestión', (await page.$$('nav a[href$="gestion/index.html"]')).length === 0 && !(await page.isVisible('#tarjeta-gestion')));
  await page.goto(`${c.BASE}/gestion/empleados.html`);
  await page.waitForURL(/index\.html\?aviso=solo-admin/, { timeout: 20000 });
  await page.waitForSelector('#contenido:not([hidden])');
  v.ok('si entra a Gestión por URL, vuelve a inicio con aviso solo-admin', /solo para administradores/.test(await page.textContent('#aviso')));
  await page.goto(`${c.BASE}/cuenta.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  const fichaCuenta = c.texto(await page.textContent('#datos-cuenta'));
  v.ok('Mi cuenta muestra código, nombre, rol y tienda', /María López.*1023.*Empleado.*Águila Talbot/.test(fichaCuenta), fichaCuenta);
  v.ok('Mi cuenta ofrece cambiar el NIP', /Cambiar NIP/.test(await page.textContent('#titulo-secreto')));
  await page.screenshot({ path: `${c.SALIDA}/acceso-mi-cuenta.png` });
  // cambio de NIP con NIP actual incorrecto y luego correcto
  await page.fill('#s-actual', '111111'); await page.fill('#s-nuevo', '246813'); await page.fill('#s-repetir', '246813'); await page.click('#s-guardar');
  await page.waitForSelector('#s-mensaje:not([hidden])');
  v.ok('cambiar NIP con el actual incorrecto se rechaza', /actual no es correcto/.test(await page.textContent('#s-mensaje')), c.texto(await page.textContent('#s-mensaje')));
  await page.fill('#s-actual', c.EMPLEADA.nip); await page.fill('#s-nuevo', '246813'); await page.fill('#s-repetir', '246813'); await page.click('#s-guardar');
  await page.waitForSelector('#s-mensaje.mensaje--ok', { timeout: 20000 });
  const reingreso = await c.entrarAuthREST(c.correoDeCodigo(c.EMPLEADA.codigo), '246813');
  v.ok('la empleada cambia su propio NIP y el nuevo sirve', reingreso.ok, JSON.stringify(reingreso.error ?? 'ok'));
  erroresTotales.push(...errores);
  await ctx.close();

  // 3) cuenta autenticada sin ficha: no entra
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  mensaje = await c.entrar(page, 'carlos@aguila.test', 'Carlos1234', { esperarError: true });
  v.ok('una cuenta sin ficha es rechazada con explicación', /no está registrada/.test(mensaje) && /login\.html/.test(page.url()), mensaje);
  erroresTotales.push(...errores);
  await ctx.close();

  // 4) código desactivado: no entra
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  mensaje = await c.entrar(page, '1099', '905531', { esperarError: true });
  v.ok('un código desactivado es rechazado', /desactivado/.test(mensaje), mensaje);
  erroresTotales.push(...errores);
  await ctx.close();

  // 5) ficha anterior a Gestión (correo, sin correoAuth): entra, y Gestión la completa
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await page.goto(`${c.BASE}/gestion/empleados.html`);
  await page.waitForURL(/login\.html\?volver=gestion%2Fempleados\.html/, { timeout: 20000 });
  v.ok('sin sesión, una página de Gestión redirige a login con volver=', true);
  await c.entrar(page, 'legado@aguila.test', 'Legado1234');
  v.ok('tras entrar vuelve a la página de Gestión pedida', /gestion\/empleados\.html/.test(page.url()), page.url());
  await page.goto(`${c.BASE}/gestion/index.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.getElementById('ind-empleados').textContent !== '—', null, { timeout: 20000 });
  let legado = null;
  for (let i = 0; i < 20 && !legado?.correoAuth; i += 1) { legado = await c.leerDoc('staff/legado%40aguila.test'); if (!legado?.correoAuth) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('el Resumen completa la ficha anterior del propio gerente (tipo correo, activo, admin)', legado?.correoAuth === 'legado@aguila.test' && legado.tipo === 'correo' && legado.rol === 'admin' && legado.activo === true && legado.cuentaVersion === 1, JSON.stringify(legado));
  const indicadores = c.texto(await page.textContent('.indicadores'));
  v.ok('el Resumen muestra indicadores con números', /4 productos activos.*3 con etiqueta pendiente.*3 personas con acceso.*2 tiendas activas/.test(indicadores), indicadores);
  await page.screenshot({ path: `${c.SALIDA}/gestion-resumen.png` });
  erroresTotales.push(...errores);
  await ctx.close();

  // 6) sesión guardada + caché: la empleada recarga inicio sin conexión con los emuladores
  ({ ctx, page, errores } = await c.nuevaPagina(browser));
  await c.entrar(page, c.EMPLEADA.codigo, '246813');
  await ctx.route(/127\.0\.0\.1:(8080|9099)\//, (ruta) => ruta.abort('internetdisconnected'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  let offlineOk = false;
  try {
    await page.waitForSelector('#contenido:not([hidden])', { timeout: 15000 });
    offlineOk = /María López/.test(await page.textContent('#navegacion'));
  } catch { /* no abrió */ }
  v.ok('con la sesión guardada y la ficha en caché, inicio abre sin conexión', offlineOk, page.url());
  erroresTotales.push(...errores);
  await ctx.close();

  await browser.close();
  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
