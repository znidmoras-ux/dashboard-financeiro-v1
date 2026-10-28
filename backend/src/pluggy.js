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

/** Busca e grava os dados de UM item, só se o status/executionStatus indicar que há dado pronto
 *  (evita bater em /transactions de um item em LOGIN_ERROR/OUTDATED, que é o que gerava os 403/410 em loop). */
async function fetchItemData(itemId, from, rules) {
  const item = await get(`/items/${itemId}`);
  if (item.status === 'LOGIN_ERROR') return { skipped: 'login inválido — reconectar no MeuPluggy' };
  if (item.status === 'OUTDATED') return { skipped: 'última execução falhou, será tentada de novo' };
  if (item.status === 'WAITING_USER_INPUT') return { skipped: 'precisa de MFA — reautorizar no MeuPluggy' };
  if (item.status !== 'UPDATED') return { skipped: `status ${item.status}, ainda sincronizando` };
  if (item.executionStatus === 'PARTIAL_SUCCESS' && item.statusDetail?.transactions?.isUpdated === false) {
    return { skipped: 'transações não atualizadas nesta rodada (partial_success)' };
  }
  const bank = item.connector?.name ?? 'Banco';
  const accounts = (await get(`/accounts?itemId=${itemId}`)).results ?? [];
  let inserted = 0, seen = 0;
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
  return { inserted, seen };
}

/** Marca como ocultas as transações removidas na origem (evento transactions/deleted do webhook). */
export async function deletePluggyTransactions(externalIds) {
  if (!externalIds?.length) return;
  await q(`update transactions set hidden=true where source='pluggy' and external_id = any($1)`, [externalIds]);
}

/** Sincroniza um item específico (onlyItemId, usado pelo webhook) ou todos os configurados.
 *  Cada item roda isolado: um item com erro não derruba a sincronização dos outros. */
export async function syncPluggy(onlyItemId) {
  if (!pluggyEnabled()) return { skipped: true };
  const rules = await loadRules();
  const last = (await q("select last_ok from sync_log where source='pluggy'")).rows[0]?.last_ok;
  const from = new Date(last ? new Date(last).getTime() - 7 * 864e5 : Date.now() - config.pluggy.initialDays * 864e5).toISOString().slice(0, 10);
  const targets = onlyItemId ? [onlyItemId] : config.pluggy.itemIds;
  let inserted = 0, seen = 0;
  const perItem = {};
  for (const itemId of targets) {
    try {
      const r = await fetchItemData(itemId, from, rules);
      perItem[itemId] = r.skipped ?? 'ok';
      inserted += r.inserted ?? 0;
      seen += r.seen ?? 0;
    } catch (e) {
      perItem[itemId] = `erro: ${e.message}`;
    }
  }
  return { seen, inserted, perItem };
}
