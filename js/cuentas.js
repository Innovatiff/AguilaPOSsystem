/**
 * Cuentas de Firebase Authentication administradas desde la app.
 *
 * El SDK web solo sabe crear una cuenta iniciando sesión con ella. Para no
 * tumbar la sesión del gerente, las altas usan una instancia secundaria de
 * Auth en memoria que se descarta al terminar (js/firebase.js). Requisito:
 * en Firebase → Authentication → Settings → User actions debe estar activado
 * "Enable create (sign-up)". No abre ningún hueco: una cuenta sin ficha
 * staff/{usuario} activa no puede leer ni escribir nada (reglas).
 *
 * El SDK web no puede cambiar la contraseña de OTRA cuenta. Restablecer el
 * NIP de un empleado crea una cuenta nueva para el mismo código (sube la
 * versión: "100123.2@…") y la ficha apunta a ella; la anterior queda sin acceso.
 */
import { auth, autenticacionSecundaria, createUserWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from './firebase.js';
import { correoDeAcceso } from './identidad.js';

const INTENTOS_MAXIMOS = 25;

/** Crea una cuenta (correo + secreto) sin tocar la sesión actual. Devuelve su uid. */
export async function crearCuenta(correo, secreto) {
  const { auth: secundaria, liberar } = autenticacionSecundaria();
  try {
    const credencial = await createUserWithEmailAndPassword(secundaria, correo, secreto);
    const { uid } = credencial.user;
    await signOut(secundaria);
    return { uid };
  } finally {
    await liberar().catch(() => {});
  }
}

/**
 * Crea la cuenta que respalda un código de empleado con su NIP. Si esa versión
 * ya existe en Auth (un alta interrumpida, o un NIP anterior), prueba la
 * siguiente: la ficha guardará la que se creó.
 * @returns {Promise<{correoAuth: string, cuentaVersion: number, uid: string}>}
 */
export async function crearCuentaDeCodigo(codigo, nip, desdeVersion = 1) {
  for (let version = desdeVersion; version < desdeVersion + INTENTOS_MAXIMOS; version += 1) {
    const correoAuth = correoDeAcceso(codigo, version);
    try {
      const { uid } = await crearCuenta(correoAuth, nip);
      return { correoAuth, cuentaVersion: version, uid };
    } catch (error) {
      if (error?.code !== 'auth/email-already-in-use') throw error;
    }
  }
  throw Object.assign(new Error('Demasiadas cuentas previas para este código.'), { code: 'catalogo/sin-version-libre' });
}

/** Cambia el NIP o la contraseña de la sesión actual; exige el secreto vigente. */
export async function cambiarSecretoPropio(actual, nuevo) {
  const usuario = auth.currentUser;
  if (!usuario) throw Object.assign(new Error('Sin sesión'), { code: 'catalogo/sin-sesion' });
  await reauthenticateWithCredential(usuario, EmailAuthProvider.credential(usuario.email, actual));
  await updatePassword(usuario, nuevo);
}
