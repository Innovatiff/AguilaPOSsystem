import { requerirPersonal } from './auth.js';
import { pintarNavegacion } from './nav.js';

const { personal } = await requerirPersonal();
pintarNavegacion({ personal, activa: 'index.html' });

document.getElementById('saludo').textContent = `Hola, ${personal.nombre}`;
document.getElementById('tarjeta-gestion').hidden = personal.rol !== 'admin';

const aviso = document.getElementById('aviso');
if (new URLSearchParams(window.location.search).get('aviso') === 'solo-admin') {
  aviso.textContent = 'Esa sección es solo para administradores.';
  aviso.className = 'mensaje mensaje--error';
  aviso.hidden = false;
}
document.getElementById('contenido').hidden = false;
