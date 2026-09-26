/**
 * Gestión: alta de empleados con código y NIP (cuenta + ficha), entrada del
 * empleado con su código, firma de sus cambios, restablecer NIP, desactivar,
 * editar, alta por correo, tiendas e importación.
 */
const c = require('./comun.cjs');

(async () => {
  const v = c.verificador('gestion');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarCatalogoDemo();
  await c.crearCuentaAuth('gerente2@aguila.test', 'Gerente2026!'); // cuenta que ya existe en Firebase

  const browser = await c.abrirNavegador();
  const erroresTotales = [];
  const admin = await c.nuevaPagina(browser);

  await c.entrar(admin.page, c.ADMIN.correo, c.ADMIN.contrasena);
  await admin.page.goto(`${c.BASE}/gestion/empleados.html`);
  await admin.page.waitForSelector('#contenido:not([hidden])');
  const filasIniciales = await admin.page.$$eval('#tabla-personal tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
  v.ok('la lista muestra al propio gerente, sin botón de desactivarse ni de restablecer', filasIniciales.length === 1 && /admin@aguila\.test.*Alan \(admin\).*tú.*Administrador/.test(filasIniciales[0]) && !/Desactivar|Restablecer/.test(filasIniciales[0]), filasIniciales[0]);

  // ---- alta por código
  await admin.page.keyboard.press('Alt+n');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('Alt+N abre el alta con el siguiente código libre propuesto', (await admin.page.inputValue('#e-codigo')) === '100001');
  await admin.page.fill('#e-nombre', 'María López');
  await admin.page.selectOption('#e-tienda', 'talbot');
  await admin.page.fill('#e-secreto', '123456');
  await admin.page.fill('#e-secreto2', '123456');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#editor-aviso:not([hidden])');
  v.ok('un NIP en secuencia se rechaza', /secuencia/.test(await admin.page.textContent('#editor-aviso')));
  await admin.page.fill('#e-secreto', '482913');
  await admin.page.fill('#e-secreto2', '482931');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /no coinciden/.test(document.getElementById('editor-aviso').textContent));
  v.ok('dos NIP distintos se rechazan', true);
  await admin.page.fill('#e-secreto2', '482913');
  await admin.page.screenshot({ path: `${c.SALIDA}/gestion-alta-codigo.png` });
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#mensaje.mensaje--ok', { timeout: 30000 });
  const msgAlta = c.texto(await admin.page.textContent('#mensaje'));
  v.ok('el alta confirma código y nombre', /María López registrado con el código 100001/.test(msgAlta), msgAlta);
  const acceso1001 = await c.leerDoc('accesos/100001');
  v.ok('accesos/100001 publica la versión 1 de la cuenta', acceso1001?.version === 1, JSON.stringify(acceso1001));
  const ficha1001 = await c.leerDoc('staff/100001');
  v.ok('la ficha queda con el esquema completo (código, correo sintético v1, tienda, quién la creó)',
    ficha1001?.tipo === 'codigo' && ficha1001.correoAuth === c.correoDeCodigo('100001') && ficha1001.cuentaVersion === 1 && ficha1001.tienda === 'talbot' && ficha1001.rol === 'empleado' && ficha1001.activo === true && ficha1001.actualizadoPor === c.ADMIN.correo && ficha1001.usuario === '100001' && typeof ficha1001.creadoEn === 'string',
    JSON.stringify(ficha1001));
  const cuenta1001 = await c.entrarAuthREST(c.correoDeCodigo('100001'), '482913');
  v.ok('la cuenta de Firebase existe con ese NIP', cuenta1001.ok && cuenta1001.email === c.correoDeCodigo('100001'), JSON.stringify(cuenta1001.error ?? 'ok'));
  v.ok('la sesión del gerente sigue siendo la suya tras crear la cuenta', /Alan \(admin\)/.test(await admin.page.textContent('#navegacion')));
  await admin.page.waitForFunction(() => document.querySelectorAll('#tabla-personal tbody tr').length === 2);
  const fila1001 = c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("100001")'));
  v.ok('la fila muestra código, nombre, tienda y tipo de acceso', /100001\s+María López\s+Empleado\s+Águila Talbot\s+Código \+ NIP\s+Activo/.test(fila1001), fila1001);

  // código repetido
  await admin.page.click('#btn-nuevo');
  await admin.page.fill('#e-codigo', '100001');
  await admin.page.fill('#e-nombre', 'Otra');
  await admin.page.fill('#e-secreto', '918273');
  await admin.page.fill('#e-secreto2', '918273');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#editor-aviso:not([hidden])');
  v.ok('un código ya usado se rechaza antes de crear nada', /ya es de María López/.test(await admin.page.textContent('#editor-aviso')));
  await admin.page.click('#btn-cerrar');

  // ---- la empleada entra con su código y firma sus cambios con él
  const empleada = await c.nuevaPagina(browser);
  await c.entrar(empleada.page, '100001', '482913');
  v.ok('la empleada nueva entra con código y NIP', /María López · empleado/.test(c.texto(await empleada.page.textContent('#navegacion'))));
  await empleada.page.goto(`${c.BASE}/productos.html`);
  await empleada.page.waitForSelector('#contenido:not([hidden])');
  await empleada.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await empleada.page.fill('#busqueda', 'tajin');
  await empleada.page.press('#busqueda', 'Enter');
  await empleada.page.waitForSelector('#editor[open]');
  await empleada.page.fill('#f-precio', '5.49');
  await empleada.page.click('#btn-guardar');
  try {
    await empleada.page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  } catch (e) {
    console.log('  editor abierto aún; aviso:', await empleada.page.textContent('#editor-aviso'), '| avisos:', await empleada.page.evaluate(() => document.querySelector('.avisos')?.textContent ?? ''));
    await empleada.page.screenshot({ path: `${c.SALIDA}/gestion-fallo-guardar.png` });
    throw e;
  }
  let tajin = null;
  for (let i = 0; i < 20 && tajin?.precioCentavos !== 549; i += 1) { tajin = await c.leerDoc('products/p-tajin'); if (tajin?.precioCentavos !== 549) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('el cambio de precio queda firmado con el código, no con el correo sintético', tajin?.precioCentavos === 549 && tajin.actualizadoPor === '100001', JSON.stringify({ precio: tajin?.precioCentavos, por: tajin?.actualizadoPor }));
  const historial = await c.leerColeccion('priceHistory');
  v.ok('la entrada de historial lleva el código', historial.size === 1 && [...historial.values()][0].usuario === '100001', JSON.stringify([...historial.values()]));
  await empleada.page.fill('#busqueda', 'tajin');
  await empleada.page.press('#busqueda', 'Enter');
  await empleada.page.waitForSelector('#editor[open]');
  await empleada.page.waitForFunction(() => /María López \(100001\)/.test(document.getElementById('meta').textContent), null, { timeout: 15000 }).catch(() => {});
  const metaTexto = c.texto(await empleada.page.textContent('#meta'));
  v.ok('el editor muestra quién actualizó con nombre y código', /por María López \(100001\)/.test(metaTexto), metaTexto);
  await empleada.page.click('#btn-cerrar');

  // ---- restablecer NIP
  await admin.page.click('#tabla-personal tbody tr:has-text("100001") button:has-text("Restablecer NIP")');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('el diálogo de restablecer solo pide el NIP nuevo', await admin.page.isHidden('#grupo-datos') && /Restablecer NIP · María López \(100001\)/.test(await admin.page.textContent('#editor-titulo')));
  await admin.page.fill('#e-secreto', '739201');
  await admin.page.fill('#e-secreto2', '739201');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /restablecido/.test(document.getElementById('mensaje').textContent), null, { timeout: 30000 });
  const ficha1001b = await c.leerDoc('staff/100001');
  v.ok('la ficha apunta a la cuenta nueva (versión 2)', ficha1001b?.cuentaVersion === 2 && ficha1001b.correoAuth === c.correoDeCodigo('100001', 2) && ficha1001b.creadoEn === ficha1001.creadoEn, JSON.stringify(ficha1001b));
  v.ok('la fila indica que el NIP se restableció', /NIP restablecido 1 vez/.test(c.texto(await admin.page.textContent('#tabla-personal tbody tr:has-text("100001")'))));
  v.ok('accesos/100001 pasa a la versión 2', (await c.leerDoc('accesos/100001'))?.version === 2);
  await empleada.page.reload();
  await empleada.page.waitForURL(/login\.html\?.*motivo=cuenta-renovada/, { timeout: 20000 });
  v.ok('la sesión anterior de la empleada se cierra con el motivo cuenta-renovada', /Tu NIP fue restablecido/.test(await empleada.page.textContent('#mensaje')));
  let msg = await c.entrar(empleada.page, '100001', '482913', { esperarError: true });
  v.ok('el NIP anterior ya no entra', /NIP fue restablecido|Código o NIP incorrectos/.test(msg), msg);
  await c.entrar(empleada.page, '100001', '739201');
  v.ok('el NIP nuevo entra', /María López/.test(await empleada.page.textContent('#navegacion')));

  // ---- editar: nombre y tienda
  await admin.page.click('#tabla-personal tbody tr:has-text("100001") button:has-text("Editar")');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('al editar, el código no se puede cambiar y no se pide NIP', (await admin.page.getAttribute('#e-codigo', 'readonly')) !== null && await admin.page.isHidden('#grupo-secreto'));
  await admin.page.fill('#e-nombre', 'María López García');
  await admin.page.selectOption('#e-tienda', 'erie');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /guardado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  const ficha1001c = await c.leerDoc('staff/100001');
  v.ok('la edición cambia nombre y tienda y conserva la cuenta', ficha1001c?.nombre === 'María López García' && ficha1001c.tienda === 'erie' && ficha1001c.cuentaVersion === 2, JSON.stringify(ficha1001c));

  // ---- desactivar y reactivar
  await admin.page.click('#tabla-personal tbody tr:has-text("100001") button:has-text("Desactivar")');
  await admin.page.waitForFunction(() => /desactivado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  v.ok('desactivada desaparece de la lista hasta marcar «Ver inactivos»', (await admin.page.$$('#tabla-personal tbody tr:has-text("100001")')).length === 0);
  await admin.page.check('#ver-inactivos');
  v.ok('con «Ver inactivos» aparece como inactiva', /Inactivo/.test(c.texto(await admin.page.textContent('#tabla-personal tbody tr:has-text("100001")'))));
  await empleada.page.reload();
  await empleada.page.waitForURL(/login\.html\?.*motivo=desactivado/, { timeout: 20000 });
  msg = await c.entrar(empleada.page, '100001', '739201', { esperarError: true });
  v.ok('desactivada no puede volver a entrar', /desactivado/.test(msg), msg);
  await admin.page.click('#tabla-personal tbody tr:has-text("100001") button:has-text("Activar")');
  await admin.page.waitForFunction(() => /reactivado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  await c.entrar(empleada.page, '100001', '739201');
  v.ok('reactivada vuelve a entrar', /María López García/.test(await empleada.page.textContent('#navegacion')));
  await admin.page.uncheck('#ver-inactivos');
  await empleada.ctx.close();

  // ---- alta por correo: cuenta que ya existe, y cuenta nueva con contraseña temporal
  await admin.page.click('#btn-nuevo');
  await admin.page.check('input[name="tipo"][value="correo"]');
  v.ok('con acceso por correo se piden correo y el tipo de cuenta', await admin.page.isVisible('#campo-correo') && await admin.page.isVisible('#grupo-cuenta-correo'));
  await admin.page.check('input[name="cuenta"][value="existe"]');
  await admin.page.fill('#e-correo', 'Gerente2@Aguila.test');
  await admin.page.fill('#e-nombre', 'Gerente Dos');
  await admin.page.selectOption('#e-rol', 'admin');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /Acceso registrado para gerente2@aguila\.test/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  const fichaG2 = await c.leerDoc('staff/gerente2%40aguila.test');
  v.ok('la ficha por correo se guarda en minúsculas con tipo correo', fichaG2?.tipo === 'correo' && fichaG2.correoAuth === 'gerente2@aguila.test' && fichaG2.rol === 'admin', JSON.stringify(fichaG2));

  await admin.page.click('#btn-nuevo');
  await admin.page.check('input[name="tipo"][value="correo"]');
  await admin.page.fill('#e-correo', 'ana@aguila.test');
  await admin.page.fill('#e-nombre', 'Ana Pérez');
  await admin.page.fill('#e-secreto', 'Temporal2026');
  await admin.page.fill('#e-secreto2', 'Temporal2026');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /Ana Pérez registrado/.test(document.getElementById('mensaje').textContent), null, { timeout: 30000 });
  const otra = await c.nuevaPagina(browser);
  await c.entrar(otra.page, 'ana@aguila.test', 'Temporal2026');
  v.ok('la cuenta por correo creada desde Gestión entra con su contraseña temporal', /Ana Pérez · empleado/.test(c.texto(await otra.page.textContent('#navegacion'))));
  erroresTotales.push(...otra.errores);
  await otra.ctx.close();
  const g2 = await c.nuevaPagina(browser);
  await c.entrar(g2.page, 'gerente2@aguila.test', 'Gerente2026!');
  v.ok('el segundo gerente entra y ve Gestión', (await g2.page.$$('nav a[href$="gestion/index.html"]')).length === 1);
  erroresTotales.push(...g2.errores);
  await g2.ctx.close();

  // ---- filtro
  await admin.page.fill('#filtro', 'ana');
  const filtradas = await admin.page.$$eval('#tabla-personal tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
  v.ok('el buscador filtra por nombre', filtradas.length === 1 && /Ana Pérez/.test(filtradas[0]), filtradas.join(' | '));
  await admin.page.fill('#filtro', '');
  await admin.page.screenshot({ path: `${c.SALIDA}/gestion-empleados.png`, fullPage: true });

  // ---- tiendas
  await admin.page.click('nav a[href$="gestion/tiendas.html"]');
  await admin.page.waitForSelector('#contenido:not([hidden])');
  await admin.page.fill('#t-nombre', 'Águila Kingsville');
  v.ok('el identificador de tienda se propone solo', (await admin.page.inputValue('#t-id')) === 'aguila-kingsville');
  await admin.page.press('#t-nombre', 'Enter');
  await admin.page.waitForFunction(() => document.querySelectorAll('#tabla-tiendas tbody tr').length === 3, null, { timeout: 20000 });
  v.ok('la tienda nueva aparece en la tabla', /aguila-kingsville/.test(await admin.page.textContent('#tabla-tiendas')));

  // ---- importar / exportar bajo Gestión
  await admin.page.click('nav a[href$="gestion/datos.html"]');
  await admin.page.waitForSelector('#contenido:not([hidden])');
  await admin.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('Importar / exportar vive en Gestión y carga el catálogo', /gestion\/datos\.html/.test(admin.page.url()) && await admin.page.isVisible('#btn-exportar'));

  erroresTotales.push(...admin.errores, ...empleada.errores);
  await admin.ctx.close();
  await browser.close();
  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
