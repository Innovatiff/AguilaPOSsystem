/**
 * Verificador local del NIP, para desbloquear la caja sin conexión.
 *
 * Al abrir el turno (con conexión, contra Firebase) se guarda en el equipo un
 * hash PBKDF2-SHA-256 del NIP con sal aleatoria; nunca el NIP. Con conexión,
 * el desbloqueo se comprueba siempre contra Firebase; el verificador solo se
 * usa si no hay red, y se borra al cerrar el turno.
 */
export const ITERACIONES_VERIFICADOR = 210000;

const aBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

async function derivar(nip, sal, iteraciones) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(nip)), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256);
}

/** @returns {Promise<{sal: string, hash: string, iteraciones: number}>} */
export async function crearVerificador(nip, iteraciones = ITERACIONES_VERIFICADOR) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(nip, sal, iteraciones);
  return { sal: aBase64(sal), hash: aBase64(hash), iteraciones };
}

/** Compara en tiempo constante. Un verificador ausente o dañado nunca coincide. */
export async function comprobarVerificador(nip, verificador) {
  try {
    if (!verificador?.sal || !verificador?.hash || !Number.isInteger(verificador.iteraciones)) return false;
    const esperado = deBase64(verificador.hash);
    const obtenido = new Uint8Array(await derivar(nip, deBase64(verificador.sal), verificador.iteraciones));
    if (esperado.length !== obtenido.length) return false;
    let diferencia = 0;
    for (let i = 0; i < esperado.length; i += 1) diferencia |= esperado[i] ^ obtenido[i];
    return diferencia === 0;
  } catch {
    return false;
  }
}
