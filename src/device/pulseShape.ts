// Forma de un pulso óptico, para la señal simulada y las pruebas: subida
// rápida (sístole) y una segunda onda más pequeña (onda dícrota). Los tiempos
// se acortan con la frecuencia cardiaca, como en un pulso real.

const WAVES = [
  { at: 0.2, width: 0.08, amp: 1 },
  { at: 0.46, width: 0.12, amp: 0.45 },
];

// dt: segundos desde el inicio del latido, rrS: duración de ese latido.
export function pulseShape(dt: number, rrS: number): number {
  const k = Math.max(0.45, Math.min(1.2, rrS / 0.85));
  let v = 0;
  for (const w of WAVES) v += w.amp * Math.exp(-((dt - w.at * k) ** 2) / (2 * (w.width * k) ** 2));
  return v;
}

// Lectura infrarroja del sensor (MAX30100 o MAX30102) para un pulso dado: la luz recibida baja
// cuando llega sangre. dc: nivel medio, pi: amplitud del pulso en % del nivel.
export function irReading(pulse: number, dc: number, pi: number): number {
  return dc * (1 - (pi / 100) * pulse);
}
