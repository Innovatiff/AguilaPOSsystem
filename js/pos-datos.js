/**
 * Datos del POS en Firestore: cajas, turnos, ventas, movimientos de efectivo y
 * autorizaciones. Lo usan la caja (/caja/) y el back office. Las reglas
 * (firestore.rules) exigen que abrir y cerrar turno vayan en un lote junto con
 * la caja, y que cada venta lleve la hora del servidor (registradoEn).
 */
import {
  auth,
  db,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp,
  autenticacionSecundaria,
  signInWithEmailAndPassword,
  signOut,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from './firebase.js';
import { correoDeNip } from './auth.js';
import { configConDefectos, armarConfigPos } from './config-pos.js';
import { usuarioDe } from './identidad.js';

const conId = (instantanea) => ({ id: instantanea.id, ...instantanea.data() });

// ------------------------------------------------------------- configuración, cajas y tiendas

/** config/pos con valores por defecto si aún no existe. */
export async function leerConfigPos() {
  const d = await getDoc(doc(db, 'config', 'pos'));
  return configConDefectos(d.exists() ? d.data() : null);
}

export function observarConfigPos(alCambiar, alFallar) {
  return onSnapshot(doc(db, 'config', 'pos'), (d) => alCambiar(configConDefectos(d.exists() ? d.data() : null), d.exists()), alFallar);
}

/** Guarda config/pos completo (solo administradores; las reglas exigen los campos exactos). */
export function guardarConfigPos(datos, usuario) {
  return setDoc(doc(db, 'config', 'pos'), armarConfigPos(datos, usuario, Timestamp.fromMillis(Date.now())));
}

/** Da de alta una caja libre (solo administradores). */
export function crearCaja(id, { nombre, numero, tienda, activo = true }, usuario) {
  return setDoc(doc(db, 'cajas', id), {
    nombre: String(nombre).trim(),
    numero,
    tienda,
    activo,
    turnoActual: null,
    turnoCajero: null,
    turnoCajeroNombre: null,
    turnoDesde: null,
    actualizadoEn: Timestamp.fromMillis(Date.now()),
    actualizadoPor: usuario,
  });
}

/** Cambia nombre, número, tienda o estado de una caja; los campos del turno no se tocan. */
export function editarCaja(id, { nombre, numero, tienda, activo }, usuario) {
  return updateDoc(doc(db, 'cajas', id), {
    nombre: String(nombre).trim(),
    numero,
    tienda,
    activo,
    actualizadoEn: Timestamp.fromMillis(Date.now()),
    actualizadoPor: usuario,
  });
}

/** Una caja; con `servidor` exige leerla del servidor (falla sin conexión). */
export async function leerCaja(id, { servidor = false } = {}) {
  const ref = doc(db, 'cajas', id);
  const d = servidor ? await getDocFromServer(ref) : await getDoc(ref);
  return d.exists() ? conId(d) : null;
}

/** Todas las cajas, ordenadas por tienda y número. */
export async function listarCajas() {
  const r = await getDocs(collection(db, 'cajas'));
  return r.docs.map(conId).sort((a, b) => a.tienda.localeCompare(b.tienda) || a.numero - b.numero);
}

export async function leerTienda(id) {
  const d = await getDoc(doc(db, 'stores', id));
  return d.exists() ? conId(d) : null;
}

export async function leerTurno(id) {
  const d = await getDoc(doc(db, 'turnos', id));
  return d.exists() ? conId(d) : null;
}

export function observarCaja(id, alCambiar, alFallar) {
  return onSnapshot(doc(db, 'cajas', id), { includeMetadataChanges: true }, (d) => {
    alCambiar(d.exists() ? conId(d) : null, { desdeCache: d.metadata.fromCache, pendiente: d.metadata.hasPendingWrites });
  }, alFallar);
}

/** Todas las cajas, ordenadas por tienda y número. */
export function observarCajas(alCambiar, alFallar) {
  return onSnapshot(collection(db, 'cajas'), (r) => {
    alCambiar(r.docs.map(conId).sort((a, b) => a.tienda.localeCompare(b.tienda) || a.numero - b.numero));
  }, alFallar);
}

export function observarTienda(id, alCambiar, alFallar) {
  return onSnapshot(doc(db, 'stores', id), (d) => alCambiar(d.exists() ? conId(d) : null), alFallar);
}

/** ¿Hay conexión con el servidor de verdad (no solo red local)? Lee la caja sin caché. */
export async function hayServidor(cajaId) {
  try {
    await getDocFromServer(doc(db, 'cajas', cajaId));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- turnos

/** Turnos abiertos de una persona (en cualquier caja). */
export async function turnosAbiertosDe(usuario) {
  const r = await getDocs(query(collection(db, 'turnos'), where('cajero', '==', usuario), where('estado', '==', 'abierto')));
  return r.docs.map(conId);
}

/** Turnos abiertos en este momento (en todas las cajas). */
export function observarTurnosAbiertos(alCambiar, alFallar) {
  return onSnapshot(query(collection(db, 'turnos'), where('estado', '==', 'abierto')), (r) => {
    alCambiar(r.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
  }, alFallar);
}

/** Turnos que se abrieron entre dos fechas (Date; `hasta` excluida), del más antiguo al más reciente. */
export async function leerTurnosEntre(desde, hasta) {
  const r = await getDocs(query(collection(db, 'turnos'),
    where('abiertoEn', '>=', Timestamp.fromDate(desde)), where('abiertoEn', '<', Timestamp.fromDate(hasta)), orderBy('abiertoEn')));
  return r.docs.map(conId);
}

export function observarTurno(id, alCambiar, alFallar) {
  return onSnapshot(doc(db, 'turnos', id), { includeMetadataChanges: true }, (d) => {
    alCambiar(d.exists() ? conId(d) : null, { desdeCache: d.metadata.fromCache, pendiente: d.metadata.hasPendingWrites });
  }, alFallar);
}

/**
 * Abre un turno en la caja, en un lote con la caja (las reglas lo exigen).
 * Necesita conexión: la hora de apertura la pone el servidor.
 * @returns {Promise<string>} id del turno
 */
export async function abrirTurno({ caja, tienda, personal, fondoCentavos }) {
  const ref = doc(collection(db, 'turnos'));
  const lote = writeBatch(db);
  lote.set(ref, {
    caja: caja.id,
    cajaNombre: caja.nombre,
    numeroCaja: caja.numero,
    tienda: caja.tienda,
    tiendaNombre: tienda?.nombre ?? caja.tienda,
    cajero: personal.usuario,
    cajeroNombre: personal.nombre,
    estado: 'abierto',
    abiertoEn: serverTimestamp(),
    fondoInicialCentavos: fondoCentavos,
    cerradoEn: null,
    cerradoPor: null,
    cierreRegistradoEn: null,
    cierreForzado: false,
    efectivoContadoCentavos: null,
    conteo: null,
    diferenciaCentavos: null,
    resumen: null,
    notaCierre: null,
  });
  lote.update(doc(db, 'cajas', caja.id), {
    turnoActual: ref.id,
    turnoCajero: personal.usuario,
    turnoCajeroNombre: personal.nombre,
    turnoDesde: serverTimestamp(),
  });
  await lote.commit();
  return ref.id;
}

/**
 * Cierra el turno y libera la caja en un solo lote. Funciona sin conexión
 * (queda en cola). `quien` es el usuario que cierra (la cajera o un admin).
 * @returns {Promise<void>} se resuelve cuando el servidor confirma
 */
export function cerrarTurno({ turno, resumen, contadoCentavos = null, conteo = null, diferenciaCentavos = null, nota = null, quien }) {
  const lote = writeBatch(db);
  lote.update(doc(db, 'turnos', turno.id), {
    estado: 'cerrado',
    cerradoEn: Timestamp.fromMillis(Date.now()),
    cerradoPor: quien,
    cierreRegistradoEn: serverTimestamp(),
    cierreForzado: quien !== turno.cajero,
    efectivoContadoCentavos: contadoCentavos,
    conteo,
    diferenciaCentavos,
    resumen,
    notaCierre: nota,
  });
  lote.update(doc(db, 'cajas', turno.caja), { turnoActual: null, turnoCajero: null, turnoCajeroNombre: null, turnoDesde: null });
  return lote.commit();
}

// ------------------------------------------------------------- ventas y movimientos

/** Ventas de un turno. Quien no es admin solo puede pedir las suyas (las reglas lo exigen). */
export function observarVentasDeTurno(turnoId, cajero, alCambiar, alFallar) {
  const filtros = [where('turno', '==', turnoId)];
  if (cajero) filtros.push(where('cajero', '==', cajero));
  return onSnapshot(query(collection(db, 'ventas'), ...filtros), { includeMetadataChanges: true }, (r) => {
    const ventas = r.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pendiente: d.metadata.hasPendingWrites }));
    alCambiar(ventas, { pendientes: ventas.filter((v) => v.pendiente).length, desdeCache: r.metadata.fromCache });
  }, alFallar);
}

export function observarMovimientosDeTurno(turnoId, cajero, alCambiar, alFallar) {
  const filtros = [where('turno', '==', turnoId)];
  if (cajero) filtros.push(where('cajero', '==', cajero));
  return onSnapshot(query(collection(db, 'movimientosCaja'), ...filtros), (r) => {
    alCambiar(r.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
  }, alFallar);
}

/** Todas las ventas de un día ("AAAA-MM-DD"), de todas las cajas (solo administradores). */
export function observarVentasDelDia(dia, alCambiar, alFallar) {
  return onSnapshot(query(collection(db, 'ventas'), where('dia', '==', dia)), { includeMetadataChanges: true }, (r) => {
    alCambiar(r.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })), { desdeCache: r.metadata.fromCache });
  }, alFallar);
}

/** Ventas con ese folio (normalmente una; dos si dos cajas repitieran consecutivo). */
export async function buscarVentasPorFolio(folio) {
  const r = await getDocs(query(collection(db, 'ventas'), where('folio', '==', folio)));
  return r.docs.map(conId);
}

/** Ventas y movimientos de un turno leídos del servidor (back office, cierres forzados). */
export async function leerTurnoCompleto(turnoId) {
  const [turno, ventas, movimientos] = await Promise.all([
    getDoc(doc(db, 'turnos', turnoId)),
    getDocs(query(collection(db, 'ventas'), where('turno', '==', turnoId))),
    getDocs(query(collection(db, 'movimientosCaja'), where('turno', '==', turnoId))),
  ]);
  return { turno: turno.exists() ? conId(turno) : null, ventas: ventas.docs.map(conId), movimientos: movimientos.docs.map(conId) };
}

/**
 * Guarda una venta. No espera al servidor: la escritura entra en la cola local
 * al instante (funciona sin conexión) y `promesa` avisa si el servidor la rechaza.
 */
export function guardarVenta(venta) {
  const ref = doc(collection(db, 'ventas'));
  const promesa = setDoc(ref, { ...venta, registradoEn: serverTimestamp() });
  return { id: ref.id, promesa };
}

/** Retiro, entrada, pago desde caja, apertura de cajón o ticket cancelado. */
/**
 * Movimientos en vivo (eventos/): cada acción de la caja conforme ocurre, a
 * nombre de quien la hace. Alimentan la página «Movimientos en vivo» y el
 * historial de auditoría de cada ticket. No se espera al servidor (sin
 * conexión quedan en cola) y un fallo no detiene la venta: son informativos;
 * lo que cuenta para el dinero son ventas, turnos y movimientos de caja.
 */
let ultimoEvento = 0; // la hora de cada movimiento crece siempre: el pago va antes que «venta completada» aunque caigan en el mismo milisegundo

export function registrarEvento({ turno, personal, tipo, texto, importeCentavos = null, ticket = null, folio = null }) {
  if (!turno?.id || !personal?.usuario) return;
  ultimoEvento = Math.max(Date.now(), ultimoEvento + 1);
  const datos = {
    tipo,
    turno: turno.id,
    caja: turno.caja,
    cajaNombre: String(turno.cajaNombre ?? '').slice(0, 40),
    numeroCaja: Number.isInteger(turno.numeroCaja) ? turno.numeroCaja : 0,
    tienda: String(turno.tienda ?? '').slice(0, 40),
    cajero: personal.usuario,
    cajeroNombre: String(personal.nombre ?? '').slice(0, 80),
    ticket: ticket ? String(ticket).slice(0, 40) : null,
    folio: folio ?? null,
    texto: String(texto ?? '').slice(0, 200),
    importeCentavos: Number.isSafeInteger(importeCentavos) ? importeCentavos : null,
    fecha: Timestamp.fromMillis(ultimoEvento),
    registradoEn: serverTimestamp(),
  };
  setDoc(doc(collection(db, 'eventos')), datos).catch((error) => console.warn('No se registró el movimiento en vivo', error?.code ?? error));
}

// ------------------------------------------------------------- back office: movimientos, transacciones

const conDatos = (d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) });
const milisDeFecha = (v) => (typeof v?.toMillis === 'function' ? v.toMillis() : 0);

/**
 * Movimientos en vivo entre dos instantes (Date; `hasta` excluido), los más
 * recientes primero. `limite`: los últimos N (null = todos los del rango).
 * Una sola condición de rango sobre registradoEn: no necesita índice compuesto.
 * `alCambiar(lista, { desdeCache })`: la primera lista puede venir de la caché
 * local; `desdeCache` false dice que ya es la del servidor.
 */
export function observarEventos({ desde, hasta, limite = null }, alCambiar, alFallar) {
  const condiciones = [
    where('registradoEn', '>=', Timestamp.fromDate(desde)),
    where('registradoEn', '<', Timestamp.fromDate(hasta)),
    orderBy('registradoEn', 'desc'),
  ];
  if (limite) condiciones.push(limit(limite));
  return onSnapshot(query(collection(db, 'eventos'), ...condiciones), { includeMetadataChanges: true },
    (r) => alCambiar(r.docs.map(conDatos), { desdeCache: r.metadata.fromCache }), alFallar);
}

/** Los movimientos de un ticket (por su identificador local), en el orden en que ocurrieron. */
export async function eventosDeTicket(ticket) {
  if (!ticket) return [];
  const r = await getDocs(query(collection(db, 'eventos'), where('ticket', '==', ticket)));
  return r.docs.map(conDatos).sort((a, b) => milisDeFecha(a.fecha) - milisDeFecha(b.fecha) || milisDeFecha(a.registradoEn) - milisDeFecha(b.registradoEn));
}

/** Historial de auditoría de una venta o devolución: sus movimientos, localizados por el folio. */
export async function historialDeVenta(folio) {
  const r = await getDocs(query(collection(db, 'eventos'), where('folio', '==', folio)));
  const ticket = r.docs.map((d) => d.data().ticket).find(Boolean);
  return ticket ? eventosDeTicket(ticket) : r.docs.map(conDatos);
}

/**
 * Historial de un ticket cancelado (movimientosCaja tipo cancelacion): el
 * movimiento en vivo «venta cancelada» del mismo turno con el mismo importe y
 * la hora más cercana, y con él todos los del ticket. Dos igualdades: Firestore
 * las resuelve uniendo índices simples.
 */
export async function historialDeCancelacion({ turno, importeCentavos, fecha }) {
  const r = await getDocs(query(collection(db, 'eventos'), where('turno', '==', turno), where('tipo', '==', 'venta_cancelada')));
  const objetivo = milisDeFecha(fecha);
  const candidatos = r.docs.map(conDatos).filter((e) => e.importeCentavos === importeCentavos)
    .sort((a, b) => Math.abs(milisDeFecha(a.fecha) - objetivo) - Math.abs(milisDeFecha(b.fecha) - objetivo));
  return candidatos[0]?.ticket ? eventosDeTicket(candidatos[0].ticket) : [];
}

/** Ventas y devoluciones de un rango de días ("AAAA-MM-DD", ambos incluidos), en vivo. */
export function observarVentasEntre(desde, hasta, alCambiar, alFallar) {
  return onSnapshot(query(collection(db, 'ventas'), where('dia', '>=', desde), where('dia', '<=', hasta)), { includeMetadataChanges: true }, (r) => {
    alCambiar(r.docs.map((d) => ({ ...conDatos(d), pendiente: d.metadata.hasPendingWrites })));
  }, alFallar);
}

/** Tickets cancelados (movimientosCaja tipo cancelacion) registrados entre dos instantes (Date). */
export function observarCancelacionesEntre(desde, hasta, alCambiar, alFallar) {
  return onSnapshot(query(collection(db, 'movimientosCaja'),
    where('registradoEn', '>=', Timestamp.fromDate(desde)), where('registradoEn', '<', Timestamp.fromDate(hasta))), (r) => {
    alCambiar(r.docs.map(conDatos).filter((m) => m.tipo === 'cancelacion'));
  }, alFallar);
}

export function registrarMovimiento({ turno, personal, tipo, importeCentavos = 0, motivo = null }) {
  const ref = doc(collection(db, 'movimientosCaja'));
  const datos = {
    turno: turno.id,
    caja: turno.caja,
    tienda: turno.tienda,
    cajero: personal.usuario,
    cajeroNombre: personal.nombre,
    tipo,
    importeCentavos,
    motivo: motivo ? String(motivo).trim().slice(0, 120) || null : null,
    fecha: Timestamp.fromMillis(Date.now()),
    registradoEn: serverTimestamp(),
  };
  return { id: ref.id, datos, promesa: setDoc(ref, datos) };
}

// ------------------------------------------------------------- NIP y autorizaciones

/** Comprueba el NIP (o contraseña) de quien tiene la sesión, contra Firebase. Necesita conexión. */
export async function comprobarSecretoEnServidor(secreto) {
  const usuario = auth.currentUser;
  if (!usuario?.email) throw Object.assign(new Error('Sin sesión'), { code: 'caja/sin-sesion' });
  await reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, String(secreto)));
}

/**
 * Un administrador autoriza algo en la caja con su NIP (la clave de la caja
 * dice de quién es; js/nip.js), en una sesión aparte que se descarta al
 * terminar: el turno de la cajera sigue abierto. Escribe autorizaciones/{id}
 * con la sesión del administrador. Necesita conexión.
 * @param {{ nip: string, claveCaja: string, tipo: 'modificacion'|'devolucion', turno: object, detalle: string }} datos
 * @returns {Promise<{ id: string, admin: string, nombreAdmin: string }>}
 */
export async function autorizarComoAdmin({ nip, claveCaja, tipo, turno, detalle }) {
  const correo = await correoDeNip(nip, claveCaja);
  const sesion = autenticacionSecundaria({ conFirestore: true });
  try {
    const credencial = await signInWithEmailAndPassword(sesion.auth, correo, String(nip).trim());
    const admin = usuarioDe(credencial.user.email);
    const ficha = await getDoc(doc(sesion.db, 'staff', admin));
    const datos = ficha.exists() ? ficha.data() : null;
    if (!datos || datos.activo !== true || datos.rol !== 'admin') {
      throw Object.assign(new Error('Esa persona no es administradora: no puede autorizar.'), { code: 'caja/no-admin' });
    }
    const ref = doc(collection(sesion.db, 'autorizaciones'));
    await setDoc(ref, {
      tipo,
      turno: turno.id,
      caja: turno.caja,
      cajero: turno.cajero,
      admin,
      fecha: serverTimestamp(),
      detalle: String(detalle ?? '').slice(0, 200),
    });
    return { id: ref.id, admin, nombreAdmin: datos.nombre || admin };
  } finally {
    await signOut(sesion.auth).catch(() => {});
    await sesion.liberar().catch(() => {});
  }
}
