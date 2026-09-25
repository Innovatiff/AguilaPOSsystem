/**
 * Único punto de contacto con el SDK de Firebase.
 * - El SDK está vendido localmente en vendor/firebase/<versión>/ (sin CDN).
 * - Firestore con caché persistente multi-pestaña: el personal trabaja en
 *   pasillos sin señal; las escrituras se encolan y se envían al reconectar.
 * - La configuración vive solo en js/config.js (no versionado).
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
  connectFirestoreEmulator,
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

export const app = getApps()[0] ?? initializeApp(firebaseConfig);
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
 * sin tumbar la sesión del gerente (el SDK web "entra" con la cuenta que crea).
 * Se descarta con liberar() al terminar.
 */
export function autenticacionSecundaria() {
  const nombre = `secundaria-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appSecundaria = initializeApp(firebaseConfig, nombre);
  const authSecundaria = initializeAuth(appSecundaria, { persistence: inMemoryPersistence });
  if (hostEmuladores) {
    connectAuthEmulator(authSecundaria, `http://${hostEmuladores}:${emuladores.auth ?? 9099}`, { disableWarnings: true });
  }
  return { auth: authSecundaria, liberar: () => deleteApp(appSecundaria) };
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
};
