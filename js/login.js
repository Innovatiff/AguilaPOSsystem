import { iniciarSesion, usuarioActual, fichaEfectiva, cerrarSesionSilenciosa, enviarRestablecimiento, mensajeError, destinoSeguro, RAIZ } from './auth.js';
import { tipoDeIdentificador, normalizarIdentificador } from './identidad.js';

const parametros = new URLSearchParams(window.location.search);
const destino = RAIZ + destinoSeguro(parametros.get('volver'));
const formulario = document.getElementById('form-login');
const identificador = document.getElementById('identificador');
const secreto = document.getElementById('secreto');
const etiquetaSecreto = document.getElementById('secreto-etiqueta');
const btnEntrar = document.getElementById('btn-entrar');
const btnOlvide = document.getElementById('btn-olvide');
const pistaNip = document.getElementById('pista-nip');
const mensaje = document.getElementById('mensaje');

const MOTIVOS = {
  'sesion-cerrada': ['ok', 'Sesión cerrada.'],
  'desactivado': ['error', 'Tu acceso está desactivado. Habla con el gerente.'],
  'sin-registro': ['error', 'Esta cuenta no está registrada. Pide al gerente que te dé de alta en Gestión.'],
  'cuenta-renovada': ['error', 'Tu NIP fue restablecido. Entra con el NIP nuevo.'],
  'sin-conexion': ['error', 'No se pudo comprobar tu acceso. Revisa la conexión e inténtalo de nuevo.'],
};
const MOTIVOS_SIN_REINGRESO = new Set(['desactivado', 'sin-registro', 'cuenta-renovada']);

function mostrar(tipo, texto) {
  mensaje.textContent = texto;
  mensaje.className = `mensaje mensaje--${tipo}`;
  mensaje.hidden = !texto;
}

function ocupado(si) {
  btnEntrar.disabled = si;
  btnOlvide.disabled = si;
  btnEntrar.textContent = si ? 'Entrando…' : 'Entrar';
}

/** Ajusta el segundo campo a lo que se teclea: NIP numérico para códigos, contraseña para correos. */
function ajustarModo() {
  const tipo = tipoDeIdentificador(identificador.value);
  const esCodigo = tipo === 'codigo' || (tipo === null && /^[0-9]*$/.test(normalizarIdentificador(identificador.value)));
  secreto.inputMode = esCodigo ? 'numeric' : 'text';
  etiquetaSecreto.textContent = esCodigo ? 'NIP' : tipo === 'correo' ? 'Contraseña' : 'NIP o contraseña';
  btnOlvide.hidden = tipo !== 'correo';
  pistaNip.hidden = tipo === 'correo';
}
identificador.addEventListener('input', ajustarModo);
ajustarModo();

const motivo = MOTIVOS[parametros.get('motivo')];
if (motivo) mostrar(...motivo);

// Si ya hay una sesión válida, no hace falta volver a entrar.
usuarioActual().then(async (usuario) => {
  if (!usuario || MOTIVOS_SIN_REINGRESO.has(parametros.get('motivo'))) return;
  try {
    await fichaEfectiva(usuario);
    window.location.replace(destino);
  } catch (error) {
    if (String(error?.code ?? '').startsWith('catalogo/')) await cerrarSesionSilenciosa();
    // sin conexión y sin caché: que inicie sesión normalmente
  }
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!formulario.reportValidity()) return;
  mostrar('', '');
  ocupado(true);
  try {
    await iniciarSesion(identificador.value, secreto.value);
    window.location.replace(destino);
  } catch (error) {
    const codigo = error?.code ?? '';
    const credencialesMal = ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/wrong-password'].includes(codigo);
    if (credencialesMal) {
      mostrar('error', tipoDeIdentificador(identificador.value) === 'codigo' ? 'Código o NIP incorrectos.' : 'Correo o contraseña incorrectos.');
    } else {
      mostrar('error', mensajeError(error));
    }
    ocupado(false);
    if (codigo === 'catalogo/identificador') identificador.select();
    else secreto.select();
  }
});

btnOlvide.addEventListener('click', async () => {
  if (tipoDeIdentificador(identificador.value) !== 'correo') {
    mostrar('error', 'Escribe tu correo y vuelve a pulsar «Olvidé mi contraseña». Si entras con código, el gerente restablece tu NIP.');
    identificador.focus();
    return;
  }
  ocupado(true);
  try {
    await enviarRestablecimiento(identificador.value);
    mostrar('ok', `Si ${normalizarIdentificador(identificador.value)} tiene cuenta, recibirá un correo para crear una contraseña nueva.`);
  } catch (error) {
    mostrar('error', mensajeError(error));
  } finally {
    ocupado(false);
  }
});
