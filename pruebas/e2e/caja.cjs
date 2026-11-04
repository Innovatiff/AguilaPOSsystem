/**
 * Caja registradora (/caja/): asignar la computadora a una caja (el admin, con
 * su correo; la caja guarda la clave para entrar solo con el NIP), abrir turno
 * SOLO con el NIP y fondo, vender (escáner, PLU por peso, multiplicador, búsqueda por
 * nombre, venta libre por departamento), cobrar con cambio, descuento con
 * autorización de un administrador, devolución, ticket en espera, retiro de
 * efectivo, bloqueo y cierre de turno con conteo y corte Z.
 */
const c = require('./comun.cjs');

const JEFA = { codigo: '100150', nip: '735146', nombre: 'Rosa Méndez', correo: 'rosa@aguila.test' };

const caja = (extra = {}) => ({
  nombre: 'Caja 1', numero: 1, tienda: 'talbot', activo: true,
  turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null,
  actualizadoEn: new Date(), actualizadoPor: c.ADMIN.correo, ...extra,
});

const abierto = (page) => page.locator('dialog[open]').last();
async function pulsarEnDialogo(page, texto) {
  await abierto(page).locator('.dlg__pie button', { hasText: texto }).click();
}
async function escribirEnCaja(page, texto, enter = true) {
  await page.keyboard.type(texto, { delay: 5 });
  if (enter) await page.keyboard.press('Enter');
}
async function teclearNip(page, campo, nip) {
  await page.fill(campo, nip);
}
async function esperarSinDialogo(page) {
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 15000 });
}
const totalTicket = (page) => page.textContent('#tot-total');

(async () => {
  const v = c.verificador('caja');
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
  await c.sembrarProducto('p-aguacate', { plu: '4225', nombre: 'AGUACATE HASS', unidadVenta: 'peso', precioCentavos: 100, precioPorKgCentavos: 549, claseFiscal: 'tasaCero', tiendas: ['talbot'], tokensBusqueda: c.tokens('AGUACATE HASS') });
  await c.rest('PATCH', 'cajas/c1', c.campos(caja()));
  await c.rest('PATCH', 'cajas/c2', c.campos(caja({ nombre: 'Caja 2', numero: 2 })));

  const browser = await c.abrirNavegador();
  const { ctx, page, errores } = await c.nuevaPagina(browser, { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__impresiones = [];
    window.print = () => {
      const zona = document.getElementById('zona-impresion');
      window.__impresiones.push([...(zona?.children ?? [])].map((n) => n.innerText).join('\n---\n'));
    };
  });
  const impresiones = () => page.evaluate(() => window.__impresiones);
  const ultimaImpresion = async () => (await impresiones()).at(-1) ?? '';

  // ---- 1) asignar la computadora a una caja
  await page.goto(`${c.BASE}/caja/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pantalla-configurar:not([hidden])');
  v.ok('sin asignar, la caja pide a un administrador', await page.isVisible('#form-configurar'));
  await page.fill('#config-identificador', c.EMPLEADA.correo);
  await page.fill('#config-secreto', c.EMPLEADA.nip);
  await page.click('#config-entrar');
  await page.waitForSelector('#config-mensaje:not([hidden])');
  v.ok('una empleada no puede asignar la computadora', /Solo un administrador/.test(await page.textContent('#config-mensaje')));
  await page.fill('#config-identificador', JEFA.correo);
  await page.fill('#config-secreto', JEFA.nip);
  await page.click('#config-entrar');
  await page.waitForSelector('#config-cajas:not([hidden]) button');
  v.ok('el admin entra con su correo y su NIP y ve las cajas activas', (await page.$$('#config-cajas button')).length === 2);
  v.ok('la caja guarda la clave de caja para entrar solo con el NIP', (await page.evaluate(() => JSON.parse(localStorage.getItem('aguila.pos.claveCaja')))) === c.CLAVE_CAJA);
  await page.screenshot({ path: `${c.SALIDA}/caja-asignar.png` });
  await page.click('#config-cajas button:has-text("Caja 1")');
  await page.waitForSelector('#pantalla-acceso:not([hidden])');
  v.ok('queda asignada a Caja 1 y muestra la pantalla de acceso', (await page.textContent('#acceso-caja')) === 'Caja 1' && /El Águila Market/.test(await page.textContent('#acceso-tienda')));
  await page.screenshot({ path: `${c.SALIDA}/caja-acceso.png` });

  // ---- 2) abrir turno: solo el NIP
  v.ok('la pantalla de acceso pide solo el NIP', (await page.$$('#form-acceso input')).length === 1);
  await page.click('#teclado-acceso .tecla:has-text("1")');
  v.ok('el teclado en pantalla escribe en el NIP', (await page.inputValue('#acceso-nip')) === '1');
  await page.fill('#acceso-nip', '');
  for (const digito of '503182') await page.click(`#teclado-acceso .tecla:has-text("${digito}")`);
  await page.waitForSelector('#acceso-mensaje:not([hidden])');
  v.ok('un NIP que no es de nadie no entra (con 6 dígitos lo intenta solo)', /NIP incorrecto/.test(await page.textContent('#acceso-mensaje')));
  await page.fill('#acceso-nip', c.EMPLEADA.nip);
  await page.waitForSelector('dialog[open]');
  v.ok('pide el fondo inicial con el sugerido', /Fondo inicial/.test(await abierto(page).textContent('h2')) && (await abierto(page).locator('input').inputValue()) === '150.00');
  await page.screenshot({ path: `${c.SALIDA}/caja-fondo.png` });
  await pulsarEnDialogo(page, 'Abrir turno');
  await page.waitForSelector('#pantalla-venta:not([hidden])', { timeout: 20000 });
  const cajaAbierta = await c.leerDoc('cajas/c1');
  const turnoId = cajaAbierta.turnoActual;
  const turno = turnoId ? await c.leerDoc(`turnos/${turnoId}`) : null;
  v.ok('el turno queda abierto en la caja con su cajera y fondo', turno?.estado === 'abierto' && turno.cajero === c.EMPLEADA.codigo && turno.fondoInicialCentavos === 15000 && cajaAbierta.turnoCajero === c.EMPLEADA.codigo);
  v.ok('se imprimió el comprobante de apertura', /APERTURA DE TURNO[\s\S]*FONDO INICIAL[\s\S]*\$150\.00/.test(await ultimaImpresion()));
  v.ok('la barra muestra la caja y quién atiende', /Caja 1/.test(await page.textContent('#barra-caja')) && /María/.test(await page.textContent('#barra-cajera')));

  // ---- 3) vender
  await page.waitForTimeout(400);
  await escribirEnCaja(page, '633148100013');
  await page.waitForSelector('#ticket-lineas .linea');
  await escribirEnCaja(page, '633148100013');
  await page.waitForFunction(() => /2 ×/.test(document.querySelector('#ticket-lineas .linea')?.textContent ?? ''));
  v.ok('escanear dos veces el mismo producto suma la cantidad en una línea', (await page.$$('#ticket-lineas .linea')).length === 1);
  await escribirEnCaja(page, '3*', false);
  v.ok('3* activa el multiplicador', (await page.textContent('#entrada-multiplicador')).includes('3'));
  await escribirEnCaja(page, '049000006346');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 2);
  v.ok('el multiplicador agrega 3 piezas', /3 × \$1\.99/.test(await page.textContent('#ticket-lineas')));
  await escribirEnCaja(page, 'masec', false);
  await page.waitForSelector('#sugerencias:not([hidden]) .sugerencia');
  v.ok('escribir un nombre muestra sugerencias', /HARINA DE MAIZ/.test(await page.textContent('#sugerencias')));
  await page.screenshot({ path: `${c.SALIDA}/caja-sugerencias.png` });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 3);
  await escribirEnCaja(page, '4225');
  await page.waitForSelector('dialog[open]');
  v.ok('un PLU por peso pide los kilos', /AGUACATE/.test(await abierto(page).textContent('h2')));
  await abierto(page).locator('input').fill('1.250');
  v.ok('la vista previa calcula el importe del peso', /1\.250 kg × \$5\.49\/kg = \$6\.86/.test(await abierto(page).textContent('.dlg__cuerpo')));
  await pulsarEnDialogo(page, 'Agregar');
  await esperarSinDialogo(page);
  await escribirEnCaja(page, '1250', false);
  v.ok('un monto escrito muestra el precio de venta libre', /\$12\.50/.test(await page.textContent('#entrada-monto')));
  await page.click('#deptos button:has-text("Carnicería")');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 5);
  // 2×4.99 + 3×1.99 (gravados) = 15.95 → HST 2.07; 5.49 + 6.86 + 12.50 tasa cero = 24.85 → total 42.87
  v.ok('totales con HST solo sobre lo gravado', (await page.textContent('#tot-subtotal')) === '$40.80' && (await page.textContent('#tot-impuesto')) === '$2.07' && (await totalTicket(page)) === '$42.87');
  v.ok('el total en efectivo se redondea a 5 ¢', (await page.textContent('#tot-efectivo')) === '$42.85');
  await page.screenshot({ path: `${c.SALIDA}/caja-venta.png` });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(200);
  v.ok('en la pantalla de 1024 × 768 todo cabe sin desplazar la página', await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${c.SALIDA}/caja-venta-1024.png` });
  await page.setViewportSize({ width: 1280, height: 800 });

  // anular una línea
  await page.click('#ticket-lineas .linea:has-text("Carnicería")');
  v.ok('tocar una línea muestra sus acciones', await page.isVisible('#acciones-linea'));
  await page.click('#acciones-linea [data-accion="anular-linea"]');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 4);
  v.ok('anular la línea la quita del total', (await totalTicket(page)) === '$30.37');

  // cobrar en efectivo con $50
  await page.keyboard.press('F10');
  await page.waitForSelector('dialog[open] .pago');
  v.ok('el cobro muestra lo que falta en efectivo redondeado', /\$30\.35/.test(await abierto(page).textContent('.pago__cifra--falta')));
  await page.screenshot({ path: `${c.SALIDA}/caja-cobro.png` });
  await abierto(page).locator('.rapidos button', { hasText: '$50.00' }).click();
  await esperarSinDialogo(page);
  await page.waitForSelector('#ticket-cobrado:not([hidden])');
  v.ok('muestra el cambio en grande', (await page.textContent('#cobrado-cambio')) === '$19.65');
  v.ok('se imprimió el recibo con encabezado de la tienda, HST y código de barras', await (async () => {
    const r = await ultimaImpresion();
    return /EL ÁGUILA MARKET[\s\S]*42 Erie St S[\s\S]*519-322-4222[\s\S]*HST # 81234 5678 RT0001[\s\S]*TOTAL[\s\S]*\$30\.37[\s\S]*CAMBIO[\s\S]*\$19\.65/i.test(r);
  })(), (await ultimaImpresion()).slice(0, 160));
  await page.screenshot({ path: `${c.SALIDA}/caja-cambio.png` });
  await page.waitForTimeout(1500);
  const ventas1 = [...(await c.leerColeccion('ventas')).values()];
  const venta1 = ventas1[0];
  v.ok('la venta queda en Firestore con folio, totales y pago', ventas1.length === 1 && /^\d{6}-01-0001$/.test(venta1.folio) && venta1.totalCentavos === 3037 && venta1.porMetodo.efectivo === 3035 && venta1.redondeoCentavos === -2 && venta1.cambioCentavos === 1965 && venta1.lineasAnuladas === 1, JSON.stringify(venta1 ?? {}).slice(0, 200));

  // ---- 4) descuento con autorización de un administrador
  await escribirEnCaja(page, '633148100013');
  await page.waitForSelector('#ticket-cobrado', { state: 'hidden' });
  await page.click('#ticket-lineas .linea');
  await page.click('#acciones-linea [data-accion="descuento-linea"]');
  await page.waitForSelector('dialog[open] .opciones');
  await abierto(page).locator('.rapidos button', { hasText: '10 %' }).click();
  await page.waitForSelector('dialog[open] #aut-nip');
  v.ok('el descuento pide la autorización de un administrador, solo con su NIP', /Autorización/.test(await abierto(page).textContent('h2')) && (await abierto(page).locator('input').count()) === 1);
  await page.screenshot({ path: `${c.SALIDA}/caja-autorizacion.png` });
  await page.fill('#aut-nip', c.EMPLEADA.nip);
  await pulsarEnDialogo(page, 'Autorizar');
  await page.waitForFunction(() => /no es administradora/.test(document.querySelector('dialog[open] .mensaje-pos')?.textContent ?? ''), null, { timeout: 15000 });
  v.ok('una empleada no puede autorizar', true);
  await page.fill('#aut-nip', JEFA.nip);
  await pulsarEnDialogo(page, 'Autorizar');
  await esperarSinDialogo(page);
  v.ok('autorizado: la línea lleva el descuento y el ticket quién autorizó', /Desc\. 10 %/.test(await page.textContent('#ticket-lineas')) && /Rosa/.test(await page.textContent('#ticket-autorizado')));
  // 4.99 − 0.50 = 4.49 → HST 0.58 → 5.07
  v.ok('el total refleja el descuento', (await totalTicket(page)) === '$5.07');
  await page.keyboard.press('F10');
  await page.waitForSelector('dialog[open] .pago');
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await esperarSinDialogo(page);
  await page.waitForSelector('#ticket-cobrado:not([hidden])');
  await page.waitForTimeout(1500);
  const ventas2 = [...(await c.leerColeccion('ventas')).values()].filter((x) => x.numero === 2);
  v.ok('la venta con descuento se guarda con su autorización (las reglas la aceptan)', ventas2.length === 1 && ventas2[0].autorizadoPor === JEFA.codigo && ventas2[0].porMetodo.debito === 507 && ventas2[0].descuentoLineasCentavos === 50);

  // ---- 5) ticket en espera
  await escribirEnCaja(page, '049000006346');
  await page.waitForSelector('#ticket-lineas .linea');
  await page.keyboard.press('F6');
  await page.waitForFunction(() => document.querySelectorAll('#ticket-lineas .linea').length === 0);
  v.ok('F6 pone el ticket en espera', /En espera \(1\)/.test(await page.textContent('#funciones')));
  await page.keyboard.press('F6');
  await page.waitForSelector('dialog[open] .opcion');
  await abierto(page).locator('.opcion').first().click();
  await page.waitForSelector('#ticket-lineas .linea');
  v.ok('y lo recupera', /COCA/.test(await page.textContent('#ticket-lineas')));
  await page.click('#btn-cancelar-ticket');
  await page.waitForSelector('dialog[open]');
  await pulsarEnDialogo(page, 'Cancelar ticket');
  await esperarSinDialogo(page);

  // ---- 6) devolución
  await page.keyboard.press('F8');
  await page.waitForSelector('dialog[open] #folio-original');
  await page.fill('#folio-original', venta1.folio.replace(/-/g, ''));
  await pulsarEnDialogo(page, 'Continuar');
  await page.waitForSelector('dialog[open] #aut-nip');
  await page.fill('#aut-nip', JEFA.nip);
  await pulsarEnDialogo(page, 'Autorizar');
  await esperarSinDialogo(page);
  v.ok('modo devolución visible', await page.isVisible('#ticket-modo') && /DEVOLUCIÓN/.test(await page.textContent('#ticket-modo')));
  await escribirEnCaja(page, '633148100013');
  await page.waitForSelector('#ticket-lineas .linea');
  v.ok('el artículo devuelto va en negativo', (await totalTicket(page)) === '-$5.64' && /Reembolsar/.test(await page.textContent('#btn-cobrar')));
  await page.screenshot({ path: `${c.SALIDA}/caja-devolucion.png` });
  await page.click('#btn-cobrar');
  await page.waitForSelector('dialog[open] .pago');
  await pulsarEnDialogo(page, 'Registrar reembolso');
  await esperarSinDialogo(page);
  await page.waitForSelector('#ticket-cobrado:not([hidden])');
  v.ok('el recibo de devolución lo dice', /DEVOLUCIÓN[\s\S]*TOTAL DEVUELTO/.test(await ultimaImpresion()));
  await page.waitForTimeout(1500);
  const devolucion = [...(await c.leerColeccion('ventas')).values()].find((x) => x.tipo === 'devolucion');
  v.ok('la devolución queda guardada con el ticket original y el reembolso en efectivo', devolucion?.totalCentavos === -564 && devolucion.porMetodo.efectivo === -565 && devolucion.ventaOriginal === venta1.folio);

  // ---- 7) retiro de efectivo y corte X
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  await page.screenshot({ path: `${c.SALIDA}/caja-menu.png` });
  await abierto(page).locator('.menu-funciones button', { hasText: 'Retiro de efectivo' }).click();
  await page.waitForSelector('dialog[open] #movimiento-monto');
  await page.fill('#movimiento-monto', '20');
  await pulsarEnDialogo(page, 'Registrar e imprimir');
  await esperarSinDialogo(page);
  v.ok('el retiro imprime su comprobante', /RETIRO DE EFECTIVO[\s\S]*\$20\.00/.test(await ultimaImpresion()));
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  await abierto(page).locator('.menu-funciones button', { hasText: 'Corte parcial' }).click();
  await page.waitForSelector('dialog[open] .resumen-turno');
  const corteX = await ultimaImpresion();
  v.ok('el corte X sale sin el efectivo esperado (conteo a ciegas)', /CORTE PARCIAL \(X\)/.test(corteX) && !/EFECTIVO EN CAJA/.test(corteX));
  await pulsarEnDialogo(page, 'Volver a vender');
  await esperarSinDialogo(page);

  // ---- 8) bloquear y desbloquear
  await page.click('#btn-bloquear');
  await page.waitForSelector('#dlg-bloqueo[open]');
  await page.screenshot({ path: `${c.SALIDA}/caja-bloqueo.png` });
  await page.fill('#bloqueo-nip', '111111');
  await page.press('#bloqueo-nip', 'Enter');
  await page.waitForFunction(() => /incorrecto/.test(document.querySelector('#dlg-bloqueo .mensaje-pos')?.textContent ?? ''), null, { timeout: 15000 });
  v.ok('un NIP equivocado no desbloquea', await page.isVisible('#dlg-bloqueo'));
  await page.fill('#bloqueo-nip', c.EMPLEADA.nip);
  await page.press('#bloqueo-nip', 'Enter');
  await page.waitForSelector('#dlg-bloqueo', { state: 'detached', timeout: 15000 });
  v.ok('el NIP correcto desbloquea', true);

  // ---- 9) recargar: el turno sigue, bloqueado
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dlg-bloqueo[open]', { timeout: 20000 });
  v.ok('al recargar, el turno sigue abierto y la caja bloqueada', await page.isVisible('#pantalla-venta'));
  await page.fill('#bloqueo-nip', c.EMPLEADA.nip);
  await page.press('#bloqueo-nip', 'Enter');
  await page.waitForSelector('#dlg-bloqueo', { state: 'detached', timeout: 15000 });

  // ---- 10) cerrar turno
  await page.keyboard.press('F9');
  await page.waitForSelector('dialog[open] .menu-funciones');
  await abierto(page).locator('.menu-funciones button', { hasText: 'Cerrar turno' }).click();
  await page.waitForSelector('dialog[open]');
  await pulsarEnDialogo(page, 'Contar el efectivo');
  await page.waitForSelector('dialog[open] .conteo');
  v.ok('el conteo es a ciegas (no muestra lo esperado)', !/esperado/i.test(await abierto(page).textContent('.dlg__cuerpo')));
  // esperado: 150.00 + 30.35 − 5.65 − 20.00 = 154.70 → se cuenta 154.50 (faltan 0.20)
  await abierto(page).locator('input[data-denominacion="10000"]').fill('1');
  await abierto(page).locator('input[data-denominacion="2000"]').fill('2');
  await abierto(page).locator('input[data-denominacion="500"]').fill('2');
  await abierto(page).locator('input[data-denominacion="200"]').fill('2');
  await abierto(page).locator('input[data-denominacion="25"]').fill('2');
  v.ok('el conteo suma las denominaciones', /\$154\.50/.test(await abierto(page).textContent('.conteo__total')));
  await page.screenshot({ path: `${c.SALIDA}/caja-conteo.png` });
  await pulsarEnDialogo(page, 'Continuar');
  await page.waitForSelector('dialog[open] #confirmar-nip');
  await page.fill('#confirmar-nip', c.EMPLEADA.nip);
  await pulsarEnDialogo(page, 'Cerrar turno');
  await page.waitForSelector('dialog[open] .resumen-turno', { timeout: 20000 });
  const z = await ultimaImpresion();
  v.ok('el corte Z trae ventas, horas, formas de pago y la diferencia', /CIERRE DE TURNO \(Z\)[\s\S]*Horas en caja[\s\S]*Efectivo[\s\S]*= Esperado[\s\S]*154\.70[\s\S]*Contado[\s\S]*154\.50[\s\S]*faltante[\s\S]*-0\.20/.test(z), z.slice(0, 120));
  await page.screenshot({ path: `${c.SALIDA}/caja-cierre.png` });
  await pulsarEnDialogo(page, 'Terminar');
  await page.waitForSelector('#pantalla-acceso:not([hidden])');
  await page.waitForTimeout(1200);
  const cerrado = await c.leerDoc(`turnos/${turnoId}`);
  const cajaLibre = await c.leerDoc('cajas/c1');
  v.ok('el turno queda cerrado con su resumen y la caja libre', cerrado?.estado === 'cerrado' && cerrado.efectivoContadoCentavos === 15450 && cerrado.diferenciaCentavos === -20
    && cerrado.resumen?.ventas === 2 && cerrado.resumen?.devoluciones === 1 && cerrado.resumen?.cancelaciones === 1 && cajaLibre.turnoActual === null, JSON.stringify({ e: cerrado?.estado, d: cerrado?.diferenciaCentavos, r: cerrado?.resumen?.ventas }));
  v.ok('vuelve a la pantalla de acceso, sin sesión', /Turno cerrado/.test(await page.textContent('#acceso-mensaje')));

  // ---- 9) movimientos en vivo: cada paso de la caja queda registrado para el back office
  const eventos = [...(await c.leerColeccion('eventos')).values()].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
  const tipos = new Set(eventos.map((e) => e.tipo));
  const esperados = ['turno_abierto', 'venta_iniciada', 'articulo', 'articulo_anulado', 'descuento', 'autorizacion', 'pago', 'venta_completada',
    'espera', 'recuperada', 'venta_cancelada', 'devolucion_iniciada', 'devolucion_completada', 'efectivo', 'turno_cerrado'];
  v.ok('la caja registra sus movimientos en vivo (las reglas los aceptan): turno, artículos, anulación, descuento, autorización, pagos, espera, cancelación, devolución, efectivo y cierre',
    esperados.every((tipo) => tipos.has(tipo)), `faltan: ${esperados.filter((tipo) => !tipos.has(tipo)).join()} · hay: ${[...tipos].join()}`);
  const ticket1 = eventos.find((e) => e.folio === venta1.folio)?.ticket;
  const delTicket1 = eventos.filter((e) => ticket1 && e.ticket === ticket1).map((e) => e.tipo);
  v.ok('los movimientos de una venta comparten su ticket: de «Venta iniciada» a «Venta completada»',
    delTicket1[0] === 'venta_iniciada' && delTicket1.at(-1) === 'venta_completada' && delTicket1.includes('articulo_anulado') && delTicket1.includes('pago'), delTicket1.join());
  const completada1 = eventos.find((e) => e.tipo === 'venta_completada' && e.folio === venta1.folio);
  v.ok('la venta completada dice folio, total, artículos, forma de pago y cambio',
    new RegExp(`^Venta ${venta1.folio} completada — \\$30\\.37 \\(\\d+ artículos, efectivo\\), cambio \\$19\\.65$`).test(completada1?.texto ?? '') && completada1.importeCentavos === 3037, completada1?.texto);
  const pago1 = eventos.find((e) => e.tipo === 'pago' && e.folio === venta1.folio);
  v.ok('el pago dice cuánto entregó y el saldo', /^Efectivo \$50\.00 en \d{6}-01-0001 \(saldo \$0\.00\)$/.test(pago1?.texto ?? ''), pago1?.texto);
  v.ok('cada movimiento lleva quién, en qué caja y en qué turno', eventos.every((e) => e.cajero === c.EMPLEADA.codigo && e.caja === 'c1' && e.cajaNombre === 'Caja 1' && e.turno === turnoId), JSON.stringify(eventos.find((e) => e.cajero !== c.EMPLEADA.codigo || e.caja !== 'c1') ?? {}));
  v.ok('el cierre queda como «Turno cerrado» con lo contado', /contado \$154\.50/.test(eventos.find((e) => e.tipo === 'turno_cerrado')?.texto ?? ''), eventos.find((e) => e.tipo === 'turno_cerrado')?.texto);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${c.SALIDA}/caja-acceso-1024.png` });
  v.terminar(errores);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
