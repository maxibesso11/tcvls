// config/modulos.js
// Catálogo central de los módulos del sistema. Es la fuente de verdad para:
//  - el middleware que bloquea módulos desactivados,
//  - las rutas de administración (activar/desactivar por empresa),
//  - la validación de dependencias.
// El frontend replica este catálogo para mostrar/ocultar la navegación.
//
// Cada módulo declara:
//   clave:     identificador (coincide con la ruta de la API y la vista)
//   nombre:    etiqueta legible
//   grupo:     agrupación para la UI
//   depende:   módulos que deben estar activos para que éste funcione
//   rutas:     prefijos de la API que cubre (para el middleware)

const MODULOS = [
  // Flota
  { clave: 'choferes',       nombre: 'Choferes',                grupo: 'Flota',          depende: [],                 rutas: ['choferes'] },
  { clave: 'unidades',       nombre: 'Unidades',                grupo: 'Flota',          depende: [],                 rutas: ['unidades'] },
  { clave: 'equipos',        nombre: 'Equipos',                 grupo: 'Flota',          depende: ['unidades', 'choferes'], rutas: ['equipos'] },
  { clave: 'cubiertas',      nombre: 'Cubiertas',               grupo: 'Flota',          depende: ['unidades'],       rutas: ['cubiertas'] },
  { clave: 'mantenimientos', nombre: 'Mantenimientos',          grupo: 'Flota',          depende: ['unidades'],       rutas: ['mantenimientos'] },
  { clave: 'vencimientos',   nombre: 'Vencimientos',            grupo: 'Flota',          depende: ['unidades'],       rutas: ['vencimientos'] },

  // Operaciones
  { clave: 'viajes',         nombre: 'Viajes',                  grupo: 'Operaciones',    depende: ['equipos', 'cuentas', 'facturacion'], rutas: ['viajes'] },

  // Gastos
  { clave: 'consumos-combustible', nombre: 'Consumos de combustible', grupo: 'Gastos',   depende: ['equipos', 'cuentas'], rutas: ['consumos-combustible'] },
  { clave: 'consumos-generales',   nombre: 'Consumos generales',      grupo: 'Gastos',   depende: ['unidades', 'cuentas'], rutas: ['consumos-generales'] },
  { clave: 'gastos-administrativos', nombre: 'Gastos administrativos', grupo: 'Gastos',  depende: ['cuentas'],         rutas: ['gastos-administrativos'] },

  // Administración
  { clave: 'cuentas',           nombre: 'Cuentas',              grupo: 'Administración', depende: [],                 rutas: ['cuentas'], obligatorio: true },
  { clave: 'movimientos',       nombre: 'Movimientos',          grupo: 'Administración', depende: ['cuentas'],        rutas: ['movimientos'] },
  { clave: 'cuentas-corrientes', nombre: 'Cuentas corrientes',  grupo: 'Administración', depende: ['cuentas'],        rutas: ['cuentas-corrientes'] },
  { clave: 'stock',             nombre: 'Stock',                grupo: 'Administración', depende: [],                 rutas: ['stock'] },
  { clave: 'facturacion',       nombre: 'Facturación',          grupo: 'Administración', depende: ['cuentas'],        rutas: ['facturacion'], obligatorio: true }
];

const CLAVES = MODULOS.map(m => m.clave);

// Módulos que están SIEMPRE activos en toda empresa y no se pueden desactivar.
// Facturación y Cuentas son núcleo del circuito viaje → cuenta corriente:
// con la forma de trabajar actual, marcar un viaje como facturado imputa en la
// cuenta del cliente, así que estos módulos no tienen sentido apagados.
const MODULOS_OBLIGATORIOS = MODULOS.filter(m => m.obligatorio).map(m => m.clave);

// Mapa rápido ruta -> clave de módulo (para el middleware)
const RUTA_A_MODULO = {};
MODULOS.forEach(m => m.rutas.forEach(r => { RUTA_A_MODULO[r] = m.clave; }));

// Devuelve los errores de dependencia para un conjunto de módulos activos.
// Los módulos obligatorios se dan por activos siempre (no se pueden apagar),
// así que nunca generan un error de dependencia.
function validarDependencias(activos) {
  const set = new Set([...activos, ...MODULOS_OBLIGATORIOS]);
  const errores = [];
  MODULOS.forEach(m => {
    if (!set.has(m.clave)) return;
    m.depende.forEach(dep => {
      if (!set.has(dep)) {
        const nombreDep = (MODULOS.find(x => x.clave === dep) || {}).nombre || dep;
        errores.push(`"${m.nombre}" requiere que "${nombreDep}" esté activo.`);
      }
    });
  });
  return errores;
}

// Normaliza una lista de módulos elegidos: garantiza que los obligatorios
// siempre estén presentes, sin duplicar.
function conObligatorios(activos) {
  return [...new Set([...(activos || []), ...MODULOS_OBLIGATORIOS])];
}

module.exports = { MODULOS, CLAVES, RUTA_A_MODULO, MODULOS_OBLIGATORIOS, validarDependencias, conObligatorios };
