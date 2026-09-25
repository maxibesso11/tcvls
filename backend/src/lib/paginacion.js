// backend/src/lib/paginacion.js
// Cálculo común de la paginación de listados a partir de la query string
// (?pagina=&por_pagina=) y del total de registros que cumplen el filtro.
// La página pedida se ajusta al rango válido [1, total_paginas].
const { PAGINACION } = require('../config/constantes');

function calcularPaginacion(query, total) {
  const porPagina = Math.min(
    Math.max(parseInt(query.por_pagina, 10) || PAGINACION.POR_PAGINA_DEFECTO, 1),
    PAGINACION.POR_PAGINA_MAXIMO
  );
  const totalPaginas = Math.max(Math.ceil(total / porPagina), 1);
  let pagina = parseInt(query.pagina, 10) || 1;
  if (pagina < 1) pagina = 1;
  if (pagina > totalPaginas) pagina = totalPaginas;
  const offset = (pagina - 1) * porPagina;
  return { pagina, porPagina, totalPaginas, offset };
}

module.exports = { calcularPaginacion };
