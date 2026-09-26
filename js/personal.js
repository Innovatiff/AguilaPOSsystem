/**
 * Nombres del personal para mostrar quién hizo cada cambio: actualizadoPor y
 * el historial guardan el usuario (código o correo); aquí se le pone nombre.
 * Una lectura por página; el personal activo puede leer staff (reglas).
 */
import { db, collection, getDocs } from './firebase.js';
import { etiquetaUsuario } from './identidad.js';

let nombres = null; // Map usuario → nombre
let carga = null;

async function cargar() {
  const resultado = await getDocs(collection(db, 'staff'));
  const mapa = new Map();
  resultado.forEach((documento) => mapa.set(documento.id, documento.data().nombre ?? ''));
  nombres = mapa;
  return mapa;
}

/** Carga (una vez) el directorio usuario → nombre. Nunca lanza: sin acceso devuelve un mapa vacío. */
export function cargarNombres() {
  if (nombres) return Promise.resolve(nombres);
  if (!carga) carga = cargar().catch(() => new Map());
  return carga;
}

/** "María (100123)" si el nombre ya se conoce; si no, el usuario tal cual. */
export function nombreDeUsuario(usuario) {
  const id = String(usuario ?? '');
  return etiquetaUsuario(id, nombres?.get(id));
}
