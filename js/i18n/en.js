/**
 * Diccionario inglés completo (js/idioma.js lo carga solo cuando el idioma
 * es inglés). Cada área tiene su archivo; una misma clave en dos archivos
 * debe traducirse igual (lo comprueba pruebas/unitarias/idioma.test.mjs).
 */
import { COMUN } from './en-comun.js';
import { CAJA } from './en-caja.js';
import { BACKOFFICE } from './en-backoffice.js';
import { CATALOGO } from './en-catalogo.js';
import { ADMIN } from './en-admin.js';

export const AREAS = Object.freeze({ COMUN, CAJA, BACKOFFICE, CATALOGO, ADMIN });
export const EN = Object.freeze({ ...COMUN, ...CAJA, ...BACKOFFICE, ...CATALOGO, ...ADMIN });
