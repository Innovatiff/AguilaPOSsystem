/**
 * Reglas de la app Catálogo y del acceso con correo + NIP:
 *  - staff.correo y staff.catalogo,
 *  - correos/{correo} y nips/{huella} (entrar con correo + NIP o solo NIP),
 *  - secretos/caja (la clave de las huellas, solo administradores),
 *  - el personal con permiso de catálogo edita productos SIN tocar el precio,
 *    la unidad, la clase fiscal ni activo, y pide altas y bajas (solicitudes).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, writeBatch, Timestamp, serverTimestamp, setLogLevel,
} from 'firebase/firestore';
import { armarProducto } from '../../js/esquema.js';
import { armarFichaPersonal, correoDeAcceso, usuarioDe } from '../../js/identidad.js';

const ADMIN = 'admin@aguila.test';
const JEFA = correoDeAcceso('100150'); // admin por código
const MARIA = correoDeAcceso('100123'); // con permiso de catálogo
const LUIS = correoDeAcceso('100124'); // sin permiso de catálogo
const HUELLA = 'a'.repeat(64);
const OTRA_HUELLA = 'b'.repeat(64);

let entorno;
setLogLevel('silent');
const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();
const AHORA = Timestamp.fromMillis(1_700_000_000_000);
const ficha = (datos, extra = {}) => ({ ...armarFichaPersonal(datos, usuarioDe(ADMIN)), creadoEn: AHORA, actualizadoEn: AHORA, ...extra });
const producto = (extra = {}) => ({
  ...armarProducto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: ['talbot'] }, usuarioDe(ADMIN)),
  creadoEn: AHORA, actualizadoEn: AHORA, ...extra,
});
const firma = (quien) => ({ actualizadoEn: Timestamp.fromMillis(Date.now()), actualizadoPor: usuarioDe(quien) });
const propuesta = (extra = {}) => ({
  upc: '074734040014', plu: null, nombre: 'HARINA DE MAIZ', marca: 'MASECA', descriptor: null, presentacion: '1.8kg',
  unidadVenta: 'pieza', tiendas: ['talbot'], proveedor: null, ...extra,
});
const solicitudAlta = (quien, extra = {}) => ({
  tipo: 'alta', estado: 'pendiente', producto: propuesta(), productoId: null, productoNombre: 'MASECA HARINA DE MAIZ', motivo: '',
  creadaPor: usuarioDe(quien), creadaPorNombre: 'María', creadaEn: serverTimestamp(), resueltaPor: null, resueltaEn: null, nota: null, ...extra,
});
const solicitudBaja = (quien, extra = {}) => ({
  tipo: 'baja', estado: 'pendiente', producto: null, productoId: 'p1', productoNombre: 'TAJIN CLASICO', motivo: 'Ya no se vende',
  creadaPor: usuarioDe(quien), creadaPorNombre: 'María', creadaEn: serverTimestamp(), resueltaPor: null, resueltaEn: null, nota: null, ...extra,
});
const resolucion = (quien, estado, extra = {}) => ({ estado, resueltaPor: usuarioDe(quien), resueltaEn: serverTimestamp(), nota: null, ...extra });

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}

describe('reglas · app Catálogo y acceso con correo + NIP', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({ projectId: 'demo-aguilapos', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  after(async () => entorno.cleanup());
  beforeEach(async () => {
    await entorno.clearFirestore();
    await sembrar({
      [`staff/${ADMIN}`]: ficha({ usuario: ADMIN, nombre: 'Admin', rol: 'admin' }),
      'staff/100150': ficha({ usuario: '100150', nombre: 'Jefa', rol: 'admin', correo: 'jefa@aguila.test' }),
      'staff/100123': ficha({ usuario: '100123', nombre: 'María', rol: 'empleado', correo: 'maria@aguila.test', catalogo: true }),
      'staff/100124': ficha({ usuario: '100124', nombre: 'Luis', rol: 'empleado', correo: 'luis@aguila.test' }),
      'products/p1': producto(),
      'products/p2': producto({ upc: '049000006346', nombre: 'COCA COLA', activo: false }),
    });
  });

  describe('staff · correo y permiso de catálogo', () => {
    it('el admin guarda correo y permiso; acepta fichas sin ellos (anteriores)', async () => {
      const db = contexto(ADMIN);
      await assertSucceeds(setDoc(doc(db, 'staff/100124'), ficha({ usuario: '100124', nombre: 'Luis', rol: 'empleado', correo: 'luis@aguila.test', catalogo: true }, firma(ADMIN))));
      const marca = Timestamp.fromMillis(Date.now());
      const { correo, catalogo, ...sinNuevos } = ficha({ usuario: '100125', nombre: 'Ana', rol: 'empleado' }, { creadoEn: marca, actualizadoEn: marca });
      assert.equal(correo, null);
      assert.equal(catalogo, false);
      await assertSucceeds(setDoc(doc(db, 'staff/100125'), sinNuevos));
    });
    it('rechaza un correo inválido, en mayúsculas o sintético, y un permiso que no es booleano', async () => {
      const db = contexto(ADMIN);
      const base = ficha({ usuario: '100124', nombre: 'Luis', rol: 'empleado' }, firma(ADMIN));
      await assertFails(setDoc(doc(db, 'staff/100124'), { ...base, correo: 'no-es-correo' }));
      await assertFails(setDoc(doc(db, 'staff/100124'), { ...base, correo: 'Luis@Aguila.test' }));
      await assertFails(setDoc(doc(db, 'staff/100124'), { ...base, correo: correoDeAcceso('100124') }));
      await assertFails(setDoc(doc(db, 'staff/100124'), { ...base, catalogo: 'si' }));
    });
    it('una cuenta por correo lleva su propio correo; una empleada no se da permiso a sí misma', async () => {
      await assertFails(setDoc(doc(contexto(ADMIN), `staff/${ADMIN}`), ficha({ usuario: ADMIN, nombre: 'Admin', rol: 'admin' }, { ...firma(ADMIN), correo: 'otro@aguila.test' })));
      await assertFails(updateDoc(doc(contexto(LUIS), 'staff/100124'), { catalogo: true }));
    });
  });

  describe('correos/{correo}: entrar con correo + NIP', () => {
    it('cualquiera lee uno concreto; nadie salvo el admin los lista', async () => {
      await sembrar({ 'correos/maria@aguila.test': { codigo: '100123' } });
      await assertSucceeds(getDoc(doc(anonimo(), 'correos/maria@aguila.test')));
      await assertFails(getDocs(collection(anonimo(), 'correos')));
      await assertFails(getDocs(collection(contexto(MARIA), 'correos')));
      await assertSucceeds(getDocs(collection(contexto(ADMIN), 'correos')));
    });
    it('el admin lo crea con la ficha que lleva ese correo; no si no coincide, ni una empleada', async () => {
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'correos/maria@aguila.test'), { codigo: '100123' }));
      await assertFails(setDoc(doc(contexto(ADMIN), 'correos/otra@aguila.test'), { codigo: '100123' }));
      await assertFails(setDoc(doc(contexto(MARIA), 'correos/luis@aguila.test'), { codigo: '100124' }));
    });
    it('no se reescribe para apuntar a otra persona; el admin lo borra', async () => {
      await sembrar({ 'correos/maria@aguila.test': { codigo: '100123' } });
      await assertFails(setDoc(doc(contexto(ADMIN), 'correos/maria@aguila.test'), { codigo: '100124' }));
      await assertFails(deleteDoc(doc(contexto(MARIA), 'correos/maria@aguila.test')));
      await assertSucceeds(deleteDoc(doc(contexto(ADMIN), 'correos/maria@aguila.test')));
    });
  });

  describe('nips/{huella}: entrar solo con el NIP en la caja', () => {
    it('leer una huella es público; listar, solo el admin', async () => {
      await sembrar({ [`nips/${HUELLA}`]: { codigo: '100123', version: 1 } });
      await assertSucceeds(getDoc(doc(anonimo(), `nips/${HUELLA}`)));
      await assertFails(getDocs(collection(contexto(MARIA), 'nips')));
      await assertSucceeds(getDocs(collection(contexto(ADMIN), 'nips')));
    });
    it('el admin registra un NIP con la versión de cuenta de la ficha; un NIP repetido no entra', async () => {
      await assertSucceeds(setDoc(doc(contexto(ADMIN), `nips/${HUELLA}`), { codigo: '100123', version: 1 }));
      await assertFails(setDoc(doc(contexto(ADMIN), `nips/${HUELLA}`), { codigo: '100124', version: 1 }), 'la huella ya es de otra persona');
      await assertFails(setDoc(doc(contexto(ADMIN), `nips/${OTRA_HUELLA}`), { codigo: '100124', version: 2 }), 'versión distinta a la de la ficha');
      await assertFails(setDoc(doc(contexto(ADMIN), 'nips/no-es-huella'), { codigo: '100124', version: 1 }));
      await assertFails(setDoc(doc(contexto(ADMIN), `nips/${OTRA_HUELLA}`), { codigo: ADMIN, version: 1 }), 'solo fichas por código');
    });
    it('una empleada no registra ni borra NIP; el admin sí borra', async () => {
      await assertFails(setDoc(doc(contexto(MARIA), `nips/${HUELLA}`), { codigo: '100123', version: 1 }));
      await sembrar({ [`nips/${HUELLA}`]: { codigo: '100123', version: 1 } });
      await assertFails(deleteDoc(doc(contexto(MARIA), `nips/${HUELLA}`)));
      await assertSucceeds(deleteDoc(doc(contexto(JEFA), `nips/${HUELLA}`)));
    });
    it('un restablecimiento de NIP va en un lote: ficha nueva, acceso, huella vieja fuera y nueva dentro', async () => {
      await sembrar({ [`nips/${HUELLA}`]: { codigo: '100123', version: 1 }, 'accesos/100123': { version: 1 } });
      const db = contexto(ADMIN);
      const lote = writeBatch(db);
      lote.set(doc(db, 'staff/100123'), ficha({ usuario: '100123', nombre: 'María', rol: 'empleado', correo: 'maria@aguila.test', catalogo: true, cuentaVersion: 2 }, firma(ADMIN)));
      lote.set(doc(db, 'accesos/100123'), { version: 2 });
      lote.delete(doc(db, `nips/${HUELLA}`));
      lote.set(doc(db, `nips/${OTRA_HUELLA}`), { codigo: '100123', version: 2 });
      await assertSucceeds(lote.commit());
    });
  });

  describe('secretos/caja: la clave de las huellas', () => {
    it('solo un admin la lee y la crea una vez; nadie la cambia', async () => {
      await assertFails(getDoc(doc(anonimo(), 'secretos/caja')));
      await assertFails(getDoc(doc(contexto(MARIA), 'secretos/caja')));
      const clave = 'x'.repeat(44);
      await assertFails(setDoc(doc(contexto(MARIA), 'secretos/caja'), { clave, creadaEn: serverTimestamp(), creadaPor: '100123' }));
      await assertFails(setDoc(doc(contexto(ADMIN), 'secretos/otra'), { clave, creadaEn: serverTimestamp(), creadaPor: ADMIN }));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'secretos/caja'), { clave, creadaEn: serverTimestamp(), creadaPor: ADMIN }));
      await assertSucceeds(getDoc(doc(contexto(JEFA), 'secretos/caja')));
      await assertFails(setDoc(doc(contexto(ADMIN), 'secretos/caja'), { clave: 'y'.repeat(44), creadaEn: serverTimestamp(), creadaPor: ADMIN }));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'secretos/caja')));
    });
  });

  describe('products · personal con permiso de catálogo', () => {
    it('edita nombre, marca, códigos, presentación, tiendas y proveedor', async () => {
      await assertSucceeds(updateDoc(doc(contexto(MARIA), 'products/p1'), {
        nombre: 'CLASICO CON LIMON', marca: 'TAJIN', plu: '4011', presentacion: '150g', tiendas: ['talbot', 'erie'], proveedor: 'Distribuidora', tokensBusqueda: ['cla'], ...firma(MARIA),
      }));
    });
    it('NUNCA cambia el precio, el precio por kilo, la unidad ni la clase fiscal', async () => {
      const db = contexto(MARIA);
      await assertFails(updateDoc(doc(db, 'products/p1'), { precioCentavos: 1, ...firma(MARIA) }));
      await assertFails(updateDoc(doc(db, 'products/p1'), { unidadVenta: 'peso', precioPorKgCentavos: 549, ...firma(MARIA) }));
      await assertFails(updateDoc(doc(db, 'products/p1'), { claseFiscal: 'tasaCero', ...firma(MARIA) }));
      const marca = Timestamp.fromMillis(Date.now());
      const lote = writeBatch(db);
      lote.update(doc(db, 'products/p1'), { precioCentavos: 549, actualizadoEn: marca, actualizadoPor: '100123' });
      lote.set(doc(db, `priceHistory/p1_${marca.toMillis()}`), { productId: 'p1', precioAnteriorCentavos: 499, precioNuevoCentavos: 549, fecha: marca, usuario: '100123' });
      await assertFails(lote.commit(), 'ni con su entrada de historial');
    });
    it('NUNCA lo quita (activo) ni lo borra, ni toca uno inactivo, ni crea productos', async () => {
      const db = contexto(MARIA);
      await assertFails(updateDoc(doc(db, 'products/p1'), { activo: false, ...firma(MARIA) }));
      await assertFails(deleteDoc(doc(db, 'products/p1')));
      await assertFails(updateDoc(doc(db, 'products/p2'), { activo: true, ...firma(MARIA) }));
      await assertFails(updateDoc(doc(db, 'products/p2'), { nombre: 'OTRO', ...firma(MARIA) }));
      await assertFails(setDoc(doc(db, 'products/p3'), producto({ actualizadoPor: '100123' })));
    });
    it('al imprimir etiquetas anota el precio vigente, no otro', async () => {
      const db = contexto(MARIA);
      await assertSucceeds(updateDoc(doc(db, 'products/p1'), { ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '2026-11-04', ...firma(MARIA) }));
      await assertFails(updateDoc(doc(db, 'products/p1'), { ultimoPrecioImpresoCentavos: 100, fechaUltimaImpresion: '2026-11-04', ...firma(MARIA) }));
    });
    it('sin permiso de catálogo no edita nada; firmar como otro tampoco vale', async () => {
      await assertFails(updateDoc(doc(contexto(LUIS), 'products/p1'), { nombre: 'OTRO', ...firma(LUIS) }));
      await assertFails(updateDoc(doc(contexto(MARIA), 'products/p1'), { nombre: 'OTRO', actualizadoEn: Timestamp.now(), actualizadoPor: '100124' }));
    });
    it('el admin sigue cambiando precio (con historial) y activo', async () => {
      await assertSucceeds(updateDoc(doc(contexto(ADMIN), 'products/p1'), { activo: false, ...firma(ADMIN) }));
    });
  });

  describe('solicitudes · altas sin precio y bajas', () => {
    it('quien tiene permiso pide un alta sin precio; con precio, sin permiso o a nombre de otro, no', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'solicitudes/s1'), solicitudAlta(MARIA)));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudAlta(MARIA, { producto: { ...propuesta(), precioCentavos: 549 } })));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudAlta(MARIA, { producto: propuesta({ upc: '123' }) })));
      await assertFails(setDoc(doc(contexto(LUIS), 'solicitudes/s2'), solicitudAlta(LUIS)));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudAlta(LUIS)));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudAlta(MARIA, { estado: 'aprobada' })));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudAlta(MARIA, { creadaEn: AHORA })));
    });
    it('pide la baja de un producto activo; de uno inactivo, no', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'solicitudes/s1'), solicitudBaja(MARIA)));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s2'), solicitudBaja(MARIA, { productoId: 'p2' })));
      await assertFails(setDoc(doc(contexto(MARIA), 'solicitudes/s3'), solicitudBaja(MARIA, { producto: propuesta() })));
    });
    it('las leen el admin y el personal del Catálogo; el resto no', async () => {
      await sembrar({ 'solicitudes/s1': { ...solicitudAlta(MARIA), creadaEn: AHORA } });
      await assertSucceeds(getDocs(collection(contexto(MARIA), 'solicitudes')));
      await assertSucceeds(getDocs(collection(contexto(ADMIN), 'solicitudes')));
      await assertFails(getDocs(collection(contexto(LUIS), 'solicitudes')));
      await assertFails(getDoc(doc(anonimo(), 'solicitudes/s1')));
    });
    it('el admin aprueba un alta creando el producto con su precio en el mismo lote', async () => {
      await sembrar({ 'solicitudes/s1': { ...solicitudAlta(MARIA), creadaEn: AHORA } });
      const db = contexto(JEFA);
      const marca = Timestamp.fromMillis(Date.now());
      const lote = writeBatch(db);
      lote.set(doc(db, 'products/nuevo'), {
        ...armarProducto({ ...propuesta(), precioCentavos: 549, claseFiscal: 'tasaCero' }, '100150'), creadoEn: marca, actualizadoEn: marca,
      });
      lote.update(doc(db, 'solicitudes/s1'), resolucion(JEFA, 'aprobada', { productoId: 'nuevo' }));
      await assertSucceeds(lote.commit());
      await assertFails(updateDoc(doc(db, 'solicitudes/s1'), resolucion(JEFA, 'rechazada')), 'una solicitud se resuelve una sola vez');
    });
    it('aprobar un alta sin crear el producto no vale; una empleada no aprueba', async () => {
      await sembrar({ 'solicitudes/s1': { ...solicitudAlta(MARIA), creadaEn: AHORA } });
      await assertFails(updateDoc(doc(contexto(ADMIN), 'solicitudes/s1'), resolucion(ADMIN, 'aprobada', { productoId: 'no-existe' })));
      await assertFails(updateDoc(doc(contexto(MARIA), 'solicitudes/s1'), resolucion(MARIA, 'rechazada')));
    });
    it('el admin aprueba una baja desactivando el producto en el mismo lote, o la rechaza', async () => {
      await sembrar({ 'solicitudes/s1': { ...solicitudBaja(MARIA), creadaEn: AHORA }, 'solicitudes/s2': { ...solicitudBaja(MARIA), creadaEn: AHORA } });
      const db = contexto(ADMIN);
      await assertFails(updateDoc(doc(db, 'solicitudes/s1'), resolucion(ADMIN, 'aprobada')), 'sin desactivar el producto');
      const lote = writeBatch(db);
      lote.update(doc(db, 'products/p1'), { activo: false, ...firma(ADMIN) });
      lote.update(doc(db, 'solicitudes/s1'), resolucion(ADMIN, 'aprobada'));
      await assertSucceeds(lote.commit());
      await assertSucceeds(updateDoc(doc(db, 'solicitudes/s2'), resolucion(ADMIN, 'rechazada', { nota: 'Se sigue vendiendo' })));
    });
    it('nadie borra solicitudes', async () => {
      await sembrar({ 'solicitudes/s1': { ...solicitudAlta(MARIA), creadaEn: AHORA } });
      await assertFails(deleteDoc(doc(contexto(MARIA), 'solicitudes/s1')));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'solicitudes/s1')));
    });
  });
});
