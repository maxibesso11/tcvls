// backend/src/lib/seguridad/configuracion.js
// Verificación de la configuración crítica al arrancar. Si falta un secreto,
// es demasiado corto o quedó el valor de ejemplo, el servidor NO arranca:
// con un secreto conocido cualquiera podría fabricar una sesión de
// administrador (AUTH_SECRET) o descifrar las claves de los certificados
// fiscales (CERT_SECRET).
//
// Para generar un valor: openssl rand -hex 48

const LARGO_MINIMO = 32;

// Valores que figuran en el código o en .env.example: nunca son válidos.
const VALORES_CONOCIDOS = new Set([
  'cambiar_por_una_cadena_larga_y_aleatoria_unica',
  'cambiar-este-secreto-en-produccion-3deabril',
  'generar-un-valor-largo-y-aleatorio-unico-para-certificados',
  'cambiar-este-secreto-de-certificados-en-produccion'
]);

function revisarSecreto(nombre, valor, errores) {
  if (!valor) {
    errores.push(`Falta ${nombre} en el archivo .env.`);
  } else if (VALORES_CONOCIDOS.has(valor)) {
    errores.push(`${nombre} tiene el valor de ejemplo; reemplazalo por uno propio.`);
  } else if (valor.length < LARGO_MINIMO) {
    errores.push(`${nombre} es demasiado corto (mínimo ${LARGO_MINIMO} caracteres).`);
  }
}

// Devuelve la lista de problemas (vacía si la configuración es válida).
function problemasDeConfiguracion(env = process.env) {
  const errores = [];
  revisarSecreto('AUTH_SECRET', env.AUTH_SECRET, errores);
  revisarSecreto('CERT_SECRET', env.CERT_SECRET, errores);
  if (env.AUTH_SECRET && env.CERT_SECRET && env.AUTH_SECRET === env.CERT_SECRET) {
    errores.push('CERT_SECRET debe ser distinto de AUTH_SECRET.');
  }
  return errores;
}

module.exports = { problemasDeConfiguracion, LARGO_MINIMO };
