/**
 * Reglas del POS: cajas, turnos, ventas, movimientos de efectivo,
 * autorizaciones y configuración. Se ejecutan con npm test (emulador).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, writeBatch, Timestamp, serverTimestamp, setLogLevel,
} from 'firebase/firestore';
import { armarFichaPersonal, correoDeAcceso, usuarioDe } from '../../js/identidad.js';
import { lineaDeProducto, calcularTicket, registrarPago, armarVenta } from '../../js/ticket.js';

const ADMIN = 'admin@aguila.test';
const MARIA = correoDeAcceso('100123');
const LUIS = correoDeAcceso('100124');
const JEFA = correoDeAcceso('100150'); // admin por código
const AHORA = Timestamp.fromMillis(1_700_000_000_000);

let entorno;
setLogLevel('silent');
const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const ficha = (usuario, nombre, rol) => ({ ...armarFichaPersonal({ usuario, nombre, rol, tienda: 'talbot' }, ADMIN), creadoEn: AHORA, actualizadoEn: AHORA });
const caja = (extra = {}) => ({
  nombre: 'Caja 1', numero: 1, tienda: 'talbot', activo: true,
  turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null,
  actualizadoEn: AHORA, actualizadoPor: ADMIN, ...extra,
});
const configPos = (por = ADMIN, extra = {}) => ({
  impuestoNombre: 'HST', tasaImpuestoBP: 1300, fondoSugeridoCentavos: 15000, limiteVentaLibreCentavos: 20000,
  conteoCiego: true, papelRecibo: 80, reciboPie: '¡Gracias por su compra!',
  departamentos: [{ id: 'abarrotes', nombre: 'Abarrotes', claseFiscal: 'tasaCero', color: '#2e7d32' }],
  actualizadoEn: Timestamp.now(), actualizadoPor: usuarioDe(por), ...extra,
});

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}
async function leerSinReglas(ruta) {
  let datos;
  await entorno.withSecurityRulesDisabled(async (ctx) => { datos = (await getDoc(doc(ctx.firestore(), ruta))).data(); });
  return datos;
}

/** Lote de apertura: turno nuevo + caja ocupada. */
function loteAbrir(email, { turnoId = 't1', cajaId = 'c1', numeroCaja = 1, tienda = 'talbot', fondo = 15000, extraTurno = {}, conCaja = true } = {}) {
  const db = contexto(email);
  const usuario = usuarioDe(email);
  const lote = writeBatch(db);
  lote.set(doc(db, 'turnos', turnoId), {
    caja: cajaId, cajaNombre: 'Caja 1', numeroCaja, tienda, tiendaNombre: 'Águila Talbot', cajero: usuario, cajeroNombre: usuario,
    estado: 'abierto', abiertoEn: serverTimestamp(), fondoInicialCentavos: fondo,
    cerradoEn: null, cerradoPor: null, cierreRegistradoEn: null, cierreForzado: false,
    efectivoContadoCentavos: null, conteo: null, diferenciaCentavos: null, resumen: null, notaCierre: null,
    ...extraTurno,
  });
  if (conCaja) lote.update(doc(db, 'cajas', cajaId), { turnoActual: turnoId, turnoCajero: usuario, turnoCajeroNombre: usuario, turnoDesde: serverTimestamp() });
  return lote;
}

/** Lote de cierre: turno cerrado + caja libre. */
function loteCerrar(email, { turnoId = 't1', cajaId = 'c1', cajero = usuarioDe(email), extra = {}, liberar = true } = {}) {
  const db = contexto(email);
  const usuario = usuarioDe(email);
  const lote = writeBatch(db);
  lote.update(doc(db, 'turnos', turnoId), {
    estado: 'cerrado', cerradoEn: Timestamp.now(), cerradoPor: usuario, cierreRegistradoEn: serverTimestamp(),
    cierreForzado: usuario !== cajero, efectivoContadoCentavos: 15000, conteo: { 10000: 1, 5000: 1 }, diferenciaCentavos: 0,
    resumen: { ventas: 0, totalCentavos: 0 }, notaCierre: null, ...extra,
  });
  if (liberar) lote.update(doc(db, 'cajas', cajaId), { turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null });
  return lote;
}

const TAJIN = { id: 'p1', upc: '633148100013', nombre: 'Clasico', marca: 'Tajin', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' };

/** Venta cobrada en efectivo, lista para guardar. */
function venta(email, { turno = 't1', cantidad = 2, descuentoTicket = null, tipo, extra = {} } = {}) {
  const calculo = calcularTicket([lineaDeProducto(TAJIN, { cantidad })], { descuentoTicket });
  const { pago } = registrarPago(calculo.totalCentavos, [], { metodo: 'efectivo', montoCentavos: cantidad > 0 ? 2000 : 0 });
  const usuario = usuarioDe(email);
  return {
    ...armarVenta(calculo, [pago], {
      folio: '261102-01-0001', numero: 1, dia: '2026-11-02', tipo, turno, caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1,
      tienda: 'talbot', tiendaNombre: 'Águila Talbot', cajero: usuario, cajeroNombre: usuario, fecha: Timestamp.now(),
    }),
    registradoEn: serverTimestamp(),
    ...extra,
  };
}

function movimiento(email, extra = {}) {
  const usuario = usuarioDe(email);
  return {
    turno: 't1', caja: 'c1', tienda: 'talbot', cajero: usuario, cajeroNombre: usuario, tipo: 'retiro', importeCentavos: 10000,
    motivo: 'A la caja fuerte', fecha: Timestamp.now(), registradoEn: serverTimestamp(), ...extra,
  };
}

function autorizacion(emailAdmin, extra = {}) {
  return { tipo: 'modificacion', turno: 't1', caja: 'c1', cajero: '100123', admin: usuarioDe(emailAdmin), fecha: serverTimestamp(), detalle: 'Descuento 10 %', ...extra };
}

describe('reglas del POS', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({ projectId: 'demo-aguilapos', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  after(async () => entorno.cleanup());
  beforeEach(async () => {
    await entorno.clearFirestore();
    await sembrar({
      [`staff/${ADMIN}`]: ficha(ADMIN, 'Admin', 'admin'),
      'staff/100123': ficha('100123', 'María', 'empleado'),
      'staff/100124': ficha('100124', 'Luis', 'empleado'),
      'staff/100150': ficha('100150', 'Jefa', 'admin'),
      'stores/talbot': { nombre: 'Águila Talbot', direccion: '24 Talbot St W', activo: true },
      'cajas/c1': caja(),
      'cajas/c2': caja({ nombre: 'Caja 2', numero: 2, activo: false }),
    });
  });

  describe('configuración y tiendas', () => {
    it('el personal lee la configuración; solo un admin la escribe, válida', async () => {
      await sembrar({ 'config/pos': configPos() });
      await assertSucceeds(getDoc(doc(contexto(MARIA), 'config/pos')));
      await assertFails(setDoc(doc(contexto(MARIA), 'config/pos'), configPos(MARIA)));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'config/pos'), configPos()));
      await assertFails(setDoc(doc(contexto(ADMIN), 'config/pos'), configPos(ADMIN, { tasaImpuestoBP: 5000 })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'config/pos'), configPos(ADMIN, { papelRecibo: 100 })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'config/otra'), configPos()));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'config/pos')));
    });
    it('las tiendas aceptan los datos del recibo, opcionales y con límite', async () => {
      const db = contexto(ADMIN);
      await assertSucceeds(setDoc(doc(db, 'stores/erie'), { nombre: 'Águila Erie', direccion: '42 Erie St S', activo: true, telefono: '519-555-0100', correo: 'erie@aguila.test', numeroImpuesto: '123456789RT0001' }));
      await assertSucceeds(setDoc(doc(db, 'stores/sur'), { nombre: 'Águila Sur', direccion: '', activo: true }));
      await assertFails(setDoc(doc(db, 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true, telefono: 'x'.repeat(31) }));
      await assertFails(setDoc(doc(db, 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true, fax: '1' }));
    });
  });

  describe('cajas', () => {
    it('solo el admin da de alta y edita cajas; nunca con un turno ya puesto', async () => {
      await assertFails(setDoc(doc(contexto(MARIA), 'cajas/c3'), caja({ actualizadoPor: '100123' })));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'cajas/c3'), caja({ numero: 3 })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'cajas/c4'), caja({ numero: 4, turnoActual: 't9', turnoCajero: '100123', turnoCajeroNombre: 'María', turnoDesde: AHORA })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'cajas/c5'), caja({ numero: 100 })));
      await assertSucceeds(updateDoc(doc(contexto(ADMIN), 'cajas/c1'), { nombre: 'Caja rápida', actualizadoEn: Timestamp.now(), actualizadoPor: ADMIN }));
      await assertFails(updateDoc(doc(contexto(MARIA), 'cajas/c1'), { nombre: 'Mía', actualizadoEn: Timestamp.now(), actualizadoPor: '100123' }));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'cajas/c1'), { turnoActual: 't9', turnoCajero: ADMIN, turnoCajeroNombre: 'A', turnoDesde: Timestamp.now() }));
      await assertSucceeds(getDoc(doc(contexto(MARIA), 'cajas/c1')));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'cajas/c2')));
    });
  });

  describe('abrir turno', () => {
    it('una cajera abre su turno y ocupa la caja en el mismo lote, con la hora del servidor', async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
      const turno = await leerSinReglas('turnos/t1');
      const c1 = await leerSinReglas('cajas/c1');
      assert.equal(c1.turnoActual, 't1');
      assert.equal(c1.turnoCajero, '100123');
      assert.equal(turno.abiertoEn.toMillis(), c1.turnoDesde.toMillis());
    });
    it('sin ocupar la caja, en caja inactiva, a nombre de otra o con datos de otra caja, no', async () => {
      await assertFails(loteAbrir(MARIA, { conCaja: false }).commit());
      await assertFails(loteAbrir(MARIA, { cajaId: 'c2', numeroCaja: 2 }).commit());
      await assertFails(loteAbrir(MARIA, { extraTurno: { cajero: '100124' } }).commit());
      await assertFails(loteAbrir(MARIA, { numeroCaja: 7 }).commit());
      await assertFails(loteAbrir(MARIA, { tienda: 'erie' }).commit());
      await assertFails(loteAbrir(MARIA, { extraTurno: { resumen: { totalCentavos: 0 } } }).commit());
      await assertFails(loteAbrir(MARIA, { extraTurno: { abiertoEn: AHORA } }).commit());
    });
    it('una caja ocupada no admite otro turno', async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
      await assertFails(loteAbrir(LUIS, { turnoId: 't2' }).commit());
    });
    it('cada quien lee sus turnos; el admin, todos', async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
      await assertSucceeds(getDoc(doc(contexto(MARIA), 'turnos/t1')));
      await assertFails(getDoc(doc(contexto(LUIS), 'turnos/t1')));
      await assertSucceeds(getDoc(doc(contexto(ADMIN), 'turnos/t1')));
      await assertSucceeds(getDocs(query(collection(contexto(MARIA), 'turnos'), where('cajero', '==', '100123'), where('estado', '==', 'abierto'))));
      await assertFails(getDocs(query(collection(contexto(MARIA), 'turnos'), where('estado', '==', 'abierto'))));
    });
  });

  describe('ventas', () => {
    beforeEach(async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
    });

    it('la cajera registra una venta de su turno con la hora del servidor; nadie la cambia ni la borra', async () => {
      const db = contexto(MARIA);
      await assertSucceeds(setDoc(doc(db, 'ventas/v1'), venta(MARIA)));
      await assertSucceeds(getDoc(doc(db, 'ventas/v1')));
      await assertFails(getDoc(doc(contexto(LUIS), 'ventas/v1')));
      await assertSucceeds(getDoc(doc(contexto(ADMIN), 'ventas/v1')));
      await assertSucceeds(getDocs(query(collection(db, 'ventas'), where('cajero', '==', '100123'), where('turno', '==', 't1'))));
      await assertFails(updateDoc(doc(db, 'ventas/v1'), { totalCentavos: 0 }));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'ventas/v1'), { totalCentavos: 0 }));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'ventas/v1')));
    });
    it('no se registra en el turno de otra persona ni a su nombre', async () => {
      await assertFails(setDoc(doc(contexto(LUIS), 'ventas/v1'), venta(LUIS)));
      await assertFails(setDoc(doc(contexto(LUIS), 'ventas/v1'), venta(MARIA)));
      await assertFails(setDoc(doc(contexto(MARIA), 'ventas/v1'), venta(MARIA, { extra: { caja: 'c2' } })));
    });
    it('los totales deben cuadrar entre sí y con los pagos', async () => {
      const db = contexto(MARIA);
      const v = venta(MARIA);
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, totalCentavos: v.totalCentavos - 100 }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, porMetodo: { ...v.porMetodo, efectivo: 0 } }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, redondeoCentavos: 5, porMetodo: { ...v.porMetodo, efectivo: v.porMetodo.efectivo + 4 } }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, baseGravadaCentavos: 0 }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, registradoEn: Timestamp.now() }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, fecha: Timestamp.fromMillis(Date.now() + 3600_000) }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, lineas: [] }));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...v, propina: 100 }));
    });
    it('un descuento o una devolución necesitan la autorización de un admin para ese turno', async () => {
      const db = contexto(MARIA);
      const conDescuento = venta(MARIA, { descuentoTicket: { tipo: 'porcentaje', puntosBase: 1000 } });
      await assertFails(setDoc(doc(db, 'ventas/v1'), conDescuento));
      // la cajera no puede autorizarse a sí misma
      await assertFails(setDoc(doc(db, 'autorizaciones/a0'), autorizacion(MARIA)));
      await assertSucceeds(setDoc(doc(contexto(JEFA), 'autorizaciones/a1'), autorizacion(JEFA)));
      await assertFails(setDoc(doc(db, 'ventas/v1'), { ...conDescuento, autorizacion: 'a1', autorizadoPor: ADMIN }));
      await assertSucceeds(setDoc(doc(db, 'ventas/v1'), { ...conDescuento, autorizacion: 'a1', autorizadoPor: '100150' }));

      const devolucion = venta(MARIA, { cantidad: -1, tipo: 'devolucion' });
      await assertFails(setDoc(doc(db, 'ventas/v2'), { ...devolucion, autorizacion: 'a1', autorizadoPor: '100150' }));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'autorizaciones/a2'), autorizacion(ADMIN, { tipo: 'devolucion', detalle: 'Producto dañado' })));
      await assertSucceeds(setDoc(doc(db, 'ventas/v2'), { ...devolucion, autorizacion: 'a2', autorizadoPor: ADMIN }));
      // una autorización es para la cajera y el turno indicados
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'autorizaciones/a3'), autorizacion(ADMIN, { tipo: 'devolucion' })));
      const luis = venta(LUIS, { cantidad: -1, tipo: 'devolucion' });
      await assertFails(setDoc(doc(contexto(LUIS), 'ventas/v3'), { ...luis, autorizacion: 'a3', autorizadoPor: ADMIN }));
    });
    it('una devolución lleva total negativo y sin descuentos', async () => {
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN, { tipo: 'devolucion' })));
      const v = venta(MARIA, { cantidad: 2, tipo: 'devolucion', extra: { autorizacion: 'a1', autorizadoPor: ADMIN } });
      await assertFails(setDoc(doc(contexto(MARIA), 'ventas/v1'), v));
    });
    it('una autorización solo la escribe un admin, a su nombre, para un turno abierto de esa cajera', async () => {
      await assertFails(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN, { admin: '100150' })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN, { cajero: '100124' })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN, { fecha: Timestamp.now() })));
      await assertFails(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN, { tipo: 'regalo' })));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), autorizacion(ADMIN)));
      await assertSucceeds(getDoc(doc(contexto(MARIA), 'autorizaciones/a1')));
      await assertFails(getDoc(doc(contexto(LUIS), 'autorizaciones/a1')));
      await assertFails(updateDoc(doc(contexto(ADMIN), 'autorizaciones/a1'), { detalle: 'otro' }));
    });
  });

  describe('movimientos de efectivo', () => {
    beforeEach(async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
    });
    it('retiros, entradas y aperturas de cajón de su propio turno, inmutables', async () => {
      const db = contexto(MARIA);
      await assertSucceeds(setDoc(doc(db, 'movimientosCaja/m1'), movimiento(MARIA)));
      await assertSucceeds(setDoc(doc(db, 'movimientosCaja/m2'), movimiento(MARIA, { tipo: 'apertura', importeCentavos: 0, motivo: null })));
      await assertSucceeds(setDoc(doc(db, 'movimientosCaja/m3'), movimiento(MARIA, { tipo: 'cancelacion', importeCentavos: 731, motivo: 'Cliente se arrepintió' })));
      await assertFails(setDoc(doc(db, 'movimientosCaja/m4'), movimiento(MARIA, { tipo: 'apertura', importeCentavos: 500 })));
      await assertFails(setDoc(doc(db, 'movimientosCaja/m5'), movimiento(MARIA, { importeCentavos: 0 })));
      await assertFails(setDoc(doc(db, 'movimientosCaja/m6'), movimiento(MARIA, { tipo: 'propina' })));
      await assertFails(setDoc(doc(contexto(LUIS), 'movimientosCaja/m7'), movimiento(LUIS)));
      await assertFails(updateDoc(doc(db, 'movimientosCaja/m1'), { importeCentavos: 1 }));
      await assertFails(getDoc(doc(contexto(LUIS), 'movimientosCaja/m1')));
      await assertSucceeds(getDoc(doc(contexto(ADMIN), 'movimientosCaja/m1')));
    });
  });

  describe('cerrar turno', () => {
    beforeEach(async () => {
      await assertSucceeds(loteAbrir(MARIA).commit());
    });
    it('la cajera cierra su turno y libera la caja en el mismo lote', async () => {
      await assertSucceeds(loteCerrar(MARIA).commit());
      const turno = await leerSinReglas('turnos/t1');
      assert.equal(turno.estado, 'cerrado');
      assert.equal(turno.cierreForzado, false);
      assert.equal((await leerSinReglas('cajas/c1')).turnoActual, null);
      // y la caja ya admite otro turno
      await assertSucceeds(loteAbrir(LUIS, { turnoId: 't2' }).commit());
    });
    it('sin liberar la caja, a nombre de otro o tocando la apertura, no', async () => {
      await assertFails(loteCerrar(MARIA, { liberar: false }).commit());
      await assertFails(loteCerrar(MARIA, { extra: { cerradoPor: '100124' } }).commit());
      await assertFails(loteCerrar(MARIA, { extra: { cierreForzado: true } }).commit());
      await assertFails(loteCerrar(MARIA, { extra: { fondoInicialCentavos: 0 } }).commit());
      await assertFails(loteCerrar(MARIA, { extra: { cerradoEn: Timestamp.fromMillis(Date.now() + 3600_000) } }).commit());
      await assertFails(loteCerrar(MARIA, { extra: { resumen: null } }).commit());
    });
    it('otra cajera no cierra un turno ajeno; un admin sí, marcado como forzado', async () => {
      await assertFails(loteCerrar(LUIS, { cajero: '100123' }).commit());
      await assertFails(loteCerrar(ADMIN, { cajero: '100123', extra: { cierreForzado: false } }).commit());
      await assertSucceeds(loteCerrar(ADMIN, { cajero: '100123' }).commit());
      assert.equal((await leerSinReglas('turnos/t1')).cierreForzado, true);
    });
    it('un turno cerrado no se vuelve a cerrar, pero sus ventas pendientes de sincronizar sí entran', async () => {
      await assertSucceeds(loteCerrar(MARIA).commit());
      await assertFails(loteCerrar(MARIA, { liberar: false }).commit());
      await assertSucceeds(setDoc(doc(contexto(MARIA), 'ventas/tarde'), venta(MARIA)));
    });
  });
});
