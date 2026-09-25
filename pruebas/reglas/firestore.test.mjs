/**
 * Pruebas de las reglas de Firestore contra el emulador.
 * Se ejecutan con: npm test  (firebase emulators:exec … "mocha")
 *
 * Modelo de acceso: entra solo el personal registrado (staff/{usuario} activa).
 * usuario = código de empleado (cuenta "<código>@<dominio sintético>") o correo.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, writeBatch, Timestamp, setLogLevel } from 'firebase/firestore';
import { armarProducto } from '../../js/esquema.js';
import { armarFichaPersonal, correoDeAcceso, usuarioDe, DOMINIO_CODIGOS } from '../../js/identidad.js';

const PROYECTO = 'demo-aguilapos';
// Cuentas (correo de Firebase Auth) de cada actor.
const ADMIN = 'admin@aguila.test'; // ficha completa, tipo correo
const LEGADO = 'legado@aguila.test'; // ficha anterior a Gestión (solo nombre, rol, activo), admin
const ANA = 'ana@aguila.test'; // ficha anterior a Gestión, empleada
const EMPLEADA = correoDeAcceso('1023'); // código 1023, cuenta versión 1
const RENOVADA = correoDeAcceso('1030', 2); // código 1030 tras restablecer el NIP
const CADUCA = correoDeAcceso('1030', 1); // la cuenta anterior del código 1030
const INACTIVO = correoDeAcceso('1099');
const EXTRANO = 'nadie@ejemplo.test'; // autenticado, sin ficha

let entorno;
setLogLevel('silent'); // los rechazos esperados no deben ensuciar la salida

const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();
const AHORA = Timestamp.fromMillis(1_700_000_000_000);

function productoDemo(correoAuth, extra = {}) {
  return {
    ...armarProducto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: ['talbot'] }, usuarioDe(correoAuth)),
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    ...extra,
  };
}

/** Ficha completa de staff/{usuario} escrita por `porCorreoAuth`. */
function fichaDemo(datos, porCorreoAuth = ADMIN, extra = {}) {
  return { ...armarFichaPersonal(datos, usuarioDe(porCorreoAuth)), creadoEn: AHORA, actualizadoEn: AHORA, ...extra };
}

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}

describe('reglas de Firestore', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
  });

  after(async () => {
    await entorno.cleanup();
  });

  beforeEach(async () => {
    await entorno.clearFirestore();
    await sembrar({
      [`staff/${ADMIN}`]: fichaDemo({ usuario: ADMIN, nombre: 'Admin', rol: 'admin', tienda: null }),
      [`staff/${LEGADO}`]: { nombre: 'Legado', rol: 'admin', activo: true },
      [`staff/${ANA}`]: { nombre: 'Ana', rol: 'empleado', activo: true },
      'staff/1023': fichaDemo({ usuario: '1023', nombre: 'María', rol: 'empleado', tienda: 'talbot' }),
      'staff/1030': fichaDemo({ usuario: '1030', nombre: 'Luis', rol: 'empleado', cuentaVersion: 2 }),
      'staff/1099': fichaDemo({ usuario: '1099', nombre: 'Baja', rol: 'empleado', activo: false }),
      'stores/talbot': { nombre: 'Águila Talbot', direccion: 'Talbot St, Leamington', activo: true },
      'products/p1': productoDemo(ADMIN),
    });
  });

  describe('acceso', () => {
    it('sin sesión no se lee nada', async () => {
      const db = anonimo();
      await assertFails(getDoc(doc(db, 'products/p1')));
      await assertFails(getDoc(doc(db, 'stores/talbot')));
      await assertFails(getDoc(doc(db, `staff/${ADMIN}`)));
    });
    it('una cuenta autenticada sin ficha no entra: ni lee ni escribe', async () => {
      const db = contexto(EXTRANO);
      await assertFails(getDoc(doc(db, 'products/p1')));
      await assertFails(getDoc(doc(db, 'stores/talbot')));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EXTRANO)));
      await assertFails(setDoc(doc(db, `staff/${EXTRANO}`), fichaDemo({ usuario: EXTRANO, nombre: 'Yo', rol: 'admin' }, EXTRANO)));
    });
    it('un código de empleado registrado lee productos, tiendas y personal', async () => {
      const db = contexto(EMPLEADA);
      await assertSucceeds(getDoc(doc(db, 'products/p1')));
      await assertSucceeds(getDoc(doc(db, 'stores/talbot')));
      await assertSucceeds(getDoc(doc(db, `staff/${ADMIN}`)));
      await assertSucceeds(getDocs(collection(db, 'staff')));
    });
    it('el personal inactivo no lee productos pero sí su propia ficha', async () => {
      const db = contexto(INACTIVO);
      await assertFails(getDoc(doc(db, 'products/p1')));
      await assertSucceeds(getDoc(doc(db, 'staff/1099')));
      await assertFails(getDoc(doc(db, 'staff/1023')));
    });
    it('tras restablecer el NIP, solo la cuenta nueva del código entra; la anterior solo ve su ficha', async () => {
      await assertSucceeds(getDoc(doc(contexto(RENOVADA), 'products/p1')));
      const caduca = contexto(CADUCA);
      await assertFails(getDoc(doc(caduca, 'products/p1')));
      await assertSucceeds(getDoc(doc(caduca, 'staff/1030')));
    });
    it('las fichas anteriores a Gestión (por correo, sin correoAuth) siguen entrando', async () => {
      await assertSucceeds(getDoc(doc(contexto(ANA), 'products/p1')));
      await assertSucceeds(setDoc(doc(contexto(LEGADO), 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true }));
    });
    it('el correo sintético de un código que no está registrado no entra', async () => {
      await assertFails(getDoc(doc(contexto(correoDeAcceso('4444')), 'products/p1')));
    });
  });

  describe('products · esquema', () => {
    it('una empleada (código) crea un producto válido firmado con su código', async () => {
      const db = contexto(EMPLEADA);
      await assertSucceeds(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA)));
      const guardado = await getDoc(doc(db, 'products/p2'));
      assert.equal(guardado.data().actualizadoPor, '1023');
    });
    it('rechaza un campo que no está en el esquema', async () => {
      await assertFails(setDoc(doc(contexto(EMPLEADA), 'products/p2'), { ...productoDemo(EMPLEADA), color: 'rojo' }));
    });
    it('rechaza un campo que falta', async () => {
      const p = productoDemo(EMPLEADA);
      delete p.tokensBusqueda;
      await assertFails(setDoc(doc(contexto(EMPLEADA), 'products/p2'), p));
    });
    it('rechaza precios flotantes, negativos o cero por pieza', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { precioCentavos: 4.99 })));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { precioCentavos: -1 })));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { precioCentavos: 0 })));
    });
    it('rechaza UPC que no tenga 12 dígitos y acepta null', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { upc: '12345' })));
      await assertSucceeds(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { upc: null })));
    });
    it('rechaza enumeraciones fuera de rango', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { claseFiscal: 'exento' })));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { unidadVenta: 'caja' })));
    });
    it('por peso exige precio por kilo; por pieza lo prohíbe', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { unidadVenta: 'peso', precioPorKgCentavos: null })));
      await assertSucceeds(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { upc: null, unidadVenta: 'peso', precioPorKgCentavos: 1599, precioCentavos: 0 })));
      await assertFails(setDoc(doc(db, 'products/p3'), productoDemo(EMPLEADA, { precioPorKgCentavos: 100 })));
    });
    it('el catálogo no puede fijar existencias ni costo (son del POS)', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { existencias: 5 })));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { costoCentavos: 300 })));
      await assertFails(updateDoc(doc(db, 'products/p1'), { existencias: 5, actualizadoEn: Timestamp.now(), actualizadoPor: '1023' }));
    });
    it('actualizadoPor debe ser el usuario de quien escribe: el código, no el correo sintético ni otro', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(ADMIN)));
      await assertFails(setDoc(doc(db, 'products/p2'), productoDemo(EMPLEADA, { actualizadoPor: EMPLEADA })));
      await assertFails(updateDoc(doc(db, 'products/p1'), { nombre: 'CLASICO GRANDE', actualizadoEn: Timestamp.now() }));
      // por correo real, el usuario es el correo
      await assertSucceeds(updateDoc(doc(contexto(ANA), 'products/p1'), { nombre: 'CLASICO GRANDE', actualizadoEn: Timestamp.now(), actualizadoPor: ANA }));
    });
    it('permite editar campos que no son el precio, con actualizadoEn y actualizadoPor', async () => {
      await assertSucceeds(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), {
        nombre: 'CLASICO GRANDE', tokensBusqueda: ['cla', 'clas'], actualizadoEn: Timestamp.now(), actualizadoPor: '1023',
      }));
    });
    it('marcar la etiqueta como impresa: último precio y fecha ISO, sin tocar el precio', async () => {
      const db = contexto(EMPLEADA);
      await assertSucceeds(updateDoc(doc(db, 'products/p1'), {
        ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '2026-09-24', actualizadoEn: Timestamp.now(), actualizadoPor: '1023',
      }));
      await assertFails(updateDoc(doc(db, 'products/p1'), {
        ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '24/09/2026', actualizadoEn: Timestamp.now(), actualizadoPor: '1023',
      }));
      await assertFails(updateDoc(doc(db, 'products/p1'), {
        ultimoPrecioImpresoCentavos: 4.99, fechaUltimaImpresion: '2026-09-24', actualizadoEn: Timestamp.now(), actualizadoPor: '1023',
      }));
    });
    it('nadie borra productos, ni el admin', async () => {
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'products/p1')));
    });
    it('creadoEn no cambia al actualizar', async () => {
      await assertFails(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), { creadoEn: Timestamp.now(), actualizadoEn: Timestamp.now(), actualizadoPor: '1023' }));
    });
  });

  describe('products · cambio de precio con historial', () => {
    function lotePrecio(db, correoAuth, { nuevo = 549, anterior = 499, idHistorial, fechaHistorial, usuario } = {}) {
      const ahora = Timestamp.fromMillis(Date.now());
      const quien = usuario ?? usuarioDe(correoAuth);
      const lote = writeBatch(db);
      lote.update(doc(db, 'products/p1'), { precioCentavos: nuevo, actualizadoEn: ahora, actualizadoPor: quien });
      lote.set(doc(db, 'priceHistory', idHistorial ?? `p1_${ahora.toMillis()}`), {
        productId: 'p1', precioAnteriorCentavos: anterior, precioNuevoCentavos: nuevo, fecha: fechaHistorial ?? ahora, usuario: quien,
      });
      return lote;
    }

    it('cambiar el precio sin entrada de historial se rechaza', async () => {
      await assertFails(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), { precioCentavos: 549, actualizadoEn: Timestamp.now(), actualizadoPor: '1023' }));
    });
    it('cambiar el precio con su entrada de historial en el mismo lote se acepta y queda firmado con el código', async () => {
      const db = contexto(EMPLEADA);
      await assertSucceeds(lotePrecio(db, EMPLEADA).commit());
      const producto = await getDoc(doc(db, 'products/p1'));
      assert.equal(producto.data().precioCentavos, 549);
      await entorno.withSecurityRulesDisabled(async (ctx) => {
        const entradas = await getDocs(collection(ctx.firestore(), 'priceHistory'));
        assert.equal(entradas.docs[0].data().usuario, '1023');
      });
    });
    it('la entrada de historial debe llevar el usuario de quien escribe', async () => {
      await assertFails(lotePrecio(contexto(EMPLEADA), EMPLEADA, { usuario: EMPLEADA }).commit());
    });
    it('la entrada debe registrar el precio anterior real', async () => {
      await assertFails(lotePrecio(contexto(EMPLEADA), EMPLEADA, { anterior: 100 }).commit());
    });
    it('el id de la entrada debe ser productId_milisegundos de actualizadoEn', async () => {
      await assertFails(lotePrecio(contexto(EMPLEADA), EMPLEADA, { idHistorial: 'p1_otro' }).commit());
    });
    it('no se puede escribir historial suelto, sin cambiar el producto', async () => {
      const db = contexto(EMPLEADA);
      const ahora = Timestamp.fromMillis(Date.now());
      await assertFails(setDoc(doc(db, 'priceHistory', `p1_${ahora.toMillis()}`), {
        productId: 'p1', precioAnteriorCentavos: 499, precioNuevoCentavos: 549, fecha: ahora, usuario: '1023',
      }));
    });
    it('el historial es inmutable, incluso para el admin', async () => {
      await assertSucceeds(lotePrecio(contexto(EMPLEADA), EMPLEADA).commit());
      let idEntrada;
      await entorno.withSecurityRulesDisabled(async (ctx) => {
        const entradas = await getDocs(collection(ctx.firestore(), 'priceHistory'));
        assert.equal(entradas.size, 1);
        idEntrada = entradas.docs[0].id;
      });
      const dbAdmin = contexto(ADMIN);
      await assertFails(updateDoc(doc(dbAdmin, 'priceHistory', idEntrada), { precioNuevoCentavos: 1 }));
      await assertFails(deleteDoc(doc(dbAdmin, 'priceHistory', idEntrada)));
    });
  });

  describe('staff · registro del personal', () => {
    const nueva = (extra = {}, por = ADMIN) => fichaDemo({ usuario: '1050', nombre: 'Nueva', rol: 'empleado', tienda: 'talbot', ...extra }, por);

    it('solo el admin da de alta personal; una empleada no', async () => {
      await assertFails(setDoc(doc(contexto(EMPLEADA), 'staff/1050'), nueva({}, EMPLEADA)));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'staff/1050'), nueva()));
      // y con eso la cuenta del código ya entra
      await assertSucceeds(getDoc(doc(contexto(correoDeAcceso('1050')), 'products/p1')));
    });
    it('la ficha lleva exactamente los campos del esquema', async () => {
      const db = contexto(ADMIN);
      await assertFails(setDoc(doc(db, 'staff/1050'), { ...nueva(), telefono: '1' }));
      const sinTienda = nueva();
      delete sinTienda.tienda;
      await assertFails(setDoc(doc(db, 'staff/1050'), sinTienda));
      await assertFails(setDoc(doc(db, 'staff/1050'), { nombre: 'Nueva', rol: 'empleado', activo: true }));
    });
    it('el correo de la cuenta debe corresponder al código y a su versión', async () => {
      const db = contexto(ADMIN);
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ correoAuth: correoDeAcceso('1051') })));
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ correoAuth: `1050@otro.com` })));
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ correoAuth: correoDeAcceso('1050', 2) })));
      await assertSucceeds(setDoc(doc(db, 'staff/1050'), nueva({ correoAuth: correoDeAcceso('1050', 2), cuentaVersion: 2 })));
    });
    it('el usuario de la ficha es el id del documento y tiene el formato de código o correo', async () => {
      const db = contexto(ADMIN);
      await assertFails(setDoc(doc(db, 'staff/1051'), nueva()));
      await assertFails(setDoc(doc(db, 'staff/12'), fichaDemo({ usuario: '12', nombre: 'Corto', rol: 'empleado' })));
      await assertFails(setDoc(doc(db, 'staff/Nuevo@aguila.test'), fichaDemo({ usuario: 'Nuevo@aguila.test', tipo: 'correo', correoAuth: 'Nuevo@aguila.test', nombre: 'N', rol: 'empleado' })));
      await assertSucceeds(setDoc(doc(db, 'staff/nuevo@aguila.test'), fichaDemo({ usuario: 'nuevo@aguila.test', nombre: 'N', rol: 'empleado' })));
    });
    it('una ficha por correo no puede usar el dominio sintético ni llevar versión', async () => {
      const db = contexto(ADMIN);
      const sintetico = `1060@${DOMINIO_CODIGOS}`;
      await assertFails(setDoc(doc(db, `staff/${sintetico}`), fichaDemo({ usuario: sintetico, tipo: 'correo', correoAuth: sintetico, nombre: 'X', rol: 'empleado' })));
      await assertFails(setDoc(doc(db, 'staff/nuevo@aguila.test'), fichaDemo({ usuario: 'nuevo@aguila.test', nombre: 'N', rol: 'empleado', cuentaVersion: 2, correoAuth: 'nuevo@aguila.test' })));
    });
    it('valida rol, tienda, nombre y quién actualiza', async () => {
      const db = contexto(ADMIN);
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ rol: 'gerente' })));
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ tienda: 'Talbot St' })));
      await assertFails(setDoc(doc(db, 'staff/1050'), nueva({ nombre: '' })));
      await assertFails(setDoc(doc(db, 'staff/1050'), { ...nueva(), actualizadoPor: '1023' }));
      await assertFails(setDoc(doc(db, 'staff/1050'), { ...nueva(), creadoEn: Timestamp.fromMillis(1) }));
      await assertSucceeds(setDoc(doc(db, 'staff/1050'), nueva({ tienda: null })));
    });
    it('al actualizar no cambian creadoEn ni tipo, y la versión de cuenta no baja', async () => {
      const db = contexto(ADMIN);
      const actual = fichaDemo({ usuario: '1030', nombre: 'Luis', rol: 'empleado', cuentaVersion: 2 });
      const cambio = (extra) => ({ ...actual, ...extra, actualizadoEn: Timestamp.now() });
      await assertSucceeds(setDoc(doc(db, 'staff/1030'), cambio({ nombre: 'Luis Pérez' })));
      await assertFails(setDoc(doc(db, 'staff/1030'), cambio({ creadoEn: Timestamp.now() })));
      await assertFails(setDoc(doc(db, 'staff/1030'), cambio({ tipo: 'correo', correoAuth: '1030@aguila.test', cuentaVersion: 1 })));
      await assertFails(setDoc(doc(db, 'staff/1030'), cambio({ correoAuth: correoDeAcceso('1030', 1), cuentaVersion: 1 })));
      await assertSucceeds(setDoc(doc(db, 'staff/1030'), cambio({ activo: false })));
      await assertSucceeds(setDoc(doc(db, 'staff/1030'), cambio({ correoAuth: correoDeAcceso('1030', 3), cuentaVersion: 3 })));
      // con la versión 3 guardada, una escritura con la 2 ya no pasa
      await assertFails(setDoc(doc(db, 'staff/1030'), cambio({ activo: true })));
    });
    it('un admin no puede desactivarse, degradarse ni cambiar su propia cuenta; a otros sí', async () => {
      const db = contexto(ADMIN);
      const propia = fichaDemo({ usuario: ADMIN, nombre: 'Admin', rol: 'admin' });
      await assertFails(setDoc(doc(db, `staff/${ADMIN}`), { ...propia, activo: false }));
      await assertFails(setDoc(doc(db, `staff/${ADMIN}`), { ...propia, rol: 'empleado' }));
      await assertSucceeds(setDoc(doc(db, `staff/${ADMIN}`), { ...propia, nombre: 'Admin Renombrado' }));
      await assertSucceeds(setDoc(doc(db, 'staff/1023'), fichaDemo({ usuario: '1023', nombre: 'María', rol: 'admin', tienda: 'talbot' })));
      await assertSucceeds(setDoc(doc(db, 'staff/1023'), fichaDemo({ usuario: '1023', nombre: 'María', rol: 'empleado', tienda: 'talbot', activo: false })));
    });
    it('un admin con ficha anterior a Gestión la completa (también la suya) y sigue entrando', async () => {
      const db = contexto(LEGADO);
      await assertSucceeds(setDoc(doc(db, `staff/${LEGADO}`), fichaDemo({ usuario: LEGADO, nombre: 'Legado', rol: 'admin' }, LEGADO)));
      await assertSucceeds(setDoc(doc(db, `staff/${ANA}`), fichaDemo({ usuario: ANA, nombre: 'Ana', rol: 'empleado' }, LEGADO)));
      await assertSucceeds(getDoc(doc(db, 'products/p1')));
      await assertSucceeds(getDoc(doc(contexto(ANA), 'products/p1')));
      // pero no puede completarla desactivándose
      await assertFails(setDoc(doc(db, `staff/${LEGADO}`), fichaDemo({ usuario: LEGADO, nombre: 'Legado', rol: 'empleado' }, LEGADO)));
    });
    it('una empleada no puede tocar su propia ficha ni la de nadie', async () => {
      const db = contexto(EMPLEADA);
      await assertFails(setDoc(doc(db, 'staff/1023'), fichaDemo({ usuario: '1023', nombre: 'María', rol: 'admin' }, EMPLEADA)));
      await assertFails(updateDoc(doc(db, 'staff/1099'), { activo: true }));
    });
    it('el personal no se borra', async () => {
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'staff/1023')));
    });
  });

  describe('accesos · versión de cuenta de un código', () => {
    const marca = () => Timestamp.fromMillis(Date.now());
    it('cualquiera puede leer un acceso concreto, nadie puede listarlos', async () => {
      await sembrar({ 'accesos/1030': { version: 2 } });
      await assertSucceeds(getDoc(doc(anonimo(), 'accesos/1030')));
      await assertFails(getDocs(collection(anonimo(), 'accesos')));
      await assertFails(getDocs(collection(contexto(ADMIN), 'accesos')));
    });
    it('el admin lo escribe junto con la ficha, con la misma versión', async () => {
      const db = contexto(ADMIN);
      const nueva = fichaDemo({ usuario: '1050', nombre: 'Nueva', rol: 'empleado' });
      const lote = writeBatch(db);
      lote.set(doc(db, 'staff/1050'), nueva);
      lote.set(doc(db, 'accesos/1050'), { version: 1 });
      await assertSucceeds(lote.commit());
      const renovada = { ...nueva, correoAuth: correoDeAcceso('1050', 2), cuentaVersion: 2, actualizadoEn: marca() };
      const lote2 = writeBatch(db);
      lote2.set(doc(db, 'staff/1050'), renovada);
      lote2.set(doc(db, 'accesos/1050'), { version: 2 });
      await assertSucceeds(lote2.commit());
    });
    it('se rechaza suelto, con otra versión que la ficha, con campos de más o por una empleada', async () => {
      await assertFails(setDoc(doc(contexto(ADMIN), 'accesos/1023'), { version: 2 }));
      await assertFails(setDoc(doc(contexto(ADMIN), 'accesos/1023'), { version: 1, correo: 'x' }));
      await assertFails(setDoc(doc(contexto(EMPLEADA), 'accesos/1023'), { version: 1 }));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'accesos/1023'), { version: 1 }));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'accesos/1023')));
    });
  });

  describe('stores', () => {
    it('solo el admin escribe tiendas, con identificador en minúsculas y guiones', async () => {
      await assertFails(setDoc(doc(contexto(EMPLEADA), 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true }));
      await assertSucceeds(setDoc(doc(contexto(ADMIN), 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true }));
      await assertFails(setDoc(doc(contexto(ADMIN), 'stores/Erie Sur'), { nombre: 'Águila Erie', direccion: '', activo: true }));
      await assertFails(setDoc(doc(contexto(ADMIN), 'stores/erie2'), { nombre: 'Águila Erie', activo: true }));
      await assertFails(deleteDoc(doc(contexto(ADMIN), 'stores/talbot')));
    });
  });
});
