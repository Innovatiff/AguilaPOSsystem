/**
 * Reglas de los movimientos en vivo (eventos/) y del inventario (recepciones/).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, Timestamp, serverTimestamp, setLogLevel, increment,
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

/** Lo que manda el Ajuste rápido (con merge): identidad del producto, lugares contados ahora, caducidad y país. */
const conteo = (quien, extra = {}) => ({
  cajas: 3, porCaja: 12, sueltas: 4, total: 40, contadoEn: serverTimestamp(), contadoPor: usuarioDe(quien), contadoPorNombre: 'María', ...extra,
});
const existencia = (quien, extra = {}) => ({
  tienda: 'talbot', producto: 'p1', nombre: 'TAJIN CLASICO 142g', upc: '633148100013', plu: null, porPeso: false,
  caducidad: '2027-01-15', origen: 'México',
  actualizadoEn: serverTimestamp(), actualizadoPor: usuarioDe(quien), actualizadoPorNombre: 'María', ...extra,
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

  describe('existencias/: cuánto hay en la tienda y en la bodega', () => {
    beforeEach(async () => {
      await sembrar({ 'products/p1': { nombre: 'CLASICO', marca: 'TAJIN' }, 'products/p2': { nombre: 'COCA COLA' } });
    });
    it('la cuentan el admin y el personal del Catálogo, a su nombre y con la hora del servidor', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'existencias/talbot__p1'), { ...existencia(MARIA), enTienda: conteo(MARIA) }, { merge: true }));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'existencias/talbot__p2'), {
        ...existencia(ADMIN, { producto: 'p2', nombre: 'COCA COLA', upc: null, caducidad: null, origen: null, actualizadoPorNombre: 'Admin' }),
        enBodega: conteo(ADMIN, { cajas: null, porCaja: null, sueltas: 0, total: 0, contadoPorNombre: 'Admin' }),
      }, { merge: true }));
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'existencias/talbot__p1'), existencia(MARIA, { caducidad: null }), { merge: true }), 'solo la caducidad y el país');
    });
    it('contar la bodega no toca la tienda (merge); lo contado antes se queda igual', async () => {
      await sembrar({ 'existencias/talbot__p1': { ...existencia(MARIA), actualizadoEn: AHORA, enTienda: { ...conteo(MARIA), contadoEn: AHORA } } });
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'existencias/talbot__p1'), {
        ...existencia(ADMIN, { actualizadoPorNombre: 'Admin' }), enBodega: conteo(ADMIN, { cajas: 10, porCaja: 12, sueltas: null, total: 120, contadoPorNombre: 'Admin' }),
      }, { merge: true }));
      const leida = (await getDoc(doc(contexto(ADMIN), 'existencias/talbot__p1'))).data();
      if (leida.enTienda.total !== 40 || leida.enTienda.contadoPor !== '100123' || leida.enBodega.total !== 120) throw new Error(JSON.stringify(leida));
      // Lo de la tienda solo cambia con un conteo nuevo (hora del servidor), no con datos viejos.
      await assertFails(setDoc(doc(contexto(ADMIN), 'existencias/talbot__p1'), {
        ...existencia(ADMIN, { actualizadoPorNombre: 'Admin' }), enTienda: { ...conteo(MARIA), total: 41, sueltas: 5, contadoEn: AHORA },
      }, { merge: true }));
    });
    it('sin permiso del Catálogo, a nombre de otro, con cuentas que no cuadran o datos de más, no', async () => {
      const db = contexto(MARIA);
      const ruta = 'existencias/talbot__p1';
      const con = (extra) => setDoc(doc(db, ruta), { ...existencia(MARIA), enTienda: conteo(MARIA, extra) }, { merge: true });
      await assertFails(setDoc(doc(contexto(LUIS), ruta), { ...existencia(LUIS), enTienda: conteo(LUIS) }, { merge: true }), 'sin permiso del Catálogo');
      await assertFails(setDoc(doc(contexto(correoDeAcceso('100199')), ruta), existencia(correoDeAcceso('100199')), { merge: true }), 'personal inactivo');
      await assertFails(con({ contadoPor: '100124' }), 'contado a nombre de otro');
      await assertFails(setDoc(doc(db, ruta), existencia(LUIS), { merge: true }), 'actualizado a nombre de otro');
      await assertFails(con({ total: 41 }), 'cajas × por caja + sueltas no da el total');
      await assertFails(con({ porCaja: null, total: 4 }), 'cajas sin lo que trae cada una');
      await assertFails(con({ cajas: 2.5, total: 34 }), 'cajas no enteras');
      await assertFails(con({ contadoEn: AHORA }), 'con otra hora');
      await assertFails(con({ extra: 1 }), 'un conteo con campos de más');
      await assertFails(setDoc(doc(db, ruta), { ...existencia(MARIA), extra: 1 }, { merge: true }), 'campos de más');
      await assertFails(setDoc(doc(db, ruta), existencia(MARIA, { actualizadoEn: AHORA }), { merge: true }), 'actualizado con otra hora');
      await assertFails(setDoc(doc(db, ruta), existencia(MARIA, { caducidad: 'mañana' }), { merge: true }), 'caducidad que no es fecha');
      await assertFails(setDoc(doc(db, ruta), existencia(MARIA, { origen: 'x'.repeat(61) }), { merge: true }), 'país demasiado largo');
      await assertFails(setDoc(doc(db, 'existencias/talbot__p2'), existencia(MARIA), { merge: true }), 'el id no es tienda__producto');
      await assertFails(setDoc(doc(db, 'existencias/talbot__p9'), existencia(MARIA, { producto: 'p9' }), { merge: true }), 'el producto no existe');
      await assertFails(setDoc(doc(db, 'existencias/Talbot__p1'), existencia(MARIA, { tienda: 'Talbot' }), { merge: true }), 'tienda no válida');
      await assertFails(setDoc(doc(anonimo(), ruta), existencia(MARIA), { merge: true }));
    });
    it('las lee el personal activo (la caja necesita saber qué descontar); nadie las borra', async () => {
      await sembrar({ 'existencias/talbot__p1': { ...existencia(MARIA), actualizadoEn: AHORA, enTienda: { ...conteo(MARIA), contadoEn: AHORA } } });
      await assertSucceeds(getDocs(query(collection(contexto(MARIA), 'existencias'), where('tienda', '==', 'talbot'))));
      await assertSucceeds(getDoc(doc(contexto(ADMIN), 'existencias/talbot__p1')));
      await assertSucceeds(getDocs(query(collection(contexto(LUIS), 'existencias'), where('tienda', '==', 'talbot'))), 'un cajero sin permiso del Catálogo');
      await assertFails(getDocs(query(collection(contexto(correoDeAcceso('100199')), 'existencias'), where('tienda', '==', 'talbot'))), 'personal inactivo');
      await assertFails(getDoc(doc(anonimo(), 'existencias/talbot__p1')));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'existencias/talbot__p1')));
    });
  });

  describe('existencias/: lo que mueven las ventas y las entregas', () => {
    const HACE_UN_DIA = Timestamp.fromMillis(Date.now() - 86_400_000);
    const EN_UNA_HORA = Timestamp.fromMillis(Date.now() + 3_600_000);
    /** Lo que guarda la caja (solo lo que las reglas miran de la venta). */
    const venta = (cajero, extra = {}) => ({
      tipo: 'venta', tienda: 'talbot', cajero, fecha: Timestamp.now(),
      lineas: [{ productoId: 'p1', unidad: 'pieza', cantidad: 2, pesoGramos: null }, { productoId: 'p2', unidad: 'pieza', cantidad: 1, pesoGramos: null }],
      ...extra,
    });
    const contada = (extra = {}) => ({ ...existencia(MARIA), actualizadoEn: AHORA, enTienda: { ...conteo(MARIA), contadoEn: AHORA }, ...extra });
    /** Lo que manda la caja por cada producto vendido (updateDoc). */
    const salida = (quien, { ref = 'v1', linea = 0, cantidad = 2, tipo = 'venta', sumar = cantidad } = {}) => ({
      vendidoTienda: increment(sumar),
      ultimoMovimiento: { tipo, ref, linea, cantidad, por: usuarioDe(quien), registradoEn: serverTimestamp() },
    });
    /** Lo que manda el inventario por cada renglón de una entrega (setDoc con merge) o de su anulación. */
    const entrada = (quien, { ref = 'r1', linea = 0, cantidad = 24, tipo = 'entrega', sumar = cantidad, producto = 'p1', nombre = 'María' } = {}) => ({
      tienda: 'talbot', producto, nombre: 'TAJIN CLASICO 142g', upc: '633148100013', plu: null, porPeso: false,
      recibidoBodega: increment(sumar),
      ultimoMovimiento: { tipo, ref, linea, cantidad, por: usuarioDe(quien), registradoEn: serverTimestamp() },
      actualizadoEn: serverTimestamp(), actualizadoPor: usuarioDe(quien), actualizadoPorNombre: nombre,
    });
    const leer = async (ruta) => (await getDoc(doc(contexto(ADMIN), ruta))).data();

    beforeEach(async () => {
      await sembrar({
        'products/p1': { nombre: 'CLASICO', marca: 'TAJIN' },
        'products/p2': { nombre: 'COCA COLA' },
        'ventas/v1': venta('100124'),
        'ventas/v2': venta('100124', { tipo: 'devolucion', lineas: [{ productoId: 'p1', unidad: 'pieza', cantidad: -1, pesoGramos: null }] }),
        'ventas/de-maria': venta('100123'),
        'ventas/baja': venta('100199'),
        'recepciones/r1': { ...recepcion(MARIA), fecha: AHORA },
      });
    });

    it('la caja descuenta lo vendido de la tienda (y la devolución lo regresa), a nombre de quien cobra', async () => {
      await sembrar({ 'existencias/talbot__p1': contada() });
      const db = contexto(LUIS);
      await assertSucceeds(updateDoc(doc(db, 'existencias/talbot__p1'), salida(LUIS)));
      await assertSucceeds(updateDoc(doc(db, 'existencias/talbot__p1'), salida(LUIS, { ref: 'v2', tipo: 'devolucion', cantidad: -1 })));
      const leida = await leer('existencias/talbot__p1');
      if (leida.vendidoTienda !== 1 || leida.enTienda.total !== 40 || leida.ultimoMovimiento.tipo !== 'devolucion') throw new Error(JSON.stringify(leida));
      // Sin conteo de la tienda (solo la bodega), también cuenta.
      await sembrar({ 'existencias/talbot__p2': { ...contada({ producto: 'p2', nombre: 'COCA COLA', upc: null }), enTienda: null, enBodega: { ...conteo(MARIA), contadoEn: AHORA } } });
      await assertSucceeds(updateDoc(doc(db, 'existencias/talbot__p2'), salida(LUIS, { linea: 1, cantidad: 1 })));
    });

    it('una venta no cuenta si es de otra persona, tienda o producto, al revés, o donde no hay existencias', async () => {
      await sembrar({ 'existencias/talbot__p1': contada(), 'existencias/erie__p1': contada({ tienda: 'erie' }) });
      const db = contexto(LUIS);
      const ruta = doc(db, 'existencias/talbot__p1');
      await assertFails(updateDoc(ruta, salida(LUIS, { ref: 'de-maria' })), 'la venta es de otra persona');
      await assertFails(updateDoc(ruta, salida(MARIA)), 'a nombre de otro');
      await assertFails(updateDoc(doc(db, 'existencias/erie__p1'), salida(LUIS)), 'otra tienda');
      await assertFails(updateDoc(ruta, salida(LUIS, { linea: 1 })), 'ese renglón es de otro producto');
      await assertFails(updateDoc(ruta, salida(LUIS, { cantidad: -2 })), 'una venta no regresa');
      await assertFails(updateDoc(ruta, salida(LUIS, { ref: 'v2', tipo: 'venta', cantidad: 1 })), 'el tipo no es el de la venta');
      await assertFails(updateDoc(ruta, salida(LUIS, { sumar: 5 })), 'el contador no sube lo que dice el movimiento');
      await assertFails(updateDoc(ruta, { ...salida(LUIS), nombre: 'OTRO' }), 'la caja solo mueve lo vendido');
      await assertFails(updateDoc(ruta, { ...salida(LUIS), ultimoMovimiento: { ...salida(LUIS).ultimoMovimiento, extra: 1 } }), 'movimiento con campos de más');
      await assertFails(setDoc(doc(db, 'existencias/talbot__p2'), { ...existencia(LUIS, { producto: 'p2' }), ...salida(LUIS, { linea: 1, cantidad: 1 }) }, { merge: true }), 'la caja no crea existencias');
      await assertFails(updateDoc(doc(contexto(correoDeAcceso('100199')), 'existencias/talbot__p1'), salida(correoDeAcceso('100199'), { ref: 'baja' })), 'personal inactivo');
      const leida = await leer('existencias/talbot__p1');
      if ('vendidoTienda' in leida) throw new Error(JSON.stringify(leida));
    });

    it('una entrega suma a la bodega (y crea las existencias si no había); su anulación la resta', async () => {
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'existencias/talbot__p1'), entrada(MARIA), { merge: true }));
      let leida = await leer('existencias/talbot__p1');
      if (leida.recibidoBodega !== 24 || 'enBodega' in leida || leida.ultimoMovimiento.ref !== 'r1') throw new Error(JSON.stringify(leida));
      // Contada la bodega antes de que llegara otra entrega: la entrega se suma al conteo.
      await sembrar({ 'recepciones/r2': { ...recepcion(MARIA), fecha: Timestamp.now(), lineas: [{ producto: 'p1', nombre: 'TAJIN', upc: null, plu: null, cantidad: 12, pesoGramos: null }] } });
      await sembrar({ 'existencias/talbot__p1': { ...leida, recibidoBodega: 0, enBodega: { ...conteo(MARIA), contadoEn: HACE_UN_DIA } } });
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'existencias/talbot__p1'), entrada(MARIA, { ref: 'r2', cantidad: 12 }), { merge: true }));
      // El admin la anula y resta lo que había sumado.
      await sembrar({ 'recepciones/r2': { ...recepcion(MARIA), fecha: Timestamp.now(), lineas: [{ producto: 'p1', nombre: 'TAJIN', upc: null, plu: null, cantidad: 12, pesoGramos: null }], anulada: true, anuladaPor: ADMIN, anuladaEn: Timestamp.now() } });
      await assertSucceeds(updateDoc(doc(contexto(ADMIN), 'existencias/talbot__p1'), (({ recibidoBodega, ultimoMovimiento, actualizadoEn, actualizadoPor, actualizadoPorNombre }) => ({ recibidoBodega, ultimoMovimiento, actualizadoEn, actualizadoPor, actualizadoPorNombre }))(entrada(ADMIN, { ref: 'r2', tipo: 'anulacion', cantidad: -12, nombre: 'Admin' }))));
      leida = await leer('existencias/talbot__p1');
      if (leida.recibidoBodega !== 0 || leida.ultimoMovimiento.tipo !== 'anulacion') throw new Error(JSON.stringify(leida));
    });

    it('una entrega no cuenta: sin permiso, otra cantidad, producto o tienda, anulada, ya contada, o anulada por otro', async () => {
      const ruta = 'existencias/talbot__p1';
      await assertFails(setDoc(doc(contexto(LUIS), ruta), entrada(LUIS, { nombre: 'Luis' }), { merge: true }), 'sin permiso del Catálogo');
      await assertFails(setDoc(doc(contexto(ADMIN), ruta), entrada(ADMIN, { nombre: 'Admin' }), { merge: true }), 'la registró otra persona');
      const db = contexto(MARIA);
      await assertFails(setDoc(doc(db, ruta), entrada(MARIA, { cantidad: 25 }), { merge: true }), 'otra cantidad que la del renglón');
      await assertFails(setDoc(doc(db, 'existencias/talbot__p2'), entrada(MARIA, { producto: 'p2' }), { merge: true }), 'ese renglón es de otro producto');
      await assertFails(setDoc(doc(db, ruta), { ...entrada(MARIA), enTienda: conteo(MARIA) }, { merge: true }), 'una entrega no cuenta la tienda');
      await assertFails(setDoc(doc(db, ruta), entrada(MARIA, { tipo: 'anulacion', cantidad: -24 }), { merge: true }), 'una anulación no crea existencias');
      await sembrar({ [ruta]: contada({ enBodega: { ...conteo(MARIA), contadoEn: Timestamp.now() } }) });
      await assertFails(setDoc(doc(db, ruta), entrada(MARIA), { merge: true }), 'llegó antes del último conteo de la bodega: ya está contada');
      await sembrar({ [ruta]: contada(), 'recepciones/r1': { ...recepcion(MARIA), fecha: AHORA, anulada: true, anuladaPor: ADMIN, anuladaEn: AHORA } });
      await assertFails(setDoc(doc(db, ruta), entrada(MARIA), { merge: true }), 'la entrega ya está anulada');
      await assertFails(updateDoc(doc(db, ruta), entrada(MARIA, { tipo: 'anulacion', cantidad: -24 })), 'la anuló otra persona');
      const leida = await leer(ruta);
      if ('recibidoBodega' in leida) throw new Error(JSON.stringify(leida));
    });

    it('contar un lugar pone su contador en cero; sin contarlo, el contador y el último movimiento no se tocan', async () => {
      const movimiento = { tipo: 'venta', ref: 'v1', linea: 0, cantidad: 5, por: '100124', registradoEn: AHORA };
      await sembrar({ 'existencias/talbot__p1': contada({ vendidoTienda: 5, recibidoBodega: 24, ultimoMovimiento: movimiento }) });
      const db = contexto(MARIA);
      const ruta = doc(db, 'existencias/talbot__p1');
      await assertFails(setDoc(ruta, { ...existencia(MARIA), enTienda: conteo(MARIA, { total: 35, sueltas: null, cajas: 35, porCaja: 1 }) }, { merge: true }), 'contar la tienda sin poner en cero lo vendido');
      await assertFails(setDoc(ruta, { ...existencia(MARIA), vendidoTienda: 0 }, { merge: true }), 'poner en cero lo vendido sin contar');
      await assertFails(setDoc(ruta, { ...existencia(MARIA), ultimoMovimiento: { ...movimiento, cantidad: 6 } }, { merge: true }), 'cambiar el último movimiento');
      await assertSucceeds(setDoc(ruta, { ...existencia(MARIA), enTienda: conteo(MARIA), vendidoTienda: 0 }, { merge: true }));
      const leida = await leer('existencias/talbot__p1');
      if (leida.vendidoTienda !== 0 || leida.recibidoBodega !== 24 || leida.ultimoMovimiento.cantidad !== 5) throw new Error(JSON.stringify(leida));
    });
  });
});
