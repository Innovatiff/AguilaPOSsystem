/**
 * Gestión de personal (back office, solo administradores): alta de
 * colaboradores con correo y NIP de 6 dígitos único (cuenta, ficha, correo y
 * huella del NIP en un lote), permiso del Catálogo, NIP generado, NIP o
 * correo repetidos, fichas anteriores sin correo ni NIP de caja; la empleada
 * no entra al back office pero sí a la consulta de precios (correo + NIP),
 * que muestra lo que el admin cambia en el catálogo; cambiar NIP, editar
 * (también el correo), desactivar y reactivar, cuentas por correo y
 * contraseña, tiendas e importación.
 */
const c = require('./comun.cjs');

(async () => {
  const v = c.verificador('gestion');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarCatalogoDemo();
  // gerente con cuenta por correo + contraseña, anterior al acceso por NIP
  await c.crearCuentaAuth('gerente2@aguila.test', 'Gerente2026!');
  await c.rest('PATCH', 'staff/gerente2%40aguila.test', c.campos(c.ficha({ usuario: 'gerente2@aguila.test', nombre: 'Gerente Dos', rol: 'admin' })));
  // empleado anterior: código y NIP viejos, sin correo ni huella de NIP
  await c.crearCuentaAuth(c.correoDeCodigo('100050'), '90817263');
  await c.rest('PATCH', 'staff/100050', c.campos(c.ficha({ usuario: '100050', nombre: 'Pedro Antiguo', tienda: 'talbot' })));
  await c.rest('PATCH', 'accesos/100050', c.campos({ version: 1 }));

  const browser = await c.abrirNavegador();
  const erroresTotales = [];
  const admin = await c.nuevaPagina(browser);

  await c.entrar(admin.page, c.ADMIN.correo, c.ADMIN.contrasena);
  await admin.page.goto(`${c.BASE}/gestion/empleados.html`);
  await admin.page.waitForSelector('#contenido:not([hidden])');
  await admin.page.waitForFunction(() => document.querySelectorAll('#tabla-personal tbody tr').length === 3);
  const filaPropia = c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("Alan (admin)")'));
  v.ok('la lista muestra al propio gerente, sin botón de desactivarse ni de cambiar NIP', /tú/.test(filaPropia) && /admin@aguila\.test/.test(filaPropia) && !/Desactivar|Cambiar NIP/.test(filaPropia), filaPropia);
  await admin.page.waitForSelector('#aviso-migracion:not([hidden])');
  const aviso = c.texto(await admin.page.textContent('#aviso-migracion'));
  v.ok('avisa quién todavía no puede entrar con correo y NIP (fichas anteriores)', /1 persona todavía no puede entrar con correo y NIP: Pedro Antiguo/.test(aviso), aviso);
  const filaPedro = c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("Pedro Antiguo")'));
  v.ok('la fila anterior marca lo que le falta: el correo y el NIP de caja', /Falta el correo/.test(filaPedro) && /Falta el NIP de caja/.test(filaPedro), filaPedro);

  // ---- alta: correo + NIP + permiso del Catálogo
  await admin.page.keyboard.press('Alt+n');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('Alt+N abre el alta: nombre, correo, rol, tienda, permiso del Catálogo y NIP; ningún código que teclear',
    await admin.page.isVisible('#e-correo') && await admin.page.isVisible('#e-catalogo') && await admin.page.isVisible('#e-secreto') && (await admin.page.$$('#e-codigo')).length === 0);
  await admin.page.fill('#e-nombre', 'María López');
  await admin.page.selectOption('#e-tienda', 'talbot');
  await admin.page.fill('#e-secreto', '482913');
  await admin.page.fill('#e-secreto2', '482913');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#editor-aviso:not([hidden])');
  v.ok('sin correo no se registra', /Escribe el correo/.test(await admin.page.textContent('#editor-aviso')));
  await admin.page.fill('#e-correo', 'Maria.Lopez@Aguila.test');
  await admin.page.fill('#e-secreto', '123456');
  await admin.page.fill('#e-secreto2', '123456');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /secuencia/.test(document.getElementById('editor-aviso').textContent));
  v.ok('un NIP en secuencia se rechaza', true);
  await admin.page.fill('#e-secreto', '4829130');
  v.ok('el NIP admite solo 6 dígitos', (await admin.page.inputValue('#e-secreto')).length === 6);
  await admin.page.fill('#e-secreto', '482913');
  await admin.page.fill('#e-secreto2', '482931');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /no coinciden/.test(document.getElementById('editor-aviso').textContent));
  v.ok('dos NIP distintos se rechazan', true);
  await admin.page.fill('#e-secreto2', '482913');
  await admin.page.check('#e-catalogo');
  await admin.page.screenshot({ path: `${c.SALIDA}/gestion-alta-codigo.png` });
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#mensaje.mensaje--ok', { timeout: 30000 });
  const msgAlta = c.texto(await admin.page.textContent('#mensaje'));
  v.ok('el alta confirma cómo entra: NIP en la caja, correo y NIP en la consulta y el Catálogo', /María López registrado/.test(msgAlta) && /maria\.lopez@aguila\.test/.test(msgAlta), msgAlta);
  const ficha1001 = await c.leerDoc('staff/100051');
  v.ok('la ficha lleva su número interno, el correo en minúsculas y el permiso del Catálogo',
    ficha1001?.tipo === 'codigo' && ficha1001.correo === 'maria.lopez@aguila.test' && ficha1001.catalogo === true && ficha1001.correoAuth === c.correoDeCodigo('100051') && ficha1001.cuentaVersion === 1 && ficha1001.tienda === 'talbot' && ficha1001.actualizadoPor === c.ADMIN.correo,
    JSON.stringify(ficha1001));
  const clave = (await c.leerDoc('secretos/caja'))?.clave;
  v.ok('la primera alta crea la clave de caja (secretos/caja)', typeof clave === 'string' && Buffer.from(clave, 'base64').length === 32);
  const huella1 = c.huellaNip('482913', clave);
  v.ok('correos/{correo} y nips/{huella del NIP} apuntan a su número', (await c.leerDoc('correos/maria.lopez%40aguila.test'))?.codigo === '100051' && (await c.leerDoc(`nips/${huella1}`))?.codigo === '100051' && (await c.leerDoc(`nips/${huella1}`))?.version === 1);
  const cuenta1001 = await c.entrarAuthREST(c.correoDeCodigo('100051'), '482913');
  v.ok('la cuenta de Firebase existe con ese NIP', cuenta1001.ok, JSON.stringify(cuenta1001.error ?? 'ok'));
  v.ok('la sesión del gerente sigue siendo la suya tras crear la cuenta', /Alan \(admin\)/.test(await admin.page.textContent('#navegacion')));
  await admin.page.waitForFunction(() => document.querySelectorAll('#tabla-personal tbody tr').length === 4);
  const fila1001 = c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("María López")'));
  v.ok('la fila muestra nombre, número, correo, tienda, acceso y permiso del Catálogo', /María López/.test(fila1001) && /Nº 100051/.test(fila1001) && /maria\.lopez@aguila\.test/.test(fila1001) && /Águila Talbot/.test(fila1001) && /Correo \+ NIP/.test(fila1001) && / Sí /.test(fila1001), fila1001);

  // NIP y correo repetidos; NIP generado
  await admin.page.click('#btn-nuevo');
  await admin.page.fill('#e-nombre', 'Otra');
  await admin.page.fill('#e-correo', 'otra@aguila.test');
  await admin.page.fill('#e-secreto', '482913');
  await admin.page.fill('#e-secreto2', '482913');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForSelector('#editor-aviso:not([hidden])');
  v.ok('un NIP que ya tiene otra persona se rechaza antes de crear nada', /ya lo tiene otra persona/.test(await admin.page.textContent('#editor-aviso')), await admin.page.textContent('#editor-aviso'));
  await admin.page.fill('#e-correo', 'MARIA.LOPEZ@aguila.test');
  await admin.page.click('#btn-generar');
  const generado = await admin.page.inputValue('#e-secreto');
  v.ok('«Generar un NIP» propone 6 dígitos y los muestra para anotarlos', /^\d{6}$/.test(generado) && (await admin.page.inputValue('#e-secreto2')) === generado && new RegExp(generado).test(await admin.page.textContent('#nip-generado')));
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /ya es de María López/.test(document.getElementById('editor-aviso').textContent), null, { timeout: 15000 });
  v.ok('un correo que ya es de otra persona se rechaza', true);
  await admin.page.click('#btn-cerrar');
  v.ok('nada de lo rechazado quedó registrado', (await c.leerColeccion('staff')).size === 4);

  // ---- la empleada nueva: el back office la rechaza; la consulta de precios (sesión aparte) la deja entrar
  const empleada = await c.nuevaPagina(browser);
  let msg = await c.entrar(empleada.page, 'maria.lopez@aguila.test', '482913', { esperarError: true });
  v.ok('la empleada nueva no entra al back office con su correo y NIP: es solo para administradores', /solo para administradores/.test(msg) && await empleada.page.isVisible('a[href="caja/consulta.html"]'), msg);
  let nombre = await c.entrarConsulta(empleada.page, 'maria.lopez@aguila.test', '482913');
  v.ok('con el mismo correo y NIP entra a la consulta de precios', nombre === 'María López', nombre);
  v.ok('en la computadora, el buscador de la consulta queda con el foco para el escáner USB', await empleada.page.evaluate(() => document.activeElement?.id === 'buscar'));
  let tarjeta = await c.consultarPrecio(empleada.page, 'tajin');
  v.ok('la consulta le muestra el precio de un producto (solo lectura)', tarjeta.nombre === 'TAJIN CLASICO' && tarjeta.precio === '$4.99' && /142g/.test(tarjeta.sub), JSON.stringify(tarjeta));

  // ---- el catálogo lo cambia el admin: lo que no es precio, y el precio con historial a su nombre
  const jefe = await c.nuevaPagina(browser);
  await c.entrar(jefe.page, c.ADMIN.correo, c.ADMIN.contrasena);
  await jefe.page.goto(`${c.BASE}/productos.html`);
  await jefe.page.waitForSelector('#contenido:not([hidden])');
  await jefe.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await jefe.page.fill('#busqueda', 'tajin');
  await jefe.page.press('#busqueda', 'Enter');
  await jefe.page.waitForSelector('#editor[open]');
  v.ok('el admin ve el precio editable y sin la nota de solo lectura', !(await jefe.page.$eval('#f-precio', (i) => i.readOnly)) && await jefe.page.isHidden('#nota-precio'));
  await jefe.page.fill('#f-presentacion', '142 g');
  await jefe.page.click('#btn-guardar');
  await jefe.page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  let tajin = null;
  for (let i = 0; i < 20 && tajin?.presentacion !== '142 g'; i += 1) { tajin = await c.leerDoc('products/p-tajin'); if (tajin?.presentacion !== '142 g') await new Promise((r) => setTimeout(r, 300)); }
  v.ok('el admin guarda lo que no es precio, firmado a su nombre, sin tocar el precio ni el historial', tajin?.presentacion === '142 g' && tajin.precioCentavos === 499 && tajin.actualizadoPor === c.ADMIN.correo && (await c.leerColeccion('priceHistory')).size === 0, JSON.stringify({ presentacion: tajin?.presentacion, precio: tajin?.precioCentavos, por: tajin?.actualizadoPor }));
  await jefe.page.fill('#busqueda', 'tajin');
  await jefe.page.press('#busqueda', 'Enter');
  await jefe.page.waitForSelector('#editor[open]');
  await jefe.page.fill('#f-precio', '5.49');
  await jefe.page.click('#btn-guardar');
  await jefe.page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  for (let i = 0; i < 20 && tajin?.precioCentavos !== 549; i += 1) { tajin = await c.leerDoc('products/p-tajin'); if (tajin?.precioCentavos !== 549) await new Promise((r) => setTimeout(r, 300)); }
  const historial = await c.leerColeccion('priceHistory');
  v.ok('el cambio de precio del admin queda en el historial a su nombre', tajin?.precioCentavos === 549 && historial.size === 1 && [...historial.values()][0].usuario === c.ADMIN.correo, JSON.stringify([...historial.values()]));
  await jefe.ctx.close();
  tarjeta = await c.consultarPrecio(empleada.page, 'tajin');
  v.ok('la consulta de la empleada ya muestra el precio y la presentación nuevos', tarjeta.precio === '$5.49' && /142 g/.test(tarjeta.sub), JSON.stringify(tarjeta));
  await empleada.page.screenshot({ path: `${c.SALIDA}/gestion-consulta-empleada.png` });

  // ---- cambiar NIP
  await admin.page.click('#tabla-personal tbody tr:has-text("María López") button:has-text("Cambiar NIP")');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('el diálogo de cambiar NIP solo pide el NIP nuevo', await admin.page.isHidden('#grupo-datos') && /Cambiar NIP · María López/.test(await admin.page.textContent('#editor-titulo')));
  await admin.page.fill('#e-secreto', '482913');
  await admin.page.fill('#e-secreto2', '482913');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /ya es su NIP/.test(document.getElementById('editor-aviso').textContent), null, { timeout: 15000 });
  v.ok('el mismo NIP de antes se rechaza', true);
  await admin.page.fill('#e-secreto', '739201');
  await admin.page.fill('#e-secreto2', '739201');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /NIP de María López cambiado/.test(document.getElementById('mensaje').textContent), null, { timeout: 30000 });
  const ficha1001b = await c.leerDoc('staff/100051');
  v.ok('la ficha apunta a la cuenta nueva (versión 2)', ficha1001b?.cuentaVersion === 2 && ficha1001b.correoAuth === c.correoDeCodigo('100051', 2) && ficha1001b.creadoEn === ficha1001.creadoEn, JSON.stringify(ficha1001b));
  const huella2 = c.huellaNip('739201', clave);
  v.ok('la huella del NIP viejo se borra y la del nuevo apunta a la versión 2', (await c.leerDoc(`nips/${huella1}`)) === null && (await c.leerDoc(`nips/${huella2}`))?.version === 2);
  await empleada.page.reload();
  await empleada.page.waitForFunction(() => !document.getElementById('mensaje-acceso').hidden && /NIP fue restablecido/.test(document.getElementById('mensaje-acceso').textContent), null, { timeout: 20000 });
  v.ok('al recargar la consulta, la sesión anterior de la empleada se cierra: su NIP cambió', await empleada.page.isVisible('#form-acceso') && await empleada.page.isHidden('#vista-consulta'));
  msg = await c.entrarConsulta(empleada.page, 'maria.lopez@aguila.test', '482913', { esperarError: true });
  v.ok('el NIP anterior ya no entra', /Correo o NIP incorrectos/.test(msg), msg);
  nombre = await c.entrarConsulta(empleada.page, 'maria.lopez@aguila.test', '739201');
  v.ok('el NIP nuevo entra', nombre === 'María López', nombre);

  // ---- editar: nombre, tienda, correo y permiso del Catálogo
  await admin.page.click('#tabla-personal tbody tr:has-text("María López") button:has-text("Editar")');
  await admin.page.waitForSelector('#editor[open]');
  v.ok('al editar no se pide NIP y se ve su número interno', await admin.page.isHidden('#grupo-secreto') && /Nº de colaborador 100051/.test(await admin.page.textContent('#e-numero')));
  await admin.page.fill('#e-nombre', 'María López García');
  await admin.page.selectOption('#e-tienda', 'erie');
  await admin.page.fill('#e-correo', 'maria@aguila.test');
  await admin.page.uncheck('#e-catalogo');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /guardado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  const ficha1001c = await c.leerDoc('staff/100051');
  v.ok('la edición cambia nombre, tienda, correo y permiso, y conserva la cuenta', ficha1001c?.nombre === 'María López García' && ficha1001c.tienda === 'erie' && ficha1001c.correo === 'maria@aguila.test' && ficha1001c.catalogo === false && ficha1001c.cuentaVersion === 2, JSON.stringify(ficha1001c));
  v.ok('el correo viejo deja de servir y el nuevo apunta a su número', (await c.leerDoc('correos/maria.lopez%40aguila.test')) === null && (await c.leerDoc('correos/maria%40aguila.test'))?.codigo === '100051');

  // ---- ficha anterior: se le pone correo y NIP de 6 dígitos
  await admin.page.click('#tabla-personal tbody tr:has-text("Pedro Antiguo") button:has-text("Editar")');
  await admin.page.waitForSelector('#editor[open]');
  await admin.page.fill('#e-correo', 'pedro@aguila.test');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /Pedro Antiguo guardado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  await admin.page.click('#tabla-personal tbody tr:has-text("Pedro Antiguo") button:has-text("Cambiar NIP")');
  await admin.page.waitForSelector('#editor[open]');
  await admin.page.fill('#e-secreto', '305917');
  await admin.page.fill('#e-secreto2', '305917');
  await admin.page.click('#btn-guardar');
  await admin.page.waitForFunction(() => /NIP de Pedro Antiguo cambiado/.test(document.getElementById('mensaje').textContent), null, { timeout: 30000 });
  await admin.page.waitForSelector('#aviso-migracion', { state: 'hidden', timeout: 15000 });
  v.ok('con correo y NIP nuevos, la ficha anterior ya no está pendiente', /Correo \+ NIP/.test(c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("Pedro Antiguo")'))));
  const otraPagina = await c.nuevaPagina(browser);
  nombre = await c.entrarConsulta(otraPagina.page, 'pedro@aguila.test', '305917');
  v.ok('y ya entra a la consulta con su correo y su NIP nuevo', nombre === 'Pedro Antiguo', nombre);
  erroresTotales.push(...otraPagina.errores);
  await otraPagina.ctx.close();

  // ---- desactivar y reactivar
  await admin.page.click('#tabla-personal tbody tr:has-text("María López García") button:has-text("Desactivar")');
  await admin.page.waitForFunction(() => /desactivado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  v.ok('desactivada desaparece de la lista hasta marcar «Ver inactivos»', (await admin.page.$$('#tabla-personal tbody tr:has-text("María López García")')).length === 0);
  await admin.page.check('#ver-inactivos');
  v.ok('con «Ver inactivos» aparece como inactiva', /Inactivo/.test(c.texto(await admin.page.textContent('#tabla-personal tbody tr:has-text("María López García")'))));
  await empleada.page.reload();
  await empleada.page.waitForFunction(() => !document.getElementById('mensaje-acceso').hidden && /desactivado/.test(document.getElementById('mensaje-acceso').textContent), null, { timeout: 20000 });
  v.ok('al recargar la consulta, la sesión de la empleada desactivada se cierra con su motivo', await empleada.page.isVisible('#form-acceso') && await empleada.page.isHidden('#vista-consulta'));
  msg = await c.entrarConsulta(empleada.page, 'maria@aguila.test', '739201', { esperarError: true });
  v.ok('desactivada no puede volver a entrar', /desactivado/.test(msg), msg);
  await admin.page.click('#tabla-personal tbody tr:has-text("María López García") button:has-text("Activar")');
  await admin.page.waitForFunction(() => /reactivado/.test(document.getElementById('mensaje').textContent), null, { timeout: 20000 });
  nombre = await c.entrarConsulta(empleada.page, 'maria@aguila.test', '739201');
  v.ok('reactivada vuelve a entrar', nombre === 'María López García', nombre);
  await admin.page.uncheck('#ver-inactivos');
  await empleada.ctx.close();

  // ---- cuentas por correo y contraseña (gerentes anteriores): siguen entrando al back office
  const filaG2 = c.texto(await admin.page.innerText('#tabla-personal tbody tr:has-text("Gerente Dos")'));
  v.ok('una cuenta por correo + contraseña se marca como tal y se le puede enviar el enlace de contraseña', /Correo \+ contraseña/.test(filaG2) && /Enviar enlace de contraseña/.test(filaG2), filaG2);
  const g2 = await c.nuevaPagina(browser);
  await c.entrar(g2.page, 'gerente2@aguila.test', 'Gerente2026!');
  v.ok('el segundo gerente entra al back office con su contraseña y ve Empleados', await g2.page.isVisible('nav a[href$="gestion/empleados.html"]') && c.texto(await g2.page.textContent('.usuario__nombre strong')) === 'Gerente Dos');
  erroresTotales.push(...g2.errores);
  await g2.ctx.close();

  // ---- filtro
  await admin.page.fill('#filtro', 'pedro@');
  const filtradas = await admin.page.$$eval('#tabla-personal tbody tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()));
  v.ok('el buscador filtra también por correo', filtradas.length === 1 && /Pedro Antiguo/.test(filtradas[0]), filtradas.join(' | '));
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

  // ---- importar / exportar (gestion/datos.html, en el grupo Catálogo de la barra lateral)
  await admin.page.click('nav a[href$="gestion/datos.html"]');
  await admin.page.waitForSelector('#contenido:not([hidden])');
  await admin.page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('Importar / exportar abre desde la barra lateral y carga el catálogo', /gestion\/datos\.html/.test(admin.page.url()) && await admin.page.isVisible('#btn-exportar'));

  erroresTotales.push(...admin.errores, ...empleada.errores, ...jefe.errores);
  await admin.ctx.close();
  await browser.close();
  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
