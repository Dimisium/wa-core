# wa-core

La capa de WhatsApp que comparten todos los bots: conexión con Baileys, reconexión con backoff, QR en vivo, estado para el panel y avisos cuando se cae.

**La regla que hace que esto valga la pena:**

> Ningún bot importa `@whiskeysockets/baileys`. Solo lo hace `src/conexion.js`.

Baileys se actualiza y rompe cosas cada tanto. Si cada bot habla con la librería por su cuenta, un cambio de la librería son ocho arreglos. Con esta regla es uno.

---

## Cómo arreglar un cambio de Baileys

Esta es la parte importante del repo. Pasos:

```bash
cd wa-core
npm install @whiskeysockets/baileys@latest
npm test                 # la lógica de reconexión y avisos, sin vincular nada
```

Lo que se rompe siempre está en **`src/conexion.js`** (y a veces en `src/mensaje.js`, si movieron de lugar los campos de los mensajes entrantes). El encabezado de `conexion.js` lista toda la superficie de Baileys que usamos — es la lista de lo que hay que revisar en cada actualización.

Cuando pase:

```bash
npm test                 # que sigan pasando los 16
git commit -am "fix: Baileys 8.x movió tal cosa"
git push
```

Y en cada bot: **redeploy**. Nada más — apuntan a `#main`, así que el `npm install` del deploy se trae el arreglo.

Prueba de verdad antes de hacer push: vincula desde cero en un bot (`npm start`, panel, escanear QR). `npm test` cubre la lógica, pero el handshake con WhatsApp solo se prueba conectándose.

### Si un bot necesita algo que Baileys sí tiene pero wa-core no expone

No lo importes en el bot. Agrégalo aquí y expórtalo. Es un minuto de trabajo y mantiene la regla.

---

## Uso

```bash
npm install github:Dimisium/wa-core#main
```

Lo mínimo:

```js
import { crearBotWA } from 'wa-core';

const wa = crearBotWA({
  authDir: './auth_data',
  onMensaje: ({ jid, texto }) => manejarMensaje(jid, texto),
});

await wa.iniciar();
await wa.enviarTexto(jid, 'Hola');
```

Con avisos de caída. wa-core no sabe de Telegram ni de correo: arma el texto y tú lo mandas por donde quieras.

```js
const wa = crearBotWA({
  authDir: './auth_data',
  panelUrl: config.publicUrl,
  onMensaje: ({ jid, texto }) => manejarMensaje(jid, texto),
  onLimpieza: limpiarSesiones,          // tarea periódica del bot, cada 5 min
  alertas: {
    offlineMin: 10,    // sesión viva pero sin red: se arregla solo, dar margen
    qrMin: 2,          // sin sesión: esto NO se arregla solo, avisar ya
    repetirMin: 60,
    qrMaxAvisos: 3,    // después se calla, para no mandar QR vencidos para siempre
    async avisar({ tipo, texto, qrPng, pieQR, pedirQR, urlPublica }) {
      if (qrPng) return notificarFoto(qrPng, pieQR, botonesQR());
      return notificar(texto, pedirQR ? botonesQR() : botonPanel());
    },
  },
});

await wa.iniciar();
wa.vigilar();
```

### El objeto `aviso`

| campo | qué es |
|---|---|
| `tipo` | `caida` · `escanear` · `recordatorio` · `reconectado` · `vinculado` · `desvinculado` |
| `texto` | listo para mandar, con `<b>`/`<i>` (los entienden Telegram HTML y un correo HTML) |
| `qrPng` | `Buffer` del QR, o `null`. Solo viene en `escanear` y solo si había código listo |
| `pieQR` | el texto que acompaña a la foto, cuando hay `qrPng` |
| `pedirQR` | conviene ofrecer un botón de "mándame otro QR" |
| `minutos` | cuánto lleva caído |
| `ultimo` | en `recordatorio`: es el último, después se calla |
| `telefono`, `motivo` | por si quieres armar tu propio texto |
| `panelUrl`, `urlPublica` | `urlPublica` es false con `http://localhost`, donde Telegram rechaza botones |

Si no te gustan los textos, ignora `texto` y arma el tuyo con los demás campos. `sinHtml(texto)` los deja en texto plano.

### Diferencias entre bots que ya están resueltas por opciones

- **Canal de avisos** → `alertas.avisar` (ws_calendar usa Telegram, ws_esp32 usa correo)
- **Cómo se describe el bot** → `queHace: 'mandando alertas'` en vez de `'atendiendo clientes'`
- **Bot que no conversa** → `onMensaje` que filtra lo que sí atiende, o no pasar `onMensaje`
- **Color del QR** → `qr: { color: '#0f172a', width: 560 }`

---

## API

`crearBotWA()` devuelve:

| | |
|---|---|
| `iniciar()` | conecta o reconecta; devuelve el socket de Baileys |
| `vigilar()` | arranca el vigilante que avisa si se queda caído |
| `enviarTexto(jid, texto)` | `false` si está caído, nunca lanza |
| `enviar(jid, contenido)` | cualquier contenido de Baileys (`{ image }`, `{ audio }`…) |
| `enviarSecuencia(jid, textos, pausaMs)` | varios mensajes en orden |
| `enviarATodos(jids, texto)` | `{ enviados, fallidos }` |
| `escribiendo(jid, ms)` | el "escribiendo…" |
| `listo()` | ¿hay socket? |
| `vincular()` · `desvincular()` · `reconectar()` | lo que usa el panel |
| `snapshot()` · `bus` | estado y eventos `'cambio'` (para el SSE del panel) |
| `estado` | el módulo completo: `qrPng()`, `esperarQRNuevo()`, `minutosCaido()`, `revisarAhora()`… |

Los módulos del bot que solo quieren mandar un mensaje (webhooks, recordatorios) no necesitan el manubrio:

```js
import { enviarTexto } from 'wa-core';
```

Es un singleton a propósito: un proceso = una sesión de WhatsApp.

---

## Los estados de la conexión

| | |
|---|---|
| `iniciando` | el proceso acaba de arrancar |
| `conectando` | hay credenciales y está reconectando |
| `qr` | esperando que escaneen |
| `conectado` | todo bien |
| `desconectado` | se cayó y está reintentando solo |
| `desvinculado` | lo desvinculó una persona desde el panel; **no** reintenta |

La distinción que importa para los avisos es otra: **¿la sesión sigue vinculada?** Si sí, el bot reconecta solo cuando el celular vuelva a tener internet y no hay nada que hacer. Si no, puede pasar la noche caído — alguien tiene que ir a escanear. Por eso son dos umbrales (`offlineMin` y `qrMin`) y no uno.

## Cosas que ya están resueltas y conviene no deshacer

- `Browsers.ubuntu('Chrome')` — con el fingerprint de macOS, WhatsApp cierra con **428** antes de emitir el QR y nunca puedes vincular un dispositivo nuevo.
- Al cerrar sesión desde el celular, wa-core borra `auth_data` y saca un QR nuevo solo. Si no, el bot se queda muerto hasta que alguien entre al servidor a borrar la carpeta a mano.
- `marcarSesionCerrada()` baja el estado a `desconectado` de inmediato, no cuando arranca el socket nuevo: si no, el panel miente unos segundos justo cuando más falta hace avisar.
- Cada reconexión suelta el socket viejo con `removeAllListeners()`. Sin eso se encadenan reconexiones fantasma que se multiplican.
- Los recordatorios de "falta escanear" tienen tope. Mandar un QR vencido cada hora para siempre hace que la persona deje de leer los avisos.
