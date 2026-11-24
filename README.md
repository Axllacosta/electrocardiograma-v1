# El electrocardiograma

Monitor de pulso para Arduino Uno con un sensor óptico MAX30100 o MAX30102. La placa envía
las lecturas de luz infrarroja por USB y la página las muestra en el navegador
mediante Web Serial, sin servidor intermedio.

Muestra la onda de pulso y mide la frecuencia cardiaca, el intervalo entre
latidos, la variabilidad (SDNN, RMSSD, tacograma y gráfico de Poincaré), el
índice de perfusión, una estimación de la saturación de oxígeno (SpO2) y la
frecuencia respiratoria, con un indicador de calidad de la señal. Avisa cuando
no hay dedo sobre el sensor, de señal saturada o de mala calidad, de falta de
pulso y de pérdida de muestras, y graba registros que se pueden revisar y
exportar a CSV.

Además incluye tres herramientas:

- **Respiración guiada**: un círculo marca el ritmo (de 4,5 a 7 respiraciones por
  minuto) y la página muestra cómo la frecuencia cardiaca sube y baja con cada
  respiración, con su oscilación y su coherencia.
- **Medición en reposo**: 1, 2 o 5 minutos quieto, con un resumen que se guarda
  para ver la evolución de la FC en reposo y del RMSSD a lo largo de los días.
- **Prueba de recuperación**: un minuto de reposo, ejercicio y un minuto de
  recuperación; mide cuánto baja la FC en ese minuto.

> Es una herramienta de aprendizaje e investigación. Un Arduino con un sensor
> de pulso no es un dispositivo médico y sus mediciones no sirven para diagnosticar.

## Requisitos

- Node.js 20.19 o superior, o 22.12 o superior (Vite 8 no arranca con versiones anteriores).
  Las pruebas (`npm test`) necesitan Node 22.6 o superior.
- Chrome o Edge de escritorio. Firefox y Safari no tienen Web Serial.
- Arduino Uno, sensor MAX30100 (módulo GY-MAX3010X), pantalla OLED SSD1306
  de 128×64, buzzer en el pin 8 y LED en el pin 7.
- En el Arduino IDE, las librerías **Adafruit SSD1306** (de Adafruit; instala
  también Adafruit GFX) y **MAX30100lib** (de OXullo Intersecans).

El firmware es el programa original del circuito (pantalla con las
pulsaciones, pitido y LED en cada latido) con el envío de las muestras a la
app añadido. Lee el sensor a 50 muestras por segundo.

## Conexiones

| Sensor | Arduino Uno |
| ------ | ----------- |
| VIN      | 5V          |
| GND      | GND         |
| SDA      | A4          |
| SCL      | A5          |
| INT      | sin conectar |

Suelda los pines del módulo: si solo están apoyados en los agujeros, el bus I2C
falla de forma intermitente.

## Cómo medir

Apoya la yema del dedo índice sobre la ventana del sensor con una presión suave
y constante. Si aprietas, el pulso casi desaparece; si el dedo se mueve, aparecen
falsos latidos. Mantén la mano quieta, a la altura del corazón y tapada de la luz
directa (el sol y algunas lámparas saturan el sensor).

## Puesta en marcha

1. Abre `arduino/cardio_monitor/cardio_monitor.ino` en el Arduino IDE, elige la
   placa Arduino Uno y su puerto, y súbelo.
2. Cierra el monitor serie del IDE: el puerto solo puede usarlo un programa a la vez.
3. Abre una terminal **dentro de la carpeta `cardio-monitor`** (la que contiene
   `package.json`), instala las dependencias y arranca la aplicación:

   ```
   npm install
   npm run dev
   ```

4. El navegador se abre solo en http://localhost:3000 (o en el siguiente puerto
   libre si el 3000 está ocupado; la terminal muestra la dirección). Pulsa
   **Conectar** y elige el puerto del Arduino.

Sin Arduino a mano, pulsa **Probar con señal simulada** para comprobar que la
aplicación funciona con un pulso inventado. Los registros grabados así quedan
marcados como demostración.

## Si no arranca

- **«El electrocardiograma no puede arrancar todavía»** en la terminal: el mensaje dice
  qué falta (versión de Node o `npm install`).
- **`ENOENT ... package.json`**: estás en la carpeta equivocada; entra en
  `cardio-monitor`.
- **Página que dice «El electrocardiograma no se cargó»**: abriste `index.html`
  directamente. Usa la dirección que muestra `npm run dev`.
- **El botón Conectar está desactivado**: el navegador no tiene Web Serial, o
  entraste por la IP del equipo en vez de por `localhost`. La página indica cuál
  de los dos casos es.
- **Error al conectar**: la página muestra los pasos a seguir según el fallo
  (puerto ocupado, firmware sin cargar, sensor sin conectar).
- **«No encuentra el sensor de pulso»**: la pantalla del circuito también dirá
  «Sensor no encontrado». Revisa VIN, GND, SDA (A4) y SCL (A5) y que los pines
  del módulo estén soldados.
- **La pantalla no enciende y el LED «L» del Arduino parpadea**: el Arduino no
  encuentra la pantalla; revisa sus cables.

En Linux, si el puerto no aparece por falta de permisos, añade tu usuario al
grupo `dialout` (`sudo usermod -a -G dialout $USER`) y vuelve a iniciar sesión.

## Calibración

- **Escala de pantalla**: la cuadrícula está en milímetros para que la velocidad
  (25 o 50 mm/s) sea real. Mide con una regla un cuadro grande: debe medir 5 mm.
  Si no, ajusta los píxeles por milímetro en Ajustes.
- **Amplitud**: la escala vertical es automática, como en un pulsioxímetro,
  porque la amplitud del pulso óptico cambia mucho entre personas y con la
  presión del dedo. La barra del borde izquierdo indica cuánto representa en %.

## Protocolo serie

115200 baudios, una línea de texto por muestra:

```
#cardio-monitor v3 sensor=max30100 fs=50 bits=16    cabecera, al arrancar y al recibir '?'
#cardio-monitor v3 error=sensor                     el sensor no responde
<seq>,<ir>,<rojo>                                   seq de 0 a 255, luz de 0 a 2^bits - 1
<seq>,L                                             no hay dedo sobre el sensor
```

El MAX30100 entrega 50 muestras por segundo de 16 bits. La app también acepta
otras frecuencias y el MAX30102 (18 bits), porque lee ambos datos de la cabecera.
El contador `seq` permite detectar muestras perdidas, que se marcan como huecos en
el trazado y en los registros. Si la placa no envía la cabecera en 4,5 s, la
aplicación cierra el puerto e indica que falta el firmware.

## Procesamiento

El procesamiento está dividido en módulos independientes, cada uno con sus
pruebas:

| Módulo | Qué hace |
| ------ | -------- |
| `src/dsp/ppg.ts` | Filtra la luz infrarroja (paso banda 0,5–5 Hz) y la expresa en % del nivel medio. Detecta latidos con la función de suma de pendientes (Zong y otros, 2003), umbral adaptativo, descarte de la onda dícrota y amplitud mínima de 0,1 %. El instante de cada latido es el de máxima pendiente, interpolado entre muestras. |
| `src/dsp/rr.ts` | FC (media de 8 intervalos), SDNN, RMSSD y SD1/SD2 de Poincaré, descartando intervalos que cambian más de un 20 %. |
| `src/analysis/quality.ts` | Calidad de cada pulso comparándolo con una plantilla de los pulsos recientes, su amplitud y su intervalo. Los latidos de mala calidad no entran en la SpO2, la respiración ni la medición en reposo. |
| `src/analysis/spo2.ts` | SpO2 por razón de razones (pulso rojo frente a infrarrojo, en ventanas de 4 s) con la curva de referencia de Maxim. Solo se muestra con señal buena. |
| `src/analysis/respiration.ts` | Frecuencia respiratoria a partir de cómo cambian el intervalo entre latidos y la amplitud del pulso, buscando su ritmo común entre 6 y 30 rpm en el último minuto. |
| `src/analysis/breathing.ts` | Marcapasos de la respiración guiada, oscilación de la FC por ciclo y coherencia (fracción de la variación de la FC al ritmo marcado). |
| `src/analysis/measurement.ts` | Resumen de la medición en reposo. |
| `src/analysis/recovery.ts` | FC en reposo, FC máxima al terminar el ejercicio (primeros 20 s) y FC al minuto. |

### Limitaciones

- La **SpO2 es una estimación**: no está calibrada contra un oxímetro clínico y
  cada sensor y dedo son algo distintos, así que puede desviarse varios puntos.
  No la uses para decisiones de salud.
- La **frecuencia respiratoria** necesita al menos 40 s de señal limpia y falla
  si hablas o te mueves.
- La **variabilidad** medida con pulso óptico es algo menos precisa que con ECG.
- En la **prueba de recuperación**, el minuto empieza al pulsar el botón con el
  dedo apoyado; cualquier demora reduce la bajada medida.

## Registros

Se guardan en el almacenamiento del navegador (IndexedDB), así que dependen del
navegador y del perfil en que se grabaron. Para conservarlos, expórtalos a CSV.
El archivo incluye en la cabecera el sensor y la frecuencia de muestreo, y por
cada muestra el tiempo, las lecturas infrarroja y roja, el pulso filtrado en %,
la marca de latido y el estado (`ok`, `sin_dedo` o `perdida`).

Los resultados de la medición en reposo y de la prueba de recuperación se
guardan aparte, en el historial de cada herramienta.

Los registros de la versión de ECG (AD8232) siguen en la lista con sus
datos resumidos, pero no se pueden ver como pulso.

## Scripts

- `npm run dev` (o `npm start`): servidor de desarrollo en http://localhost:3000.
- `npm run build`: comprueba los tipos y genera `dist/`.
- `npm run preview`: sirve la versión compilada en el mismo puerto.
- `npm test`: pruebas del procesamiento con pulso sintético.
- `npm run check`: comprobación de tipos.
