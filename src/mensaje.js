/**
 * Lo que depende de la *forma* de los mensajes de Baileys.
 *
 * Vive aquí a propósito, aunque no importe la librería: cada vez que Baileys
 * cambia de versión mayor, estos son los campos que se mueven de lugar. Tenerlos
 * en un solo archivo es la diferencia entre arreglarlo una vez y arreglarlo en
 * cada bot.
 */

/** Saca el texto sin importar si vino como mensaje normal, botón o lista. */
export function extraerTexto(msg) {
  return (
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.buttonsResponseMessage?.selectedButtonId ||
    msg?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg?.message?.templateButtonReplyMessage?.selectedId ||
    msg?.message?.imageMessage?.caption ||
    ''
  );
}

export const esGrupo = (jid = '') => jid.endsWith('@g.us');
export const esBroadcast = (jid = '') => jid === 'status@broadcast' || jid.endsWith('@broadcast');

/** El número pelón, sin sufijo de dispositivo ni dominio. */
export const numeroDe = (jid = '') => String(jid).split(':')[0].split('@')[0] || null;

export default { extraerTexto, esGrupo, esBroadcast, numeroDe };
