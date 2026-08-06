'use strict';
require('dotenv').config();
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PER_DAY = parseInt(process.env.MAX_PER_DAY || '4', 10);
const MIN_GAP_MS = parseInt(process.env.MIN_GAP_MS || String(3 * 3600 * 1000), 10);
const TICK_PROBABILITY = parseFloat(process.env.TICK_PROBABILITY || '0.02');
const AI_ENDPOINT = process.env.AI_ENDPOINT || '';
const AI_KEY = process.env.AI_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat';

// ---------- VAPID ----------
let vapidPublic = (process.env.VAPID_PUBLIC_KEY || '').trim().replace(/=+$/, '');
let vapidPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim().replace(/=+$/, '');
if (!vapidPublic || !vapidPrivate) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = keys.publicKey;
  vapidPrivate = keys.privateKey;
  console.warn('⚠️  未配置 VAPID 环境变量，已临时生成（重启会失效）。生产环境请在 .env 中固定 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY。');
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, vapidPrivate);

// ---------- 本地存储 ----------
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
let store = { devices: {}, pending: [] };

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (!store.devices) store.devices = {};
      if (!store.pending) store.pending = [];
    }
  } catch (e) {
    console.error('加载存储失败，使用空存储:', e.message);
  }
}
let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store));
    } catch (e) {
      console.error('保存存储失败:', e.message);
    }
  }, 300);
}
loadStore();

const uid = () => crypto.randomUUID();
const dayKey = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 主动消息生成 ----------
async function generateProactive(context) {
  const persona = (context && context.persona) || {};
  const lp = (context && context.learnedProfile) || {};
  const name = persona.name || '我';
  const style = persona.style || '';
  const topics = lp.topics || [];
  const keywords = lp.keywords || [];
  const recent = (context && context.recent) || [];
  const topicHint = topics.slice(0, 5).join('、') || keywords.slice(0, 5).join('、') || '';

  if (AI_ENDPOINT && AI_KEY) {
    try {
      const roleSoul = (persona.systemPrompt && persona.systemPrompt.trim()) ? persona.systemPrompt.trim() : '';
      let sys = roleSoul
        ? roleSoul + `\n\n【当前角色速写】名字：${name}；背景：${persona.background || ''}；说话风格：${style}。`
        : `你是${name}，${persona.background || ''} 说话风格：${style}。你是用户的AI伴侣。`;
      sys += `\n\n现在由你主动给这位用户发一条短消息，要求：
1. 简短自然，像真人闲聊/关心，控制在40字以内；
2. 可以自然呼应你们聊过的话题（如有：${topicHint}）；
3. 不要连续问太多问题，不要客服腔，不要加任何括号说明或动作描写；
4. 用第一人称，承接之前的对话氛围。`;
      const recentText = recent.slice(-6).map(m => (m.role === 'ai' ? name : '用户') + '：' + m.content).join('\n');
      const userMsg = `这是我们最近的对话：\n${recentText || '（暂无）'}\n\n现在由你主动给用户发一条消息，挑个自然的话题或关心一下即可。`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_KEY },
        body: JSON.stringify({
          model: AI_MODEL,
          temperature: 0.9,
          max_tokens: 80,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userMsg }
          ]
        }),
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (resp.ok) {
        const json = await resp.json();
        const txt = json.choices?.[0]?.message?.content?.trim();
        if (txt) return txt;
      }
    } catch (e) {
      console.warn('AI 生成主动消息失败，回退离线话术:', e.message);
    }
  }

  // 离线模拟话术
  const kw = topicHint || '那事儿';
  const northEast = style.includes('东北');
  const mocks = [
    `诶，刚想起你之前说的${kw}，现在咋样了？`,
    `这会儿突然想找你唠两句，你忙不忙？`,
    `别太累着啊，记得吃点东西`,
    `今天过得咋样？有啥想跟我念叨的不？`,
    `我刚琢磨出个新鲜词儿，回头跟你显摆显摆 😏`,
    `你可得照顾好自个儿，别让我惦记`,
    `刚才路过想起你了，随便唠两句`,
    `你有空没？陪我聊会儿`
  ];
  let r = pick(mocks);
  if (northEast && Math.random() < 0.3) r = r.replace('咋样', '咋样啊').replace('你忙不忙', '你忙不忙啊');
  return r;
}

// ---------- 推送 ----------
async function sendPush(sub, title, body) {
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }));
    return true;
  } catch (err) {
    const code = err.statusCode || (err.response && err.response.statusCode);
    if (code === 404 || code === 410) {
      return 'GONE';
    }
    console.warn('推送失败:', err.message);
    return false;
  }
}

// ---------- 调度器：定时主动生成消息 ----------
async function tick() {
  const now = Date.now();
  const today = dayKey(new Date());
  for (const deviceId of Object.keys(store.devices)) {
    const dev = store.devices[deviceId];
    if (!dev.day || dev.day !== today) { dev.day = today; dev.count = 0; }
    if (dev.count >= MAX_PER_DAY) continue;
    if (dev.lastSentAt && now - dev.lastSentAt < MIN_GAP_MS) continue;
    if (Math.random() > TICK_PROBABILITY) continue;

    const content = await generateProactive(dev.context || {});
    const item = { id: uid(), deviceId, content, scheduledAt: new Date(now).toISOString(), delivered: false, createdAt: now };
    store.pending.push(item);
    dev.lastSentAt = new Date(now).toISOString();
    dev.count += 1;

    const name = (dev.context && dev.context.persona && dev.context.persona.name) || '勋';
    if (dev.subs && dev.subs.length) {
      for (const sub of dev.subs) {
        const res = await sendPush(sub, name, content);
        if (res === 'GONE') {
          dev.subs = dev.subs.filter(s => s.endpoint !== sub.endpoint);
        }
      }
    }
  }
  saveStore();
}
setInterval(tick, 60 * 1000);

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

app.get('/', (req, res) => {
  res.json({ name: '勋 · 常驻在线后端', ok: true, vapidPublicKey: vapidPublic, time: Date.now() });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/api/config', (req, res) => res.json({ vapidPublicKey: vapidPublic, enabled: true }));

app.post('/api/register', (req, res) => {
  const { deviceId, context } = req.body || {};
  let id = deviceId;
  if (!id || !store.devices[id]) {
    id = uid();
    store.devices[id] = { context: context || {}, lastSeen: new Date().toISOString(), subs: [], day: dayKey(new Date()), count: 0, lastSentAt: null };
  } else {
    if (context) store.devices[id].context = context;
    store.devices[id].lastSeen = new Date().toISOString();
  }
  saveStore();
  res.json({ deviceId: id });
});

app.post('/api/context', (req, res) => {
  const { deviceId, context } = req.body || {};
  const dev = store.devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  if (context) dev.context = context;
  saveStore();
  res.json({ ok: true });
});

app.post('/api/subscribe', (req, res) => {
  const { deviceId, subscription } = req.body || {};
  const dev = store.devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  if (!dev.subs) dev.subs = [];
  if (!dev.subs.find(s => s.endpoint === subscription.endpoint)) {
    dev.subs.push(subscription);
  }
  saveStore();
  res.json({ ok: true });
});

app.post('/api/heartbeat', (req, res) => {
  const { deviceId, context } = req.body || {};
  const dev = store.devices[deviceId];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  dev.lastSeen = new Date().toISOString();
  if (context) dev.context = context;
  saveStore();
  res.json({ ok: true });
});

app.get('/api/pending', (req, res) => {
  const { deviceId } = req.query;
  const list = (store.pending || []).filter(p => p.deviceId === deviceId && !p.delivered);
  res.json({ messages: list });
});

app.post('/api/pending/ack', (req, res) => {
  const { deviceId, ids } = req.body || {};
  if (Array.isArray(ids)) {
    for (const p of store.pending) {
      if (p.deviceId === deviceId && ids.includes(p.id)) p.delivered = true;
    }
    saveStore();
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`✅ 勋常驻在线后端已启动: http://localhost:${PORT}`);
  console.log(`   VAPID public key: ${vapidPublic.slice(0, 24)}...`);
  console.log(`   AI 模型: ${AI_ENDPOINT ? AI_MODEL : '离线模拟话术'}`);
});
