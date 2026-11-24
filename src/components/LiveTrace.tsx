import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Monitor } from '../monitor.ts';
import { drawAmplitudeBar, drawGrid, fitCanvas, fitVertical, traceStyle, valueRange, type Scale, type Vertical } from '../render.ts';

const MARGIN = 56;
const ERASE_PX = 18;
// Segundos de señal que se miran para ajustar la escala vertical.
const SCALE_WINDOW_S = 5;

// Copia del búfer en el momento de congelar, para que no se sobrescriba.
export interface Frozen {
  n: number;
  display: Float32Array;
}

interface Props {
  monitor: RefObject<Monitor | null>;
  scale: Scale;
  frozen: Frozen | null;
  children?: ReactNode;
}

// Barrido tipo monitor de cabecera: el trazo nuevo sobrescribe el anterior
// de izquierda a derecha, con un hueco delante del cursor.
export function LiveTrace({ monitor, scale, frozen, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ scale, frozen });
  props.current = { scale, frozen };

  useEffect(() => {
    let frame = 0;
    const grid = document.createElement('canvas');
    let gridKey = '';
    let vertical: Vertical | null = null;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { scale, frozen } = props.current;
      const ctx = fitCanvas(canvas);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      const key = `${canvas.width}x${canvas.height}x${scale.pxPerMm}`;
      if (key !== gridKey) {
        grid.width = canvas.width;
        grid.height = canvas.height;
        const g = grid.getContext('2d')!;
        g.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
        drawGrid(g, w, h, scale.pxPerMm);
        gridKey = key;
      }
      ctx.drawImage(grid, 0, 0, w, h);

      const m = monitor.current;
      if (!m) {
        vertical = null;
        return;
      }

      const fs = m.info.fs;
      const area = w - MARGIN;
      const pxPerS = scale.speedMmS * scale.pxPerMm;
      const mid = Math.round(h / 2);
      const display = frozen ? frozen.display : m.display;
      const end = frozen ? frozen.n : m.n;
      const onScreen = Math.min(display.length, Math.floor((area / pxPerS) * fs));
      const gap = Math.ceil((ERASE_PX / pxPerS) * fs);
      const start = Math.max(0, end - onScreen + gap);
      const get = (k: number) => display[k % display.length];

      // La escala sigue al pulso suavemente para que el trazo no salte.
      const range = valueRange(get, Math.max(start, end - SCALE_WINDOW_S * fs), end);
      if (range) {
        const target = fitVertical(range, h);
        if (!vertical || frozen) vertical = target;
        else {
          const rate = target.pxPerUnit < vertical.pxPerUnit ? 0.25 : 0.05;
          vertical = {
            center: vertical.center + 0.1 * (target.center - vertical.center),
            pxPerUnit: vertical.pxPerUnit + rate * (target.pxPerUnit - vertical.pxPerUnit),
          };
        }
      }
      if (!vertical) return;
      const { center, pxPerUnit } = vertical;
      drawAmplitudeBar(ctx, h, pxPerUnit);

      traceStyle(ctx);
      ctx.save();
      ctx.beginPath();
      ctx.rect(MARGIN, 0, area, h);
      ctx.clip();
      ctx.beginPath();
      let pen = false;
      let prevX = -1;
      for (let k = start; k < end; k++) {
        const v = get(k);
        const x = MARGIN + ((k / fs) * pxPerS) % area;
        if (Number.isNaN(v) || x < prevX) pen = false;
        prevX = x;
        if (Number.isNaN(v)) continue;
        const y = mid - (v - center) * pxPerUnit;
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();

      if (!frozen) {
        const cursor = MARGIN + ((end / fs) * pxPerS) % area;
        ctx.fillStyle = 'rgba(79, 224, 138, 0.35)';
        ctx.fillRect(cursor, 0, 1, h);
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [monitor]);

  return (
    <div className="trace">
      <canvas ref={canvasRef} aria-label="Onda de pulso en tiempo real" role="img" />
      {children}
    </div>
  );
}
