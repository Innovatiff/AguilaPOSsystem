/**
 * NIP de caja: en la caja registradora la persona entra SOLO con su NIP de
 * colaborador (6 dígitos, único en la empresa). La caja averigua de quién es
 * con el índice nips/{huella} = { codigo, version }, sin que el NIP quede
 * guardado en ningún lado:
 *
 *   huella = HMAC-SHA-256(clave de caja, "nip:" + NIP), en hexadecimal.
 *
 * La clave de caja (secretos/caja) solo la leen los administradores y queda
 * en cada computadora de caja que un administrador configura. Sin la clave no
 * se puede calcular ninguna huella, así que el índice (lectura pública de un
 * documento, sin listar) no sirve para adivinar NIP desde fuera de una caja.
 *
 * Módulo puro (WebCrypto, sin Firebase ni DOM): funciona en el navegador y en Node.
 */
import { t } from './idioma.js';

export const BYTES_CLAVE = 32;
const REGEX_HUELLA = /^[0-9a-f]{64}$/;

const aBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const deBase64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));
const aHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Clave de caja nueva: 32 bytes aleatorios en base64. */
export function generarClaveCaja() {
  return aBase64(crypto.getRandomValues(new Uint8Array(BYTES_CLAVE)));
}

/** ¿Es una clave de caja bien formada (base64 de 32 bytes)? */
export function claveCajaValida(clave) {
  try {
    return typeof clave === 'string' && deBase64(clave).length === BYTES_CLAVE;
  } catch {
    return false;
  }
}

async function hmacHex(clave, texto) {
  if (!claveCajaValida(clave)) throw new Error(t('Clave de caja inválida.'));
  const llave = await crypto.subtle.importKey('raw', deBase64(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return aHex(await crypto.subtle.sign('HMAC', llave, new TextEncoder().encode(texto)));
}

/** Huella del NIP con la clave de caja: 64 caracteres hexadecimales. */
export function huellaNip(clave, nip) {
  return hmacHex(clave, `nip:${String(nip).trim()}`);
}

/**
 * Id del documento de la pantalla del cliente de una caja en tableta
 * (pantallas/{id}): HMAC(clave de caja, "pantalla:" + id de la caja). Solo lo
 * calculan las cajas configuradas y los administradores; la tableta guarda el
 * id (nunca la clave) cuando un administrador la empareja.
 */
export function huellaPantalla(clave, cajaId) {
  return hmacHex(clave, `pantalla:${String(cajaId)}`);
}

export function esHuella(texto) {
  return REGEX_HUELLA.test(String(texto ?? ''));
}
