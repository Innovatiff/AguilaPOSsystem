/**
 * Gestión · Resumen (solo administradores): indicadores y accesos.
 * Si la ficha del propio gerente es anterior a Gestión, se completa aquí.
 */
import { requerirPersonal, mensajeError } from './auth.js';
import { pintarNavegacion } from './nav.js';
import { avisar } from './avisos.js';
import { observarCatalogo, observarTiendas } from './productos.js';
import { pendienteImpresion } from './esquema.js';
import { armarFichaPersonal } from './identidad.js';
import { db, doc, setDoc, collection, onSnapshot, Timestamp } from './firebase.js';

const { personal } = await requerirPersonal({ soloAdmin: true });
pintarNavegacion({ personal, activa: 'gestion/index.html', app: 'gestion' });

const $ = (id) => document.getElementById(id);
$('saludo').textContent = `Hola, ${personal.nombre}`;
$('contenido').hidden = false;

observarCatalogo(
  ({ catalogo }) => {
    let activos = 0;
    let pendientes = 0;
    for (const p of catalogo.values()) {
      if (!p.activo) continue;
      activos += 1;
      if (pendienteImpresion(p)) pendientes += 1;
    }
    $('ind-productos').textContent = String(activos);
    $('ind-pendientes').textContent = String(pendientes);
  },
  (error) => avisar(`No se pudo cargar el catálogo: ${mensajeError(error)}`, 'error', 0),
);

observarTiendas(
  (tiendas) => { $('ind-tiendas').textContent = String(tiendas.filter((t) => t.activo).length); },
  (error) => avisar(`No se pudieron cargar las tiendas: ${mensajeError(error)}`, 'error', 0),
);

onSnapshot(
  collection(db, 'staff'),
  (resultado) => { $('ind-empleados').textContent = String(resultado.docs.filter((d) => d.data().activo === true).length); },
  (error) => avisar(`No se pudo cargar el personal: ${mensajeError(error)}`, 'error', 0),
);

// Ficha anterior a Gestión (solo nombre, rol, activo): se completa una vez, sin cambiar nada más.
if (!personal.completa) {
  const ahora = Timestamp.fromMillis(Date.now());
  const ficha = { ...armarFichaPersonal({ usuario: personal.usuario, tipo: 'correo', nombre: personal.nombre, rol: personal.rol, activo: true, tienda: personal.tienda }, personal.usuario), creadoEn: ahora, actualizadoEn: ahora };
  setDoc(doc(db, 'staff', personal.usuario), ficha).catch((error) => avisar(`No se pudo completar tu ficha: ${mensajeError(error)}`, 'error', 0));
}
