/**
 * Turnos de caja: resumen del turno (corte X a mitad de turno, corte Z al
 * cerrarlo) a partir de sus ventas y movimientos de efectivo. Módulo puro.
 *
 * El resumen se guarda en turnos/{id}.resumen al cerrar, para que los
 * reportes de varios días no tengan que leer cada venta; el back office puede
 * comprobarlo en cualquier momento recalculándolo desde las ventas.
 */
import { DENOMINACIONES_CAD, METODOS_PAGO } from './ticket.js';
import { t } from './idioma.js';

export const TIPOS_MOVIMIENTO = Object.freeze(['retiro', 'entrada', 'pago', 'apertura', 'cancelacion']);
/** Nombres en español (como se guardan en los movimientos en vivo); para mostrar, nombreMovimiento(). */
// i18n:sin-revisar-inicio
export const NOMBRE_MOVIMIENTO = Object.freeze({
  retiro: 'Retiro de efectivo',
  entrada: 'Entrada de efectivo',
  pago: 'Pago desde caja',
  apertura: 'Apertura de cajón',
  cancelacion: 'Ticket cancelado',
});
// i18n:sin-revisar-fin
/** Movimiento de efectivo para mostrar o imprimir, en el idioma elegido. */
export function nombreMovimiento(tipo) {
  switch (tipo) {
    case 'retiro': return t('Retiro de efectivo');
    case 'entrada': return t('Entrada de efectivo');
    case 'pago': return t('Pago desde caja');
    case 'apertura': return t('Apertura de cajón');
    case 'cancelacion': return t('Ticket cancelado');
    default: return tipo;
  }
}

/** Movimientos que mueven efectivo y en qué sentido. */
const EFECTO_EFECTIVO = Object.freeze({ retiro: -1, entrada: 1, pago: -1, apertura: 0, cancelacion: 0 });

export const MAXIMO_PRODUCTOS_RESUMEN = 3000;

/** Milisegundos de un Timestamp de Firestore, Date, número o {seconds, nanoseconds}. */
export function milisDe(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return valor;
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  if (typeof valor.seconds === 'number') return valor.seconds * 1000 + Math.floor((valor.nanoseconds ?? 0) / 1e6);
  return null;
}

/** Minutos completos entre la apertura del turno y su cierre (o `hasta`). */
export function minutosTurno(turno, hasta = Date.now()) {
  const inicio = milisDe(turno.abiertoEn);
  const fin = milisDe(turno.cerradoEn) ?? hasta;
  if (inicio === null || fin === null || fin < inicio) return 0;
  return Math.floor((fin - inicio) / 60000);
}

/** 493 → "8 h 13 min"; 45 → "45 min". */
export function formatearDuracion(minutos) {
  const m = Math.max(0, Math.floor(minutos));
  const horas = Math.floor(m / 60);
  const resto = m % 60;
  if (horas === 0) return `${resto} min`;
  return `${horas} h ${String(resto).padStart(2, '0')} min`;
}

/** Total de un conteo de efectivo {"2000": 3, "500": 1, …} en centavos. Lanza si hay cantidades no válidas. */
export function totalConteo(conteo) {
  let total = 0;
  for (const [denominacion, cantidad] of Object.entries(conteo ?? {})) {
    const valor = Number(denominacion);
    if (!DENOMINACIONES_CAD.includes(valor)) throw new Error(`Denominación desconocida: ${denominacion}`);
    if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > 99999) throw new Error(`Cantidad no válida para ${denominacion}`);
    total += valor * cantidad;
  }
  return total;
}

/** Clave estable de un artículo para el acumulado de productos del turno. */
export function claveArticulo(linea) {
  if (linea.productoId) return `p_${linea.productoId}`;
  if (linea.upc) return `c_${linea.upc}`;
  if (linea.departamento) return `d_${linea.departamento}`;
  return 'otros';
}

function nuevoResumen(fondo) {
  return {
    ventas: 0,
    devoluciones: 0,
    articulos: 0,
    brutoCentavos: 0,
    brutoVentasCentavos: 0,
    descuentosCentavos: 0,
    devolucionesCentavos: 0,
    devolucionesSinImpuestoCentavos: 0,
    baseGravadaCentavos: 0,
    baseTasaCeroCentavos: 0,
    impuestoCentavos: 0,
    totalCentavos: 0,
    redondeoCentavos: 0,
    porMetodo: Object.fromEntries(METODOS_PAGO.map((m) => [m, 0])),
    efectivo: {
      fondoCentavos: fondo,
      ventasCentavos: 0,
      devolucionesCentavos: 0,
      retirosCentavos: 0,
      entradasCentavos: 0,
      pagosCentavos: 0,
      esperadoCentavos: fondo,
    },
    lineasAnuladas: 0,
    lineasAnuladasCentavos: 0,
    cancelaciones: 0,
    cancelacionesCentavos: 0,
    aperturasCajon: 0,
    cambiosPrecio: 0,
    autorizadas: 0,
    porHora: {},
    porDepartamento: {},
    productos: {},
    primerFolio: null,
    ultimoFolio: null,
    minutos: 0,
  };
}

/**
 * Resumen de un turno.
 * @param {{ turno: object, ventas: Array, movimientos?: Array, departamentos?: Array<{id:string,nombre:string}>, hasta?: number }} datos
 *   `ventas` y `movimientos` son documentos ya leídos (con fecha como Timestamp o Date).
 */
export function resumirTurno({ turno, ventas, movimientos = [], departamentos = [], hasta = Date.now() }) {
  const r = nuevoResumen(turno.fondoInicialCentavos ?? 0);
  const nombresDepartamento = new Map(departamentos.map((d) => [d.id, d.nombre]));
  const ordenadas = [...ventas].sort((a, b) => (milisDe(a.fecha) ?? 0) - (milisDe(b.fecha) ?? 0) || String(a.folio).localeCompare(String(b.folio)));
  for (const v of ordenadas) {
    if (v.tipo === 'devolucion') {
      r.devoluciones += 1;
      r.devolucionesCentavos += -v.totalCentavos;
      r.devolucionesSinImpuestoCentavos += -(v.baseGravadaCentavos + v.baseTasaCeroCentavos);
    } else {
      r.ventas += 1;
      r.brutoVentasCentavos += v.brutoCentavos;
    }
    r.articulos += v.articulos ?? 0;
    r.brutoCentavos += v.brutoCentavos;
    r.descuentosCentavos += v.descuentoLineasCentavos + v.descuentoTicketCentavos;
    r.baseGravadaCentavos += v.baseGravadaCentavos;
    r.baseTasaCeroCentavos += v.baseTasaCeroCentavos;
    r.impuestoCentavos += v.impuestoCentavos;
    r.totalCentavos += v.totalCentavos;
    r.redondeoCentavos += v.redondeoCentavos;
    for (const m of METODOS_PAGO) r.porMetodo[m] += v.porMetodo?.[m] ?? 0;
    const efectivo = v.porMetodo?.efectivo ?? 0;
    if (efectivo >= 0) r.efectivo.ventasCentavos += efectivo;
    else r.efectivo.devolucionesCentavos += -efectivo;
    r.lineasAnuladas += v.lineasAnuladas ?? 0;
    r.lineasAnuladasCentavos += v.lineasAnuladasCentavos ?? 0;
    r.cambiosPrecio += v.cambiosPrecio ?? 0;
    if (v.autorizacion) r.autorizadas += 1;

    const ms = milisDe(v.fecha);
    if (ms !== null) {
      const hora = String(new Date(ms).getHours()).padStart(2, '0');
      const celda = r.porHora[hora] ?? { ventas: 0, totalCentavos: 0 };
      if (v.tipo !== 'devolucion') celda.ventas += 1;
      celda.totalCentavos += v.totalCentavos;
      r.porHora[hora] = celda;
    }
    if (r.primerFolio === null) r.primerFolio = v.folio;
    r.ultimoFolio = v.folio;

    for (const l of v.lineas ?? []) {
      if (l.departamento) {
        const d = r.porDepartamento[l.departamento] ?? { nombre: nombresDepartamento.get(l.departamento) ?? l.nombre, netoCentavos: 0, articulos: 0 };
        d.netoCentavos += l.netoCentavos;
        d.articulos += l.cantidad ?? 0;
        r.porDepartamento[l.departamento] = d;
      }
      let clave = claveArticulo(l);
      if (!(clave in r.productos) && Object.keys(r.productos).length >= MAXIMO_PRODUCTOS_RESUMEN) clave = 'otros';
      const p = r.productos[clave] ?? {
        nombre: clave === 'otros' ? 'Otros artículos' : l.nombre,
        productoId: clave === 'otros' ? null : l.productoId ?? null,
        upc: clave === 'otros' ? null : l.upc ?? null,
        cantidad: 0,
        pesoGramos: 0,
        netoCentavos: 0,
      };
      if (l.unidad === 'peso') p.pesoGramos += l.pesoGramos ?? 0;
      else p.cantidad += l.cantidad ?? 0;
      p.netoCentavos += l.netoCentavos;
      r.productos[clave] = p;
    }
  }

  for (const m of movimientos) {
    const importe = m.importeCentavos ?? 0;
    if (m.tipo === 'retiro') r.efectivo.retirosCentavos += importe;
    else if (m.tipo === 'entrada') r.efectivo.entradasCentavos += importe;
    else if (m.tipo === 'pago') r.efectivo.pagosCentavos += importe;
    else if (m.tipo === 'apertura') r.aperturasCajon += 1;
    else if (m.tipo === 'cancelacion') {
      r.cancelaciones += 1;
      r.cancelacionesCentavos += importe;
    }
  }

  const e = r.efectivo;
  e.esperadoCentavos = e.fondoCentavos + e.ventasCentavos - e.devolucionesCentavos - e.retirosCentavos + e.entradasCentavos - e.pagosCentavos;
  r.minutos = minutosTurno(turno, hasta);
  return r;
}

/** Ventas netas sin impuesto (bases gravada + tasa cero). */
export const ventasNetas = (resumen) => resumen.baseGravadaCentavos + resumen.baseTasaCeroCentavos;

/** Efecto de un movimiento en el efectivo del cajón: +, − o 0 centavos. */
export function efectoMovimiento(movimiento) {
  return (EFECTO_EFECTIVO[movimiento.tipo] ?? 0) * (movimiento.importeCentavos ?? 0);
}

/**
 * Suma resúmenes de varios turnos (reportes de días o semanas). Los productos,
 * departamentos y horas se acumulan por clave.
 */
export function sumarResumenes(resumenes) {
  const total = nuevoResumen(0);
  total.efectivo.esperadoCentavos = 0;
  const sumarCampos = (destino, origen, campos) => { for (const c of campos) destino[c] += origen?.[c] ?? 0; };
  for (const r of resumenes) {
    if (!r) continue;
    sumarCampos(total, r, ['ventas', 'devoluciones', 'articulos', 'brutoCentavos', 'brutoVentasCentavos', 'descuentosCentavos', 'devolucionesCentavos', 'devolucionesSinImpuestoCentavos', 'baseGravadaCentavos', 'baseTasaCeroCentavos', 'impuestoCentavos', 'totalCentavos', 'redondeoCentavos', 'lineasAnuladas', 'lineasAnuladasCentavos', 'cancelaciones', 'cancelacionesCentavos', 'aperturasCajon', 'cambiosPrecio', 'autorizadas', 'minutos']);
    sumarCampos(total.porMetodo, r.porMetodo, METODOS_PAGO);
    sumarCampos(total.efectivo, r.efectivo, ['fondoCentavos', 'ventasCentavos', 'devolucionesCentavos', 'retirosCentavos', 'entradasCentavos', 'pagosCentavos', 'esperadoCentavos']);
    for (const [hora, celda] of Object.entries(r.porHora ?? {})) {
      const t = total.porHora[hora] ?? { ventas: 0, totalCentavos: 0 };
      t.ventas += celda.ventas;
      t.totalCentavos += celda.totalCentavos;
      total.porHora[hora] = t;
    }
    for (const [clave, d] of Object.entries(r.porDepartamento ?? {})) {
      const t = total.porDepartamento[clave] ?? { nombre: d.nombre, netoCentavos: 0, articulos: 0 };
      t.netoCentavos += d.netoCentavos;
      t.articulos += d.articulos;
      total.porDepartamento[clave] = t;
    }
    for (const [clave, p] of Object.entries(r.productos ?? {})) {
      const t = total.productos[clave] ?? { nombre: p.nombre, productoId: p.productoId ?? null, upc: p.upc ?? null, cantidad: 0, pesoGramos: 0, netoCentavos: 0 };
      t.cantidad += p.cantidad;
      t.pesoGramos += p.pesoGramos;
      t.netoCentavos += p.netoCentavos;
      total.productos[clave] = t;
    }
  }
  total.primerFolio = null;
  total.ultimoFolio = null;
  return total;
}

/**
 * Compara el resumen guardado al cerrar con uno recalculado desde las ventas.
 * Devuelve las diferencias encontradas (vacío si coinciden).
 */
export function diferenciasResumen(guardado, recalculado) {
  const campos = ['ventas', 'devoluciones', 'totalCentavos', 'impuestoCentavos', 'baseGravadaCentavos', 'baseTasaCeroCentavos', 'descuentosCentavos', 'redondeoCentavos'];
  const diferencias = [];
  for (const c of campos) if ((guardado?.[c] ?? 0) !== (recalculado?.[c] ?? 0)) diferencias.push({ campo: c, guardado: guardado?.[c] ?? 0, recalculado: recalculado?.[c] ?? 0 });
  for (const m of METODOS_PAGO) {
    if ((guardado?.porMetodo?.[m] ?? 0) !== (recalculado?.porMetodo?.[m] ?? 0)) diferencias.push({ campo: `porMetodo.${m}`, guardado: guardado?.porMetodo?.[m] ?? 0, recalculado: recalculado?.porMetodo?.[m] ?? 0 });
  }
  if ((guardado?.efectivo?.esperadoCentavos ?? 0) !== (recalculado?.efectivo?.esperadoCentavos ?? 0)) {
    diferencias.push({ campo: 'efectivo.esperadoCentavos', guardado: guardado?.efectivo?.esperadoCentavos ?? 0, recalculado: recalculado?.efectivo?.esperadoCentavos ?? 0 });
  }
  return diferencias;
}
