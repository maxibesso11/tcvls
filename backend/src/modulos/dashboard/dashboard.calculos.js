// backend/src/modulos/dashboard/dashboard.calculos.js
// Cálculos puros (sin base de datos) para las métricas del dashboard.
const MS_DIA = 24 * 60 * 60 * 1000;

// Convierte a Date con componentes explícitos en horario LOCAL, sea cual sea
// el formato de entrada: un objeto Date, 'YYYY-MM-DD' (MySQL con
// dateStrings:true) o 'YYYY-MM-DD HH:MM:SS'. Evita la trampa de JS donde una
// fecha sin hora se interpreta como UTC pero una con hora se interpreta como
// horario local: sin esto, comparar un "hasta" de EQUIPO_HISTORIAL (con hora)
// contra un "hasta" del reporte (sin hora) corre el riesgo de desalinearse
// varias horas según el huso horario del servidor.
function aFechaLocal(valor) {
  if (valor instanceof Date) return valor;
  const m = typeof valor === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(valor)
    : null;
  if (!m) return new Date(valor);
  const [, y, mes, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Number(y), Number(mes) - 1, Number(d), Number(h), Number(mi), Number(s));
}

// Prorratea el sueldo fijo mensual de cada período de EQUIPO_HISTORIAL de un
// equipo, según los días que ese chofer estuvo asignado dentro de [desde,
// hasta] (ambos incluidos, igual que el resto de los filtros del dashboard).
// Así, si un equipo cambió de chofer a mitad del período, cada uno aporta
// solo sus días, sin superposiciones ni huecos en el borde del cambio.
//
// periodos: [{ sueldo_fijo_mensual, desde, hasta }], igual que EQUIPO_HISTORIAL:
// desde NULL = sin límite inferior (alta del equipo), inclusive; hasta NULL =
// vigente, sin límite superior; hasta, cuando existe, es EXCLUSIVO (el
// período termina justo en ese instante). desde/hasta (los del período del
// reporte) pueden ser Date o string parseable ('YYYY-MM-DD' o datetime).
function sueldoFijoProrrateado(periodos, desde, hasta) {
  const inicio = aFechaLocal(desde);
  const finInclusivo = aFechaLocal(hasta);
  if (isNaN(inicio) || isNaN(finInclusivo) || finInclusivo < inicio) return 0;
  // El "hasta" del reporte es inclusive (day): se convierte a un límite
  // exclusivo para poder comparar con el mismo criterio que EQUIPO_HISTORIAL.
  const finExclusivo = new Date(finInclusivo.getTime() + MS_DIA);

  let total = 0;
  for (const periodo of periodos || []) {
    const sueldo = Number(periodo.sueldo_fijo_mensual) || 0;
    if (sueldo <= 0) continue;

    const periodoDesde = periodo.desde ? aFechaLocal(periodo.desde) : null;
    const periodoHasta = periodo.hasta ? aFechaLocal(periodo.hasta) : null;
    const inicioSolapado = periodoDesde && periodoDesde > inicio ? periodoDesde : inicio;
    const finSolapado = periodoHasta && periodoHasta < finExclusivo ? periodoHasta : finExclusivo;

    const dias = (finSolapado - inicioSolapado) / MS_DIA;
    if (dias <= 0) continue;

    total += (sueldo / 30) * dias;
  }
  return total;
}

module.exports = { sueldoFijoProrrateado };
