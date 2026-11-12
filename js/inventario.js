/**
 * Inventario: la mercancía que llega a la tienda (recepciones/{id}).
 * Una entrega por documento: tienda, proveedor, factura o remisión, nota y
 * sus líneas; quién la recibió y cuándo. No toca las existencias de los
 * productos. Un administrador puede anular una entrada (queda a la vista y
 * no cuenta). Módulo puro (sin Firebase ni DOM): arma las entregas, interpreta
 * lo que se teclea y resume lo que llegó por producto. Se prueba en Node.
 *
 * Línea: { producto, nombre, upc, plu, cantidad, pesoGramos }
 *   - pieza: cantidad entera (1 a 99 999), pesoGramos null.
 *   - peso:  pesoGramos entero (1 g a 99 999.999 kg), cantidad null.
 *   - producto: id del catálogo, o null si llegó algo que aún no está dado de alta.
 */
import { normalizarTexto } from './esquema.js';
import { formatearPeso } from './ticket.js';
import { t, tc, numero } from './idioma.js';

export const LIMITES_RECEPCION = Object.freeze({
  lineas: 300,
  piezas: 99999,
  gramos: 99999999,
  nombre: 120,
  proveedor: 80,
  referencia: 60,
  nota: 200,
});

/** "MASECA Harina de maíz 1.8 kg": marca, nombre y presentación. */
export function nombreCompleto(producto) {
  return [producto?.marca, producto?.nombre, producto?.presentacion]
    .filter((parte) => typeof parte === 'string' && parte.trim() !== '')
    .join(' ')
    .slice(0, LIMITES_RECEPCION.nombre) || 'Producto';
}

/** Piezas tecleadas: entero de 1 a 99 999. */
export function piezasDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (!/^\d{1,5}$/.test(limpio)) throw new Error(t('Cantidad no válida: escribe un número entero de piezas (1 a 99 999).'));
  const piezas = Number.parseInt(limpio, 10);
  if (piezas < 1) throw new Error(t('La cantidad debe ser al menos 1 pieza.'));
  return piezas;
}

/** Kilos tecleados ("12.5", "0,750", "25 kg") → gramos enteros, sin pasar por flotantes. */
export function kilosDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s*kg$/i, '').replace(',', '.');
  const coincidencia = /^(\d{1,5})?(?:\.(\d{0,3}))?$/.exec(limpio);
  if (!coincidencia || limpio === '' || limpio === '.') throw new Error(t('Peso no válido: escribe los kilos, por ejemplo 12.500'));
  const gramos = Number.parseInt(coincidencia[1] ?? '0', 10) * 1000 + Number.parseInt((coincidencia[2] ?? '').padEnd(3, '0'), 10);
  if (gramos <= 0) throw new Error(t('El peso debe ser mayor que cero.'));
  return gramos;
}

/** 12500 → "12.5" (para volver a mostrar en el campo de kilos). */
export function textoKilos(gramos) {
  if (!Number.isInteger(gramos) || gramos <= 0) return '';
  const decimales = String(gramos % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${Math.floor(gramos / 1000)}${decimales ? `.${decimales}` : ''}`;
}

/**
 * "24*0123456789012" o "24 x 0123…": cuántas piezas y qué código. Sin
 * multiplicador, una pieza (cantidad null: la decide quien llama).
 */
export function separarMultiplicador(texto) {
  const limpio = String(texto ?? '').trim();
  const m = /^(\d{1,5})\s*[*xX×]\s*(\S.*)$/.exec(limpio);
  if (!m) return { cantidad: null, codigo: limpio };
  return { cantidad: piezasDesdeTexto(m[1]), codigo: m[2].trim() };
}

/** ¿Se recibe por peso? (productos con unidadVenta 'peso') */
export const esDePeso = (producto) => producto?.unidadVenta === 'peso';

/** Línea de un producto del catálogo. */
export function lineaDeRecepcion(producto, { cantidad = null, pesoGramos = null } = {}) {
  const peso = esDePeso(producto);
  return {
    producto: producto.id ?? null,
    nombre: nombreCompleto(producto),
    upc: producto.upc || null,
    plu: producto.plu || null,
    cantidad: peso ? null : (cantidad ?? 1),
    pesoGramos: peso ? pesoGramos : null,
  };
}

/** Línea de algo que llegó y no está en el catálogo: su código y el nombre que se teclea. */
export function lineaSinRegistrar({ upc = null, nombre, cantidad = 1 }) {
  const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  if (limpio === '') throw new Error(t('Escribe el nombre del producto.'));
  return { producto: null, nombre: limpio.slice(0, LIMITES_RECEPCION.nombre), upc: upc || null, plu: null, cantidad, pesoGramos: null };
}

/** Misma mercancía: mismo producto del catálogo, o mismo código o nombre si no está dado de alta. */
export function claveDeLinea(l) {
  if (l.producto) return `p:${l.producto}`;
  if (l.upc) return `u:${l.upc}`;
  return `n:${normalizarTexto(l.nombre)}`;
}

/** Errores de una línea (vacío = bien). */
export function erroresDeLinea(l) {
  const errores = [];
  if (typeof l?.nombre !== 'string' || l.nombre.trim() === '') errores.push(t('sin nombre'));
  if (l?.pesoGramos !== null && l?.pesoGramos !== undefined) {
    if (!Number.isInteger(l.pesoGramos) || l.pesoGramos <= 0 || l.pesoGramos > LIMITES_RECEPCION.gramos) errores.push(t('peso no válido'));
    if (l.cantidad !== null) errores.push(t('una línea por peso no lleva piezas'));
  } else if (!Number.isInteger(l?.cantidad) || l.cantidad < 1 || l.cantidad > LIMITES_RECEPCION.piezas) {
    errores.push(l?.cantidad === null || l?.cantidad === undefined ? t('falta el peso') : t('cantidad no válida'));
  }
  return errores;
}

const textoONulo = (valor, maximo) => {
  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ');
  return limpio === '' ? null : limpio.slice(0, maximo);
};

/**
 * Documento de una entrega, listo para guardar (sin `fecha`, que pone el
 * servidor). Junta las líneas repetidas. Lanza con un mensaje para el
 * personal si algo no cuadra.
 */
export function armarRecepcion({ lineas, tienda = null, proveedor = null, referencia = null, nota = null }, personal) {
  if (!Array.isArray(lineas) || lineas.length === 0) throw new Error(t('Agrega al menos un producto a la entrada.'));
  const juntas = new Map();
  for (const l of lineas) {
    const errores = erroresDeLinea(l);
    const cual = l?.nombre || t('Una línea');
    if (errores.length) throw new Error(`${cual}: ${errores.join(', ')}.`);
    const clave = claveDeLinea(l);
    const previa = juntas.get(clave);
    if (!previa) {
      juntas.set(clave, {
        producto: l.producto ?? null,
        nombre: l.nombre.trim().slice(0, LIMITES_RECEPCION.nombre),
        upc: l.upc || null,
        plu: l.plu || null,
        cantidad: l.pesoGramos ? null : l.cantidad,
        pesoGramos: l.pesoGramos ?? null,
      });
    } else if (previa.pesoGramos !== null && l.pesoGramos) {
      previa.pesoGramos += l.pesoGramos;
    } else if (previa.cantidad !== null && !l.pesoGramos) {
      previa.cantidad += l.cantidad;
    } else {
      throw new Error(t('{nombre}: no se puede recibir por piezas y por peso en la misma entrada.', { nombre: l.nombre }));
    }
  }
  const finales = [...juntas.values()];
  if (finales.length > LIMITES_RECEPCION.lineas) throw new Error(t('Una entrada lleva como máximo {n} productos; regístrala en dos.', { n: LIMITES_RECEPCION.lineas }));
  for (const l of finales) {
    if ((l.cantidad ?? 0) > LIMITES_RECEPCION.piezas) throw new Error(t('{nombre}: como máximo {n} piezas por producto.', { nombre: l.nombre, n: LIMITES_RECEPCION.piezas }));
    if ((l.pesoGramos ?? 0) > LIMITES_RECEPCION.gramos) throw new Error(t('{nombre}: el peso es demasiado grande.', { nombre: l.nombre }));
  }
  if (tienda !== null && !/^[a-z0-9-]{2,40}$/.test(tienda)) throw new Error(t('La tienda no es válida.'));
  return {
    tienda: tienda || null,
    proveedor: textoONulo(proveedor, LIMITES_RECEPCION.proveedor),
    referencia: textoONulo(referencia, LIMITES_RECEPCION.referencia),
    nota: textoONulo(nota, LIMITES_RECEPCION.nota),
    lineas: finales,
    productos: finales.length,
    piezas: finales.reduce((suma, l) => suma + (l.cantidad ?? 0), 0),
    gramos: finales.reduce((suma, l) => suma + (l.pesoGramos ?? 0), 0),
    recibidoPor: personal.usuario,
    recibidoPorNombre: String(personal.nombre || personal.usuario).trim().slice(0, 80),
    anulada: false,
    anuladaPor: null,
    anuladaEn: null,
  };
}

/** "48 piezas" · "1 pieza" · "12.500 kg" · "48 piezas · 12.500 kg" · "—". */
export function textoCantidades({ piezas = 0, gramos = 0 } = {}) {
  const partes = [];
  if (piezas) partes.push(piezas === 1 ? t('{n} pieza', { n: numero(piezas) }) : t('{n} piezas', { n: numero(piezas) }));
  if (gramos) partes.push(formatearPeso(gramos));
  return partes.join(' · ') || '—';
}

/** Lo que dice una línea: "24 piezas" o "12.500 kg". */
export const textoLinea = (l) => textoCantidades({ piezas: l.cantidad ?? 0, gramos: l.pesoGramos ?? 0 });

const milis = (valor) => {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return valor;
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  return null;
};

/** La entrega cumple los filtros de la página ('' = cualquiera; tienda '-' = sin tienda). */
export function cumpleFiltrosRecepcion(r, { tienda = '', proveedor = '', buscar = '' } = {}) {
  if (tienda === '-' && r.tienda) return false;
  if (tienda && tienda !== '-' && r.tienda !== tienda) return false;
  if (proveedor && normalizarTexto(r.proveedor) !== normalizarTexto(proveedor)) return false;
  const terminos = normalizarTexto(buscar).split(' ').filter(Boolean);
  if (terminos.length) {
    const texto = normalizarTexto([r.proveedor, r.referencia, r.nota, r.recibidoPorNombre, ...(r.lineas ?? []).map((l) => `${l.nombre} ${l.upc ?? ''} ${l.plu ?? ''}`)].join(' '));
    if (!terminos.every((termino) => texto.includes(termino))) return false;
  }
  return true;
}

/** ¿La línea coincide con lo que se busca? (para el resumen por producto) */
export function lineaCoincide(l, buscar) {
  const terminos = normalizarTexto(buscar).split(' ').filter(Boolean);
  if (!terminos.length) return true;
  const texto = normalizarTexto(`${l.nombre} ${l.upc ?? ''} ${l.plu ?? ''}`);
  return terminos.every((termino) => texto.includes(termino));
}

/**
 * Las líneas de una entrega que cuentan con una búsqueda: si alguna línea
 * coincide, solo esas; si la entrega coincidió por su proveedor, factura o
 * nota, todas; si no coincidió nada, ninguna.
 */
export function lineasVisibles(r, buscar = '') {
  const lineas = r.lineas ?? [];
  if (normalizarTexto(buscar) === '') return lineas;
  const coinciden = lineas.filter((l) => lineaCoincide(l, buscar));
  if (coinciden.length) return coinciden;
  return cumpleFiltrosRecepcion(r, { buscar }) ? lineas : [];
}

/**
 * Lo que llegó, por producto: cuántas piezas y kilos, en cuántas entregas, la
 * última vez y de qué proveedores. Las entradas anuladas no cuentan. Con
 * `buscar`, las líneas de lineasVisibles(). Ordenado por nombre.
 */
export function resumirPorProducto(recepciones, { buscar = '' } = {}) {
  const porClave = new Map();
  for (const r of recepciones) {
    if (r.anulada) continue;
    for (const l of lineasVisibles(r, buscar)) {
      const clave = claveDeLinea(l);
      let fila = porClave.get(clave);
      if (!fila) {
        fila = { clave, producto: l.producto ?? null, nombre: l.nombre, upc: l.upc ?? null, plu: l.plu ?? null, piezas: 0, gramos: 0, entregas: 0, ultima: null, proveedores: new Set(), ids: new Set() };
        porClave.set(clave, fila);
      }
      fila.piezas += l.cantidad ?? 0;
      fila.gramos += l.pesoGramos ?? 0;
      if (!fila.ids.has(r.id)) {
        fila.ids.add(r.id);
        fila.entregas += 1;
      }
      const cuando = milis(r.fecha);
      if (cuando !== null && (fila.ultima === null || cuando > fila.ultima)) {
        fila.ultima = cuando;
        fila.nombre = l.nombre; // el nombre más reciente manda
      }
      if (r.proveedor) fila.proveedores.add(r.proveedor);
    }
  }
  return [...porClave.values()]
    .map(({ ids, proveedores, ...fila }) => ({ ...fila, proveedores: [...proveedores].sort((a, b) => a.localeCompare(b, 'es')) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** Totales de una lista de entregas (con `buscar`, de sus líneas visibles): las anuladas solo se cuentan aparte. */
export function totalesRecepciones(recepciones, { buscar = '' } = {}) {
  const productos = new Set();
  let entregas = 0;
  let anuladas = 0;
  let piezas = 0;
  let gramos = 0;
  for (const r of recepciones) {
    const lineas = lineasVisibles(r, buscar);
    if (lineas.length === 0) continue;
    if (r.anulada) {
      anuladas += 1;
      continue;
    }
    entregas += 1;
    for (const l of lineas) {
      productos.add(claveDeLinea(l));
      piezas += l.cantidad ?? 0;
      gramos += l.pesoGramos ?? 0;
    }
  }
  return { entregas, anuladas, piezas, gramos, productos: productos.size };
}

/**
 * Filas del CSV: una por línea de cada entrega, de la más antigua a la más
 * reciente. `fechaTexto` y `nombreTienda` los pone quien llama (formato local).
 * Es un reporte para personas: encabezados y estados en el idioma elegido.
 */
export function filasCSVRecepciones(recepciones, { fechaTexto, nombreTienda, buscar = '' }) {
  const filas = [[
    tc('csv', 'fecha'), tc('csv', 'tienda'), tc('csv', 'proveedor'), tc('csv', 'referencia'), tc('csv', 'recibio'), tc('csv', 'producto'),
    'upc', 'plu', tc('csv', 'piezas'), 'kg', tc('csv', 'estado'), tc('csv', 'nota'),
  ]];
  const ordenadas = [...recepciones].sort((a, b) => (milis(a.fecha) ?? 0) - (milis(b.fecha) ?? 0));
  for (const r of ordenadas) {
    for (const l of lineasVisibles(r, buscar)) {
      filas.push([
        fechaTexto(r.fecha), r.tienda ? nombreTienda(r.tienda) : '', r.proveedor ?? '', r.referencia ?? '', r.recibidoPorNombre ?? '',
        l.nombre, l.upc ?? '', l.plu ?? '', l.cantidad ?? '', l.pesoGramos ? textoKilos(l.pesoGramos) : '',
        r.anulada ? tc('csv', 'anulada') : tc('csv', 'recibida'), r.nota ?? '',
      ]);
    }
  }
  return filas;
}

// ===================================================================== existencias: tienda y bodega (Ajuste rápido)
//
// existencias/{tienda}__{producto}: el último conteo de cada producto en la
// tienda (enTienda) y en la bodega (enBodega), cada uno con quién y cuándo, y
// la caducidad y el país de procedencia. Un conteo es «cuántas hay ahora»:
// cajas × lo que trae cada caja + sueltas = total (piezas, o gramos en los
// productos por peso). Todo es opcional: lo que se deja vacío no cambia.

export const LUGARES = Object.freeze(['enTienda', 'enBodega']);
export const LIMITES_CONTEO = Object.freeze({ cajas: 99999, piezas: 99999999, gramos: 99999999, total: 999999999, origen: 60 });
/** Una caducidad a estos días o menos sale marcada. */
export const DIAS_CADUCA_PRONTO = 7;

const estaVacio = (texto) => String(texto ?? '').trim() === '';

/** Entero tecleado (cajas o piezas), sin separadores: vacío → null. */
function enteroDesdeTexto(texto, { minimo, maximo, mensaje }) {
  if (estaVacio(texto)) return null;
  const limpio = String(texto).trim().replace(/[\s,]/g, '');
  if (!/^\d{1,9}$/.test(limpio)) throw new Error(mensaje);
  const n = Number.parseInt(limpio, 10);
  if (n < minimo || n > maximo) throw new Error(mensaje);
  return n;
}

/** Kilos tecleados → gramos: vacío → null; con `cero`, «0» vale 0. */
function gramosDeConteo(texto, { cero = false } = {}) {
  if (estaVacio(texto)) return null;
  if (cero && /^0*(?:[.,]0*)?(?:\s*kg)?$/i.test(String(texto).trim())) return 0;
  return kilosDesdeTexto(texto);
}

/**
 * Lo tecleado para un lugar → { cajas, porCaja, sueltas, total } (piezas, o
 * gramos si `porPeso`), o null si todo quedó vacío (ese lugar no se contó).
 * Lanza un Error que se le puede mostrar a quien cuenta.
 */
export function conteoDesdeTexto({ cajas = '', porCaja = '', sueltas = '' } = {}, { porPeso = false } = {}) {
  const nCajas = enteroDesdeTexto(cajas, { minimo: 0, maximo: LIMITES_CONTEO.cajas, mensaje: t('Cajas: escribe un número entero (0 a 99 999).') });
  const nPorCaja = porPeso
    ? gramosDeConteo(porCaja)
    : enteroDesdeTexto(porCaja, { minimo: 1, maximo: LIMITES_CONTEO.piezas, mensaje: t('Piezas por caja: escribe un número entero mayor que cero.') });
  const nSueltas = porPeso
    ? gramosDeConteo(sueltas, { cero: true })
    : enteroDesdeTexto(sueltas, { minimo: 0, maximo: LIMITES_CONTEO.piezas, mensaje: t('Sueltas: escribe un número entero de piezas.') });
  // Sin cajas ni sueltas, ese lugar no se contó (lo que trae cada caja puede venir ya escrito del conteo anterior).
  if (nCajas === null && nSueltas === null) return null;
  const cuantasCajas = nCajas === 0 && nPorCaja === null ? null : nCajas; // «0 cajas» sin más es lo mismo que nada
  if (cuantasCajas !== null && nPorCaja === null) {
    throw new Error(porPeso ? t('Escribe cuántos kilos trae cada caja.') : t('Escribe cuántas piezas trae cada caja.'));
  }
  const total = (cuantasCajas === null ? 0 : cuantasCajas * nPorCaja) + (nSueltas ?? 0);
  if (total > LIMITES_CONTEO.total) throw new Error(t('La cantidad es demasiado grande.'));
  return { cajas: cuantasCajas, porCaja: nPorCaja, sueltas: nSueltas, total };
}

/** Total de un lugar: "40 piezas" · "1 pieza" · "20.500 kg" · "—" si no se ha contado. */
export function textoTotal(total, porPeso) {
  if (!Number.isInteger(total)) return '—';
  if (porPeso) return formatearPeso(total);
  return total === 1 ? t('{n} pieza', { n: numero(total) }) : t('{n} piezas', { n: numero(total) });
}

/** Cómo se contó: "3 cajas × 12 + 4" · "1 caja × 10.000 kg" · "" si fueron solo sueltas. */
export function textoDesglose(conteo, porPeso) {
  if (!conteo || conteo.cajas === null || conteo.cajas === undefined || !conteo.porCaja) return '';
  const porCaja = porPeso ? formatearPeso(conteo.porCaja) : numero(conteo.porCaja);
  const cajas = conteo.cajas === 1
    ? t('1 caja × {porCaja}', { porCaja })
    : t('{n} cajas × {porCaja}', { n: numero(conteo.cajas), porCaja });
  if (!conteo.sueltas) return cajas;
  return t('{cajas} + {sueltas}', { cajas, sueltas: porPeso ? formatearPeso(conteo.sueltas) : numero(conteo.sueltas) });
}

/** Fecha de caducidad tecleada ('AAAA-MM-DD', la de un campo de fecha) → la misma o null. Lanza si no existe esa fecha. */
export function caducidadDesdeTexto(texto) {
  if (estaVacio(texto)) return null;
  const limpio = String(texto).trim();
  const fecha = new Date(`${limpio}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio) || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== limpio) {
    throw new Error(t('La fecha de caducidad no es válida.'));
  }
  return limpio;
}

/**
 * Países que se proponen al contar: [como se guarda (español), como se ve].
 * Como los departamentos, un país de la lista se guarda en español (así no
 * quedan «México» y «Mexico» revueltos) y se muestra en el idioma de la
 * pantalla; cualquier otro, como se escribió.
 */
const paises = () => [
  ['México', t('México')], ['Canadá', t('Canadá')], ['Estados Unidos', t('Estados Unidos')], ['Guatemala', t('Guatemala')],
  ['El Salvador', t('El Salvador')], ['Honduras', t('Honduras')], ['Nicaragua', t('Nicaragua')], ['Costa Rica', t('Costa Rica')],
  ['Panamá', t('Panamá')], ['Colombia', t('Colombia')], ['Perú', t('Perú')], ['Ecuador', t('Ecuador')], ['Chile', t('Chile')],
  ['Argentina', t('Argentina')], ['Brasil', t('Brasil')], ['República Dominicana', t('República Dominicana')], ['España', t('España')],
  ['Italia', t('Italia')], ['China', t('China')], ['Tailandia', t('Tailandia')], ['India', t('India')],
];

/** Los países de la lista, en el idioma de la pantalla. */
export const paisesSugeridos = () => paises().map(([, visible]) => visible);

/** País guardado → como se ve en el idioma de la pantalla (null si no hay). */
export function paisEnPantalla(origen) {
  if (typeof origen !== 'string' || origen.trim() === '') return null;
  return paises().find(([guardado]) => guardado === origen)?.[1] ?? origen;
}

/** País de procedencia tecleado → como se guarda (máximo 60; los de la lista, en español) o null. */
export function origenDesdeTexto(texto) {
  const limpio = textoONulo(texto, LIMITES_CONTEO.origen);
  if (limpio === null) return null;
  const clave = normalizarTexto(limpio);
  return paises().find(([guardado, visible]) => normalizarTexto(guardado) === clave || normalizarTexto(visible) === clave)?.[0] ?? limpio;
}

/** 'vencido' (ya pasó), 'pronto' (en DIAS_CADUCA_PRONTO días o menos) o null. `hoy`: 'AAAA-MM-DD'. */
export function estadoCaducidad(caducidad, hoy) {
  if (typeof caducidad !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(caducidad)) return null;
  const dias = Math.round((Date.parse(`${caducidad}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86400000);
  if (Number.isNaN(dias)) return null;
  if (dias < 0) return 'vencido';
  return dias <= DIAS_CADUCA_PRONTO ? 'pronto' : null;
}

/**
 * Ajuste rápido listo para guardar con merge (js/existencias.js pone la hora
 * del servidor): la identidad del producto, los lugares contados, la
 * caducidad, el país y quién lo hizo. Los lugares en null no se escriben (se
 * quedan como estaban); la caducidad y el país, solo si vienen (undefined =
 * no se tocaron; null = se borran). Así dos personas que cuentan a la vez la
 * tienda y la bodega no se pisan. Lanza si falta la tienda o el producto.
 */
export function armarAjuste({ producto, tienda, enTienda = null, enBodega = null, caducidad, origen }, personal) {
  if (typeof tienda !== 'string' || !/^[a-z0-9-]{2,40}$/.test(tienda)) throw new Error(t('Elige la tienda.'));
  if (!producto || typeof producto.id !== 'string' || producto.id === '') throw new Error(t('Elige un producto del catálogo.'));
  const nombrePersona = String(personal.nombre || personal.usuario).trim().slice(0, 80);
  const quien = { contadoPor: personal.usuario, contadoPorNombre: nombrePersona };
  const datos = {
    tienda,
    producto: producto.id,
    nombre: nombreCompleto(producto),
    upc: producto.upc || null,
    plu: producto.plu || null,
    porPeso: esDePeso(producto),
    actualizadoPor: personal.usuario,
    actualizadoPorNombre: nombrePersona,
  };
  if (caducidad !== undefined) datos.caducidad = caducidad;
  if (origen !== undefined) datos.origen = origen;
  if (enTienda) datos.enTienda = { cajas: enTienda.cajas, porCaja: enTienda.porCaja, sueltas: enTienda.sueltas, total: enTienda.total, ...quien };
  if (enBodega) datos.enBodega = { cajas: enBodega.cajas, porCaja: enBodega.porCaja, sueltas: enBodega.sueltas, total: enBodega.total, ...quien };
  return { id: `${tienda}__${producto.id}`, datos };
}

/** Total de un producto: tienda + bodega (null si no se ha contado en ningún lado). */
export function totalExistencia(e) {
  const contados = LUGARES.map((lugar) => e?.[lugar]?.total).filter(Number.isInteger);
  return contados.length ? contados.reduce((suma, n) => suma + n, 0) : null;
}

/** Filas de la tabla de existencias: búsqueda (nombre, código, país) y, si se pide, solo lo que caduca pronto o ya caducó. */
export function filasExistencias(lista, { buscar = '', porCaducar = false, hoy } = {}) {
  const terminos = normalizarTexto(buscar).split(' ').filter(Boolean);
  return lista
    .filter((e) => {
      if (porCaducar && !estadoCaducidad(e.caducidad, hoy)) return false;
      if (!terminos.length) return true;
      const texto = normalizarTexto([e.nombre, e.upc, e.plu, e.origen, paisEnPantalla(e.origen)].filter(Boolean).join(' '));
      return terminos.every((termino) => texto.includes(termino));
    })
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/**
 * Filas del CSV de existencias (reporte para personas: encabezados en el
 * idioma elegido; cantidades en piezas o en kilos con tres decimales).
 */
export function filasCSVExistencias(lista, { fechaTexto, nombreTienda }) {
  const cantidad = (e, total) => (Number.isInteger(total) ? (e.porPeso ? textoKilos(total) || '0' : total) : '');
  const filas = [[
    tc('csv', 'tienda'), tc('csv', 'producto'), 'upc', 'plu', tc('csv', 'unidad'), tc('csv', 'en_tienda'), tc('csv', 'en_bodega'), tc('csv', 'total'),
    tc('csv', 'caducidad'), tc('csv', 'origen'), tc('csv', 'contado_tienda'), tc('csv', 'contado_bodega'),
  ]];
  for (const e of lista) {
    filas.push([
      nombreTienda(e.tienda), e.nombre, e.upc ?? '', e.plu ?? '', e.porPeso ? 'kg' : tc('csv', 'piezas'),
      cantidad(e, e.enTienda?.total), cantidad(e, e.enBodega?.total), cantidad(e, totalExistencia(e)),
      e.caducidad ?? '', paisEnPantalla(e.origen) ?? '',
      e.enTienda?.contadoEn ? fechaTexto(e.enTienda.contadoEn) : '', e.enBodega?.contadoEn ? fechaTexto(e.enBodega.contadoEn) : '',
    ]);
  }
  return filas;
}
