import { useEffect, useRef } from 'react';
import { drawChart, type ChartOptions } from '../chart.ts';
import { fitCanvas } from '../render.ts';

interface Props {
  options: ChartOptions;
  label: string;
  height?: number;
}

// Lienzo que redibuja la gráfica al cambiar los datos o el tamaño.
export function ChartCanvas({ options, label, height = 220 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = fitCanvas(canvas);
    drawChart(ctx, canvas.clientWidth, canvas.clientHeight, options);
  }, [options]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const ctx = fitCanvas(canvas);
      drawChart(ctx, canvas.clientWidth, canvas.clientHeight, latest.current);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return <canvas ref={ref} className="chart" style={{ height }} role="img" aria-label={label} />;
}
