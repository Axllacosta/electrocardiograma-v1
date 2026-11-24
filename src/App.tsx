import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { primeAudio, pulseTone } from './audio.ts';
import { activeAlarms, AlarmBar } from './components/Alarms.tsx';
import { ConnectionHelp } from './components/ConnectionHelp.tsx';
import { LiveTrace, type Frozen } from './components/LiveTrace.tsx';
import { Recordings } from './components/Recordings.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { HrvCharts, type Interval } from './components/HrvCharts.tsx';
import { Vitals } from './components/Vitals.tsx';
import { BreathingView } from './views/BreathingView.tsx';
import { MeasurementView } from './views/MeasurementView.tsx';
import { RecoveryView } from './views/RecoveryView.tsx';
import type { DeviceInfo } from './device/protocol.ts';
import { DemoSource } from './device/demo.ts';
import { LinkError, SerialLink, type LinkErrorKind } from './device/serial.ts';
import { formatDuration } from './format.ts';
import { Monitor, type RecordingData, type Snapshot } from './monitor.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';
import { describeProcessing } from './dsp/ppg.ts';
import { saveRecording } from './store/recordings.ts';

type LinkState = 'idle' | 'connecting' | 'streaming' | 'error';
type View = 'monitor' | 'breathing' | 'measurement' | 'recovery' | 'records';

const VIEWS: { id: View; label: string }[] = [
  { id: 'monitor', label: 'Monitor' },
  { id: 'breathing', label: 'Respiración' },
  { id: 'measurement', label: 'Medición' },
  { id: 'recovery', label: 'Recuperación' },
  { id: 'records', label: 'Registros' },
];

// Intervalos recientes con buena señal, para el tacograma y el Poincaré.
function recentIntervals(monitor: Monitor | null): Interval[] {
  if (!monitor) return [];
  return monitor.beatLog
    .filter((b) => b.rrMs !== null && b.quality !== 'poor')
    .map((b) => ({ timeS: b.timeS, rrMs: b.rrMs! }));
}

interface SegmentedProps<T extends number> {
  label: string;
  unit: string;
  options: readonly T[];
  value: T;
  onChange(value: T): void;
}

function Segmented<T extends number>({ label, unit, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      <span className="segmented-label">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
      <span className="muted">{unit}</span>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>('monitor');
  const [link, setLink] = useState<LinkState>('idle');
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<LinkErrorKind | null>(null);
  const [demo, setDemo] = useState(false);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [hrvOpen, setHrvOpen] = useState(false);
  const [intervals, setIntervals] = useState<Interval[]>([]);

  const monitorRef = useRef<Monitor | null>(null);
  const demoRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const persistRecording = useCallback(async (data: RecordingData | null | undefined) => {
    if (!data) return;
    try {
      await saveRecording(data, demoRef.current ? 'Señal simulada (demostración)' : 'Registro sin nombre');
      setRecordsVersion((v) => v + 1);
      setNotice(`Registro de ${formatDuration(data.stats.durationS)} guardado en Registros.`);
    } catch (err) {
      setNotice(`No se pudo guardar el registro: ${(err as Error).message}`);
    }
  }, []);

  const serial = useMemo(
    () =>
      new SerialLink({
        onSample: (sample) => monitorRef.current?.push(sample),
        onLost: (message) => {
          void persistRecording(monitorRef.current?.stopRecording());
          monitorRef.current = null;
          setSnap(null);
          setFrozen(null);
          setLink('error');
          setLinkKind('lost');
          setLinkMessage(message);
        },
      }),
    [persistRecording],
  );

  const demoSource = useMemo(() => new DemoSource((sample) => monitorRef.current?.push(sample)), []);

  const startMonitor = (device: DeviceInfo) => {
    const monitor = new Monitor(device);
    monitor.onBeat = () => {
      if (settingsRef.current.pulseTone) pulseTone();
    };
    monitorRef.current = monitor;
    setInfo(device);
    setLink('streaming');
  };

  const startDemo = () => {
    demoRef.current = true;
    setDemo(true);
    setLinkMessage(null);
    setLinkKind(null);
    startMonitor(demoSource.start());
  };

  const connect = async () => {
    setLink('connecting');
    setLinkMessage(null);
    setLinkKind(null);
    try {
      const device = await serial.connect();
      if (!device) {
        setLink('idle');
        return;
      }
      demoRef.current = false;
      setDemo(false);
      startMonitor(device);
    } catch (err) {
      setLink('error');
      setLinkKind(err instanceof LinkError ? err.kind : null);
      setLinkMessage((err as Error).message);
    }
  };

  const disconnect = async () => {
    await persistRecording(monitorRef.current?.stopRecording());
    if (demoRef.current) demoSource.stop();
    else await serial.disconnect();
    demoRef.current = false;
    setDemo(false);
    monitorRef.current = null;
    setSnap(null);
    setFrozen(null);
    setLink('idle');
  };

  useEffect(() => {
    if (link !== 'streaming') return;
    const timer = window.setInterval(() => {
      if (monitorRef.current) setSnap(monitorRef.current.snapshot());
    }, 250);
    return () => window.clearInterval(timer);
  }, [link]);

  useEffect(() => {
    if (link !== 'streaming' || !hrvOpen || view !== 'monitor') return;
    const update = () => setIntervals(recentIntervals(monitorRef.current));
    update();
    const timer = window.setInterval(update, 2000);
    return () => window.clearInterval(timer);
  }, [link, hrvOpen, view]);

  useEffect(() => saveSettings(settings), [settings]);

  const recording = snap?.recordingSeconds != null;

  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recording]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleRecording = () => {
    const monitor = monitorRef.current;
    if (!monitor) return;
    if (recording) {
      void persistRecording(monitor.stopRecording());
    } else {
      monitor.startRecording();
      setNotice(null);
    }
    setSnap(monitor.snapshot());
  };

  const toggleFreeze = () => {
    const monitor = monitorRef.current;
    if (frozen || !monitor) {
      setFrozen(null);
      return;
    }
    setFrozen({ n: monitor.n, display: monitor.display.slice() });
  };

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const scale = useMemo(
    () => ({ pxPerMm: settings.pxPerMm, speedMmS: settings.speedMmS }),
    [settings.pxPerMm, settings.speedMmS],
  );

  const streaming = link === 'streaming';
  const toolProps = {
    monitor: streaming ? monitorRef.current : null,
    onConnect: () => void connect(),
    onDemo: startDemo,
    canConnect: SerialLink.supported() && link !== 'connecting',
  };
  const alarms = snap ? activeAlarms(snap, settings.hrLow, settings.hrHigh) : [];
  const hrAlarm = alarms.some((a) => a.id === 'hrhigh' || a.id === 'hrlow');
  const unsupported = SerialLink.unsupportedReason();
  const supported = unsupported === null;

  let deviceText = 'Sin conexión';
  if (!supported) deviceText = 'Navegador sin Web Serial';
  if (link === 'connecting') deviceText = 'Conectando…';
  if (streaming && info) deviceText = demo ? 'Señal simulada' : `${info.sensor.toUpperCase()} conectado, ${info.fs} Hz`;
  if (link === 'error') deviceText = 'Conexión interrumpida';

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">El electrocardiograma</h1>
        <nav className="tabs" aria-label="Secciones">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <span className={`device device-${link}`}>{deviceText}</span>
        <button type="button" className="button" onClick={() => setSettingsOpen(true)}>
          Ajustes
        </button>
        {streaming ? (
          <button type="button" className="button" onClick={() => void disconnect()}>
            {demo ? 'Detener simulación' : 'Desconectar'}
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary"
            disabled={!supported || link === 'connecting'}
            title={supported ? undefined : 'Este navegador no tiene Web Serial. Usa Chrome o Edge de escritorio.'}
            onClick={() => void connect()}
          >
            Conectar
          </button>
        )}
      </header>

      {view === 'monitor' ? (
        <main className="monitor">
          <section className="screen">
            <div className="screen-main">
              <div className="trace-meta">
                <span>Pulso</span>
                <span>{settings.speedMmS} mm/s</span>
                <span>escala automática</span>
                <span>{describeProcessing()}</span>
                {demo && <span className="demo-tag">Demostración: señal simulada</span>}
                {frozen && <span className="frozen">Congelado</span>}
                <AlarmBar alarms={alarms} />
              </div>
              <LiveTrace monitor={monitorRef} scale={scale} frozen={frozen}>
                {!streaming && (
                  <div className="trace-message">
                    <ConnectionHelp
                      state={link}
                      unsupported={unsupported}
                      errorKind={linkKind}
                      errorMessage={linkMessage}
                      onConnect={() => void connect()}
                      onDemo={startDemo}
                    />
                  </div>
                )}
              </LiveTrace>
            </div>
            <Vitals snap={snap} hrLow={settings.hrLow} hrHigh={settings.hrHigh} hrAlarm={hrAlarm} />
          </section>

          <div className="controls">
            <Segmented
              label="Velocidad"
              unit="mm/s"
              options={[25, 50] as const}
              value={settings.speedMmS}
              onChange={(v) => update({ speedMmS: v })}
            />
            <button type="button" className="button" aria-pressed={frozen !== null} disabled={!streaming} onClick={toggleFreeze}>
              {frozen ? 'Reanudar' : 'Congelar'}
            </button>
            <button
              type="button"
              className="button"
              aria-pressed={settings.pulseTone}
              onClick={() => {
                if (!settings.pulseTone) primeAudio();
                update({ pulseTone: !settings.pulseTone });
              }}
            >
              Tono de pulso
            </button>
            <button type="button" className="button" disabled={!streaming} onClick={() => monitorRef.current?.resetStats()}>
              Reiniciar estadísticas
            </button>
            <div className="spacer" />
            {notice && (
              <span className="notice-inline" role="status">
                {notice}
              </span>
            )}
            <button
              type="button"
              className={recording ? 'button button-recording' : 'button'}
              disabled={!streaming}
              onClick={toggleRecording}
            >
              <span className="rec-dot" aria-hidden="true" />
              {recording ? `Detener ${formatDuration(snap?.recordingSeconds ?? 0)}` : 'Grabar'}
            </button>
          </div>

          {streaming && snap && (
            <p className="status-line">
              Muestreo recibido: {snap.rateHz === null ? 'midiendo' : `${snap.rateHz.toFixed(1)} Hz`}. Muestras
              perdidas en la sesión: {snap.droppedTotal}.
            </p>
          )}

          <details className="panel" open={hrvOpen} onToggle={(e) => setHrvOpen(e.currentTarget.open)}>
            <summary>Variabilidad: tacograma y gráfico de Poincaré</summary>
            {streaming ? (
              <HrvCharts intervals={intervals} theme="screen" />
            ) : (
              <p className="panel-empty">Conecta el sensor para ver las gráficas.</p>
            )}
          </details>
        </main>
      ) : null}

      {/* Las herramientas siguen montadas al cambiar de pestaña para no perder una medición en curso. */}
      <main className="records" hidden={view !== 'breathing'}>
        <BreathingView {...toolProps} />
      </main>
      <main className="records" hidden={view !== 'measurement'}>
        <MeasurementView {...toolProps} />
      </main>
      <main className="records" hidden={view !== 'recovery'}>
        <RecoveryView {...toolProps} />
      </main>

      {view === 'records' && (        <main className="records">
          <Recordings settings={settings} version={recordsVersion} />
        </main>
      )}

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
