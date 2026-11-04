/**
 * App Catálogo del personal (/catalogo/): solo entra quien tiene el permiso
 * (correo + NIP); ve, busca y edita productos SIN tocar nunca el precio, la
 * unidad ni la clase fiscal (ni por la pantalla ni por el SDK: las reglas lo
 * rechazan); pide altas sin precio (productos y captura rápida) y bajas;
 * imprime etiquetas; no llega al back office. El administrador resuelve las
 * solicitudes en el back office (Solicitudes): pone el precio y el producto
 * entra al catálogo, o lo quita, o rechaza con una nota.
 */
const c = require('./comun.cjs');

const LUIS = { codigo: '100124', nip: '593017', nombre: 'Luis Ortega', correo: 'luis@aguila.test' };
const ROSA = { codigo: '100150', nip: '735146', nombre: 'Rosa Méndez', correo: 'rosa@aguila.test' };
const GALLETAS = '075010006113';
const CAPTURA = '078949000115';

(async () => {
  const v = c.verificador('catalogo');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.sembrarCatalogoDemo();
  await c.sembrarEmpleadaCodigo({ catalogo: true });
  await c.sembrarEmpleadaCodigo({ ...LUIS, catalogo: false });
  await c.sembrarClaveCaja();
  await c.sembrarEmpleadaCodigo({ ...ROSA, rol: 'admin' });

  const browser = await c.abrirNavegador();
  const erroresTotales = [];

  // ---- sin permiso no entra
  const luis = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 860 } });
  await luis.page.goto(`${c.BASE}/catalogo/`);
  await luis.page.waitForURL(/\/catalogo\/entrar\.html\?volver=catalogo%2Findex\.html/, { timeout: 20000 });
  v.ok('sin sesión, el Catálogo pide entrar (su propia página de entrada)', /Catálogo/.test(await luis.page.textContent('.subtitulo')) && (await luis.page.textContent('#secreto-etiqueta')) === 'NIP');
  await luis.page.fill('#identificador', LUIS.correo);
  await luis.page.fill('#secreto', LUIS.nip);
  await luis.page.press('#secreto', 'Enter');
  await luis.page.waitForSelector('#mensaje.mensaje--error');
  v.ok('quien no tiene el permiso del Catálogo no entra y se le dice por qué', /No tienes permiso para usar el Catálogo/.test(await luis.page.textContent('#mensaje')) && /entrar\.html/.test(luis.page.url()));
  erroresTotales.push(...luis.errores);
  await luis.ctx.close();

  // ---- con permiso entra con correo + NIP
  const maria = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 860 } });
  const { page } = maria;
  page.respuestaPrompt = 'Ya no la surte el proveedor';
  await page.goto(`${c.BASE}/catalogo/`);
  await page.waitForURL(/entrar\.html/);
  await page.fill('#identificador', c.EMPLEADA.correo);
  await page.fill('#secreto', c.EMPLEADA.nip);
  await page.press('#secreto', 'Enter');
  await page.waitForURL(/\/catalogo\/index\.html$/, { timeout: 20000 });
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  v.ok('con el permiso entra con su correo y su NIP al Catálogo («Productos · Águila Catálogo»)', (await page.title()) === 'Productos · Águila Catálogo');
  const enlaces = await page.$$eval('#navegacion a', (l) => l.map((a) => a.pathname));
  v.ok('el menú solo tiene el Catálogo: Productos, Recibir mercancía, Captura rápida, Etiquetas y Mis solicitudes; nada del back office',
    JSON.stringify(enlaces) === JSON.stringify(['/catalogo/index.html', '/catalogo/index.html', '/catalogo/inventario.html', '/catalogo/captura.html', '/catalogo/etiquetas.html', '/catalogo/solicitudes.html']), enlaces.join(' '));
  v.ok('arriba dice Catálogo y abajo su nombre y correo, con Cerrar sesión', /Catálogo/.test(await page.textContent('.marca__sub')) && /María López/.test(await page.textContent('.usuario__nombre')) && /maria@aguila\.test/.test(await page.textContent('.usuario__nombre')));
  v.ok('el botón de alta dice «Pedir alta de producto»', /Pedir alta de producto/.test(await page.textContent('#btn-nuevo')));
  await page.screenshot({ path: `${c.SALIDA}/catalogo-productos.png` });

  // ---- editar sin precio
  await page.fill('#busqueda', 'tajin');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#editor[open]');
  const bloqueos = await page.evaluate(() => ({
    precio: document.getElementById('f-precio').readOnly,
    unidad: [...document.querySelectorAll('input[name="unidad"]')].every((r) => r.disabled),
    fiscal: [...document.querySelectorAll('input[name="fiscal"]')].every((r) => r.disabled),
    nota: !document.getElementById('nota-precio').hidden,
    quitar: document.getElementById('btn-desactivar').textContent,
  }));
  v.ok('el precio, la unidad y la clase fiscal están bloqueados, con la nota que lo explica', bloqueos.precio && bloqueos.unidad && bloqueos.fiscal && bloqueos.nota, JSON.stringify(bloqueos));
  v.ok('en lugar de desactivar, «Pedir que se quite»', bloqueos.quitar === 'Pedir que se quite');
  await page.screenshot({ path: `${c.SALIDA}/catalogo-editar.png` });
  await page.fill('#f-presentacion', '150g');
  await page.fill('#f-proveedor', 'Distribuidora del Sur');
  await page.click('#btn-guardar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  let tajin = null;
  for (let i = 0; i < 20 && tajin?.presentacion !== '150g'; i += 1) { tajin = await c.leerDoc('products/p-tajin'); if (tajin?.presentacion !== '150g') await new Promise((r) => setTimeout(r, 300)); }
  v.ok('guarda los datos que no son precio, firmados con su número', tajin?.presentacion === '150g' && tajin.proveedor === 'Distribuidora del Sur' && tajin.precioCentavos === 499 && tajin.actualizadoPor === c.EMPLEADA.codigo, JSON.stringify({ p: tajin?.presentacion, precio: tajin?.precioCentavos, por: tajin?.actualizadoPor }));

  // NUNCA el precio, ni saltándose la pantalla: las reglas lo rechazan
  const intentos = await page.evaluate(async () => {
    const { db, doc, updateDoc, Timestamp } = await import('/js/firebase.js');
    const intentar = async (cambios) => {
      try {
        await updateDoc(doc(db, 'products', 'p-tajin'), { ...cambios, actualizadoEn: Timestamp.fromMillis(Date.now()), actualizadoPor: '100123' });
        return 'aceptado';
      } catch (error) {
        return error.code;
      }
    };
    return {
      precio: await intentar({ precioCentavos: 1 }),
      fiscal: await intentar({ claseFiscal: 'tasaCero' }),
      quitar: await intentar({ activo: false }),
    };
  });
  v.ok('con el SDK de la página, cambiar el precio, la clase fiscal o quitar el producto se rechaza (reglas)', intentos.precio === 'permission-denied' && intentos.fiscal === 'permission-denied' && intentos.quitar === 'permission-denied', JSON.stringify(intentos));
  tajin = await c.leerDoc('products/p-tajin');
  v.ok('el precio sigue intacto', tajin.precioCentavos === 499 && tajin.claseFiscal === 'gravado' && tajin.activo === true);

  // ---- pedir que se quite un producto
  await page.fill('#busqueda', 'coca');
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#editor[open]');
  await page.click('#btn-desactivar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  let solicitudes = [];
  for (let i = 0; i < 20 && solicitudes.length < 1; i += 1) { solicitudes = [...(await c.leerColeccion('solicitudes')).values()]; if (solicitudes.length < 1) await new Promise((r) => setTimeout(r, 300)); }
  const baja = solicitudes.find((s) => s.tipo === 'baja');
  v.ok('la baja queda como solicitud pendiente con su motivo; el producto sigue activo hasta que el admin decida',
    baja?.productoId === 'p-coca' && baja.estado === 'pendiente' && baja.motivo === 'Ya no la surte el proveedor' && baja.creadaPor === c.EMPLEADA.codigo && (await c.leerDoc('products/p-coca')).activo === true, JSON.stringify(baja));

  // ---- pedir el alta de un producto nuevo, sin precio
  await page.fill('#busqueda', GALLETAS);
  await page.press('#busqueda', 'Enter');
  await page.waitForSelector('#oferta-crear:not([hidden])');
  v.ok('un UPC que no existe ofrece «Pedir alta con este UPC»', /Pedir alta con este UPC/.test(await page.textContent('#oferta-crear-btn')));
  await page.click('#oferta-crear-btn');
  await page.waitForSelector('#editor[open]');
  const formaAlta = await page.evaluate(() => ({
    titulo: document.getElementById('editor-titulo').textContent,
    precioOculto: document.getElementById('f-precio').closest('.campo').hidden,
    fiscalOculto: document.querySelector('input[name="fiscal"]').closest('fieldset').hidden,
    nota: document.getElementById('nota-precio').textContent.trim(),
    boton: document.getElementById('btn-guardar').textContent.trim(),
  }));
  v.ok('la solicitud de alta no tiene precio ni clase fiscal y explica que los pone el admin',
    /Pedir alta · UPC 075010006113/.test(formaAlta.titulo) && formaAlta.precioOculto && formaAlta.fiscalOculto && /los pone un administrador/.test(formaAlta.nota) && /Enviar solicitud/.test(formaAlta.boton), JSON.stringify(formaAlta));
  await page.fill('#f-marca', 'GAMESA');
  await page.fill('#f-nombre', 'MARIAS');
  await page.fill('#f-presentacion', '170g');
  await page.screenshot({ path: `${c.SALIDA}/catalogo-pedir-alta.png` });
  await page.click('#btn-guardar');
  await page.waitForFunction(() => !document.getElementById('editor').open, null, { timeout: 20000 });
  for (let i = 0; i < 20 && solicitudes.length < 2; i += 1) { solicitudes = [...(await c.leerColeccion('solicitudes')).values()]; if (solicitudes.length < 2) await new Promise((r) => setTimeout(r, 300)); }
  const alta = solicitudes.find((s) => s.tipo === 'alta');
  v.ok('el alta queda pendiente, sin ningún campo de precio', alta?.estado === 'pendiente' && alta.producto?.upc === GALLETAS && alta.producto.nombre === 'MARIAS' && !('precioCentavos' in alta.producto) && !('claseFiscal' in alta.producto) && !(await c.leerColeccion('products')).has(GALLETAS), JSON.stringify(alta));
  await page.fill('#busqueda', GALLETAS);
  await page.press('#busqueda', 'Enter');
  await page.waitForFunction(() => /Ya se pidió el alta del UPC 075010006113/.test(document.getElementById('aviso-busqueda').textContent), null, { timeout: 15000 });
  v.ok('volver a escanearlo avisa que ya se pidió (falta el precio del admin)', true);

  // ---- captura rápida: sin precio, Enter en la presentación envía la solicitud
  await page.click('#navegacion a[href$="catalogo/captura.html"]');
  await page.waitForURL(/\/catalogo\/captura\.html$/);
  await page.waitForSelector('#contenido:not([hidden])');
  v.ok('en la captura rápida no hay precio ni clase fiscal', await page.isHidden('#c-precio') && await page.isHidden('input[name="clase"]'));
  await page.fill('#c-upc', CAPTURA);
  await page.press('#c-upc', 'Enter');
  await page.waitForFunction(() => /sin precio/.test(document.getElementById('banner').textContent), null, { timeout: 15000 });
  await page.fill('#c-nombre', 'CAFE CLASICO');
  await page.press('#c-nombre', 'Enter');
  await page.fill('#c-marca', 'NESCAFE');
  await page.press('#c-marca', 'Enter');
  await page.fill('#c-presentacion', '200g');
  await page.press('#c-presentacion', 'Enter');
  await page.waitForFunction(() => /Solicitud de alta enviada/.test(document.getElementById('bitacora').textContent), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#bitacora .estado')?.textContent === '✓', null, { timeout: 15000 });
  v.ok('la captura rápida envía la solicitud de alta y la confirma en la bitácora', /sin precio/.test(await page.textContent('#bitacora')));
  await page.screenshot({ path: `${c.SALIDA}/catalogo-captura.png` });

  // ---- etiquetas: el personal del Catálogo imprime y queda anotado el precio vigente
  await page.click('#navegacion a[href$="catalogo/etiquetas.html"]');
  await page.waitForURL(/\/catalogo\/etiquetas\.html$/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('#grupos .grupo').length > 0, null, { timeout: 15000 });
  await page.keyboard.press('Alt+a');
  await page.keyboard.press('Alt+p');
  await page.waitForSelector('#vista:not([hidden])');
  await page.evaluate(() => { window.print = () => setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); });
  await page.click('#btn-imprimir');
  await page.waitForSelector('#confirmacion:not([hidden])');
  await page.click('#btn-confirmar');
  let tajinImpreso = null;
  for (let i = 0; i < 20 && tajinImpreso?.ultimoPrecioImpresoCentavos !== 499; i += 1) { tajinImpreso = await c.leerDoc('products/p-tajin'); if (tajinImpreso?.ultimoPrecioImpresoCentavos !== 499) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('imprime etiquetas: queda anotado el precio impreso (el vigente), sin tocar el precio', tajinImpreso?.ultimoPrecioImpresoCentavos === 499 && tajinImpreso.precioCentavos === 499 && tajinImpreso.actualizadoPor === c.EMPLEADA.codigo, JSON.stringify({ impreso: tajinImpreso?.ultimoPrecioImpresoCentavos, por: tajinImpreso?.actualizadoPor }));

  // ---- recibir mercancía: el personal registra lo que llegó; anularlo es del admin
  await page.click('#navegacion a[href$="catalogo/inventario.html"]');
  await page.waitForURL(/\/catalogo\/inventario\.html$/);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForTimeout(1500); // el catálogo se sincroniza
  v.ok('«Recibir mercancía» abre en el Catálogo («Recibir mercancía · Águila Catálogo»)', (await page.title()) === 'Recibir mercancía · Águila Catálogo' && (await page.textContent('h1')) === 'Recibir mercancía', await page.title());
  await page.fill('#r-codigo', '6*633148100013');
  await page.press('#r-codigo', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-lineas tbody tr').length === 1, null, { timeout: 10000 });
  await page.fill('#r-proveedor', 'Distribuidora del Sur');
  await page.fill('#r-referencia', 'REM-77');
  await page.click('#btn-registrar');
  await page.waitForFunction(() => /Entrada registrada/.test(document.getElementById('mensaje').textContent), null, { timeout: 15000 });
  const recibida = [...(await c.leerColeccion('recepciones')).entries()][0];
  v.ok('registra la entrega firmada con su número (las reglas la aceptan)', recibida?.[1].recibidoPor === c.EMPLEADA.codigo && recibida[1].piezas === 6 && recibida[1].lineas[0].producto === 'p-tajin' && recibida[1].proveedor === 'Distribuidora del Sur', JSON.stringify(recibida ?? []).slice(0, 240));
  await page.waitForFunction(() => document.querySelectorAll('#tabla-entregas tbody tr').length === 1, null, { timeout: 15000 });
  v.ok('ve lo que llegó por producto', /TAJIN CLASICO[\s\S]*6 piezas/.test(await page.textContent('#tabla-productos tbody')));
  await page.click('#tabla-entregas tbody tr');
  await page.waitForSelector('dialog.editor--entrega[open]');
  v.ok('abre la entrega pero sin «Anular entrada»', /REM-77/.test(await page.textContent('dialog.editor--entrega')) && (await page.$$('#btn-anular-entrega')).length === 0);
  await page.screenshot({ path: `${c.SALIDA}/catalogo-recibir.png`, fullPage: true });
  await page.click('dialog.editor--entrega [data-cerrar]');
  const anularPersonal = await page.evaluate(async (id) => {
    const { db, doc, updateDoc, serverTimestamp } = await import('/js/firebase.js');
    try {
      await updateDoc(doc(db, 'recepciones', id), { anulada: true, anuladaPor: '100123', anuladaEn: serverTimestamp() });
      return 'aceptado';
    } catch (error) {
      return error.code;
    }
  }, recibida?.[0]);
  v.ok('con el SDK de la página, anular la entrega se rechaza (reglas)', anularPersonal === 'permission-denied', anularPersonal);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill('#r-codigo', '049000006346');
  await page.press('#r-codigo', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-lineas tbody tr').length === 1, null, { timeout: 10000 });
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  v.ok('en el teléfono, «Recibir mercancía» cabe sin desplazarse de lado', desborde <= 0, String(desborde));
  await page.screenshot({ path: `${c.SALIDA}/catalogo-recibir-movil.png`, fullPage: true });
  await page.click('#btn-descartar');
  await page.setViewportSize({ width: 1280, height: 820 });

  // ---- mis solicitudes
  await page.click('#navegacion a[href$="catalogo/solicitudes.html"]');
  await page.waitForURL(/\/catalogo\/solicitudes\.html$/);
  await page.waitForFunction(() => document.querySelectorAll('#tabla-mias tbody tr').length === 3, null, { timeout: 15000 });
  v.ok('«Mis solicitudes» lista las tres, pendientes', (await page.$$eval('#tabla-mias tbody tr', (trs) => trs.filter((tr) => /Pendiente/.test(tr.textContent)).length)) === 3);

  // ---- y al back office, nada: es otra sesión y ahí no la dejan entrar
  await page.goto(`${c.BASE}/index.html`);
  await page.waitForURL(/\/login\.html/, { timeout: 20000 });
  const rechazo = await c.entrar(page, c.EMPLEADA.correo, c.EMPLEADA.nip, { esperarError: true });
  v.ok('el back office no la deja pasar: su sesión del Catálogo no sirve allá y con su correo y NIP se le rechaza', /solo para administradores/.test(rechazo), rechazo);
  await page.goto(`${c.BASE}/solicitudes.html`);
  await page.waitForURL(/\/login\.html/, { timeout: 20000 });
  v.ok('las Solicitudes del back office tampoco se abren desde el Catálogo', true);

  // ---- el admin resuelve en el back office
  const admin = await c.nuevaPagina(browser, { viewport: { width: 1440, height: 900 } });
  await c.entrar(admin.page, c.ADMIN.correo, c.ADMIN.contrasena);
  await admin.page.waitForFunction(() => document.querySelector('nav a[href$="solicitudes.html"] .nav-insignia')?.textContent === '3', null, { timeout: 15000 });
  v.ok('la barra lateral del back office avisa: 3 solicitudes pendientes', true);
  await admin.page.click('nav a[href$="solicitudes.html"]');
  await admin.page.waitForURL(/\/solicitudes\.html$/);
  await admin.page.waitForFunction(() => document.querySelectorAll('#lista-pendientes .solicitud').length === 3, null, { timeout: 15000 });
  await admin.page.screenshot({ path: `${c.SALIDA}/catalogo-solicitudes-admin.png`, fullPage: true });
  const tarjetaAlta = admin.page.locator('.solicitud', { hasText: 'MARIAS' });
  await tarjetaAlta.locator('button', { hasText: 'Agregar al catálogo' }).click();
  await admin.page.waitForFunction(() => /Precio/.test(document.querySelector('.solicitud .solicitud__aviso:not([hidden])')?.textContent ?? ''), null, { timeout: 10000 });
  v.ok('sin precio no se agrega', true);
  await tarjetaAlta.locator('input[inputmode="decimal"]').first().fill('3.49');
  await tarjetaAlta.locator('button', { hasText: 'Agregar al catálogo' }).click();
  await admin.page.waitForFunction(() => /clase fiscal/.test(document.querySelector('.solicitud .solicitud__aviso:not([hidden])')?.textContent ?? ''), null, { timeout: 10000 });
  v.ok('sin clase fiscal tampoco: hay que elegirla', true);
  await tarjetaAlta.locator('input[value="gravado"]').check();
  await tarjetaAlta.locator('button', { hasText: 'Agregar al catálogo' }).click();
  await admin.page.waitForFunction(() => document.querySelectorAll('#lista-pendientes .solicitud').length === 2, null, { timeout: 15000 });
  // la tarjeta se va con la escritura local; se espera a que el servidor tenga el lote
  let nuevo = null;
  for (let i = 0; i < 30 && !nuevo; i += 1) {
    nuevo = [...(await c.leerColeccion('products')).values()].find((p) => p.upc === GALLETAS) ?? null;
    if (!nuevo) await new Promise((r) => setTimeout(r, 300));
  }
  v.ok('aprobada el alta: el producto entra al catálogo con el precio del admin, activo y firmado por él',
    nuevo?.precioCentavos === 349 && nuevo.claseFiscal === 'gravado' && nuevo.activo === true && nuevo.nombre === 'MARIAS' && nuevo.marca === 'GAMESA' && nuevo.actualizadoPor === c.ADMIN.correo, JSON.stringify(nuevo));

  await admin.page.locator('.solicitud', { hasText: 'COCA' }).locator('button', { hasText: 'Quitar del catálogo' }).click();
  await admin.page.waitForFunction(() => document.querySelectorAll('#lista-pendientes .solicitud').length === 1, null, { timeout: 15000 });
  let coca = null;
  for (let i = 0; i < 30 && coca?.activo !== false; i += 1) { coca = await c.leerDoc('products/p-coca'); if (coca?.activo !== false) await new Promise((r) => setTimeout(r, 300)); }
  v.ok('aprobada la baja: el producto queda inactivo (fuera de la caja, la consulta y las etiquetas)', coca?.activo === false);

  admin.page.respuestaPrompt = 'Ya lo tenemos con otro código';
  await admin.page.locator('.solicitud', { hasText: 'CAFE' }).locator('button', { hasText: 'Rechazar' }).click();
  await admin.page.waitForSelector('#sin-pendientes:not([hidden])', { timeout: 15000 });
  v.ok('rechazada con una nota: no entra nada al catálogo', ![...(await c.leerColeccion('products')).values()].some((p) => p.upc === CAPTURA));
  await admin.page.waitForFunction(() => document.querySelectorAll('#tabla-resueltas tbody tr').length === 3, null, { timeout: 15000 });
  v.ok('las resueltas quedan en el historial con quién las resolvió', /Agregado/.test(await admin.page.textContent('#tabla-resueltas')) && /Quitado/.test(await admin.page.textContent('#tabla-resueltas')) && /Rechazada/.test(await admin.page.textContent('#tabla-resueltas')));
  erroresTotales.push(...admin.errores);
  await admin.ctx.close();

  // ---- la empleada ve el resultado y el producto nuevo con su precio
  await page.goto(`${c.BASE}/catalogo/solicitudes.html`);
  await page.waitForFunction(() => /Agregado al catálogo/.test(document.getElementById('tabla-mias').textContent) && /Rechazada/.test(document.getElementById('tabla-mias').textContent), null, { timeout: 20000 });
  v.ok('en «Mis solicitudes» ve agregado, quitado y rechazado con la nota del admin', /Quitado del catálogo/.test(await page.textContent('#tabla-mias')) && /Ya lo tenemos con otro código/.test(await page.textContent('#tabla-mias')));
  await page.screenshot({ path: `${c.SALIDA}/catalogo-mis-solicitudes.png` });
  await page.goto(`${c.BASE}/catalogo/index.html`);
  await page.waitForFunction(() => /sincronizado/.test(document.getElementById('estado-catalogo').textContent), null, { timeout: 20000 });
  await page.fill('#busqueda', 'marias');
  await page.waitForFunction(() => /\$3\.49/.test(document.getElementById('resultados').textContent), null, { timeout: 15000 });
  v.ok('el producto aprobado ya está en el Catálogo con su precio', true);

  // ---- una administradora con NIP: entra al back office con correo + NIP y cambia su propio NIP en Mi cuenta
  const rosa = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 860 } });
  await c.entrar(rosa.page, ROSA.correo, ROSA.nip);
  v.ok('una administradora con NIP entra al back office con su correo y su NIP', /Rosa Méndez/.test(await rosa.page.textContent('#navegacion')));
  await rosa.page.goto(`${c.BASE}/cuenta.html`);
  await rosa.page.waitForSelector('#contenido:not([hidden])');
  v.ok('Mi cuenta muestra su correo y su número, y ofrece cambiar el NIP', /rosa@aguila\.test/.test(await rosa.page.textContent('#datos-cuenta')) && /100150/.test(await rosa.page.textContent('#datos-cuenta')) && /Cambiar NIP/.test(await rosa.page.textContent('#titulo-secreto')));
  await rosa.page.fill('#s-actual', ROSA.nip);
  await rosa.page.fill('#s-nuevo', c.EMPLEADA.nip);
  await rosa.page.fill('#s-repetir', c.EMPLEADA.nip);
  await rosa.page.click('#s-guardar');
  await rosa.page.waitForFunction(() => /ya lo tiene otra persona/.test(document.getElementById('s-mensaje').textContent), null, { timeout: 15000 });
  v.ok('no puede quedarse con el NIP de otra persona', true);
  await rosa.page.fill('#s-actual', ROSA.nip);
  await rosa.page.fill('#s-nuevo', '864209');
  await rosa.page.fill('#s-repetir', '864209');
  await rosa.page.click('#s-guardar');
  await rosa.page.waitForFunction(() => /NIP cambiado/.test(document.getElementById('s-mensaje').textContent), null, { timeout: 20000 });
  let huellaNueva = null;
  for (let i = 0; i < 20 && !huellaNueva; i += 1) { huellaNueva = await c.leerDoc(`nips/${c.huellaNip('864209')}`); if (!huellaNueva) await new Promise((r) => setTimeout(r, 300)); }
  let huellaVieja = await c.leerDoc(`nips/${c.huellaNip(ROSA.nip)}`);
  for (let i = 0; i < 20 && huellaVieja; i += 1) { await new Promise((r) => setTimeout(r, 300)); huellaVieja = await c.leerDoc(`nips/${c.huellaNip(ROSA.nip)}`); }
  v.ok('su NIP nuevo queda registrado para la caja y el viejo se borra', huellaNueva?.codigo === ROSA.codigo && huellaNueva.version === 1 && huellaVieja === null, JSON.stringify({ huellaNueva, huellaVieja }));
  v.ok('la cuenta ya entra con el NIP nuevo y no con el viejo', (await c.entrarAuthREST(c.correoDeCodigo(ROSA.codigo), '864209')).ok && !(await c.entrarAuthREST(c.correoDeCodigo(ROSA.codigo), ROSA.nip)).ok);
  erroresTotales.push(...rosa.errores);
  await rosa.ctx.close();

  erroresTotales.push(...maria.errores);
  await browser.close();
  v.terminar(erroresTotales);
})().catch((e) => { console.error('EXCEPCIÓN', e); process.exit(1); });
