/**
 * Ticket de venta del POS: cálculo puro en CENTAVOS enteros (nunca flotantes).
 * Sin DOM ni Firebase: lo usan la caja y el back office, y se prueba en Node.
 *
 * Reglas de cálculo (Ontario, Canadá):
 *  - Los precios del catálogo son sin impuesto (la etiqueta dice "+Tx").
 *  - El impuesto (HST 13 %) se calcula una sola vez por ticket sobre la base
 *    gravada, ya descontada, y se redondea al centavo (mitad hacia arriba).
 *  - Pago en efectivo: el total se redondea a 5 ¢ (Canadá retiró el centavo
 *    en 2013). Con tarjeta se cobra exacto. El redondeo queda guardado.
 *  - Productos por peso: gramos enteros; importe = gramos × precio/kg ÷ 1000.
 *  - Un ticket es venta (todo positivo) o devolución (todo negativo).
 */

/** Impuesto por defecto: HST de Ontario, en puntos base (1300 = 13.00 %). */
export const TASA_HST_BP = 1300;
export const METODOS_PAGO = Object.freeze(['efectivo', 'debito', 'credito', 'otro']);
export const NOMBRE_METODO = Object.freeze({ efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', otro: 'Otro' });
export const TIPOS_VENTA = Object.freeze(['venta', 'devolucion']);
export const UNIDADES = Object.freeze(['pieza', 'peso']);

export const LIMITES_TICKET = Object.freeze({
  lineas: 300,
  pagos: 10,
  cantidad: 999,
  gramos: 99999, // 99.999 kg
  precioCentavos: 9999999,
  nombre: 120,
});

/** Billetes y monedas canadienses en circulación, en centavos (sin el centavo). */
export const DENOMINACIONES_CAD = Object.freeze([10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5]);

// ------------------------------------------------------------- aritmética entera

/** División entera redondeando la mitad lejos de cero: 5/2 → 3, −5/2 → −3, 7/2 → 4. */
export function dividirRedondeado(numerador, denominador) {
  if (!Number.isSafeInteger(numerador) || !Number.isSafeInteger(denominador) || denominador <= 0) {
    throw new TypeError(`dividirRedondeado espera enteros (denominador > 0): ${numerador} / ${denominador}`);
  }
  const signo = numerador < 0 ? -1 : 1;
  const absoluto = BigInt(Math.abs(numerador));
  const d = BigInt(denominador);
  const cociente = (2n * absoluto + d) / (2n * d);
  return signo * Number(cociente);
}

/**
 * Redondeo canadiense del efectivo a 5 ¢: termina en 1 o 2 → baja; en 3 o 4 → sube;
 * en 6 o 7 → baja a 5; en 8 o 9 → sube a 10. Simétrico para devoluciones (negativos).
 */
export function redondearEfectivo(centavos) {
  if (!Number.isSafeInteger(centavos)) throw new TypeError(`centavos no es entero: ${centavos}`);
  const signo = centavos < 0 ? -1 : 1;
  const absoluto = Math.abs(centavos);
  const resto = absoluto % 5;
  const redondeado = resto < 3 ? absoluto - resto : absoluto + (5 - resto);
  return signo * redondeado;
}

/**
 * Reparte `total` (entero ≥ 0) en partes enteras proporcionales a `pesos`
 * (enteros ≥ 0) que suman exactamente `total` (método del mayor resto).
 */
export function repartirProporcional(total, pesos) {
  if (!Number.isSafeInteger(total) || total < 0) throw new TypeError(`total no válido: ${total}`);
  const suma = pesos.reduce((acc, p) => acc + BigInt(p), 0n);
  if (suma === 0n || total === 0) return pesos.map(() => 0);
  const t = BigInt(total);
  const partes = pesos.map((p) => (t * BigInt(p)) / suma);
  let resto = t - partes.reduce((acc, p) => acc + p, 0n);
  const orden = pesos
    .map((p, i) => ({ i, fraccion: (t * BigInt(p)) % suma }))
    .sort((a, b) => (a.fraccion === b.fraccion ? a.i - b.i : a.fraccion > b.fraccion ? -1 : 1));
  for (let k = 0; resto > 0n; k += 1, resto -= 1n) partes[orden[k].i] += 1n;
  return partes.map(Number);
}

// ------------------------------------------------------------- lo que teclea la cajera

/** "1.25" o "1,250" (kg) → gramos enteros, sin pasar por flotantes. Lanza si no es un peso válido. */
export function gramosDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s*kg$/i, '').replace(',', '.');
  const coincidencia = /^(\d{1,2})?(?:\.(\d{0,3}))?$/.exec(limpio);
  if (!coincidencia || limpio === '' || limpio === '.') throw new Error('Peso no válido; escribe los kilos, por ejemplo 1.250');
  const kilos = Number.parseInt(coincidencia[1] ?? '0', 10);
  const gramos = kilos * 1000 + Number.parseInt((coincidencia[2] ?? '').padEnd(3, '0'), 10);
  if (gramos <= 0) throw new Error('El peso debe ser mayor que cero.');
  if (gramos > LIMITES_TICKET.gramos) throw new Error('El peso máximo es 99.999 kg.');
  return gramos;
}

/** 1250 → "1.250 kg"; −500 → "-0.500 kg". */
export function formatearPeso(gramos) {
  const signo = gramos < 0 ? '-' : '';
  const absoluto = Math.abs(gramos);
  return `${signo}${Math.floor(absoluto / 1000)}.${String(absoluto % 1000).padStart(3, '0')} kg`;
}

/** Cantidad de piezas tecleada: entero de 1 a 999. */
export function cantidadDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (!/^\d{1,3}$/.test(limpio)) throw new Error('Cantidad no válida; escribe un número entero de 1 a 999.');
  const cantidad = Number.parseInt(limpio, 10);
  if (cantidad < 1) throw new Error('La cantidad debe ser al menos 1.');
  return cantidad;
}

/** "10" → 1000 puntos base; "12.5" → 1250. Entre 0.01 % y 100 %. */
export function puntosBaseDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim().replace(/%$/, '').replace(',', '.');
  const coincidencia = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(limpio);
  if (!coincidencia) throw new Error('Porcentaje no válido; escribe por ejemplo 10 o 12.5');
  const puntos = Number.parseInt(coincidencia[1], 10) * 100 + Number.parseInt((coincidencia[2] ?? '').padEnd(2, '0'), 10);
  if (puntos <= 0 || puntos > 10000) throw new Error('El porcentaje debe estar entre 0.01 y 100.');
  return puntos;
}

/** 1250 → "12.5 %"; 1000 → "10 %". */
export function formatearPorcentaje(puntosBase) {
  const enteros = Math.floor(puntosBase / 100);
  const decimales = puntosBase % 100;
  return `${enteros}${decimales ? `.${String(decimales).padStart(2, '0').replace(/0$/, '')}` : ''} %`;
}

/** Centavos con signo → "$4.99" / "-$4.99" (para tickets y reportes). */
export function formatearMonto(centavos) {
  if (!Number.isSafeInteger(centavos)) throw new TypeError(`centavos no es entero: ${centavos}`);
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const enteros = String(Math.floor(absoluto / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}$${enteros}.${String(absoluto % 100).padStart(2, '0')}`;
}

// ------------------------------------------------------------- líneas

let contadorLineas = 0;
const nuevoIdLinea = () => {
  contadorLineas += 1;
  return `l${Date.now().toString(36)}${contadorLineas.toString(36)}`;
};

/** Nombre que sale en el ticket: marca + nombre del catálogo. */
export function nombreDeProducto(producto) {
  return [producto.marca, producto.nombre].filter((t) => typeof t === 'string' && t.trim() !== '').join(' ').slice(0, LIMITES_TICKET.nombre);
}

/**
 * Línea a partir de un producto del catálogo.
 * Pieza: `cantidad` (entero, negativo en devoluciones). Peso: `pesoGramos`.
 */
export function lineaDeProducto(producto, { cantidad = 1, pesoGramos = null, precioCentavos = null } = {}) {
  const porPeso = producto.unidadVenta === 'peso';
  if (porPeso && !Number.isSafeInteger(pesoGramos)) throw new Error('Este producto se vende por peso: falta el peso.');
  const precio = precioCentavos ?? (porPeso ? producto.precioPorKgCentavos : producto.precioCentavos);
  if (!Number.isSafeInteger(precio) || precio < 0) throw new Error(`«${nombreDeProducto(producto)}» no tiene un precio válido.`);
  return {
    id: nuevoIdLinea(),
    productoId: producto.id ?? null,
    upc: producto.upc ?? null,
    plu: producto.plu ?? null,
    nombre: nombreDeProducto(producto),
    presentacion: producto.presentacion ?? '',
    departamento: null,
    claseFiscal: producto.claseFiscal,
    unidad: porPeso ? 'peso' : 'pieza',
    cantidad: porPeso ? null : cantidad,
    pesoGramos: porPeso ? pesoGramos : null,
    precioUnitarioCentavos: precio,
    precioOriginalCentavos: null,
    descuento: null,
  };
}

/**
 * Venta libre por departamento (artículo sin código o que no está en el catálogo).
 * @param {{id: string, nombre: string, claseFiscal: string}} departamento
 */
export function lineaDeDepartamento(departamento, precioCentavos, { cantidad = 1, upc = null } = {}) {
  if (!Number.isSafeInteger(precioCentavos) || precioCentavos <= 0) throw new Error('Escribe el precio del artículo.');
  return {
    id: nuevoIdLinea(),
    productoId: null,
    upc,
    plu: null,
    nombre: departamento.nombre,
    presentacion: '',
    departamento: departamento.id,
    claseFiscal: departamento.claseFiscal,
    unidad: 'pieza',
    cantidad,
    pesoGramos: null,
    precioUnitarioCentavos: precioCentavos,
    precioOriginalCentavos: null,
    descuento: null,
  };
}

/** Importe antes de descuentos: piezas × precio, o gramos × precio/kg ÷ 1000 redondeado. */
export function importeBruto(linea) {
  if (linea.unidad === 'peso') return dividirRedondeado(linea.pesoGramos * linea.precioUnitarioCentavos, 1000);
  return linea.cantidad * linea.precioUnitarioCentavos;
}

/** Descuento de línea en centavos (≥ 0). Solo en ventas: una devolución no lleva descuento. */
function descuentoDeLinea(linea, bruto) {
  const d = linea.descuento;
  if (!d || bruto <= 0) return 0;
  if (d.tipo === 'porcentaje') return Math.min(bruto, dividirRedondeado(bruto * d.puntosBase, 10000));
  if (d.tipo === 'monto') return Math.min(bruto, d.centavos);
  throw new Error(`Tipo de descuento desconocido: ${d.tipo}`);
}

/** ¿Se puede sumar otra pieza a esta línea en vez de abrir otra? */
export function lineaAcumulable(linea, producto) {
  return linea.unidad === 'pieza'
    && linea.productoId !== null
    && linea.productoId === producto.id
    && linea.descuento === null
    && linea.precioOriginalCentavos === null
    && linea.cantidad > 0
    && linea.cantidad < LIMITES_TICKET.cantidad;
}

// ------------------------------------------------------------- totales

/**
 * Totales del ticket.
 * @param {Array} lineas líneas en curso (ver lineaDeProducto)
 * @param {{ descuentoTicket?: null|{tipo:'porcentaje', puntosBase:number}|{tipo:'monto', centavos:number}, tasaImpuestoBP?: number }} [opciones]
 */
export function calcularTicket(lineas, { descuentoTicket = null, tasaImpuestoBP = TASA_HST_BP } = {}) {
  if (!Number.isSafeInteger(tasaImpuestoBP) || tasaImpuestoBP < 0 || tasaImpuestoBP > 3000) throw new Error('Tasa de impuesto no válida.');
  const detalladas = lineas.map((linea) => {
    const bruto = importeBruto(linea);
    const descuento = descuentoDeLinea(linea, bruto);
    return { ...linea, importeBrutoCentavos: bruto, descuentoCentavos: descuento, importeCentavos: bruto - descuento };
  });
  const bruto = detalladas.reduce((acc, l) => acc + l.importeBrutoCentavos, 0);
  const descuentoLineas = detalladas.reduce((acc, l) => acc + l.descuentoCentavos, 0);
  const subtotal = detalladas.reduce((acc, l) => acc + l.importeCentavos, 0);

  let descuentoTicketCentavos = 0;
  if (descuentoTicket && subtotal > 0) {
    if (descuentoTicket.tipo === 'porcentaje') descuentoTicketCentavos = Math.min(subtotal, dividirRedondeado(subtotal * descuentoTicket.puntosBase, 10000));
    else if (descuentoTicket.tipo === 'monto') descuentoTicketCentavos = Math.min(subtotal, descuentoTicket.centavos);
    else throw new Error(`Tipo de descuento desconocido: ${descuentoTicket.tipo}`);
  }
  const partes = repartirProporcional(descuentoTicketCentavos, detalladas.map((l) => Math.max(l.importeCentavos, 0)));
  let baseGravada = 0;
  let baseTasaCero = 0;
  let articulos = 0;
  const conTicket = detalladas.map((linea, i) => {
    const neto = linea.importeCentavos - partes[i];
    if (linea.claseFiscal === 'gravado') baseGravada += neto;
    else baseTasaCero += neto;
    articulos += linea.unidad === 'peso' ? Math.sign(linea.pesoGramos) : linea.cantidad;
    return { ...linea, descuentoTicketCentavos: partes[i], netoCentavos: neto };
  });
  const impuesto = dividirRedondeado(baseGravada * tasaImpuestoBP, 10000);
  return {
    lineas: conTicket,
    articulos,
    brutoCentavos: bruto,
    descuentoLineasCentavos: descuentoLineas,
    subtotalCentavos: subtotal,
    descuentoTicketCentavos,
    baseGravadaCentavos: baseGravada,
    baseTasaCeroCentavos: baseTasaCero,
    tasaImpuestoBP,
    impuestoCentavos: impuesto,
    totalCentavos: subtotal - descuentoTicketCentavos + impuesto,
  };
}

// ------------------------------------------------------------- cobro

/** Suma de lo ya cobrado (con signo). */
export const cobrado = (pagos) => pagos.reduce((acc, p) => acc + p.importeCentavos, 0);

/**
 * Estado del cobro: lo que falta (exacto y en efectivo) y si ya se completó.
 * Tras el pago final en efectivo, lo cobrado puede diferir del total en el redondeo (±2 ¢).
 */
export function estadoCobro(totalCentavos, pagos) {
  const final = pagos.some((p) => p.final === true);
  const pendiente = final ? 0 : totalCentavos - cobrado(pagos);
  return {
    pendienteCentavos: pendiente,
    pendienteEfectivoCentavos: redondearEfectivo(pendiente),
    completo: final || (pagos.length > 0 && pendiente === 0) || (totalCentavos === 0 && pagos.length === 0),
    redondeoCentavos: cobrado(pagos) - (final ? totalCentavos : cobrado(pagos)),
    cambioCentavos: pagos.reduce((acc, p) => acc + (p.cambioCentavos ?? 0), 0),
  };
}

/**
 * Registra un pago. `montoCentavos` es positivo: en efectivo, lo que entrega el
 * cliente (múltiplo de 5 ¢); con tarjeta, lo que se cobra (0 o nada = todo lo
 * pendiente). En devoluciones es lo que se le devuelve.
 * @returns {{ pago: object, completo: boolean, cambioCentavos: number }}
 */
export function registrarPago(totalCentavos, pagos, { metodo, montoCentavos = 0 }) {
  if (!METODOS_PAGO.includes(metodo)) throw new Error(`Forma de pago desconocida: ${metodo}`);
  if (pagos.length >= LIMITES_TICKET.pagos) throw new Error('Demasiados pagos en un solo ticket.');
  const estado = estadoCobro(totalCentavos, pagos);
  if (estado.completo) throw new Error('El ticket ya está pagado.');
  const pendiente = estado.pendienteCentavos;
  const monto = Number.isSafeInteger(montoCentavos) && montoCentavos > 0 ? montoCentavos : 0;
  const signo = pendiente < 0 ? -1 : 1;

  if (metodo === 'efectivo') {
    const redondeado = redondearEfectivo(pendiente);
    if (signo < 0) {
      // Devolución en efectivo: siempre lo pendiente, redondeado a 5 ¢.
      const pago = { metodo, importeCentavos: redondeado, recibidoCentavos: null, cambioCentavos: 0, final: true };
      return { pago, completo: true, cambioCentavos: 0 };
    }
    const entregado = monto === 0 ? redondeado : monto;
    if (entregado % 5 !== 0) throw new Error('En efectivo no hay centavos sueltos: el monto debe terminar en 0 o 5.');
    if (entregado >= redondeado) {
      const pago = { metodo, importeCentavos: redondeado, recibidoCentavos: entregado, cambioCentavos: entregado - redondeado, final: true };
      return { pago, completo: true, cambioCentavos: pago.cambioCentavos };
    }
    const pago = { metodo, importeCentavos: entregado, recibidoCentavos: entregado, cambioCentavos: 0, final: false };
    return { pago, completo: false, cambioCentavos: 0 };
  }

  const absoluto = Math.abs(pendiente);
  const aplicado = signo * (monto === 0 ? absoluto : Math.min(monto, absoluto));
  const completo = pendiente - aplicado === 0;
  const pago = { metodo, importeCentavos: aplicado, recibidoCentavos: null, cambioCentavos: 0, final: false };
  return { pago, completo, cambioCentavos: 0 };
}

// ------------------------------------------------------------- folio

/** Fecha local "AAAA-MM-DD". */
export function claveDia(fecha = new Date()) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

/** Folio legible: "AAMMDD-CC-NNNN" (fecha local, número de caja, consecutivo del día en esa caja). */
export function folioVenta(fecha, numeroCaja, numero) {
  if (!Number.isInteger(numeroCaja) || numeroCaja < 1 || numeroCaja > 99) throw new Error('Número de caja no válido (1 a 99).');
  if (!Number.isInteger(numero) || numero < 1 || numero > 9999) throw new Error('Consecutivo de ticket no válido.');
  const aa = String(fecha.getFullYear() % 100).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${aa}${mm}${dd}-${String(numeroCaja).padStart(2, '0')}-${String(numero).padStart(4, '0')}`;
}

export const REGEX_FOLIO = /^[0-9]{6}-[0-9]{2}-[0-9]{4}$/;

/** "261102-01-0042" → "261102010042" (lo que lleva el código de barras del recibo). */
export function digitosFolio(folio) {
  if (!REGEX_FOLIO.test(folio)) throw new Error(`Folio no válido: ${folio}`);
  return folio.replace(/-/g, '');
}

/** Lo que teclea el escáner al leer el recibo ("261102010042" o con guiones) → folio, o null. */
export function folioDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (REGEX_FOLIO.test(limpio)) return limpio;
  if (/^[0-9]{12}$/.test(limpio)) return `${limpio.slice(0, 6)}-${limpio.slice(6, 8)}-${limpio.slice(8)}`;
  return null;
}

// ------------------------------------------------------------- documento de venta

export const CAMPOS_VENTA = Object.freeze([
  'folio', 'numero', 'dia', 'tipo',
  'turno', 'caja', 'cajaNombre', 'numeroCaja', 'tienda', 'tiendaNombre', 'cajero', 'cajeroNombre',
  'fecha', 'registradoEn',
  'lineas', 'articulos',
  'brutoCentavos', 'descuentoLineasCentavos', 'subtotalCentavos', 'descuentoTicketCentavos',
  'baseGravadaCentavos', 'baseTasaCeroCentavos', 'tasaImpuestoBP', 'impuestoCentavos', 'totalCentavos',
  'redondeoCentavos', 'cambioCentavos', 'pagos', 'porMetodo',
  'lineasAnuladas', 'lineasAnuladasCentavos', 'cambiosPrecio',
  'autorizacion', 'autorizadoPor', 'ventaOriginal',
]);

export const CAMPOS_LINEA_VENTA = Object.freeze([
  'productoId', 'upc', 'plu', 'nombre', 'presentacion', 'departamento', 'claseFiscal', 'unidad',
  'cantidad', 'pesoGramos', 'precioUnitarioCentavos', 'precioOriginalCentavos',
  'descuentoCentavos', 'descuentoTicketCentavos', 'importeCentavos', 'netoCentavos',
]);

/**
 * Documento ventas/{id} listo para guardar (sin `registradoEn`, que pone el
 * servidor). Lanza si el cobro no está completo.
 * @param {object} calculo resultado de calcularTicket
 * @param {Array} pagos pagos registrados con registrarPago
 * @param {object} meta folio, numero, dia, tipo, turno, caja, cajaNombre, numeroCaja, tienda, tiendaNombre, cajero, cajeroNombre, fecha, lineasAnuladas, lineasAnuladasCentavos, autorizacion, autorizadoPor, ventaOriginal
 */
export function armarVenta(calculo, pagos, meta) {
  const estado = estadoCobro(calculo.totalCentavos, pagos);
  if (!estado.completo) throw new Error('Falta cobrar el ticket.');
  const porMetodo = Object.fromEntries(METODOS_PAGO.map((m) => [m, 0]));
  for (const p of pagos) porMetodo[p.metodo] += p.importeCentavos;
  const lineas = calculo.lineas.map((l) => ({
    productoId: l.productoId ?? null,
    upc: l.upc ?? null,
    plu: l.plu ?? null,
    nombre: String(l.nombre ?? '').slice(0, LIMITES_TICKET.nombre),
    presentacion: String(l.presentacion ?? '').slice(0, 30),
    departamento: l.departamento ?? null,
    claseFiscal: l.claseFiscal,
    unidad: l.unidad,
    cantidad: l.unidad === 'pieza' ? l.cantidad : null,
    pesoGramos: l.unidad === 'peso' ? l.pesoGramos : null,
    precioUnitarioCentavos: l.precioUnitarioCentavos,
    precioOriginalCentavos: l.precioOriginalCentavos ?? null,
    descuentoCentavos: l.descuentoCentavos,
    descuentoTicketCentavos: l.descuentoTicketCentavos,
    importeCentavos: l.importeCentavos,
    netoCentavos: l.netoCentavos,
  }));
  return {
    folio: meta.folio,
    numero: meta.numero,
    dia: meta.dia,
    tipo: meta.tipo ?? (calculo.totalCentavos < 0 ? 'devolucion' : 'venta'),
    turno: meta.turno,
    caja: meta.caja,
    cajaNombre: meta.cajaNombre,
    numeroCaja: meta.numeroCaja,
    tienda: meta.tienda,
    tiendaNombre: meta.tiendaNombre,
    cajero: meta.cajero,
    cajeroNombre: meta.cajeroNombre,
    fecha: meta.fecha,
    lineas,
    articulos: calculo.articulos,
    brutoCentavos: calculo.brutoCentavos,
    descuentoLineasCentavos: calculo.descuentoLineasCentavos,
    subtotalCentavos: calculo.subtotalCentavos,
    descuentoTicketCentavos: calculo.descuentoTicketCentavos,
    baseGravadaCentavos: calculo.baseGravadaCentavos,
    baseTasaCeroCentavos: calculo.baseTasaCeroCentavos,
    tasaImpuestoBP: calculo.tasaImpuestoBP,
    impuestoCentavos: calculo.impuestoCentavos,
    totalCentavos: calculo.totalCentavos,
    redondeoCentavos: cobrado(pagos) - calculo.totalCentavos,
    cambioCentavos: estado.cambioCentavos,
    pagos: pagos.map((p) => ({ metodo: p.metodo, importeCentavos: p.importeCentavos, recibidoCentavos: p.recibidoCentavos ?? null, cambioCentavos: p.cambioCentavos ?? 0 })),
    porMetodo,
    lineasAnuladas: meta.lineasAnuladas ?? 0,
    lineasAnuladasCentavos: meta.lineasAnuladasCentavos ?? 0,
    cambiosPrecio: calculo.lineas.filter((l) => l.precioOriginalCentavos !== null && l.precioOriginalCentavos !== undefined).length,
    autorizacion: meta.autorizacion ?? null,
    autorizadoPor: meta.autorizadoPor ?? null,
    ventaOriginal: meta.ventaOriginal ?? null,
  };
}

/** ¿La venta necesita autorización de un administrador? (descuentos, cambios de precio o devolución) */
export function requiereAutorizacion(venta) {
  return venta.tipo === 'devolucion'
    || venta.descuentoLineasCentavos > 0
    || venta.descuentoTicketCentavos > 0
    || venta.cambiosPrecio > 0;
}

const esEntero = (v) => Number.isSafeInteger(v);
const esTexto = (v, max) => typeof v === 'string' && v.length <= max;
const esTextoONulo = (v, max) => v === null || esTexto(v, max);

/**
 * Validación completa de una venta (más estricta que las reglas, que no pueden
 * recorrer las líneas). Devuelve la lista de errores; vacía si está bien.
 */
export function validarVenta(v, { conRegistro = false } = {}) {
  const errores = [];
  const campos = conRegistro ? CAMPOS_VENTA : CAMPOS_VENTA.filter((c) => c !== 'registradoEn');
  const sobran = Object.keys(v).filter((k) => !CAMPOS_VENTA.includes(k));
  const faltan = campos.filter((k) => !(k in v));
  if (sobran.length) errores.push(`Campos de más: ${sobran.join(', ')}`);
  if (faltan.length) errores.push(`Faltan campos: ${faltan.join(', ')}`);
  if (errores.length) return errores;

  if (!REGEX_FOLIO.test(v.folio)) errores.push('Folio no válido');
  if (!esEntero(v.numero) || v.numero < 1 || v.numero > 9999) errores.push('Consecutivo no válido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dia)) errores.push('Día no válido');
  if (!TIPOS_VENTA.includes(v.tipo)) errores.push('Tipo de venta no válido');
  for (const c of ['turno', 'caja', 'tienda', 'cajero']) if (!esTexto(v[c], 200) || v[c] === '') errores.push(`${c} no válido`);
  for (const c of ['cajaNombre', 'tiendaNombre', 'cajeroNombre']) if (!esTexto(v[c], 80)) errores.push(`${c} no válido`);
  if (!esEntero(v.numeroCaja) || v.numeroCaja < 1 || v.numeroCaja > 99) errores.push('Número de caja no válido');
  if (!Array.isArray(v.lineas) || v.lineas.length < 1 || v.lineas.length > LIMITES_TICKET.lineas) errores.push('El ticket debe tener entre 1 y 300 líneas');
  if (!Array.isArray(v.pagos) || v.pagos.length > LIMITES_TICKET.pagos) errores.push('Pagos no válidos');
  const enteros = ['articulos', 'brutoCentavos', 'descuentoLineasCentavos', 'subtotalCentavos', 'descuentoTicketCentavos', 'baseGravadaCentavos', 'baseTasaCeroCentavos', 'tasaImpuestoBP', 'impuestoCentavos', 'totalCentavos', 'redondeoCentavos', 'cambioCentavos', 'lineasAnuladas', 'lineasAnuladasCentavos', 'cambiosPrecio'];
  for (const c of enteros) if (!esEntero(v[c])) errores.push(`${c} debe ser un entero`);
  if (errores.length) return errores;

  if (v.totalCentavos !== v.subtotalCentavos - v.descuentoTicketCentavos + v.impuestoCentavos) errores.push('El total no cuadra con subtotal, descuento e impuesto');
  if (v.baseGravadaCentavos + v.baseTasaCeroCentavos !== v.subtotalCentavos - v.descuentoTicketCentavos) errores.push('Las bases no cuadran con el subtotal');
  if (v.subtotalCentavos !== v.brutoCentavos - v.descuentoLineasCentavos) errores.push('El subtotal no cuadra con los descuentos de línea');
  if (v.impuestoCentavos !== dividirRedondeado(v.baseGravadaCentavos * v.tasaImpuestoBP, 10000)) errores.push('El impuesto no corresponde a la base gravada');
  if (Math.abs(v.redondeoCentavos) > 2) errores.push('Redondeo fuera de rango');
  if (v.descuentoLineasCentavos < 0 || v.descuentoTicketCentavos < 0 || v.cambioCentavos < 0) errores.push('Descuentos y cambio no pueden ser negativos');
  if (v.tipo === 'venta' && v.totalCentavos < 0) errores.push('Una venta no puede tener total negativo');
  if (v.tipo === 'devolucion' && (v.totalCentavos >= 0 || v.descuentoLineasCentavos > 0 || v.descuentoTicketCentavos > 0)) errores.push('Una devolución tiene total negativo y sin descuentos');
  const porMetodo = v.porMetodo ?? {};
  const claves = Object.keys(porMetodo);
  if (claves.length !== METODOS_PAGO.length || !METODOS_PAGO.every((m) => esEntero(porMetodo[m]))) errores.push('porMetodo no válido');
  else if (METODOS_PAGO.reduce((acc, m) => acc + porMetodo[m], 0) !== v.totalCentavos + v.redondeoCentavos) errores.push('Los pagos no cuadran con el total');
  if (v.pagos.reduce((acc, p) => acc + p.importeCentavos, 0) !== v.totalCentavos + v.redondeoCentavos) errores.push('La suma de pagos no cuadra');

  let bruto = 0;
  let descLineas = 0;
  let descTicket = 0;
  let gravada = 0;
  let tasaCero = 0;
  for (const [i, l] of v.lineas.entries()) {
    const extra = Object.keys(l).filter((k) => !CAMPOS_LINEA_VENTA.includes(k));
    if (extra.length) errores.push(`Línea ${i + 1}: campos de más (${extra.join(', ')})`);
    if (!UNIDADES.includes(l.unidad)) errores.push(`Línea ${i + 1}: unidad no válida`);
    if (!['gravado', 'tasaCero'].includes(l.claseFiscal)) errores.push(`Línea ${i + 1}: clase fiscal no válida`);
    if (!esTexto(l.nombre, LIMITES_TICKET.nombre) || l.nombre === '') errores.push(`Línea ${i + 1}: nombre no válido`);
    if (!esTextoONulo(l.productoId, 200) || !esTextoONulo(l.upc, 13) || !esTextoONulo(l.plu, 5) || !esTextoONulo(l.departamento, 40)) errores.push(`Línea ${i + 1}: referencias no válidas`);
    const b = l.unidad === 'peso' ? dividirRedondeado(l.pesoGramos * l.precioUnitarioCentavos, 1000) : l.cantidad * l.precioUnitarioCentavos;
    if (l.importeCentavos !== b - l.descuentoCentavos) errores.push(`Línea ${i + 1}: importe no cuadra`);
    if (l.netoCentavos !== l.importeCentavos - l.descuentoTicketCentavos) errores.push(`Línea ${i + 1}: neto no cuadra`);
    bruto += b;
    descLineas += l.descuentoCentavos;
    descTicket += l.descuentoTicketCentavos;
    if (l.claseFiscal === 'gravado') gravada += l.netoCentavos;
    else tasaCero += l.netoCentavos;
  }
  if (bruto !== v.brutoCentavos || descLineas !== v.descuentoLineasCentavos || descTicket !== v.descuentoTicketCentavos) errores.push('Las líneas no suman los totales');
  if (gravada !== v.baseGravadaCentavos || tasaCero !== v.baseTasaCeroCentavos) errores.push('Las líneas no suman las bases');
  return errores;
}

// ------------------------------------------------------------- códigos de balanza

/**
 * Etiqueta de balanza con precio (UPC-A que empieza por 2): "2 IIIII PPPPP C".
 * Devuelve los PLU candidatos (5 y 4 dígitos) y el precio en centavos, o null.
 */
export function interpretarCodigoBalanza(upc) {
  if (!/^2[0-9]{11}$/.test(String(upc ?? ''))) return null;
  const articulo = upc.slice(1, 6);
  const precio = Number.parseInt(upc.slice(6, 11), 10);
  if (precio <= 0) return null;
  const candidatos = [articulo];
  if (articulo.startsWith('0')) candidatos.push(articulo.slice(1));
  return { plus: candidatos, precioCentavos: precio };
}
