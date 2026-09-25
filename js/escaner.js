/**
 * Escáner de códigos de barras con la cámara (teléfonos y tabletas).
 *
 * Estrategia: el BarcodeDetector nativo si el navegador lo trae con soporte
 * real (Chrome en Android); si no, el decodificador ZXing vendido en
 * vendor/zxing/, que se carga solo cuando se abre el escáner. Entrega el
 * texto del código tal cual (UPC-A, EAN-13, UPC-E o EAN-8); quien llama lo
 * normaliza con js/upca.js.
 *
 * El escáner USB de las estaciones no pasa por aquí: escribe como teclado.
 */
export const FORMATOS = ['upc_a', 'ean_13', 'upc_e', 'ean_8'];
const RUTA_ZXING = '../vendor/zxing/0.2.1/zxing-browser.js';
const REPETICION_MS = 2500; // el mismo código no se vuelve a entregar antes de esto

/** ¿Hay API de cámara en un contexto seguro (https o localhost)? */
export function camaraDisponible() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext === true;
}

/** Mensaje en español para un fallo al abrir la cámara. */
export function mensajeCamara(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permite el acceso a la cámara en el navegador para escanear.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encontró una cámara en este dispositivo.';
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está ocupada por otra aplicación.';
    default:
      return `No se pudo abrir la cámara${error?.message ? ` (${error.message})` : ''}.`;
  }
}

async function detectorNativo() {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return null;
  try {
    const soportados = await window.BarcodeDetector.getSupportedFormats();
    const formatos = FORMATOS.filter((f) => soportados.includes(f));
    if (!formatos.includes('upc_a') && !formatos.includes('ean_13')) return null;
    return new window.BarcodeDetector({ formats: formatos });
  } catch {
    return null;
  }
}

const RESTRICCIONES = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

/**
 * Abre la cámara trasera en `video` y llama a alDetectar({ texto, formato })
 * con cada lectura. Resuelve con los controles del escáner.
 * @param {HTMLVideoElement} video
 * @param {{ alDetectar: (lectura: {texto: string, formato: string}) => void, alError?: (error: Error) => void }} opciones
 * @returns {Promise<{ motor: 'nativo'|'zxing', tieneLinterna: boolean, linterna: (on: boolean) => Promise<boolean>, pausar: () => void, reanudar: () => void, detener: () => void }>}
 */
export async function abrirEscaner(video, { alDetectar, alError = () => {} }) {
  let pausado = false;
  let detenido = false;
  let ultimo = { texto: null, cuando: 0 };
  const entregar = (texto, formato) => {
    if (pausado || detenido || !texto) return;
    const ahora = Date.now();
    if (texto === ultimo.texto && ahora - ultimo.cuando < REPETICION_MS) return;
    ultimo = { texto, cuando: ahora };
    alDetectar({ texto: String(texto), formato: String(formato ?? '').toLowerCase() });
  };

  video.setAttribute('playsinline', '');
  video.muted = true;

  let motor = 'nativo';
  let stream = null;
  let controlesZXing = null;
  let temporizador = null;

  const nativo = await detectorNativo();
  if (nativo) {
    stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES);
    video.srcObject = stream;
    await video.play();
    const ciclo = async () => {
      if (detenido) return;
      if (!pausado && video.readyState >= 2) {
        try {
          const codigos = await nativo.detect(video);
          if (codigos.length > 0) entregar(codigos[0].rawValue, codigos[0].format);
        } catch {
          // cuadro no legible: se intenta con el siguiente
        }
      }
      temporizador = setTimeout(ciclo, 120);
    };
    ciclo();
  } else {
    motor = 'zxing';
    const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import(RUTA_ZXING);
    const pistas = new Map();
    pistas.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.UPC_A, BarcodeFormat.EAN_13, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]);
    pistas.set(DecodeHintType.TRY_HARDER, true);
    const lector = new BrowserMultiFormatReader(pistas, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 250 });
    controlesZXing = await lector.decodeFromConstraints(RESTRICCIONES, video, (resultado, error) => {
      if (resultado) {
        entregar(resultado.getText(), BarcodeFormat[resultado.getBarcodeFormat()]);
      } else if (error && !/NotFound|Checksum|Format/i.test(error.name ?? String(error))) {
        alError(error);
      }
    });
    stream = video.srcObject;
  }

  const pista = stream?.getVideoTracks?.()[0] ?? null;
  let tieneLinterna = false;
  try {
    tieneLinterna = !!pista?.getCapabilities?.().torch;
  } catch {
    tieneLinterna = false;
  }

  return {
    motor,
    tieneLinterna,
    async linterna(encendida) {
      if (!tieneLinterna || !pista) return false;
      try {
        await pista.applyConstraints({ advanced: [{ torch: !!encendida }] });
        return true;
      } catch {
        return false;
      }
    },
    pausar() {
      pausado = true;
    },
    reanudar() {
      pausado = false;
      ultimo = { texto: null, cuando: 0 };
    },
    detener() {
      detenido = true;
      clearTimeout(temporizador);
      try {
        controlesZXing?.stop();
      } catch {
        // ya detenido
      }
      for (const t of stream?.getTracks?.() ?? []) t.stop();
      video.srcObject = null;
    },
  };
}

let contextoAudio = null;

/** Pitido corto y vibración al leer un código (tras un gesto del usuario). */
export function confirmarLectura() {
  try {
    navigator.vibrate?.(60);
  } catch {
    // sin vibración
  }
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    contextoAudio ??= new Contexto();
    const oscilador = contextoAudio.createOscillator();
    const ganancia = contextoAudio.createGain();
    oscilador.type = 'square';
    oscilador.frequency.value = 1500;
    ganancia.gain.value = 0.05;
    oscilador.connect(ganancia).connect(contextoAudio.destination);
    oscilador.start();
    oscilador.stop(contextoAudio.currentTime + 0.08);
  } catch {
    // sin audio
  }
}
