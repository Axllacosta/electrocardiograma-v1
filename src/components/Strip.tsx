import { useEffect, useRef, useState, type RefObject } from 'react';
import { formatDuration } from '../format.ts';
import { COLORS, drawAmplitudeBar, drawGrid, fitCanvas, fitVertical, traceStyle, valueRange, type Scale } from '../render.ts';

const MARGIN = 56;

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface Props {
  pulse: Float32Array;
  beats: Uint32Array;
  fs: number;
  start: number;
  scale: Scale;
  onWindowChange(samples: number): void;
}

// Tramo estático de un registro, de izquierda a derecha desde `start`, con la
// escala vertical ajustada al tramo visible.
export function Strip({ pulse, beats, fs, start, scale, onWindowChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useWidth(canvasRef);

  const pxPerS = scale.speedMmS * scale.pxPerMm;
  const windowSamples = Math.max(1, Math.floor(((width - MARGIN) / pxPerS) * fs));

  useEffect(() => onWindowChange(windowSamples), [windowSamples, onWindowChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ctx = fitCanvas(canvas);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    drawGrid(ctx, w, h, scale.pxPerMm);

    const mid = Math.round(h / 2);
    const end = Math.min(pulse.length, start + windowSamples);
    const range = valueRange((k) => pulse[k], start, end);
    const { center, pxPerUnit } = fitVertical(range ?? { lo: 0, hi: 0 }, h);
    drawAmplitudeBar(ctx, h, pxPerUnit);
    const xOf = (k: number) => MARGIN + ((k - start) / fs) * pxPerS;

    ctx.fillStyle = COLORS.marker;
    ctx.font = '12px system-ui, sans-serif';
    const firstSecond = Math.ceil(start / fs);
    for (let s = firstSecond; s * fs < end; s++) {
      if (s % 5 !== 0) continue;
      const x = xOf(s * fs);
      ctx.fillRect(Math.round(x), h - 10, 1, 10);
      ctx.fillText(formatDuration(s), x + 4, h - 4);
    }
    for (const b of beats) {
      if (b < start || b >= end) continue;
      ctx.fillRect(Math.round(xOf(b)), 6, 1, 8);
    }

    traceStyle(ctx);
    ctx.beginPath();
    let pen = false;
    for (let k = start; k < end; k++) {
      const v = pulse[k];
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const x = xOf(k);
      const y = mid - (v - center) * pxPerUnit;
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }, [pulse, beats, fs, start, scale, width, windowSamples, pxPerS]);

  return (
    <div className="trace trace-review">
      <canvas ref={canvasRef} aria-label="Tramo del registro de pulso" role="img" />
    </div>
  );
}
