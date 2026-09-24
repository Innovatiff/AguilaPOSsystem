/**
 * Pruebas de las reglas de Firestore contra el emulador.
 * Se ejecutan con: npm test  (firebase emulators:exec … "mocha")
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, writeBatch, Timestamp, setLogLevel } from 'firebase/firestore';
import { armarProducto } from '../../js/esquema.js';

const PROYECTO = 'demo-aguilapos';
const ADMIN = 'admin@aguila.test';
const EMPLEADA = 'ana@aguila.test';
const INACTIVO = 'baja@aguila.test';
const EXTRANO = 'nadie@ejemplo.test';

let entorno;
setLogLevel('silent'); // los rechazos esperados no deben ensuciar la salida

const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

function productoDemo(email, extra = {}) {
  const ahora = Timestamp.fromMillis(1_700_000_000_000);
  return {
    ...armarProducto({ upc: '633148100013', nombre: 'CLASICO', marca: 'TAJIN', presentacion: '142g', precioCentavos: 499, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: ['talbot'] }, email),
    creadoEn: ahora,
    actualizadoEn: ahora,
    ...extra,
  };
}

async function sembrar(datos) {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [ruta, valor] of Object.entries(datos)) await setDoc(doc(db, ruta), valor);
  });
}

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
    [`staff/${ADMIN}`]: { nombre: 'Admin', rol: 'admin', activo: true },
    [`staff/${EMPLEADA}`]: { nombre: 'Ana', rol: 'empleado', activo: true },
    [`staff/${INACTIVO}`]: { nombre: 'Baja', rol: 'empleado', activo: false },
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
  it('una cuenta autenticada sin ficha entra como empleado: lee y escribe productos', async () => {
    const db = contexto(EXTRANO);
    await assertSucceeds(getDoc(doc(db, 'products/p1')));
    await assertSucceeds(setDoc(doc(db, 'products/p2'), productoDemo(EXTRANO)));
  });
  it('una cuenta sin ficha no es admin: no escribe personal ni tiendas', async () => {
    const db = contexto(EXTRANO);
    await assertFails(setDoc(doc(db, `staff/${EXTRANO}`), { nombre: 'Yo', rol: 'admin', activo: true }));
    await assertFails(setDoc(doc(db, 'stores/otra'), { nombre: 'Otra', direccion: '', activo: true }));
  });
  it('el personal inactivo no lee productos pero sí su propia ficha', async () => {
    const db = contexto(INACTIVO);
    await assertFails(getDoc(doc(db, 'products/p1')));
    await assertSucceeds(getDoc(doc(db, `staff/${INACTIVO}`)));
  });
  it('el personal activo lee productos, tiendas y personal', async () => {
    const db = contexto(EMPLEADA);
    await assertSucceeds(getDoc(doc(db, 'products/p1')));
    await assertSucceeds(getDoc(doc(db, 'stores/talbot')));
    await assertSucceeds(getDoc(doc(db, `staff/${ADMIN}`)));
  });
});

describe('products · esquema', () => {
  it('una empleada crea un producto válido', async () => {
    await assertSucceeds(setDoc(doc(contexto(EMPLEADA), 'products/p2'), productoDemo(EMPLEADA)));
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
    await assertFails(updateDoc(doc(db, 'products/p1'), { existencias: 5, actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA }));
  });
  it('actualizadoPor debe ser el correo de quien escribe', async () => {
    await assertFails(setDoc(doc(contexto(EMPLEADA), 'products/p2'), productoDemo(ADMIN)));
    await assertFails(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), { nombre: 'CLASICO GRANDE', actualizadoEn: Timestamp.now() }));
  });
  it('permite editar campos que no son el precio, con actualizadoEn y actualizadoPor', async () => {
    await assertSucceeds(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), {
      nombre: 'CLASICO GRANDE', tokensBusqueda: ['cla', 'clas'], actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA,
    }));
  });
  it('marcar la etiqueta como impresa: último precio y fecha ISO, sin tocar el precio', async () => {
    const db = contexto(EMPLEADA);
    await assertSucceeds(updateDoc(doc(db, 'products/p1'), {
      ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '2026-09-24', actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA,
    }));
    await assertFails(updateDoc(doc(db, 'products/p1'), {
      ultimoPrecioImpresoCentavos: 499, fechaUltimaImpresion: '24/09/2026', actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA,
    }));
    await assertFails(updateDoc(doc(db, 'products/p1'), {
      ultimoPrecioImpresoCentavos: 4.99, fechaUltimaImpresion: '2026-09-24', actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA,
    }));
  });
  it('nadie borra productos, ni el admin', async () => {
    await assertFails(deleteDoc(doc(contexto(ADMIN), 'products/p1')));
  });
  it('creadoEn no cambia al actualizar', async () => {
    await assertFails(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), { creadoEn: Timestamp.now(), actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA }));
  });
});

describe('products · cambio de precio con historial', () => {
  function lotePrecio(db, email, { nuevo = 549, anterior = 499, idHistorial, fechaHistorial } = {}) {
    const ahora = Timestamp.fromMillis(Date.now());
    const lote = writeBatch(db);
    lote.update(doc(db, 'products/p1'), { precioCentavos: nuevo, actualizadoEn: ahora, actualizadoPor: email });
    lote.set(doc(db, 'priceHistory', idHistorial ?? `p1_${ahora.toMillis()}`), {
      productId: 'p1', precioAnteriorCentavos: anterior, precioNuevoCentavos: nuevo, fecha: fechaHistorial ?? ahora, usuario: email,
    });
    return lote;
  }

  it('cambiar el precio sin entrada de historial se rechaza', async () => {
    await assertFails(updateDoc(doc(contexto(EMPLEADA), 'products/p1'), { precioCentavos: 549, actualizadoEn: Timestamp.now(), actualizadoPor: EMPLEADA }));
  });
  it('cambiar el precio con su entrada de historial en el mismo lote se acepta', async () => {
    const db = contexto(EMPLEADA);
    await assertSucceeds(lotePrecio(db, EMPLEADA).commit());
    const producto = await getDoc(doc(db, 'products/p1'));
    assert.equal(producto.data().precioCentavos, 549);
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
      productId: 'p1', precioAnteriorCentavos: 499, precioNuevoCentavos: 549, fecha: ahora, usuario: EMPLEADA,
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

describe('staff y stores', () => {
  it('solo el admin da de alta personal, con correo en minúsculas', async () => {
    await assertFails(setDoc(doc(contexto(EMPLEADA), 'staff/nuevo@aguila.test'), { nombre: 'Nuevo', rol: 'empleado', activo: true }));
    await assertSucceeds(setDoc(doc(contexto(ADMIN), 'staff/nuevo@aguila.test'), { nombre: 'Nuevo', rol: 'empleado', activo: true }));
    await assertFails(setDoc(doc(contexto(ADMIN), 'staff/Otro@aguila.test'), { nombre: 'Otro', rol: 'empleado', activo: true }));
  });
  it('la ficha de personal tiene exactamente nombre, rol y activo, con rol válido', async () => {
    const db = contexto(ADMIN);
    await assertFails(setDoc(doc(db, 'staff/x@aguila.test'), { nombre: 'X', rol: 'gerente', activo: true }));
    await assertFails(setDoc(doc(db, 'staff/x@aguila.test'), { nombre: 'X', rol: 'empleado', activo: true, telefono: '1' }));
  });
  it('un admin no puede desactivarse ni degradarse a sí mismo, pero sí a otros', async () => {
    const db = contexto(ADMIN);
    await assertFails(setDoc(doc(db, `staff/${ADMIN}`), { nombre: 'Admin', rol: 'admin', activo: false }));
    await assertFails(setDoc(doc(db, `staff/${ADMIN}`), { nombre: 'Admin', rol: 'empleado', activo: true }));
    await assertSucceeds(setDoc(doc(db, `staff/${EMPLEADA}`), { nombre: 'Ana', rol: 'empleado', activo: false }));
  });
  it('un admin sí puede corregir su propia ficha si sigue activo y admin', async () => {
    await assertSucceeds(setDoc(doc(contexto(ADMIN), `staff/${ADMIN}`), { nombre: 'Admin Renombrado', rol: 'admin', activo: true }));
  });
  it('una empleada no puede tocar su propia ficha', async () => {
    await assertFails(setDoc(doc(contexto(EMPLEADA), `staff/${EMPLEADA}`), { nombre: 'Ana', rol: 'admin', activo: true }));
  });
  it('el personal no se borra', async () => {
    await assertFails(deleteDoc(doc(contexto(ADMIN), `staff/${EMPLEADA}`)));
  });
  it('solo el admin escribe tiendas, con identificador en minúsculas y guiones', async () => {
    await assertFails(setDoc(doc(contexto(EMPLEADA), 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true }));
    await assertSucceeds(setDoc(doc(contexto(ADMIN), 'stores/erie'), { nombre: 'Águila Erie', direccion: '', activo: true }));
    await assertFails(setDoc(doc(contexto(ADMIN), 'stores/Erie Sur'), { nombre: 'Águila Erie', direccion: '', activo: true }));
    await assertFails(setDoc(doc(contexto(ADMIN), 'stores/erie2'), { nombre: 'Águila Erie', activo: true }));
    await assertFails(deleteDoc(doc(contexto(ADMIN), 'stores/talbot')));
  });
});
