import { randomUUID } from 'node:crypto';
import { phoneServiceConfigured } from './purchase-verification.mjs';

const origin = 'https://automacao.v4kuri.com.br/webhook/nippon-hiro-';
const clubAuthUrl = 'https://wfbhvsapgytftiukvvxs.supabase.co';
const maxAudio = 1_500_000;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const formats = {
  'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/x-m4a': 'm4a',
};
const testAccount = {
  wallet: { action: 'reply', reply: 'Você tem 800 pontos disponíveis na carteira de teste.' },
  orders: { action: 'reply', reply: 'Seu pedido de teste mais recente é o nº 10482, de 14/11/2026. Está faturado. Ele tem 2 itens.' },
  purchases: { action: 'reply', reply: 'Na conta de teste, sua última compra foi em 14/11/2026, no valor de R$ 83,90.' },
  redemptions: { action: 'reply', reply: 'A conta de teste ainda não tem resgates registrados.' },
  eligible: { action: 'show_rewards', reply: 'Com seus 800 pontos de teste, você pode escolher este prêmio.', rewards: [
    { name: 'Hashi de bambu decorado · 5 pares', points: 500, image: 'https://nippon-clube-hub.vercel.app/rewards/p1-hashi.webp' },
  ] },
};
const demoOrders = 'Seus pedidos de teste mais recentes:\n• Nº 10482 · 14/11/2026 · faturado\n• Nº 10361 · 08/11/2026 · faturado';

function readAudio(audio) {
  const type = audio?.mime?.split?.(';')[0].toLowerCase();
  if (!Object.hasOwn(formats, type) || typeof audio?.base64 !== 'string'
    || !audio.base64.length || audio.base64.length > Math.ceil(maxAudio / 3) * 4
    || audio.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.base64)) return null;
  const bytes = Buffer.from(audio.base64, 'base64');
  if (bytes.length < 16 || bytes.length > maxAudio) return null;
  const header = bytes.toString('ascii', 0, 12);
  const format = formats[type];
  if ((format === 'webm' && bytes.readUInt32BE(0) !== 0x1a45dfa3)
    || (format === 'm4a' && header.slice(4,8) !== 'ftyp')
    || (format === 'ogg' && !header.startsWith('OggS'))
    || (format === 'mp3' && !header.startsWith('ID3') && !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))
    || (format === 'wav' && (!header.startsWith('RIFF') || !header.endsWith('WAVE')))) return null;
  return { blob: new Blob([bytes], { type }), name: 'mensagem.' + format };
}

function callWorkflow(path, key, body, timeout, headers = {}) {
  return fetch(origin + path + '-v1', {
    method: 'POST', redirect: 'error', cache: 'no-store',
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    headers: { 'X-Hiro-Channel-Key': key, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
}

async function spokenReply(key, reply) {
  const text = reply.trim().slice(0, 1600);
  if (!text) return null;
  try {
    const voice = await callWorkflow('voz', key, { text }, 20000);
    if (!voice.ok || !/^audio\/(mpeg|mp3)(?:;|$)/i.test(voice.headers.get('content-type') ?? '')) return null;
    const bytes = Buffer.from(await voice.arrayBuffer());
    return bytes.length && bytes.length <= maxAudio ? { mime: 'audio/mpeg', base64: bytes.toString('base64') } : null;
  } catch {
    return null;
  }
}

export default async function chat(req, res) {
  const send = (status, value) => res.status(status).json(value);
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') {
    const publicKey = process.env.HIRO_CLUB_PUBLISHABLE_KEY;
    const clubAuth = publicKey?.startsWith('sb_publishable_') ? { url: clubAuthUrl, publicKey } : null;
    return send(200, { clubAuth, phoneVerification: phoneServiceConfigured() });
  }
  if (req.method !== 'POST') return send(405, { error: 'Método indisponível.' });
  const key = process.env.HIRO_CHANNEL_KEY;
  if (!key) return send(503, { error: 'Demo indisponível.' });
  const b = req.body ?? {};
  if (b.sessionId !== undefined && (typeof b.sessionId !== 'string' || !sessionIdPattern.test(b.sessionId))) {
    return send(400, { error: 'Identificador de conversa inválido.' });
  }
  const sessionId = b.sessionId ?? randomUUID();
  if (b.action === 'show_sample_purchase') {
    const result = testAccount.purchases;
    const voice = b.voice === true ? await spokenReply(key, result.reply) : undefined;
    return send(200, { ...result, voice });
  }
  const { history = [], verified, audio } = b;
  let { message } = b;
  if ((!audio && (typeof message !== 'string' || !message.trim() || message.length > 1200)) || !Array.isArray(history)
    || history.length > 12 || history.some(t => !['customer','hiro'].includes(t?.role) || typeof t.text !== 'string' || t.text.length > 1200)) {
    return send(400, { error: 'Envie uma mensagem com até 1.200 caracteres.' });
  }
  const recording = audio ? readAudio(audio) : null;
  if (audio && !recording) return send(400, { error: 'Use um áudio MP3, M4A, WebM, Ogg ou WAV de até 1,5 MB.' });
  const requestedSession = req.headers['x-hiro-club-session'];
  const real = b.mode === 'club';
  const token = real && typeof requestedSession === 'string' && requestedSession.length <= 4095
    && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(requestedSession) ? requestedSession : '';
  if (real && !token) return send(401, { error: 'Entre na sua conta do Clube para consultar.' });

  let transcript;
  if (recording) {
    try {
      const form = new FormData();
      form.set('audio', recording.blob, recording.name);
      const transcription = await callWorkflow('transcrever', key, form, 24000);
      const value = await transcription.json();
      if (!transcription.ok) throw Error('transcription_unavailable');
      transcript = typeof value.text === 'string' ? value.text.trim().slice(0, 1200) : '';
    } catch {
      return send(502, { error: 'Não consegui transcrever o áudio. Envie outro ou escreva sua mensagem.' });
    }
    if (!transcript) return send(422, { error: 'Não consegui ouvir uma fala. Tente gravar novamente.' });
    message = transcript;
  }
  try {
    const response = await callWorkflow('atendimento', key,
      { channel: real ? 'club_authenticated' : 'demo', sessionId, message, history, supportsAudio: b.voice === true }, undefined,
      token ? { 'X-Hiro-Club-Session': token } : {});
    const raw = await response.json();
    // Support the webhook body and pasted n8n execution envelopes.
    const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : null) : raw;
    const data = value?.body && typeof value.body === 'object' ? value.body : value;
    if (!response.ok || typeof data?.reply !== 'string') throw Error('workflow_unavailable');
    let result;
    if (data.action === 'verification_required') {
      const fixture = Object.hasOwn(testAccount, data.topic) ? testAccount[data.topic] : null;
      if (real) {
        result = data.accountUnlinked
          ? { action: 'account_unlinked', reply: 'Sua conta entrou no Clube, mas ainda não está vinculada a um cadastro do Mobne. Peça à equipe da NIPPON-AJI para fazer o vínculo.' }
          : { action: 'session_expired', reply: 'Sua sessão do Clube precisa ser renovada para consultar esses dados.' };
      } else if (data.topic === 'purchases') {
        result = { action: 'purchase_verification_required',
          reply: 'Claro! Me passa seu CPF pra eu localizar seu cadastro no Mobne?' };
      } else if (verified === true && fixture) {
        result = data.topic === 'orders' && data.detail === 'recentes' ? { ...fixture, reply: demoOrders } : fixture;
      } else {
        result = { action: 'verification_required',
          reply: 'Para consultar seus dados, confirme sua identidade. Entre no Clube para buscar dados reais ou use a conta simulada.' };
      }
    } else {
      result = { reply: data.reply, action: data.action, rewards: data.rewards, contact: data.contact,
        personal: data.personal === true, text: typeof data.text === 'string' ? data.text : undefined,
        product_cards: Array.isArray(data.product_cards) ? data.product_cards.slice(0,3) : undefined,
        presentation: Array.isArray(data.product_cards) && data.product_cards.length ? 'cards' : undefined,
        demo: data.demo === true, balance_points: typeof data.balance_points === 'number' ? data.balance_points : undefined,
        contact_channel: data.contact_channel };
    }
    const voice = b.voice === true && !result.product_cards?.length && !(real && result.personal) ? await spokenReply(key, result.reply) : undefined;
    return send(200, { ...result, transcript, voice });
  } catch {
    return send(502, { error: 'O Hiro não conseguiu responder agora. Tente novamente.', transcript });
  }
}
