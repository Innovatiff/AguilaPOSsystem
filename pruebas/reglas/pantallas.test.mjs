/**
 * Reglas de la pantalla del cliente en tableta (pantallas/{huella}).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, Timestamp, serverTimestamp, setLogLevel,
} from 'firebase/firestore';
import { armarFichaPersonal, correoDeAcceso, usuarioDe } from '../../js/identidad.js';

const ADMIN = 'admin@aguila.test';
const JEFA = correoDeAcceso('100150'); // administradora con NIP
const MARIA = correoDeAcceso('100123'); // cajera
const BAJA = correoDeAcceso('100199'); // desactivada
const ID = 'b'.repeat(64);

let entorno;
setLogLevel('silent');
const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();
const AHORA = Timestamp.fromMillis(1_700_000_000_000);
const ficha = (datos) => ({ ...armarFichaPersonal(datos, usuarioDe(ADMIN)), creadoEn: AHORA, actualizadoEn: AHORA });

const estadoVenta = {
  v: 1, fase: 'venta', tienda: 'El Águila Market', caja: 'Caja 1', atiende: 'María', mensaje: '¡Gracias por su compra!', devolucion: false,
  lineas: [{ id: 'l1', nombre: 'TAJIN CLASICO 142g', detalle: '2 × $4.99', importe: '$9.98', antes: null, descuento: null, negativa: false }],
  ocultas: 0, ultima: null, articulos: 2, subtotal: '$9.98', descuento: null, ahorro: null, impuestoNombre: 'HST 13 %', impuesto: '$1.30', total: '$11.28', totalEfectivo: '$11.30',
};
const pantalla = (quien, extra = {}) => ({ caja: 'talbot-1', cajero: usuarioDe(quien), estado: estadoVenta, actualizadoEn: serverTimestamp(), ...extra });

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}

describe('reglas · pantalla del cliente en tableta (pantallas/)', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({ projectId: 'demo-aguilapos', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  after(async () => entorno.cleanup());
  beforeEach(async () => {
    await entorno.clearFirestore();
    await sembrar({
      [`staff/${ADMIN}`]: ficha({ usuario: ADMIN, nombre: 'Admin', rol: 'admin' }),
      'staff/100150': ficha({ usuario: '100150', nombre: 'Rosa', rol: 'admin', correo: 'rosa@aguila.test' }),
      'staff/100123': ficha({ usuario: '100123', nombre: 'María', rol: 'empleado', correo: 'maria@aguila.test' }),
      'staff/100199': { ...ficha({ usuario: '100199', nombre: 'Baja', rol: 'empleado', correo: 'baja@aguila.test' }), activo: false },
    });
  });

  it('un administrador empareja la tableta (crea el documento); la cajera no', async () => {
    await assertFails(setDoc(doc(contexto(MARIA), `pantallas/${ID}`), pantalla(MARIA)));
    await assertSucceeds(setDoc(doc(contexto(JEFA), `pantallas/${ID}`), pantalla(JEFA, { estado: { v: 1, fase: 'cerrada', tienda: '', caja: 'Caja 1', atiende: '', mensaje: '¡Gracias!' } })));
    await assertSucceeds(setDoc(doc(contexto(ADMIN), `pantallas/${'c'.repeat(64)}`), pantalla(ADMIN)));
  });

  it('solo con un id de 64 caracteres hexadecimales', async () => {
    await assertFails(setDoc(doc(contexto(ADMIN), 'pantallas/caja-1'), pantalla(ADMIN)));
    await assertFails(setDoc(doc(contexto(ADMIN), `pantallas/${'B'.repeat(64)}`), pantalla(ADMIN)));
  });

  it('emparejada, quien atiende la caja la actualiza a su nombre, con la hora del servidor', async () => {
    await sembrar({ [`pantallas/${ID}`]: { ...pantalla(JEFA), actualizadoEn: AHORA } });
    const db = contexto(MARIA);
    await assertSucceeds(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA)));
    await assertSucceeds(updateDoc(doc(db, `pantallas/${ID}`), { cajero: '100123', estado: { ...estadoVenta, fase: 'cobrado', lineas: null }, actualizadoEn: serverTimestamp() }));
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(JEFA)), 'a nombre de otra persona');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA, { actualizadoEn: AHORA })), 'otra hora');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), { ...pantalla(MARIA), extra: 1 }), 'campo de más');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA, { estado: { ...estadoVenta, fase: 'publicidad' } })), 'fase inventada');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA, { estado: { ...estadoVenta, v: 2 } })), 'otra versión');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA, { estado: 'hola' })), 'estado que no es un mapa');
    await assertFails(setDoc(doc(db, `pantallas/${ID}`), pantalla(MARIA, { caja: '' })), 'sin caja');
    await assertFails(setDoc(doc(contexto(BAJA), `pantallas/${ID}`), pantalla(BAJA)), 'personal inactivo');
    await assertFails(setDoc(doc(anonimo(), `pantallas/${ID}`), pantalla(MARIA)), 'sin sesión');
  });

  it('la tableta la lee sin sesión, solo por su id: nadie la lista', async () => {
    await sembrar({ [`pantallas/${ID}`]: { ...pantalla(MARIA), actualizadoEn: AHORA } });
    await assertSucceeds(getDoc(doc(anonimo(), `pantallas/${ID}`)));
    await assertSucceeds(getDoc(doc(anonimo(), `pantallas/${'d'.repeat(64)}`)), 'un id que no existe también se puede consultar (no hay nada)');
    await assertFails(getDocs(collection(anonimo(), 'pantallas')));
    await assertFails(getDocs(collection(contexto(ADMIN), 'pantallas')));
    await assertFails(getDoc(doc(anonimo(), 'pantallas/otra-cosa')));
  });

  it('solo un administrador la desconecta (borra)', async () => {
    await sembrar({ [`pantallas/${ID}`]: { ...pantalla(MARIA), actualizadoEn: AHORA } });
    await assertFails(deleteDoc(doc(contexto(MARIA), `pantallas/${ID}`)));
    await assertFails(deleteDoc(doc(anonimo(), `pantallas/${ID}`)));
    await assertSucceeds(deleteDoc(doc(contexto(JEFA), `pantallas/${ID}`)));
  });
});
