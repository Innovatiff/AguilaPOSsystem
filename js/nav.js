/**
 * Barra de navegación de la app (gris oscuro): secciones, usuario y salida.
 */
import { cerrarSesion } from './auth.js';

const SECCIONES = [
  { href: 'index.html', texto: 'Inicio' },
  { href: 'prueba-etiquetas.html', texto: 'Prueba de etiquetas' },
  { href: 'administracion.html', texto: 'Administración', soloAdmin: true },
];

const NOMBRE_ROL = { admin: 'administrador', empleado: 'empleado' };

/**
 * @param {{ personal: {nombre: string, rol: string, email: string}, activa: string }} opciones
 */
export function pintarNavegacion({ personal, activa }) {
  const encabezado = document.getElementById('navegacion');
  if (!encabezado) return;
  encabezado.replaceChildren();

  const marca = document.createElement('a');
  marca.className = 'marca';
  marca.href = 'index.html';
  marca.textContent = 'Catálogo Águila';

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Secciones');
  for (const seccion of SECCIONES) {
    if (seccion.soloAdmin && personal.rol !== 'admin') continue;
    const enlace = document.createElement('a');
    enlace.href = seccion.href;
    enlace.textContent = seccion.texto;
    if (seccion.href === activa) enlace.setAttribute('aria-current', 'page');
    nav.append(enlace);
  }

  const usuario = document.createElement('div');
  usuario.className = 'usuario';
  const nombre = document.createElement('span');
  nombre.textContent = `${personal.nombre} · ${NOMBRE_ROL[personal.rol] ?? personal.rol}`;
  nombre.title = personal.email;
  const salir = document.createElement('button');
  salir.type = 'button';
  salir.className = 'boton boton--secundario';
  salir.textContent = 'Cerrar sesión';
  salir.addEventListener('click', () => cerrarSesion());
  usuario.append(nombre, salir);

  encabezado.append(marca, nav, usuario);
}
