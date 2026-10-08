// frontend/js/nucleo/graficos.js
// Gráficos dibujados a mano (sin librerías): desglose del resultado, puntos
// contra el promedio y columnas. Escalan al ancho de la hoja (viewBox, sin ancho mínimo),
// así que nunca generan scroll lateral.
// Colores solo vía variables: ingresos en azul (--chart-income), costos en
// naranja (--chart-cost); el resultado usa --ok / --danger-fill. Nunca tortas
// ni donas. Las funciones son globales a propósito (ver index.html).

// Desglose del resultado: una fila por concepto (ingresos, cada costo y el
// resultado), con una barra proporcional a los ingresos, el monto y su
// porcentaje sobre los ingresos. Se lee de arriba hacia abajo.
//   ingresos: número · costos: [{ nombre, valor }] (valores positivos)
//   resultado: número (puede ser negativo)
function desgloseResultado({ ingresos, costos, resultado }) {
  const base = Math.max(Number(ingresos) || 0, 1);
  const ancho = v => Math.max(0, Math.min(100, Math.abs(v) / base * 100)).toFixed(1);
  const pct = v => `${fmtNum(Math.abs(v) / base * 100, 0)} %`;
  const fila = (nombre, valor, clase, signo = '') => `
    <div class="desglose-fila ${clase}">
      <span class="desglose-nombre">${esc(nombre)}</span>
      <span class="desglose-barra"><i style="width:${ancho(valor)}%"></i></span>
      <span class="desglose-monto">${signo}${fmtDinero(Math.abs(valor))}</span>
      <span class="desglose-pct">${clase === 'ingreso' ? '100 %' : pct(valor)}</span>
    </div>`;
  return `<div class="desglose" role="table" aria-label="Resultado: ingresos menos cada costo">
    ${fila('Ingresos', ingresos, 'ingreso')}
    ${costos.filter(c => Number(c.valor)).map(c => fila(c.nombre, c.valor, 'costo', '− ')).join('')}
    ${fila('Resultado', resultado, resultado >= 0 ? 'total positivo' : 'total negativo', resultado < 0 ? '− ' : '')}
  </div>`;
}

// Puntos contra el promedio (km/L por equipo): línea vertical punteada en el
// promedio y, por equipo, un segmento + punto (azul arriba del promedio,
// naranja abajo). filas: [{ rotulo, valor }]
function graficoPuntosPromedio(filas, { decimales = 2 } = {}) {
  if (!filas.length) return '';
  const valores = filas.map(f => f.valor);
  const prom = valores.reduce((a, b) => a + b, 0) / valores.length;
  const mn = Math.floor((Math.min(...valores) - 0.1) * 10) / 10;
  let mx = Math.ceil((Math.max(...valores) + 0.1) * 10) / 10;
  if (mx - mn < 0.4) mx = mn + 0.4;
  const W = 520, rowH = 30, padL = 170, padR = 50, H = filas.length * rowH + 34;
  const x = v => padL + (v - mn) / (mx - mn) * (W - padL - padR);
  let out = '';
  const paso = (mx - mn) / 5;
  for (let i = 0; i <= 5; i++) {
    const v = mn + paso * i;
    out += `<line class="eje" x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="4" y2="${H - 24}"/><text x="${x(v).toFixed(1)}" y="${H - 8}" text-anchor="middle">${fmtNum(v, 1)}</text>`;
  }
  out += `<line x1="${x(prom).toFixed(1)}" x2="${x(prom).toFixed(1)}" y1="0" y2="${H - 24}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="${(x(prom) + 4).toFixed(1)}" y="12" style="fill:var(--ink);font-weight:600">promedio ${fmtNum(prom, decimales)}</text>`;
  [...filas].sort((a, b) => b.valor - a.valor).forEach((f, i) => {
    const y = 26 + i * rowH;
    const abajo = f.valor < prom;
    const color = abajo ? 'var(--chart-cost)' : 'var(--chart-income)';
    out += `<text x="0" y="${y + 4}">${esc(f.rotulo)}</text>`;
    out += `<line x1="${x(prom).toFixed(1)}" x2="${x(f.valor).toFixed(1)}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="3"/>`;
    out += `<circle cx="${x(f.valor).toFixed(1)}" cy="${y}" r="5" fill="${color}"/>`;
    out += `<text class="valor" x="${W - padR + 8}" y="${y + 4}">${fmtNum(f.valor, decimales)}</text>`;
  });
  return `<div class="tabla-marco"><svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Rendimiento por equipo contra el promedio">${out}</svg></div>`;
}

// Barra apilada para una celda: composición de un total (ej. costos =
// combustible + consumos + sueldo). partes: [{ valor, clase, nombre }];
// el ancho total es proporcional a max (misma escala en toda la columna).
function barraApilada(partes, max) {
  const total = partes.reduce((s, p) => s + Math.max(0, Number(p.valor) || 0), 0);
  const titulo = partes.map(p => `${p.nombre}: ${fmtDinero(p.valor)}`).join(', ');
  return `<div class="barra-apilada" title="${esc(titulo)}"><div style="width:${max > 0 ? (total / max * 100).toFixed(1) : 0}%">${partes.map(p => `<i class="${p.clase}" style="flex:${Math.max(0, Number(p.valor) || 0)}"></i>`).join('')}</div></div>`;
}

// Columnas agrupadas: dos series por categoría (ingresos azul, costos naranja).
//   categorias: [rótulo] · ingresos: [n] · costos: [n]
function graficoColumnas(categorias, ingresos, costos, alto = 200) {
  if (!categorias.length) return '';
  const W = Math.max(560, categorias.length * 60), H = alto, top = 16, bot = 26;
  const mx = Math.max(...ingresos, ...costos, 1) * 1.1, n = categorias.length, gw = W / n;
  const sc = v => (H - bot) - v / mx * (H - top - bot);
  let out = '';
  [0.33, 0.66, 1].forEach(g => { const y = sc(mx * g / 1.1); out += `<line class="eje" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; });
  categorias.forEach((c, i) => {
    const x = i * gw + gw * 0.2, w = gw * 0.28;
    out += `<rect x="${x.toFixed(1)}" y="${sc(ingresos[i]).toFixed(1)}" width="${w.toFixed(1)}" height="${(sc(0) - sc(ingresos[i])).toFixed(1)}" fill="var(--chart-income)" rx="2"/>`;
    out += `<rect x="${(x + w + 3).toFixed(1)}" y="${sc(costos[i]).toFixed(1)}" width="${w.toFixed(1)}" height="${(sc(0) - sc(costos[i])).toFixed(1)}" fill="var(--chart-cost)" rx="2"/>`;
    out += `<text x="${(x + w + 1.5).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
  });
  out += `<line class="base" x1="0" x2="${W}" y1="${sc(0).toFixed(1)}" y2="${sc(0).toFixed(1)}"/>`;
  return `<div class="tabla-marco"><svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y costos por período">${out}</svg></div>`;
}

// Barra simple de una celda: porcentaje de 0 a 100. costo = true → naranja.
function barraSimple(porcentaje, costo = false) {
  return `<div class="barra${costo ? ' costo' : ''}"><i style="width:${Math.max(0, Math.min(100, porcentaje)).toFixed(0)}%"></i></div>`;
}

// Traza (sparkline) para dentro de una .cifra: serie de al menos 2 valores.
function trazaSVG(serie, w = 120, h = 28) {
  if (!serie || serie.length < 2) return '';
  const mn = Math.min(...serie), mx = Math.max(...serie), dx = w / (serie.length - 1);
  const y = v => h - 3 - (v - mn) / ((mx - mn) || 1) * (h - 6);
  const d = serie.map((v, i) => `${i ? 'L' : 'M'}${(i * dx).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return `<svg class="cifra-traza" viewBox="-3 0 ${w + 6} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" vector-effect="non-scaling-stroke"/><circle cx="${w}" cy="${y(serie[serie.length - 1]).toFixed(1)}" r="2.5"/></svg>`;
}
