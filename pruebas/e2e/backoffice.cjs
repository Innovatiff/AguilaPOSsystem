/**
 * Back office (solo administradores): inicio con las ventas de hoy,
 * transacciones (filtros, ficha con recibo, reimpresión e historial de
 * auditoría, tickets cancelados), movimientos en vivo (y uno que llega
 * mientras se mira), turnos (verificar y cerrar uno abierto), reportes de un
 * periodo, cajas, configuración del POS, datos del recibo en tiendas e
 * inventario (recibir una entrega escaneando, lo que llegó, anular). Las
 * ventas y turnos se siembran con los mismos módulos que usa la caja
 * (js/ticket.js y js/turnos.js).
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

  // Movimientos en vivo de hoy: el turno de María, su primera venta (historial de auditoría) y un ticket cancelado.
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  const haceMin = (minutos) => new Date(Math.max(inicioHoy + 1000 + (120 - minutos) * 10, Date.now() - minutos * 60000 - 5000));
  const ventaConHistorial = mariaHoy.ventas[0];
  const folioHistorial = ventaConHistorial.folio;
  const dinero = m.ticket.formatearMonto;
  const eventoBase = { turno: 'turno-hoy-maria', caja: 'talbot-1', cajaNombre: 'Caja 1', numeroCaja: 1, tienda: 'talbot', cajero: MARIA.codigo, cajeroNombre: MARIA.nombre, ticket: null, folio: null, importeCentavos: null };
  const eventosHoy = [
    { id: 'ev-01', tipo: 'turno_abierto', texto: 'Turno abierto con $150.00 de fondo', importeCentavos: 15000, fecha: haceMin(120) },
    { id: 'ev-02', tipo: 'venta_iniciada', ticket: 't-demo1', texto: 'Venta iniciada', fecha: haceMin(60) },
    { id: 'ev-03', tipo: 'articulo', ticket: 't-demo1', texto: '2× COCA-COLA COCA COLA — $3.98', importeCentavos: 398, fecha: haceMin(59) },
    { id: 'ev-04', tipo: 'articulo', ticket: 't-demo1', texto: '1× TAJIN CLASICO — $4.99', importeCentavos: 499, fecha: haceMin(58) },
    { id: 'ev-05', tipo: 'pago', ticket: 't-demo1', folio: folioHistorial, texto: `Efectivo $20.00 en ${folioHistorial} (saldo $0.00)`, importeCentavos: ventaConHistorial.totalCentavos, fecha: haceMin(57) },
    { id: 'ev-06', tipo: 'venta_completada', ticket: 't-demo1', folio: folioHistorial, texto: `Venta ${folioHistorial} completada — ${dinero(ventaConHistorial.totalCentavos)} (3 artículos, efectivo)`, importeCentavos: ventaConHistorial.totalCentavos, fecha: haceMin(56) },
    { id: 'ev-07', tipo: 'venta_iniciada', ticket: 't-demo2', texto: 'Venta iniciada', fecha: haceMin(30) },
    { id: 'ev-08', tipo: 'articulo', ticket: 't-demo2', texto: '2× TAJIN CLASICO — $9.98', importeCentavos: 998, fecha: haceMin(29) },
    { id: 'ev-09', tipo: 'venta_cancelada', ticket: 't-demo2', texto: 'Venta cancelada — $11.28 (2 artículos)', importeCentavos: 1128, fecha: haceMin(28) },
  ];
  for (const { id, ...e } of eventosHoy) await c.rest('PATCH', `eventos/${id}`, c.campos({ ...eventoBase, ...e, registradoEn: e.fecha }));
  await c.rest('PATCH', 'movimientosCaja/mov-cancelado', c.campos({
    turno: 'turno-hoy-maria', caja: 'talbot-1', tienda: 'talbot', cajero: MARIA.codigo, cajeroNombre: MARIA.nombre,
    tipo: 'cancelacion', importeCentavos: 1128, motivo: '2 artículo(s)', fecha: haceMin(28), registradoEn: haceMin(28),
  }));

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
  const mensaje = await c.entrar(page, c.EMPLEADA.correo, c.EMPLEADA.nip, { esperarError: true });
  v.ok('una empleada no entra al back office y se le dice a dónde ir', /solo para administradores/.test(mensaje) && await page.isVisible('a[href="caja/"]'), mensaje);

  // ---- 2) inicio
  await c.entrar(page, c.ADMIN.correo, c.ADMIN.contrasena);
  await page.waitForFunction(() => document.getElementById('kpi-total').textContent !== '—', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  v.ok('el inicio suma las ventas de hoy de todas las cajas', (await page.textContent('#kpi-total')) === m.ticket.formatearMonto(totalHoy), `${await page.textContent('#kpi-total')} vs ${m.ticket.formatearMonto(totalHoy)}`);
  v.ok('cuenta los tickets de hoy', (await page.textContent('#kpi-tickets')) === '7');
  v.ok('la gráfica por hora tiene columnas con su tooltip accesible', (await page.$$('#grafica-horas .grafica__barra')).length >= 5 && /^08:00: \$[\d.,]+, 1 ticket$/.test(await page.getAttribute('#grafica-horas .grafica__columna:nth-of-type(3)', 'aria-label') ?? ''), await page.getAttribute('#grafica-horas .grafica__columna:nth-of-type(3)', 'aria-label'));
  v.ok('la caja abierta aparece con su cajera', /María López/.test(await page.textContent('#lista-cajas')) && /Abierta/.test(await page.textContent('#lista-cajas')));
  v.ok('la barra lateral muestra las secciones del back office', await page.isVisible('nav a[href$="movimientos.html"]') && await page.isVisible('nav a[href$="transacciones.html"]') && await page.isVisible('nav a[href$="inventario.html"]') && await page.isVisible('nav a[href$="gestion/configuracion.html"]') && await page.isVisible('.nav-caja'));
  await page.hover('#grafica-horas .grafica__columna:nth-of-type(3)');
  await page.screenshot({ path: `${c.SALIDA}/bo-inicio.png`, fullPage: true });
  await page.click('#tabla-ultimos tbody tr');
  await page.waitForSelector('dialog.editor--ticket[open]');
  v.ok('un ticket abre su ficha con el recibo', /EL ÁGUILA MARKET/i.test(await page.textContent('dialog.editor--ticket .recibo')));
  await page.screenshot({ path: `${c.SALIDA}/bo-ticket.png` });
  await page.click('dialog.editor--ticket [data-reimprimir]');
  v.ok('la reimpresión sale marcada como copia', /COPIA/.test(await ultimaImpresion()));
  await page.click('dialog.editor--ticket [data-cerrar]');

  // ---- 3) transacciones
  const filasTx = () => page.$$('#tabla-transacciones tbody tr');
  const esperarFilasTx = (n) => page.waitForFunction((x) => document.querySelectorAll('#tabla-transacciones tbody tr').length === x, n, { timeout: 20000 });
  await page.goto(`${c.BASE}/transacciones.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await esperarFilasTx(8);
  const estados = await page.$$eval('#tabla-transacciones tbody tr td:nth-child(8)', (celdas) => celdas.map((td) => td.textContent.trim()));
  v.ok('transacciones de hoy: los 7 tickets completados y el cancelado como «Anulada»', estados.filter((e) => e === 'Completada').length === 7 && estados.filter((e) => e === 'Anulada').length === 1, estados.join());
  const primera = await page.$$eval('#tabla-transacciones tbody tr:first-child td', (celdas) => celdas.map((td) => td.textContent.trim()));
  v.ok('cada fila: recibo, cuándo («mié, 4 de nov 01:19 p.m.»), asociado, caja, artículos, formas de pago, marcas, estado y total',
    /^(\d{6}-0[12]-\d{4}|Sin recibo)/.test(primera[0]) && /^(dom|lun|mar|mié|jue|vie|sáb), \d{1,2} de [a-z]+ \d\d:\d\d [ap]\.m\.$/.test(primera[1]) && /^-?\$[\d,]+\.\d\d$/.test(primera[8]), primera.join(' | '));
  await page.selectOption('#f-caja', 'talbot-2');
  v.ok('el filtro por caja deja los de Caja 2', (await filasTx()).length === 2 && /2 de 8/.test(await page.textContent('#contador')), await page.textContent('#contador'));
  await page.selectOption('#f-caja', '');
  await page.selectOption('#f-pago', 'credito');
  v.ok('el filtro por forma de pago deja los dos pagados con crédito', (await filasTx()).length === 2);
  await page.selectOption('#f-pago', '');
  await page.selectOption('#f-estado', 'anulada');
  v.ok('el filtro por estado deja el ticket anulado', (await filasTx()).length === 1);
  await page.click('#tabla-transacciones tbody tr');
  await page.waitForSelector('dialog[aria-label="Ticket cancelado"][open]');
  await page.waitForFunction(() => document.querySelectorAll('dialog[open] .historial-auditoria__item').length === 3, null, { timeout: 15000 });
  v.ok('el ticket anulado abre su ficha con quién, cuánto y su historial (iniciada, artículo, cancelada)',
    /\$11\.28/.test(await page.textContent('dialog[open]')) && /María López/.test(await page.textContent('dialog[open]'))
    && /Venta iniciada[\s\S]*Artículo agregado[\s\S]*Venta cancelada/.test(await page.textContent('dialog[open] .historial-auditoria')));
  await page.click('dialog[open] [data-cerrar]');
  await page.selectOption('#f-estado', '');
  await page.click('[data-rango="7"]');
  await esperarFilasTx(14);
  v.ok('«7 días» suma los 6 tickets de ayer y marca el botón', (await page.getAttribute('[data-rango="7"]', 'aria-pressed')) === 'true');
  const conAguacate = [...(await c.leerColeccion('ventas')).values()].filter((x) => x.lineas.some((l) => /aguacate/i.test(l.nombre))).length;
  await page.fill('#f-buscar', 'aguacate');
  v.ok('buscar por nombre de artículo', (await filasTx()).length === conAguacate && conAguacate > 0, `${(await filasTx()).length} vs ${conAguacate}`);
  await page.fill('#f-buscar', '');
  await page.screenshot({ path: `${c.SALIDA}/bo-transacciones.png`, fullPage: true });
  await page.click(`#tabla-transacciones tbody tr:has-text("${folioHistorial}")`);
  await page.waitForSelector('dialog.editor--ticket[open]');
  await page.waitForFunction(() => document.querySelectorAll('dialog.editor--ticket[open] .historial-auditoria__item').length === 5, null, { timeout: 15000 });
  const historial = await page.$$eval('dialog.editor--ticket[open] .historial-auditoria__item .chip', (chips) => chips.map((x) => x.textContent));
  v.ok('una venta abre su recibo con el historial de auditoría en orden', historial.join() === 'Venta iniciada,Artículo agregado,Artículo agregado,Pago,Venta completada'
    && /EL ÁGUILA MARKET/i.test(await page.textContent('dialog.editor--ticket .recibo')), historial.join());
  await page.screenshot({ path: `${c.SALIDA}/bo-transaccion-historial.png` });
  await page.click('dialog.editor--ticket [data-cerrar]');
  await page.click('[data-rango="1"]');
  await esperarFilasTx(8);
  await page.fill('#f-buscar', ventaAyer.folio.replace(/-/g, ''));
  await page.press('#f-buscar', 'Enter');
  await page.waitForSelector('dialog.editor--ticket[open]', { timeout: 15000 });
  v.ok('escanear el folio de un recibo de ayer lo encuentra y cambia el periodo a ese día',
    (await page.inputValue('#f-desde')) === ventaAyer.dia && (await page.inputValue('#f-hasta')) === ventaAyer.dia && new RegExp(ventaAyer.folio).test(await page.textContent('dialog.editor--ticket h2')));
  await page.click('dialog.editor--ticket [data-cerrar]');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
  v.ok('exporta las transacciones a CSV', /^transacciones-\d{4}-\d{2}-\d{2}\.csv$/.test(descarga.suggestedFilename()), descarga.suggestedFilename());
  await page.goto(`${c.BASE}/ventas.html?dia=${ventaAyer.dia}`);
  await page.waitForURL(/transacciones\.html\?(.*&)?(dia|desde)=/, { timeout: 15000 });
  await page.waitForSelector('#contenido:not([hidden])');
  v.ok('la antigua página de ventas lleva a transacciones (con su día)', (await page.inputValue('#f-desde')) === ventaAyer.dia, page.url());

  // ---- 3b) movimientos en vivo
  await page.goto(`${c.BASE}/movimientos.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction((n) => document.querySelectorAll('#lista-movimientos li').length === n, eventosHoy.length, { timeout: 20000 });
  const filasMov = () => page.$$eval('#lista-movimientos li', (lis) => lis.map((li) => ({
    tipo: li.dataset.tipo, clase: li.className, hora: li.querySelector('.movimiento__hora').innerText.replace(/\s+/g, ' ').trim(),
    texto: li.querySelector('.movimiento__texto').textContent, chip: li.querySelector('.chip').textContent, enlace: li.querySelector('a.movimiento__fila')?.getAttribute('href') ?? null,
  })));
  let movs = await filasMov();
  const ordenEsperado = [...eventosHoy].sort((a, b) => b.fecha - a.fecha).map((e) => e.tipo);
  v.ok('movimientos en vivo: los de hoy, lo más reciente primero', JSON.stringify(movs.map((x) => x.tipo)) === JSON.stringify(ordenEsperado), movs.map((x) => x.tipo).join());
  const completada = movs.find((x) => x.tipo === 'venta_completada');
  v.ok('cada fila: hora con segundos y a.m./p.m., tipo, quién, caja y el detalle; las ventas completadas en verde con enlace al recibo',
    /^\d\d:\d\d:\d\d [ap]\.m\.$/.test(completada.hora) && completada.chip === 'Venta completada' && /movimiento--ok/.test(completada.clase)
    && completada.enlace === `transacciones.html?folio=${encodeURIComponent(folioHistorial)}` && /María López[\s\S]*Caja 1/.test(await page.textContent('#lista-movimientos li[data-tipo="venta_completada"]')), JSON.stringify(completada));
  v.ok('la cancelación se marca en rojo', /movimiento--alerta/.test(movs.find((x) => x.tipo === 'venta_cancelada').clase));
  v.ok('el indicador «En vivo» se ve en el día de hoy', await page.isVisible('#en-vivo'));
  await page.screenshot({ path: `${c.SALIDA}/bo-movimientos.png`, fullPage: true });
  await c.rest('PATCH', 'eventos/ev-10', c.campos({ ...eventoBase, tipo: 'efectivo', texto: 'Entrada de efectivo $20.00 — cambio para la caja', importeCentavos: 2000, fecha: new Date(), registradoEn: new Date() }));
  await page.waitForFunction((n) => document.querySelectorAll('#lista-movimientos li').length === n, eventosHoy.length + 1, { timeout: 20000 });
  movs = await filasMov();
  v.ok('un movimiento nuevo aparece solo, arriba y resaltado', movs[0].tipo === 'efectivo' && /movimiento--nuevo/.test(movs[0].clase), JSON.stringify(movs[0]));
  await page.selectOption('#f-grupo', 'pagos');
  v.ok('el filtro por tipo deja solo los pagos', JSON.stringify((await filasMov()).map((x) => x.tipo)) === '["pago"]');
  await page.selectOption('#f-grupo', '');
  await page.click('#btn-todos');
  await page.waitForFunction(() => /^10 movimientos del día/.test(document.getElementById('pie').textContent), null, { timeout: 15000 });
  v.ok('«Ver todos los movimientos» trae el día completo', (await page.textContent('#btn-todos')) === 'Ver solo los últimos' && /^10 movimientos del día/.test(await page.textContent('#pie')), await page.textContent('#pie'));
  await page.click('#lista-movimientos li[data-tipo="venta_completada"] a');
  await page.waitForSelector('dialog.editor--ticket[open]', { timeout: 15000 });
  v.ok('una venta completada abre su transacción con el recibo', /transacciones\.html/.test(page.url()) && new RegExp(folioHistorial).test(await page.textContent('dialog.editor--ticket h2')));
  await page.click('dialog.editor--ticket [data-cerrar]');

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

  // ---- 8b) inventario: recibir una entrega y ver lo que llegó
  await page.goto(`${c.BASE}/inventario.html`);
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForTimeout(1500); // el catálogo se sincroniza
  v.ok('inventario: sin entregas todavía', await page.isVisible('#vacio-entregas') && await page.isVisible('#lineas-vacio') && await page.isDisabled('#btn-registrar'));
  const escanear = async (texto) => {
    await page.fill('#r-codigo', texto);
    await page.press('#r-codigo', 'Enter');
  };
  const cantidades = () => page.$$eval('#tabla-lineas tbody tr', (filas) => filas.map((f) => `${f.querySelector('.recepcion__nombre').textContent}=${f.querySelector('input').value}`));
  await escanear('633148100013');
  await escanear('633148100013');
  await escanear('24*074734040014');
  v.ok('escanear el mismo producto suma una pieza y «24*» suma 24', JSON.stringify(await cantidades()) === JSON.stringify(['MASECA HARINA DE MAIZ 1.8kg=24', 'TAJIN CLASICO 142g=2']), (await cantidades()).join());
  await page.fill('#r-codigo', 'guaji');
  await page.waitForSelector('#sugerencias:not([hidden]) li');
  await page.press('#r-codigo', 'Enter');
  await page.waitForFunction(() => document.activeElement?.classList.contains('recepcion__cantidad') && document.activeElement.dataset.clave === 'p:p-chile');
  v.ok('un producto por peso se busca por nombre y pide los kilos', await page.isDisabled('#btn-registrar') && /falta 1 cantidad/.test(await page.textContent('#lineas-total')));
  await page.keyboard.type('12.5');
  await page.keyboard.press('Enter');
  await escanear('036000291452');
  await page.waitForSelector('#form-nuevo:not([hidden])');
  await page.fill('#nuevo-nombre', 'Salsa Valentina 1L');
  await page.press('#nuevo-nombre', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-lineas tbody tr').length === 4);
  v.ok('lo que no está en el catálogo entra con su código y el nombre tecleado', /Salsa Valentina 1L[\s\S]*Sin registrar/.test(await page.textContent('#tabla-lineas tbody tr:first-child')));
  v.ok('el total de la entrada: productos, piezas y kilos', (await page.textContent('#lineas-total')) === '4 productos · 27 piezas · 12.500 kg', await page.textContent('#lineas-total'));
  await page.fill('#r-proveedor', 'Bimbo');
  await page.fill('#r-referencia', 'F-1001');
  await page.reload();
  await page.waitForSelector('#contenido:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-lineas tbody tr').length === 4, null, { timeout: 15000 });
  v.ok('si la página se recarga, la entrada sin registrar se recupera', (await page.inputValue('#r-proveedor')) === 'Bimbo' && /Se recuperó/.test(await page.textContent('#mensaje')));
  await page.screenshot({ path: `${c.SALIDA}/bo-inventario-recibir.png`, fullPage: true });
  await page.click('#btn-registrar');
  await page.waitForFunction(() => /Entrada registrada/.test(document.getElementById('mensaje').textContent), null, { timeout: 15000 });
  const entregas = [...(await c.leerColeccion('recepciones')).entries()];
  const [idEntrega, entrega] = entregas[0] ?? [];
  v.ok('la entrada queda en Firestore (las reglas la aceptan) con sus líneas en el orden escaneado',
    entregas.length === 1 && entrega.productos === 4 && entrega.piezas === 27 && entrega.gramos === 12500 && entrega.proveedor === 'Bimbo' && entrega.referencia === 'F-1001'
    && entrega.recibidoPor === c.ADMIN.correo && entrega.anulada === false && entrega.lineas[0].producto === 'p-tajin' && entrega.lineas[2].pesoGramos === 12500
    && entrega.lineas[3].producto === null && entrega.lineas[3].upc === '036000291452', JSON.stringify(entrega ?? {}).slice(0, 300));
  v.ok('después de registrar, la captura queda vacía', await page.isVisible('#lineas-vacio') && (await page.inputValue('#r-proveedor')) === '');
  await page.waitForFunction(() => document.querySelectorAll('#tabla-entregas tbody tr').length === 1 && document.querySelectorAll('#tabla-productos tbody tr').length === 4, null, { timeout: 15000 });
  const kpis = await page.$$eval('#kpis .kpi', (k) => k.map((x) => `${x.querySelector('.kpi__etiqueta').textContent}=${x.querySelector('.kpi__valor').textContent}`));
  v.ok('lo que llegó: entregas, piezas, kilos y productos distintos', kpis.join() === 'Entregas=1,Piezas recibidas=27,Kilos recibidos=12.500 kg,Productos distintos=4', kpis.join());
  await page.fill('#f-buscar', 'tajin');
  v.ok('por producto: cuánto llegó de cada uno', /TAJIN CLASICO 142g[\s\S]*2 piezas[\s\S]*Bimbo/.test(await page.textContent('#tabla-productos tbody')) && (await page.$$('#tabla-productos tbody tr')).length === 1);
  await page.fill('#f-buscar', '');
  const [csvEntradas] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
  v.ok('exporta lo que llegó a CSV', /^entradas-\d{4}-\d{2}-\d{2}-a-\d{4}-\d{2}-\d{2}\.csv$/.test(csvEntradas.suggestedFilename()), csvEntradas.suggestedFilename());
  await page.screenshot({ path: `${c.SALIDA}/bo-inventario.png`, fullPage: true });
  await page.click('#tabla-entregas tbody tr');
  await page.waitForSelector('dialog.editor--entrega[open]');
  v.ok('una entrega abre su detalle con las 4 líneas', (await page.$$('dialog.editor--entrega tbody tr')).length === 4 && /F-1001/.test(await page.textContent('dialog.editor--entrega')));
  await page.click('#btn-anular-entrega');
  await page.waitForFunction(() => /Entrada anulada/.test(document.getElementById('mensaje').textContent), null, { timeout: 15000 });
  const anulada = await c.leerDoc(`recepciones/${idEntrega}`);
  await page.waitForFunction(() => /Anulada/.test(document.querySelector('#tabla-entregas tbody tr')?.textContent ?? ''), null, { timeout: 15000 });
  v.ok('el admin anula la entrada: queda a la vista, tachada, y deja de contar', anulada.anulada === true && anulada.anuladaPor === c.ADMIN.correo
    && /Entregas=0/.test((await page.$$eval('#kpis .kpi', (k) => k.map((x) => `${x.querySelector('.kpi__etiqueta').textContent}=${x.querySelector('.kpi__valor').textContent}`))).join()) && await page.isVisible('#vacio-productos'));

  // ---- 9) pantalla ancha: el contenido llena todo el ancho junto a la barra lateral
  await page.setViewportSize({ width: 2048, height: 1100 });
  const paginasAnchas = [
    ['index.html', 'inicio'], ['movimientos.html', 'movimientos'], ['transacciones.html', 'transacciones'], ['turnos.html', 'turnos'],
    [`reportes.html?desde=${m.ticket.claveDia(en(1, 0))}&hasta=${m.ticket.claveDia(hoy)}`, 'reportes'],
    ['productos.html', 'productos'], ['captura.html', 'captura'], ['imprimir.html', 'imprimir'],
    ['gestion/empleados.html', 'empleados'], ['gestion/cajas.html', 'cajas'], ['gestion/configuracion.html', 'configuracion'],
    ['gestion/tiendas.html', 'tiendas'], ['gestion/datos.html', 'datos'], ['solicitudes.html', 'solicitudes'], ['inventario.html', 'inventario'],
    ['cuenta.html', 'cuenta', { angosta: true }], // formulario corto: columna de lectura a propósito
  ];
  const fueraDeAncho = [];
  for (const [ruta, nombre, { angosta = false } = {}] of paginasAnchas) {
    await page.goto(`${c.BASE}/${ruta}`);
    await page.waitForSelector('#contenido:not([hidden])');
    await page.waitForTimeout(700); // que pinte sus datos antes de medir y capturar
    const medida = await page.evaluate(() => {
      const contenido = document.getElementById('contenido').getBoundingClientRect();
      return {
        izquierda: Math.round(contenido.left), derecha: Math.round(contenido.right),
        lateral: Math.round(document.getElementById('navegacion').getBoundingClientRect().right),
        ventana: innerWidth, desborde: document.documentElement.scrollWidth - innerWidth,
      };
    });
    const llena = angosta || medida.derecha >= medida.ventana - 1;
    if (Math.abs(medida.izquierda - medida.lateral) > 1 || !llena || medida.desborde > 0) fueraDeAncho.push(`${nombre} ${JSON.stringify(medida)}`);
    await page.screenshot({ path: `${c.SALIDA}/bo-ancho-${nombre}.png` });
  }
  v.ok('a 2048 px cada página llena el ancho junto a la barra lateral, sin desbordar', fueraDeAncho.length === 0, fueraDeAncho.join(' | '));
  const logo = await page.evaluate(async () => {
    const fondo = getComputedStyle(document.querySelector('#navegacion .marca__logo')).backgroundImage;
    const imagen = new Image();
    imagen.src = /url\("?([^")]+)"?\)/.exec(fondo)?.[1] ?? '';
    try { await imagen.decode(); return { fondo, carga: true }; } catch { return { fondo, carga: false }; }
  });
  v.ok('el logo de la barra lateral es el águila (icons/aguila.svg) y carga', /\/icons\/aguila\.svg/.test(logo.fondo) && logo.carga, JSON.stringify(logo));

  // ---- 10) pantalla angosta: menú plegado
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
