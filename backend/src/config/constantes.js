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

module.exports = { IVA_ALICUOTA, PAGINACION, DURACION_TOKEN_HORAS };
