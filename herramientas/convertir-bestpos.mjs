#!/usr/bin/env node
/**
 * BestPOS → Catálogo Águila.
 *
 * Convierte el reporte "Inventory List" de BestPOS (exportado a CSV desde
 * Excel: campos separados por ";") en el CSV que importa Gestión →
 * Importar / exportar, y deja un archivo de revisión con cada decisión.
 *
 *   node herramientas/convertir-bestpos.mjs Rapport.csv --tienda=talbot [--salida=carpeta]
 *
 * --tienda es el identificador de la tienda en Gestión → Tiendas; sin él los
 * productos entran sin tienda (se puede reimportar después con la columna llena).
 *
 * Qué hace con cada fila:
 *  - Código: UPC-A (12), EAN-13 (13) y UPC-E (8) se normalizan y se comprueba
 *    el dígito de control (js/upca.js). Los de 4-5 dígitos son PLU internos.
 *    Códigos pegados por una doble lectura (15-16 dígitos) se recortan al
 *    primer código válido y se marcan para verificar. Un código inválido no
 *    impide importar el producto: entra sin código y queda anotado.
 *  - Descripción: se separa la presentación (tamaño al final: 591ml, 2 Lbs
 *    (907g), 6packs 406g…) y la marca (lista de marcas y primeras palabras
 *    frecuentes en el propio archivo); el resto es el nombre.
 *  - Precio: la columna "#1 Price" en centavos. Sin precio o en cero, el
 *    producto se excluye y se lista.
 *  - Clase fiscal: el reporte no la trae. Se propone por palabras clave
 *    (no comestibles, gaseosas, golosinas, porciones individuales → gravado;
 *    lo demás → tasa cero) y se explica el motivo para revisarla.
 *  - Todos los productos entran activos, por pieza, en la tienda indicada.
 * Sin dependencias: reutiliza los módulos de la app.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizarUPC } from '../js/upca.js';
import { aCSV, deCSV, planificarImportacion } from '../js/csv.js';
import { normalizarTexto } from '../js/esquema.js';

// ------------------------------------------------------------- argumentos
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--'));
const opcion = (nombre, porDefecto) => (args.find((a) => a.startsWith(`--${nombre}=`)) ?? `=${porDefecto}`).split('=').slice(1).join('=');
const tienda = opcion('tienda', '');
const salida = opcion('salida', 'migracion');
if (!archivo) {
  console.error('Uso: node herramientas/convertir-bestpos.mjs <Rapport.csv> --tienda=<identificador> [--salida=<carpeta>]');
  process.exit(1);
}
if (tienda !== '' && !/^[a-z0-9-]{2,40}$/.test(tienda)) {
  console.error('--tienda debe ser el identificador de la tienda tal como aparece en Gestión → Tiendas (minúsculas, números y guiones).');
  process.exit(1);
}
if (tienda === '') console.error('Aviso: sin --tienda los productos se importan sin tienda asignada.');
mkdirSync(salida, { recursive: true });

// ------------------------------------------------------------- lectura del reporte
function leerReporte(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const inicio = lineas.findIndex((l) => /^"?Product No\./i.test(l));
  if (inicio < 0) throw new Error('No encuentro la fila de encabezados ("Product No.;Supplier Number;Description;…").');
  const desentrecomillar = (l) => {
    let t = l.replace(/,+$/, ''); // Excel añade comas de relleno
    if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).replace(/""/g, '"'); // línea entera entrecomillada
    return t;
  };
  const cabeceras = desentrecomillar(lineas[inicio]).split(';').map((c) => c.trim());
  const filas = [];
  for (const linea of lineas.slice(inicio + 1)) {
    if (!linea.trim()) continue;
    let campos = desentrecomillar(linea).split(';');
    while (campos.length > cabeceras.length && campos[campos.length - 1].trim() === '') campos.pop();
    if (campos.length > cabeceras.length) {
      // la descripción traía ";" (fórmulas de Excel): se vuelve a unir
      const extra = campos.length - cabeceras.length;
      campos = [...campos.slice(0, 2), campos.slice(2, 3 + extra).join(' '), ...campos.slice(3 + extra)];
    }
    const fila = Object.fromEntries(cabeceras.map((c, i) => [c, (campos[i] ?? '').trim()]));
    if (!fila['Product No.'] && /^total/i.test(fila.Description ?? '')) continue; // fila de totales
    filas.push(fila);
  }
  return { cabeceras, filas };
}

/** Limpia restos de fórmulas de Excel: ="…", comillas dobles como apóstrofo o pulgadas. */
function limpiarTexto(texto) {
  return String(texto ?? '')
    .replace(/([A-Za-z])""([A-Za-z])/g, "$1'$2")
    .replace(/(\d)"+([A-Za-z])/g, '$1" $2')
    .replace(/"/g, '')
    .replace(/^\s*=+\s*/, '')
    .replace(/(\d)\.(kg|kgs|lbs?|g|gr|ml|l|oz)\b/gi, '$1 $2') // "2.kg", "4.lbs"
    .replace(/([A-Za-z])(\d+(?:[.,]\d+)?)(ml|g|kg|l|oz|lbs?)\b/gi, '$1 $2$3') // "Peppers198g"
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------- códigos
function centavos(texto) {
  const t = String(texto ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Devuelve { upc, plu, tipo, avisos[], prefijo } a partir del código del POS. */
function interpretarCodigo(crudo) {
  const avisos = [];
  let codigo = String(crudo ?? '').replace(/[^0-9]/g, '');
  if (codigo === '') return { upc: null, plu: null, tipo: 'sin código', avisos: ['sin código en el POS'] };
  if (codigo.length <= 3) return { upc: null, plu: codigo.padStart(4, '0'), tipo: 'PLU', avisos: [`código corto "${codigo}": se usa como PLU ${codigo.padStart(4, '0')}`] };
  if (codigo.length <= 5) return { upc: null, plu: codigo, tipo: 'PLU', avisos };
  // Etiqueta GS1 DataBar / GS1-128 leída con el identificador (01) + GTIN-14: 16 dígitos que empiezan por 01.
  if (codigo.length === 16 && codigo.startsWith('01')) {
    const gtin14 = codigo.slice(2);
    if (gtin14.startsWith('0')) {
      try {
        const upc = normalizarUPC(gtin14.slice(1));
        return { upc, plu: null, tipo: upc.length === 13 ? 'EAN-13' : 'UPC-A', avisos: [`lectura GS1 (01)${gtin14}: el código del producto es ${upc}`] };
      } catch {
        // no era un GTIN-14 válido: se sigue como código largo
      }
    }
  }
  if (codigo.length === 14 && codigo.startsWith('0')) codigo = codigo.slice(1); // GTIN-14 de caja → EAN-13 / UPC-A
  if (codigo.length === 8 || codigo.length === 12 || codigo.length === 13) {
    try {
      const upc = normalizarUPC(codigo);
      if (codigo.length === 8) avisos.push(`UPC-E ${codigo} expandido a ${upc}`);
      return { upc, plu: null, tipo: upc.length === 13 ? 'EAN-13' : 'UPC-A', avisos };
    } catch (error) {
      return { upc: null, plu: null, tipo: 'inválido', avisos: [`código ${codigo} inválido (${error.message}); el producto entra sin código`] };
    }
  }
  if (codigo.length > 13) {
    // Doble lectura del escáner: un código completo seguido del principio de otro.
    for (const largo of [12, 13]) {
      try {
        const prefijo = normalizarUPC(codigo.slice(0, largo));
        return { upc: null, plu: null, tipo: 'doble lectura', avisos: [], prefijo, resto: codigo.slice(largo) };
      } catch {
        // probar el otro largo
      }
    }
  }
  return { upc: null, plu: null, tipo: 'inválido', avisos: [`código ${codigo} de ${codigo.length} dígitos no reconocido; el producto entra sin código`] };
}

/** Texto comparable de una descripción: minúsculas, sin acentos, sin tamaño ni signos. */
function claveDescripcion(descripcion) {
  return normalizarTexto(descripcion)
    .replace(/(\d)\s+(?=[a-z]{1,3}\b)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Coeficiente de Dice sobre bigramas de letras: 1 = iguales, 0 = nada en común. */
function parecido(a, b) {
  const bigramas = (t) => { const m = new Map(); for (let i = 0; i < t.length - 1; i += 1) { const bg = t.slice(i, i + 2); m.set(bg, (m.get(bg) ?? 0) + 1); } return m; };
  const A = bigramas(a.replace(/\s+/g, ''));
  const B = bigramas(b.replace(/\s+/g, ''));
  let comunes = 0;
  for (const [bg, n] of A) comunes += Math.min(n, B.get(bg) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * comunes) / total;
}

// ------------------------------------------------------------- descripción → marca, nombre, presentación
const UNIDADES = '(?:ml|mls|l|lt|ltr|lts|litro|litros|g|gr|grs|gms|gramos|kg|kgs|kilo|kilos|oz|onz|lb|lbs|libra|libras|qt|pk|pack|packs|packages|paquetes|paq|ct|pz|pzas|pza|piezas|pieza|pcs|pces|pc|und|unid|u|rollos|rolls|hojas|sheets|tabletas|tabs|sobres|bolsitas|cubos)';
const TOKEN_TAMANO = new RegExp(`^\\(?\\d+(?:[.,]\\d+)?\\s?${UNIDADES}\\)?\\.?$`, 'i');
const TOKEN_UNIDAD = new RegExp(`^\\(?${UNIDADES}\\)?\\.?$`, 'i');
const TOKEN_NUMERO = /^\(?\d+(?:[.,]\d+)?\)?\.?$/;
const TOKEN_PARENTESIS = new RegExp(`^\\(\\d+(?:[.,]\\d+)?\\s?${UNIDADES}\\)$`, 'i');

/** Separa la presentación (tamaño) del final de la descripción. */
function separarPresentacion(descripcion) {
  const tokens = descripcion.split(' ');
  const presentacion = [];
  while (tokens.length > 1) {
    const ultimo = tokens[tokens.length - 1];
    const penultimo = tokens[tokens.length - 2] ?? '';
    if (TOKEN_TAMANO.test(ultimo) || TOKEN_PARENTESIS.test(ultimo)) {
      presentacion.unshift(tokens.pop());
    } else if (TOKEN_UNIDAD.test(ultimo) && TOKEN_NUMERO.test(penultimo)) {
      presentacion.unshift(tokens.pop());
      presentacion.unshift(tokens.pop());
      if (/^fl$/i.test(tokens[tokens.length - 1] ?? '') && /^oz\.?$/i.test(presentacion[1] ?? '')) presentacion.unshift(tokens.pop());
    } else if (/^(net|neto|peso neto|cont\.?)$/i.test(ultimo) && presentacion.length > 0) {
      tokens.pop();
    } else {
      break;
    }
  }
  let texto = presentacion.join(' ').replace(/\.$/, '').replace(/(\d)\.(lbs?|kg)/i, '$1 $2');
  if (texto.length > 30) { // demasiado largo para la etiqueta: se queda en el nombre
    return { nombre: descripcion, presentacion: '' };
  }
  return { nombre: tokens.join(' ').trim(), presentacion: texto };
}

const MARCAS_MULTIPALABRA = [
  'moco de gorila', 'pelon pelo rico', 'de la rosa', 'ricitos de oro', 'old spice', 'speed stick', 'irish spring',
  'blanca nieves', 'maestro limpio', 'si senor', 'la costena', 'la moderna', 'mama lycha', 'la morena', 'verde valle',
  'del monte', 'del fuerte', 'el mexicano', 'la visita', 'la vaquita', 'suero oral', 'san marcos', 'san luis', 'san miguel',
  'la sierra', 'rio grande', 'el yucateco', 'el ideal', 'la sirena', 'dona maria', 'la helada', 'el corral', 'tio nacho',
  'mi pueblito', 'mi pueblo', 'la preferida', 'el pato', 'browns best', "brown's best", 'st.jude', 'st. jude', 'coca cola',
  'eddie bower', 'eddie bauer', 'la anita', 'durango foods', 'tres estrellas', 'red bull', 'el popular', 'el gallito',
  'el milagro', 'la lechera', 'la chatita', 'la guacamaya', 'la fe', 'la botanera', 'la fina', 'la villita', 'la gloria',
  'la abuela', 'el guapo', 'el dorado', 'santa maria', 'don pancho', 'dona chonita', 'la cocinera', 'el sabroso', 'tia rosa',
  'mama lupe', 'topo chico', 'mr big', 'dr pepper', 'big cola', 'big red', 'juicy chew', 'jamaican pride', 'carlos v',
  'sidral mundet', 'sangria senorial', 'manzanita sol', 'del valle', 'la lechera', 'santa clara', 'la huerta', 'el chinito',
  'la costeña', 'tapa roja', 'los altos', 'jugos del valle', 'mundo dulce', 'don julio', 'jose cuervo', 'la fama',
  'no name', 'don clemente', 'don sazon', 'dona blanca', 'san antonio', 'mama lucha', 'mama licha', 'mexico lindo', 'medi care',
  'tres estrella', 'eddie bawer', 'j cuervo', 'j.cuervo', 'g alteno', 'life goods', 'life good', 'los pericos', 'los portales',
  'las sevillanas', 'del frutal', 'el azteca', 'el caporal', 'black diamond', 'canada dry', "uncle ben's", 'uncle bens',
  'chef boyardee', "president's choice", 'robin hood', 'red vulcan', 'el sabor', 'la reina', 'dos pinos', 'el rey',
  'sol de mexico', 'la nuestra', 'la mejor', 'la tapatia', 'la tortilleria', 'el charro', 'don pepe', 'la dona', 'santa cruz', 'del molcajete',
  'pake taxo', 'hubba bubba', 'act ii', 'life savers', 'rosa venus', 'scotch brite', 'scotch-brite', 'tia rosa', 'jelly belly', 'chao mein',
];
const MARCAS = new Set([
  'gamesa', 'nestle', 'knorr', 'bimbo', 'maggi', "d'gari", 'dgari', 'jumex', 'marinela', 'cuetara', 'mccormick', 'mccormicl', 'axe',
  'diana', 'zuko', 'suavitel', 'ariel', 'electrolit', 'head&shoulders', 'penafiel', 'jarritos', 'maseca', 'malher', 'herdez',
  'lirio', 'savile', 'xtreme', 'fabuloso', 'downy', 'ego', '1-2-3', 'maruchan', 'lucas', 'vero', 'cloralen', 'nescafe', 'goya',
  'barcel', 'sedal', 'takis', 'suerox', 'pelon', 'manzela', 'roma', 'palmolive', 'kirkland', 'zest', 'supremo', 'maizena',
  'tadin', 'durango', 'chiky', 'ducal', 'zulka', 'gatorade', 'clamato', 'tropicana', 'sabritas', 'doritos', 'cheetos', 'ruffles',
  'tostitos', 'totis', 'foca', 'ace', 'armour', 'dole', 'karo', 'cholula', 'valentina', 'tapatio', 'huichol', 'bufalo', 'tajin',
  'squirt', 'fanta', 'sprite', 'pepsi', 'mirinda', 'boing', 'bonafont', 'ciel', 'lala', 'alpura', 'nido', 'nesquik', 'abuelita',
  'ibarra', 'ricolino', 'pulparindo', 'mazapan', 'gansito', 'principe', 'arcoiris', 'chokis', 'saladitas', 'marias', 'crackets',
  'churrumais', 'rancheritos', 'sabritones', 'paketaxo', 'fritos', 'lays', 'pringles', 'oreo', 'ritz', 'colgate', 'crest',
  'listerine', 'grisi', 'capullo', 'nutrioli', 'mazola', 'crisco', 'riceland', 'goicoechea', 'arachi', 'tampico', 'v8', 'motts',
  "mott's", 'quaker', 'nissin', 'doria', 'pinol', 'ensueno', 'vanish', 'salvo', 'axion', 'glade', 'raid', 'bic', 'duracell',
  'energizer', 'scott', 'kleenex', 'charmin', 'bounty', 'huggies', 'pampers', 'kotex', 'always', 'dove', 'nivea', 'ponds',
  'vaseline', 'jergens', 'suave', 'pantene', 'garnier', 'loreal', 'tresemme', 'gillette', 'schick', 'sensodyne', 'oral-b',
  'aquafresh', 'mennen', 'secret', 'degree', 'rexona', 'dial', 'lever', 'safeguard', 'protex', 'escudo', 'zote', 'viva',
  'clorox', 'lysol', 'ajax', 'dentyne', 'trident', 'halls', 'mentos', 'skittles', 'snickers', 'kitkat', 'aero', 'oxxo',
  'coronado', 'lala', 'fud', 'zwan', 'chata', 'dolores', 'rosarita', 'juanitas', "juanita's", 'embasa', 'clemente', 'isadora',
  'ibarra', 'nestle', 'lakymen', 'hershey', "hershey's", 'cadbury', 'nutella', 'jif', 'skippy', 'heinz', 'kraft', 'frenchs',
  'mccain', 'kelloggs', "kellogg's", 'cheerios', 'gerber', 'similac', 'enfamil', 'pedialyte', 'sensodyne',
  'tang', 'clight', 'zuko', 'klass', 'redbull', 'fresca', 'crush', 'schweppes',
  'lipton', 'nestea', 'arizona', 'snapple', 'welchs', "welch's", 'kool-aid', 'tang',
  'ferrero', 'lindt', 'toblerone', 'pepperidge', 'nabisco', 'keebler', 'dare', 'christie', 'voortman', 'kirkland', 'compliments',
  'bothwell', 'saputo', 'astro', 'danone', 'activia', 'yoplait', 'silk', 'natrel',
  'lactantia', 'becel', 'crisco', 'tenderflake', 'primo', 'unico', 'catelli',
  'barilla', 'roma', 'yemina', 'nissin', 'maruchan', 'sapporo', 'nongshim', 'lipton', 'campbells', "campbell's",
  'habitant', 'aylmer', 'hunts', "hunt's", 'mission', 'guerrero', 'chachis',
  'takis', 'barcel', 'runners', 'sazon', 'badia', 'adobo', 'mahatma', 'bens',
  'canilla', 'zulka', 'redpath', 'rogers', 'lantic', 'splenda', 'twin',
  'bacardi', 'corona', 'modelo', 'tecate', 'pacifico', 'victoria', 'equis', 'coors', 'molson', 'labatt',
  'jarritos', 'penafiel', 'ciel', 'bonafont', 'epura', 'joya', 'barrilitos',
  'pascual', 'boing', 'jumex', 'frutsi', 'bebe', 'gerber', 'tampico', 'v8', 'motts',
  'welchs', 'dole', 'tropicana', 'oasis', 'sun-rype', 'allen',
  'electrolit', 'suerox', 'pedialyte', 'gatorade', 'powerade', 'rockstar', 'amp',
]);
const GENERICAS = new Set(['chamoy', 'marias', 'maria', 'barritas', 'pinto', 'tres', 'don', 'dona', 'san', 'santa', 'mama', 'mexico', 'medi', 'chipotle', 'extra', 'mini', 'black', 'inca', 'mega', 'eddie',
  'desodorante', 'detergente', 'cepillo', 'gelatina', 'avena', 'panque', 'michelada', 'rosa', 'scotch', 'jelly', 'popping', 'choco', 'fruti', 'act', 'emperador',
  'pinguinos', 'chokis', 'principe', 'rancheritos', 'chocolatines', 'sazon', 'verde', 'chao', 'life', 'pake', 'wave', 'hubba', 'dulces', 'bebida', 'refresco', 'jugo',
  'la', 'el', 'los', 'las', 'de', 'del', 'con', 'sin', 'para', 'y', 'e', 'o', 'a', 'al', 'the', 'and', 'of', 'in', 'con',
  'salsa', 'salsas', 'chile', 'chiles', 'veladora', 'veladoras', 'sopa', 'sopas', 'frijol', 'frijoles', 'arroz', 'aceite', 'jabon', 'shampoo',
  'cookies', 'butter', 'corn', 'black', 'chopped', 'canela', 'comino', 'oregano', 'pimienta', 'clavo', 'semilla', 'semillas', 'hoja', 'hojas',
  'hola', 'nopal', 'nopales', 'cilantro', 'aguacate', 'avocado', 'avocados', 'epazote', 'jamaica', 'cacahuate', 'cacahuates', 'soya',
  'camaron', 'charales', 'tamarindo', 'fritura', 'frituras', 'chicharron', 'chicharrones', 'pepitoria', 'mayonesa', 'mayoneza', 'achiote',
  'coconut', 'nitrile', 'tuna', 'nacho', 'tortilla', 'tortillas', 'pan', 'queso', 'crema', 'leche', 'huevo', 'huevos', 'azucar', 'sal',
  'harina', 'masa', 'pasta', 'atole', 'cafe', 'te', 'galletas', 'galleta', 'dulce', 'dulces', 'paleta', 'paletas', 'chocolate', 'refresco',
  'agua', 'jugo', 'bebida', 'cerveza', 'vino', 'papel', 'bolsa', 'bolsas', 'plato', 'platos', 'vaso', 'vasos', 'cuchara', 'cucharas',
  'servilleta', 'servilletas', 'foam', 'plates', 'candle', 'candles', 'singles', 'original', 'sweet', 'mixed', 'mix', 'white', 'red',
  'green', 'juicy', 'chile', 'nuez', 'nueces', 'almendra', 'almendras', 'pistache', 'pepita', 'pepitas', 'ajo', 'cebolla', 'tomate',
  'jitomate', 'tomatillo', 'limon', 'lima', 'naranja', 'platano', 'mango', 'papaya', 'piña', 'pina', 'sandia', 'melon', 'uva', 'uvas',
  'manzana', 'pera', 'durazno', 'fresa', 'fresas', 'coco', 'guayaba', 'tuna', 'mamey', 'zapote', 'chayote', 'calabaza', 'calabacita',
  'elote', 'maiz', 'pozole', 'menudo', 'birria', 'barbacoa', 'carne', 'pollo', 'res', 'puerco', 'cerdo', 'pescado', 'camarones',
  'chorizo', 'longaniza', 'jamon', 'salchicha', 'salchichas', 'tocino', 'ham', 'cheese', 'milk', 'eggs', 'bread', 'rice', 'beans',
  'oil', 'sugar', 'salt', 'flour', 'water', 'juice', 'soda', 'candy', 'chips', 'cookie', 'cake', 'pie', 'ice', 'cream', 'frozen',
  'fresh', 'dried', 'seco', 'secos', 'seca', 'molido', 'molida', 'entero', 'entera', 'whole', 'ground', 'powder', 'polvo', 'liquid',
  'liquido', 'spray', 'gel', 'bar', 'barra', 'pack', 'paquete', 'caja', 'lata', 'botella', 'bote', 'frasco', 'sobre', 'bolsita',
  'mini', 'grande', 'chico', 'chica', 'mediano', 'extra', 'super', 'hot', 'picante', 'dulce', 'natural', 'light', 'diet', 'zero',
  'sin', 'con', 'sabor', 'flavor', 'flavour', 'mexican', 'mexicana', 'mexicano', 'style', 'estilo', 'tipo', 'homemade', 'casero',
  'total', 'nuevo', 'new', 'hot', 'cold', 'pica', 'suero', 'veladora', 'vela', 'incienso', 'chaqueta', 'boxer', 'shorts', 'socks',
  'gloves', 'lighter', 'earphone', 'earphones', 'cable', 'charger', 'travel', 'manicure', 'set', 'kit', 'jane', 'lori', 'i12',
  'chopped', 'cooked', 'sliced', 'diced', 'crushed', 'shredded', 'refried', 'baked', 'roasted', 'toasted', 'salted', 'unsalted',
  'sweetened', 'unsweetened', 'condensed', 'evaporated', 'instant', 'granulated', 'powdered', 'liquid', 'concentrated',
  'achiote', 'annatto', 'mole', 'adobo', 'recaudo', 'sazonador', 'consome', 'caldo', 'especias', 'spices', 'spice', 'seasoning']);

const normalizarMarca = (t) => normalizarTexto(t).replace(/[’']/g, "'");

/** Cuenta con qué frecuencia cada primera palabra abre una descripción: las repetidas suelen ser marcas. */
function frecuenciaPrimeraPalabra(nombres) {
  const cuenta = new Map();
  for (const n of nombres) {
    const primera = normalizarMarca(n).split(' ')[0];
    if (primera) cuenta.set(primera, (cuenta.get(primera) ?? 0) + 1);
  }
  return cuenta;
}

/** Separa la marca del nombre. Devuelve { marca, nombre }. */
function separarMarca(nombre, frecuencia) {
  const palabras = nombre.split(' ');
  const clave = normalizarMarca(nombre);
  for (const marca of [...MARCAS_MULTIPALABRA].sort((a, b) => b.length - a.length)) {
    const m = normalizarMarca(marca);
    if (clave === m || clave.startsWith(`${m} `)) {
      const n = m.split(' ').length;
      return { marca: palabras.slice(0, n).join(' '), nombre: palabras.slice(n).join(' ') };
    }
  }
  const primera = normalizarMarca(palabras[0] ?? '');
  const esMarca = primera.length >= 2
    && !GENERICAS.has(primera)
    && (MARCAS.has(primera) || (!/^\d/.test(primera) && (frecuencia.get(primera) ?? 0) >= 3));
  if (esMarca && palabras.length > 1) return { marca: palabras[0], nombre: palabras.slice(1).join(' ') };
  return { marca: '', nombre };
}

// ------------------------------------------------------------- clase fiscal (propuesta)
const LISTAS = {
  noComestible: ['blooming jasmine', 'flower essence', 'max power', 'maxi poder', 'bowl', 'bowls', 'alcan', 'axion', 'grooming', 'barbasol', 't-shirts', 't-shirt', 'tshirt', 'shirts', 'blanca nieves', 'pasamontanas', 'camay', 'caprice', 'chap stick', 'chapstick', 'lypsyl', 'cucharita', 'cucharitas', 'ensueno', 'febreze', 'gain', 'dryer sheets', 'dryer', 'bulbs', 'bulb', 'ampoules', 'peroxide', 'hydrogen', 'bath tissue', 'tissue', 'glue', 'la bodega', 'nuestra senora', 'nuestra sra', 'virgen', 'san judas', 'saint jude', 'st.jude', 'tadeo', 'caldero', 'press', 'griddle', 'comal', 'tortillera', 'prensa', 'multifuegos', 'straws', 'straw', 'popotes', 'popote', 'plenty', 'rosa venus', 'saba', 'pads', 'scotch brite', 'scotch-brite', 'scotties', 'scottiers', 'padlock', 'candado', 'sewing', 'tide', 'toothpicks', 'toothpick', 'palillos', 'oxy', 'quitamanchas', 'viva', 'wildroot', 'nordiko', 'ricitos de oro', 'goicoechea', 'goicochea', 'mr.clean', 'mr clean', 'maestro limpio', 'pijamas', 'pijama', 'pajamas', 'loteria', 'bingo', 'juego', 'game', 'roaster', 'spoons', 'forks', 'knives', 'cuchillos', 'tenedores', 'trapeador', 'mop', 'escoba', 'broom', 'esponja', 'sponge', 'fibra', 'medi care', 'bandages', 'curitas', 'garbage', 'basura', 'trash', 'ziploc', 'sandwich bags', 'freezer bags', 'lirio neutro', 'lirio dermatologico', 'lirio fueza', 'lirio fuerza', 'lirio tejidos', 'lirio soothing', 'lirio fresh', 'roma detergent', 'roma bar', 'jabon', 'soap', 'shampoo', 'acondicionador', 'conditioner', 'detergent', 'detergente', 'suavizante', 'suavitel', 'downy', 'ariel', 'foca', 'ace', 'cloralen', 'cloro', 'bleach', 'fabuloso', 'pinol', 'limpiador', 'cleaner', 'limpieza', 'desodorante', 'deodorant', 'axe', 'head&shoulders', 'sedal', 'savile', 'ego', 'xtreme', 'palmolive', 'zest', 'grisi', 'tio nacho', 'veladora', 'candle', 'vela', 'velas', 'lighter', 'encendedor', 'earphone', 'audifono', 'audifonos', 'gloves', 'guantes', 'manicure', 'papel', 'toilet', 'toalla', 'toallas', 'servilleta', 'servilletas', 'napkin', 'napkins', 'plato', 'platos', 'plates', 'foam', 'vaso', 'vasos', 'cups', 'cuchara', 'cucharas', 'tenedor', 'foil', 'aluminio', 'vaporera', 'comal', 'tortillero', 'shorts', 'boxer', 'socks', 'calcetines', 'camiseta', 'shirt', 'cinturon', 'gorra', 'pilas', 'battery', 'baterias', 'charger', 'cargador', 'cable', 'pomada', 'vitamin', 'vitaminas', 'medicina', 'pastillas', 'alka', 'aspirin', 'tylenol', 'advil', 'mentholatum', 'vicks', 'insecticida', 'raid', 'cigar', 'cigarros', 'tabaco', 'incienso', 'incense', 'pañal', 'panal', 'panales', 'diaper', 'diapers', 'toallitas', 'wipes', 'rastrillo', 'razor', 'locion', 'lotion', 'colonia', 'perfume', 'maquillaje', 'esmalte', 'peine', 'cepillo', 'brush', 'pasta dental', 'toothpaste', 'colgate', 'crest', 'enjuague', 'listerine', 'hilo dental', 'curitas', 'algodon', 'cotton', 'gel', 'moco de gorila', 'crema corporal', 'crema para', 'body', 'hair', 'cabello', 'zote', 'escudo', 'protex', 'dove', 'nivea', 'pond', 'vaseline', 'jergens', 'pantene', 'garnier', 'tresemme', 'gillette', 'schick', 'sensodyne', 'oral-b', 'kotex', 'always', 'tampax', 'huggies', 'pampers', 'kleenex', 'scott', 'charmin', 'bounty', 'glade', 'lysol', 'clorox', 'ajax', 'duracell', 'energizer', 'bic', 'travel', 'juguete', 'toy', 'globos', 'pinata', 'piñata', 'decoracion'],
  suero: ['suero oral', 'suera oral', 'pedialyte', 'suero', 'glucosoral'],
  gaseosaEnergetica: ['adrenaline', 'rap-tor', 'raptor', 'volt', 'vive100', 'vive 100', 'sangria', 'boost energy', 'pure life', 'coca', 'coke', 'pepsi', 'sprite', 'fanta', 'fresca', '7up', 'seven up', 'squirt', 'sidral', 'mundet', 'jarritos', 'penafiel', 'topo chico', 'mineral', 'agua mineral', 'ginger ale', 'canada dry', 'crush', 'mirinda', 'manzanita', 'sangria senorial', 'senorial', 'red bull', 'monster', 'amp energy', 'energy', 'energetica', 'gatorade', 'powerade', 'electrolit', 'suerox', 'soda', 'refresco', 'cola', 'big cola', 'joya', 'barrilitos', 'schweppes', 'dr pepper', 'mountain dew', 'nestea', 'arizona', 'snapple', 'sports drink', 'tonic'],
  golosinaBotana: ['miguelito', 'rellerindos', 'relleton', 'pulparindots', 'rockaleta', 'paletuvi', 'karameladas', 'popping', 'hi-chew', 'huevitos', 'kinder', 'twix', 'nucita', 'bon o bon', 'chocolatines', 'carlos v chocolate', 'bubbalo', 'excel', 'exel', 'mints', 'mintes', 'menthes', 'menthe', 'bubblemint', 'winterfresh', 'spearmint', 'wintermint', 'ticta', 'tictac', 'slaps', 'pigui', 'piguii', 'zumbazo', 'bolitochas', 'bombas surtidas', "canel's", 'picamix', 'cachepigui', 'tajitos', 'chilibonchas', 'chiclosos', 'monito', 'ricanuez', 'la vaquita mix', 'la vaquita rolls', 'paleton', 'banderilla', 'palanqueta', 'marshmallows', 'malvaviscos', 'obleas', 'chetos', 'crujitos', 'aritos', 'churritos', 'elotitos', 'palitos', 'quesitos', 'nachos', 'maiz chino', 'corn brigths', 'family mix', 'famuly mix', 'tortrix', 'ranchitas', 'zambos', 'manzela', 'manzelazo', 'japanese', 'pinatero', 'cracklings', 'picosones', 'cuadro palin', 'la visita', 'frit-os', 'oaketaxo', 'forritos', 'ya-cool', 'bubli', 'tricoco', 'dulce', 'dulces', 'candy', 'candies', 'lucas', 'pelon', 'vero', 'pulparindo', 'mazapan', 'de la rosa', 'bubu lubu', 'bubulubu', 'ricolino', 'duvalin', 'skwinkles', 'salsagheti', 'paleta', 'paletas', 'lollipop', 'chicle', 'chicles', 'gum', 'dentyne', 'trident', 'juicy', 'halls', 'mentos', 'tic tac', 'skittles', 'm&m', 'snickers', 'kit kat', 'kitkat', 'mr big', 'coffee crisp', 'aero', 'caramelo', 'caramelos', 'gomitas', 'gummy', 'gummies', 'jelly', 'marshmallow', 'bombon', 'bombones', 'malvavisco', 'chips', 'papas', 'sabritas', 'doritos', 'cheetos', 'ruffles', 'tostitos', 'fritos', 'lays', 'pringles', 'takis', 'barcel', 'churrumais', 'rancheritos', 'sabritones', 'paketaxo', 'chicharron', 'chicharrones', 'botana', 'botanas', 'botanero', 'fritura', 'frituras', 'palomitas', 'popcorn', 'pretzel', 'pretzels', 'helado', 'ice cream', 'paleta helada', 'bolis', 'nieve', 'popsicle', 'la helada', 'pica fresa', 'lagrimitas', 'tostachos', 'runners', 'chocolate bar', 'chocolate bars', 'mr. big', 'crunchy', 'chamoy', 'tamarindo candy', 'pica', 'rueda', 'ruedas', 'cacahuate japones', 'cacahuates japoneses', 'japones', 'enchilado', 'enchilados', 'mix botanero', 'party mix', 'sponch', 'gansito', 'pinguinos', 'submarinos', 'canelitas', 'chokis', 'donitas', 'nito', 'mantecadas', 'roles', 'conchas', 'panque', 'brownie', 'brownies', 'cupcake', 'muffin', 'pastel', 'cake', 'pay', 'pie', 'donut', 'donuts', 'dona', 'donas'],
  bebida: ['cocktail', 'clasmato', 'sangrita', 'jugo', 'jugos', 'juice', 'nectar', 'néctar', 'jumex', 'boing', 'del valle', 'tampico', 'v8', 'clamato', 'coconut water', 'agua de coco', 'agua', 'water', 'te helado', 'iced tea', 'lipton', 'bebida', 'drink', 'punch', 'ponche', 'limonada', 'lemonade', 'horchata', 'jamaica', 'leche', 'milk', 'yogurt', 'yogur', 'licuado', 'smoothie', 'cafe frio', 'frappe', 'kombucha', 'tropicana', 'minute maid', 'oasis', 'sunny d', 'capri', 'kool-aid', 'tang', 'clight', 'zuko', 'klass', 'frutsi'],
  bebidaDudosa: ['cocktail', 'jumex', 'boing', 'tampico', 'nectar', 'néctar', 'punch', 'ponche', 'drink', 'kool-aid', 'tang', 'clight', 'zuko', 'klass', 'frutsi', 'sunny d', 'oasis'],
  comestibleSeguro: ['manteca', 'cafe de olla', 'cafe', 'coffee', 'kit kat', 'cantarito', 'party mix', 'pulparindo', 'salsa', 'harina', 'frijol', 'masa', 'tortillas'],
  nuecesSemillas: ['cacahuate', 'cacahuates', 'peanut', 'peanuts', 'nuez', 'nueces', 'almendra', 'almendras', 'pistache', 'pistachos', 'pepita', 'pepitas', 'semilla', 'semillas', 'pepitoria', 'mixed nuts', 'trail mix', 'garbanzo tostado', 'habas tostadas'],
};
const REGEX_LISTAS = Object.fromEntries(Object.entries(LISTAS).map(([k, lista]) => [k, new RegExp(`(^|[^a-z0-9&])(${lista.map((t) => normalizarTexto(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^a-z0-9&]|$)`)]));
const coincide = (texto, lista) => REGEX_LISTAS[lista].test(texto);

/** Mililitros que declara la presentación, o null. */
function mililitros(presentacion) {
  const m = /(\d+(?:[.,]\d+)?)\s?(ml|mls|l|lt|ltr|lts|litros?|fl\.? ?oz|oz)\b/i.exec(presentacion ?? '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  if (u.startsWith('ml')) return n;
  if (/^l/.test(u)) return n * 1000;
  return Math.round(n * 29.57); // onzas líquidas
}

/** Propuesta de clase fiscal con su motivo. Es una propuesta: el reporte no trae impuestos. */
function clasificarFiscal(descripcion, presentacion) {
  const t = normalizarTexto(descripcion);
  if (coincide(t, 'noComestible') && !coincide(t, 'comestibleSeguro')) return { clase: 'gravado', motivo: 'no comestible', revisar: false };
  if (coincide(t, 'suero')) return { clase: 'gravado', motivo: 'suero rehidratante: gravado salvo que tenga DIN de medicamento', revisar: true };
  if (coincide(t, 'gaseosaEnergetica')) return { clase: 'gravado', motivo: 'bebida gaseosa, energética o deportiva', revisar: false };
  if (coincide(t, 'golosinaBotana')) return { clase: 'gravado', motivo: 'golosina, botana, pan dulce o helado', revisar: true };
  if (coincide(t, 'bebida')) {
    const ml = mililitros(presentacion);
    if (ml !== null && ml < 600) return { clase: 'gravado', motivo: `bebida en porción individual (${ml} mL)`, revisar: false };
    if (coincide(t, 'bebidaDudosa')) return { clase: 'tasaCero', motivo: 'bebida de fruta ≥ 600 mL o sin tamaño: confirmar si tiene ≥ 25 % de jugo', revisar: true };
    return { clase: 'tasaCero', motivo: 'bebida no gaseosa ≥ 600 mL o sin tamaño', revisar: true };
  }
  if (coincide(t, 'nuecesSemillas')) return { clase: 'tasaCero', motivo: 'nuez o semilla: tasa cero si va natural, gravado si va salada o con chile', revisar: true };
  return { clase: 'tasaCero', motivo: 'alimento básico', revisar: false };
}

// ------------------------------------------------------------- conversión
const texto = readFileSync(archivo, 'utf8');
const { filas } = leerReporte(texto);

const preparadas = filas.map((f) => {
  const descripcionOriginal = limpiarTexto(f.Description);
  let descripcion = descripcionOriginal;
  const avisos = [];
  // otro código pegado al final de la descripción (p. ej. "Naranja 1l042279794327")
  const pegado = /(\d{12,13})$/.exec(descripcion.replace(/\s+/g, ''));
  if (pegado && !/^\d+$/.test(descripcion)) {
    const posible = pegado[1];
    try {
      normalizarUPC(posible);
      descripcion = descripcion.replace(new RegExp(`\\s*${posible}$`), '').replace(/(\d)(?=\D*$)/, '$1').trim();
      avisos.push(`la descripción traía otro código al final (${posible}); se quitó`);
    } catch {
      // no era un código
    }
  }
  const { nombre: sinTamano, presentacion } = separarPresentacion(descripcion);
  return { fila: f, descripcionOriginal, descripcion, sinTamano, presentacion, avisos };
});

const frecuencia = frecuenciaPrimeraPalabra(preparadas.map((p) => p.sinTamano));
const importar = [];
const revision = [];
const resumen = { total: 0, importables: 0, excluidos: 0, upcA: 0, ean13: 0, upcE: 0, plu: 0, sinCodigo: 0, duplicados: 0, invalidos: 0, gravado: 0, tasaCero: 0, revisarFiscal: 0, conMarca: 0, conPresentacion: 0, precioAlto: 0 };

// Índice para resolver dobles lecturas: código completo → fila.
const interpretadas = preparadas.map((p) => ({ ...p, codigo: interpretarCodigo(p.fila['Product No.']) }));
const porCodigo = new Map();
for (const p of interpretadas) {
  if (p.codigo.upc) porCodigo.set(p.codigo.upc, p);
}

/**
 * Una fila con doble lectura es, o bien el mismo producto que ya existe con su
 * código completo (se descarta como duplicado), o bien otro producto cuyo código
 * quedó cortado (entra sin código para escanearlo después), o bien un producto
 * cuyo código completo sí es el prefijo (no aparece en otra fila).
 */
function resolverDobleLectura(p) {
  const { prefijo, resto } = p.codigo;
  const dueno = porCodigo.get(prefijo);
  const clave = claveDescripcion(p.descripcion);
  const mismoProducto = (o) => o !== p && (
    claveDescripcion(o.descripcion) === clave
    || (claveDescripcion(o.sinTamano) === claveDescripcion(p.sinTamano) && (!o.presentacion || !p.presentacion || claveDescripcion(o.presentacion) === claveDescripcion(p.presentacion)))
  );
  const iguales = interpretadas.filter((o) => o.codigo.tipo !== 'doble lectura' && mismoProducto(o));
  if (iguales.length > 0) {
    return { duplicadoDe: iguales[0], avisos: [`doble lectura ${p.fila['Product No.']}: es el mismo producto que "${iguales[0].descripcionOriginal}" (código ${iguales[0].codigo.upc ?? iguales[0].codigo.plu ?? 'sin código'})`] };
  }
  if (!dueno) {
    return { upc: null, avisos: [`código ${p.fila['Product No.']} parece una doble lectura (${prefijo} + ${resto}…) pero ${prefijo} no está en el reporte; entra sin código: escanear el producto para agregarlo (si el escáner lee ${prefijo}, ese es)`] };
  }
  if (parecido(clave, claveDescripcion(dueno.descripcion)) >= 0.9) {
    return { duplicadoDe: dueno, avisos: [`doble lectura ${p.fila['Product No.']}: es el mismo producto que "${dueno.descripcionOriginal}" (código ${dueno.codigo.upc})`] };
  }
  let mejor = null;
  for (const o of interpretadas) {
    if (o === p || o.codigo.tipo === 'doble lectura') continue;
    const s = parecido(clave, claveDescripcion(o.descripcion));
    if (s >= 0.6 && (!mejor || s > mejor.s)) mejor = { o, s };
  }
  const avisos = [`código ${p.fila['Product No.']} es una doble lectura: ${prefijo} pertenece a "${dueno.descripcionOriginal}" y el código de este producto empieza por ${resto}…; entra sin código: escanear el producto para agregarlo`];
  if (mejor) avisos.push(`posible duplicado de "${mejor.o.descripcionOriginal}" (código ${mejor.o.codigo.upc ?? mejor.o.codigo.plu ?? 'sin código'})`);
  return { upc: null, avisos };
}

for (const p of interpretadas) {
  resumen.total += 1;
  const f = p.fila;
  let { upc, plu, tipo, avisos: avisosCodigo } = p.codigo;
  let duplicadoDe = null;
  if (tipo === 'doble lectura') {
    const r = resolverDobleLectura(p);
    avisosCodigo = r.avisos;
    duplicadoDe = r.duplicadoDe ?? null;
    upc = r.upc ?? null;
    tipo = duplicadoDe ? 'duplicado' : upc ? (upc.length === 13 ? 'EAN-13' : 'UPC-A') : 'sin código';
  }
  const avisos = [...p.avisos, ...avisosCodigo];
  if (tipo === 'UPC-A') resumen.upcA += 1;
  if (tipo === 'EAN-13') resumen.ean13 += 1;
  if (tipo === 'PLU') resumen.plu += 1;
  if (tipo === 'inválido' || tipo === 'sin código') { resumen.sinCodigo += 1; if (tipo === 'inválido') resumen.invalidos += 1; }
  if (avisosCodigo.some((a) => /expandido/.test(a))) resumen.upcE += 1;
  if (duplicadoDe) resumen.duplicados += 1;

  let { marca, nombre } = separarMarca(p.sinTamano, frecuencia);
  if (!nombre.trim()) { nombre = marca; marca = ''; }
  nombre = nombre.trim();
  const precio = centavos(f['#1 Price']);
  const fiscal = clasificarFiscal(p.descripcion, p.presentacion);
  if (fiscal.revisar) resumen.revisarFiscal += 1;
  if (precio !== null && precio >= 10000) { avisos.push(`precio alto (${(precio / 100).toFixed(2)}): confirmar`); resumen.precioAlto += 1; }
  if (marca) resumen.conMarca += 1;
  if (p.presentacion) resumen.conPresentacion += 1;

  let estado = 'importar';
  if (duplicadoDe) { estado = 'excluido: duplicado'; }
  else if (!nombre) { estado = 'excluido: sin descripción'; }
  else if (precio === null) { estado = 'excluido: sin precio'; }
  else if (precio <= 0) { estado = 'excluido: precio en cero'; }
  else if (nombre.length > 80) { estado = 'excluido: nombre de más de 80 caracteres'; }

  if (estado === 'importar') {
    resumen.importables += 1;
    resumen[fiscal.clase] += 1;
    importar.push([upc ?? '', plu ?? '', nombre, marca, p.presentacion, String(precio), 'pieza', fiscal.clase, tienda]);
  } else {
    resumen.excluidos += 1;
  }
  revision.push([estado, f['Product No.'], upc ?? '', plu ?? '', tipo, marca, nombre, p.presentacion, precio === null ? '' : (precio / 100).toFixed(2), fiscal.clase, fiscal.motivo, fiscal.revisar || avisos.length > 0 ? 'sí' : 'no', avisos.join(' | '), p.descripcionOriginal]);
}

// El archivo de importación debe pasar limpio por el planificador de la app (catálogo vacío).
const encabezadosImportar = ['upc', 'plu', 'nombre', 'marca', 'presentacion', 'precioCentavos', 'unidadVenta', 'claseFiscal', 'tiendas'];
const textoImportar = aCSV([encabezadosImportar, ...importar]);
const plan = planificarImportacion(deCSV(textoImportar), new Map(), 'migracion@bestpos');
if (plan.errores.length > 0) {
  console.error(`El archivo de importación tiene ${plan.errores.length} filas con error según la app:`);
  for (const e of plan.errores.slice(0, 20)) console.error(`  línea ${e.linea}: ${e.mensaje}`);
  process.exit(2);
}

const nombreBase = tienda ? `bestpos-${tienda}` : 'bestpos';
writeFileSync(join(salida, `importar-${nombreBase}.csv`), textoImportar);
writeFileSync(join(salida, `revision-${nombreBase}.csv`), aCSV([
  ['estado', 'codigoOriginal', 'upc', 'plu', 'tipoCodigo', 'marca', 'nombre', 'presentacion', 'precio', 'claseFiscal', 'motivoFiscal', 'revisar', 'avisos', 'descripcionOriginal'],
  ...revision,
]));
const lineasResumen = [
  `BestPOS → Catálogo Águila · ${tienda ? `tienda "${tienda}"` : 'sin tienda asignada'} · ${new Date().toISOString().slice(0, 10)}`,
  '',
  `Productos en el reporte: ${resumen.total}`,
  `  a importar: ${resumen.importables} (crear ${plan.crear.length}) · excluidos: ${resumen.excluidos}`,
  '',
  'Códigos:',
  `  UPC-A ${resumen.upcA} · EAN-13 ${resumen.ean13} · PLU (4-5 dígitos, sin barras) ${resumen.plu} · sin código ${resumen.sinCodigo} (inválidos ${resumen.invalidos})`,
  `  UPC-E expandidos ${resumen.upcE} · dobles lecturas del escáner: duplicados descartados ${resumen.duplicados}`,
  '',
  'Descripción:',
  `  con marca separada ${resumen.conMarca} · con presentación separada ${resumen.conPresentacion}`,
  '',
  'Clase fiscal propuesta (el reporte no trae impuestos):',
  `  gravado ${resumen.gravado} · tasa cero ${resumen.tasaCero} · marcadas para confirmar ${resumen.revisarFiscal}`,
  '',
  `Precios altos (≥ $100) a confirmar: ${resumen.precioAlto}`,
  '',
  'Archivos:',
  `  importar-${nombreBase}.csv   → Gestión → Importar / exportar`,
  `  revision-${nombreBase}.csv   → una fila por producto con cada decisión y aviso`,
];
writeFileSync(join(salida, `resumen-${nombreBase}.txt`), `${lineasResumen.join('\n')}\n`);
console.log(lineasResumen.join('\n'));
