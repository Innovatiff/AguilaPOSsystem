/**
 * Back office · Empleados (solo administradores).
 *
 * Cada colaborador se registra con su CORREO y un NIP de 6 dígitos único:
 *  - la cuenta de Firebase Authentication es la de su número interno de
 *    colaborador ("<código>@<dominio sintético>", contraseña = NIP; js/cuentas.js);
 *  - staff/{código} lleva su correo y si puede usar la app Catálogo;
 *  - correos/{correo} = { codigo } le deja entrar con correo + NIP;
 *  - nips/{huella} = { codigo, version } le deja entrar en la caja solo con el
 *    NIP (la huella es un HMAC del NIP con la clave de caja; js/nip.js).
 * Todo se escribe en un solo lote, que las reglas comprueban. Cambiar el NIP
 * crea una cuenta nueva (sube la versión) y cambia la huella. Nadie se borra.
 * Las fichas por correo + contraseña anteriores siguen funcionando (back office).
 */
import { requerirPersonal, enviarRestablecimiento, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarTiendas } from './productos.js';
import { crearCuentaDeCodigo } from './cuentas.js';
import { obtenerClaveCaja } from './clave-caja.js';
import { huellaNip } from './nip.js';
import { armarFichaPersonal, validarFichaPersonal, validarNIP, siguienteCodigo, esCorreo } from './identidad.js';
import { normalizarTexto } from './esquema.js';
import {
  db, doc, getDoc, getDocs, query, where, runTransaction, writeBatch, collection, onSnapshot, Timestamp,
} from './firebase.js';

const { personal: yo } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal: yo, activa: 'gestion/empleados.html' });

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
let conNip = new Map(); // código → versión registrada en nips/
let tiendas = [];
const estado = { modo: null, actual: null, guardando: false };

function mostrar(elemento, tipo, texto) {
  elemento.textContent = texto;
  elemento.className = `mensaje mensaje--${tipo}`;
  elemento.hidden = !texto;
}
const avisoEnEditor = (texto, tipo = 'error') => mostrar(avisoEditor, tipo, texto);
const fallo = (texto, campo) => Object.assign(new Error(texto), { campo });

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
const correoDe = (ficha) => ficha.correo ?? (tipoDe(ficha) === 'correo' ? ficha.id : null);
const nombreTienda = (id) => (id ? (tiendas.find((t) => t.id === id)?.nombre ?? id) : '—');
/** ¿Tiene su NIP de caja registrado (huella con la versión de cuenta vigente)? */
const nipRegistrado = (ficha) => conNip.get(ficha.id) === (ficha.cuentaVersion ?? 1);
/** Colaborador por código al que todavía le falta el correo o el NIP de 6 dígitos registrado. */
const pendienteDeMigrar = (ficha) => tipoDe(ficha) === 'codigo' && (!ficha.correo || !nipRegistrado(ficha));

/**
 * Ficha completa (esquema actual) a partir de una guardada, con cambios.
 * Completa también las fichas anteriores (sin correo, sin permiso de catálogo).
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
    correo: ficha.correo ?? null,
    catalogo: ficha.catalogo === true,
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

onSnapshot(
  collection(db, 'nips'),
  (resultado) => {
    const mapa = new Map();
    resultado.forEach((d) => mapa.set(d.data().codigo, d.data().version));
    conNip = mapa;
    pintar();
  },
  () => {}, // sin las reglas nuevas publicadas no se puede listar: solo no se marcan los pendientes
);

// ------------------------------------------------------------- tabla
function coincide(ficha, termino) {
  if (!termino) return true;
  const texto = normalizarTexto(`${ficha.id} ${ficha.nombre ?? ''} ${correoDe(ficha) ?? ''} ${nombreTienda(ficha.tienda)}`);
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

  const pendientes = [...fichas.values()].filter((f) => f.activo === true && pendienteDeMigrar(f));
  const aviso = $('aviso-migracion');
  aviso.hidden = pendientes.length === 0;
  aviso.textContent = pendientes.length === 0 ? '' : `${pendientes.length === 1 ? '1 persona todavía no puede' : `${pendientes.length} personas todavía no pueden`} entrar con correo y NIP: ${pendientes.map((f) => f.nombre).join(', ')}. Edítala para poner su correo y usa «Cambiar NIP» para darle un NIP de 6 dígitos.`;
}

function chip(texto, tipo) {
  return crear('span', `chip chip--${tipo}`, texto);
}

function fila(ficha) {
  const tr = document.createElement('tr');
  if (ficha.activo !== true) tr.className = 'inactivo';
  const tipo = tipoDe(ficha);
  const esYo = ficha.id === yo.usuario;

  const nombre = crear('td');
  nombre.append(crear('strong', '', ficha.nombre ?? ''));
  if (esYo) nombre.append(crear('span', 'secundario', 'tú'));
  if (tipo === 'codigo') nombre.append(crear('span', 'secundario monoespaciada', `Nº ${ficha.id}`));

  const acceso = crear('td');
  if (tipo === 'codigo') {
    if (!ficha.correo) acceso.append(chip('Falta el correo', 'aviso'));
    if (!nipRegistrado(ficha)) acceso.append(chip('Falta el NIP de caja', 'aviso'));
    if (ficha.correo && nipRegistrado(ficha)) acceso.append(crear('span', '', 'Correo + NIP'));
  } else {
    acceso.append(crear('span', '', 'Correo + contraseña'));
    acceso.append(crear('span', 'acceso-nota', 'Solo back office: sin NIP de caja'));
  }

  tr.append(
    nombre,
    crear('td', 'correo-celda', correoDe(ficha) ?? '—'),
    crear('td', '', NOMBRE_ROL[ficha.rol] ?? ficha.rol ?? ''),
    crear('td', '', nombreTienda(ficha.tienda)),
    acceso,
    crear('td', '', ficha.rol === 'admin' ? 'Sí (admin)' : ficha.catalogo === true ? 'Sí' : 'No'),
    crear('td', '', ficha.activo === true ? 'Activo' : 'Inactivo'),
  );

  const acciones = crear('td', 'acciones-fila');
  acciones.append(boton('Editar', () => abrirEditar(ficha)));
  if (tipo === 'codigo' && !esYo) acciones.append(boton('Cambiar NIP', () => abrirNip(ficha)));
  if (tipo === 'correo') acciones.append(boton('Enviar enlace de contraseña', () => enviarEnlace(ficha)));
  if (!esYo) acciones.append(boton(ficha.activo === true ? 'Desactivar' : 'Activar', () => cambiarActivo(ficha)));
  tr.append(acciones);
  return tr;
}

filtro.addEventListener('input', pintar);
verInactivos.addEventListener('change', pintar);

// ------------------------------------------------------------- acciones de fila
/** Guarda la ficha completa y, si es de código, su accesos/{código}, en un lote (más lo que se añada). */
function loteFicha(ficha) {
  const lote = writeBatch(db);
  lote.set(doc(db, 'staff', ficha.usuario), ficha);
  if (ficha.tipo === 'codigo') lote.set(doc(db, 'accesos', ficha.usuario), { version: ficha.cuentaVersion });
  return lote;
}

async function cambiarActivo(ficha) {
  const activar = ficha.activo !== true;
  const quien = ficha.nombre ?? ficha.id;
  if (!activar && !window.confirm(`¿Desactivar a ${quien}? Dejará de poder entrar de inmediato (caja, consulta y Catálogo). Se puede reactivar después.`)) return;
  try {
    await loteFicha(completar(ficha, { activo: activar })).commit();
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

// ------------------------------------------------------------- NIP y correo: unicidad
let clave = null;
async function claveCaja() {
  clave ??= await obtenerClaveCaja(yo.usuario);
  return clave;
}

/** Huella del NIP; falla si ese NIP ya es de otra persona (o ya es el suyo). */
async function huellaLibre(nip, codigoPropio = null) {
  const huella = await huellaNip(await claveCaja(), nip);
  const existente = await getDoc(doc(db, 'nips', huella));
  if (existente.exists()) {
    const dueno = existente.data().codigo;
    if (dueno === codigoPropio) throw fallo('Ese ya es su NIP. Escribe uno distinto.', $('e-secreto'));
    throw fallo('Ese NIP ya lo tiene otra persona. Elige otro (o pulsa «Generar un NIP»).', $('e-secreto'));
  }
  return huella;
}

/** El correo no puede ser de otro colaborador. */
async function correoLibre(correo, codigoPropio = null) {
  const otro = [...fichas.values()].find((f) => f.id !== codigoPropio && tipoDe(f) === 'codigo' && f.correo === correo);
  if (otro) throw fallo(`Ese correo ya es de ${otro.nombre}.`, $('e-correo'));
  const registro = await getDoc(doc(db, 'correos', correo));
  if (registro.exists() && registro.data().codigo !== codigoPropio) {
    const dueno = fichas.get(registro.data().codigo);
    throw fallo(`Ese correo ya es de ${dueno?.nombre ?? `el colaborador ${registro.data().codigo}`}.`, $('e-correo'));
  }
}

function leerCorreo() {
  const correo = $('e-correo').value.trim().toLowerCase();
  if (correo === '') throw fallo('Escribe el correo.', $('e-correo'));
  if (!esCorreo(correo)) throw fallo('Escribe un correo válido.', $('e-correo'));
  return correo;
}

// ------------------------------------------------------------- editor
function ajustarFormulario() {
  const modo = estado.modo;
  const actual = estado.actual;
  const porCorreo = actual && tipoDe(actual) === 'correo';
  $('grupo-datos').hidden = modo === 'nip';
  $('grupo-secreto').hidden = modo === 'editar';
  $('e-correo').readOnly = Boolean(porCorreo);
  $('e-rol').disabled = modo === 'editar' && actual?.id === yo.usuario;
  $('et-secreto').textContent = modo === 'nip' ? 'NIP nuevo *' : 'NIP *';
  $('et-secreto2').textContent = modo === 'nip' ? 'Repite el NIP nuevo *' : 'Repite el NIP *';
  const numero = $('e-numero');
  numero.hidden = !(actual && tipoDe(actual) === 'codigo');
  numero.textContent = numero.hidden ? '' : `Nº de colaborador ${actual.id} (interno: nadie lo tiene que teclear).`;
  $('nip-generado').hidden = true;
  btnGuardar.firstChild.textContent = modo === 'crear' ? 'Registrar ' : modo === 'nip' ? 'Cambiar NIP ' : 'Guardar ';
  $('pie-nota').textContent = modo === 'crear'
    ? 'Se crea la cuenta; la persona ya podrá entrar.'
    : modo === 'nip' ? 'El NIP anterior deja de servir de inmediato.' : '';
}

function abrir(modo, actual, titulo) {
  estado.modo = modo;
  estado.actual = actual;
  form.reset();
  avisoEnEditor('');
  $('editor-titulo').textContent = titulo;
  if (actual) {
    $('e-nombre').value = actual.nombre ?? '';
    $('e-correo').value = correoDe(actual) ?? '';
    $('e-rol').value = actual.rol ?? 'empleado';
    $('e-tienda').value = actual.tienda ?? '';
    $('e-catalogo').checked = actual.catalogo === true;
  } else {
    $('e-tienda').value = '';
    $('e-catalogo').checked = false;
  }
  ajustarFormulario();
  if (!editor.open) editor.showModal();
  const primero = modo === 'nip' ? $('e-secreto') : modo === 'editar' && !actual?.correo && tipoDe(actual) === 'codigo' ? $('e-correo') : $('e-nombre');
  setTimeout(() => primero.focus(), 0);
}

const abrirNuevo = () => abrir('crear', null, 'Nuevo empleado');
const abrirEditar = (ficha) => abrir('editar', ficha, `Editar · ${ficha.nombre ?? ficha.id}`);
const abrirNip = (ficha) => abrir('nip', ficha, `Cambiar NIP · ${ficha.nombre ?? ficha.id}`);

$('btn-nuevo').addEventListener('click', abrirNuevo);
$('btn-cerrar').addEventListener('click', () => editor.close());
document.addEventListener('keydown', (evento) => {
  if (evento.altKey && !evento.ctrlKey && !evento.metaKey && evento.key.toLowerCase() === 'n' && !editor.open) {
    evento.preventDefault();
    abrirNuevo();
  }
});

/** Un NIP al azar que cumple las reglas (ni repetido ni secuencia); la unicidad se comprueba al guardar. */
function nipAlAzar() {
  for (;;) {
    const nip = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    if (!validarNIP(nip)) return nip;
  }
}
$('btn-generar').addEventListener('click', () => {
  const nip = nipAlAzar();
  $('e-secreto').value = nip;
  $('e-secreto2').value = nip;
  const salida = $('nip-generado');
  salida.hidden = false;
  salida.textContent = `NIP: ${nip} · anótalo para entregarlo`;
});

/** Lee y valida el NIP por duplicado. */
function leerNip() {
  const a = $('e-secreto').value.trim();
  const b = $('e-secreto2').value.trim();
  const error = validarNIP(a);
  if (error) throw fallo(error, $('e-secreto'));
  if (a !== b) throw fallo('Los dos NIP no coinciden.', $('e-secreto2'));
  return a;
}

async function registrar() {
  const nombre = $('e-nombre').value.trim();
  if (nombre === '') throw fallo('Escribe el nombre.', $('e-nombre'));
  const correo = leerCorreo();
  const nip = leerNip();
  await correoLibre(correo);
  const huella = await huellaLibre(nip);
  const codigo = siguienteCodigo([...fichas.keys()]);
  // 1) la cuenta (si una versión anterior quedó huérfana se usa la siguiente); 2) todo lo demás en un lote
  const cuenta = await crearCuentaDeCodigo(codigo, nip);
  const ficha = armarFichaPersonal({
    usuario: codigo, tipo: 'codigo', correoAuth: cuenta.correoAuth, cuentaVersion: cuenta.cuentaVersion,
    nombre, rol: $('e-rol').value, tienda: $('e-tienda').value || null, correo, catalogo: $('e-catalogo').checked,
  }, yo.usuario);
  const errores = validarFichaPersonal(ficha);
  if (errores.length > 0) throw new Error(errores.join(' '));
  const referencia = doc(db, 'staff', codigo);
  await runTransaction(db, async (transaccion) => {
    if ((await transaccion.get(referencia)).exists()) throw Object.assign(new Error(`El número ${codigo} ya está registrado. Vuelve a intentarlo.`), { code: 'catalogo/duplicado' });
    const marca = ahora();
    transaccion.set(referencia, { ...ficha, creadoEn: marca, actualizadoEn: marca });
    transaccion.set(doc(db, 'accesos', codigo), { version: ficha.cuentaVersion });
    transaccion.set(doc(db, 'correos', correo), { codigo });
    transaccion.set(doc(db, 'nips', huella), { codigo, version: ficha.cuentaVersion });
  });
  return `${nombre} registrado. Entra en la caja con su NIP y en la consulta y el Catálogo con ${correo} y su NIP.`;
}

async function guardarEdicion() {
  const actual = estado.actual;
  const nombre = $('e-nombre').value.trim();
  if (nombre === '') throw fallo('Escribe el nombre.', $('e-nombre'));
  const porCodigo = tipoDe(actual) === 'codigo';
  const correo = porCodigo ? leerCorreo() : correoDe(actual);
  const correoAnterior = porCodigo ? (actual.correo ?? null) : null;
  if (porCodigo && correo !== correoAnterior) await correoLibre(correo, actual.id);
  const ficha = completar(actual, {
    nombre,
    rol: $('e-rol').disabled ? actual.rol : $('e-rol').value,
    tienda: $('e-tienda').value || null,
    catalogo: $('e-catalogo').checked,
    correo,
  });
  const errores = validarFichaPersonal(ficha);
  if (errores.length > 0) throw new Error(errores.join(' '));
  const lote = loteFicha(ficha);
  if (porCodigo && correo !== correoAnterior) {
    if (correoAnterior) {
      const anterior = await getDoc(doc(db, 'correos', correoAnterior));
      if (anterior.exists() && anterior.data().codigo === actual.id) lote.delete(doc(db, 'correos', correoAnterior));
    }
    lote.set(doc(db, 'correos', correo), { codigo: actual.id });
  }
  await lote.commit();
  return `${ficha.nombre} guardado.`;
}

async function cambiarNip() {
  const actual = estado.actual;
  const nip = leerNip();
  const huella = await huellaLibre(nip, actual.id);
  const anteriores = await getDocs(query(collection(db, 'nips'), where('codigo', '==', actual.id)));
  const cuenta = await crearCuentaDeCodigo(actual.id, nip, (actual.cuentaVersion ?? 1) + 1);
  const ficha = completar(actual, { correoAuth: cuenta.correoAuth, cuentaVersion: cuenta.cuentaVersion });
  const lote = loteFicha(ficha);
  anteriores.forEach((d) => lote.delete(d.ref));
  lote.set(doc(db, 'nips', huella), { codigo: actual.id, version: ficha.cuentaVersion });
  await lote.commit();
  return `NIP de ${actual.nombre ?? actual.id} cambiado. El anterior ya no sirve.${actual.correo ? '' : ' Falta su correo: edítalo para que pueda entrar a la consulta y al Catálogo.'}`;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (estado.guardando) return;
  estado.guardando = true;
  btnGuardar.disabled = true;
  avisoEnEditor('');
  try {
    const texto = estado.modo === 'crear' ? await registrar() : estado.modo === 'nip' ? await cambiarNip() : await guardarEdicion();
    editor.close();
    mostrar(mensaje, 'ok', texto);
    avisar(texto, 'ok');
  } catch (error) {
    avisoEnEditor(error?.code && !String(error.code).startsWith('catalogo/') ? mensajeError(error) : error.message);
    error.campo?.focus();
  } finally {
    estado.guardando = false;
    btnGuardar.disabled = false;
  }
});
