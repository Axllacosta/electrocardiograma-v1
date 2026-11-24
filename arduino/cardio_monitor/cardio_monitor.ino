// El electrocardiograma - firmware para Arduino Uno + MAX30100 + pantalla OLED
//
// Es el programa original del circuito (pantalla con las pulsaciones, pitido
// y LED en cada latido) al que se le añadió el envío de las muestras a la
// app de la computadora. La comunicación con el sensor y la pantalla es la
// misma que en el original, que funciona en este circuito.
//
// Librerías (Arduino IDE -> Administrar bibliotecas):
//   "Adafruit SSD1306" de Adafruit (instala también "Adafruit GFX")
//   "MAX30100lib" de OXullo Intersecans
//
// Protocolo hacia la app (115200 baudios, una línea por muestra):
//   #cardio-monitor v3 sensor=max30100 fs=50 bits=16   cabecera, al arrancar y al recibir '?'
//   #cardio-monitor v3 error=sensor                    el sensor no responde
//   <seq>,<ir>,<rojo>                                  muestra, seq de 0 a 255
//   <seq>,L                                            no hay dedo sobre el sensor

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "MAX30100.h"

#define SCREEN_W   128
#define SCREEN_H   64
#define OLED_ADDR  0x3C   // si no enciende, prueba 0x3D

// I2C a 100 kHz también para la pantalla: más tolerante a contactos flojos
Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1, 100000UL, 100000UL);
MAX30100 sensor;

// ---- Buzzer y LED de latido ----
#define BUZZER_PIN  8
#define LED_PIN     7
const uint16_t BEEP_HZ  = 2700;   // frecuencia de resonancia típica = más fuerte
const uint8_t  BEEP_MS  = 100;    // duración del pitido
const uint8_t  LED_MS   = 100;    // tiempo encendido del LED

// ---- Área de la gráfica (debajo de los BPM) ----
const uint8_t BASE_Y    = 54;   // línea base del dibujo
const uint8_t GAP       = 6;    // hueco que borra delante del cursor (barrido)

uint8_t wave[SCREEN_W];     // coordenada Y de cada columna
uint8_t cursorX = 0;        // columna donde se escribe la siguiente muestra

// Forma de onda P-QRS-T dibujada en cada latido (es un dibujo, no una medición)
const int8_t PQRST[] PROGMEM = {
  1, 2, 3, 3, 2, 1, 0,        // onda P
  0, 0, 0,                    // segmento PR
  -2, 8, 22, 30, 14, -7, -3,  // complejo QRS
  0, 0, 0, 0,                 // segmento ST
  1, 2, 3, 4, 5, 5, 4, 3, 2, 1 // onda T
};
const uint8_t PQRST_LEN = sizeof(PQRST);
uint8_t ecgPos = PQRST_LEN;  // posición dentro de la plantilla (LEN = parada)

// ---- Filtro de la señal del sensor ----
float dcLevel = 0;
float smooth  = 0;
float envelope = 0;         // amplitud reciente (para el umbral de latido)
bool aboveThr = false;

// ---- Cálculo de BPM ----
const uint8_t RATE_SIZE = 4;
uint8_t rates[RATE_SIZE];
uint8_t rateSpot = 0;
unsigned long lastBeat = 0;
int beatAvg = 0;

const uint16_t FINGER_THRESHOLD = 3000;  // sin dedo el IR está cerca de 0
uint16_t lastIR = 0;
unsigned long lastDraw = 0;

// ---- Envío a la app ----
// El puerto serie se maneja directamente, sin el objeto Serial de Arduino:
// ese objeto reserva 157 bytes de RAM que aquí no hacen falta, y la pantalla
// ya ocupa la mitad de la memoria del Uno.

const uint8_t SAMPLE_RATE_HZ = 50;
uint8_t seq = 0;
bool sent = false;  // ya se envió alguna muestra

void uartBegin() {
  UCSR0A = _BV(U2X0);                   // doble velocidad, como hace Arduino a 115200
  UBRR0 = 16;                           // 16 MHz / (8 * 115200) - 1
  UCSR0C = _BV(UCSZ01) | _BV(UCSZ00);   // 8 bits, sin paridad, 1 bit de parada
  UCSR0B = _BV(TXEN0) | _BV(RXEN0);
}

void uartPut(char c) {
  while (!(UCSR0A & _BV(UDRE0))) {}
  UDR0 = c;
}

void uartText(const __FlashStringHelper *text) {
  const char *p = (const char *)text;
  char c;
  while ((c = pgm_read_byte(p++)) != 0) uartPut(c);
}

void uartNumber(uint16_t n) {
  char digits[6];
  uint8_t i = 0;
  do {
    digits[i++] = '0' + n % 10;
    n /= 10;
  } while (n > 0);
  while (i > 0) uartPut(digits[--i]);
}

// Devuelve el carácter recibido, o -1 si no llegó ninguno.
int uartRead() {
  if (UCSR0A & _BV(RXC0)) return UDR0;
  return -1;
}

void printHeader() {
  uartText(F("#cardio-monitor v3 sensor=max30100 fs="));
  uartNumber(SAMPLE_RATE_HZ);
  uartText(F(" bits=16\n"));
}

void sendSample(uint16_t ir, uint16_t red) {
  uartNumber(seq);
  if (ir < FINGER_THRESHOLD) {
    uartText(F(",L\n"));
  } else {
    uartPut(',');
    uartNumber(ir);
    uartPut(',');
    uartNumber(red);
    uartPut('\n');
  }
  seq++;
  sent = true;
}

void resetSignal() {
  dcLevel = 0;
  smooth = 0;
  envelope = 0;
  aboveThr = false;
  beatAvg = 0;
  rateSpot = 0;
  for (uint8_t i = 0; i < RATE_SIZE; i++) rates[i] = 0;
}

void setup() {
  uartBegin();
  Wire.begin();
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    pinMode(LED_BUILTIN, OUTPUT);   // LED 13 parpadea = OLED no encontrada
    while (1) { digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(200); }
  }
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(F("Iniciando sensor..."));
  display.display();

  // Reintenta hasta encontrar el sensor (por si el contacto es flojo)
  uint8_t intentos = 0;
  while (!sensor.begin()) {
    intentos++;
    uartText(F("#cardio-monitor v3 error=sensor\n"));
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("Sensor no"));
    display.println(F("encontrado."));
    display.println(F("Revisa conexiones"));
    display.print(F("Intento: "));
    display.println(intentos);
    display.display();
    delay(500);
  }

  // 50 muestras/seg, 16 bits. IR 27 mA, rojo bajo
  // A 50 Hz el FIFO de 16 muestras aguanta 320 ms mientras se dibuja la pantalla
  sensor.setMode(MAX30100_MODE_SPO2_HR);
  sensor.setSamplingRate(MAX30100_SAMPRATE_50HZ);
  sensor.setLedsCurrent(MAX30100_LED_CURR_27_1MA, MAX30100_LED_CURR_7_6MA);

  // sensor.begin() sube el bus a 400 kHz: lo bajamos de nuevo
  Wire.setClock(100000);
  // Si un módulo se desconecta a mitad de una transferencia, no se congela:
  // tras 5 ms de espera se aborta y el programa sigue
  Wire.setWireTimeout(5000, true);

  for (uint8_t i = 0; i < SCREEN_W; i++) wave[i] = BASE_Y;
  resetSignal();
  printHeader();
}

void registerBeat() {
  unsigned long now = millis();
  unsigned long delta = now - lastBeat;
  lastBeat = now;
  float bpm = 60000.0 / delta;
  if (bpm > 30 && bpm < 220) {
    rates[rateSpot++] = (uint8_t)bpm;
    rateSpot %= RATE_SIZE;
    int sum = 0, n = 0;
    for (uint8_t i = 0; i < RATE_SIZE; i++) {
      if (rates[i]) { sum += rates[i]; n++; }
    }
    beatAvg = n ? sum / n : 0;
  }
  ecgPos = 0;   // dispara un complejo P-QRS-T en la gráfica

  // Pitido y LED al ritmo del corazón (tone() no bloquea el programa)
  tone(BUZZER_PIN, BEEP_HZ, BEEP_MS);
  digitalWrite(LED_PIN, HIGH);
}

// Procesa una muestra real del sensor y detecta latidos
void processSample(uint16_t ir) {
  // Quitar componente continua y suavizar
  if (dcLevel == 0) dcLevel = ir;
  dcLevel = dcLevel * 0.97 + ir * 0.03;
  float ac = ir - dcLevel;
  smooth = smooth * 0.7 + ac * 0.3;

  // La IR baja cuando llega el pulso: invertimos para que el pico suba
  float sig = -smooth;

  // Umbral adaptativo al 60% de la amplitud reciente
  envelope *= 0.99;
  if (sig > envelope) envelope = sig;
  if (!aboveThr && envelope > 5 && sig > envelope * 0.6 &&
      millis() - lastBeat > 300) {
    aboveThr = true;
    registerBeat();
  } else if (aboveThr && sig < envelope * 0.2) {
    aboveThr = false;
  }
}

// Agrega una columna al trazo (modo barrido)
void pushEcgSample() {
  int8_t v = 0;
  if (ecgPos < PQRST_LEN) {
    v = (int8_t)pgm_read_byte(&PQRST[ecgPos]);
    ecgPos++;
  }
  wave[cursorX] = BASE_Y - v;   // pico R = 30 px, de y=24 a y=61
  cursorX = (cursorX + 1) % SCREEN_W;
}

// true si la columna x está dentro del hueco delante del cursor
bool inGap(uint8_t x) {
  uint8_t d = (x + SCREEN_W - cursorX) % SCREEN_W;
  return d < GAP;
}

// Cada 500 ms comprueba que la OLED responda. Si se desconectó y vuelve,
// la reinicia sola (la OLED necesita reiniciarse tras perder el bus).
bool oledOk = true;
unsigned long lastOledCheck = 0;

void checkOled() {
  if (millis() - lastOledCheck < 500) return;
  lastOledCheck = millis();

  Wire.beginTransmission(OLED_ADDR);
  bool present = (Wire.endTransmission() == 0);

  if (present && !oledOk) {
    display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
    Wire.setClock(100000);
  }
  oledOk = present;
  Wire.clearWireTimeoutFlag();
}

void drawHeart(int x, int y) {
  display.fillCircle(x + 3, y + 3, 3, SSD1306_WHITE);
  display.fillCircle(x + 9, y + 3, 3, SSD1306_WHITE);
  display.fillTriangle(x, y + 4, x + 12, y + 4, x + 6, y + 11, SSD1306_WHITE);
}

// BPM arriba y la onda debajo (sin dedo: "--" y línea plana)
void drawScreen() {
  display.clearDisplay();

  // ---- BPM ----
  display.setTextSize(2);
  display.setCursor(0, 0);
  if (lastIR >= FINGER_THRESHOLD && beatAvg > 0) display.print(beatAvg);
  else                                           display.print(F("--"));
  display.setTextSize(1);
  display.setCursor(40, 7);
  display.print(F("BPM"));
  if (millis() - lastBeat < 150) drawHeart(112, 2);   // late con el pulso

  // ---- Trazo con hueco de barrido ----
  for (uint8_t x = 1; x < SCREEN_W; x++) {
    if (inGap(x) || inGap(x - 1)) continue;
    display.drawLine(x - 1, wave[x - 1], x, wave[x], SSD1306_WHITE);
  }
  // Punto brillante en la posición actual
  uint8_t head = (cursorX + SCREEN_W - 1) % SCREEN_W;
  display.fillCircle(head, wave[head], 1, SSD1306_WHITE);

  display.display();
}

void loop() {
  // La app pide la cabecera enviando '?'
  if (uartRead() == '?') printHeader();

  sensor.update();  // lee las muestras nuevas del FIFO del sensor

  static unsigned long lastSample = 0;
  uint16_t ir, red;
  while (sensor.getRawValues(&ir, &red)) {
    lastSample = millis();
    lastIR = ir;
    if (ir >= FINGER_THRESHOLD) processSample(ir);
    else resetSignal();
    pushEcgSample();      // 50 columnas por segundo (~2.5 s de barrido)
    sendSample(ir, red);
  }

  // Si el FIFO del sensor se llenó, la librería deja de leer para siempre:
  // si no llegan muestras en 300 ms, se vacía el FIFO y sigue funcionando.
  // Se avanza el contador de la app para que marque esas muestras como perdidas.
  if (millis() - lastSample > 300) {
    sensor.resetFifo();
    if (sent) seq += (millis() - lastSample) * SAMPLE_RATE_HZ / 1000;
    lastSample = millis();
  }

  if (millis() - lastDraw >= 40) {   // ~25 fps
    lastDraw = millis();
    if (oledOk) drawScreen();
  }

  checkOled();

  // Apaga el LED de latido después de LED_MS
  if (millis() - lastBeat > LED_MS) digitalWrite(LED_PIN, LOW);
}
