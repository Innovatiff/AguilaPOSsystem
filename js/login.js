import {
  iniciarSesion, usuarioActual, fichaEfectiva, cerrarSesionSilenciosa, enviarRestablecimiento, mensajeError, destinoSeguro, RAIZ,
  EN_CATALOGO, puedeUsarCatalogo,
} from './auth.js';
import { tipoDeIdentificador, normalizarIdentificador } from './identidad.js';
import { t } from './idioma.js';
import { botonIdioma } from './boton-idioma.js';

document.body.append(botonIdioma({ clase: 'boton-idioma idioma-esquina' }));

const parametros = new URLSearchParams(window.location.search);
const destino = RAIZ + destinoSeguro(parametros.get('volver'));
const formulario = document.getElementById('form-login');
const identificador = document.getElementById('identificador');
const secreto = document.getElementById('secreto');
const etiquetaSecreto = document.getElementById('secreto-etiqueta');
const btnEntrar = document.getElementById('btn-entrar');
const btnOlvide = document.getElementById('btn-olvide');
const mensaje = document.getElementById('mensaje');

const MOTIVOS = {
  'sesion-cerrada': ['ok', t('Sesión cerrada.')],
  'desactivado': ['error', t('Tu acceso está desactivado. Habla con el gerente.')],
  'sin-registro': ['error', t('Esta cuenta no está registrada. Pide a un administrador que te dé de alta en el back office (Empleados).')],
  'cuenta-renovada': ['error', t('Tu NIP fue restablecido. Entra con el NIP nuevo.')],
  'sin-conexion': ['error', t('No se pudo comprobar tu acceso. Revisa la conexión e inténtalo de nuevo.')],
  'solo-admin': ['error', t('El back office es solo para administradores. Para vender, usa la caja; para ver un precio, la consulta de precios; para el catálogo, la app Catálogo.')],
  'sin-permiso-catalogo': ['error', t('No tienes permiso para usar el Catálogo. Pide a un administrador que te lo active en Empleados.')],
};
const MOTIVOS_SIN_REINGRESO = new Set(['desactivado', 'sin-registro', 'cuenta-renovada', 'solo-admin', 'sin-permiso-catalogo']);
// Back office: solo administradores. App Catálogo: administradores y personal con permiso de catálogo.
const puedeEntrar = (personal) => (EN_CATALOGO ? puedeUsarCatalogo(personal) : personal.rol === 'admin');
const SIN_ACCESO = MOTIVOS[EN_CATALOGO ? 'sin-permiso-catalogo' : 'solo-admin'][1];

function mostrar(tipo, texto) {
  mensaje.textContent = texto;
  mensaje.className = `mensaje mensaje--${tipo}`;
  mensaje.hidden = !texto;
}

function ocupado(si) {
  btnEntrar.disabled = si;
  btnOlvide.disabled = si;
  btnEntrar.textContent = si ? t('Entrando…') : t('Entrar');
}

/**
 * Ajusta el segundo campo: en el Catálogo siempre es el NIP; en el back office,
 * NIP (colaboradores) o contraseña (cuentas por correo real). Un código de
 * empleado antiguo (6 dígitos) también se acepta, con su NIP.
 */
function ajustarModo() {
  const tipo = tipoDeIdentificador(identificador.value);
  const esCodigo = tipo === 'codigo' || (tipo === null && /^[0-9]+$/.test(normalizarIdentificador(identificador.value)));
  secreto.inputMode = EN_CATALOGO || esCodigo ? 'numeric' : 'text';
  etiquetaSecreto.textContent = EN_CATALOGO || esCodigo ? t('NIP') : t('NIP o contraseña');
  btnOlvide.hidden = EN_CATALOGO || tipo !== 'correo';
}
identificador.addEventListener('input', ajustarModo);
ajustarModo();

const motivo = MOTIVOS[parametros.get('motivo')];
if (motivo) mostrar(...motivo);

// Si ya hay una sesión válida, no hace falta volver a entrar.
usuarioActual().then(async (usuario) => {
  if (!usuario || MOTIVOS_SIN_REINGRESO.has(parametros.get('motivo'))) return;
  try {
    const personal = await fichaEfectiva(usuario);
    if (!puedeEntrar(personal)) {
      await cerrarSesionSilenciosa();
      return;
    }
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
    const { personal } = await iniciarSesion(identificador.value, secreto.value);
    if (!puedeEntrar(personal)) {
      await cerrarSesionSilenciosa();
      mostrar('error', SIN_ACCESO);
      ocupado(false);
      secreto.value = '';
      return;
    }
    window.location.replace(destino);
  } catch (error) {
    const codigo = error?.code ?? '';
    const credencialesMal = ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/wrong-password'].includes(codigo);
    if (credencialesMal) {
      mostrar('error', EN_CATALOGO ? t('Correo o NIP incorrectos.') : tipoDeIdentificador(identificador.value) === 'codigo' ? t('Código o NIP incorrectos.') : t('Correo, NIP o contraseña incorrectos.'));
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
    mostrar('error', t('Escribe tu correo y vuelve a pulsar «Olvidé mi contraseña». Si entras con NIP, un administrador lo cambia en Empleados.'));
    identificador.focus();
    return;
  }
  ocupado(true);
  try {
    await enviarRestablecimiento(identificador.value);
    mostrar('ok', t('Si {correo} entra con contraseña, recibirá un correo para crear una nueva. Si entras con NIP, un administrador lo cambia en Empleados.', { correo: normalizarIdentificador(identificador.value) }));
  } catch (error) {
    mostrar('error', mensajeError(error));
  } finally {
    ocupado(false);
  }
});
