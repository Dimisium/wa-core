/**
 * Pruebas de la máquina de estado y de los avisos, sin tocar WhatsApp.
 *
 * Para qué sirven: cuando Baileys se actualice y toques conexion.js, esto te
 * dice en dos segundos si rompiste la lógica de reconexión o de avisos. Correr
 * `npm test` antes de hacer push es lo que evita mandarle un fix malo a todos
 * los bots de golpe.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as estado from '../src/estado.js';
import { extraerTexto, esGrupo, esBroadcast, numeroDe } from '../src/mensaje.js';
import { crearTextos, sinHtml, urlEsPublica } from '../src/textos.js';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Deja el estado limpio y recoge los avisos en vez de mandarlos.
 *
 * El reset va por marcarDesvinculado() a propósito: es el único camino de la API
 * pública que borra el historial de alertas, así que las pruebas no necesitan
 * meter mano en las variables internas del módulo.
 */
function espia(alertas = {}) {
  const recibidos = [];
  estado.marcarDesvinculado();
  estado.configurar({
    panelUrl: 'https://panel.ejemplo.com',
    queHace: 'atendiendo clientes',
    alertas: {
      offlineMin: 10,
      qrMin: 2,
      repetirMin: 60,
      qrMaxAvisos: 3,
      ...alertas,
      avisar: async (aviso) => {
        recibidos.push(aviso);
        return true;
      },
    },
  });
  return recibidos;
}

/**
 * Revisa como si ya llevara N minutos caído, sin esperar N minutos reales.
 * Adelantar el reloj es más honesto que exponer un setter solo para las pruebas:
 * el código bajo prueba es exactamente el que corre en producción.
 */
async function revisarComoSiLlevara(minutos) {
  const real = Date.now;
  Date.now = () => real() + minutos * 60000;
  try {
    await estado.revisarAhora();
  } finally {
    Date.now = real;
  }
}

test('el QR se convierte en imagen y deja el estado en "qr"', async () => {
  espia();
  await estado.marcarQR('2@algoquevienedebaileys,abc,def');

  const s = estado.snapshot();
  assert.equal(s.conexion, 'qr');
  assert.match(s.qr, /^data:image\/png;base64,/);
  assert.ok(s.qrGeneradoEn > 0);
  assert.ok(estado.qrPng() instanceof Buffer, 'qrPng() debe dar un PNG mandable');
  assert.equal(estado.hayQueEscanear(), true);
});

test('sin sesión vinculada, el aviso pide escanear y trae el QR', async () => {
  const avisos = espia();
  estado.marcarVinculado(false);
  await estado.marcarQR('2@otrocodigo,abc,def');

  await revisarComoSiLlevara(1);
  assert.equal(avisos.length, 0, 'el umbral de QR son 2 min');

  await revisarComoSiLlevara(5);
  assert.equal(avisos.length, 1);

  const [aviso] = avisos;
  assert.equal(aviso.tipo, 'escanear');
  assert.equal(aviso.pedirQR, true, 'el notificador debe poder ofrecer "mándame otro QR"');
  assert.ok(aviso.qrPng instanceof Buffer);
  assert.ok(aviso.pieQR.includes('ESCANEAR'));
  assert.equal(aviso.urlPublica, true, 'con https el notificador puede poner botón');
});

test('con sesión viva se espera más antes de molestar', async () => {
  const avisos = espia();
  estado.marcarConectado({ id: '5218112345678:12@s.whatsapp.net' });
  assert.equal(estado.conectado(), true);
  assert.equal(estado.snapshot().telefono, '5218112345678', 'el sufijo de dispositivo se cae');

  estado.marcarDesconectado({ motivo: 'Conexión cerrada (código 515)', reintentando: true });
  await revisarComoSiLlevara(3);
  assert.equal(avisos.length, 0, 'a los 3 min no se avisa: la sesión vive y reconecta solo');

  await revisarComoSiLlevara(11);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, 'caida');
  assert.ok(avisos[0].texto.includes('DESCONECTADO'));
  assert.ok(avisos[0].texto.includes('código 515'), 'el motivo llega en el texto');
});

test('una caída que resulta ser pérdida de sesión se reavisa sin esperar', async () => {
  const avisos = espia();
  estado.marcarConectado({ id: '5218112345678@s.whatsapp.net' });
  estado.marcarDesconectado({ motivo: 'sin red', reintentando: true });

  await revisarComoSiLlevara(11);
  assert.equal(avisos.at(-1).tipo, 'caida');

  // La reconexión no funcionó y las credenciales ya no sirven
  estado.marcarVinculado(false);
  await revisarComoSiLlevara(12);
  assert.equal(avisos.at(-1).tipo, 'escanear', 'cambió lo que la persona tiene que hacer');
});

test('un escaneo siempre se confirma, aunque nunca se haya avisado nada', async () => {
  const avisos = espia();
  estado.marcarVinculado(false);
  await estado.marcarQR('2@codigo,abc,def');

  // Vincula de inmediato: el vigilante nunca alcanzó a quejarse
  estado.marcarConectado({ id: '5218112345678:3@s.whatsapp.net' });
  await pausa(50);

  assert.equal(avisos.length, 1, 'quien acaba de escanear necesita saber si funcionó');
  assert.equal(avisos[0].tipo, 'vinculado');
  assert.ok(avisos[0].texto.includes('+5218112345678'));

  const primera = estado.snapshot().bitacora[0];
  assert.equal(primera.icono, '🔗');
  assert.ok(primera.texto.includes('Vinculado'), `la bitácora dice: ${primera.texto}`);
});

test('al reconectar avisa que volvió, y solo si había avisado antes', async () => {
  const avisos = espia();
  estado.marcarConectado({ id: '5218112345678@s.whatsapp.net' });
  assert.equal(avisos.length, 0, 'sin caída previa ni escaneo no hay nada que celebrar');

  estado.marcarDesconectado({ motivo: 'se cayó', reintentando: false });
  await pausa(50);
  assert.equal(avisos.at(-1).tipo, 'caida', 'si no va a reintentar, avisa de inmediato');

  estado.marcarConectado({ id: '5218112345678@s.whatsapp.net' });
  await pausa(50);
  assert.equal(avisos.at(-1).tipo, 'reconectado');
});

test('si venía de falta de QR, el aviso de vuelta es "vinculado"', async () => {
  const avisos = espia();
  estado.marcarVinculado(false);
  await estado.marcarQR('2@codigo,abc,def');
  await revisarComoSiLlevara(5);
  assert.equal(avisos.at(-1).tipo, 'escanear');

  estado.marcarConectado({ id: '5217712345678@s.whatsapp.net' });
  await pausa(50);
  assert.equal(avisos.at(-1).tipo, 'vinculado');
  assert.ok(avisos.at(-1).texto.includes('+5217712345678'));
});

test('los recordatorios de vinculación se callan al llegar al tope', async () => {
  const avisos = espia({ qrMaxAvisos: 3, repetirMin: 1 });
  estado.marcarVinculado(false);
  await estado.marcarQR('2@codigo,abc,def');

  // El primero es el aviso inicial; de ahí en adelante son recordatorios
  for (const min of [5, 10, 20, 40, 80, 160]) await revisarComoSiLlevara(min);

  const tipos = avisos.map((a) => a.tipo);
  assert.equal(tipos[0], 'escanear');
  assert.equal(
    avisos.length,
    3,
    `con tope 3 debe mandar 3 avisos y callarse; mandó ${avisos.length} (${tipos.join(', ')})`
  );
  assert.equal(avisos.at(-1).ultimo, true, 'el último se anuncia como último');
});

test('desvincular a mano no dispara alarmas', async () => {
  const avisos = espia();
  estado.marcarDesvinculado();
  await revisarComoSiLlevara(600);

  assert.equal(avisos.length, 0, 'lo apagó una persona a propósito');
  assert.equal(estado.snapshot().conexion, 'desvinculado');
  assert.equal(estado.hayQueEscanear(), false);
});

test('umbral en 0 apaga ese aviso', async () => {
  const avisos = espia({ qrMin: 0 });
  estado.marcarVinculado(false);
  await estado.marcarQR('2@codigo,abc,def');
  await revisarComoSiLlevara(600);

  assert.equal(avisos.length, 0);
});

test('si el notificador truena, no se cae el bot', async () => {
  estado.marcarDesvinculado();
  estado.configurar({
    alertas: {
      qrMin: 2,
      avisar: async () => {
        throw new Error('Telegram no contestó');
      },
    },
  });
  estado.marcarVinculado(false);
  await estado.marcarQR('2@codigo,abc,def');

  await assert.doesNotReject(() => revisarComoSiLlevara(5));
});

test('el panel puede leer el estado sin que exista socket', () => {
  espia();
  const s = estado.snapshot();
  for (const campo of ['conexion', 'motivo', 'qr', 'vinculado', 'bitacora', 'ahora']) {
    assert.ok(campo in s, `falta ${campo} en el snapshot que consume el panel`);
  }
  assert.ok(Array.isArray(s.bitacora));
  assert.equal(s.alertaQrMin, 2, 'el panel muestra cuándo va a saltar el aviso');
});

test('extraerTexto aguanta las formas de mensaje de Baileys', () => {
  const casos = [
    [{ message: { conversation: 'hola' } }, 'hola'],
    [{ message: { extendedTextMessage: { text: 'citado' } } }, 'citado'],
    [{ message: { buttonsResponseMessage: { selectedButtonId: 'btn_1' } } }, 'btn_1'],
    [
      { message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'fila_2' } } } },
      'fila_2',
    ],
    [{ message: { templateButtonReplyMessage: { selectedId: 'tpl_3' } } }, 'tpl_3'],
    [{ message: { imageMessage: { caption: 'mira esto' } } }, 'mira esto'],
    [{ message: { audioMessage: {} } }, ''],
    [{}, ''],
    [null, ''],
  ];
  for (const [msg, esperado] of casos) assert.equal(extraerTexto(msg), esperado);
});

test('se distinguen grupos, estados y privados', () => {
  assert.equal(esGrupo('12036304@g.us'), true);
  assert.equal(esGrupo('5218112345678@s.whatsapp.net'), false);
  assert.equal(esBroadcast('status@broadcast'), true);
  assert.equal(esBroadcast('5218112345678@s.whatsapp.net'), false);
  assert.equal(numeroDe('5218112345678:12@s.whatsapp.net'), '5218112345678');
});

test('el enlace al panel solo va en el texto cuando no sirve para un botón', () => {
  // Con https el notificador pone botón; meter el enlace además sería ruido.
  const conHttps = crearTextos({ panelUrl: 'https://panel.ejemplo.com' });
  assert.ok(!conHttps.caida({ minutos: 20 }).includes('panel.ejemplo.com'));

  // Sin https Telegram rechaza el botón: el texto es el único camino al panel.
  const local = crearTextos({ panelUrl: 'http://localhost:3000' });
  assert.ok(local.caida({ minutos: 20 }).includes('http://localhost:3000'));

  assert.equal(urlEsPublica('https://x.com'), true);
  assert.equal(urlEsPublica('http://localhost:3000'), false);
});

test('queHace adapta los avisos al tipo de bot', () => {
  const alertas = crearTextos({ queHace: 'mandando alertas' });
  const texto = alertas.caida({ minutos: 5 });
  assert.ok(texto.includes('no está mandando alertas'));
  assert.ok(!sinHtml(texto).includes('<b>'), 'sinHtml sirve para canales de texto plano');
});

test('los minutos se leen bonito', () => {
  const t = crearTextos({});
  assert.ok(t.caida({ minutos: 1 }).includes('1 minuto'));
  assert.ok(t.caida({ minutos: 45 }).includes('45 minutos'));
  assert.ok(t.caida({ minutos: 90 }).includes('1 h 30 min'));
  assert.ok(t.caida({ minutos: 120 }).includes('2 h'));
});
