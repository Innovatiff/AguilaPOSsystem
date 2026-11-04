/**
 * Reglas de los movimientos en vivo (eventos/) y del inventario (recepciones/).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, Timestamp, serverTimestamp, setLogLevel,
} from 'firebase/firestore';
import { armarFichaPersonal, correoDeAcceso, usuarioDe } from '../../js/identidad.js';

const ADMIN = 'admin@aguila.test';
const MARIA = correoDeAcceso('100123'); // cajera, con permiso de catálogo
const LUIS = correoDeAcceso('100124'); // cajero, sin permiso de catálogo

let entorno;
setLogLevel('silent');
const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();
const AHORA = Timestamp.fromMillis(1_700_000_000_000);
const ficha = (datos) => ({ ...armarFichaPersonal(datos, usuarioDe(ADMIN)), creadoEn: AHORA, actualizadoEn: AHORA });

const evento = (quien, extra = {}) => ({
  tipo: 'articulo', turno: 't1', caja: 'talbot-1', cajaNombre: 'Caja 1', numeroCaja: 1, tienda: 'talbot',
  cajero: usuarioDe(quien), cajeroNombre: 'María', ticket: 'tk1', folio: null, texto: '2× Tajin Clasico — $9.98',
  importeCentavos: 998, fecha: Timestamp.now(), registradoEn: serverTimestamp(), ...extra,
});
const recepcion = (quien, extra = {}) => ({
  tienda: 'talbot', proveedor: 'Distribuidora del Sur', referencia: 'F-1234', nota: null,
  lineas: [{ producto: 'p1', nombre: 'TAJIN CLASICO', upc: '633148100013', plu: null, cantidad: 24, pesoGramos: null }],
  productos: 1, piezas: 24, gramos: 0,
  recibidoPor: usuarioDe(quien), recibidoPorNombre: 'María', fecha: serverTimestamp(), anulada: false, anuladaPor: null, anuladaEn: null, ...extra,
});

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}

describe('reglas · movimientos en vivo e inventario', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({ projectId: 'demo-aguilapos', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  after(async () => entorno.cleanup());
  beforeEach(async () => {
    await entorno.clearFirestore();
    await sembrar({
      [`staff/${ADMIN}`]: ficha({ usuario: ADMIN, nombre: 'Admin', rol: 'admin' }),
      'staff/100123': ficha({ usuario: '100123', nombre: 'María', rol: 'empleado', correo: 'maria@aguila.test', catalogo: true }),
      'staff/100124': ficha({ usuario: '100124', nombre: 'Luis', rol: 'empleado', correo: 'luis@aguila.test' }),
      'staff/100199': { ...ficha({ usuario: '100199', nombre: 'Baja', rol: 'empleado', correo: 'baja@aguila.test', catalogo: true }), activo: false },
    });
  });

  describe('eventos/', () => {
    it('quien vende registra sus movimientos con la hora del servidor', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'eventos/e1'), evento(MARIA)));
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'eventos/e2'), evento(MARIA, { tipo: 'venta_completada', folio: '261104-01-0001', importeCentavos: 1751 })));
      await assertSucceeds(setDoc(doc(contexto(LUIS), 'eventos/e3'), evento(LUIS, { tipo: 'turno_abierto', ticket: null, importeCentavos: 15000 })));
    });
    it('no a nombre de otra persona, ni con otra hora, ni un tipo inventado, ni con campos de más', async () => {
      const db = contexto(MARIA);
      await assertFails(setDoc(doc(db, 'eventos/e1'), evento(LUIS)));
      await assertFails(setDoc(doc(db, 'eventos/e1'), evento(MARIA, { registradoEn: AHORA })));
      await assertFails(setDoc(doc(db, 'eventos/e1'), evento(MARIA, { tipo: 'regalo' })));
      await assertFails(setDoc(doc(db, 'eventos/e1'), { ...evento(MARIA), extra: 1 }));
      await assertFails(setDoc(doc(db, 'eventos/e1'), evento(MARIA, { fecha: Timestamp.fromMillis(Date.now() + 3600_000) })));
      await assertFails(setDoc(doc(db, 'eventos/e1'), evento(MARIA, { importeCentavos: 9.98 })));
      await assertFails(setDoc(doc(contexto(correoDeAcceso('100199')), 'eventos/e1'), evento(correoDeAcceso('100199'))), 'personal inactivo');
      await assertFails(setDoc(doc(anonimo(), 'eventos/e1'), evento(MARIA)));
    });
    it('solo los administradores los leen; nadie los cambia ni los borra', async () => {
      await sembrar({ 'eventos/e1': { ...evento(MARIA), registradoEn: AHORA } });
      await assertSucceeds(getDocs(collection(contexto(ADMIN), 'eventos')));
      await assertFails(getDoc(doc(contexto(MARIA), 'eventos/e1')));
      await assertFails(getDocs(collection(contexto(MARIA), 'eventos')));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'eventos/e1'), { texto: 'otro' }));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'eventos/e1')));
    });
  });

  describe('recepciones/: lo que llegó', () => {
    it('la registran el admin y el personal del Catálogo, a su nombre y con la hora del servidor', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA)));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'recepciones/r2'), recepcion(ADMIN, { tienda: null, proveedor: null, referencia: null })));
    });
    it('sin permiso del Catálogo, a nombre de otro, anulada de entrada, vacía o con cuentas que no cuadran, no', async () => {
      await assertFails(setDoc(doc(contexto(LUIS), 'recepciones/r1'), recepcion(LUIS)));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(LUIS)));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { anulada: true })));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { lineas: [], productos: 0, piezas: 0 })));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { productos: 2 })));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { piezas: 2.5 })));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { fecha: AHORA })));
      await assertFails(setDoc(doc(contexto(MARIA), 'recepciones/r1'), recepcion(MARIA, { tienda: 'Talbot St' })));
    });
    it('las leen el admin y el personal del Catálogo; el resto no', async () => {
      await sembrar({ 'recepciones/r1': { ...recepcion(MARIA), fecha: AHORA } });
      await assertSucceeds(getDocs(collection(contexto(MARIA), 'recepciones')));
      await assertSucceeds(getDocs(collection(contexto(ADMIN), 'recepciones')));
      await assertFails(getDocs(collection(contexto(LUIS), 'recepciones')));
      await assertFails(getDoc(doc(anonimo(), 'recepciones/r1')));
    });
    it('solo un admin la anula, una vez, a su nombre; nadie la cambia ni la borra', async () => {
      await sembrar({ 'recepciones/r1': { ...recepcion(MARIA), fecha: AHORA } });
      await assertFails(updateDoc(doc(contexto(MARIA), 'recepciones/r1'), { anulada: true, anuladaPor: '100123', anuladaEn: serverTimestamp() }));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'recepciones/r1'), { anulada: true, anuladaPor: ADMIN, anuladaEn: serverTimestamp(), piezas: 1 }));
      await assertSucceeds(updateDoc(doc(contexto(ADMIN), 'recepciones/r1'), { anulada: true, anuladaPor: ADMIN, anuladaEn: serverTimestamp() }));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'recepciones/r1'), { anulada: true, anuladaPor: ADMIN, anuladaEn: serverTimestamp() }), 'ya estaba anulada');
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'recepciones/r1')));
    });
  });
});
