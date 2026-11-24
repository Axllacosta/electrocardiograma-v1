import { useMemo } from 'react';
import { autoRange, type ChartOptions, type ChartTheme } from '../chart.ts';
import { MAX_RR_MS, MIN_RR_MS, poincare } from '../dsp/rr.ts';
import { ChartCanvas } from './ChartCanvas.tsx';

export interface Interval {
  timeS: number;
  rrMs: number;
}

interface Props {
  intervals: readonly Interval[];
  theme: ChartTheme;
}

const COLOR = { screen: '#4fe08a', paper: '#1f7a4a' };

// Tacograma (intervalo entre latidos a lo largo del tiempo) y gráfico de
// Poincaré (cada intervalo frente al siguiente). Una nube alargada sobre la
// diagonal indica buena variabilidad; una nube pequeña y redonda, poca.
export function HrvCharts({ intervals, theme }: Props) {
  const valid = useMemo(() => intervals.filter((i) => i.rrMs >= MIN_RR_MS && i.rrMs <= MAX_RR_MS), [intervals]);

  const tachogram = useMemo<ChartOptions>(() => {
    const t0 = valid.length > 0 ? valid[0].timeS : 0;
    const t1 = valid.length > 0 ? valid[valid.length - 1].timeS : 60;
    return {
      theme,
      x: [0, Math.max(30, t1 - t0)],
      y: autoRange(
        valid.map((i) => i.rrMs),
        100,
      ),
      xLabel: (x) => `${Math.round(x)} s`,
      yLabel: (y) => `${Math.round(y)}`,
      series: [{ points: valid.map((i) => ({ x: i.timeS - t0, y: i.rrMs })), color: COLOR[theme], breakAbove: 3 }],
      note: 'intervalo (ms)',
    };
  }, [valid, theme]);

  const scatter = useMemo<ChartOptions>(() => {
    const rr = valid.map((i) => i.rrMs);
    const pairs = rr.slice(1).map((v, i) => ({ x: rr[i], y: v }));
    const range = autoRange(rr, 150);
    const p = poincare(rr);
    return {
      theme,
      x: range,
      y: range,
      square: true,
      identity: true,
      xLabel: (x) => `${Math.round(x)}`,
      yLabel: (y) => `${Math.round(y)}`,
      series: [{ points: pairs, color: COLOR[theme], dots: true, dotSize: 2.5 }],
      note: p ? `SD1 ${Math.round(p.sd1)} ms · SD2 ${Math.round(p.sd2)} ms` : 'faltan intervalos',
    };
  }, [valid, theme]);

  if (valid.length < 3) {
    return <p className={theme === 'screen' ? 'panel-empty' : 'hint'}>Aún no hay suficientes latidos para las gráficas.</p>;
  }

  return (
    <div className="hrv-charts">
      <figure>
        <figcaption>Tacograma</figcaption>
        <ChartCanvas options={tachogram} label="Intervalo entre latidos a lo largo del tiempo" />
      </figure>
      <figure>
        <figcaption>Poincaré (intervalo frente al siguiente, ms)</figcaption>
        <ChartCanvas options={scatter} label="Gráfico de Poincaré de los intervalos entre latidos" />
      </figure>
    </div>
  );
}
