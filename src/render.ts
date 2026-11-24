// Dibujo del trazado sobre canvas. Todas las medidas en píxeles CSS.

export const COLORS = {
  screen: '#0e1316',
  gridMinor: '#172026',
  gridMajor: '#24313a',
  trace: '#4fe08a',
  marker: '#8a9aa6',
};

export interface Scale {
  pxPerMm: number;
  speedMmS: number;
}

// La amplitud del pulso óptico cambia mucho entre personas y con la presión
// del dedo, así que la escala vertical se ajusta sola, como en un pulsioxímetro.
export interface Vertical {
  center: number;
  pxPerUnit: number;
}

// Un pulso más pequeño no se amplía más allá de esto, para no agrandar el ruido.
const MIN_SPAN_PCT = 0.1;
const FILL = 0.6;

export function valueRange(get: (k: number) => number, from: number, to: number): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = from; k < to; k++) {
    const v = get(k);
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? { lo, hi } : null;
}

export function fitVertical(range: { lo: number; hi: number }, h: number): Vertical {
  return { center: (range.lo + range.hi) / 2, pxPerUnit: (FILL * h) / Math.max(range.hi - range.lo, MIN_SPAN_PCT) };
}

export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, pxPerMm: number) {
  ctx.fillStyle = COLORS.screen;
  ctx.fillRect(0, 0, w, h);
  const mid = Math.round(h / 2);
  const lines = (step: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) {
      const px = Math.round(x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    // Las horizontales parten de la línea base para que quede sobre una línea gruesa.
    for (let y = mid % step; y <= h; y += step) {
      const py = Math.round(y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
  };
  if (pxPerMm >= 3) lines(pxPerMm, COLORS.gridMinor);
  lines(pxPerMm * 5, COLORS.gridMajor);
}

const BAR_STEPS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
const percent = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

// Barra de referencia en el borde izquierdo con la amplitud que representa
// a la escala actual, en % de la luz recibida.
export function drawAmplitudeBar(ctx: CanvasRenderingContext2D, h: number, pxPerUnit: number) {
  let step = BAR_STEPS[0];
  for (const s of BAR_STEPS) if (s * pxPerUnit <= 0.35 * h) step = s;
  const height = step * pxPerUnit;
  const base = Math.round(h / 2 + height / 2) + 0.5;
  const x = 12.5;
  ctx.strokeStyle = COLORS.marker;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 4, base);
  ctx.lineTo(x + 4, base);
  ctx.moveTo(x, base);
  ctx.lineTo(x, base - height);
  ctx.moveTo(x - 4, base - height);
  ctx.lineTo(x + 4, base - height);
  ctx.stroke();
  ctx.fillStyle = COLORS.marker;
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${percent.format(step)} %`, 6, base - height - 6);
}

export function traceStyle(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = COLORS.trace;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}
