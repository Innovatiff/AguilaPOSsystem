/**
 * Idioma: el botón «English» / «Español». En la caja: asignarla, abrir turno,
 * vender, cobrar y cerrar en inglés, con el recibo, el comprobante de apertura
 * y los cortes X y Z impresos en inglés; cambiar de idioma a media venta no
 * pierde el ticket ni bloquea la caja, y la pantalla del cliente sigue el idioma
 * de la caja. Lo que se guarda (movimientos en vivo) queda en español y el back
 * office lo muestra en el idioma elegido. El idioma vale para todo el sitio en
 * ese equipo (consulta de precios, back office) hasta que se cambie otra vez.
 */
const c = require('./comun.cjs');

const JEFA = { codigo: '100150', nip: '735146', nombre: 'Rosa Méndez', correo: 'rosa@aguila.test' };

const caja = (extra = {}) => ({
  nombre: 'Caja 1', numero: 1, tienda: 'talbot', activo: true,
  turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null,
  actualizadoEn: new Date(), actualizadoPor: c.ADMIN.correo, ...extra,
});

const abierto = (page) => page.locator('dialog[open]').last();
const tituloDialogo = async (page) => (await abierto(page).locator('h2').textContent()).trim();
const pulsarEnDialogo = (page, texto) => abierto(page).locator('.dlg__pie button', { hasText: texto }).click();
async function escribirEnCaja(page, texto, enter = true) {
  await page.keyboard.type(texto, { delay: 5 });
  if (enter) await page.keyboard.press('Enter');
}
const esperarSinDialogo = (page) => page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 15000 });

/** Espera una condición en una página que puede estar recargándose (cambio de idioma). */
async function esperarEn(pagina, condicion, arg = null, ms = 25000) {
  const fin = Date.now() + ms;
  for (;;) {
    try {
      if (await pagina.evaluate(condicion, arg)) return true;
    } catch {
      // recargando: el contexto de la página se reemplazó
    }
    if (Date.now() > fin) throw new Error(`tiempo agotado esperando: ${condicion}`);
    await new Promise((listo) => { setTimeout(listo, 200); });
  }
}

/** Palabras de la interfaz en español que no deben quedar en una pantalla en inglés (los datos sí pueden: «Caja 1», productos, departamentos). */
const ESPANOL = /\b(Cobrar|Buscar|Consultar|Devolución|Bloquear|Atiende|artículos?|Escanea|redondeado|Pagó|Cancelar|Anular|Cantidad|Precio|Descuento|Más|Turno|Efectivo|Recibo|Cambio)\b/;
const espanolEn = (texto) => (ESPANOL.exec(texto) ?? [null])[0];

(async () => {
  const v = c.verificador('idioma');
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.rest('PATCH', 'stores/talbot', c.campos({
    nombre: 'El Águila Market', direccion: '42 Erie St S, Leamington ON N8H 3A9', activo: true,
    telefono: '519-322-4222', correo: 'pleaguila@gmail.com', numeroImpuesto: '81234 5678 RT0001',
  }));
  await c.sembrarClaveCaja();
  await c.sembrarEmpleadaCodigo();
  await c.sembrarEmpleadaCodigo({ ...JEFA, rol: 'admin' });
  await c.sembrarCatalogoDemo();
  await c.rest('PATCH', 'cajas/c1', c.campos(caja()));

  const browser = await c.abrirNavegador();
  const { ctx, page, errores } = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__impresiones = [];
    window.print = () => {
      const zona = document.getElementById('zona-impresion');
      window.__impresiones.push([...(zona?.children ?? [])].map((n) => n.innerText).join('\n---\n'));
    };
  });
  const ultimaImpresion = async () => (await page.evaluate(() => window.__impresiones)).at(-1) ?? '';

  // ---- 1) la caja empieza en español; «English» la pone en inglés y lo recuerda
  await page.goto(`${c.BASE}/caja/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pantalla-configurar:not([hidden])');
  v.ok('la caja empieza en español, con el botón «English» en la barra',
    (await page.textContent('.barra__idioma')).trim() === 'English' && await page.evaluate(() => document.documentElement.lang) === 'es'
    && (await page.textContent('#config-titulo')) === 'Esta computadora todavía no es una caja');
  await page.click('.barra__idioma');
  await esperarEn(page, () => document.documentElement.lang === 'en' && !document.getElementById('pantalla-configurar').hidden && !document.documentElement.classList.contains('i18n-pendiente'));
  await page.waitForSelector('.barra__idioma');
  v.ok('«English» recarga la caja en inglés y lo guarda en este equipo',
    (await page.textContent('#config-titulo')) === 'This computer is not set up as a register yet' && (await page.textContent('#config-entrar')).trim() === 'Continue'
    && /Administrator email/.test(await page.textContent('#form-configurar')) && (await page.textContent('.barra__idioma')).trim() === 'Español'
    && await page.evaluate(() => localStorage.getItem('aguila.idioma')) === 'en' && (await page.title()) === 'Register · Águila POS', await page.title());
  await page.screenshot({ path: `${c.SALIDA}/idioma-caja-configurar.png` });

  // ---- 2) asignar la caja y abrir turno, en inglés
  await page.fill('#config-identificador', JEFA.correo);
  await page.fill('#config-secreto', JEFA.nip);
  await page.click('#config-entrar');
  await page.waitForSelector('#config-cajas:not([hidden]) button');
  v.ok('el administrador elige la caja en inglés', /Which register is this computer\?/.test(await page.textContent('#config-cajas')) && /Available/.test(await page.textContent('#config-cajas')));
  await page.click('#config-cajas button:has-text("Caja 1")');
  await page.waitForSelector('#pantalla-acceso:not([hidden])');
  v.ok('la pantalla de acceso en inglés, con la fecha en inglés',
    (await page.textContent('#acceso-titulo')) === 'Start Shift' && (await page.textContent('#acceso-subtitulo')) === 'Enter your 6-digit PIN.'
    && /Price check/.test(await page.textContent('.acceso__enlaces')) && /Assign this computer to another register/.test(await page.textContent('.acceso__enlaces'))
    && /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2}, \d{4}$/.test(await page.textContent('#acceso-fecha')), await page.textContent('#acceso-fecha'));
  await page.fill('#acceso-nip', '503182');
  await page.waitForSelector('#acceso-mensaje:not([hidden])');
  v.ok('un NIP equivocado: «Incorrect PIN.»', (await page.textContent('#acceso-mensaje')) === 'Incorrect PIN.', await page.textContent('#acceso-mensaje'));
  await page.fill('#acceso-nip', c.EMPLEADA.nip);
  await page.waitForSelector('dialog[open]');
  v.ok('el fondo inicial, en inglés', (await tituloDialogo(page)) === 'Register Opening Float' && /Open shift/.test(await abierto(page).textContent('.dlg__pie')));
  await pulsarEnDialogo(page, 'Open shift');
  await page.waitForSelector('#pantalla-venta:not([hidden])', { timeout: 20000 });
  const apertura = await ultimaImpresion();
  v.ok('el comprobante de apertura se imprime en inglés', /SHIFT OPENING[\s\S]*OPENING FLOAT[\s\S]*\$150\.00/.test(apertura) && !/APERTURA|FONDO/.test(apertura), apertura.replace(/\s+/g, ' ').slice(0, 160));
  v.ok('la barra en inglés: quién atiende y el estado de la red',
    /Cashier:\s*María/.test(await page.textContent('#barra-cajera')) && /^(Online|Syncing \d+…)$/.test(await page.textContent('#barra-estado-texto')), await page.textContent('#barra-estado-texto'));

  // ---- 3) la pantalla del cliente abre en inglés
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  v.ok('«More functions» en inglés', (await tituloDialogo(page)) === 'More functions'
    && /Reprint last ticket[\s\S]*Cash drop[\s\S]*X report \(mid-shift\)[\s\S]*Close shift[\s\S]*Customer display/.test(await abierto(page).textContent('.menu-funciones')));
  await abierto(page).locator('.menu-funciones button', { hasText: 'Customer display' }).click();
  await page.waitForFunction(() => document.getElementById('estado-tableta')?.dataset.activa === 'false', null, { timeout: 10000 });
  v.ok('el diálogo de la pantalla del cliente en inglés', (await page.textContent('#estado-tableta')) === 'Tablet: none paired with this register.'
    && /Use on a tablet/.test(await abierto(page).textContent('.dlg__nota')));
  const [cliente] = await Promise.all([ctx.waitForEvent('page'), pulsarEnDialogo(page, 'Open on this computer')]);
  cliente.on('console', (m) => { if (m.type() === 'error') errores.push(`[cliente] ${m.text()}`); });
  cliente.on('pageerror', (e) => errores.push(`[cliente] ${e.message}`));
  await cliente.waitForLoadState('domcontentloaded');
  await cliente.setViewportSize({ width: 1024, height: 600 });
  await page.bringToFront();
  await cliente.waitForFunction(() => document.getElementById('aviso-titulo')?.textContent === 'Welcome!', null, { timeout: 15000 });
  v.ok('la pantalla del cliente abre en inglés, sin su propio botón de idioma (sigue a la caja)',
    (await cliente.textContent('#atiende')) === 'Your cashier: María' && await cliente.evaluate(() => document.documentElement.lang) === 'en'
    && await cliente.locator('.cliente__idioma').isHidden() && (await cliente.textContent('#btn-completa')) === 'Full screen');

  // ---- 4) vender, en inglés
  await page.waitForTimeout(400);
  await escribirEnCaja(page, '633148100013');
  await page.waitForSelector('#ticket-lineas .linea');
  await escribirEnCaja(page, '049000006346');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 2);
  // 4.99 + 1.99 = 6.98 (con HST) → 0.91 → 7.89; en efectivo 7.90
  v.ok('el ticket en inglés: artículos, botones y totales',
    (await page.textContent('#ticket-articulos')) === '2 items' && (await page.textContent('#btn-cobrar-texto')) === 'Pay' && (await page.textContent('#tot-total')) === '$7.89'
    && /Price check/.test(await page.textContent('#funciones')) && /In cash \(rounded to the nearest 5¢\)/.test(await page.textContent('.ticket__totales'))
    && (await page.textContent('#tot-impuesto-nombre')) === 'HST 13%', await page.textContent('#tot-impuesto-nombre'));
  const pantallaVenta = await page.evaluate(() => `${document.getElementById('barra').innerText}\n${document.getElementById('pantalla-venta').innerText}`);
  v.ok('en la pantalla de venta no queda nada de la interfaz en español', !espanolEn(pantallaVenta), espanolEn(pantallaVenta) ?? '');
  await page.screenshot({ path: `${c.SALIDA}/idioma-caja-venta.png` });
  await cliente.waitForFunction(() => document.querySelectorAll('#lineas .linea-cliente').length === 2, null, { timeout: 10000 });
  v.ok('el cliente ve el ticket en inglés', (await cliente.textContent('#t-efectivo')) === 'In cash: $7.90' && /Items/.test(await cliente.textContent('.totales-cliente'))
    && !espanolEn(await cliente.evaluate(() => document.body.innerText)), espanolEn(await cliente.evaluate(() => document.body.innerText)) ?? '');
  await cliente.screenshot({ path: `${c.SALIDA}/idioma-cliente-venta.png` });

  // ---- 5) cambiar de idioma a media venta: ni se pierde el ticket ni se bloquea la caja
  await cliente.evaluate(() => { window.__antesDelCambio = true; });
  await page.click('.barra__idioma');
  await esperarEn(page, () => document.documentElement.lang === 'es' && !document.getElementById('pantalla-venta').hidden && document.querySelectorAll('#ticket-lineas .linea').length === 2);
  v.ok('a media venta, «Español» recarga la caja en español con el mismo ticket y sin pedir el NIP',
    !(await page.$('#dlg-bloqueo')) && (await page.textContent('#btn-cobrar-texto')) === 'Cobrar' && (await page.textContent('#ticket-articulos')) === '2 artículos'
    && (await page.textContent('.barra__idioma')).trim() === 'English');
  await esperarEn(cliente, () => !window.__antesDelCambio && document.documentElement.lang === 'es' && document.querySelectorAll('#lineas .linea-cliente').length === 2);
  v.ok('y la pantalla del cliente cambia con ella', (await cliente.textContent('#t-efectivo')) === 'En efectivo: $7.90' && (await cliente.textContent('#atiende')) === 'Le atiende María');
  await cliente.evaluate(() => { window.__antesDelCambio = true; });
  await page.click('.barra__idioma');
  await esperarEn(page, () => document.documentElement.lang === 'en' && !document.getElementById('pantalla-venta').hidden && document.querySelectorAll('#ticket-lineas .linea').length === 2);
  v.ok('«English» la regresa al inglés, igual sin bloquear', !(await page.$('#dlg-bloqueo')) && (await page.textContent('#btn-cobrar-texto')) === 'Pay');
  await esperarEn(cliente, () => !window.__antesDelCambio && document.documentElement.lang === 'en' && document.querySelectorAll('#lineas .linea-cliente').length === 2);

  // ---- 6) cobrar en efectivo: el recibo sale en inglés
  await page.keyboard.press('F10');
  await page.waitForSelector('dialog[open] .pago');
  v.ok('el cobro en inglés', (await tituloDialogo(page)) === 'Payment · $7.89' && /Record payment/.test(await abierto(page).textContent('.dlg__pie'))
    && /Cash total \(rounded\)/.test(await abierto(page).textContent('.dlg__cuerpo')), await tituloDialogo(page));
  await cliente.waitForSelector('#cobro:not([hidden])', { timeout: 10000 });
  v.ok('el cliente ve el cobro en inglés', (await cliente.textContent('#c-falta-nombre')) === 'Balance due' && (await cliente.textContent('#c-indicacion')) === 'Payment method: Cash', await cliente.textContent('#c-indicacion'));
  await page.screenshot({ path: `${c.SALIDA}/idioma-caja-cobro.png` });
  await abierto(page).locator('.rapidos button', { hasText: '$10.00' }).click();
  await esperarSinDialogo(page);
  await page.waitForSelector('#ticket-cobrado:not([hidden])');
  v.ok('venta registrada, en inglés', (await page.textContent('#cobrado-titulo')) === 'Sale complete' && (await page.textContent('#cobrado-cambio')) === '$2.10'
    && (await page.textContent('#cobrado-pago')) === 'Cash $10.00' && /Reprint receipt/.test(await page.textContent('#ticket-cobrado')));
  const recibo = await ultimaImpresion();
  v.ok('el recibo se imprime en inglés',
    /Cashier: María[\s\S]*Items: 2[\s\S]*HST 13% on 6\.98[\s\S]*TOTAL[\s\S]*\$7\.89[\s\S]*Cash tendered[\s\S]*10\.00[\s\S]*CHANGE[\s\S]*2\.10[\s\S]*Thank you for your purchase!/.test(recibo)
    && !/Atendió|CAMBIO|Gracias|Artículos|recibido/.test(recibo), recibo.replace(/\s+/g, ' ').slice(200, 700));
  await cliente.waitForSelector('#vista-gracias:not([hidden])', { timeout: 10000 });
  v.ok('el cliente ve el gracias en inglés', (await cliente.textContent('#g-mensaje')) === 'Thank you for your purchase!' && (await cliente.textContent('#g-pagos')) === 'Cash $10.00'
    && (await cliente.textContent('#g-pagos-nombre')) === 'Paid' && /Your change/.test(await cliente.textContent('#vista-gracias')));
  await cliente.screenshot({ path: `${c.SALIDA}/idioma-cliente-gracias.png` });

  // ---- 7) lo que se guarda sigue en español
  await page.waitForTimeout(1500);
  const eventos = [...(await c.leerColeccion('eventos')).values()];
  const completada = eventos.find((e) => e.tipo === 'venta_completada');
  v.ok('los movimientos en vivo se guardan en español aunque la caja venda en inglés',
    /^Venta \d{6}-01-0001 completada — \$7\.89 \(2 artículos, efectivo\), cambio \$2\.10$/.test(completada?.texto ?? '')
    && eventos.find((e) => e.tipo === 'turno_abierto')?.texto === 'Turno abierto con $150.00 de fondo', completada?.texto);

  // ---- 8) corte X y cierre con corte Z, en inglés
  await page.keyboard.press('Enter'); // nuevo ticket
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  await abierto(page).locator('.menu-funciones button', { hasText: 'X report' }).click();
  await page.waitForSelector('dialog[open] .resumen-turno');
  const corteX = await ultimaImpresion();
  v.ok('el corte X se imprime en inglés', /MID-SHIFT REPORT \(X\)[\s\S]*Gross sales[\s\S]*PAYMENT METHODS/.test(corteX) && !/CORTE|Ventas brutas/.test(corteX), corteX.replace(/\s+/g, ' ').slice(0, 200));
  await pulsarEnDialogo(page, 'Back to selling');
  await esperarSinDialogo(page);
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  await abierto(page).locator('.menu-funciones button', { hasText: 'Close shift' }).click();
  await page.waitForSelector('dialog[open]');
  v.ok('cerrar turno, en inglés', (await tituloDialogo(page)) === 'Close Shift' && /You are about to close your shift on Caja 1\./.test(await abierto(page).textContent('.dlg__cuerpo')));
  await pulsarEnDialogo(page, 'Count the cash');
  await page.waitForSelector('dialog[open] .conteo');
  v.ok('el conteo del efectivo, en inglés', (await tituloDialogo(page)) === 'Shift Close · Cash Count' && /Number of \$100/.test(await abierto(page).locator('input[data-denominacion="10000"]').getAttribute('aria-label')));
  // esperado: 150.00 + 7.90 = 157.90
  await abierto(page).locator('input[data-denominacion="10000"]').fill('1');
  await abierto(page).locator('input[data-denominacion="5000"]').fill('1');
  await abierto(page).locator('input[data-denominacion="500"]').fill('1');
  await abierto(page).locator('input[data-denominacion="200"]').fill('1');
  await abierto(page).locator('input[data-denominacion="25"]').fill('3');
  await abierto(page).locator('input[data-denominacion="10"]').fill('1');
  await abierto(page).locator('input[data-denominacion="5"]').fill('1');
  v.ok('el conteo suma las denominaciones', /\$157\.90/.test(await abierto(page).textContent('.conteo__total')), await abierto(page).textContent('.conteo__total'));
  await pulsarEnDialogo(page, 'Continue');
  await page.waitForSelector('dialog[open] #confirmar-nip');
  v.ok('se confirma con el NIP, en inglés', (await tituloDialogo(page)) === 'Confirm Shift Close' && /Your PIN/.test(await abierto(page).textContent('.dlg__cuerpo')));
  await page.fill('#confirmar-nip', c.EMPLEADA.nip);
  await pulsarEnDialogo(page, 'Close shift');
  await page.waitForSelector('dialog[open] .resumen-turno', { timeout: 20000 });
  const z = await ultimaImpresion();
  v.ok('el corte Z se imprime en inglés',
    /SHIFT CLOSE \(Z REPORT\)[\s\S]*Hours on register[\s\S]*PAYMENT METHODS[\s\S]*CASH IN DRAWER[\s\S]*Opening float[\s\S]*= Expected[\s\S]*157\.90[\s\S]*Counted[\s\S]*157\.90[\s\S]*Difference \(balanced\)/.test(z)
    && !/CIERRE|Esperado|Contado|Diferencia|Fondo/.test(z), z.replace(/\s+/g, ' ').slice(0, 300));
  v.ok('y en pantalla, el resumen del turno en inglés', (await tituloDialogo(page)) === 'Shift closed' && /Total sold[\s\S]*Expected cash[\s\S]*Counted/.test(await abierto(page).textContent('.resumen-turno')));
  await page.screenshot({ path: `${c.SALIDA}/idioma-caja-cierre.png` });
  await pulsarEnDialogo(page, 'Done');
  await page.waitForSelector('#pantalla-acceso:not([hidden])');
  v.ok('vuelve a la pantalla de acceso: «Shift closed. Thank you!»', (await page.textContent('#acceso-mensaje')) === 'Shift closed. Thank you!');
  await cliente.waitForFunction(() => document.getElementById('aviso-titulo')?.textContent === 'Register Closed', null, { timeout: 15000 });
  v.ok('la pantalla del cliente dice «Register Closed»', true);

  // ---- 9) el idioma vale en todo el sitio de este equipo: consulta de precios y back office
  await page.goto(`${c.BASE}/caja/consulta.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#form-acceso:not([hidden])');
  v.ok('la consulta de precios también en inglés, con su botón «Español»', (await page.title()) === 'Price Check · Águila POS'
    && /Sign in with your email and your 6-digit PIN\./.test(await page.textContent('#form-acceso')) && (await page.textContent('.consulta__idioma')).trim() === 'Español', await page.title());
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  v.ok('el back office en inglés: menú y botón de idioma', /Live Activity/.test(await page.textContent('nav')) && /Sign out/.test(await page.textContent('body'))
    && (await page.textContent('.nav-idioma')).trim() === 'Español');
  await page.goto(`${c.BASE}/movimientos.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#lista-movimientos li').length > 3, null, { timeout: 20000 });
  const movimientos = await page.textContent('#lista-movimientos');
  v.ok('los movimientos en vivo (guardados en español) se ven en inglés',
    /Sale \d{6}-01-0001 completed — \$7\.89 \(2 items, cash\), change \$2\.10/.test(movimientos) && /Shift opened with a \$150\.00 float/.test(movimientos)
    && /Shift closed — sold \$7\.89, counted \$157\.90, difference \$0\.00/.test(movimientos) && !/completada|Turno abierto/.test(movimientos), movimientos.replace(/\s+/g, ' ').slice(0, 300));
  await page.screenshot({ path: `${c.SALIDA}/idioma-movimientos.png` });

  // ---- 10) «Español» vuelve todo al español
  await page.click('.nav-idioma');
  await esperarEn(page, () => document.documentElement.lang === 'es' && !!document.querySelector('#contenido:not([hidden])'));
  v.ok('«Español» regresa el sitio al español', /Movimientos en vivo/.test(await page.textContent('nav')) && await page.evaluate(() => localStorage.getItem('aguila.idioma')) === 'es');
  await page.waitForFunction(() => document.querySelectorAll('#lista-movimientos li').length > 3, null, { timeout: 20000 });
  v.ok('y los movimientos vuelven a leerse como se guardaron', /Venta \d{6}-01-0001 completada/.test(await page.textContent('#lista-movimientos')));

  v.terminar(errores);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
