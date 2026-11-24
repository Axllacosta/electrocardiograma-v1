export interface Settings {
  speedMmS: 25 | 50;
  pxPerMm: number;
  hrLow: number;
  hrHigh: number;
  pulseTone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speedMmS: 25,
  pxPerMm: 96 / 25.4,
  hrLow: 50,
  hrHigh: 120,
  pulseTone: false,
};

const KEY = 'cardio-monitor.settings';

export function loadSettings(): Settings {
  const raw = localStorage.getItem(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  const saved = JSON.parse(raw) as Partial<Settings>;
  // Solo se recuperan los ajustes que existen en esta versión.
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (saved[key] !== undefined) (settings as Record<string, unknown>)[key] = saved[key];
  }
  return settings;
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
