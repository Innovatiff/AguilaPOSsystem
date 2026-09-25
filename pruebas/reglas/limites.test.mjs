/**
 * Límite de llamadas get()/exists() por lote (documentado: 20 por lote).
 * Comprueba cuántas operaciones caben en un solo writeBatch con estas reglas.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, Timestamp, setLogLevel } from 'firebase/firestore';
import { armarProducto } from '../../js/esquema.js';
import { armarFichaPersonal, correoDeAcceso } from '../../js/identidad.js';

const PRODUCTOS_POR_LOTE_IMPORTACION = 12; // debe coincidir con js/productos.js

setLogLevel('silent');
const CODIGO = '1001'; // empleada por código; actualizadoPor lleva el código
const EMPLEADA = correoDeAcceso(CODIGO);
let entorno;
const contexto = (email) => entorno.authenticatedContext(email.replace(/[^a-z0-9]/g, '-'), { email, email_verified: true }).firestore();

function productoDemo(i) {
  const ahora = Timestamp.fromMillis(1_700_000_000_000);
  return { ...armarProducto({ upc: null, nombre: `PRODUCTO ${i}`, marca: null, presentacion: '', precioCentavos: 100 + i, unidadVenta: 'pieza', claseFiscal: 'gravado', tiendas: [] }, CODIGO), creadoEn: ahora, actualizadoEn: ahora };
}

describe('límites por lote', () => {
  before(async () => {
    entorno = await initializeTestEnvironment({ projectId: 'demo-aguilapos', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  });
  after(async () => entorno.cleanup());
  beforeEach(async () => {
    await entorno.clearFirestore();
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const ahora = Timestamp.fromMillis(1_700_000_000_000);
      await setDoc(doc(db, `staff/${CODIGO}`), { ...armarFichaPersonal({ usuario: CODIGO, nombre: 'Ana', rol: 'empleado' }, 'admin@aguila.test'), creadoEn: ahora, actualizadoEn: ahora });
      for (let i = 0; i < 60; i += 1) await setDoc(doc(db, `products/p${i}`), productoDemo(i));
    });
  });

  async function loteActualizaciones(n) {
    const db = contexto(EMPLEADA);
    const lote = writeBatch(db);
    const marca = Timestamp.fromMillis(Date.now());
    for (let i = 0; i < n; i += 1) lote.update(doc(db, `products/p${i}`), { ultimoPrecioImpresoCentavos: 100 + i, fechaUltimaImpresion: '2026-09-24', actualizadoEn: marca, actualizadoPor: CODIGO });
    return lote.commit();
  }

  async function lotePrecios(n) {
    const db = contexto(EMPLEADA);
    const lote = writeBatch(db);
    const marca = Timestamp.fromMillis(Date.now());
    for (let i = 0; i < n; i += 1) {
      lote.update(doc(db, `products/p${i}`), { precioCentavos: 900 + i, actualizadoEn: marca, actualizadoPor: CODIGO });
      lote.set(doc(db, 'priceHistory', `p${i}_${marca.toMillis()}`), { productId: `p${i}`, precioAnteriorCentavos: 100 + i, precioNuevoCentavos: 900 + i, fecha: marca, usuario: CODIGO });
    }
    return lote.commit();
  }

  describe('límites de acceso a documentos por lote (emulador)', () => {
    it('las lecturas repetidas de la ficha de personal se cuentan una vez: 60 marcados en un lote', async () => {
      await assertSucceeds(loteActualizaciones(60));
    });
    it(`cada cambio de precio cuesta una lectura: ${PRODUCTOS_POR_LOTE_IMPORTACION} por lote pasan`, async () => {
      await assertSucceeds(lotePrecios(PRODUCTOS_POR_LOTE_IMPORTACION));
    });
    it('y 25 cambios de precio en un lote se rechazan (límite de 20 lecturas)', async () => {
      await assertFails(lotePrecios(25));
    });
  });
});
