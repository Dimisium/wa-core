/**
 * Textos por defecto de los avisos de caída.
 *
 * Van con etiquetas <b>/<i> porque tanto Telegram (parse_mode HTML) como un
 * correo en HTML las entienden. Si tu canal es texto plano, pásalos por
 * sinHtml(). Y si no te gustan, tu notificador puede ignorar `texto` y armar
 * los suyos con los datos del aviso.
 */

/** Quita las etiquetas para canales que no entienden HTML. */
export const sinHtml = (t = '') => String(t).replace(/<\/?[bi]>/g, '');

const comoTiempo = (min) => {
  const m = Math.round(min);
  if (m < 60) return `${m} minuto${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} h${r ? ` ${r} min` : ''}`;
};

/**
 * Telegram rechaza botones con URLs que no sean públicas (http://localhost), así
 * que cuando la URL no sirve para un botón la metemos en el texto. Se lee al
 * revés de lo que parece, pero es lo correcto: con https el notificador pone
 * botón y el enlace estorbaría; sin https el botón es imposible y el texto es
 * el único camino al panel.
 */
export const urlEsPublica = (url = '') => /^https:\/\//i.test(url);

export function crearTextos({ panelUrl = '', queHace = 'atendiendo clientes' } = {}) {
  const enlacePanel = () => (urlEsPublica(panelUrl) || !panelUrl ? '' : `\n🔗 Panel: ${panelUrl}`);

  const caida = ({ minutos, motivo }) =>
    [
      '🔴 <b>WHATSAPP DESCONECTADO</b>',
      '',
      `El bot lleva <b>${comoTiempo(minutos)}</b> sin conexión y <b>no está ${queHace}</b>.`,
      motivo ? `\n<i>${motivo}</i>` : '',
      '',
      '<b>Qué revisar, en este orden:</b>',
      '1️⃣ Que el celular tenga internet y batería.',
      '2️⃣ Que WhatsApp esté abierto en el celular.',
      '3️⃣ WhatsApp › Dispositivos vinculados: que el bot siga en la lista.',
      '',
      'Si ya no aparece en la lista, entra al panel y vuelve a vincular escaneando el QR.',
      enlacePanel(),
    ]
      .filter(Boolean)
      .join('\n');

  /**
   * El caso que de verdad necesita a una persona: no hay sesión vinculada. Pasa
   * cuando cierran la sesión desde el celular o cuando el servidor se reinicia
   * y pierde el auth_data (típico en hostings con disco efímero).
   */
  const escanear = ({ motivo } = {}) =>
    [
      '📷 <b>HAY QUE ESCANEAR EL QR</b>',
      '',
      `<b>El bot no tiene ninguna sesión de WhatsApp vinculada</b>, así que no está ${queHace}.`,
      motivo ? `<i>${motivo}</i>` : '',
      '',
      '<b>Esto no se arregla solo.</b> Se resuelve en dos minutos:',
      '1️⃣ Abre el panel: ahí está el código en vivo.',
      '2️⃣ En el celular: WhatsApp › Ajustes › <b>Dispositivos vinculados</b>.',
      '3️⃣ Toca <b>Vincular un dispositivo</b> y apunta al código.',
      enlacePanel(),
    ]
      .filter(Boolean)
      .join('\n');

  /** Pie de la foto del QR. Va corto: la imagen es lo que importa. */
  const pieQR = () =>
    [
      '📷 <b>HAY QUE ESCANEAR ESTE QR</b>',
      '',
      `El bot se quedó <b>sin sesión de WhatsApp</b> y no está ${queHace}.`,
      'En el celular: WhatsApp › Ajustes › <b>Dispositivos vinculados</b> › <b>Vincular un dispositivo</b>.',
      '',
      '⚠️ Este código vence en un minuto. Si ya no alcanzaste, pide otro — no tiene',
      'que ser ahorita, cuando puedas.',
    ].join('\n');

  /**
   * Recordatorio de que sigue sin vincular. Va sin foto a propósito: para cuando
   * llega, cualquier código ya venció, así que mandar otro solo estorba.
   */
  const recordatorio = ({ minutos, ultimo }) =>
    [
      '⏰ <b>El bot sigue sin WhatsApp vinculado</b>',
      '',
      `Lleva <b>${comoTiempo(minutos)}</b> sin estar ${queHace}.`,
      '',
      'Cuando tengas el celular a la mano, pide un código fresco para escanear.',
      ultimo ? '\n<i>Este es el último recordatorio: no te vuelvo a molestar con esto.</i>' : '',
    ]
      .filter(Boolean)
      .join('\n');

  const vinculado = ({ telefono }) =>
    [
      '🟢 <b>WHATSAPP VINCULADO</b>',
      '',
      `Quedó escaneado${telefono ? ` con el número <b>+${telefono}</b>` : ''}. El bot ya está ${queHace} otra vez.`,
    ].join('\n');

  const reconectado = ({ telefono }) =>
    [
      '🟢 <b>WHATSAPP RECONECTADO</b>',
      '',
      `El bot volvió a la vida${telefono ? ` con el número <b>+${telefono}</b>` : ''} y ya está ${queHace}.`,
      '',
      '<i>Revisa si alguien escribió mientras estaba caído.</i>',
    ].join('\n');

  const desvinculado = () =>
    [
      '🔌 <b>WHATSAPP DESVINCULADO</b>',
      '',
      `Se cerró la sesión del bot desde el panel. <b>Ya no está ${queHace}.</b>`,
      '',
      'Cuando quieras volver a activarlo, entra al panel y pulsa <b>Vincular</b> para escanear un QR nuevo.',
    ].join('\n');

  return { caida, escanear, pieQR, recordatorio, vinculado, reconectado, desvinculado, comoTiempo };
}

export default crearTextos;
