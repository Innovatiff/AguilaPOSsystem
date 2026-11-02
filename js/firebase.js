/**
 * Único punto de contacto con el SDK de Firebase.
 * - El SDK está vendido localmente en vendor/firebase/<versión>/ (sin CDN).
 * - Firestore con caché persistente multi-pestaña: el personal trabaja en
 *   pasillos sin señal; las escrituras se encolan y se envían al reconectar.
 * - La configuración vive solo en js/config.js (no versionado).
 * - La caja registradora (/caja/) usa su propia instancia de Firebase
 *   ("caja"): su sesión y su caché local son independientes de las del back
 *   office, así que en una misma computadora una cajera puede tener su turno
 *   abierto mientras un administrador usa el back office en otra pestaña.
 */
import { firebaseConfig, emuladores } from './config.js';
import { initializeApp, getApps, deleteApp } from '../vendor/firebase/12.19.0/firebase-app.js';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from '../vendor/firebase/12.19.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
  serverTimestamp,
  waitForPendingWrites,
  getDocFromServer,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  Timestamp,
} from '../vendor/firebase/12.19.0/firebase-firestore.js';

export const VERSION_SDK = '12.19.0';

/** Nombre de la instancia: "caja" en la caja registradora (/caja/), la predeterminada en el resto. */
export const NOMBRE_APP = typeof location !== 'undefined' && /\/caja\/(index\.html)?$/.test(location.pathname) ? 'caja' : '[DEFAULT]';
export const app = getApps().find((a) => a.name === NOMBRE_APP)
  ?? (NOMBRE_APP === '[DEFAULT]' ? initializeApp(firebaseConfig) : initializeApp(firebaseConfig, NOMBRE_APP));
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const hostEmuladores = emuladores?.host ?? null;
if (hostEmuladores) {
  connectAuthEmulator(auth, `http://${hostEmuladores}:${emuladores.auth ?? 9099}`, { disableWarnings: true });
  connectFirestoreEmulator(db, hostEmuladores, emuladores.firestore ?? 8080);
}

/**
 * Instancia secundaria de Auth, en memoria, para crear cuentas desde Gestión
 * sin tumbar la sesión del gerente (el SDK web "entra" con la cuenta que crea),
 * o para que un administrador autorice algo en la caja con su propio código y
 * NIP sin cerrar el turno de la cajera (`conFirestore`: escribe con la sesión
 * del administrador, sin caché). Se descarta con liberar() al terminar.
 */
export function autenticacionSecundaria({ conFirestore = false } = {}) {
  const nombre = `secundaria-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appSecundaria = initializeApp(firebaseConfig, nombre);
  const authSecundaria = initializeAuth(appSecundaria, { persistence: inMemoryPersistence });
  if (hostEmuladores) {
    connectAuthEmulator(authSecundaria, `http://${hostEmuladores}:${emuladores.auth ?? 9099}`, { disableWarnings: true });
  }
  let dbSecundaria = null;
  if (conFirestore) {
    dbSecundaria = initializeFirestore(appSecundaria, { localCache: memoryLocalCache() });
    if (hostEmuladores) connectFirestoreEmulator(dbSecundaria, hostEmuladores, emuladores.firestore ?? 8080);
  }
  return { auth: authSecundaria, db: dbSecundaria, liberar: () => deleteApp(appSecundaria) };
}

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  runTransaction,
  Timestamp,
  serverTimestamp,
  waitForPendingWrites,
  getDocFromServer,
};
