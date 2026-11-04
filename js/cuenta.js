/**
 * Mi cuenta: datos de la persona y cambio de su propio NIP o contraseña.
 * El NIP identifica a la persona en la caja (nips/{huella}, js/nip.js): al
 * cambiarlo se registra la huella nueva antes de cambiar la cuenta y se borra
 * la vieja después; si la cuenta no cambia, la huella nueva se retira.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { cambiarSecretoPropio } from './cuentas.js';
import { validarNIP, validarContrasena, versionDe } from './identidad.js';
import { obtenerClaveCaja } from './clave-caja.js';
import { huellaNip } from './nip.js';
import { db, doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where } from './firebase.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'cuenta.html' });

const $ = (id) => document.getElementById(id);
const esCodigo = personal.tipo === 'codigo';
const NOMBRE_ROL = { admin: 'Administrador', empleado: 'Empleado' };
const palabra = esCodigo ? 'NIP' : 'contraseña';

function fila(termino, valor) {
  const dt = document.createElement('dt');
  dt.textContent = termino;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  return [dt, dd];
}

const datos = $('datos-cuenta');
datos.append(
  ...fila('Nombre', personal.nombre),
  ...fila('Correo', personal.correo ?? (esCodigo ? 'Sin correo (pídelo a otro administrador en Empleados)' : personal.usuario)),
  ...(esCodigo ? fila('Nº de colaborador', personal.usuario) : []),
  ...fila('Rol', NOMBRE_ROL[personal.rol] ?? personal.rol),
);
if (personal.tienda) {
  try {
    const tienda = await getDoc(doc(db, 'stores', personal.tienda));
    datos.append(...fila('Tienda', tienda.exists() ? tienda.data().nombre : personal.tienda));
  } catch {
    datos.append(...fila('Tienda', personal.tienda));
  }
}

$('titulo-secreto').textContent = esCodigo ? 'Cambiar NIP' : 'Cambiar contraseña';
$('nota-secreto').textContent = esCodigo
  ? 'El NIP son 6 dígitos y nadie más puede tenerlo: en la caja es lo único que se escribe. Si lo olvidas, otro administrador lo cambia en Empleados.'
  : 'La contraseña debe tener al menos 8 caracteres. Si la olvidas, usa «Olvidé mi contraseña» al entrar.';
$('et-actual').textContent = `${palabra[0].toUpperCase()}${palabra.slice(1)} actual`;
$('et-nuevo').textContent = `${palabra[0].toUpperCase()}${palabra.slice(1)} nueva`.replace('NIP nueva', 'NIP nuevo');
$('et-repetir').textContent = esCodigo ? 'Repite el NIP nuevo' : 'Repite la contraseña nueva';
for (const id of ['s-actual', 's-nuevo', 's-repetir']) $(id).inputMode = esCodigo ? 'numeric' : 'text';

const mensaje = $('s-mensaje');
function mostrar(tipo, texto) {
  mensaje.textContent = texto;
  mensaje.className = `mensaje mensaje--${tipo}`;
  mensaje.hidden = !texto;
}

$('form-secreto').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const actual = $('s-actual').value;
  const nuevo = $('s-nuevo').value.trim();
  const repetido = $('s-repetir').value.trim();
  const error = esCodigo ? validarNIP(nuevo) : validarContrasena(nuevo);
  if (error) {
    mostrar('error', error);
    $('s-nuevo').focus();
    return;
  }
  if (nuevo !== repetido) {
    mostrar('error', esCodigo ? 'Los dos NIP no coinciden.' : 'Las dos contraseñas no coinciden.');
    $('s-repetir').focus();
    return;
  }
  if (nuevo === actual) {
    mostrar('error', `El ${palabra} nuevo debe ser distinto del actual.`);
    $('s-nuevo').focus();
    return;
  }
  $('s-guardar').disabled = true;
  try {
    if (esCodigo) await cambiarNipPropio(actual, nuevo);
    else await cambiarSecretoPropio(actual, nuevo);
    $('form-secreto').reset();
    mostrar('ok', esCodigo ? 'NIP cambiado. Úsalo la próxima vez que entres.' : 'Contraseña cambiada.');
  } catch (e) {
    const codigo = e?.code ?? '';
    mostrar('error', ['auth/invalid-credential', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(codigo)
      ? `El ${palabra} actual no es correcto.`
      : codigo === 'catalogo/nip-ocupado' ? e.message : mensajeError(e));
    if (codigo.startsWith('auth/')) $('s-actual').select();
  } finally {
    $('s-guardar').disabled = false;
  }
});

/** NIP propio: huella nueva (única) → cuenta → huellas viejas fuera. */
async function cambiarNipPropio(actual, nuevo) {
  const huella = await huellaNip(await obtenerClaveCaja(personal.usuario), nuevo);
  const registro = doc(db, 'nips', huella);
  if ((await getDoc(registro)).exists()) {
    throw Object.assign(new Error('Ese NIP ya lo tiene otra persona. Elige otro.'), { code: 'catalogo/nip-ocupado' });
  }
  const anteriores = await getDocs(query(collection(db, 'nips'), where('codigo', '==', personal.usuario)));
  const version = versionDe(personal.email); // la versión de la cuenta con la que entró (la vigente)
  await setDoc(registro, { codigo: personal.usuario, version });
  try {
    await cambiarSecretoPropio(actual, nuevo);
  } catch (error) {
    await deleteDoc(registro).catch(() => {});
    throw error;
  }
  await Promise.all(anteriores.docs.filter((d) => d.id !== huella).map((d) => deleteDoc(d.ref).catch(() => {})));
}

$('contenido').hidden = false;
