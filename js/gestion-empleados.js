/**
 * Gestión · Empleados (solo administradores): alta con código y NIP (o correo
 * y contraseña), edición, restablecer NIP, activar/desactivar.
 *
 * Cada alta crea la cuenta de Firebase Authentication (js/cuentas.js) y la
 * ficha staff/{usuario}; la ficha es lo que da acceso (reglas). Nadie se borra.
 */
import { requerirPersonal, enviarRestablecimiento, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarTiendas } from './productos.js';
import { crearCuenta, crearCuentaDeCodigo } from './cuentas.js';
import {
  armarFichaPersonal, validarFichaPersonal, validarCodigo, validarNIP, validarContrasena, siguienteCodigo,
  normalizarIdentificador, esCorreo, etiquetaUsuario,
} from './identidad.js';
import { normalizarTexto } from './esquema.js';
import { db, doc, runTransaction, writeBatch, collection, onSnapshot, Timestamp } from './firebase.js';

const { personal: yo } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal: yo, activa: 'gestion/empleados.html', app: 'gestion' });

const $ = (id) => document.getElementById(id);
const ahora = () => Timestamp.fromMillis(Date.now());
const NOMBRE_ROL = { admin: 'Administrador', empleado: 'Empleado' };

const filtro = $('filtro');
const verInactivos = $('ver-inactivos');
const mensaje = $('mensaje');
const cuerpo = $('tabla-personal').querySelector('tbody');
const editor = $('editor');
const form = $('form-empleado');
const avisoEditor = $('editor-aviso');
const btnGuardar = $('btn-guardar');

let fichas = new Map(); // usuario → ficha (con id)
let tiendas = [];
const estado = { modo: null, actual: null, guardando: false };

function mostrar(elemento, tipo, texto) {
  elemento.textContent = texto;
  elemento.className = `mensaje mensaje--${tipo}`;
  elemento.hidden = !texto;
}
const avisoEnEditor = (texto, tipo = 'error') => mostrar(avisoEditor, tipo, texto);

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function boton(texto, alPulsar) {
  const b = crear('button', 'boton boton--pequeno', texto);
  b.type = 'button';
  b.addEventListener('click', alPulsar);
  return b;
}

const tipoDe = (ficha) => ficha.tipo ?? 'correo'; // las fichas anteriores a Gestión son por correo
const nombreTienda = (id) => (id ? (tiendas.find((t) => t.id === id)?.nombre ?? id) : '—');

/**
 * Ficha completa (esquema actual) a partir de una guardada, con cambios.
 * Completa también las fichas anteriores a Gestión (solo nombre, rol, activo).
 */
function completar(ficha, cambios = {}) {
  const base = armarFichaPersonal({
    usuario: ficha.id,
    tipo: tipoDe(ficha),
    correoAuth: ficha.correoAuth,
    nombre: ficha.nombre,
    rol: ficha.rol,
    activo: ficha.activo,
    tienda: ficha.tienda ?? null,
    cuentaVersion: ficha.cuentaVersion ?? 1,
    ...cambios,
  }, yo.usuario);
  return { ...base, creadoEn: ficha.creadoEn ?? ahora(), actualizadoEn: ahora() };
}

// ------------------------------------------------------------- datos
observarTiendas(
  (lista) => {
    tiendas = lista;
    const select = $('e-tienda');
    const elegida = select.value;
    select.replaceChildren(new Option('Sin asignar', ''));
    for (const t of lista) select.append(new Option(`${t.nombre}${t.activo ? '' : ' (inactiva)'}`, t.id));
    select.value = elegida;
    pintar();
  },
  (error) => mostrar(mensaje, 'error', `No se pudieron cargar las tiendas: ${mensajeError(error)}`),
);

onSnapshot(
  collection(db, 'staff'),
  (resultado) => {
    const mapa = new Map();
    resultado.forEach((d) => mapa.set(d.id, { id: d.id, ...d.data() }));
    fichas = mapa;
    pintar();
    $('contenido').hidden = false;
  },
  (error) => {
    mostrar(mensaje, 'error', `No se pudo cargar el personal: ${mensajeError(error)}`);
    $('contenido').hidden = false;
  },
);

// ------------------------------------------------------------- tabla
function coincide(ficha, termino) {
  if (!termino) return true;
  const texto = normalizarTexto(`${ficha.id} ${ficha.nombre ?? ''} ${nombreTienda(ficha.tienda)}`);
  return termino.split(' ').every((palabra) => texto.includes(palabra));
}

function pintar() {
  const termino = normalizarTexto(filtro.value);
  const lista = [...fichas.values()]
    .filter((f) => (verInactivos.checked || f.activo === true) && coincide(f, termino))
    .sort((a, b) => (Number(b.activo === true) - Number(a.activo === true)) || String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'));
  cuerpo.replaceChildren(...lista.map(fila));
  const sin = $('sin-resultados');
  sin.hidden = lista.length > 0;
  sin.textContent = fichas.size === 0 ? 'Todavía no hay personal registrado.' : `Sin resultados para «${filtro.value.trim()}».`;
}

function fila(ficha) {
  const tr = document.createElement('tr');
  if (ficha.activo !== true) tr.className = 'inactivo';
  const tipo = tipoDe(ficha);
  const esYo = ficha.id === yo.usuario;

  const acceso = crear('td');
  acceso.append(crear('span', '', tipo === 'codigo' ? 'Código + NIP' : 'Correo + contraseña'));
  if (tipo === 'codigo' && (ficha.cuentaVersion ?? 1) > 1) acceso.append(crear('span', 'acceso-nota', `NIP restablecido ${ficha.cuentaVersion - 1} ${ficha.cuentaVersion - 1 === 1 ? 'vez' : 'veces'}`));
  if (tipo === 'correo' && !ficha.correoAuth) acceso.append(crear('span', 'acceso-nota', 'Ficha anterior: se completa al editar'));

  const nombre = crear('td');
  nombre.append(crear('strong', '', ficha.nombre ?? ''));
  if (esYo) nombre.append(crear('span', 'secundario', 'tú'));

  tr.append(
    crear('td', 'monoespaciada', ficha.id),
    nombre,
    crear('td', '', NOMBRE_ROL[ficha.rol] ?? ficha.rol ?? ''),
    crear('td', '', nombreTienda(ficha.tienda)),
    acceso,
    crear('td', '', ficha.activo === true ? 'Activo' : 'Inactivo'),
  );

  const acciones = crear('td', 'acciones-fila');
  acciones.append(boton('Editar', () => abrirEditar(ficha)));
  if (tipo === 'codigo' && !esYo) acciones.append(boton('Restablecer NIP', () => abrirNip(ficha)));
  if (tipo === 'correo') acciones.append(boton('Enviar enlace de contraseña', () => enviarEnlace(ficha)));
  if (!esYo) acciones.append(boton(ficha.activo === true ? 'Desactivar' : 'Activar', () => cambiarActivo(ficha)));
  tr.append(acciones);
  return tr;
}

filtro.addEventListener('input', pintar);
verInactivos.addEventListener('change', pintar);

// ------------------------------------------------------------- acciones de fila
/** Guarda la ficha completa y, si es de código, su accesos/{código}, en un solo lote. */
async function guardarFicha(ficha) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'staff', ficha.usuario), ficha);
  if (ficha.tipo === 'codigo') lote.set(doc(db, 'accesos', ficha.usuario), { version: ficha.cuentaVersion });
  await lote.commit();
}

async function cambiarActivo(ficha) {
  const activar = ficha.activo !== true;
  const quien = etiquetaUsuario(ficha.id, ficha.nombre);
  if (!activar && !window.confirm(`¿Desactivar a ${quien}? Dejará de poder entrar de inmediato. Se puede reactivar después.`)) return;
  try {
    await guardarFicha(completar(ficha, { activo: activar }));
    mostrar(mensaje, 'ok', `${quien} ${activar ? 'reactivado: ya puede entrar' : 'desactivado: ya no puede entrar'}.`);
  } catch (error) {
    mostrar(mensaje, 'error', mensajeError(error));
  }
}

async function enviarEnlace(ficha) {
  try {
    await enviarRestablecimiento(ficha.id);
    mostrar(mensaje, 'ok', `Correo enviado a ${ficha.id} para crear una contraseña nueva (si la cuenta existe en Firebase).`);
  } catch (error) {
    mostrar(mensaje, 'error', mensajeError(error));
  }
}

// ------------------------------------------------------------- editor
const tipoElegido = () => form.tipo.value;
const cuentaElegida = () => form.cuenta.value;

function ajustarFormulario() {
  const modo = estado.modo;
  const tipo = modo === 'crear' ? tipoElegido() : tipoDe(estado.actual ?? {});
  const conSecreto = modo === 'nip' || (modo === 'crear' && (tipo === 'codigo' || cuentaElegida() === 'crear'));
  $('grupo-tipo').hidden = modo !== 'crear';
  $('grupo-datos').hidden = modo === 'nip';
  $('campo-codigo').hidden = tipo !== 'codigo';
  $('campo-correo').hidden = tipo !== 'correo';
  $('grupo-cuenta-correo').hidden = !(modo === 'crear' && tipo === 'correo');
  $('grupo-secreto').hidden = !conSecreto;
  $('e-codigo').readOnly = modo !== 'crear';
  $('e-correo').readOnly = modo !== 'crear';
  $('e-rol').disabled = modo === 'editar' && estado.actual?.id === yo.usuario;
  const nip = tipo === 'codigo';
  $('et-secreto').textContent = nip ? (modo === 'nip' ? 'NIP nuevo *' : 'NIP *') : 'Contraseña temporal *';
  $('et-secreto2').textContent = nip ? 'Repite el NIP *' : 'Repite la contraseña *';
  $('nota-secreto').textContent = nip
    ? (modo === 'nip'
      ? 'Se crea una cuenta nueva para este código con el NIP nuevo; el anterior deja de servir de inmediato y la persona tendrá que volver a entrar.'
      : 'De 6 a 10 dígitos. Anótalo y entrégaselo en persona: después no se puede consultar, solo restablecer.')
    : 'Mínimo 8 caracteres. La persona puede cambiarla en «Mi cuenta» o con «Olvidé mi contraseña».';
  for (const id of ['e-secreto', 'e-secreto2']) {
    $(id).inputMode = nip ? 'numeric' : 'text';
    $(id).maxLength = nip ? 10 : 72; // el tope de 10 es solo para el NIP; una contraseña no se recorta
  }
  btnGuardar.firstChild.textContent = modo === 'crear' ? 'Registrar ' : modo === 'nip' ? 'Restablecer NIP ' : 'Guardar ';
  $('pie-nota').textContent = modo === 'crear' && tipo === 'codigo' ? 'Se crea la cuenta y la ficha; la persona ya podrá entrar.' : '';
}
for (const radio of form.querySelectorAll('input[name="tipo"], input[name="cuenta"]')) radio.addEventListener('change', ajustarFormulario);

function abrir(modo, actual, titulo) {
  estado.modo = modo;
  estado.actual = actual;
  form.reset();
  avisoEnEditor('');
  $('editor-titulo').textContent = titulo;
  if (actual) {
    $('e-codigo').value = tipoDe(actual) === 'codigo' ? actual.id : '';
    $('e-correo').value = tipoDe(actual) === 'correo' ? actual.id : '';
    $('e-nombre').value = actual.nombre ?? '';
    $('e-rol').value = actual.rol ?? 'empleado';
    $('e-tienda').value = actual.tienda ?? '';
  } else {
    $('e-codigo').value = siguienteCodigo([...fichas.keys()]);
    $('e-tienda').value = '';
  }
  ajustarFormulario();
  if (!editor.open) editor.showModal();
  const primero = modo === 'nip' ? $('e-secreto') : modo === 'editar' ? $('e-nombre') : tipoElegido() === 'codigo' ? $('e-nombre') : $('e-correo');
  setTimeout(() => primero.focus(), 0);
}

const abrirNuevo = () => abrir('crear', null, 'Nuevo empleado');
const abrirEditar = (ficha) => abrir('editar', ficha, `Editar · ${etiquetaUsuario(ficha.id, ficha.nombre)}`);
const abrirNip = (ficha) => abrir('nip', ficha, `Restablecer NIP · ${etiquetaUsuario(ficha.id, ficha.nombre)}`);

$('btn-nuevo').addEventListener('click', abrirNuevo);
$('btn-cerrar').addEventListener('click', () => editor.close());
document.addEventListener('keydown', (evento) => {
  if (evento.altKey && !evento.ctrlKey && !evento.metaKey && evento.key.toLowerCase() === 'n' && !editor.open) {
    evento.preventDefault();
    abrirNuevo();
  }
});

/** Lee y valida el secreto (NIP o contraseña) por duplicado. Devuelve el texto o lanza Error. */
function leerSecreto(nip) {
  const a = $('e-secreto').value.trim();
  const b = $('e-secreto2').value.trim();
  const error = nip ? validarNIP(a) : validarContrasena(a);
  if (error) throw Object.assign(new Error(error), { campo: $('e-secreto') });
  if (a !== b) throw Object.assign(new Error(nip ? 'Los dos NIP no coinciden.' : 'Las dos contraseñas no coinciden.'), { campo: $('e-secreto2') });
  return a;
}

/** Crea la ficha solo si no existe (dos gerentes no pueden repetir un código). */
async function crearFicha(ficha) {
  const referencia = doc(db, 'staff', ficha.usuario);
  await runTransaction(db, async (transaccion) => {
    const existente = await transaccion.get(referencia);
    if (existente.exists()) throw Object.assign(new Error(`${ficha.usuario} ya está registrado.`), { code: 'catalogo/duplicado' });
    const marca = ahora();
    transaccion.set(referencia, { ...ficha, creadoEn: marca, actualizadoEn: marca });
    // La pantalla de entrada consulta accesos/{código} para saber la versión de cuenta vigente.
    if (ficha.tipo === 'codigo') transaccion.set(doc(db, 'accesos', ficha.usuario), { version: ficha.cuentaVersion });
  });
}

async function registrar() {
  const tipo = tipoElegido();
  const nombre = $('e-nombre').value.trim();
  if (nombre === '') throw Object.assign(new Error('Escribe el nombre.'), { campo: $('e-nombre') });
  const rol = $('e-rol').value;
  const tienda = $('e-tienda').value || null;

  if (tipo === 'codigo') {
    const codigo = normalizarIdentificador($('e-codigo').value);
    const errorCodigo = validarCodigo(codigo);
    if (errorCodigo) throw Object.assign(new Error(errorCodigo), { campo: $('e-codigo') });
    if (fichas.has(codigo)) throw Object.assign(new Error(`El código ${codigo} ya es de ${fichas.get(codigo).nombre}. Elige otro.`), { campo: $('e-codigo') });
    const nip = leerSecreto(true);
    // 1) la cuenta (si una versión anterior quedó huérfana se usa la siguiente); 2) la ficha
    const cuenta = await crearCuentaDeCodigo(codigo, nip);
    const ficha = armarFichaPersonal({ usuario: codigo, tipo: 'codigo', correoAuth: cuenta.correoAuth, cuentaVersion: cuenta.cuentaVersion, nombre, rol, tienda }, yo.usuario);
    const errores = validarFichaPersonal(ficha);
    if (errores.length > 0) throw new Error(errores.join(' '));
    await crearFicha(ficha);
    return `${nombre} registrado con el código ${codigo}. Ya puede entrar con ese código y su NIP.`;
  }

  const correo = normalizarIdentificador($('e-correo').value);
  if (!esCorreo(correo)) throw Object.assign(new Error('Escribe un correo válido.'), { campo: $('e-correo') });
  if (fichas.has(correo)) throw Object.assign(new Error(`${correo} ya está registrado.`), { campo: $('e-correo') });
  const crearAhora = cuentaElegida() === 'crear';
  const contrasena = crearAhora ? leerSecreto(false) : null;
  const ficha = armarFichaPersonal({ usuario: correo, tipo: 'correo', nombre, rol, tienda }, yo.usuario);
  const errores = validarFichaPersonal(ficha);
  if (errores.length > 0) throw new Error(errores.join(' '));
  if (crearAhora) {
    try {
      await crearCuenta(correo, contrasena);
    } catch (error) {
      if (error?.code === 'auth/email-already-in-use') {
        throw Object.assign(new Error(`Ya existe una cuenta de Firebase para ${correo}: elige «La cuenta ya existe» y vuelve a registrar.`), { campo: $('e-correo') });
      }
      throw error;
    }
  }
  await crearFicha(ficha);
  return crearAhora
    ? `${nombre} registrado. Puede entrar con ${correo} y la contraseña temporal; conviene cambiarla en «Mi cuenta».`
    : `Acceso registrado para ${correo}. Podrá entrar cuando exista su cuenta en Firebase → Authentication.`;
}

async function guardarEdicion() {
  const nombre = $('e-nombre').value.trim();
  if (nombre === '') throw Object.assign(new Error('Escribe el nombre.'), { campo: $('e-nombre') });
  const cambios = { nombre, rol: $('e-rol').disabled ? estado.actual.rol : $('e-rol').value, tienda: $('e-tienda').value || null };
  const ficha = completar(estado.actual, cambios);
  const errores = validarFichaPersonal(ficha);
  if (errores.length > 0) throw new Error(errores.join(' '));
  await guardarFicha(ficha);
  return `${etiquetaUsuario(ficha.usuario, ficha.nombre)} guardado.`;
}

async function restablecerNip() {
  const nip = leerSecreto(true);
  const actual = estado.actual;
  const cuenta = await crearCuentaDeCodigo(actual.id, nip, (actual.cuentaVersion ?? 1) + 1);
  const ficha = completar(actual, { correoAuth: cuenta.correoAuth, cuentaVersion: cuenta.cuentaVersion });
  const lote = writeBatch(db);
  lote.set(doc(db, 'staff', ficha.usuario), ficha);
  lote.set(doc(db, 'accesos', ficha.usuario), { version: ficha.cuentaVersion });
  await lote.commit();
  return `NIP de ${etiquetaUsuario(actual.id, actual.nombre)} restablecido. El NIP anterior ya no sirve.`;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (estado.guardando) return;
  estado.guardando = true;
  btnGuardar.disabled = true;
  avisoEnEditor('');
  try {
    const texto = estado.modo === 'crear' ? await registrar() : estado.modo === 'nip' ? await restablecerNip() : await guardarEdicion();
    editor.close();
    mostrar(mensaje, 'ok', texto);
    avisar(texto, 'ok');
  } catch (error) {
    avisoEnEditor(error?.code ? mensajeError(error) : error.message);
    if (error?.code === 'catalogo/duplicado') avisoEnEditor(error.message);
    error.campo?.focus();
  } finally {
    estado.guardando = false;
    btnGuardar.disabled = false;
  }
});
