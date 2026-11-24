const byId = id => document.getElementById(id);
const messages = byId('messages');
const composer = byId('composer');
const input = byId('message');
const typing = byId('typing');
const resetButton = byId('reset');
const clubButton = byId('club-entry');
const clubLogin = byId('club-login');
const demoVerification = byId('demo-verification');
const demoCpf = byId('demo-cpf');
const demoCpfError = byId('demo-cpf-error');
const format = new Intl.NumberFormat('pt-BR');
const audioUrls = new Set();
let sessionId = crypto.randomUUID();
let history = [];
let verified = false;
let pending = false;
let clubAuth;
let clubToken = '';
let resumeMessage;
let resumeDemo;
let purchaseCheck;
let phoneVerification = false;
let nextVoice;

function chooseVoice() {
  if (nextVoice !== undefined) {
    const voice = nextVoice;
    nextVoice = undefined;
    return voice;
  }
  const voice = Math.random() < 0.5;
  nextVoice = !voice;
  return voice;
}

async function request(body) {
  const response = await fetch('/api/chat', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json',
      ...(clubToken ? { 'X-Hiro-Club-Session': clubToken } : {}) },
    body: JSON.stringify({ ...body, sessionId }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? 'Não foi possível continuar.');
  return data;
}

function append(role, value) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + role;
  bubble.textContent = value;
  messages.append(bubble);
  return bubble;
}

function showRewards(rewards) {
  if (!Array.isArray(rewards) || !rewards.length) return;
  const cards = document.createElement('div');
  cards.className = 'cards';
  cards.setAttribute('aria-label', 'Prêmios do Clube');
  cards.tabIndex = 0;
  for (const item of rewards) {
    const card = document.createElement('article');
    card.className = 'card';
    if (item.image) {
      const photo = document.createElement('img');
      photo.src = item.image;
      photo.alt = '';
      photo.loading = 'lazy';
      card.append(photo);
    }
    const title = document.createElement('strong');
    title.textContent = item.name;
    const price = document.createElement('span');
    price.textContent = format.format(item.points) + ' pontos';
    card.append(title, price);
    cards.append(card);
  }
  messages.append(cards);
}


function showProducts(items) {
  const products = Array.isArray(items) ? items.slice(0,3).filter(item => item && typeof item.name === 'string' && item.name.trim()) : [];
  if (!products.length) return false;
  const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
  for (const item of products) {
    const card = document.createElement('article'); card.className = 'bubble hiro product-card';
    const photo = document.createElement('div'); photo.className = 'product-photo'; photo.textContent = 'Foto indisponível';
    try {
      const url = new URL(item.image_url);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        const image = document.createElement('img'); image.src = url.href; image.alt = item.name;
        image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => photo.replaceChildren(document.createTextNode('Foto indisponível')), { once:true });
        photo.replaceChildren(image);
      }
    } catch { /* Keep the placeholder when no image is provided. */ }
    const title = document.createElement('h2'); title.textContent = item.name;
    const price = document.createElement('strong'); price.className = 'product-price';
    const points = item.price_points ?? item.points;
    const reward = item.kind === 'reward' || typeof points === 'number';
    price.textContent = reward
      ? typeof points === 'number' && Number.isFinite(points) && points >= 0 ? format.format(points) + ' pontos para resgatar' : 'Pontos não confirmados'
      : item.currency === 'BRL' && typeof item.unit_price === 'number' && Number.isFinite(item.unit_price) && item.unit_price >= 0 ? money.format(item.unit_price) : 'Preço não confirmado';
    card.append(photo, title, price);
    if (item.available === false || item.available == null) {
      const stock = document.createElement('span'); stock.className = 'product-availability';
      stock.textContent = item.available === false ? 'Indisponível' : 'Disponibilidade não confirmada'; card.append(stock);
    }
    if (item.demo === true) {
      const demo = document.createElement('small'); demo.textContent = 'Prêmio de demonstração'; card.append(demo);
    }
    messages.append(card);
  }
  return true;
}

function lock(isPending) {
  pending = isPending;
  typing.hidden = !isPending;
  for (const button of document.querySelectorAll('#chat button, #reset, #club-entry')) button.disabled = isPending;
}

function showAudio(parent, blob, label) {
  const player = document.createElement('audio');
  player.controls = true;
  player.preload = 'metadata';
  player.setAttribute('aria-label', label);
  player.src = URL.createObjectURL(blob);
  audioUrls.add(player.src);
  parent.append(player);
  return player;
}

function appendReply(text, voice) {
  if (voice?.mime === 'audio/mpeg' && typeof voice.base64 === 'string' && voice.base64.length) {
    let bytes;
    try { bytes = Uint8Array.from(atob(voice.base64), char => char.charCodeAt(0)); } catch { /* Use the text reply if the audio is invalid. */ }
    if (bytes?.length) {
      const bubble = append('hiro', '');
      const player = showAudio(bubble, new Blob([bytes], { type: 'audio/mpeg' }), 'Resposta em áudio do Hiro');
      player.addEventListener('error', () => {
        URL.revokeObjectURL(player.src);
        audioUrls.delete(player.src);
        player.replaceWith(document.createTextNode(text));
      }, { once: true });
      return bubble;
    }
  }
  return append('hiro', text);
}

function addAction(parent, label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  parent.append(button);
  return button;
}

function updateMode() {
  byId('mode-status').textContent = clubToken ? 'Conta do Clube conectada. Os dados desta sessão são pessoais.'
    : 'Simulação de atendimento da NIPPON-AJI.';
  clubButton.textContent = clubToken ? 'Sair do Clube' : 'Entrar no Clube';
}

function clearConversation() {
  sessionId = crypto.randomUUID();
  history = [];
  purchaseStep(undefined);
  nextVoice = undefined;
  for (const url of audioUrls) URL.revokeObjectURL(url);
  audioUrls.clear();
  messages.replaceChildren();
  input.value = '';
}

function openClub(message) {
  resumeMessage = message;
  byId('club-error').textContent = '';
  clubLogin.showModal();
}

function purchaseStep(step) {
  purchaseCheck = step;
  input.inputMode = step ? 'numeric' : 'text';
}

async function checkPurchase(text) {
  const phase = purchaseCheck;
  input.value = '';
  lock(true);
  messages.scrollTop = messages.scrollHeight;
  try {
    if (/^cancelar[.!]?$/i.test(text)) {
      purchaseStep(undefined);
      append('customer', text);
      append('hiro', 'Tá bom. Como posso te ajudar?');
      return;
    }
    const waitingForCpf = phase === 'cpf';
    const digits = text.replace(/[.\-\s]/g, '');
    append('customer', waitingForCpf ? 'CPF informado' : 'Código informado');
    if (waitingForCpf && !/^\d{11}$/.test(digits)) {
      append('hiro', 'Me manda os 11 dígitos do CPF. Se quiser sair da consulta, escreve “cancelar”.');
      return;
    }
    if (waitingForCpf && digits === '00000000000') {
      purchaseStep('sample-code');
      append('hiro', 'Encontrei o cadastro de teste. Pra simular a confirmação do telefone, digita o código 123456 aqui.');
      return;
    }
    if (waitingForCpf && !phoneVerification) {
      append('hiro', 'O envio de SMS ainda não está conectado nesta demo. Pra testar a consulta, me passa o CPF de exemplo 000.000.000-00.');
      return;
    }
    if (!waitingForCpf && !/^\d{4,10}$/.test(digits)) {
      append('hiro', 'Digita só os números do código ou escreve “cancelar”.');
      return;
    }
    if (phase === 'sample-code') {
      if (digits !== '123456') {
        append('hiro', 'Esse código não bateu. Na simulação, digita 123456.');
        return;
      }
      const data = await request({ action: 'show_sample_purchase', voice: chooseVoice() });
      purchaseStep(undefined);
      appendReply(data.reply, data.voice);
      history = [...history, { role: 'hiro', text: data.reply }].slice(-12);
      return;
    }
    const body = waitingForCpf ? { action: 'start', cpf: digits } : { action: 'check', code: digits };
    const response = await fetch('/api/purchase-verification', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? 'Não consegui confirmar os dados agora.');
    purchaseStep(waitingForCpf ? 'phone-code' : undefined);
    append('hiro', data.reply);
  } catch (error) {
    append('hiro', error.message);
  } finally {
    lock(false);
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  }
}

async function send(message, { retry = false, speak } = {}) {
  const content = message.trim();
  if (pending || !content) return;
  if (purchaseCheck) return checkPurchase(content);
  const previous = history.slice(-12);
  if (!retry) append('customer', content);
  input.value = '';
  lock(true);
  messages.scrollTop = messages.scrollHeight;
  try {
    const voice = speak ?? chooseVoice();
    const data = await request({ message: content, history: previous, verified, voice, mode: clubToken ? 'club' : 'demo' });
    const hasProducts = Array.isArray(data.product_cards) && data.product_cards.some(item => item && typeof item.name === 'string' && item.name.trim());
    const bubble = appendReply(hasProducts ? (data.text || 'Confira estas opções:') : data.reply, hasProducts ? null : data.voice);
    showProducts(data.product_cards);
    if (data.action === 'purchase_verification_required') {
      purchaseStep('cpf');
    } else if (data.action === 'verification_required') {
      if (clubAuth) addAction(bubble, 'Entrar no Clube para consultar', () => openClub({ content, speak: voice }));
      const button = addAction(bubble, 'Verificar conta de teste', () => {
        resumeDemo = { content, speak: voice };
        demoCpfError.textContent = '';
        demoVerification.showModal();
      });
      button.dataset.verify = 'true';
    } else if (data.action === 'session_expired') {
      clubToken = '';
      updateMode();
      if (clubAuth) addAction(bubble, 'Renovar sessão do Clube', () => openClub({ content, speak: voice }));
    } else if (data.action === 'handoff_required' && data.contact === 'contato@nipponaji.com') {
      const contact = document.createElement('a');
      contact.href = 'mailto:contato@nipponaji.com';
      contact.textContent = 'Contato da equipe';
      bubble.append(contact);
    }
    if (!hasProducts) showRewards(data.rewards);
    const replyForContext = data.personal ? 'Consulta pessoal respondida no canal autorizado.' : data.reply.slice(0, 1200);
    history = [...previous, { role: 'customer', text: content }, { role: 'hiro', text: replyForContext }].slice(-12);
  } catch (error) {
    append('hiro', error.message);
    input.value = content;
  } finally {
    lock(false);
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  }
}

void fetch('/api/chat', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(config => {
    clubAuth = config?.clubAuth;
    phoneVerification = config?.phoneVerification === true;
    clubButton.hidden = !clubAuth;
  }).catch(() => {});
composer.addEventListener('submit', event => { event.preventDefault(); void send(input.value); });
byId('suggestions').addEventListener('click', event => {
  if (event.target instanceof HTMLButtonElement) void send(event.target.textContent);
});
resetButton.addEventListener('click', () => {
  verified = false;
  clearConversation();
  updateMode();
  input.focus();
});
clubButton.addEventListener('click', () => {
  if (!clubToken) { openClub(); return; }
  clubToken = '';
  verified = false;
  clearConversation();
  updateMode();
  input.focus();
});
byId('club-close').addEventListener('click', () => clubLogin.close());
byId('demo-verification-close').addEventListener('click', () => demoVerification.close());
demoVerification.addEventListener('close', () => {
  demoCpf.value = '';
  demoCpf.removeAttribute('aria-invalid');
  demoCpfError.textContent = '';
  resumeDemo = undefined;
});
byId('demo-verification-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!resumeDemo || pending || clubToken) return;
  // The sample CPF is checked in this browser and never sent with the conversation.
  if (demoCpf.value.trim().replace(/[.\-\s]/g, '') !== '00000000000') {
    demoCpfError.textContent = 'Use o CPF fictício 000.000.000-00.';
    demoCpf.setAttribute('aria-invalid', 'true');
    demoCpf.select();
    return;
  }
  const { content, speak } = resumeDemo;
  verified = true;
  demoVerification.close();
  updateMode();
  document.querySelectorAll('button[data-verify]').forEach(control => control.remove());
  void send(content, { retry: true, speak });
});
clubLogin.addEventListener('close', () => { byId('club-password').value = ''; byId('club-cpf').value = ''; });
byId('club-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!clubAuth || pending) return;
  const submit = event.currentTarget.querySelector('[type=submit]');
  const feedback = byId('club-error');
  submit.disabled = true;
  feedback.textContent = '';
  try {
    const cpf = byId('club-cpf').value.trim().replace(/[.\-\s]/g, '');
    if (cpf && !/^\d{11}$/.test(cpf)) throw Error('Confira os 11 dígitos do CPF.');
    const response = await fetch(clubAuth.url + '/auth/v1/token?grant_type=password', {
      method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', apikey: clubAuth.publicKey },
      body: JSON.stringify({ email: byId('club-email').value.trim(), password: byId('club-password').value }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw Error('Confira o e-mail e a senha do Clube.');
    if (cpf) {
      const checked = await fetch(clubAuth.url + '/rest/v1/rpc/nippon_hiro_check_cpf', {
        method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/json', apikey: clubAuth.publicKey, Authorization: 'Bearer ' + data.access_token },
        body: JSON.stringify({ p_cpf: cpf }),
      });
      const result = await checked.json();
      if (!checked.ok || result.status !== 'confirmed') throw Error(result.status === 'unavailable' || result.status === 'try_later'
        ? 'Não consegui conferir o CPF agora. Tente novamente em instantes.'
        : 'Não consegui confirmar o CPF no cadastro vinculado. Confira os dados ou fale com a equipe da loja.');
    }
    clubToken = data.access_token;
    verified = false;
    clubLogin.close();
    clearConversation();
    updateMode();
    if (resumeMessage) void send(resumeMessage.content, { speak: resumeMessage.speak });
  } catch (e) {
    feedback.textContent = e.message;
  } finally {
    submit.disabled = false;
    byId('club-password').value = '';
  }
});

