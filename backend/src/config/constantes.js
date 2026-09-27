// backend/src/config/constantes.js
// Reglas de negocio y valores fijos del sistema, en un solo lugar.
// Cambiar un valor aquí cambia el comportamiento de todo el ERP.

// Alícuota general de IVA (21%) aplicada a fletes y facturas A.
const IVA_ALICUOTA = 0.21;

// Paginación de listados: registros por página por defecto y máximo permitido.
const PAGINACION = {
  POR_PAGINA_DEFECTO: 50,
  POR_PAGINA_MAXIMO: 200
};

// Duración de la sesión (token) en horas.
const DURACION_TOKEN_HORAS = 12;

// Zona horaria del negocio. Las fechas que carga el usuario (viajes,
// consumos, cambios de equipo) se guardan en hora local, sin convertir;
// el servidor y la base trabajan en UTC.
const ZONA_HORARIA_NEGOCIO = 'America/Argentina/Buenos_Aires';

// Fecha y hora actual en la zona del negocio: 'AAAA-MM-DD HH:MM:SS'.
function ahoraLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: ZONA_HORARIA_NEGOCIO, hour12: false }).replace('T', ' ');
}

module.exports = { IVA_ALICUOTA, PAGINACION, DURACION_TOKEN_HORAS, ZONA_HORARIA_NEGOCIO, ahoraLocal };
