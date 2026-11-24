import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../settings.ts';

interface Props {
  open: boolean;
  settings: Settings;
  onChange(settings: Settings): void;
  onClose(): void;
}

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onCommit(value: number): void;
}

// Solo se aplica el valor cuando es un número dentro del rango, para no
// reconfigurar el monitor con cada tecla a medio escribir.
function NumberField({ id, label, value, min, max, hint, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        value={text}
        aria-invalid={!valid}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value.replace(',', '.'));
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onCommit(v);
        }}
      />
      <p id={`${id}-hint`} className="hint">
        {valid ? hint : `Introduce un valor entre ${min} y ${max}.`}
      </p>
    </div>
  );
}

export function SettingsDialog({ open, settings, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="settings-title">
      <header className="dialog-head">
        <h2 id="settings-title">Ajustes</h2>
        <button type="button" className="button" onClick={onClose}>
          Cerrar
        </button>
      </header>

      <section>
        <h3>Alarmas de frecuencia cardiaca</h3>
        <div className="field-row">
          <NumberField
            id="hr-low"
            label="Límite bajo (lpm)"
            value={settings.hrLow}
            min={20}
            max={settings.hrHigh - 1}
            onCommit={(v) => set({ hrLow: Math.round(v) })}
          />
          <NumberField
            id="hr-high"
            label="Límite alto (lpm)"
            value={settings.hrHigh}
            min={settings.hrLow + 1}
            max={250}
            onCommit={(v) => set({ hrHigh: Math.round(v) })}
          />
        </div>
      </section>

      <section>
        <h3>Calibración</h3>
        <NumberField
          id="px-mm"
          label="Píxeles por milímetro de pantalla"
          value={Number(settings.pxPerMm.toFixed(2))}
          min={1}
          max={20}
          hint="Mide con una regla un cuadro grande de la cuadrícula: debe medir 5 mm. A 25 mm/s, cinco cuadros grandes son un segundo."
          onCommit={(v) => set({ pxPerMm: v })}
        />
      </section>

      <footer className="dialog-foot">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_SETTINGS)}>
          Restablecer valores
        </button>
      </footer>
    </dialog>
  );
}
