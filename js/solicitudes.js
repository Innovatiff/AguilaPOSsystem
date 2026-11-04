/**
 * Solicitudes del Catálogo al administrador (solicitudes/{id}):
 *  - alta: un producto nuevo SIN precio. El admin pone el precio y la clase
 *    fiscal, y en el mismo lote crea el producto y aprueba la solicitud.
 *  - baja: quitar un producto activo del catálogo. El admin lo desactiva y
 *    aprueba en el mismo lote, o la rechaza.
 * Las reglas de Firestore hacen cumplir todo esto (sección "solicitudes").
 */
import {
  db, doc, collection, query, where, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp,
} from './firebase.js';
import { armarProducto } from './esquema.js';
import { ahora } from './productos.js';

export const CAMPOS_PROPUESTA = Object.freeze(['upc', 'plu', 'nombre', 'marca', 'descriptor', 'presentacion', 'unidadVenta', 'tiendas', 'proveedor']);

/** Propuesta de producto (sin precio ni clase fiscal) con la misma limpieza que un producto. */
export function armarPropuesta(datos) {
  const p = armarProducto({ ...datos, precioCentavos: 0, claseFiscal: 'gravado' }, 'propuesta');
  return Object.fromEntries(CAMPOS_PROPUESTA.map((campo) => [campo, p[campo]]));
}

/** "MASECA HARINA DE MAIZ 1.8kg" */
export function nombreDeProducto(p) {
  return [p?.marca, p?.nombre, p?.presentacion].filter(Boolean).join(' ').slice(0, 120) || 'Producto';
}

const coleccion = () => collection(db, 'solicitudes');
const conId = (d) => ({ id: d.id, ...d.data() });
const porFecha = (a, b) => (b.creadaEn?.toMillis?.() ?? Date.now()) - (a.creadaEn?.toMillis?.() ?? Date.now());

function base(personal, extra) {
  return {
    estado: 'pendiente',
    motivo: '',
    creadaPor: personal.usuario,
    creadaPorNombre: String(personal.nombre || personal.usuario).slice(0, 80),
    creadaEn: serverTimestamp(),
    resueltaPor: null,
    resueltaEn: null,
    nota: null,
    ...extra,
  };
}

/** Pide el alta de un producto nuevo, sin precio. */
export function pedirAlta(datos, personal, motivo = '') {
  const referencia = doc(coleccion());
  const producto = armarPropuesta(datos);
  const solicitud = base(personal, {
    tipo: 'alta', producto, productoId: null, productoNombre: nombreDeProducto(producto), motivo: String(motivo).trim().slice(0, 300),
  });
  return { id: referencia.id, solicitud, promesa: setDoc(referencia, solicitud) };
}

/** Pide que se quite un producto activo del catálogo. */
export function pedirBaja(producto, motivo, personal) {
  const referencia = doc(coleccion());
  const solicitud = base(personal, {
    tipo: 'baja', producto: null, productoId: producto.id, productoNombre: nombreDeProducto(producto), motivo: String(motivo ?? '').trim().slice(0, 300),
  });
  return { id: referencia.id, solicitud, promesa: setDoc(referencia, solicitud) };
}

/** Todas las solicitudes (back office). Son pocas: unas cuantas por semana. */
export function observarTodas(alCambiar, alFallar) {
  return onSnapshot(coleccion(), (r) => alCambiar(r.docs.map(conId)), alFallar);
}

/** Solicitudes en un estado ('pendiente', 'aprobada', 'rechazada'), las más nuevas primero. */
export function observarSolicitudes(estado, alCambiar, alFallar) {
  return onSnapshot(query(coleccion(), where('estado', '==', estado)), (r) => alCambiar(r.docs.map(conId).sort(porFecha)), alFallar);
}

/** Las solicitudes que hizo una persona, las más nuevas primero. */
export function observarMisSolicitudes(usuario, alCambiar, alFallar) {
  return onSnapshot(query(coleccion(), where('creadaPor', '==', usuario)), (r) => alCambiar(r.docs.map(conId).sort(porFecha)), alFallar);
}

const resolucion = (personal, estado, extra = {}) => ({
  estado, resueltaPor: personal.usuario, resueltaEn: serverTimestamp(), nota: null, ...extra,
});

/**
 * Aprueba un alta: crea el producto con lo propuesto más el precio y la clase
 * fiscal que pone el admin (`datos` puede corregir cualquier campo) y marca la
 * solicitud aprobada, en un lote.
 * @returns {{ productoId: string, producto: object, promesa: Promise<void> }}
 */
export function aprobarAlta(solicitud, datos, personal) {
  const marca = ahora();
  const referencia = doc(collection(db, 'products'));
  const producto = { ...armarProducto({ ...solicitud.producto, ...datos }, personal.usuario), creadoEn: marca, actualizadoEn: marca };
  const lote = writeBatch(db);
  lote.set(referencia, producto);
  lote.update(doc(coleccion(), solicitud.id), resolucion(personal, 'aprobada', { productoId: referencia.id }));
  return { productoId: referencia.id, producto, promesa: lote.commit() };
}

/** Aprueba una baja: desactiva el producto y marca la solicitud aprobada, en un lote. */
export function aprobarBaja(solicitud, personal) {
  const lote = writeBatch(db);
  lote.update(doc(db, 'products', solicitud.productoId), { activo: false, actualizadoEn: ahora(), actualizadoPor: personal.usuario });
  lote.update(doc(coleccion(), solicitud.id), resolucion(personal, 'aprobada'));
  return lote.commit();
}

export function rechazar(solicitud, nota, personal) {
  const texto = String(nota ?? '').trim().slice(0, 300);
  return updateDoc(doc(coleccion(), solicitud.id), resolucion(personal, 'rechazada', { nota: texto === '' ? null : texto }));
}
