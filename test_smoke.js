'use strict';
const BASE = 'http://localhost:3010';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  // 1) register
  const reg = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        persona: { name: '勋', background: '东北人', style: '东北口音' },
        learnedProfile: { topics: ['健身', '考研'], keywords: ['猫', '咖啡'] },
        recent: [{ role: 'user', content: '今天好累' }, { role: 'ai', content: '歇会儿' }]
      }
    })
  }).then(r => r.json());
  console.log('register ->', JSON.stringify(reg));
  const deviceId = reg.deviceId;

  // 2) heartbeat
  await fetch(BASE + '/api/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId })
  });

  // 3) 等待调度器（60s 周期）生成主动消息
  let got = null;
  for (let i = 0; i < 12; i++) {
    await sleep(8000);
    const pend = await fetch(BASE + '/api/pending?deviceId=' + deviceId).then(r => r.json());
    if (pend.messages && pend.messages.length) { got = pend.messages; break; }
    console.log('  waiting... (' + (i + 1) + ' tries)');
  }
  if (!got) { console.log('❌ 未在预期时间内收到主动消息'); process.exit(1); }
  console.log('pending ->', JSON.stringify(got, null, 2));

  // 4) ack
  const ack = await fetch(BASE + '/api/pending/ack', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, ids: got.map(m => m.id) })
  }).then(r => r.json());
  console.log('ack ->', JSON.stringify(ack));

  // 5) 再次拉取应为空
  const pend2 = await fetch(BASE + '/api/pending?deviceId=' + deviceId).then(r => r.json());
  console.log('pending after ack ->', JSON.stringify(pend2));
  if (pend2.messages.length !== 0) { console.log('❌ ack 后仍有未读'); process.exit(1); }

  // 6) subscribe 存储
  const sub = await fetch(BASE + '/api/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, subscription: { endpoint: 'https://example.com/sub/1', keys: {} } })
  }).then(r => r.json());
  console.log('subscribe ->', JSON.stringify(sub));

  console.log('\n✅ 集成测试通过');
  process.exit(0);
}
main().catch(e => { console.error('测试异常:', e); process.exit(1); });
