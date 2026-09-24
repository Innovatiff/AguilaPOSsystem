import { iniciarSesion, usuarioActual, fichaPersonal, enviarRestablecimiento, mensajeError, destinoSeguro } from './auth.js';


const parametros = new URLSearchParams(window.location.search);
const destino = destinoSeguro(parametros.get('volver'));
const formulario = document.getElementById('form-login');
const correo = document.getElementById('correo');
const contrasena = document.getElementById('contrasena');
const btnEntrar = document.getElementById('btn-entrar');
const btnOlvide = document.getElementById('btn-olvide');
const mensaje = document.getElementById('mensaje');

const MOTIVOS = {
  'sesion-cerrada': ['ok', 'Sesión cerrada.'],
  'desactivado': ['error', 'Tu acceso está desactivado. Avisa al administrador.'],
  'sin-conexion': ['error', 'No se pudo comprobar tu acceso. Revisa la conexión e inténtalo de nuevo.'],
};

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

const motivo = MOTIVOS[parametros.get('motivo')];
if (motivo) mostrar(...motivo);

// Si ya hay sesión y el acceso no está desactivado, no hace falta volver a entrar.
usuarioActual().then(async (usuario) => {
  if (!usuario || parametros.get('motivo') === 'desactivado') return;
  try {
    const ficha = await fichaPersonal(usuario.email);
    if (!ficha || ficha.activo === true) window.location.replace(destino);
  } catch {
    // sin conexión y sin caché: que inicie sesión normalmente
  }
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!formulario.reportValidity()) return;
  mostrar('', '');
  ocupado(true);
  try {
    await iniciarSesion(correo.value, contrasena.value);
    window.location.replace(destino);
  } catch (error) {
    mostrar('error', mensajeError(error));
    ocupado(false);
    contrasena.select();
  }
});

btnOlvide.addEventListener('click', async () => {
  if (!correo.value.trim()) {
    mostrar('error', 'Escribe tu correo y vuelve a pulsar «Olvidé mi contraseña».');
    correo.focus();
    return;
  }
  ocupado(true);
  try {
    await enviarRestablecimiento(correo.value);
    mostrar('ok', `Si ${correo.value.trim()} tiene cuenta, recibirá un correo para crear una contraseña nueva.`);
  } catch (error) {
    mostrar('error', mensajeError(error));
  } finally {
    ocupado(false);
  }
});
