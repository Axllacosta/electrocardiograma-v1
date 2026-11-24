import { parseHeader, parseSample, SUPPORTED_VERSION, type DeviceInfo, type Sample } from './protocol.ts';

const SENSOR_MESSAGE =
  'El Arduino responde, pero no encuentra el sensor de pulso (MAX30100 o MAX30102). Revisa los cables SDA (A4), SCL (A5), VIN y GND.';

const BAUD_RATE = 115200;
const READ_BUFFER = 16384;
// El Uno se reinicia al abrir el puerto y el bootloader tarda en ceder el
// control, así que la cabecera se pide de nuevo si no ha llegado a los 2 s.
const HEADER_QUERY_MS = 2000;
const HEADER_TIMEOUT_MS = 4500;
const MAX_LINE = 128;

// Qué falló, para que la interfaz muestre los consejos que corresponden.
export type LinkErrorKind = 'unsupported' | 'blocked' | 'busy' | 'firmware' | 'version' | 'sensor' | 'lost';

export class LinkError extends Error {
  readonly kind: LinkErrorKind;

  constructor(kind: LinkErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

// Por qué no hay Web Serial: 'insecure' si se entró por una dirección que no es
// localhost ni https (Chrome lo desactiva ahí), 'browser' si el navegador no lo tiene.
export type UnsupportedReason = 'insecure' | 'browser';

export interface LinkHandlers {
  onSample(sample: Sample): void;
  onLost(message: string): void;
}

interface HeaderWait {
  resolve(info: DeviceInfo): void;
  reject(err: Error): void;
  timers: number[];
}

export class SerialLink {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private loop: Promise<void> | null = null;
  private info: DeviceInfo | null = null;
  private waiting: HeaderWait | null = null;
  private closing = false;
  private readonly handlers: LinkHandlers;

  constructor(handlers: LinkHandlers) {
    this.handlers = handlers;
  }

  static supported(): boolean {
    return SerialLink.unsupportedReason() === null;
  }

  static unsupportedReason(): UnsupportedReason | null {
    if (typeof navigator !== 'undefined' && navigator.serial !== undefined) return null;
    if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure';
    return 'browser';
  }

  // Devuelve null si se cierra el selector de puertos sin elegir ninguno.
  async connect(): Promise<DeviceInfo | null> {
    const serial = navigator.serial;
    if (!serial) {
      throw new LinkError('unsupported', 'Este navegador no permite acceder a puertos serie. Usa Chrome o Edge de escritorio.');
    }

    let port: SerialPort;
    try {
      port = await serial.requestPort();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return null;
      if (err instanceof DOMException && err.name === 'SecurityError') {
        throw new LinkError('blocked', 'El navegador bloqueó el acceso a los puertos serie para esta página.');
      }
      throw err;
    }

    try {
      await port.open({ baudRate: BAUD_RATE, bufferSize: READ_BUFFER });
    } catch {
      throw new LinkError(
        'busy',
        'No se pudo abrir el puerto. Cierra el monitor serie del Arduino IDE o cualquier otro programa que lo esté usando.',
      );
    }

    this.port = port;
    this.info = null;
    this.closing = false;

    const header = this.waitForHeader(port);
    this.loop = this.readLoop(port);

    try {
      return await header;
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect() {
    this.closing = true;
    this.clearWait();
    const port = this.port;
    this.port = null;
    if (this.reader) await this.reader.cancel().catch(() => undefined);
    if (this.loop) await this.loop;
    this.loop = null;
    if (port) await port.close().catch(() => undefined);
  }

  private waitForHeader(port: SerialPort): Promise<DeviceInfo> {
    return new Promise((resolve, reject) => {
      const query = window.setTimeout(() => void this.write(port, '?'), HEADER_QUERY_MS);
      const timeout = window.setTimeout(() => {
        this.fail(
          new LinkError(
            'firmware',
            'La placa no respondió con el firmware de la app. Comprueba que tiene cargado arduino/cardio_monitor/cardio_monitor.ino (versión para MAX30100 o MAX30102).',
          ),
        );
      }, HEADER_TIMEOUT_MS);
      this.waiting = { resolve, reject, timers: [query, timeout] };
    });
  }

  private clearWait() {
    if (!this.waiting) return;
    for (const t of this.waiting.timers) window.clearTimeout(t);
  }

  private fail(err: Error) {
    const wait = this.waiting;
    if (!wait) return;
    this.clearWait();
    this.waiting = null;
    wait.reject(err);
  }

  private async write(port: SerialPort, text: string) {
    if (!port.writable) return;
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  private async readLoop(port: SerialPort) {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (line) this.handleLine(line);
        }
        if (buffer.length > MAX_LINE) buffer = '';
      }
    } catch {
      // La lectura termina con error al desconectar el cable; se informa abajo.
    } finally {
      reader.releaseLock();
      this.reader = null;
    }

    if (!this.closing) this.lost('Se perdió la conexión con la placa. Revisa el cable USB y vuelve a conectar.');
  }

  private lost(message: string) {
    if (this.waiting) {
      this.fail(new LinkError('lost', message));
      return;
    }
    void this.disconnect();
    this.handlers.onLost(message);
  }

  private handleLine(line: string) {
    if (line.startsWith('#')) {
      const header = parseHeader(line);
      if (!header) return;
      if (header.kind === 'error') {
        if (this.waiting) this.fail(new LinkError('sensor', SENSOR_MESSAGE));
        else if (this.info) this.lost('Se perdió la comunicación con el sensor de pulso. Revisa sus cables y vuelve a conectar.');
        return;
      }
      const info = header.info;
      if (!this.info) {
        if (info.version !== SUPPORTED_VERSION) {
          const old = info.sensor === 'ad8232' ? ' (la del AD8232)' : '';
          this.fail(
            new LinkError(
              'version',
              `La placa tiene el firmware versión ${info.version}${old}; esta aplicación necesita la ${SUPPORTED_VERSION}, para el MAX30100 o MAX30102.`,
            ),
          );
          return;
        }
        this.info = info;
        const wait = this.waiting;
        this.clearWait();
        this.waiting = null;
        wait?.resolve(info);
      } else if (info.fs !== this.info.fs || info.bits !== this.info.bits) {
        this.lost('La placa cambió su configuración de muestreo. Vuelve a conectar.');
      }
      return;
    }

    if (!this.info) return;
    const sample = parseSample(line, this.info.bits);
    if (sample) this.handlers.onSample(sample);
  }
}
