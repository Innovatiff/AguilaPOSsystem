/**
 * Back office · Tiendas. Documentos completos con setDoc: las reglas exigen
 * los campos del esquema. Teléfono, correo y número de impuesto son los datos
 * del encabezado de los recibos de la caja.
 *
 * La columna Productos cuenta cuántos productos del catálogo están en cada
 * tienda. «Todos los productos aquí» deja cada producto solo en esa tienda
 * (tiendas = [id]): para cuando todo se vende en una sola tienda.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { db, doc, setDoc, collection, query, orderBy, onSnapshot } from './firebase.js';
import { normalizarTexto, productosDeTienda } from './esquema.js';
import { observarCatalogo, dejarEnTienda } from './productos.js';
import { t, numero } from './idioma.js';

const { personal } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal, activa: 'gestion/tiendas.html' });
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

function celda(texto, clase = '') {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

const formTienda = $('form-tienda');
const tNombre = $('t-nombre');
const tId = $('t-id');
const tDireccion = $('t-direccion');
const tTelefono = $('t-telefono');
const tCorreo = $('t-correo');
const tImpuesto = $('t-impuesto');
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
  tGuardar.textContent = editando ? t('Guardar cambios') : t('Agregar');
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
  const tienda = {
    nombre: tNombre.value.trim(),
    direccion: tDireccion.value.trim(),
    activo: tActivo.checked,
    telefono: tTelefono.value.trim(),
    correo: tCorreo.value.trim(),
    numeroImpuesto: tImpuesto.value.trim(),
  };
  tGuardar.disabled = true;
  mostrar(tMensaje, '', '');
  try {
    await setDoc(doc(db, 'stores', id), tienda);
    mostrar(tMensaje, 'ok', t('Tienda {nombre} guardada.', { nombre: tienda.nombre }));
    modoTienda(null);
    tNombre.focus();
  } catch (error) {
    mostrar(tMensaje, 'error', mensajeError(error));
  } finally {
    tGuardar.disabled = false;
  }
});

// ------------------------------------------------------------- todos los productos en una tienda

const pMensaje = $('p-mensaje');
let tiendas = []; // { id, ...datos } en el orden de la tabla
let catalogo = null; // Map id → producto, cuando ya llegó del servidor al menos una vez
let moviendo = null; // id de la tienda a la que se están pasando los productos

window.addEventListener('beforeunload', (evento) => {
  if (!moviendo) return;
  evento.preventDefault();
  evento.returnValue = '';
});

async function todosAqui(id, tienda) {
  if (moviendo || !catalogo) return;
  const { total, faltan } = productosDeTienda([...catalogo.values()], id);
  if (faltan.length === 0) return;
  if (!window.confirm(t('¿Dejar todos los productos solo en {tienda}? Cambios: {n} de {total} productos. Quedan en esta tienda y en ninguna otra; los precios y lo demás no cambian.', { tienda: tienda.nombre, n: numero(faltan.length), total: numero(total) }))) return;
  moviendo = id;
  pintarTiendas();
  mostrar(pMensaje, 'info', t('Guardando {hechos} de {n}…', { hechos: 0, n: numero(faltan.length) }));
  try {
    const resumen = await dejarEnTienda(faltan, id, personal.usuario, (avance) => {
      mostrar(pMensaje, 'info', t('Guardando {hechos} de {n}…', { hechos: numero(avance.hechos), n: numero(avance.total) }));
    });
    if (resumen.fallidos.length > 0) {
      const nombres = resumen.fallidos.slice(0, 10).map(({ producto }) => producto.nombre || producto.upc || producto.id);
      mostrar(pMensaje, 'error', t('Cambiados: {hechos}. No se pudieron cambiar ({n}): {nombres}', {
        hechos: numero(resumen.confirmados + resumen.pendientes),
        n: numero(resumen.fallidos.length),
        nombres: `${nombres.join(', ')}${resumen.fallidos.length > nombres.length ? '…' : ''}`,
      }));
    } else {
      const listo = t('Listo: todos los productos están solo en {tienda}. Cambiados: {n}.', { tienda: tienda.nombre, n: numero(resumen.total) });
      mostrar(pMensaje, 'ok', resumen.pendientes > 0 ? `${listo} ${t('Sin señal: se enviará en cuanto vuelva.')}` : listo);
    }
  } catch (error) {
    mostrar(pMensaje, 'error', t('No se pudieron cambiar los productos: {error}', { error: mensajeError(error) }));
  } finally {
    moviendo = null;
    pintarTiendas();
  }
}

/** La celda Productos y, si faltan, el botón «Todos los productos aquí». */
function productosDeLaFila(id, tienda) {
  if (!catalogo) return { texto: '…', boton: null };
  const { total, enTienda, faltan } = productosDeTienda([...catalogo.values()], id);
  const texto = t('{n} de {total}', { n: numero(enTienda), total: numero(total) });
  if (!tienda.activo || faltan.length === 0) return { texto, boton: null };
  const b = boton(moviendo === id ? t('Guardando…') : t('Todos los productos aquí'), () => todosAqui(id, tienda));
  b.disabled = Boolean(moviendo);
  return { texto, boton: b };
}

function pintarTiendas() {
  const cuerpo = $('tabla-tiendas').querySelector('tbody');
  cuerpo.replaceChildren();
  tiendas.forEach(({ id, ...tienda }) => {
    const fila = document.createElement('tr');
    if (!tienda.activo) fila.className = 'inactivo';
    const contacto = [tienda.telefono, tienda.correo, tienda.numeroImpuesto ? `HST ${tienda.numeroImpuesto}` : ''].filter(Boolean).join(' · ');
    const productos = productosDeLaFila(id, tienda);
    fila.append(celda(id), celda(tienda.nombre), celda(tienda.direccion), celda(contacto || '—'), celda(productos.texto, 'num'), celda(tienda.activo ? t('Activa') : t('Inactiva')));
    const acciones = document.createElement('td');
    acciones.className = 'acciones-fila';
    acciones.append(
      boton(t('Editar'), () => {
        modoTienda(id);
        tId.value = id;
        tNombre.value = tienda.nombre;
        tDireccion.value = tienda.direccion;
        tTelefono.value = tienda.telefono ?? '';
        tCorreo.value = tienda.correo ?? '';
        tImpuesto.value = tienda.numeroImpuesto ?? '';
        tActivo.checked = tienda.activo;
        tNombre.focus();
      }),
      boton(tienda.activo ? t('Desactivar') : t('Activar'), async () => {
        try {
          await setDoc(doc(db, 'stores', id), { ...tienda, activo: !tienda.activo });
        } catch (error) {
          mostrar(tMensaje, 'error', mensajeError(error));
        }
      }),
    );
    if (productos.boton) acciones.append(productos.boton);
    fila.append(acciones);
    cuerpo.append(fila);
  });
}

onSnapshot(query(collection(db, 'stores'), orderBy('nombre')), (resultado) => {
  tiendas = resultado.docs.map((documento) => ({ id: documento.id, ...documento.data() }));
  pintarTiendas();
}, (error) => mostrar(tMensaje, 'error', mensajeError(error)));

// Los conteos y el botón esperan al catálogo del servidor: con el de la caché
// (quizá viejo) se podría dejar fuera algún producto.
observarCatalogo(({ catalogo: mapa, desdeCache }) => {
  if (desdeCache && !catalogo) return;
  catalogo = mapa;
  pintarTiendas();
}, (error) => mostrar(pMensaje, 'error', t('No se pudo cargar el catálogo: {error}', { error: mensajeError(error) })));
