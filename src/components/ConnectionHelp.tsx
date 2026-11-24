import { useState } from 'react';
import type { LinkErrorKind, UnsupportedReason } from '../device/serial.ts';

interface Props {
  state: 'idle' | 'connecting' | 'error';
  unsupported: UnsupportedReason | null;
  errorKind: LinkErrorKind | null;
  errorMessage: string | null;
  onConnect(): void;
  onDemo(): void;
}

// Consejos concretos para cada fallo, en el orden en que conviene probarlos.
const TIPS: Record<LinkErrorKind, string[]> = {
  unsupported: ['Abre esta página en Chrome o Edge de escritorio.'],
  blocked: [
    'Haz clic en el candado de la barra de direcciones y permite los puertos serie para este sitio.',
    'En un equipo de empresa o colegio, puede que una política lo bloquee; prueba en otro equipo.',
  ],
  busy: [
    'Cierra el monitor serie y el serial plotter del Arduino IDE.',
    'Cierra otras pestañas de la app: solo una puede usar el puerto.',
    'Desconecta y vuelve a conectar el cable USB, y elige el puerto de nuevo.',
    'En Linux, añade tu usuario al grupo dialout y vuelve a iniciar sesión.',
  ],
  firmware: [
    'Instala en el Arduino IDE las librerías «Adafruit SSD1306» (de Adafruit) y «MAX30100lib» (de OXullo).',
    'Sube arduino/cardio_monitor/cardio_monitor.ino con el Arduino IDE.',
    'Comprueba que elegiste el puerto del Arduino y no otro dispositivo (Bluetooth, módem…).',
    'Si la subida falla, revisa que en el IDE estén elegidas la placa Arduino Uno y su puerto.',
  ],
  version: ['Vuelve a subir arduino/cardio_monitor/cardio_monitor.ino, el firmware incluido en esta carpeta del proyecto.'],
  sensor: [
    'Revisa las conexiones: VIN a 5V, GND a GND, SDA a A4 y SCL a A5.',
    'Comprueba que los pines del módulo estén soldados; si solo están apoyados en los agujeros, el contacto falla.',
    'Desconecta el USB, revisa los cables y vuelve a conectar.',
    'Algunos módulos morados traen las resistencias de I2C conectadas a 1,8 V y no se entienden con el Uno. Si todo lo demás está bien, prueba con otro módulo.',
  ],
  lost: [
    'Revisa que el cable USB esté bien conectado; evita los hubs sin alimentación.',
    'Si el puerto aparece y desaparece, prueba con otro cable o puerto USB.',
  ],
};

function copy(text: string, done: () => void) {
  void navigator.clipboard?.writeText(text).then(done, () => undefined);
}

function Wiring() {
  return (
    <details className="help-details">
      <summary>Conexiones y colocación del dedo</summary>
      <table className="help-table">
        <thead>
          <tr>
            <th>MAX30100 / MAX30102</th>
            <th>Arduino Uno</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>VIN</td><td>5V</td></tr>
          <tr><td>GND</td><td>GND</td></tr>
          <tr><td>SDA</td><td>A4</td></tr>
          <tr><td>SCL</td><td>A5</td></tr>
          <tr><td>INT</td><td>sin conectar</td></tr>
        </tbody>
      </table>
      <p>
        Apoya la yema del dedo índice sobre la ventana del sensor con una presión suave y constante: si aprietas, el
        pulso casi desaparece. Quédate quieto, con la mano a la altura del corazón y el dedo tapado de la luz directa.
      </p>
    </details>
  );
}

function PortMissing() {
  return (
    <details className="help-details">
      <summary>¿El Arduino no aparece en la lista de puertos?</summary>
      <ul>
        <li>Usa un cable USB de datos: algunos solo cargan.</li>
        <li>Las placas compatibles con chip CH340 necesitan su controlador en Windows y macOS.</li>
        <li>Mira si el puerto aparece en el Arduino IDE (Herramientas → Puerto). Si ahí tampoco sale, el problema es del cable o el controlador.</li>
        <li>En Linux, añade tu usuario al grupo dialout y vuelve a iniciar sesión.</li>
      </ul>
    </details>
  );
}

export function ConnectionHelp({ state, unsupported, errorKind, errorMessage, onConnect, onDemo }: Props) {
  const [copied, setCopied] = useState(false);

  if (unsupported === 'insecure') {
    const local = `http://localhost:${window.location.port || '3000'}${window.location.pathname}`;
    return (
      <div className="help">
        <h2>Abre la página desde localhost</h2>
        <p>
          Entraste por {window.location.host}. Chrome solo permite usar puertos serie en localhost o en sitios https, así
          que desde esta dirección no se puede conectar el Arduino.
        </p>
        <a className="button button-primary" href={local}>
          Ir a {local}
        </a>
        <button type="button" className="button button-ghost" onClick={onDemo}>
          Probar con señal simulada
        </button>
      </div>
    );
  }

  if (unsupported === 'browser') {
    return (
      <div className="help">
        <h2>Este navegador no puede conectar con el Arduino</h2>
        <p>
          Firefox, Safari y los navegadores de móvil no tienen Web Serial. Abre esta misma dirección en Chrome o Edge de
          escritorio.
        </p>
        <div className="help-actions">
          <button type="button" className="button button-primary" onClick={() => copy(window.location.href, () => setCopied(true))}>
            {copied ? 'Dirección copiada' : 'Copiar dirección'}
          </button>
          <button type="button" className="button button-ghost" onClick={onDemo}>
            Probar con señal simulada
          </button>
        </div>
      </div>
    );
  }

  if (state === 'connecting') {
    return (
      <div className="help">
        <h2>Esperando a la placa…</h2>
        <p>El Arduino se reinicia al abrir el puerto y tarda un par de segundos en empezar a enviar datos.</p>
      </div>
    );
  }

  if (state === 'error') {
    const tips = errorKind ? TIPS[errorKind] : [];
    const showWiring = errorKind === 'firmware' || errorKind === 'sensor';
    return (
      <div className="help">
        <h2 className="trace-error">No se pudo conectar</h2>
        {errorMessage && <p>{errorMessage}</p>}
        {tips.length > 0 && (
          <ol className="help-steps">
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        )}
        <div className="help-actions">
          <button type="button" className="button button-primary" onClick={onConnect}>
            Volver a conectar
          </button>
          <button type="button" className="button button-ghost" onClick={onDemo}>
            Probar con señal simulada
          </button>
        </div>
        {showWiring && <Wiring />}
      </div>
    );
  }

  return (
    <div className="help">
      <h2>Conecta el Arduino</h2>
      <ol className="help-steps">
        <li>Sube el firmware de arduino/cardio_monitor con el Arduino IDE (necesita las librerías Adafruit SSD1306 y MAX30100lib).</li>
        <li>Cierra el monitor serie del IDE: el puerto solo lo puede usar un programa.</li>
        <li>Pulsa Conectar, elige el puerto del Arduino en la lista y apoya el dedo sobre el sensor.</li>
      </ol>
      <div className="help-actions">
        <button type="button" className="button button-primary" onClick={onConnect}>
          Conectar
        </button>
        <button type="button" className="button button-ghost" onClick={onDemo}>
          Probar con señal simulada
        </button>
      </div>
      <PortMissing />
      <Wiring />
    </div>
  );
}
