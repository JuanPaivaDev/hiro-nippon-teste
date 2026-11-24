import { createHmac, randomUUID } from 'node:crypto';

const supabase = 'https://wfbhvsapgytftiukvvxs.supabase.co';
const cookieName = '__Host-hiro-purchase';
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const verificationPattern = /^VE[a-f0-9]{32}$/i;
const unavailable = { error: 'O envio de código está indisponível agora. Você pode testar com o CPF fictício 000.000.000-00.' };
const invalidCode = { error: 'Não consegui confirmar o código. Confira os números ou solicite um novo em instantes.' };

export function phoneServiceConfigured(env = process.env) {
  return /^[a-f0-9]{64}$/.test(env.HIRO_PHONE_KEY ?? '')
    && /^VA[a-f0-9]{32}$/i.test(env.TWILIO_VERIFY_SERVICE_SID ?? '')
    && /^(?:SK|AC)[a-f0-9]{32}$/i.test(env.TWILIO_VERIFY_API_KEY ?? '')
    && Boolean(env.TWILIO_VERIFY_API_SECRET)
    && Boolean(env.HIRO_CLUB_PUBLISHABLE_KEY?.startsWith('sb_publishable_'));
}

function getCookie(req) {
  const part = String(req.headers.cookie ?? '').split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  return part?.slice(cookieName.length + 1) ?? '';
}

function writeCookie(res, value, lifetime) {
  res.setHeader('Set-Cookie', cookieName + '=' + value + '; Max-Age=' + lifetime + '; Path=/; Secure; HttpOnly; SameSite=Strict');
}

function cpfIsValid(cpf) {
  if (!/^[0-9]{11}$/.test(cpf) || /^([0-9])\1{10}$/.test(cpf)) return false;
  const digit = length => (Array.from(cpf.slice(0, length)).reduce((sum, digit, i) => sum + Number(digit) * (length + 1 - i), 0) * 10 % 11) % 10;
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function formatPurchase(purchase) {
  if (!purchase || !/^\d{4}-\d{2}-\d{2}$/.test(purchase.sold_on)
    || !Number.isSafeInteger(purchase.net_cents) || purchase.net_cents < 1) {
    return 'Confirmei sua identidade. Não encontrei uma compra no histórico disponível. A equipe da loja pode conferir.';
  }
  const day = purchase.sold_on.split('-').reverse().join('/');
  const amount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(purchase.net_cents / 100);
  return 'Sua última compra registrada no Mobne foi em ' + day + ', no valor de ' + amount + '.';
}

export function createPurchaseVerification({ env = process.env, transport = fetch } = {}) {
  async function database(p_action, args = {}) {
    const res = await transport(supabase + '/rest/v1/rpc/nippon_hiro_phone', {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(14000),
      headers: { apikey: env.HIRO_CLUB_PUBLISHABLE_KEY, 'X-Hiro-Phone-Key': env.HIRO_PHONE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_action, ...args }),
    });
    if (!res.ok) throw Error('database_unavailable');
    return res.json();
  }

  async function verifyPhone(endpoint, body) {
    const auth = Buffer.from(env.TWILIO_VERIFY_API_KEY + ':' + env.TWILIO_VERIFY_API_SECRET).toString('base64');
    const res = await transport('https://verify.twilio.com/v2/Services/' + env.TWILIO_VERIFY_SERVICE_SID + '/' + endpoint, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    return res.ok ? res.json() : null;
  }

  return async function purchaseVerification(req, res) {
    const send = (status, body) => res.status(status).json(body);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return send(405, { error: 'Método indisponível.' });
    if (req.headers.origin !== 'https://hiro-nippon-teste.vercel.app') return send(403, { error: 'Abra a conversa da Hiro para continuar.' });
    if (!phoneServiceConfigured(env)) return send(503, unavailable);
    const body = req.body ?? {};
    if (body.action === 'start') {
      const cpf = typeof body.cpf === 'string' && body.cpf.length <= 14 ? body.cpf.replace(/[. \-]/g, '') : '';
      if (!cpfIsValid(cpf)) return send(400, { error: 'Confere os números do CPF e tenta de novo?' });
      let challenge = randomUUID();
      const client = String(req.headers['x-vercel-forwarded-for'] ?? '').split(',')[0].trim().slice(0,64);
      const fingerprint = createHmac('sha256', env.HIRO_PHONE_KEY).update('client:' + client).digest('hex');
      try {
        const result = await database('start', { p_cpf: cpf, p_client: fingerprint });
        if (result?.status === 'send' && uuidPattern.test(result.id ?? '') && /^\+55[1-9][0-9]9[0-9]{8}$/.test(result.phone ?? '')) {
          const verification = await verifyPhone('Verifications', { To: result.phone, Channel: 'sms', Locale: 'pt-BR' });
          if (verification?.status === 'pending' && verification.service_sid === env.TWILIO_VERIFY_SERVICE_SID
            && verification.to === result.phone && verificationPattern.test(verification.sid ?? '')) {
            const saved = await database('sent', { p_id: result.id, p_provider_id: verification.sid });
            if (saved?.status === 'sent') challenge = result.id;
          }
        }
      } catch { /* Use the same response for unknown or unavailable records. */ }
      writeCookie(res, challenge, 300);
      return send(200, { reply: 'Se o CPF estiver vinculado a um celular no cadastro da loja, você recebe um código por SMS. Quando chegar, me manda os números aqui.' });
    }
    if (body.action === 'check') {
      const id = getCookie(req);
      if (!uuidPattern.test(id) || typeof body.code !== 'string' || !/^[0-9]{4,10}$/.test(body.code)) return send(400, invalidCode);
      try {
        const challenge = await database('check', { p_id: id });
        if (challenge?.status !== 'check' || !verificationPattern.test(challenge.provider_id ?? '')) return send(400, invalidCode);
        const verification = await verifyPhone('VerificationCheck', { VerificationSid: challenge.provider_id, Code: body.code });
        if (verification?.status !== 'approved' || verification.sid !== challenge.provider_id
          || verification.service_sid !== env.TWILIO_VERIFY_SERVICE_SID) return send(400, invalidCode);
        const result = await database('complete', { p_id: id, p_provider_id: challenge.provider_id });
        if (result?.status !== 'confirmed') return send(400, invalidCode);
        writeCookie(res, '', 0);
        return send(200, { reply: formatPurchase(result.purchase) });
      } catch {
        return send(503, { error: 'Não consegui conferir o código agora. Tente novamente.' });
      }
    }
    return send(400, { error: 'Solicitação inválida.' });
  };
}

export default createPurchaseVerification();
