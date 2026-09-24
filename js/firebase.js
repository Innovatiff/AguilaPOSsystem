/**
 * Único punto de contacto con el SDK de Firebase.
 * - El SDK está vendido localmente en vendor/firebase/<versión>/ (sin CDN).
 * - Firestore con caché persistente multi-pestaña: el personal trabaja en
 *   pasillos sin señal; las escrituras se encolan y se envían al reconectar.
 * - La configuración vive solo en js/config.js (no versionado).
 */
import { firebaseConfig, emuladores } from './config.js';
import { initializeApp, getApps } from '../vendor/firebase/12.19.0/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
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
 * App secundaria para crear cuentas de acceso sin cerrar la sesión del
 * administrador (createUserWithEmailAndPassword inicia sesión con la cuenta nueva).
 */
export function authSecundaria() {
  const existente = getApps().find((a) => a.name === 'secundaria');
  const secundaria = existente ?? initializeApp(firebaseConfig, 'secundaria');
  const authSec = getAuth(secundaria);
  if (!existente && hostEmuladores) {
    connectAuthEmulator(authSec, `http://${hostEmuladores}:${emuladores.auth ?? 9099}`, { disableWarnings: true });
  }
  return authSec;
}

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
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
  Timestamp,
};
