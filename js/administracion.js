/**
 * Administración (solo admin): personal con acceso y tiendas.
 * Escrituras con setDoc de documentos completos: las reglas exigen los
 * campos exactos del esquema.
 */
import { requerirPersonal, crearCuentaAcceso, enviarRestablecimiento, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { db, doc, setDoc, collection, query, orderBy, onSnapshot } from './firebase.js';
import { normalizarTexto, ROLES } from './esquema.js';

const { personal: yo } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal: yo, activa: 'administracion.html' });
document.getElementById('contenido').hidden = false;

const $ = (id) => document.getElementById(id);
const NOMBRE_ROL = { admin: 'Administrador', empleado: 'Empleado' };

function mostrar(elemento, tipo, texto) {
  elemento.textContent = texto;
  elemento.className = `mensaje mensaje--${tipo}`;
  elemento.hidden = !texto;
}

function boton(texto, alPulsar, clase = 'boton boton--pequeno') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = clase;
  b.textContent = texto;
  b.addEventListener('click', alPulsar);
  return b;
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

// ---------------------------------------------------------------- Personal
const formPersonal = $('form-personal');
const pCorreo = $('p-correo');
const pNombre = $('p-nombre');
const pRol = $('p-rol');
const pContrasena = $('p-contrasena');
const pActivo = $('p-activo');
const pGuardar = $('p-guardar');
const pCancelar = $('p-cancelar');
const pMensaje = $('p-mensaje');
let editandoPersonal = null; // correo en edición

function modoPersonal(correoEnEdicion) {
  editandoPersonal = correoEnEdicion;
  const editando = correoEnEdicion !== null;
  pCorreo.readOnly = editando;
  $('campo-contrasena').hidden = editando;
  pGuardar.textContent = editando ? 'Guardar cambios' : 'Agregar';
  pCancelar.hidden = !editando;
  if (!editando) {
    formPersonal.reset();
    pActivo.checked = true;
  }
}

pCancelar.addEventListener('click', () => modoPersonal(null));

formPersonal.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!formPersonal.reportValidity()) return;
  const correo = pCorreo.value.trim().toLowerCase();
  const ficha = { nombre: pNombre.value.trim(), rol: pRol.value, activo: pActivo.checked };
  if (!ROLES.includes(ficha.rol)) return;

  pGuardar.disabled = true;
  mostrar(pMensaje, '', '');
  try {
    let notaCuenta = '';
    if (editandoPersonal === null) {
      const contrasena = pContrasena.value;
      if (contrasena.length < 8) {
        mostrar(pMensaje, 'error', 'La contraseña inicial debe tener al menos 8 caracteres.');
        pContrasena.focus();
        return;
      }
      const resultado = await crearCuentaAcceso(correo, contrasena);
      notaCuenta = resultado === 'existente' ? ' La cuenta de acceso ya existía; se conserva su contraseña.' : ' Cuenta de acceso creada.';
    }
    await setDoc(doc(db, 'staff', correo), ficha);
    mostrar(pMensaje, 'ok', `${ficha.nombre} guardado.${notaCuenta}`);
    modoPersonal(null);
    pCorreo.focus();
  } catch (error) {
    mostrar(pMensaje, 'error', mensajeError(error));
  } finally {
    pGuardar.disabled = false;
  }
});

async function cambiarActivo(correo, ficha, activo) {
  try {
    await setDoc(doc(db, 'staff', correo), { nombre: ficha.nombre, rol: ficha.rol, activo });
    mostrar(pMensaje, 'ok', `${ficha.nombre} ${activo ? 'activado' : 'desactivado'}.`);
  } catch (error) {
    mostrar(pMensaje, 'error', mensajeError(error));
  }
}

async function restablecer(correo) {
  try {
    await enviarRestablecimiento(correo);
    mostrar(pMensaje, 'ok', `Correo de restablecimiento enviado a ${correo}.`);
  } catch (error) {
    mostrar(pMensaje, 'error', mensajeError(error));
  }
}

onSnapshot(query(collection(db, 'staff'), orderBy('nombre')), (resultado) => {
  const cuerpo = $('tabla-personal').querySelector('tbody');
  cuerpo.replaceChildren();
  resultado.forEach((documento) => {
    const ficha = documento.data();
    const correo = documento.id;
    const fila = document.createElement('tr');
    if (!ficha.activo) fila.className = 'inactivo';
    fila.append(celda(correo), celda(ficha.nombre), celda(NOMBRE_ROL[ficha.rol] ?? ficha.rol), celda(ficha.activo ? 'Activo' : 'Inactivo'));
    const acciones = document.createElement('td');
    acciones.className = 'acciones-fila';
    acciones.append(
      boton('Editar', () => {
        modoPersonal(correo);
        pCorreo.value = correo;
        pNombre.value = ficha.nombre;
        pRol.value = ficha.rol;
        pActivo.checked = ficha.activo;
        pNombre.focus();
      }),
    );
    if (correo !== yo.email) {
      acciones.append(boton(ficha.activo ? 'Desactivar' : 'Activar', () => cambiarActivo(correo, ficha, !ficha.activo)));
    }
    acciones.append(boton('Restablecer contraseña', () => restablecer(correo)));
    fila.append(acciones);
    cuerpo.append(fila);
  });
}, (error) => mostrar(pMensaje, 'error', mensajeError(error)));

// ----------------------------------------------------------------- Tiendas
const formTienda = $('form-tienda');
const tNombre = $('t-nombre');
const tId = $('t-id');
const tDireccion = $('t-direccion');
const tActivo = $('t-activo');
const tGuardar = $('t-guardar');
const tCancelar = $('t-cancelar');
const tMensaje = $('t-mensaje');
let editandoTienda = null;

export function identificadorTienda(nombre) {
  return normalizarTexto(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

tNombre.addEventListener('input', () => {
  if (editandoTienda === null && !tId.dataset.manual) tId.value = identificadorTienda(tNombre.value);
});
tId.addEventListener('input', () => {
  tId.dataset.manual = tId.value ? '1' : '';
});

function modoTienda(idEnEdicion) {
  editandoTienda = idEnEdicion;
  const editando = idEnEdicion !== null;
  tId.readOnly = editando;
  tGuardar.textContent = editando ? 'Guardar cambios' : 'Agregar';
  tCancelar.hidden = !editando;
  if (!editando) {
    formTienda.reset();
    tActivo.checked = true;
    tId.dataset.manual = '';
  }
}

tCancelar.addEventListener('click', () => modoTienda(null));

formTienda.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!formTienda.reportValidity()) return;
  const id = tId.value.trim();
  const tienda = { nombre: tNombre.value.trim(), direccion: tDireccion.value.trim(), activo: tActivo.checked };
  tGuardar.disabled = true;
  mostrar(tMensaje, '', '');
  try {
    await setDoc(doc(db, 'stores', id), tienda);
    mostrar(tMensaje, 'ok', `Tienda ${tienda.nombre} guardada.`);
    modoTienda(null);
    tNombre.focus();
  } catch (error) {
    mostrar(tMensaje, 'error', mensajeError(error));
  } finally {
    tGuardar.disabled = false;
  }
});

onSnapshot(query(collection(db, 'stores'), orderBy('nombre')), (resultado) => {
  const cuerpo = $('tabla-tiendas').querySelector('tbody');
  cuerpo.replaceChildren();
  resultado.forEach((documento) => {
    const tienda = documento.data();
    const fila = document.createElement('tr');
    if (!tienda.activo) fila.className = 'inactivo';
    fila.append(celda(documento.id), celda(tienda.nombre), celda(tienda.direccion), celda(tienda.activo ? 'Activa' : 'Inactiva'));
    const acciones = document.createElement('td');
    acciones.className = 'acciones-fila';
    acciones.append(
      boton('Editar', () => {
        modoTienda(documento.id);
        tId.value = documento.id;
        tNombre.value = tienda.nombre;
        tDireccion.value = tienda.direccion;
        tActivo.checked = tienda.activo;
        tNombre.focus();
      }),
      boton(tienda.activo ? 'Desactivar' : 'Activar', async () => {
        try {
          await setDoc(doc(db, 'stores', documento.id), { ...tienda, activo: !tienda.activo });
        } catch (error) {
          mostrar(tMensaje, 'error', mensajeError(error));
        }
      }),
    );
    fila.append(acciones);
    cuerpo.append(fila);
  });
}, (error) => mostrar(tMensaje, 'error', mensajeError(error)));
