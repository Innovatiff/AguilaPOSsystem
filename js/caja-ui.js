/**
 * Piezas de interfaz de la caja (/caja/): diálogos modales, teclado numérico
 * táctil, avisos y sonidos. Sin Firebase: solo DOM.
 *
 * Los diálogos usan <dialog> nativo con showModal(): mientras hay uno abierto,
 * el teclado y el escáner escriben en el diálogo, no en el ticket.
 */
import { formatearMonto } from './ticket.js';
import { h } from './dom.js';

// ------------------------------------------------------------- DOM

export { h } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

/** Ícono del sprite de la página: icono('buscar') → <svg class="icono"><use href="#i-buscar"/></svg> */
export function icono(nombre, clase = 'icono') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', clase);
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS(SVG, 'use');
  uso.setAttribute('href', `#i-${nombre}`);
  svg.append(uso);
  return svg;
}

export const dinero = (centavos) => formatearMonto(centavos);

/** ¿Hay un diálogo modal abierto? */
export const hayDialogoAbierto = () => document.querySelector('dialog[open]') !== null;

// ------------------------------------------------------------- avisos y sonido

const MAXIMO_AVISOS = 3;

/**
 * Aviso flotante abajo al centro.
 * @param {string} texto
 * @param {'info'|'ok'|'error'|'aviso'} [tipo]
 */
export function avisar(texto, tipo = 'info', duracionMs = tipo === 'error' ? 6000 : 3500) {
  const contenedor = document.getElementById('avisos-pos');
  if (!contenedor) return null;
  const aviso = h('div', { class: `aviso-pos aviso-pos--${tipo}`, role: tipo === 'error' ? 'alert' : 'status', text: texto });
  aviso.addEventListener('click', () => aviso.remove());
  contenedor.append(aviso);
  while (contenedor.children.length > MAXIMO_AVISOS) contenedor.firstElementChild.remove();
  if (duracionMs > 0) setTimeout(() => aviso.remove(), duracionMs);
  return aviso;
}

let audio = null;

function tono(frecuencia, inicio, duracion, volumen = 0.06, forma = 'square') {
  const oscilador = audio.createOscillator();
  const ganancia = audio.createGain();
  oscilador.type = forma;
  oscilador.frequency.value = frecuencia;
  ganancia.gain.value = volumen;
  oscilador.connect(ganancia).connect(audio.destination);
  oscilador.start(audio.currentTime + inicio);
  oscilador.stop(audio.currentTime + inicio + duracion);
}

/** Pitido de lectura correcta, de error o de venta terminada. */
export function sonar(tipo = 'ok') {
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    audio ??= new Contexto();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    if (tipo === 'error') {
      tono(320, 0, 0.12, 0.08);
      tono(240, 0.16, 0.18, 0.08);
    } else if (tipo === 'venta') {
      tono(1046, 0, 0.08, 0.05, 'sine');
      tono(1568, 0.09, 0.14, 0.05, 'sine');
    } else {
      tono(1600, 0, 0.06, 0.04);
    }
  } catch {
    // sin audio
  }
}

// ------------------------------------------------------------- teclado numérico táctil

/**
 * Teclado numérico en pantalla que escribe en un <input>. No le quita el foco.
 * @param {{ destino: HTMLInputElement | (() => HTMLInputElement|null), decimal?: boolean, dobleCero?: boolean, alEnter?: () => void, clase?: string }} opciones
 */
export function tecladoNumerico({ destino, decimal = false, dobleCero = false, alEnter = null, clase = '' }) {
  const objetivo = () => (typeof destino === 'function' ? destino() : destino);
  const izquierda = decimal ? '.' : dobleCero ? '00' : 'C';
  const teclas = ['7', '8', '9', '4', '5', '6', '1', '2', '3', izquierda, '0', '⌫'];
  const contenedor = h('div', { class: `teclado ${clase}`.trim() });
  for (const tecla of teclas) {
    const boton = h('button', {
      type: 'button',
      class: `tecla${['⌫', 'C'].includes(tecla) ? ' tecla--accion' : ''}`,
      text: tecla,
      'aria-label': tecla === '⌫' ? 'Borrar' : tecla === 'C' ? 'Limpiar' : tecla,
      dataset: { tecla },
    });
    contenedor.append(boton);
  }
  if (alEnter) {
    contenedor.append(h('button', { type: 'button', class: 'tecla tecla--enter', text: 'Enter', dataset: { tecla: 'enter' }, style: 'grid-column: 1 / -1' }));
  }
  // pointerdown evita que el botón se lleve el foco del campo
  contenedor.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tecla')) e.preventDefault();
  });
  contenedor.addEventListener('click', (e) => {
    const boton = e.target.closest('.tecla');
    if (!boton) return;
    const campo = objetivo();
    const tecla = boton.dataset.tecla;
    if (tecla === 'enter') {
      alEnter?.();
      return;
    }
    if (!campo || campo.disabled || campo.readOnly) return;
    const valor = campo.value;
    let nuevo = valor;
    if (tecla === '⌫') nuevo = valor.slice(0, -1);
    else if (tecla === 'C') nuevo = '';
    else if (tecla === '.' && valor.includes('.')) return;
    else nuevo = valor + tecla;
    if (campo.maxLength > 0 && nuevo.length > campo.maxLength) return;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.focus({ preventScroll: true });
  });
  return contenedor;
}

// ------------------------------------------------------------- diálogos

let contadorDialogos = 0;

/**
 * Diálogo modal genérico.
 * @param {object} opciones
 * @param {string} opciones.titulo
 * @param {Node|Node[]} [opciones.cuerpo]
 * @param {Array<{texto: string, valor: any, clase?: string, principal?: boolean, cerrar?: boolean}>} [opciones.botones]
 *   El botón `principal` se pulsa también con Enter. `cerrar: true` cierra sin llamar a alPulsar.
 * @param {(valor: any, ctx: {cerrar: (resultado: any) => void, error: (texto: string|null) => void}) => any} [opciones.alPulsar]
 *   Si existe, decide qué hacer con cada botón (puede ser async; lo que lance se muestra como error).
 *   Si no, el diálogo se cierra devolviendo el valor del botón.
 * @param {(ctx: object) => void} [opciones.alAbrir]
 * @param {boolean} [opciones.cerrable] si Esc y la X cierran (devuelve null)
 * @param {any} [opciones.esc] si se da, Esc y la X "pulsan" este valor en vez de cerrar
 * @param {string} [opciones.clase] 'dlg--ancho', 'dlg--pantalla'…
 * @returns {Promise<any>}
 */
export function abrirDialogo({ titulo, cuerpo = [], botones = [], alPulsar = null, alAbrir = null, cerrable = true, esc = undefined, clase = '' }) {
  return new Promise((resolver) => {
    contadorDialogos += 1;
    const idTitulo = `dlg-titulo-${contadorDialogos}`;
    const dlg = h('dialog', { class: `dlg ${clase}`.trim(), 'aria-labelledby': idTitulo });
    const mensaje = h('p', { class: 'mensaje-pos', role: 'alert', hidden: true });
    const pie = h('footer', { class: 'dlg__pie' });
    const forma = h('form', { class: 'dlg__forma', novalidate: true });
    const cabecera = h('header', { class: 'dlg__cabecera' }, h('h2', { id: idTitulo, text: titulo }));
    if (cerrable) {
      cabecera.append(h('button', { type: 'button', class: 'dlg__x', 'aria-label': 'Cerrar', onclick: () => cancelar() }, icono('cerrar')));
    }
    const contenidoCuerpo = h('div', { class: 'dlg__cuerpo' }, cuerpo, mensaje);
    forma.append(cabecera, contenidoCuerpo, pie);
    dlg.append(forma);

    let cerrado = false;
    let ocupado = false;
    const nodosBoton = [];

    function cancelar() {
      if (esc !== undefined) pulsar(esc);
      else if (!ocupado) cerrar(null);
    }

    function cerrar(resultado) {
      if (cerrado) return;
      cerrado = true;
      dlg.close();
      dlg.remove();
      resolver(resultado);
    }

    const ctx = {
      dialogo: dlg,
      cuerpo: contenidoCuerpo,
      cerrar,
      error(texto, tipo = 'error') {
        mensaje.hidden = !texto;
        mensaje.textContent = texto ?? '';
        if (tipo === 'error') delete mensaje.dataset.tipo;
        else mensaje.dataset.tipo = tipo;
      },
      boton: (valor) => nodosBoton.find((b) => b.valor === valor)?.nodo ?? null,
      pulsar: (valor) => pulsar(valor),
    };

    async function pulsar(valor) {
      if (ocupado || cerrado) return;
      const definicion = botones.find((b) => b.valor === valor);
      if (definicion?.cerrar || !alPulsar) {
        cerrar(valor);
        return;
      }
      ocupado = true;
      ctx.error(null);
      for (const { nodo } of nodosBoton) nodo.disabled = true;
      try {
        await alPulsar(valor, ctx);
      } catch (error) {
        ctx.error(error?.message || 'No se pudo completar la operación.');
      } finally {
        ocupado = false;
        if (!cerrado) for (const { nodo, def } of nodosBoton) nodo.disabled = !!def.desactivado;
      }
    }

    for (const def of botones) {
      const nodo = h('button', { type: 'button', class: `btn btn--grande ${def.clase ?? (def.principal ? 'btn--primario' : 'btn--secundario')}`, text: def.texto });
      nodo.disabled = !!def.desactivado;
      nodo.addEventListener('click', () => pulsar(def.valor));
      nodosBoton.push({ nodo, valor: def.valor, def });
      pie.append(nodo);
    }
    if (botones.length === 0) pie.hidden = true;

    forma.addEventListener('submit', (e) => {
      e.preventDefault();
      const principal = botones.find((b) => b.principal);
      if (principal) pulsar(principal.valor);
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (cerrable) cancelar();
    });

    document.body.append(dlg);
    dlg.showModal();
    alAbrir?.(ctx);
    if (!dlg.contains(document.activeElement) || document.activeElement === dlg) {
      const primero = dlg.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
      if (primero) primero.focus();
    }
  });
}

/** Sí / No. Devuelve true si se acepta. */
export async function confirmar({ titulo, texto, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro = false, nota = null }) {
  const cuerpo = [h('p', { class: 'dlg__texto', text: texto })];
  if (nota) cuerpo.push(h('p', { class: 'dlg__nota', text: nota }));
  const resultado = await abrirDialogo({
    titulo,
    cuerpo,
    botones: [
      { texto: cancelar, valor: false, cerrar: true },
      { texto: aceptar, valor: true, principal: true, clase: peligro ? 'btn--peligro' : 'btn--primario' },
    ],
  });
  return resultado === true;
}

/** Aviso que hay que cerrar a mano (errores graves, instrucciones). */
export function informar({ titulo, texto, nota = null, boton = 'Entendido' }) {
  const cuerpo = [h('p', { class: 'dlg__texto', text: texto })];
  if (nota) cuerpo.push(h('p', { class: 'dlg__nota', text: nota }));
  return abrirDialogo({ titulo, cuerpo, botones: [{ texto: boton, valor: true, principal: true }] });
}

/**
 * Pide un valor tecleado (monto, peso, cantidad, porcentaje…) con teclado en pantalla.
 * @param {object} o
 * @param {string} o.titulo
 * @param {string} o.etiqueta
 * @param {(texto: string) => any} o.interpretar convierte el texto; lanza Error con el mensaje si no es válido
 * @param {(valor: any) => string} [o.vista] texto de vista previa bajo el campo (con el valor interpretado)
 * @param {string} [o.inicial]
 * @param {string} [o.nota]
 * @param {boolean} [o.decimal] tecla "." en el teclado
 * @param {Array<{texto: string, valor: string}>} [o.rapidos] botones que rellenan el campo y aceptan
 * @param {string} [o.aceptar]
 * @param {string} [o.prefijo] p. ej. "$"
 * @param {number} [o.maximo] longitud máxima del texto
 */
export function pedirValor({ titulo, etiqueta, interpretar, vista = null, inicial = '', nota = null, decimal = true, rapidos = [], aceptar = 'Aceptar', maximo = 10, antes = null }) {
  const id = `campo-valor-${contadorDialogos + 1}`;
  const campo = h('input', { id, inputmode: 'none', autocomplete: 'off', maxlength: maximo, value: inicial });
  const previa = h('p', { class: 'dlg__nota', 'aria-live': 'polite' });
  const cuerpo = [];
  if (antes) cuerpo.push(antes);
  cuerpo.push(h('div', { class: 'campo-monto' }, h('label', { for: id, text: etiqueta }), campo));
  if (vista) cuerpo.push(previa);
  if (nota) cuerpo.push(h('p', { class: 'dlg__nota', text: nota }));
  let ctxDialogo = null;
  if (rapidos.length) {
    cuerpo.push(h('div', { class: 'rapidos' }, rapidos.map((r) => h('button', {
      type: 'button',
      class: 'btn',
      text: r.texto,
      onclick: () => {
        campo.value = r.valor;
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        ctxDialogo?.pulsar('aceptar');
      },
    }))));
  }
  cuerpo.push(tecladoNumerico({ destino: campo, decimal, dobleCero: !decimal }));

  const actualizarVista = () => {
    if (!vista) return;
    try {
      previa.textContent = campo.value.trim() === '' ? '' : vista(interpretar(campo.value));
    } catch {
      previa.textContent = '';
    }
  };
  campo.addEventListener('input', actualizarVista);
  actualizarVista();

  return abrirDialogo({
    titulo,
    cuerpo,
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: aceptar, valor: 'aceptar', principal: true },
    ],
    alAbrir: (ctx) => {
      ctxDialogo = ctx;
      campo.focus();
      campo.select();
    },
    alPulsar: (_valor, ctx) => {
      const valor = interpretar(campo.value);
      ctx.cerrar({ valor });
    },
  }).then((r) => (r && typeof r === 'object' ? r.valor : null));
}

/** Pide un texto corto (motivo, nota). */
export function pedirTexto({ titulo, etiqueta, inicial = '', nota = null, obligatorio = false, maximo = 120, aceptar = 'Aceptar' }) {
  const id = `campo-texto-${contadorDialogos + 1}`;
  const campo = h('input', { id, autocomplete: 'off', maxlength: maximo, value: inicial });
  const cuerpo = [h('label', { for: id, text: etiqueta }), campo];
  if (nota) cuerpo.push(h('p', { class: 'dlg__nota', text: nota }));
  return abrirDialogo({
    titulo,
    cuerpo,
    botones: [
      { texto: 'Cancelar', valor: null, cerrar: true },
      { texto: aceptar, valor: 'aceptar', principal: true },
    ],
    alPulsar: (_valor, ctx) => {
      const texto = campo.value.trim();
      if (obligatorio && texto === '') throw new Error(`Escribe ${etiqueta.toLowerCase()}.`);
      ctx.cerrar({ texto });
    },
  }).then((r) => (r && typeof r === 'object' ? r.texto : null));
}

/**
 * Elegir una opción entre botones grandes.
 * @param {{ titulo: string, texto?: string, opciones: Array<{texto: string, valor: any, detalle?: string}> }} o
 */
export function elegir({ titulo, texto = null, opciones }) {
  const lista = h('div', { class: 'opciones' }, opciones.map((op) => h('button', {
    type: 'button',
    class: 'opcion',
    dataset: { indice: String(opciones.indexOf(op)) },
  }, op.texto, op.detalle ? h('small', { text: op.detalle }) : null)));
  const cuerpo = [];
  if (texto) cuerpo.push(h('p', { class: 'dlg__texto', text: texto }));
  cuerpo.push(lista);
  return abrirDialogo({
    titulo,
    cuerpo,
    botones: [{ texto: 'Cancelar', valor: null, cerrar: true }],
    alAbrir: (ctx) => {
      lista.addEventListener('click', (e) => {
        const boton = e.target.closest('.opcion');
        if (boton) ctx.cerrar({ elegido: opciones[Number(boton.dataset.indice)].valor });
      });
      lista.querySelector('.opcion')?.focus();
    },
  }).then((r) => (r && typeof r === 'object' ? r.elegido : null));
}
