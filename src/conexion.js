/**
 * Conexión a WhatsApp con Baileys.
 *
 * ⚠️  ESTE ES EL ÚNICO ARCHIVO DE TODO wa-core QUE IMPORTA BAILEYS.
 *     Si Baileys cambia y algo se rompe, se arregla aquí. Ningún bot debe
 *     importar '@whiskeysockets/baileys' por su cuenta: en el momento en que
 *     uno lo haga, vuelve el problema de arreglar el mismo bug ocho veces.
 *
 * Superficie de Baileys que usamos (lo que hay que revisar en cada actualización):
 *   makeWASocket({ auth, version, browser, markOnlineOnConnect })
 *   useMultiFileAuthState(carpeta)  → { state, saveCreds }
 *   fetchLatestBaileysVersion()     → { version, isLatest }
 *   Browsers.ubuntu(nombre)
 *   DisconnectReason.loggedOut
 *   sock.ev.on('creds.update' | 'connection.update' | 'messages.upsert')
 *   sock.ev.removeAllListeners() · sock.end() · sock.logout() · sock.user
 *   sock.sendMessage() · sock.readMessages() · sock.sendPresenceUpdate()  → envio.js
 *   (la forma de los mensajes entrantes vive en mensaje.js)
 *
 * Estrategia de reconexión: backoff exponencial y descarte de sockets viejos
 * para no encadenar reconexiones fantasma.
 *
 * Todo lo que pasa aquí se reporta a estado.js, que es lo que lee el panel web
 * para pintar el QR en vivo y lo que dispara los avisos de caída.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { setSock, getSock, marcarLeido as leer } from './envio.js';
import { extraerTexto, esGrupo, esBroadcast } from './mensaje.js';
import * as estado from './estado.js';

let reconnectAttempts = 0;
let reconnectTimer = null;
// Mientras esté en true nadie reconecta solo: la sesión se desvinculó a mano
let desvinculado = false;

const opciones = {
  authDir: path.resolve('./auth_data'),
  /** async ({ jid, texto, msg, sock }) => void */
  onMensaje: null,
  /** Ignorar grupos y estados. Casi siempre lo que quieres. */
  soloPrivados: true,
  /** Marcar como leído lo que se atiende: mejor sensación que dejarlo en azul. */
  marcarLeido: true,
  /** Pintar el QR en la consola además del panel. */
  qrEnConsola: true,
  /**
   * WhatsApp rechaza el registro de dispositivos nuevos con el fingerprint de
   * macOS (cierra con 428 antes de emitir el QR). Ubuntu/Chrome sí pasa.
   * No lo cambies sin probar una vinculación desde cero.
   */
  navegador: () => Browsers.ubuntu('Chrome'),
};

export function configurarConexion(nuevas = {}) {
  if (nuevas.authDir) opciones.authDir = path.resolve(nuevas.authDir);
  for (const k of ['onMensaje', 'soloPrivados', 'marcarLeido', 'qrEnConsola', 'navegador']) {
    if (nuevas[k] !== undefined) opciones[k] = nuevas[k];
  }
  return opciones;
}

export const carpetaAuth = () => opciones.authDir;

/** ¿Hay una sesión guardada en disco? Sirve para saber si toca QR o no. */
export async function hayCredenciales() {
  try {
    const raw = await fs.readFile(path.join(opciones.authDir, 'creds.json'), 'utf8');
    return Boolean(JSON.parse(raw)?.registered);
  } catch {
    return false;
  }
}

function programarReconexion({ rapido = false } = {}) {
  if (reconnectTimer || desvinculado) return;
  // Si todavía no hay sesión, alguien está viendo el QR: reintentar ya para que
  // le aparezca uno nuevo en vez de dejarlo mirando un código vencido.
  const espera = rapido ? 3000 : Math.min(5000 * 2 ** reconnectAttempts, 60000);
  reconnectAttempts++;
  console.log(`↻ Reintentando conexión en ${espera / 1000}s (intento ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startWhatsApp().catch((err) => console.error('Error reconectando:', err));
  }, espera);
}

function cancelarReconexion() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

/** Cierra el socket vivo sin que dispare reconexiones. */
function soltarSocket() {
  const anterior = getSock();
  if (!anterior) return;
  try {
    anterior.ev.removeAllListeners();
    anterior.end(undefined);
  } catch {
    /* ya estaba muerto */
  }
  setSock(null);
}

export async function startWhatsApp() {
  cancelarReconexion();
  // Cierra el socket anterior para que no siga disparando reconexiones
  soltarSocket();

  estado.marcarVinculado(await hayCredenciales());
  estado.marcarConectando();

  const { state, saveCreds } = await useMultiFileAuthState(opciones.authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(
    '📱 WhatsApp Web version',
    version.join('.'),
    isLatest ? '(última)' : '(desactualizada)'
  );

  const sock = makeWASocket({
    auth: state,
    version,
    browser: opciones.navegador(),
    markOnlineOnConnect: false,
  });

  setSock(sock);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (opciones.qrEnConsola) {
        console.log(
          '\n📷 Escanea este QR: WhatsApp > Ajustes > Dispositivos vinculados > Vincular dispositivo\n'
        );
        qrcode.generate(qr, { small: true });
      }
      // El panel web lo pinta en vivo; la consola es solo respaldo
      estado.marcarQR(qr).catch(() => {});
    }

    if (connection === 'open') {
      reconnectAttempts = 0;
      console.log('✅ Conectado a WhatsApp');
      estado.marcarConectado(sock.user);
    }

    if (connection === 'close') {
      if (sock !== getSock()) return; // socket viejo, ignorar
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const cerroSesion = codigo === DisconnectReason.loggedOut;
      const reconectar = !cerroSesion && !desvinculado;
      console.log(
        '❌ Conexión cerrada. status =',
        codigo,
        '· reconectar:',
        reconectar ? 'sí' : 'no'
      );

      // El cierre lo provocó desvincularWhatsApp(): ya se encarga él de avisar y
      // de dejar el estado limpio. Aquí no hay nada que alertar ni reintentar.
      if (desvinculado) return;

      if (cerroSesion) {
        // Cerraron la sesión desde el celular. En vez de dejar el bot muerto
        // esperando que alguien borre auth_data a mano, limpiamos y sacamos un QR
        // nuevo: el panel queda listo para volver a vincular en 10 segundos.
        console.log('   Sesión cerrada desde el teléfono — generando un QR nuevo.');
        estado.marcarSesionCerrada();
        soltarSocket();
        borrarCredenciales()
          .then(() => programarReconexion({ rapido: true }))
          .catch((err) =>
            console.error('No se pudo limpiar la sesión:', err?.message || err)
          );
        return;
      }

      estado.marcarDesconectado({
        motivo: `Conexión cerrada (código ${codigo ?? '—'})`,
        reintentando: reconectar,
      });

      if (reconectar) programarReconexion({ rapido: !estado.snapshot().vinculado });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    if (typeof opciones.onMensaje !== 'function') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid || '';
        if (opciones.soloPrivados && (esGrupo(jid) || esBroadcast(jid))) continue;

        const texto = extraerTexto(msg);
        if (!texto) continue;

        if (opciones.marcarLeido) leer([msg.key]);

        await opciones.onMensaje({ jid, texto, msg, sock });
      } catch (err) {
        console.error('Error procesando mensaje entrante:', err);
      }
    }
  });

  return sock;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vincular / desvincular desde el panel
// ─────────────────────────────────────────────────────────────────────────────

async function borrarCredenciales() {
  await fs.rm(opciones.authDir, { recursive: true, force: true });
  estado.marcarVinculado(false);
}

/**
 * Cierra la sesión y borra las credenciales. El dispositivo desaparece de
 * "Dispositivos vinculados" en el celular y el bot deja de reconectar hasta que
 * alguien pulse Vincular.
 */
export async function desvincularWhatsApp() {
  desvinculado = true;
  cancelarReconexion();
  reconnectAttempts = 0;

  const sock = getSock();
  if (sock) {
    try {
      // logout() avisa a WhatsApp para que borre el dispositivo del celular
      await Promise.race([
        sock.logout(),
        new Promise((r) => setTimeout(r, 8000)), // si no responde, seguimos igual
      ]);
    } catch {
      /* si ya estaba caído, alcanza con borrar las credenciales locales */
    }
  }

  soltarSocket();
  // Baileys escribe creds de forma asíncrona: un respiro antes de borrar
  await new Promise((r) => setTimeout(r, 500));
  await borrarCredenciales();

  estado.marcarDesvinculado();
  console.log('🔌 WhatsApp desvinculado desde el panel');
  return { ok: true };
}

/**
 * Arranca la vinculación: si quedaban credenciales viejas las tira, para que
 * WhatsApp emita un QR nuevo en vez de intentar revivir una sesión muerta.
 */
export async function vincularWhatsApp({ desdeCero = true } = {}) {
  desvinculado = false;
  cancelarReconexion();
  reconnectAttempts = 0;

  if (desdeCero) {
    soltarSocket();
    await new Promise((r) => setTimeout(r, 300));
    await borrarCredenciales();
  }

  await startWhatsApp();
  return { ok: true };
}

/** Reintenta la conexión con la sesión actual, sin tocar el QR. */
export async function reconectarWhatsApp() {
  desvinculado = false;
  cancelarReconexion();
  reconnectAttempts = 0;
  await startWhatsApp();
  return { ok: true };
}

export default startWhatsApp;
