/**
 * Gestión · Tiendas (solo administradores). Documentos completos con setDoc:
 * las reglas exigen los campos exactos del esquema.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { db, doc, setDoc, collection, query, orderBy, onSnapshot } from './firebase.js';
import { normalizarTexto } from './esquema.js';

const { personal } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal, activa: 'gestion/tiendas.html', app: 'gestion' });
document.getElementById('contenido').hidden = false;

const $ = (id) => document.getElementById(id);

function mostrar(elemento, tipo, texto) {
  elemento.textContent = texto;
  elemento.className = `mensaje mensaje--${tipo}`;
  elemento.hidden = !texto;
}

function boton(texto, alPulsar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'boton boton--pequeno';
  b.textContent = texto;
  b.addEventListener('click', alPulsar);
  return b;
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto;
  return td;
}

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
