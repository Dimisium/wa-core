/**
 * Guarda la referencia al socket de Baileys para que cualquier módulo del bot
 * (un webhook de pagos, los recordatorios, los comandos de Telegram) pueda
 * escribirle al cliente sin importar el bot completo y provocar dependencias
 * circulares.
 *
 * Ninguna de estas funciones lanza: si WhatsApp está caído devuelven false. Un
 * recordatorio que no se pudo mandar no debe tumbar el proceso.
 */
let sockInstance = null;

export const setSock = (sock) => {
  sockInstance = sock;
};
export const getSock = () => sockInstance;
export const waListo = () => Boolean(sockInstance);

/** Envía cualquier contenido de Baileys ({ text }, { image }, { audio }…). */
export async function enviar(jid, contenido) {
  if (!sockInstance) {
    console.warn('⚠️  Sin socket de WhatsApp activo, no se envió a', jid);
    return false;
  }
  try {
    await sockInstance.sendMessage(jid, contenido);
    return true;
  } catch (err) {
    console.error('Error enviando WhatsApp a', jid, '—', err?.message || err);
    return false;
  }
}

/** Envía texto plano. Devuelve true/false en vez de lanzar. */
export async function enviarTexto(jid, texto) {
  if (!sockInstance) {
    console.warn('⚠️  Sin socket de WhatsApp activo, no se envió:', String(texto).slice(0, 60));
    return false;
  }
  return enviar(jid, { text: texto });
}

/** Manda varios mensajes con una pequeña pausa para que lleguen en orden. */
export async function enviarSecuencia(jid, textos, pausaMs = 600) {
  for (const [i, texto] of textos.filter(Boolean).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, pausaMs));
    await enviarTexto(jid, texto);
  }
}

/**
 * Manda el mismo texto a varios destinos a la vez.
 * Devuelve { enviados, fallidos } — nunca lanza: un aviso a medias vale más que
 * ninguno, y el resultado sirve para auditar después qué llegó y qué no.
 */
export async function enviarATodos(jids, texto) {
  const resultados = await Promise.all(jids.map((jid) => enviarTexto(jid, texto)));
  return {
    enviados: resultados.filter(Boolean).length,
    fallidos: resultados.filter((r) => !r).length,
  };
}

/** Muestra "escribiendo…" — hace que el bot se sienta menos robot. */
export async function escribiendo(jid, ms = 900) {
  if (!sockInstance) return;
  try {
    await sockInstance.sendPresenceUpdate('composing', jid);
    await new Promise((r) => setTimeout(r, ms));
    await sockInstance.sendPresenceUpdate('paused', jid);
  } catch {
    /* la presencia es cosmética, si falla no importa */
  }
}

/** Marca mensajes como leídos. Cosmético también: se ignora si falla. */
export async function marcarLeido(keys) {
  if (!sockInstance) return;
  try {
    await sockInstance.readMessages(Array.isArray(keys) ? keys : [keys]);
  } catch {
    /* da igual */
  }
}

export default {
  setSock,
  getSock,
  waListo,
  enviar,
  enviarTexto,
  enviarSecuencia,
  enviarATodos,
  escribiendo,
  marcarLeido,
};
