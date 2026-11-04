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
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .join(' ')
    .slice(0, LIMITES_RECEPCION.nombre) || 'Producto';
}

/** Piezas tecleadas: entero de 1 a 99 999. */
export function piezasDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim();
  if (!/^\d{1,5}$/.test(limpio)) throw new Error('Cantidad no válida: escribe un número entero de piezas (1 a 99 999).');
  const piezas = Number.parseInt(limpio, 10);
  if (piezas < 1) throw new Error('La cantidad debe ser al menos 1 pieza.');
  return piezas;
}

/** Kilos tecleados ("12.5", "0,750", "25 kg") → gramos enteros, sin pasar por flotantes. */
export function kilosDesdeTexto(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s*kg$/i, '').replace(',', '.');
  const coincidencia = /^(\d{1,5})?(?:\.(\d{0,3}))?$/.exec(limpio);
  if (!coincidencia || limpio === '' || limpio === '.') throw new Error('Peso no válido: escribe los kilos, por ejemplo 12.500');
  const gramos = Number.parseInt(coincidencia[1] ?? '0', 10) * 1000 + Number.parseInt((coincidencia[2] ?? '').padEnd(3, '0'), 10);
  if (gramos <= 0) throw new Error('El peso debe ser mayor que cero.');
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
  if (limpio === '') throw new Error('Escribe el nombre del producto.');
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
  if (typeof l?.nombre !== 'string' || l.nombre.trim() === '') errores.push('sin nombre');
  if (l?.pesoGramos !== null && l?.pesoGramos !== undefined) {
    if (!Number.isInteger(l.pesoGramos) || l.pesoGramos <= 0 || l.pesoGramos > LIMITES_RECEPCION.gramos) errores.push('peso no válido');
    if (l.cantidad !== null) errores.push('una línea por peso no lleva piezas');
  } else if (!Number.isInteger(l?.cantidad) || l.cantidad < 1 || l.cantidad > LIMITES_RECEPCION.piezas) {
    errores.push(l?.cantidad === null || l?.cantidad === undefined ? 'falta el peso' : 'cantidad no válida');
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
  if (!Array.isArray(lineas) || lineas.length === 0) throw new Error('Agrega al menos un producto a la entrada.');
  const juntas = new Map();
  for (const l of lineas) {
    const errores = erroresDeLinea(l);
    if (errores.length) throw new Error(`${l?.nombre || 'Una línea'}: ${errores.join(', ')}.`);
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
      throw new Error(`${l.nombre}: no se puede recibir por piezas y por peso en la misma entrada.`);
    }
  }
  const finales = [...juntas.values()];
  if (finales.length > LIMITES_RECEPCION.lineas) throw new Error(`Una entrada lleva como máximo ${LIMITES_RECEPCION.lineas} productos; regístrala en dos.`);
  for (const l of finales) {
    if ((l.cantidad ?? 0) > LIMITES_RECEPCION.piezas) throw new Error(`${l.nombre}: como máximo ${LIMITES_RECEPCION.piezas} piezas por producto.`);
    if ((l.pesoGramos ?? 0) > LIMITES_RECEPCION.gramos) throw new Error(`${l.nombre}: el peso es demasiado grande.`);
  }
  if (tienda !== null && !/^[a-z0-9-]{2,40}$/.test(tienda)) throw new Error('La tienda no es válida.');
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
  if (piezas) partes.push(`${piezas.toLocaleString('es-MX')} ${piezas === 1 ? 'pieza' : 'piezas'}`);
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
    if (!terminos.every((t) => texto.includes(t))) return false;
  }
  return true;
}

/** ¿La línea coincide con lo que se busca? (para el resumen por producto) */
export function lineaCoincide(l, buscar) {
  const terminos = normalizarTexto(buscar).split(' ').filter(Boolean);
  if (!terminos.length) return true;
  const texto = normalizarTexto(`${l.nombre} ${l.upc ?? ''} ${l.plu ?? ''}`);
  return terminos.every((t) => texto.includes(t));
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
 */
export function filasCSVRecepciones(recepciones, { fechaTexto, nombreTienda, buscar = '' }) {
  const filas = [['fecha', 'tienda', 'proveedor', 'referencia', 'recibio', 'producto', 'upc', 'plu', 'piezas', 'kg', 'estado', 'nota']];
  const ordenadas = [...recepciones].sort((a, b) => (milis(a.fecha) ?? 0) - (milis(b.fecha) ?? 0));
  for (const r of ordenadas) {
    for (const l of lineasVisibles(r, buscar)) {
      filas.push([
        fechaTexto(r.fecha), r.tienda ? nombreTienda(r.tienda) : '', r.proveedor ?? '', r.referencia ?? '', r.recibidoPorNombre ?? '',
        l.nombre, l.upc ?? '', l.plu ?? '', l.cantidad ?? '', l.pesoGramos ? textoKilos(l.pesoGramos) : '',
        r.anulada ? 'anulada' : 'recibida', r.nota ?? '',
      ]);
    }
  }
  return filas;
}
