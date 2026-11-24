// Gráficas simples sobre canvas (líneas y puntos con ejes), para las
// herramientas de análisis. Dos temas: «screen» para los paneles oscuros del
// monitor y «paper» para el historial sobre fondo claro.

export type ChartTheme = 'screen' | 'paper';

const THEMES = {
  screen: { bg: '#0e1316', grid: '#1c262e', axis: '#7f8e99', text: '#7f8e99' },
  paper: { bg: '#f3f5f6', grid: '#dfe4e8', axis: '#56636e', text: '#56636e' },
};

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  points: readonly ChartPoint[];
  color: string;
  width?: number;
  dots?: boolean; // puntos sueltos en vez de línea
  dotSize?: number;
  breakAbove?: number; // corta la línea si hay un salto en x mayor que esto
}

export interface ChartOptions {
  theme: ChartTheme;
  series: ChartSeries[];
  x: [number, number];
  y?: [number, number];
  xLabel?: (x: number) => string;
  yLabel?: (y: number) => string;
  square?: boolean; // misma escala en x e y (Poincaré)
  identity?: boolean; // diagonal y = x
  note?: string; // texto en la esquina superior derecha
}

const PAD = { left: 46, right: 12, top: 12, bottom: 24 };

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

export function autoRange(values: number[], minSpan: number): [number, number] {
  if (values.length === 0) return [0, minSpan];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const margin = (hi - lo) * 0.08;
  return [lo - margin, hi + margin];
}

export function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, o: ChartOptions) {
  const t = THEMES[o.theme];
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, h);

  let [x0, x1] = o.x;
  let [y0, y1] = o.y ?? autoRange(o.series.flatMap((s) => s.points.map((p) => p.y)), 1);
  let plotW = w - PAD.left - PAD.right;
  let plotH = h - PAD.top - PAD.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  if (o.square) {
    const lo = Math.min(x0, y0);
    const hi = Math.max(x1, y1);
    x0 = y0 = lo;
    x1 = y1 = hi;
    const side = Math.min(plotW, plotH);
    plotW = plotH = side;
  }
  const xs = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const ys = (y: number) => PAD.top + plotH - ((y - y0) / (y1 - y0 || 1)) * plotH;

  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;

  const yStep = niceStep(y1 - y0, 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    const py = Math.round(ys(v)) + 0.5;
    ctx.strokeStyle = t.grid;
    ctx.beginPath();
    ctx.moveTo(PAD.left, py);
    ctx.lineTo(PAD.left + plotW, py);
    ctx.stroke();
    ctx.fillStyle = t.text;
    ctx.fillText(o.yLabel ? o.yLabel(v) : String(Math.round(v * 100) / 100), PAD.left - 6, py);
  }

  const xStep = niceStep(x1 - x0, o.square ? 4 : 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1; v += xStep) {
    const px = Math.round(xs(v)) + 0.5;
    ctx.strokeStyle = t.grid;
    ctx.beginPath();
    ctx.moveTo(px, PAD.top);
    ctx.lineTo(px, PAD.top + plotH);
    ctx.stroke();
    ctx.fillStyle = t.text;
    ctx.fillText(o.xLabel ? o.xLabel(v) : String(Math.round(v * 100) / 100), px, PAD.top + plotH + 6);
  }

  ctx.strokeStyle = t.axis;
  ctx.strokeRect(PAD.left + 0.5, PAD.top + 0.5, plotW, plotH);

  if (o.identity) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = t.axis;
    ctx.beginPath();
    ctx.moveTo(xs(x0), ys(x0));
    ctx.lineTo(xs(x1), ys(x1));
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, plotH);
  ctx.clip();
  for (const s of o.series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width ?? 1.6;
    ctx.lineJoin = 'round';
    if (s.dots) {
      const r = s.dotSize ?? 2.5;
      for (const p of s.points) {
        ctx.beginPath();
        ctx.arc(xs(p.x), ys(p.y), r, 0, 2 * Math.PI);
        ctx.fill();
      }
      continue;
    }
    ctx.beginPath();
    let prev: ChartPoint | null = null;
    for (const p of s.points) {
      const jump = prev && s.breakAbove !== undefined && p.x - prev.x > s.breakAbove;
      if (!prev || jump) ctx.moveTo(xs(p.x), ys(p.y));
      else ctx.lineTo(xs(p.x), ys(p.y));
      prev = p;
    }
    ctx.stroke();
  }
  ctx.restore();

  if (o.note) {
    // Fondo detrás del texto para que no se mezcle con los datos.
    const width = ctx.measureText(o.note).width;
    const x = PAD.left + plotW - 6;
    ctx.fillStyle = t.bg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - width - 4, PAD.top + 3, width + 8, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(o.note, x, PAD.top + 6);
  }
}
