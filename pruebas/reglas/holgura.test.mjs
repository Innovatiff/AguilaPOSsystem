/**
 * Holgura de las reglas: Firestore corta la evaluación de una petición tras un
 * número fijo de expresiones (y un argumento de función se reevalúa en cada
 * uso). Una regla que funciona hoy puede empezar a rechazar ventas legítimas
 * si se le añaden comprobaciones. Esta prueba mete comparaciones de relleno en
 * cada regla crítica hasta que la escritura falla, y exige un margen mínimo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, Timestamp, serverTimestamp, setLogLevel } from 'firebase/firestore';
import { armarFichaPersonal, correoDeAcceso, usuarioDe } from '../../js/identidad.js';
import { armarProducto } from '../../js/esquema.js';
import { lineaDeProducto, calcularTicket, registrarPago, armarVenta } from '../../js/ticket.js';

setLogLevel('silent');
const REGLAS = readFileSync('firestore.rules', 'utf8');
const ADMIN = 'admin@aguila.test';
const MARIA = correoDeAcceso('100123');
const JEFA = correoDeAcceso('100150');
const COMPARACIONES_POR_BLOQUE = 5;
const MAXIMO_BLOQUES = 60;
const HOLGURA_MINIMA = 8; // bloques de 5 comparaciones (40) que deben caber además de la regla

const bloques = Array.from({ length: MAXIMO_BLOQUES }, (_, k) => `    function relleno${k}() { return ${Array.from({ length: COMPARACIONES_POR_BLOQUE }, () => 'request.time != null').join(' && ')}; }`).join('\n');

/** Reglas con `&& relleno()` añadido a la condición que termina en `ancla`. */
function reglasConRelleno(ancla, cantidad) {
  assert.ok(REGLAS.includes(ancla), `No encuentro el ancla en firestore.rules: ${ancla}`);
  const cuerpo = cantidad === 0 ? 'true' : Array.from({ length: cantidad }, (_, k) => `relleno${k}()`).join(' && ');
  const conAncla = REGLAS.replace(ancla, `${ancla.replace(/;$/, '')} && relleno();`);
  return conAncla.replace('match /databases/{database}/documents {', `match /databases/{database}/documents {\n    function relleno() { return ${cuerpo}; }\n${bloques}\n`);
}

const AHORA = Timestamp.fromMillis(1_700_000_000_000);
const ficha = (usuario, nombre, rol) => ({ ...armarFichaPersonal({ usuario, nombre, rol, tienda: 'talbot' }, ADMIN), creadoEn: AHORA, actualizadoEn: AHORA });
const caja = (extra = {}) => ({
  nombre: 'Caja 1', numero: 1, tienda: 'talbot', activo: true,
  turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null, actualizadoEn: AHORA, actualizadoPor: ADMIN, ...extra,
});
const turnoAbierto = (cajero) => ({
  caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1, tienda: 'talbot', tiendaNombre: 'Talbot', cajero, cajeroNombre: cajero,
  estado: 'abierto', abiertoEn: Timestamp.fromMillis(Date.now() - 60_000), fondoInicialCentavos: 15000,
  cerradoEn: null, cerradoPor: null, cierreRegistradoEn: null, cierreForzado: false,
  efectivoContadoCentavos: null, conteo: null, diferenciaCentavos: null, resumen: null, notaCierre: null,
});
const TAJIN = { id: 'p1', upc: '633148100013', nombre: 'Clasico', marca: 'Tajin', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado' };

function venta(email, { cantidad = 2, descuentoTicket = null, tipo, extra = {} } = {}) {
  const calculo = calcularTicket([lineaDeProducto(TAJIN, { cantidad })], { descuentoTicket });
  const { pago } = registrarPago(calculo.totalCentavos, [], { metodo: 'efectivo', montoCentavos: cantidad > 0 ? 2000 : 0 });
  const usuario = usuarioDe(email);
  return {
    ...armarVenta(calculo, [pago], {
      folio: '261102-01-0001', numero: 1, dia: '2026-11-02', tipo, turno: 't1', caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1,
      tienda: 'talbot', tiendaNombre: 'Talbot', cajero: usuario, cajeroNombre: usuario, fecha: Timestamp.now(),
    }),
    registradoEn: serverTimestamp(),
    ...extra,
  };
}

const conTurno = (cajero) => ({ 'turnos/t1': turnoAbierto(cajero), 'cajas/c1': caja({ turnoActual: 't1', turnoCajero: cajero, turnoCajeroNombre: cajero, turnoDesde: AHORA }) });
const autorizacion = (tipo) => ({ tipo, turno: 't1', caja: 'c1', cajero: '100123', admin: '100150', fecha: AHORA, detalle: 'x' });

function loteAbrir(db) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'turnos/t1'), { ...turnoAbierto('100123'), abiertoEn: serverTimestamp() });
  lote.update(doc(db, 'cajas/c1'), { turnoActual: 't1', turnoCajero: '100123', turnoCajeroNombre: '100123', turnoDesde: serverTimestamp() });
  return lote;
}
function loteCerrar(db, quien) {
  const lote = writeBatch(db);
  lote.update(doc(db, 'turnos/t1'), {
    estado: 'cerrado', cerradoEn: Timestamp.now(), cerradoPor: quien, cierreRegistradoEn: serverTimestamp(), cierreForzado: quien !== '100123',
    efectivoContadoCentavos: 15000, conteo: { 10000: 1, 5000: 1 }, diferenciaCentavos: 0, resumen: { ventas: 0 }, notaCierre: null,
  });
  lote.update(doc(db, 'cajas/c1'), { turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null });
  return lote;
}

const ANCLA = {
  venta: 'allow create: if crearVenta(request.resource.data);',
  abrirTurno: 'allow create: if abrirTurno(request.resource.data, turnoId);',
  cerrarTurno: 'allow update: if cerrarTurno(turnoId);',
  caja: 'allow update: if actualizarCaja(cajaId);',
  movimiento: 'allow create: if crearMovimiento(request.resource.data);',
  autorizacion: 'allow create: if crearAutorizacion(request.resource.data);',
  producto: 'existsAfter(/databases/$(database)/documents/priceHistory/$(idHistorial(productId, request.resource.data))));',
  historial: 'allow create: if esAdmin() && entradaHistorialValida(request.resource.data, entradaId);',
};

const ESCENARIOS = [
  { nombre: 'venta en efectivo de la cajera', ancla: ANCLA.venta, datos: conTurno('100123'), quien: MARIA, accion: (db) => setDoc(doc(db, 'ventas/v1'), venta(MARIA)) },
  { nombre: 'venta con descuento autorizado', ancla: ANCLA.venta, datos: { ...conTurno('100123'), 'autorizaciones/a1': autorizacion('modificacion') }, quien: MARIA, accion: (db) => setDoc(doc(db, 'ventas/v1'), venta(MARIA, { descuentoTicket: { tipo: 'porcentaje', puntosBase: 1000 }, extra: { autorizacion: 'a1', autorizadoPor: '100150' } })) },
  { nombre: 'devolución autorizada', ancla: ANCLA.venta, datos: { ...conTurno('100123'), 'autorizaciones/a1': autorizacion('devolucion') }, quien: MARIA, accion: (db) => setDoc(doc(db, 'ventas/v1'), venta(MARIA, { cantidad: -1, tipo: 'devolucion', extra: { autorizacion: 'a1', autorizadoPor: '100150' } })) },
  { nombre: 'venta del admin con descuento', ancla: ANCLA.venta, datos: conTurno('100150'), quien: JEFA, accion: (db) => setDoc(doc(db, 'ventas/v1'), venta(JEFA, { descuentoTicket: { tipo: 'porcentaje', puntosBase: 1000 } })) },
  { nombre: 'abrir turno (turno)', ancla: ANCLA.abrirTurno, datos: {}, quien: MARIA, accion: (db) => loteAbrir(db).commit() },
  { nombre: 'abrir turno (caja)', ancla: ANCLA.caja, datos: {}, quien: MARIA, accion: (db) => loteAbrir(db).commit() },
  { nombre: 'cerrar turno (turno)', ancla: ANCLA.cerrarTurno, datos: conTurno('100123'), quien: MARIA, accion: (db) => loteCerrar(db, '100123').commit() },
  { nombre: 'cerrar turno (caja)', ancla: ANCLA.caja, datos: conTurno('100123'), quien: MARIA, accion: (db) => loteCerrar(db, '100123').commit() },
  { nombre: 'cierre forzado por un admin', ancla: ANCLA.cerrarTurno, datos: conTurno('100123'), quien: JEFA, accion: (db) => loteCerrar(db, '100150').commit() },
  { nombre: 'retiro de efectivo', ancla: ANCLA.movimiento, datos: conTurno('100123'), quien: MARIA, accion: (db) => setDoc(doc(db, 'movimientosCaja/m1'), { turno: 't1', caja: 'c1', tienda: 'talbot', cajero: '100123', cajeroNombre: 'María', tipo: 'retiro', importeCentavos: 10000, motivo: null, fecha: Timestamp.now(), registradoEn: serverTimestamp() }) },
  { nombre: 'autorización de un admin', ancla: ANCLA.autorizacion, datos: conTurno('100123'), quien: JEFA, accion: (db) => setDoc(doc(db, 'autorizaciones/a1'), { ...autorizacion('modificacion'), fecha: serverTimestamp() }) },
  {
    nombre: 'cambio de precio con historial',
    ancla: ANCLA.producto,
    datos: { 'products/p1': { ...armarProducto({ ...TAJIN, tiendas: ['talbot'] }, '100150'), creadoEn: AHORA, actualizadoEn: AHORA } },
    quien: JEFA,
    accion: (db) => {
      const marca = Timestamp.fromMillis(Date.now());
      const lote = writeBatch(db);
      lote.update(doc(db, 'products/p1'), { precioCentavos: 549, actualizadoEn: marca, actualizadoPor: '100150' });
      lote.set(doc(db, `priceHistory/p1_${marca.toMillis()}`), { productId: 'p1', precioAnteriorCentavos: 499, precioNuevoCentavos: 549, fecha: marca, usuario: '100150' });
      return lote.commit();
    },
  },
];

async function pasa(escenario, cantidad) {
  const entorno = await initializeTestEnvironment({ projectId: 'demo-holgura', firestore: { rules: reglasConRelleno(escenario.ancla, cantidad) } });
  try {
    await entorno.clearFirestore(); // cada intento empieza de cero: un "create" repetido sería un "update"
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const base = {
        [`staff/${ADMIN}`]: ficha(ADMIN, 'Admin', 'admin'),
        'staff/100123': ficha('100123', 'María', 'empleado'),
        'staff/100150': ficha('100150', 'Jefa', 'admin'),
        'stores/talbot': { nombre: 'Talbot', direccion: '', activo: true },
        'cajas/c1': caja(),
        ...escenario.datos,
      };
      for (const [ruta, valor] of Object.entries(base)) await setDoc(doc(db, ruta), valor);
    });
    const db = entorno.authenticatedContext(escenario.quien.replace(/[^a-z0-9]/g, '-'), { email: escenario.quien, email_verified: true }).firestore();
    await escenario.accion(db);
    return true;
  } catch {
    return false;
  } finally {
    await entorno.cleanup();
  }
}

describe('holgura de las reglas (tope de expresiones por petición)', function () {
  this.timeout(300000);
  for (const escenario of ESCENARIOS) {
    it(`${escenario.nombre}: deja margen`, async () => {
      assert.ok(await pasa(escenario, 0), 'la escritura debe pasar sin relleno');
      let bajo = 0;
      let alto = MAXIMO_BLOQUES;
      while (bajo < alto) {
        const medio = Math.ceil((bajo + alto) / 2);
        if (await pasa(escenario, medio)) bajo = medio;
        else alto = medio - 1;
      }
      console.log(`      holgura: ${bajo * COMPARACIONES_POR_BLOQUE} comparaciones`);
      assert.ok(bajo >= HOLGURA_MINIMA, `queda poco margen (${bajo * COMPARACIONES_POR_BLOQUE} comparaciones): simplifica la regla`);
    });
  }
});
