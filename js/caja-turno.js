/**
 * Diálogos del turno en la caja: fondo inicial, conteo del efectivo por
 * billetes y monedas (a ciegas si así se configura), retiros, entradas y
 * pagos desde caja, y el resultado del cierre. La lógica del resumen vive en
 * js/turnos.js; aquí solo se pide y se muestra.
 */
import { DENOMINACIONES_CAD, NOMBRE_METODO } from './ticket.js';
import { centavosDesdeTexto } from './precios.js';
import { formatearDuracion, totalConteo, NOMBRE_MOVIMIENTO, ventasNetas } from './turnos.js';
import { h, dinero, abrirDialogo, pedirValor, tecladoNumerico } from './caja-ui.js';

/** 10000 → "$100"; 25 → "25 ¢". */
export function nombreDenominacion(centavos) {
  return centavos >= 100 ? `$${centavos / 100}` : `${centavos} ¢`;
}

function montoDesdeTexto(texto, { permitirCero = false } = {}) {
  const limpio = String(texto ?? '').trim();
  if (limpio === '') throw new Error('Escribe el monto.');
  const centavos = centavosDesdeTexto(limpio);
  if (centavos === 0 && !permitirCero) throw new Error('El monto debe ser mayor que cero.');
  if (centavos > 10_000_000) throw new Error('El monto es demasiado alto.');
  return centavos;
}

/** Fondo de cambio con el que empieza el turno. */
export function pedirFondo({ sugeridoCentavos = 15000 } = {}) {
  const opciones = [...new Set([sugeridoCentavos, 10000, 15000, 20000, 0])];
  return pedirValor({
    titulo: 'Fondo inicial de la caja',
    etiqueta: 'Efectivo que hay en el cajón al empezar',
    nota: 'Cuenta el fondo de cambio que te entregaron. Queda en el comprobante de apertura y en el corte.',
    inicial: (sugeridoCentavos / 100).toFixed(2),
    interpretar: (texto) => montoDesdeTexto(texto, { permitirCero: true }),
    vista: (centavos) => `Fondo: ${dinero(centavos)}`,
    rapidos: opciones.map((c) => ({ texto: dinero(c), valor: (c / 100).toFixed(2) })),
    aceptar: 'Abrir turno',
  });
}

/**
 * Conteo del efectivo del cajón por denominación (o solo el total).
 * @param {{ titulo?: string, nota?: string, esperadoCentavos?: number|null, aceptar?: string }} o
 *   Con `esperadoCentavos` null (conteo a ciegas) no se muestra lo esperado.
 * @returns {Promise<{ conteo: object|null, totalCentavos: number }|null>}
 */
export function contarEfectivo({ titulo = 'Conteo del efectivo', nota = null, esperadoCentavos = null, aceptar = 'Continuar' } = {}) {
  const cantidades = new Map(DENOMINACIONES_CAD.map((d) => [d, 0]));
  let soloTotal = false;
  let ultimoCampo = null;

  const total = h('strong', { text: dinero(0) });
  const filas = DENOMINACIONES_CAD.map((denominacion) => {
    const campo = h('input', {
      inputmode: 'none',
      autocomplete: 'off',
      maxlength: 4,
      value: '',
      placeholder: '0',
      'aria-label': `Cantidad de ${nombreDenominacion(denominacion)}`,
      dataset: { denominacion: String(denominacion) },
    });
    const subtotal = h('output', { text: dinero(0) });
    const cambiar = (delta) => {
      const actual = Number.parseInt(campo.value || '0', 10) || 0;
      campo.value = String(Math.max(0, actual + delta) || '');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    };
    campo.addEventListener('focus', () => { ultimoCampo = campo; });
    campo.addEventListener('input', () => {
      campo.value = campo.value.replace(/\D/g, '').slice(0, 4);
      const cantidad = Number.parseInt(campo.value || '0', 10) || 0;
      cantidades.set(denominacion, cantidad);
      subtotal.textContent = dinero(cantidad * denominacion);
      pintarTotal();
    });
    return h('div', { class: 'conteo__fila' },
      h('span', { text: nombreDenominacion(denominacion) }),
      h('button', { type: 'button', text: '−', 'aria-label': `Uno menos de ${nombreDenominacion(denominacion)}`, onclick: () => cambiar(-1) }),
      campo,
      h('button', { type: 'button', text: '+', 'aria-label': `Uno más de ${nombreDenominacion(denominacion)}`, onclick: () => cambiar(1) }),
      subtotal);
  });
  const rejilla = h('div', { class: 'conteo' }, filas);

  const campoTotal = h('input', { id: 'conteo-total', inputmode: 'none', autocomplete: 'off', maxlength: 10, placeholder: '0.00' });
  campoTotal.addEventListener('focus', () => { ultimoCampo = campoTotal; });
  campoTotal.addEventListener('input', pintarTotal);
  const bloqueTotal = h('div', { class: 'campo-monto', hidden: true }, h('label', { for: 'conteo-total', text: 'Total contado' }), campoTotal);

  const alternar = h('button', { type: 'button', class: 'enlace-pos', text: 'Escribir solo el total' });
  alternar.addEventListener('click', () => {
    soloTotal = !soloTotal;
    rejilla.hidden = soloTotal;
    bloqueTotal.hidden = !soloTotal;
    alternar.textContent = soloTotal ? 'Contar por billetes y monedas' : 'Escribir solo el total';
    (soloTotal ? campoTotal : rejilla.querySelector('input'))?.focus();
    pintarTotal();
  });

  function totalActual() {
    if (soloTotal) {
      const texto = campoTotal.value.trim();
      return texto === '' ? 0 : centavosDesdeTexto(texto);
    }
    return totalConteo(Object.fromEntries([...cantidades].map(([d, c]) => [String(d), c])));
  }

  function pintarTotal() {
    try {
      total.textContent = dinero(totalActual());
    } catch {
      total.textContent = '—';
    }
  }

  const cuerpo = [];
  if (nota) cuerpo.push(h('p', { class: 'dlg__nota', text: nota }));
  if (esperadoCentavos !== null && esperadoCentavos !== undefined) {
    cuerpo.push(h('p', { class: 'dlg__texto' }, 'Efectivo esperado en el cajón: ', h('strong', { text: dinero(esperadoCentavos) })));
  }
  cuerpo.push(h('div', { class: 'conteo-layout' },
    h('div', null, rejilla, bloqueTotal),
    h('div', { class: 'conteo-lado' },
      h('div', { class: 'conteo__total' }, h('span', { text: 'Total contado' }), total),
      tecladoNumerico({ destino: () => ultimoCampo, decimal: true }),
      alternar)));

  return abrirDialogo({
    titulo,
    clase: 'dlg--ancho',
    cuerpo,
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: aceptar, valor: 'aceptar', principal: true },
    ],
    alAbrir: () => {
      const primero = rejilla.querySelector('input');
      primero?.focus();
    },
    alPulsar: (_valor, ctx) => {
      const totalCentavos = totalActual();
      if (soloTotal) {
        if (campoTotal.value.trim() === '') throw new Error('Escribe el total contado (0 si el cajón está vacío).');
        ctx.cerrar({ conteo: null, totalCentavos });
        return;
      }
      const conteo = {};
      for (const [d, c] of cantidades) if (c > 0) conteo[String(d)] = c;
      ctx.cerrar({ conteo, totalCentavos });
    },
  });
}

const AYUDA_MOVIMIENTO = Object.freeze({
  retiro: 'Efectivo que sale del cajón hacia la caja fuerte. Se imprime un comprobante para firmar.',
  entrada: 'Efectivo que entra al cajón (más cambio). Se imprime un comprobante.',
  pago: 'Pago a un proveedor u otro gasto pagado con el efectivo del cajón. Escribe el motivo.',
});

/**
 * Retiro, entrada o pago desde caja.
 * @param {'retiro'|'entrada'|'pago'} tipo
 * @returns {Promise<{ importeCentavos: number, motivo: string|null }|null>}
 */
export function pedirMovimiento(tipo) {
  const motivo = h('input', { id: 'movimiento-motivo', autocomplete: 'off', maxlength: 120, placeholder: tipo === 'pago' ? 'Ej. Pago a proveedor de tortillas' : 'Opcional' });
  const campo = h('input', { id: 'movimiento-monto', inputmode: 'none', autocomplete: 'off', maxlength: 9 });
  const cuerpo = [
    h('p', { class: 'dlg__nota', text: AYUDA_MOVIMIENTO[tipo] }),
    h('div', { class: 'campo-monto' }, h('label', { for: 'movimiento-monto', text: 'Monto' }), campo),
    h('label', { for: 'movimiento-motivo', text: tipo === 'pago' ? 'Motivo (obligatorio)' : 'Motivo' }),
    motivo,
    tecladoNumerico({ destino: campo, decimal: true }),
  ];
  return abrirDialogo({
    titulo: NOMBRE_MOVIMIENTO[tipo],
    cuerpo,
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: 'Registrar e imprimir', valor: 'aceptar', principal: true },
    ],
    alAbrir: () => campo.focus(),
    alPulsar: (_valor, ctx) => {
      const importeCentavos = montoDesdeTexto(campo.value);
      const texto = motivo.value.trim();
      if (tipo === 'pago' && texto === '') throw new Error('Escribe el motivo del pago.');
      ctx.cerrar({ importeCentavos, motivo: texto || null });
    },
  });
}

function dato(etiqueta, valor, clase = '') {
  return h('div', { class: `dato ${clase}`.trim() }, h('span', { text: etiqueta }), h('strong', { text: valor }));
}

/**
 * Resultado del cierre (o del corte X): cifras clave en grande.
 * @param {{ turno: object, resumen: object, tipo: 'X'|'Z', contadoCentavos?: number|null, pendientes?: number, alReimprimir?: () => void, terminar?: string }} o
 */
export function mostrarCorte({ turno, resumen, tipo, contadoCentavos = null, pendientes = 0, alReimprimir = null, terminar = 'Terminar', ocultarEsperado = false }) {
  const e = resumen.efectivo;
  const tarjetas = resumen.porMetodo.debito + resumen.porMetodo.credito;
  const datos = [
    dato('Tickets', String(resumen.ventas + resumen.devoluciones)),
    dato('Total vendido', dinero(resumen.totalCentavos)),
    dato('Ventas netas (sin imp.)', dinero(ventasNetas(resumen))),
    dato('Tarjetas', dinero(tarjetas)),
    dato(NOMBRE_METODO.efectivo, dinero(resumen.porMetodo.efectivo)),
    dato('Horas en caja', formatearDuracion(resumen.minutos)),
  ];
  if (!ocultarEsperado) datos.push(dato('Efectivo esperado', dinero(e.esperadoCentavos)));
  if (contadoCentavos !== null && contadoCentavos !== undefined) {
    const diferencia = contadoCentavos - e.esperadoCentavos;
    datos.push(dato('Contado', dinero(contadoCentavos)));
    datos.push(dato(diferencia === 0 ? 'Diferencia (cuadra)' : diferencia > 0 ? 'Sobrante' : 'Faltante', dinero(diferencia), diferencia === 0 ? 'dato--bien' : 'dato--mal'));
  }
  const cuerpo = [h('p', { class: 'dlg__texto' }, `${turno.cajaNombre} · ${turno.cajeroNombre} (${turno.cajero})`)];
  cuerpo.push(h('div', { class: 'resumen-turno' }, datos));
  if (pendientes > 0) {
    cuerpo.push(h('p', { class: 'mensaje-pos', dataset: { tipo: 'aviso' }, text: `Hay ${pendientes} movimiento(s) sin enviar por falta de conexión. Deja la computadora encendida y conectada: se envían solos.` }));
  }
  const botones = [];
  if (alReimprimir) botones.push({ texto: `Reimprimir corte ${tipo}`, valor: 'reimprimir' });
  botones.push({ texto: terminar, valor: 'terminar', principal: true });
  return abrirDialogo({
    titulo: tipo === 'Z' ? 'Turno cerrado' : 'Corte parcial (X)',
    clase: 'dlg--ancho',
    cerrable: tipo !== 'Z',
    cuerpo,
    botones,
    alPulsar: (valor, ctx) => {
      if (valor === 'reimprimir') {
        alReimprimir?.();
        return;
      }
      ctx.cerrar(true);
    },
  });
}
