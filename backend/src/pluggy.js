// Cliente da API da Pluggy (https://docs.pluggy.ai). Chamadas só de saída; as chaves ficam no .env do servidor.
import { config } from './config.js';
import { q } from './db.js';
import { classify, loadRules } from './rules.js';

const BASE = 'https://api.pluggy.ai';
let cached = { key: '', exp: 0 };

async function apiKey() {
  if (cached.key && Date.now() < cached.exp) return cached.key;
  const { clientId, clientSecret } = config.pluggy;
  const r = await fetch(`${BASE}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
  if (!r.ok) throw new Error(`Pluggy auth falhou (${r.status})`);
  cached = { key: (await r.json()).apiKey, exp: Date.now() + 100 * 60 * 1000 };
  return cached.key;
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: { 'X-API-KEY': await apiKey() } });
  if (!r.ok) throw new Error(`Pluggy ${path} -> ${r.status}`);
  return r.json();
}

export const pluggyEnabled = () => Boolean(config.pluggy.clientId && config.pluggy.clientSecret && config.pluggy.itemIds.length);

/** Pluggy: DEBIT é saída. O sinal vem do tipo, para não depender da convenção de cada conta. */
export const signedAmount = (t) => (t.type === 'DEBIT' ? -Math.abs(t.amount) : Math.abs(t.amount));

export async function syncPluggy() {
  if (!pluggyEnabled()) return { skipped: true };
  const rules = await loadRules();
  const last = (await q("select last_ok from sync_log where source='pluggy'")).rows[0]?.last_ok;
  const from = new Date(last ? new Date(last).getTime() - 7 * 864e5 : Date.now() - config.pluggy.initialDays * 864e5).toISOString().slice(0, 10);
  let inserted = 0, seen = 0;
  for (const itemId of config.pluggy.itemIds) {
    const item = await get(`/items/${itemId}`);
    const bank = item.connector?.name ?? 'Banco';
    const accounts = (await get(`/accounts?itemId=${itemId}`)).results ?? [];
    for (const acc of accounts) {
      for (let page = 1, pages = 1; page <= pages; page++) {
        const res = await get(`/transactions?accountId=${acc.id}&from=${from}&pageSize=500&page=${page}`);
        pages = res.totalPages ?? 1;
        for (const t of res.results ?? []) {
          seen++;
          const amount = signedAmount(t);
          const desc = (t.description ?? t.descriptionRaw ?? '').trim() || 'Sem descrição';
          const r = await q(
            `insert into transactions (source, external_id, date, bank, description, amount, category)
             values ('pluggy',$1,$2,$3,$4,$5,$6)
             on conflict (source, external_id) do update set amount=excluded.amount, date=excluded.date,
               description=excluded.description, bank=excluded.bank
             returning (xmax = 0) as inserted`,
            [t.id, String(t.date).slice(0, 10), bank, desc, amount, classify(desc, amount, rules)]);
          if (r.rows[0].inserted) inserted++;
        }
      }
    }
  }
  return { seen, inserted };
}
