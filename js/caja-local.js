/**
 * Lo que la caja guarda en el propio equipo (localStorage), nunca en la nube:
 *  - a qué caja está asignada esta computadora;
 *  - el ticket en curso y los tickets en espera (sobreviven a un corte de luz
 *    o a recargar la página);
 *  - el consecutivo de tickets del día de esta caja (folio);
 *  - el verificador del NIP de la cajera para desbloquear sin conexión
 *    (hash PBKDF2, nunca el NIP; ver js/verificador.js);
 *  - la clave de caja (secretos/caja) que guarda el administrador al
 *    configurar el equipo: con ella basta el NIP para entrar (js/nip.js).
 * Todo va envuelto en try/catch: sin almacenamiento la caja sigue vendiendo.
 */
const PREFIJO = 'aguila.pos.';

export function leer(clave, defecto = null) {
  try {
    const texto = localStorage.getItem(PREFIJO + clave);
    return texto === null ? defecto : JSON.parse(texto);
  } catch {
    return defecto;
  }
}

export function guardar(clave, valor) {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export function borrar(clave) {
  try {
    localStorage.removeItem(PREFIJO + clave);
  } catch {
    // sin almacenamiento
  }
}

function clavesCon(prefijo) {
  const claves = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const clave = localStorage.key(i);
      if (clave?.startsWith(PREFIJO + prefijo)) claves.push(clave.slice(PREFIJO.length));
    }
  } catch {
    // sin almacenamiento
  }
  return claves;
}

// ------------------------------------------------------------- asignación del equipo

/** @returns {{id: string, nombre: string, numero: number, tienda: string, tiendaNombre: string}|null} */
export const leerAsignacion = () => leer('caja');
export const guardarAsignacion = (caja) => guardar('caja', caja);
export const borrarAsignacion = () => borrar('caja');
export const leerClaveCaja = () => leer('claveCaja');
export const guardarClaveCaja = (clave) => guardar('claveCaja', clave);

// ------------------------------------------------------------- folio del día

/** Consecutivo que tendrá el próximo ticket de esta caja hoy (sin consumirlo). */
export function proximoNumero(cajaId, dia) {
  return (Number(leer(`folio.${cajaId}.${dia}`, 0)) || 0) + 1;
}

/** Consume y devuelve el consecutivo del próximo ticket; borra los contadores de días anteriores. */
export function tomarNumero(cajaId, dia) {
  const numero = proximoNumero(cajaId, dia);
  guardar(`folio.${cajaId}.${dia}`, numero);
  for (const clave of clavesCon(`folio.${cajaId}.`)) {
    if (clave !== `folio.${cajaId}.${dia}`) borrar(clave);
  }
  return numero;
}

// ------------------------------------------------------------- ticket en curso y en espera

export const leerTicket = (cajaId) => leer(`ticket.${cajaId}`);
export const guardarTicket = (cajaId, ticket) => guardar(`ticket.${cajaId}`, ticket);
export const borrarTicket = (cajaId) => borrar(`ticket.${cajaId}`);

export const MAXIMO_EN_ESPERA = 6;
export const leerEspera = (cajaId) => leer(`espera.${cajaId}`, []) ?? [];
export const guardarEspera = (cajaId, lista) => guardar(`espera.${cajaId}`, lista);
export const borrarEspera = (cajaId) => borrar(`espera.${cajaId}`);

// ------------------------------------------------------------- verificador del NIP

export const leerVerificador = (cajaId) => leer(`verificador.${cajaId}`);
export const guardarVerificador = (cajaId, datos) => guardar(`verificador.${cajaId}`, datos);
export const borrarVerificador = (cajaId) => borrar(`verificador.${cajaId}`);
