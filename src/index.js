/**
 * wa-core — la capa de WhatsApp que comparten todos los bots.
 *
 * La idea es simple: Baileys se rompe cada tanto, y cuando eso pasa quieres
 * arreglarlo UNA vez. Todo lo que toca la librería vive aquí adentro
 * (conexion.js y mensaje.js); cada bot solo trae su lógica de negocio.
 *
 * Uso mínimo:
 *
 *   import { crearBotWA } from 'wa-core';
 *
 *   const wa = crearBotWA({
 *     authDir: './auth_data',
 *     onMensaje: ({ jid, texto }) => manejarMensaje(jid, texto),
 *   });
 *
 *   await wa.iniciar();
 *   await wa.enviarTexto(jid, 'Hola');
 *
 * Con avisos de caída (Telegram, correo, lo que sea — tú pones el canal):
 *
 *   const wa = crearBotWA({
 *     authDir: './auth_data',
 *     panelUrl: config.publicUrl,
 *     onMensaje: ({ jid, texto }) => manejarMensaje(jid, texto),
 *     alertas: {
 *       offlineMin: 10, qrMin: 2, repetirMin: 60, qrMaxAvisos: 3,
 *       async avisar({ tipo, texto, qrPng, pieQR, pedirQR }) {
 *         if (qrPng) return notificarFoto(qrPng, pieQR, botonesQR());
 *         return notificar(texto, pedirQR ? botonesQR() : botonPanel());
 *       },
 *     },
 *   });
 *   wa.vigilar();
 */
import * as conexion from './conexion.js';
import * as estado from './estado.js';
import * as envio from './envio.js';

/**
 * Configura la capa de WhatsApp y devuelve el manubrio.
 *
 * Es un singleton a propósito: un proceso = una sesión de WhatsApp. Llamarlo dos
 * veces reconfigura la misma conexión, no abre otra.
 *
 * @param {object} o
 * @param {string} [o.authDir='./auth_data']   Carpeta de credenciales.
 * @param {function} [o.onMensaje]             async ({ jid, texto, msg, sock }) => void
 * @param {boolean} [o.soloPrivados=true]      Ignorar grupos y estados.
 * @param {boolean} [o.marcarLeido=true]       Marcar como leído lo que se atiende.
 * @param {boolean} [o.qrEnConsola=true]       Pintar también el QR en la consola.
 * @param {string}  [o.panelUrl='']            URL pública del panel (para los avisos).
 * @param {string}  [o.queHace='atendiendo clientes']  Cómo se describe el bot en los avisos.
 * @param {object}  [o.qr]                     { color, width } del PNG del QR.
 * @param {object}  [o.alertas]                Umbrales + el canal: { offlineMin, qrMin, repetirMin, qrMaxAvisos, avisar }.
 * @param {function} [o.onLimpieza]            Tarea periódica del bot (limpiar sesiones en memoria, etc).
 * @param {number}  [o.limpiezaMin=5]          Cada cuántos minutos correrla.
 */
export function crearBotWA(o = {}) {
  estado.configurar({
    panelUrl: o.panelUrl,
    queHace: o.queHace,
    qr: o.qr,
    alertas: o.alertas,
  });

  conexion.configurarConexion({
    authDir: o.authDir,
    onMensaje: o.onMensaje,
    soloPrivados: o.soloPrivados,
    marcarLeido: o.marcarLeido,
    qrEnConsola: o.qrEnConsola,
    navegador: o.navegador,
  });

  let limpieza = null;
  const limpiar = () => {
    if (limpieza || typeof o.onLimpieza !== 'function') return;
    limpieza = setInterval(
      () => {
        try {
          o.onLimpieza();
        } catch (err) {
          console.error('Error en la limpieza periódica:', err?.message || err);
        }
      },
      Math.max(1, o.limpiezaMin ?? 5) * 60 * 1000
    );
    limpieza.unref?.();
  };

  return {
    /** Conecta (o reconecta). Devuelve el socket de Baileys. */
    async iniciar() {
      limpiar();
      return conexion.startWhatsApp();
    },
    /** Arranca el vigilante que avisa si se queda caído. */
    vigilar: estado.iniciarVigilancia,

    // Envío
    enviar: envio.enviar,
    enviarTexto: envio.enviarTexto,
    enviarSecuencia: envio.enviarSecuencia,
    enviarATodos: envio.enviarATodos,
    escribiendo: envio.escribiendo,
    listo: envio.waListo,
    sock: envio.getSock,

    // Vinculación (lo que usa el panel)
    vincular: conexion.vincularWhatsApp,
    desvincular: conexion.desvincularWhatsApp,
    reconectar: conexion.reconectarWhatsApp,
    hayCredenciales: conexion.hayCredenciales,

    // Estado
    estado,
    snapshot: estado.snapshot,
    bus: estado.bus,
  };
}

// Exports directos: para los módulos del bot que solo quieren mandar un mensaje
// y no tienen por qué recibir el manubrio (services, webhooks, recordatorios).
export {
  enviar,
  enviarTexto,
  enviarSecuencia,
  enviarATodos,
  escribiendo,
  marcarLeido,
  waListo,
  getSock,
} from './envio.js';

export {
  startWhatsApp,
  vincularWhatsApp,
  desvincularWhatsApp,
  reconectarWhatsApp,
  hayCredenciales,
  carpetaAuth,
} from './conexion.js';

export {
  bus,
  snapshot,
  conectado,
  qrActual,
  qrPng,
  minutosCaido,
  hayQueEscanear,
  esperarQRNuevo,
  revisarAhora,
  iniciarVigilancia,
  detenerVigilancia,
  avisarDesvinculado,
} from './estado.js';

export { extraerTexto, esGrupo, esBroadcast, numeroDe } from './mensaje.js';
export { crearTextos, sinHtml, urlEsPublica } from './textos.js';

export { estado };
export default crearBotWA;
