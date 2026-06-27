const { ethers } = require('ethers');
const fs = require('fs');

function parseEnv(p) {
  const o = {};
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^['\"]|['\"]$/g, '');
  }
  return o;
}

async function api(path, opts = {}) {
  const r = await fetch('https://api.overlayer.fi' + path, {
    headers: {'User-Agent': 'Mozilla/5.0','Accept':'application/json','Content-Type':'application/json',...(opts.headers||{})},
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}

async function tokenFor(wallet) {
  const addr = ethers.getAddress(wallet.address);
  const n = await api(`/api-s/auth/nonce/${addr}`);
  if (n.status !== 200 || !n.data?.success) throw new Error('nonce ' + n.status);
  const expiry = Math.floor(Date.now() / 1000) + 300;
  const msg = `Request Overlayer social session\n${addr}\n${expiry}\n${String(n.data.nonce).trim()}`;
  const sig = await wallet.signMessage(msg);
  const v = await api(`/api-s/auth/verify/${addr}`, { method: 'POST', body: { message: msg, signature: sig } });
  if (v.status !== 200 || !v.data?.success) throw new Error('verify ' + v.status);
  return v.data.token;
}

(async () => {
  const today = new Date();
  const ts = today.toISOString().split('T')[0]; // 2026-06-21
  
  for (const alias of ['evm-01', 'evm-02', 'evm-03']) {
    const e = parseEnv(`/root/.naya/accounts/credentials/${alias}.env`);
    const w = new ethers.Wallet(e.EVM_PRIVATE_KEY);
    const addr = ethers.getAddress(e.EVM_ADDRESS);
    
    console.log(`\n### [${alias}] ${addr}`);
    
    try {
      const token = await tokenFor(w);
      const headers = { Authorization: `Bearer ${token}` };
      
      const pts = await api(`/api-s/socials/onchain-tasks/points/${addr}`, { headers });
      console.log(`Points: ${pts.data?.totalPoints ?? 'N/A'}`);
      
      // Today
      console.log(`\nTasks for ${ts}:`);
      const tasks = await api(`/api-s/socials/onchain-tasks?address=${addr}&startDate=${ts}&endDate=${ts}`, { headers });
      if (tasks.data?.tasks && tasks.data.tasks.length > 0) {
        for (const t of tasks.data.tasks) {
          console.log(`  ${t.completed ? '✅' : '⬜'} ${t.type} ${t.product} amount=${t.amount} pts=${t.points}`);
        }
      } else {
        console.log(`  No tasks today / None returned`);
        // Show today's tasks from older dates
        for (let i = 1; i <= 7; i++) {
          const d = new Date(today); d.setDate(d.getDate() - i);
          const ds = d.toISOString().split('T')[0];
          const old = await api(`/api-s/socials/onchain-tasks?address=${addr}&startDate=${ds}&endDate=${ds}`, { headers });
          if (old.data?.tasks && old.data.tasks.length > 0) {
            console.log(`\n  ${ds}:`);
            for (const t of old.data.tasks) {
              console.log(`    ${t.completed ? '✅' : '⬜'} ${t.type} ${t.product} amount=${t.amount} pts=${t.points}`);
            }
            break;
          }
        }
      }
      
    } catch (e) {
      console.log(`  ERR: ${e.message}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
