/**
 * Estado de la vinculación con WhatsApp, en un solo lugar.
 *
 * La conexión (conexion.js) reporta aquí todo lo que pasa; el panel web y los
 * avisos solo leen. Así el QR se puede pintar en la página en tiempo real sin
 * que nadie tenga que mirar la consola del servidor.
 *
 * Además vigila el reloj: si WhatsApp lleva demasiado tiempo caído (porque el
 * celular se quedó sin internet, se apagó o cerraron la sesión), avisa por donde
 * el bot haya configurado — Telegram, correo, lo que sea — sin que haya que
 * pedírselo.
 *
 * Este archivo no sabe nada de Baileys ni del canal de avisos. Eso es a
 * propósito: el canal se inyecta con configurar({ alertas: { avisar } }).
 */
import { EventEmitter } from 'node:events';
import QRCode from 'qrcode';
import { crearTextos, urlEsPublica } from './textos.js';
import { numeroDe } from './mensaje.js';

/** Cualquiera puede suscribirse a 'cambio' para enterarse al instante. */
export const bus = new EventEmitter();
bus.setMaxListeners(0); // el panel abre un listener por pestaña

const MAX_BITACORA = 25;
const REVISION_MS = 30 * 1000;

/**
 * conexion:
 *   'iniciando'    — el proceso acaba de arrancar
 *   'conectando'   — hay credenciales y está reconectando
 *   'qr'           — esperando que escaneen el código
 *   'conectado'    — todo bien
 *   'desconectado' — se cayó y está reintentando solo
 *   'desvinculado' — lo desvinculó una persona desde el panel; NO reintenta
 */
const estado = {
  conexion: 'iniciando',
  motivo: '',
  qrDataUrl: null,
  qrGeneradoEn: null,
  telefono: null,
  conectadoDesde: null,
  desconectadoDesde: Date.now(),
  vinculado: false,
  bitacora: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuración inyectada por el bot
// ─────────────────────────────────────────────────────────────────────────────

const opciones = {
  panelUrl: '',
  queHace: 'atendiendo clientes',
  qr: { color: '#12100e', width: 560 },
  alertas: {
    offlineMin: 10,
    qrMin: 2,
    repetirMin: 60,
    qrMaxAvisos: 3,
    avisar: null, // async ({ tipo, texto, … }) => boolean
  },
};

let textos = crearTextos(opciones);

export function configurar(nuevas = {}) {
  if (nuevas.panelUrl !== undefined) opciones.panelUrl = nuevas.panelUrl;
  if (nuevas.queHace !== undefined) opciones.queHace = nuevas.queHace;
  if (nuevas.qr) Object.assign(opciones.qr, nuevas.qr);
  if (nuevas.alertas) Object.assign(opciones.alertas, nuevas.alertas);
  textos = crearTextos(opciones);
  return opciones;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

export const snapshot = () => ({
  conexion: estado.conexion,
  motivo: estado.motivo,
  qr: estado.qrDataUrl,
  qrGeneradoEn: estado.qrGeneradoEn,
  telefono: estado.telefono,
  conectadoDesde: estado.conectadoDesde,
  desconectadoDesde: estado.desconectadoDesde,
  vinculado: estado.vinculado,
  bitacora: estado.bitacora,
  // Para que el panel sepa cuándo va a saltar cada alerta
  alertaMin: opciones.alertas.offlineMin,
  alertaQrMin: opciones.alertas.qrMin,
  ahora: Date.now(),
});

export const conectado = () => estado.conexion === 'conectado';
export const qrActual = () => estado.qrDataUrl;

/** Minutos que lleva caído, o 0 si está conectado. */
export const minutosCaido = () =>
  estado.desconectadoDesde ? (Date.now() - estado.desconectadoDesde) / 60000 : 0;

/** ¿Hay sesión guardada? Si no, ningún reintento sirve: toca escanear. */
export const hayQueEscanear = () =>
  !estado.vinculado && estado.conexion !== 'conectado' && estado.conexion !== 'desvinculado';

/**
 * Espera a que Baileys emita un código *nuevo* (no devuelve el que ya estaba).
 * Es lo que permite mandar un QR recién horneado cuando alguien lo pide, en vez
 * de reenviar uno que venció hace rato.
 */
export function esperarQRNuevo(ms = 20000) {
  const desde = Date.now();
  return new Promise((resolve) => {
    const listo = (s) => {
      if (!s.qr || s.qrGeneradoEn < desde) return;
      clearTimeout(reloj);
      bus.off('cambio', listo);
      resolve(s.qr);
    };
    // Sin unref(): alguien está esperando esta promesa, el timeout tiene que
    // llegar sí o sí aunque no haya nada más pendiente.
    const reloj = setTimeout(() => {
      bus.off('cambio', listo);
      resolve(null);
    }, ms);
    bus.on('cambio', listo);
  });
}

/** El QR como PNG, listo para mandar por Telegram o adjuntar a un correo. */
export function qrPng() {
  if (!estado.qrDataUrl) return null;
  try {
    return Buffer.from(estado.qrDataUrl.split(',')[1], 'base64');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escritura (la usa conexion.js)
// ─────────────────────────────────────────────────────────────────────────────

function apuntar(icono, texto) {
  estado.bitacora.unshift({ icono, texto, en: Date.now() });
  if (estado.bitacora.length > MAX_BITACORA) estado.bitacora.length = MAX_BITACORA;
}

const emitir = () => bus.emit('cambio', snapshot());

/** Empieza a contar el tiempo caído solo si no venía contando ya. */
function empezarACaer() {
  if (!estado.desconectadoDesde) estado.desconectadoDesde = Date.now();
}

export function marcarVinculado(hayCredenciales) {
  estado.vinculado = Boolean(hayCredenciales);
}

export function marcarConectando() {
  if (estado.conexion === 'conectado') return;
  estado.conexion = 'conectando';
  estado.motivo = '';
  empezarACaer();
  emitir();
}

/** Llega un QR nuevo de Baileys (se renueva solo cada ~20 s). */
export async function marcarQR(raw) {
  try {
    estado.qrDataUrl = await QRCode.toDataURL(raw, {
      margin: 1,
      width: opciones.qr.width,
      errorCorrectionLevel: 'M',
      color: { dark: opciones.qr.color, light: '#ffffff' },
    });
  } catch (err) {
    console.error('No se pudo generar la imagen del QR:', err?.message || err);
    estado.qrDataUrl = null;
  }

  const primero = estado.conexion !== 'qr';
  estado.qrGeneradoEn = Date.now();
  estado.conexion = 'qr';
  estado.motivo = 'Esperando que escanees el código';
  estado.telefono = null;
  empezarACaer();
  if (primero) apuntar('📷', 'Código QR listo para escanear');
  emitir();
}

export function marcarConectado(usuario) {
  const veniaCaido = estado.conexion !== 'conectado';
  // Si veníamos de 'qr', alguien acaba de escanear y está esperando saber si
  // funcionó. Hay que leerlo antes de sobrescribir el estado.
  const acabanDeEscanear = estado.conexion === 'qr';
  estado.conexion = 'conectado';
  estado.motivo = '';
  estado.qrDataUrl = null;
  estado.qrGeneradoEn = null;
  estado.telefono = numeroDe(usuario?.id || '');
  estado.conectadoDesde = Date.now();
  estado.desconectadoDesde = null;
  estado.vinculado = true;
  if (acabanDeEscanear) {
    apuntar('🔗', `Vinculado${estado.telefono ? ` con +${estado.telefono}` : ''}`);
  } else if (veniaCaido) {
    apuntar('✅', `Conectado${estado.telefono ? ` como +${estado.telefono}` : ''}`);
  }
  emitir();
  avisarReconexion({ acabanDeEscanear });
}

export function marcarDesconectado({ motivo = '', reintentando = true } = {}) {
  estado.conexion = 'desconectado';
  estado.motivo = motivo;
  estado.qrDataUrl = null;
  empezarACaer();
  apuntar('⚠️', motivo || 'Conexión perdida');
  emitir();
  if (!reintentando) alertarAhora('caida');
}

/** La desvinculó una persona a propósito: no hay nada que reparar. */
export function marcarDesvinculado(motivo = 'Sesión desvinculada desde el panel') {
  estado.conexion = 'desvinculado';
  estado.motivo = motivo;
  estado.qrDataUrl = null;
  estado.qrGeneradoEn = null;
  estado.telefono = null;
  estado.conectadoDesde = null;
  estado.desconectadoDesde = Date.now();
  estado.vinculado = false;
  // No queremos que empiece a insistir por algo que se hizo a propósito
  alertaEnviada = false;
  tipoAlerta = null;
  avisosQR = 0;
  apuntar('🔌', motivo);
  emitir();
}

/** WhatsApp cerró la sesión desde el celular: requiere escanear de nuevo. */
export function marcarSesionCerrada() {
  // Ojo: hay que bajar 'conexion' aquí mismo. Si se deja en 'conectado' hasta
  // que arranque el socket nuevo, el panel miente unos segundos y el vigilante
  // cree que todo está bien justo cuando más falta hace avisar.
  estado.conexion = 'desconectado';
  estado.motivo = 'Cerraron la sesión desde el celular';
  estado.qrDataUrl = null;
  estado.vinculado = false;
  estado.telefono = null;
  estado.conectadoDesde = null;
  empezarACaer();
  apuntar('🚪', 'Cerraron la sesión desde el celular');
  emitir();
  alertarAhora('cerrada');
}

// ─────────────────────────────────────────────────────────────────────────────
// Avisos de caída
// ─────────────────────────────────────────────────────────────────────────────

let alertaEnviada = false;
let tipoAlerta = null; // 'qr' | 'caida' — para reavisar si cambia el problema
let ultimaAlerta = 0;
let avisosQR = 0; // recordatorios de vinculación ya mandados
let vigilante = null;

/**
 * ¿El problema se arregla solo o hay que ir a escanear un QR?
 *
 * Esta es la diferencia que importa: si la sesión sigue vinculada, el bot
 * reconecta en cuanto el celular vuelva a tener internet y no hay nada que
 * hacer. Si ya no hay sesión, puede pasar la noche entera caído — alguien tiene
 * que escanear el código.
 */
const necesitaEscaneo = hayQueEscanear;

/** Le pasa el aviso al canal que configuró el bot. Nunca lanza. */
async function avisar(tipo, texto, extra = {}) {
  const { avisar: canal } = opciones.alertas;
  if (typeof canal !== 'function') return false;
  try {
    return await canal({
      tipo,
      texto,
      minutos: minutosCaido(),
      telefono: estado.telefono,
      motivo: estado.motivo,
      panelUrl: opciones.panelUrl,
      urlPublica: urlEsPublica(opciones.panelUrl),
      pedirQR: false,
      qrPng: null,
      pieQR: null,
      ultimo: false,
      ...extra,
    });
  } catch (err) {
    console.error('No se pudo mandar el aviso de WhatsApp:', err?.message || err);
    return false;
  }
}

/**
 * Aviso de "falta escanear". Manda el código por si la persona está mirando el
 * teléfono en ese momento, pero lo importante es que pueda pedir uno nuevo: el
 * QR se pide cuando puedan atenderlo, no se les empuja una foto vencida cada
 * rato.
 */
async function avisarQR(motivo = '') {
  const png = qrPng();
  return avisar('escanear', textos.escanear({ motivo }), {
    qrPng: png,
    pieQR: png ? textos.pieQR() : null,
    pedirQR: true,
    motivo,
  });
}

/** Alerta inmediata, sin esperar el umbral. */
async function alertarAhora(tipo) {
  if (alertaEnviada && Date.now() - ultimaAlerta < 60 * 1000) return;
  alertaEnviada = true;
  tipoAlerta = tipo === 'cerrada' ? 'qr' : 'caida';
  if (tipoAlerta === 'qr') avisosQR = 1;
  ultimaAlerta = Date.now();

  if (tipo === 'cerrada') {
    // Tras el logout el QR nuevo tarda unos segundos: vale la pena esperarlo
    // para poder mandarlo en el mismo aviso.
    await new Promise((r) => setTimeout(r, 8000));
    await avisarQR('Cerraron la sesión del bot desde el celular.');
    return;
  }
  await avisar('caida', textos.caida({ minutos: minutosCaido(), motivo: estado.motivo }));
}

/**
 * Avisa que WhatsApp volvió.
 *
 * Un escaneo siempre se confirma, aunque nunca se haya mandado una alerta: hay
 * una persona que acaba de apuntar el celular al código y lo único que quiere
 * saber es si funcionó. Una reconexión sola, en cambio, solo se anuncia si antes
 * se avisó de la caída — si nadie se enteró del problema, no hay nada que
 * celebrar.
 */
async function avisarReconexion({ acabanDeEscanear = false } = {}) {
  if (!alertaEnviada && !acabanDeEscanear) return;

  const esVinculacion = acabanDeEscanear || tipoAlerta === 'qr';
  alertaEnviada = false;
  tipoAlerta = null;
  ultimaAlerta = 0;
  avisosQR = 0;

  const datos = { telefono: estado.telefono };
  return esVinculacion
    ? avisar('vinculado', textos.vinculado(datos))
    : avisar('reconectado', textos.reconectado(datos));
}

/** Aviso de desvinculación manual. Lo dispara el panel, no el vigilante. */
export function avisarDesvinculado() {
  return avisar('desvinculado', textos.desvinculado());
}

async function revisar() {
  // Conectado o desvinculado a propósito: no hay nada que reportar
  if (estado.conexion === 'conectado' || estado.conexion === 'desvinculado') return;

  // Dos problemas distintos, dos paciencias distintas:
  //   • sin sesión → hay que escanear un QR, avisar casi de inmediato
  //   • sesión viva pero sin red → se arregla solo, dar margen antes de molestar
  const faltaQR = necesitaEscaneo();
  const umbral = faltaQR ? opciones.alertas.qrMin : opciones.alertas.offlineMin;
  if (!umbral) return; // 0 = ese aviso está apagado

  const min = minutosCaido();
  if (min < umbral) return;

  const ahora = Date.now();
  const mandar = () =>
    faltaQR ? avisarQR() : avisar('caida', textos.caida({ minutos: min, motivo: estado.motivo }));

  if (!alertaEnviada) {
    alertaEnviada = true;
    tipoAlerta = faltaQR ? 'qr' : 'caida';
    if (faltaQR) avisosQR = 1;
    ultimaAlerta = ahora;
    console.warn(
      faltaQR
        ? `📷 WhatsApp sin sesión desde hace ${Math.round(min)} min — pidiendo escaneo`
        : `🔴 WhatsApp lleva ${Math.round(min)} min caído — avisando`
    );
    await mandar();
    return;
  }

  // Empezó como una caída normal y resultó que perdió la sesión: eso cambia lo
  // que tiene que hacer la persona, así que se avisa de nuevo sin esperar.
  if (faltaQR && tipoAlerta !== 'qr') {
    tipoAlerta = 'qr';
    avisosQR = 1;
    ultimaAlerta = ahora;
    console.warn('📷 La caída resultó ser pérdida de sesión — pidiendo escaneo');
    await avisarQR('La conexión no se recuperó: la sesión ya no está vinculada.');
    return;
  }

  // Recordatorio cada tanto para que no se olvide el asunto
  const cada = opciones.alertas.repetirMin;
  if (cada <= 0 || ahora - ultimaAlerta < cada * 60000) return;

  if (!faltaQR) {
    // Sigue caído: reconecta solo, así que basta con recordarlo
    ultimaAlerta = ahora;
    await avisar('caida', textos.caida({ minutos: min, motivo: estado.motivo }));
    return;
  }

  // Falta vincular. Aquí sí hay que tener tacto: se recuerda un par de veces y
  // después se guarda silencio. Nadie quiere que le llegue un QR vencido cada
  // hora para siempre; cuando puedan, piden uno.
  const tope = opciones.alertas.qrMaxAvisos;
  if (tope > 0 && avisosQR >= tope) return;

  avisosQR += 1;
  ultimaAlerta = ahora;
  const esElUltimo = tope > 0 && avisosQR >= tope;
  console.warn(`⏰ Recordatorio ${avisosQR}/${tope} de vinculación pendiente`);
  await avisar('recordatorio', textos.recordatorio({ minutos: min, ultimo: esElUltimo }), {
    pedirQR: true,
    ultimo: esElUltimo,
  });
}

/**
 * Corre la revisión de inmediato en vez de esperar el turno del vigilante.
 * Útil para un comando tipo /estado, y es por donde entran las pruebas.
 */
export const revisarAhora = () => revisar();

export function iniciarVigilancia() {
  if (vigilante) return;
  vigilante = setInterval(() => {
    revisar().catch((err) =>
      console.error('Error en la vigilancia de WhatsApp:', err?.message || err)
    );
  }, REVISION_MS);
  vigilante.unref?.();
  console.log(
    `👁️  Vigilancia de WhatsApp activa — aviso tras ${opciones.alertas.qrMin} min sin sesión ` +
      `o ${opciones.alertas.offlineMin} min sin conexión`
  );
}

export function detenerVigilancia() {
  if (vigilante) clearInterval(vigilante);
  vigilante = null;
}

export default {
  bus,
  configurar,
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
};
