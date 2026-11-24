// Revisa el entorno antes de instalar, arrancar o compilar, y explica en
// español qué hacer si algo falta. Usa sintaxis sencilla a propósito: tiene
// que funcionar justo en los Node antiguos sobre los que avisa.
import { existsSync } from 'node:fs';

var task = process.argv[2] || 'dev';
var parts = process.versions.node.split('.');
var major = Number(parts[0]);
var minor = Number(parts[1]);
var problems = [];

// Vite 8 y @vitejs/plugin-react 6 exigen Node ^20.19.0 o >=22.12.0.
var viteOk = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
// Las pruebas cargan TypeScript directamente con --experimental-strip-types (Node 22.6+).
var testOk = (major === 22 && minor >= 6) || major >= 23;

if (task === 'test' ? !testOk : !viteOk) {
  var need = task === 'test' ? '22.6 o superior' : '20.19 o superior, o 22.12 o superior';
  problems.push(
    'Tienes Node ' + process.versions.node + ' y este proyecto necesita Node ' + need + '.',
    'Instala la versión LTS desde https://nodejs.org, cierra esta terminal,',
    'abre una nueva y comprueba con:  node -v',
  );
}

if (task !== 'install' && problems.length === 0 && !existsSync('node_modules/vite')) {
  problems.push('Faltan las dependencias. Ejecuta primero:  npm install');
}

if (problems.length > 0) {
  console.error('\n  El electrocardiograma no puede arrancar todavía:\n');
  for (var i = 0; i < problems.length; i++) console.error('  ' + problems[i]);
  console.error('');
  process.exit(1);
}
