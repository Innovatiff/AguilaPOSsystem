/**
 * Cobro del ticket en la caja: efectivo (con los billetes rápidos y el cambio),
 * débito, crédito u otro, y pagos combinados. En una devolución es el
 * reembolso. Las tarjetas se cobran en la terminal del banco: aquí solo se
 * registra el pago ya aprobado. El cálculo vive en js/ticket.js.
 */
import { METODOS_PAGO, NOMBRE_METODO, estadoCobro, registrarPago, cobrado } from './ticket.js';
import { centavosDesdeTexto } from './precios.js';
import { h, icono, dinero, abrirDialogo, tecladoNumerico, confirmar } from './caja-ui.js';

const ICONO_METODO = Object.freeze({ efectivo: 'cobrar', debito: 'tarjeta', credito: 'tarjeta', otro: 'mas' });
const TECLA_METODO = Object.freeze({ efectivo: 'E', debito: 'D', credito: 'C', otro: 'O' });
const BILLETES = Object.freeze([500, 1000, 2000, 5000, 10000]);
/** Un monto recibido que supera lo que falta por más de esto es casi seguro un error (o un código escaneado). */
const EXCESO_MAXIMO_CENTAVOS = 100000;

/** Montos rápidos en efectivo para lo que falta: el exacto y los billetes que lo cubren. */
export function montosRapidos(pendienteEfectivo) {
  if (!Number.isSafeInteger(pendienteEfectivo) || pendienteEfectivo <= 0) return [];
  const montos = new Set([pendienteEfectivo]);
  for (const billete of BILLETES) montos.add(Math.ceil(pendienteEfectivo / billete) * billete);
  return [...montos].sort((a, b) => a - b).slice(0, 5);
}

/**
 * Diálogo de cobro.
 * @param {{ totalCentavos: number, devolucion?: boolean }} datos
 * @returns {Promise<Array|null>} pagos (completos) o null si se cancela
 */
export function cobrar({ totalCentavos, devolucion = false }) {
  const pagos = [];
  let metodo = 'efectivo';

  const cifraTotal = h('strong', { text: dinero(Math.abs(totalCentavos)) });
  const cifraEfectivo = h('strong');
  const filaEfectivo = h('div', { class: 'pago__cifra' }, h('span', { text: devolucion ? 'En efectivo (redondeado)' : 'Total en efectivo (redondeado)' }), cifraEfectivo);
  const cifraPagado = h('strong', { text: dinero(0) });
  const cifraFalta = h('strong');
  const etiquetaFalta = h('span', { text: devolucion ? 'A devolver' : 'Falta' });
  const filaFalta = h('div', { class: 'pago__cifra pago__cifra--falta' }, etiquetaFalta, cifraFalta);
  const lista = h('ul', { class: 'pago__lista', 'aria-label': 'Pagos registrados' });

  const botonesMetodo = METODOS_PAGO.map((m) => h('button', {
    type: 'button',
    class: 'opcion',
    'aria-pressed': m === metodo ? 'true' : 'false',
    dataset: { metodo: m },
  }, icono(ICONO_METODO[m]), h('span', { text: NOMBRE_METODO[m] }), h('kbd', { text: TECLA_METODO[m] })));
  const metodos = h('div', { class: 'metodos', role: 'group', 'aria-label': 'Forma de pago' }, botonesMetodo);

  const idCampo = 'pago-monto';
  const etiquetaMonto = h('label', { for: idCampo });
  const campo = h('input', { id: idCampo, inputmode: 'none', autocomplete: 'off', maxlength: 9, placeholder: '' });
  const rapidos = h('div', { class: 'rapidos' });
  const nota = h('p', { class: 'dlg__nota' });

  const resumen = h('div', { class: 'pago__resumen' },
    h('div', { class: 'pago__cifra' }, h('span', { text: devolucion ? 'Total a devolver' : 'Total' }), cifraTotal),
    filaEfectivo,
    h('div', { class: 'pago__cifra' }, h('span', { text: devolucion ? 'Devuelto' : 'Pagado' }), cifraPagado),
    filaFalta,
    lista);
  const captura = h('div', { class: 'pago__captura', style: 'display:grid; gap:10px; align-content:start' },
    metodos,
    h('div', { class: 'campo-monto' }, etiquetaMonto, campo),
    rapidos,
    tecladoNumerico({ destino: campo, decimal: true }),
    nota);

  let ctxDialogo = null;

  function pintar() {
    const estado = estadoCobro(totalCentavos, pagos);
    const pendiente = Math.abs(estado.pendienteCentavos);
    const pendienteEfectivo = Math.abs(estado.pendienteEfectivoCentavos);
    cifraFalta.textContent = dinero(metodo === 'efectivo' ? pendienteEfectivo : pendiente);
    filaFalta.dataset.completo = String(estado.completo);
    cifraEfectivo.textContent = dinero(pendienteEfectivo);
    filaEfectivo.hidden = pendienteEfectivo === pendiente;
    cifraPagado.textContent = dinero(Math.abs(cobrado(pagos)));

    lista.replaceChildren(...pagos.map((p, i) => h('li', null,
      h('span', { text: `${NOMBRE_METODO[p.metodo]}${p.recibidoCentavos ? ` (recibido ${dinero(p.recibidoCentavos)})` : ''}` }),
      h('span', null, dinero(Math.abs(p.importeCentavos)), ' ', h('button', {
        type: 'button',
        text: 'Quitar',
        'aria-label': `Quitar el pago ${i + 1}`,
        onclick: () => {
          pagos.splice(i, 1);
          pintar();
          campo.focus();
        },
      })))));

    for (const boton of botonesMetodo) boton.setAttribute('aria-pressed', String(boton.dataset.metodo === metodo));
    if (metodo === 'efectivo') {
      etiquetaMonto.textContent = devolucion ? 'Efectivo a devolver' : 'Efectivo recibido';
      campo.placeholder = dinero(pendienteEfectivo);
      campo.disabled = devolucion; // la devolución en efectivo es siempre por lo pendiente
      nota.textContent = devolucion
        ? `Entrega ${dinero(pendienteEfectivo)} al cliente (redondeado a 5 ¢).`
        : 'Vacío = pago exacto. En efectivo el total se redondea a 5 ¢.';
      rapidos.hidden = devolucion;
      rapidos.replaceChildren(...montosRapidos(pendienteEfectivo).map((monto, i) => h('button', {
        type: 'button',
        class: 'btn',
        text: i === 0 ? `Exacto ${dinero(monto)}` : dinero(monto),
        onclick: () => ctxDialogo?.pulsar({ rapido: monto }),
      })));
    } else {
      etiquetaMonto.textContent = devolucion ? `Monto a devolver con ${NOMBRE_METODO[metodo].toLowerCase()}` : `Monto con ${NOMBRE_METODO[metodo].toLowerCase()}`;
      campo.placeholder = dinero(pendiente);
      campo.disabled = false;
      rapidos.hidden = true;
      rapidos.replaceChildren();
      nota.textContent = metodo === 'otro'
        ? 'Vale, cheque u otra forma de pago. Vacío = todo lo que falta.'
        : devolucion
          ? 'Haz el reembolso en la terminal y registra aquí el monto aprobado.'
          : 'Cobra en la terminal y registra el pago cuando salga APROBADO. Vacío = todo lo que falta.';
    }
  }

  function elegirMetodo(nuevo) {
    metodo = nuevo;
    campo.value = '';
    ctxDialogo?.error(null);
    pintar();
    if (!campo.disabled) campo.focus();
  }

  function aplicar(montoCentavos) {
    const estado = estadoCobro(totalCentavos, pagos);
    if (metodo === 'efectivo' && !devolucion && montoCentavos > Math.abs(estado.pendienteEfectivoCentavos) + EXCESO_MAXIMO_CENTAVOS) {
      throw new Error(`El monto recibido (${dinero(montoCentavos)}) es demasiado alto. Revisa lo que escribiste.`);
    }
    const resultado = registrarPago(totalCentavos, pagos, { metodo, montoCentavos });
    pagos.push(resultado.pago);
    campo.value = '';
    if (resultado.completo) {
      ctxDialogo.cerrar({ pagos: [...pagos] });
      return;
    }
    pintar();
    campo.focus();
  }

  function montoTecleado() {
    const texto = campo.value.trim();
    if (texto === '') return 0;
    const centavos = centavosDesdeTexto(texto);
    if (centavos <= 0) throw new Error('El monto debe ser mayor que cero.');
    return centavos;
  }

  metodos.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-metodo]');
    if (boton) elegirMetodo(boton.dataset.metodo);
  });

  return abrirDialogo({
    titulo: devolucion ? `Reembolso · ${dinero(Math.abs(totalCentavos))}` : `Cobrar · ${dinero(totalCentavos)}`,
    clase: 'dlg--ancho',
    cuerpo: [h('div', { class: 'pago' }, resumen, captura)],
    esc: 'cancelar',
    botones: [
      { texto: 'Volver al ticket', valor: 'cancelar' },
      { texto: devolucion ? 'Registrar reembolso' : 'Registrar pago', valor: 'aplicar', principal: true, clase: 'btn--exito' },
    ],
    alAbrir: (ctx) => {
      ctxDialogo = ctx;
      ctx.dialogo.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          ctx.pulsar('aplicar');
          return;
        }
        const elegido = METODOS_PAGO.find((m) => TECLA_METODO[m].toLowerCase() === e.key.toLowerCase());
        if (elegido) {
          e.preventDefault();
          elegirMetodo(elegido);
        }
      });
      pintar();
      if (!campo.disabled) campo.focus();
    },
    alPulsar: async (valor, ctx) => {
      if (valor && typeof valor === 'object') {
        aplicar(valor.rapido);
        return;
      }
      if (valor === 'cancelar') {
        if (pagos.length > 0) {
          const tarjetas = pagos.some((p) => p.metodo !== 'efectivo');
          const seguro = await confirmar({
            titulo: 'Descartar los pagos',
            texto: `Hay ${pagos.length} pago(s) registrado(s) en este cobro. Si vuelves al ticket se descartan.`,
            nota: tarjetas ? 'Si un pago con tarjeta ya se aprobó en la terminal, anúlalo también en la terminal.' : null,
            aceptar: 'Descartar y volver',
            peligro: true,
          });
          if (!seguro) return;
        }
        ctx.cerrar(null);
        return;
      }
      aplicar(montoTecleado());
    },
  }).then((r) => r?.pagos ?? null);
}
