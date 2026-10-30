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
  const insertedDebits = []; // saídas novas, para tentar dar baixa automática em boletos cadastrados
  for (const acc of accounts) {
    // GET /transactions (paginado por page) está deprecated — a MeuPluggy já devolve 410 Gone nele.
    // GET /v2/transactions pagina por cursor: "next" vem pronto como query string, ou null no fim.
    let next = `/v2/transactions?accountId=${acc.id}&dateFrom=${from}`;
    while (next) {
      const res = await get(next);
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
          [t.id, String(t.date).slice(0, 10), bank, desc, amount, classify(desc, amount, rules, t.category)]);
        if (r.rows[0].inserted) {
          inserted++;
          if (amount < 0) insertedDebits.push({ date: String(t.date).slice(0, 10), amount: Math.abs(amount) });
        }
      }
      next = res.next ? `/v2/transactions${res.next}` : null;
    }
  }
  return { inserted, seen, insertedDebits };
}

/** Tenta dar baixa automática em boletos cadastrados (settings.bills, status 'aberto') quando uma
 *  saída nova do extrato bate em valor (±1 centavo) e cai numa janela razoável ao redor do vencimento
 *  (5 dias antes a 15 dias depois). Só baixa quando há exatamente UM boleto e UMA saída candidatos,
 *  para não arriscar baixa errada em caso de ambiguidade — fica manual nesse caso, como já era. */
async function matchBillsToPayments(debits) {
  if (!debits.length) return 0;
  const row = (await q("select value from settings where key='app'")).rows[0];
  if (!row?.value?.bills?.length) return 0;
  const settings = row.value;
  const used = new Set();
  let changed = 0;
  for (const bill of settings.bills) {
    if (bill.status !== 'aberto' || !bill.dueDate) continue;
    const due = new Date(bill.dueDate);
    const candidates = debits
      .map((d, i) => ({ ...d, i }))
      .filter((d) => !used.has(d.i) && Math.abs(d.amount - Number(bill.amount)) < 0.01)
      .filter((d) => { const diff = (new Date(d.date) - due) / 864e5; return diff >= -5 && diff <= 15; });
    if (candidates.length === 1) {
      used.add(candidates[0].i);
      bill.status = 'pago';
      bill.paidBy = bill.paidBy || 'Pluggy (baixa automática)';
      bill.note = `${bill.note ? bill.note + ' — ' : ''}baixa automática via extrato em ${candidates[0].date}`.trim();
      changed++;
    }
  }
  if (changed) await q("update settings set value=$1, updated_at=now() where key='app'", [JSON.stringify(settings)]);
  return changed;
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
  const allDebits = [];
  for (const itemId of targets) {
    try {
      const r = await fetchItemData(itemId, from, rules);
      perItem[itemId] = r.skipped ?? 'ok';
      inserted += r.inserted ?? 0;
      seen += r.seen ?? 0;
      if (r.insertedDebits?.length) allDebits.push(...r.insertedDebits);
    } catch (e) {
      perItem[itemId] = `erro: ${e.message}`;
    }
  }
  let billsPaid = 0;
  try {
    billsPaid = await matchBillsToPayments(allDebits);
  } catch (e) {
    console.error('Baixa automática de boletos:', e.message);
  }
  return { seen, inserted, perItem, billsPaid };
}
