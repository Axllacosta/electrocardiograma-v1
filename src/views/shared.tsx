import { useEffect, useRef, useState } from 'react';
import type { BeatEvent } from '../analysis/measurement.ts';
import type { Monitor } from '../monitor.ts';

// Piezas comunes de las herramientas (respiración, medición, recuperación).

export interface ToolProps {
  monitor: Monitor | null;
  onConnect(): void;
  onDemo(): void;
  canConnect: boolean;
}

export function NeedsSignal({ onConnect, onDemo, canConnect }: Omit<ToolProps, 'monitor'>) {
  return (
    <div className="tool-needs">
      <p>Esta herramienta necesita la señal del sensor.</p>
      <div className="help-actions">
        <button type="button" className="button button-primary" disabled={!canConnect} onClick={onConnect}>
          Conectar
        </button>
        <button type="button" className="button" onClick={onDemo}>
          Probar con señal simulada
        </button>
      </div>
    </div>
  );
}

// Llama a `onBeat` con cada latido evaluado mientras `active` sea verdadero.
export function useBeats(monitor: Monitor | null, active: boolean, onBeat: (beat: BeatEvent) => void) {
  const handler = useRef(onBeat);
  handler.current = onBeat;
  useEffect(() => {
    if (!monitor || !active) return;
    return monitor.subscribe({ onBeat: (b) => handler.current(b) });
  }, [monitor, active]);
}

// Vuelve a dibujar el componente cada `ms` milisegundos mientras esté activo.
export function useTick(active: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return tick;
}

export function heartRateOf(beat: BeatEvent): number | null {
  if (beat.rrMs === null || beat.quality === 'poor' || beat.rrMs < 300 || beat.rrMs > 2000) return null;
  return 60000 / beat.rrMs;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
