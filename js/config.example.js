// Configuración de Firebase · PLANTILLA
// ---------------------------------------------------------------------
// 1. Copia este archivo como js/config.js (js/config.js está en .gitignore:
//    nunca se sube al repositorio).
// 2. Pega la configuración web del proyecto: Consola de Firebase →
//    Configuración del proyecto → Tus apps → SDK de Firebase → Configuración.
//    No hace falta measurementId: la app no usa Analytics.
// En Netlify, js/config.js se genera en el despliegue a partir de la
// variable de entorno FIREBASE_WEB_CONFIG (ver herramientas/escribir-config.mjs).
// ---------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

// Solo para desarrollo local contra los emuladores (npm run emuladores):
//   export const emuladores = { host: '127.0.0.1', auth: 9099, firestore: 8080 };
export const emuladores = null;
