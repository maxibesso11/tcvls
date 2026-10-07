// frontend/js/nucleo/graficos.js
// Gráficos SVG dibujados a mano (sin librerías): cascada, puntos contra el
// promedio y columnas. Escalan al ancho de la hoja (viewBox, sin ancho mínimo),
// así que nunca generan scroll lateral.
// Colores solo vía variables: ingresos en azul (--chart-income), costos en
// naranja (--chart-cost); el resultado usa --ok / --danger-fill. Nunca tortas
// ni donas. Las funciones son globales a propósito (ver index.html).

// Cascada del resultado: Ingresos (azul) → cada costo (naranja, flotando) →
// Resultado (verde si ≥ 0, --danger-fill si < 0). Conectores punteados y,
// debajo del rótulo de cada costo, su % sobre ingresos.
//   ingresos: número · costos: [{ nombre, valor }] (valores positivos)
//   resultado: número (puede ser negativo)
function graficoCascada({ ingresos, costos, resultado }) {
  const pasos = [
    { nombre: 'Ingresos', valor: ingresos, tipo: 'ingreso' },
    ...costos.filter(c => Number(c.valor)).map(c => ({ nombre: c.nombre, valor: -Math.abs(c.valor), tipo: 'costo' })),
    { nombre: 'Resultado', valor: resultado, tipo: 'total' }
  ];
  const W = 720, H = 250, top = 28, bot = 46, padL = 8, n = pasos.length, bw = (W - padL * 2) / n;
  // La escala cubre desde el mínimo hasta el máximo alcanzados (el resultado puede ser negativo)
  let acumulado = ingresos, max = ingresos, min = Math.min(0, resultado);
  costos.forEach(c => { acumulado -= Math.abs(c.valor); min = Math.min(min, acumulado); });
  max = Math.max(max, 1);
  const sc = v => (H - bot) - (v - min) / ((max - min) || 1) * (H - top - bot);

  let out = '';
  [0.25, 0.5, 0.75, 1].forEach(g => {
    const y = sc(min + (max - min) * g);
    out += `<line class="eje" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  });
  let acc = 0;
  pasos.forEach((p, i) => {
    let y0, y1, relleno;
    if (p.tipo === 'ingreso') { y0 = 0; y1 = p.valor; acc = p.valor; relleno = 'var(--chart-income)'; }
    else if (p.tipo === 'total') { y0 = 0; y1 = p.valor; relleno = p.valor >= 0 ? 'var(--ok)' : 'var(--danger-fill)'; }
    else { y0 = acc + p.valor; y1 = acc; acc += p.valor; relleno = 'var(--chart-cost)'; }
    const x = padL + i * bw + bw * 0.16, w = bw * 0.68;
    const yt = sc(Math.max(y0, y1)), yb = sc(Math.min(y0, y1));
    out += `<rect x="${x.toFixed(1)}" y="${yt.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, yb - yt).toFixed(1)}" fill="${relleno}" rx="2"/>`;
    if (i < n - 1 && p.tipo !== 'total') {
      out += `<line x1="${(x + w).toFixed(1)}" x2="${(x + bw).toFixed(1)}" y1="${sc(acc).toFixed(1)}" y2="${sc(acc).toFixed(1)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
    }
    const etiqueta = p.tipo === 'costo' ? '−' + fmtMillones(-p.valor).replace('−', '') : fmtMillones(p.valor);
    out += `<text class="valor" x="${(x + w / 2).toFixed(1)}" y="${(yt - 7).toFixed(1)}" text-anchor="middle">${etiqueta}</text>`;
    out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - bot + 18}" text-anchor="middle">${esc(p.nombre)}</text>`;
    if (p.tipo === 'costo' && ingresos > 0) {
      out += `<text x="${(x + w / 2).toFixed(1)}" y="${H - bot + 33}" text-anchor="middle" style="fill:var(--ink-3)">${fmtNum(-p.valor / ingresos * 100, 0)} %</text>`;
    }
  });
  out += `<line class="base" x1="0" x2="${W}" y1="${sc(0).toFixed(1)}" y2="${sc(0).toFixed(1)}"/>`;
  return `<div class="tabla-marco"><svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cascada del resultado: ingresos menos cada costo">${out}</svg></div>`;
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
  const titulo = partes.map(p => `${p.nombre}: ${fmtDinero(p.valor)}`).join(' · ');
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

// Barra doble para una celda de tabla: costos ← | → ingresos, a la misma escala.
function barraDoble(costo, ingreso, max) {
  const pc = max > 0 ? Math.min(100, Math.abs(costo) / max * 100) : 0;
  const pi = max > 0 ? Math.min(100, Math.abs(ingreso) / max * 100) : 0;
  return `<div class="barra-doble"><div class="barra izq costo"><i style="width:${pc.toFixed(0)}%"></i></div><div class="barra"><i style="width:${pi.toFixed(0)}%"></i></div></div>`;
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
