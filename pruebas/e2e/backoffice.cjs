/**
 * Back office (solo administradores): inicio con las ventas de hoy, diario
 * de ventas con ficha y reimpresión, turnos (verificar y cerrar uno abierto),
 * reportes de un periodo, cajas, configuración del POS y datos del recibo en
 * tiendas. Las ventas y turnos se siembran con los mismos módulos que usa la
 * caja (js/ticket.js y js/turnos.js).
 */
const c = require('./comun.cjs');

const JEFA = { codigo: '100150', nip: '735146', nombre: 'Rosa Méndez' };
const LUIS = { codigo: '100124', nip: '593017', nombre: 'Luis Ortega' };

async function sembrarCodigo({ codigo, nip, nombre, rol = 'empleado', tienda = 'talbot' }) {
  await c.crearCuentaAuth(c.correoDeCodigo(codigo), nip);
  await c.rest('PATCH', `staff/${codigo}`, c.campos(c.ficha({ usuario: codigo, nombre, rol, tienda })));
  await c.rest('PATCH', `accesos/${codigo}`, c.campos({ version: 1 }));
}

const caja = (extra = {}) => ({
  nombre: 'Caja 1', numero: 1, tienda: 'talbot', activo: true,
  turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null,
  actualizadoEn: new Date(), actualizadoPor: c.ADMIN.correo, ...extra,
});

/** Siembra un turno con sus ventas (y lo cierra con resumen si `cierre`). */
async function sembrarTurno(m, { id, persona, cajaId, numeroCaja, cajaNombre, abre, cierre = null, contado = null, ventas: definiciones }) {
  const { lineaDeProducto, lineaDeDepartamento, calcularTicket, registrarPago, armarVenta, folioVenta, claveDia } = m.ticket;
  const productos = {
    tajin: { id: 'p-tajin', upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' },
    coca: { id: 'p-coca', upc: '049000006346', nombre: 'COCA COLA', marca: 'COCA-COLA', presentacion: '355mL', precioCentavos: 199, unidadVenta: 'pieza', claseFiscal: 'gravado' },
    maseca: { id: 'p-maseca', upc: '074734040014', nombre: 'HARINA DE MAIZ', marca: 'MASECA', presentacion: '1.8kg', precioCentavos: 549, unidadVenta: 'pieza', claseFiscal: 'tasaCero' },
    aguacate: { id: 'p-aguacate', plu: '4225', nombre: 'AGUACATE HASS', presentacion: '', precioCentavos: 100, unidadVenta: 'peso', precioPorKgCentavos: 549, claseFiscal: 'tasaCero' },
  };
  const carniceria = { id: 'carniceria', nombre: 'Carnicería', claseFiscal: 'tasaCero' };
  const turno = {
    caja: cajaId, cajaNombre, numeroCaja, tienda: 'talbot', tiendaNombre: 'El Águila Market', cajero: persona.codigo, cajeroNombre: persona.nombre,
    estado: 'abierto', abiertoEn: abre, fondoInicialCentavos: 15000, cerradoEn: null, cerradoPor: null, cierreRegistradoEn: null, cierreForzado: false,
    efectivoContadoCentavos: null, conteo: null, diferenciaCentavos: null, resumen: null, notaCierre: null,
  };
  const ventas = [];
  let numero = m.consecutivo.get(`${cajaId}-${claveDia(abre)}`) ?? 0;
  for (const def of definiciones) {
    numero += 1;
    const lineas = def.lineas.map(([que, cantidad]) => {
      if (que === 'carniceria') return lineaDeDepartamento(carniceria, cantidad);
      if (que === 'aguacate') return lineaDeProducto(productos.aguacate, { pesoGramos: cantidad });
      return lineaDeProducto(productos[que], { cantidad });
    });
    const calculo = calcularTicket(lineas);
    const { pago } = registrarPago(calculo.totalCentavos, [], { metodo: def.metodo, montoCentavos: def.recibido ?? 0 });
    const fecha = new Date(def.fecha);
    const venta = armarVenta(calculo, [pago], {
      folio: folioVenta(fecha, numeroCaja, numero), numero, dia: claveDia(fecha), tipo: 'venta', turno: id, caja: cajaId, cajaNombre, numeroCaja,
      tienda: 'talbot', tiendaNombre: 'El Águila Market', cajero: persona.codigo, cajeroNombre: persona.nombre, fecha,
    });
    ventas.push({ ...venta, registradoEn: fecha });
  }
  m.consecutivo.set(`${cajaId}-${claveDia(abre)}`, numero);
  for (const [i, v] of ventas.entries()) await c.rest('PATCH', `ventas/${id}-v${i + 1}`, c.campos(v));
  if (cierre) {
    const resumen = m.turnos.resumirTurno({ turno: { ...turno, cerradoEn: cierre }, ventas, movimientos: [], hasta: cierre.getTime() });
    Object.assign(turno, {
      estado: 'cerrado', cerradoEn: cierre, cerradoPor: persona.codigo, cierreRegistradoEn: cierre, resumen,
      efectivoContadoCentavos: contado, diferenciaCentavos: contado === null ? null : contado - resumen.efectivo.esperadoCentavos,
    });
  }
  await c.rest('PATCH', `turnos/${id}`, c.campos(turno));
  return { turno, ventas };
}

(async () => {
  const v = c.verificador('backoffice');
  const m = { ticket: await import('../../js/ticket.js'), turnos: await import('../../js/turnos.js'), consecutivo: new Map() };
  await c.borrarTodo();
  await c.sembrarAdmin();
  await c.sembrarTiendas();
  await c.rest('PATCH', 'stores/talbot', c.campos({
    nombre: 'El Águila Market', direccion: '42 Erie St S, Leamington ON N8H 3A9', activo: true,
    telefono: '519-322-4222', correo: 'pleaguila@gmail.com', numeroImpuesto: '81234 5678 RT0001',
  }));
  await c.sembrarEmpleadaCodigo();
  await sembrarCodigo({ ...JEFA, rol: 'admin' });
  await sembrarCodigo(LUIS);
  await c.sembrarCatalogoDemo();
  await c.rest('PATCH', 'cajas/talbot-1', c.campos(caja()));
  await c.rest('PATCH', 'cajas/talbot-2', c.campos(caja({ nombre: 'Caja 2', numero: 2 })));

  const hoy = new Date();
  const en = (diasAtras, hora, minuto = 0) => {
    const f = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasAtras, hora, minuto);
    return f.getTime() > Date.now() ? new Date(Date.now() - 60000) : f;
  };
  const MARIA = { codigo: c.EMPLEADA.codigo, nombre: c.EMPLEADA.nombre };
  // Ayer: dos turnos cerrados
  await sembrarTurno(m, {
    id: 'turno-ayer-maria', persona: MARIA, cajaId: 'talbot-1', numeroCaja: 1, cajaNombre: 'Caja 1', abre: en(1, 8, 0), cierre: en(1, 16, 5), contado: 18000,
    ventas: [
      { fecha: en(1, 9, 10), metodo: 'efectivo', recibido: 2000, lineas: [['tajin', 2], ['maseca', 1]] },
      { fecha: en(1, 10, 30), metodo: 'debito', lineas: [['coca', 6], ['aguacate', 1180]] },
      { fecha: en(1, 12, 5), metodo: 'efectivo', recibido: 5000, lineas: [['carniceria', 2350], ['maseca', 2]] },
      { fecha: en(1, 14, 45), metodo: 'credito', lineas: [['tajin', 1], ['coca', 2]] },
    ],
  });
  await sembrarTurno(m, {
    id: 'turno-ayer-luis', persona: LUIS, cajaId: 'talbot-2', numeroCaja: 2, cajaNombre: 'Caja 2', abre: en(1, 12, 0), cierre: en(1, 20, 0), contado: 16585,
    ventas: [
      { fecha: en(1, 13, 20), metodo: 'efectivo', recibido: 1000, lineas: [['coca', 3]] },
      { fecha: en(1, 17, 40), metodo: 'debito', lineas: [['maseca', 3], ['tajin', 1]] },
    ],
  });
  // Hoy: Luis cerró en la mañana; María sigue abierta en Caja 1
  const luisHoy = await sembrarTurno(m, {
    id: 'turno-hoy-luis', persona: LUIS, cajaId: 'talbot-2', numeroCaja: 2, cajaNombre: 'Caja 2', abre: en(0, 7, 0), cierre: en(0, 12, 0), contado: 15000 + 1810,
    ventas: [
      { fecha: en(0, 7, 40), metodo: 'efectivo', recibido: 2000, lineas: [['tajin', 3]] },
      { fecha: en(0, 9, 15), metodo: 'credito', lineas: [['maseca', 4], ['coca', 1]] },
    ],
  });
  const mariaHoy = await sembrarTurno(m, {
    id: 'turno-hoy-maria', persona: MARIA, cajaId: 'talbot-1', numeroCaja: 1, cajaNombre: 'Caja 1', abre: en(0, 8, 2),
    ventas: [
      { fecha: en(0, 8, 30), metodo: 'efectivo', recibido: 2000, lineas: [['coca', 2], ['tajin', 1]] },
      { fecha: en(0, 9, 50), metodo: 'debito', lineas: [['carniceria', 1875], ['aguacate', 950]] },
      { fecha: en(0, 11, 20), metodo: 'efectivo', recibido: 3000, lineas: [['maseca', 3], ['tajin', 2]] },
      { fecha: en(0, 13, 5), metodo: 'credito', lineas: [['coca', 12]] },
      { fecha: en(0, 15, 45), metodo: 'efectivo', recibido: 2000, lineas: [['tajin', 2], ['aguacate', 640]] },
    ],
  });
  await c.rest('PATCH', 'cajas/talbot-1', c.campos(caja({ turnoActual: 'turno-hoy-maria', turnoCajero: MARIA.codigo, turnoCajeroNombre: MARIA.nombre, turnoDesde: en(0, 8, 2) })));
  const totalHoy = [...luisHoy.ventas, ...mariaHoy.ventas].reduce((acc, x) => acc + x.totalCentavos, 0);
  const ventaAyer = (await c.leerDoc('ventas/turno-ayer-maria-v2'));

  const browser = await c.abrirNavegador();
  const { ctx, page, errores } = await c.nuevaPagina(browser, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(() => {
    window.__impresiones = [];
    window.print = () => {
      const zona = document.getElementById('zona-impresion');
      window.__impresiones.push(zona && document.body.classList.contains('imprimiendo') ? zona.innerText : 'PAGINA');
    };
  });
  const ultimaImpresion = async () => (await page.evaluate(() => window.__impresiones)).at(-1) ?? '';

  // ---- 1) una empleada no entra al back office
  const mensaje = await c.entrar(page, c.EMPLEADA.codigo, c.EMPLEADA.nip, { esperarError: true });
  v.ok('una empleada no entra al back office y se le dice a dónde ir', /solo para administradores/.test(mensaje) && await page.isVisible('a[href="caja/"]'), mensaje);

  // ---- 2) inicio
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  await page.waitForFunction(() => document.getElementById('kpi-total').textContent !== '—', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  v.ok('el inicio suma las ventas de hoy de todas las cajas', (await page.textContent('#kpi-total')) === m.ticket.formatearMonto(totalHoy), `${await page.textContent('#kpi-total')} vs ${m.ticket.formatearMonto(totalHoy)}`);
  v.ok('cuenta los tickets de hoy', (await page.textContent('#kpi-tickets')) === '7');
  v.ok('la gráfica por hora tiene columnas con su tooltip accesible', (await page.$$('#grafica-horas .grafica__barra')).length >= 5 && /^08:00: \$[\d.,]+, 1 ticket$/.test(await page.getAttribute('#grafica-horas .grafica__columna:nth-of-type(3)', 'aria-label') ?? ''), await page.getAttribute('#grafica-horas .grafica__columna:nth-of-type(3)', 'aria-label'));
  v.ok('la caja abierta aparece con su cajera', /María López/.test(await page.textContent('#lista-cajas')) && /Abierta/.test(await page.textContent('#lista-cajas')));
  v.ok('la barra lateral muestra las secciones del back office', await page.isVisible('nav a[href$="ventas.html"]') && await page.isVisible('nav a[href$="gestion/configuracion.html"]') && await page.isVisible('.nav-caja'));
  await page.hover('#grafica-horas .grafica__columna:nth-of-type(3)');
  await page.screenshot({ path: `${c.SALIDA}/bo-inicio.png`, fullPage: true });
  await page.click('#tabla-ultimos tbody tr');
  await page.waitForSelector('dialog.editor--ticket[open]');
  v.ok('un ticket abre su ficha con el recibo', /EL ÁGUILA MARKET/i.test(await page.textContent('dialog.editor--ticket .recibo')));
  await page.screenshot({ path: `${c.SALIDA}/bo-ticket.png` });
  await page.click('dialog.editor--ticket [data-reimprimir]');
  v.ok('la reimpresión sale marcada como copia', /COPIA/.test(await ultimaImpresion()));
  await page.click('dialog.editor--ticket [data-cerrar]');

  // ---- 3) ventas
  await page.goto(`${c.BASE}/ventas.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-ventas tbody tr').length === 7, null, { timeout: 20000 });
  v.ok('el diario muestra los 7 tickets de hoy', true);
  await page.selectOption('#f-caja', 'talbot-2');
  v.ok('el filtro por caja deja los de Caja 2', (await page.$$('#tabla-ventas tbody tr')).length === 2 && /2 de 7/.test(await page.textContent('#contador')));
  await page.selectOption('#f-caja', '');
  await page.screenshot({ path: `${c.SALIDA}/bo-ventas.png`, fullPage: true });
  await page.fill('#f-folio', ventaAyer.folio.replace(/-/g, ''));
  await page.press('#f-folio', 'Enter');
  await page.waitForSelector('dialog.editor--ticket[open]', { timeout: 15000 });
  v.ok('escanear el folio de un recibo de ayer lo encuentra y cambia de día', (await page.inputValue('#f-dia')) === ventaAyer.dia && new RegExp(ventaAyer.folio).test(await page.textContent('dialog.editor--ticket h2')));
  await page.click('dialog.editor--ticket [data-cerrar]');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
  v.ok('exporta el día a CSV', /ventas-\d{4}-\d{2}-\d{2}\.csv/.test(descarga.suggestedFilename()));

  // ---- 4) turnos
  await page.goto(`${c.BASE}/turnos.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-turnos tbody tr').length === 4, null, { timeout: 20000 });
  v.ok('el periodo trae los 4 turnos y el abierto arriba', (await page.$$('#tabla-abiertos tbody tr')).length === 1 && /María/.test(await page.textContent('#tabla-abiertos')));
  v.ok('marca el faltante y el sobrante', /Faltante/.test(await page.textContent('#tabla-turnos')) && /Sobrante|Cuadra/.test(await page.textContent('#tabla-turnos')));
  await page.screenshot({ path: `${c.SALIDA}/bo-turnos.png`, fullPage: true });
  await page.click('#tabla-turnos tbody tr:has-text("Luis Ortega"):has-text("12:00")');
  await page.waitForSelector('dialog.editor--turno[open]');
  await page.click('dialog.editor--turno button:has-text("Verificar")');
  v.ok('verificar un turno cerrado: cuadra con sus tickets', /Cuadra/.test(await page.textContent('dialog.editor--turno .mensaje')));
  await page.screenshot({ path: `${c.SALIDA}/bo-turno-detalle.png` });
  await page.click('dialog.editor--turno button:has-text("Imprimir corte Z")');
  v.ok('reimprime el corte Z con horas', /CIERRE DE TURNO \(Z\)[\s\S]*Horas en caja[\s\S]*5 h 00 min/.test(await ultimaImpresion()));
  await page.click('dialog.editor--turno [data-cerrar]');
  await page.click('#tabla-abiertos tbody tr');
  await page.waitForSelector('dialog.editor--turno[open]');
  await page.click('dialog.editor--turno button:has-text("Cerrar este turno")');
  await page.waitForSelector('#cierre-contado');
  await page.fill('#cierre-contado', '180.00');
  await page.click('dialog.editor--angosto button[type="submit"]');
  await page.waitForFunction(() => /Cerrado por admin/.test(document.querySelector('dialog.editor--turno[open] h2')?.textContent ?? ''), null, { timeout: 20000 });
  const cerrado = await c.leerDoc('turnos/turno-hoy-maria');
  const cajaLibre = await c.leerDoc('cajas/talbot-1');
  v.ok('el admin cierra el turno abierto: queda cerrado a su nombre y la caja libre', cerrado.estado === 'cerrado' && cerrado.cierreForzado === true && cerrado.cerradoPor === c.ADMIN.correo && cerrado.efectivoContadoCentavos === 18000 && cerrado.resumen?.ventas === 5 && cajaLibre.turnoActual === null);
  await page.click('dialog.editor--turno [data-cerrar]');

  // ---- 5) reportes
  await page.goto(`${c.BASE}/reportes.html?desde=${m.ticket.claveDia(en(1, 0))}&hasta=${m.ticket.claveDia(hoy)}`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-personas tbody tr').length >= 2, null, { timeout: 20000 });
  const turnosCerrados = [...(await c.leerColeccion('turnos')).values()].filter((t) => t.estado === 'cerrado');
  const vendido = turnosCerrados.reduce((acc, t) => acc + t.resumen.totalCentavos, 0);
  v.ok('el reporte suma los 4 turnos cerrados', (await page.textContent('#k-total')) === m.ticket.formatearMonto(vendido), `${await page.textContent('#k-total')} vs ${m.ticket.formatearMonto(vendido)}`);
  v.ok('por persona: María y Luis con horas y ventas', /María López[\s\S]*Luis Ortega|Luis Ortega[\s\S]*María López/.test(await page.textContent('#tabla-personas')) && /h \d\d min/.test(await page.textContent('#tabla-personas')));
  v.ok('impuestos para la contabilidad', /HST cobrado/.test(await page.textContent('#lista-impuestos')));
  v.ok('productos más vendidos', (await page.$$('#tabla-productos tbody tr')).length >= 4);
  await page.screenshot({ path: `${c.SALIDA}/bo-reportes.png`, fullPage: true });
  await page.click('#btn-imprimir');
  v.ok('el reporte se imprime como página', (await ultimaImpresion()) === 'PAGINA');

  // ---- 6) cajas
  await page.goto(`${c.BASE}/gestion/cajas.html`);
  await page.waitForSelector('#tabla-cajas tbody tr');
  v.ok('propone el siguiente número de caja', (await page.inputValue('#c-numero')) === '3' && (await page.inputValue('#c-nombre')) === 'Caja 3');
  await page.click('#c-guardar');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-cajas tbody tr').length === 3 && /creada/.test(document.getElementById('c-mensaje').textContent), null, { timeout: 15000 });
  v.ok('crea la caja 3 libre', (await c.leerDoc('cajas/talbot-3'))?.turnoActual === null);
  await page.screenshot({ path: `${c.SALIDA}/bo-cajas.png`, fullPage: true });

  // ---- 7) configuración
  await page.goto(`${c.BASE}/gestion/configuracion.html`);
  await page.waitForSelector('#tabla-deptos tbody tr');
  await page.waitForSelector('#vista-recibo .recibo');
  v.ok('muestra los valores de fábrica y la vista previa del recibo', (await page.inputValue('#k-tasa')) === '13' && /EL ÁGUILA MARKET/i.test(await page.textContent('#vista-recibo')));
  await page.fill('#k-pie', '¡Gracias por su compra! Vuelva pronto');
  await page.fill('#k-limite', '150');
  await page.click('#btn-agregar-depto');
  const nuevo = page.locator('#tabla-deptos tbody tr').last().locator('input');
  await nuevo.fill('Tortillería');
  v.ok('la vista previa refleja los cambios antes de guardar', /Vuelva pronto/.test(await page.textContent('#vista-recibo')) && /Tortillería/.test(await page.textContent('#vista-deptos')));
  await page.screenshot({ path: `${c.SALIDA}/bo-configuracion.png`, fullPage: true });
  await page.click('#k-guardar');
  await page.waitForFunction(() => /guardada/.test(document.getElementById('k-mensaje').textContent), null, { timeout: 15000 });
  const config = await c.leerDoc('config/pos');
  v.ok('guarda config/pos (las reglas lo aceptan)', config?.limiteVentaLibreCentavos === 15000 && config.departamentos.length === 10 && config.departamentos.at(-1).nombre === 'Tortillería' && config.actualizadoPor === c.ADMIN.correo);

  // ---- 8) tiendas
  await page.goto(`${c.BASE}/gestion/tiendas.html`);
  await page.waitForSelector('#tabla-tiendas tbody tr');
  await page.click('#tabla-tiendas tbody tr:has-text("talbot") button:has-text("Editar")');
  await page.fill('#t-telefono', '519-555-0100');
  await page.click('#t-guardar');
  await page.waitForFunction(() => /guardada/.test(document.getElementById('t-mensaje').textContent), null, { timeout: 15000 });
  v.ok('la tienda guarda los datos del encabezado del recibo', (await c.leerDoc('stores/talbot')).telefono === '519-555-0100');

  // ---- 9) pantalla angosta: menú plegado
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${c.BASE}/index.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  v.ok('en pantallas angostas la navegación se pliega tras el botón de menú', await page.isVisible('.menu-boton') && await page.isHidden('#panel-navegacion'));
  await page.screenshot({ path: `${c.SALIDA}/bo-inicio-angosto.png` });

  v.terminar(errores);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
