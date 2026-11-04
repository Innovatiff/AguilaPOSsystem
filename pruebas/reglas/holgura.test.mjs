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
  // Con una función: el ancla puede llevar "$'" (una expresión regular), que en un texto de reemplazo es especial.
  const conAncla = REGLAS.replace(ancla, () => `${ancla.replace(/;$/, '')} && relleno();`);
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

/** Lo que manda la caja a la tableta en plena venta (js/pantalla-cliente.js). */
const ESTADO_PANTALLA = {
  v: 1, fase: 'venta', tienda: 'Talbot', caja: 'Caja 1', atiende: 'María', mensaje: '¡Gracias por su compra!', devolucion: false,
  lineas: [{ id: 'l1', nombre: 'TAJIN CLASICO 142g', detalle: '2 × $4.99', importe: '$9.98', antes: null, descuento: null, negativa: false }],
  ocultas: 0, ultima: { id: 'l1', nombre: 'TAJIN CLASICO 142g', detalle: '2 × $4.99', importe: '$9.98', antes: null, descuento: null, negativa: false },
  articulos: 2, subtotal: '$9.98', descuento: null, ahorro: null, impuestoNombre: 'HST 13 %', impuesto: '$1.30', total: '$11.28', totalEfectivo: '$11.30',
};

const ANCLA = {
  venta: 'allow create: if crearVenta(request.resource.data);',
  abrirTurno: 'allow create: if abrirTurno(request.resource.data, turnoId);',
  cerrarTurno: 'allow update: if cerrarTurno(turnoId);',
  caja: 'allow update: if actualizarCaja(cajaId);',
  movimiento: 'allow create: if crearMovimiento(request.resource.data);',
  autorizacion: 'allow create: if crearAutorizacion(request.resource.data);',
  producto: 'allow update: if actualizarProducto(productId);',
  solicitud: 'allow create: if crearSolicitud(request.resource.data);',
  resolver: 'allow update: if resolverSolicitud();',
  nip: 'nipDeFicha(getAfter(/databases/$(database)/documents/staff/$(request.resource.data.codigo)).data, request.resource.data.version);',
  correo: 'getAfter(/databases/$(database)/documents/staff/$(request.resource.data.codigo)).data.correo == correo;',
  evento: 'allow create: if crearEvento(request.resource.data);',
  recepcion: 'allow create: if crearRecepcion(request.resource.data);',
  emparejarPantalla: "allow create: if pantallaId.matches('^[0-9a-f]{64}$') && escribirPantalla(request.resource.data, true);",
  pantalla: 'allow update: if escribirPantalla(request.resource.data, false);',
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
  {
    nombre: 'edición de un producto por el personal del Catálogo',
    ancla: ANCLA.producto,
    datos: {
      'staff/100123': { ...ficha('100123', 'María', 'empleado'), catalogo: true },
      'products/p1': { ...armarProducto({ ...TAJIN, tiendas: ['talbot'] }, '100150'), creadoEn: AHORA, actualizadoEn: AHORA },
    },
    quien: MARIA,
    accion: (db) => setDoc(doc(db, 'products/p1'), { ...armarProducto({ ...TAJIN, nombre: 'Clasico con limon', tiendas: ['talbot'], ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '2026-11-04' }, '100123'), creadoEn: AHORA, actualizadoEn: Timestamp.now() }),
  },
  {
    nombre: 'solicitud de baja desde el Catálogo',
    ancla: ANCLA.solicitud,
    datos: {
      'staff/100123': { ...ficha('100123', 'María', 'empleado'), catalogo: true },
      'products/p1': { ...armarProducto({ ...TAJIN, tiendas: ['talbot'] }, '100150'), creadoEn: AHORA, actualizadoEn: AHORA },
    },
    quien: MARIA,
    accion: (db) => setDoc(doc(db, 'solicitudes/s1'), {
      tipo: 'baja', estado: 'pendiente', producto: null, productoId: 'p1', productoNombre: 'Tajin Clasico', motivo: 'Ya no llega',
      creadaPor: '100123', creadaPorNombre: 'María', creadaEn: serverTimestamp(), resueltaPor: null, resueltaEn: null, nota: null,
    }),
  },
  {
    nombre: 'aprobar un alta: producto con precio y solicitud en un lote',
    ancla: ANCLA.resolver,
    datos: {
      'solicitudes/s1': {
        tipo: 'alta', estado: 'pendiente', productoId: null, productoNombre: 'Maseca', motivo: '',
        producto: { upc: '074734040014', plu: null, nombre: 'Harina de maiz', marca: 'Maseca', descriptor: null, presentacion: '1.8kg', unidadVenta: 'pieza', tiendas: ['talbot'], proveedor: null },
        creadaPor: '100123', creadaPorNombre: 'María', creadaEn: AHORA, resueltaPor: null, resueltaEn: null, nota: null,
      },
    },
    quien: JEFA,
    accion: (db) => {
      const marca = Timestamp.fromMillis(Date.now());
      const lote = writeBatch(db);
      lote.set(doc(db, 'products/nuevo'), { ...armarProducto({ upc: '074734040014', nombre: 'Harina de maiz', marca: 'Maseca', presentacion: '1.8kg', precioCentavos: 549, unidadVenta: 'pieza', claseFiscal: 'tasaCero', tiendas: ['talbot'] }, '100150'), creadoEn: marca, actualizadoEn: marca });
      lote.update(doc(db, 'solicitudes/s1'), { estado: 'aprobada', productoId: 'nuevo', resueltaPor: '100150', resueltaEn: serverTimestamp() });
      return lote.commit();
    },
  },
  {
    nombre: 'movimiento en vivo de la caja',
    ancla: ANCLA.evento,
    datos: conTurno('100123'),
    quien: MARIA,
    accion: (db) => setDoc(doc(db, 'eventos/e1'), {
      tipo: 'pago', turno: 't1', caja: 'c1', cajaNombre: 'Caja 1', numeroCaja: 1, tienda: 'talbot', cajero: '100123', cajeroNombre: 'María',
      ticket: 'tk1', folio: '261104-01-0001', texto: 'Efectivo $18.00 (saldo $0.00)', importeCentavos: 1800, fecha: Timestamp.now(), registradoEn: serverTimestamp(),
    }),
  },
  {
    nombre: 'emparejar la tableta de la pantalla del cliente (admin)',
    ancla: ANCLA.emparejarPantalla,
    datos: {},
    quien: JEFA,
    accion: (db) => setDoc(doc(db, `pantallas/${'a'.repeat(64)}`), { caja: 'c1', cajero: '100150', estado: ESTADO_PANTALLA, actualizadoEn: serverTimestamp() }),
  },
  {
    nombre: 'pantalla del cliente en tableta (la caja la actualiza)',
    ancla: ANCLA.pantalla,
    datos: { [`pantallas/${'a'.repeat(64)}`]: { caja: 'c1', cajero: '100150', estado: { v: 1, fase: 'cerrada' }, actualizadoEn: AHORA } },
    quien: MARIA,
    accion: (db) => setDoc(doc(db, `pantallas/${'a'.repeat(64)}`), { caja: 'c1', cajero: '100123', estado: ESTADO_PANTALLA, actualizadoEn: serverTimestamp() }),
  },
  {
    nombre: 'entrega de mercancía (inventario)',
    ancla: ANCLA.recepcion,
    datos: { 'staff/100123': { ...ficha('100123', 'María', 'empleado'), catalogo: true } },
    quien: MARIA,
    accion: (db) => setDoc(doc(db, 'recepciones/r1'), {
      tienda: 'talbot', proveedor: 'Distribuidora', referencia: 'F-1', nota: null,
      lineas: [{ producto: 'p1', nombre: 'TAJIN', upc: '633148100013', plu: null, cantidad: 24, pesoGramos: null }],
      productos: 1, piezas: 24, gramos: 0, recibidoPor: '100123', recibidoPorNombre: 'María', fecha: serverTimestamp(),
      anulada: false, anuladaPor: null, anuladaEn: null,
    }),
  },
  {
    nombre: 'registrar el NIP de un colaborador (huella y correo)',
    ancla: ANCLA.nip,
    datos: {},
    quien: ADMIN,
    accion: (db) => loteColaborador(db).commit(),
  },
  {
    nombre: 'registrar el correo de un colaborador',
    ancla: ANCLA.correo,
    datos: {},
    quien: ADMIN,
    accion: (db) => loteColaborador(db).commit(),
  },
];

/** Alta completa de un colaborador: ficha, acceso, correo y huella del NIP, en un lote. */
function loteColaborador(db) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'staff/100160'), { ...armarFichaPersonal({ usuario: '100160', nombre: 'Pedro', rol: 'empleado', tienda: 'talbot', correo: 'pedro@aguila.test', catalogo: true }, ADMIN), creadoEn: AHORA, actualizadoEn: AHORA });
  lote.set(doc(db, 'accesos/100160'), { version: 1 });
  lote.set(doc(db, 'correos/pedro@aguila.test'), { codigo: '100160' });
  lote.set(doc(db, `nips/${'c'.repeat(64)}`), { codigo: '100160', version: 1 });
  return lote;
}

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
