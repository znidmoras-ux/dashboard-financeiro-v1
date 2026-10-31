import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { migrate, pool, q } from './db.js';
import { applyRules, loadRules, seedRules } from './rules.js';
import { autoSales, reprocessOrders, saveOrder } from './orders.js';
import { deletePluggyTransactions, pluggyEnabled, syncPluggy } from './pluggy.js';
import { runWhatsAppCheck, scheduleWhatsAppAlerts } from './notifications.js';
import { askOllama, AssistantInputError, cleanContext, cleanConversation, ollamaStatus } from './assistant.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // 8mb: dá folga pra foto de nota/boleto comprimida em base64
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const hits = new Map();
const limited = (req, res, next) => {            // 120 chamadas por minuto por IP nos webhooks públicos
  const k = req.ip, now = Date.now(), w = (hits.get(k) ?? []).filter((t) => now - t < 60000);
  w.push(now); hits.set(k, w);
  return w.length > 120 ? res.status(429).json({ error: 'limite excedido' }) : next();
};
const tokenOk = (req, res, next) =>
  config.webhookToken && same(req.params.token ?? '', config.webhookToken) ? next() : res.status(404).end();

// ---------- webhooks (únicas rotas expostas na internet, via Tailscale Funnel) ----------
app.post('/webhooks/anotaai/:token', limited, tokenOk, wrap(async (req, res) => {
  const ev = (await q("insert into webhook_events (source, payload) values ('anotaai', $1) returning id", [JSON.stringify(req.body)])).rows[0];
  try { await saveOrder(req.body); await q('update webhook_events set processed=true where id=$1', [ev.id]); }
  catch (e) { await q('update webhook_events set error=$2 where id=$1', [ev.id, e.message]); console.warn('Pedido não processado:', e.message); }
  res.json({ ok: true });   // sempre 200: o payload bruto já está salvo e pode ser reprocessado
}));
app.post('/webhooks/pluggy/:token', limited, tokenOk, wrap(async (req, res) => {
  res.json({ ok: true });   // responde primeiro, processa depois
  const { event, itemId, transactionIds } = req.body ?? {};
  if (event === 'transactions/deleted' && Array.isArray(transactionIds)) {
    await deletePluggyTransactions(transactionIds).catch((e) => console.error('Pluggy delete:', e.message));
    return;
  }
  if (['item/created', 'item/updated', 'item/login_succeeded'].includes(event) && itemId) {
    runPluggy(itemId).catch(() => {});   // ressincroniza só o item que mudou, não tudo
    return;
  }
  if (event) console.log('Pluggy webhook (sem ação automática):', event, itemId ?? '');
}));

// ---------- API do painel (acessível só pela rede Tailscale, atrás de senha no nginx) ----------
const tx = (r) => ({ id: Number(r.id), date: r.date, bank: r.bank ?? '', desc: r.description, value: r.amount, cat: r.category, source: r.source });

app.get('/api/bootstrap', wrap(async (_req, res) => {
  const settings = (await q("select value from settings where key='app'")).rows[0]?.value ?? null;
  const txs = (await q('select * from transactions where not hidden order by date desc, id desc limit 5000')).rows.map(tx);
  const sync = Object.fromEntries((await q('select * from sync_log')).rows.map((r) => [r.source, { lastRun: r.last_run, lastOk: r.last_ok, message: r.message }]));
  const lastOrder = (await q('select max(placed_at) m, count(*)::int n from orders')).rows[0];
  res.json({ settings, transactions: txs, auto: await autoSales(), status: { sync, pluggy: pluggyEnabled(), lastOrderAt: lastOrder.m, orders: lastOrder.n } });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.fixed) || !Array.isArray(b.pay) || !Array.isArray(b.sales) || typeof b.cfg !== 'object') return res.status(400).json({ error: 'formato inválido' });
  // O painel do computador manda o bloco inteiro de settings a cada save, com o que tinha em memória
  // no momento em que a página carregou. Se nesse meio tempo um boleto foi lançado pelo celular
  // (POST /api/bills, direto no banco), um save do painel que não sabe disso o apagaria sem querer.
  // Proteção: um boleto com origem 'celular' lançado nos últimos 10 minutos e ausente do payload
  // é mantido — o bastante pra cobrir a janela de corrida sem travar uma exclusão manual normal.
  const current = (await q("select value from settings where key='app'")).rows[0]?.value;
  if (current?.bills?.length) {
    const incomingIds = new Set((b.bills ?? []).map((x) => x.id));
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const keep = current.bills.filter((x) => x.source === 'celular' && !incomingIds.has(x.id) && new Date(x.createdAt ?? 0).getTime() > tenMinAgo);
    if (keep.length) b.bills = [...(b.bills ?? []), ...keep];
  }
  await q("insert into settings (key, value) values ('app', $1) on conflict (key) do update set value=excluded.value, updated_at=now()", [JSON.stringify(b)]);
  res.json({ ok: true, bills: b.bills });
}));

app.post('/api/transactions', wrap(async (req, res) => {
  const b = req.body ?? {};
  const r = await q(`insert into transactions (source, date, bank, description, amount, category, category_manual)
    values ('manual', $1, $2, $3, $4, $5, true) returning *`, [b.date, b.bank ?? 'Manual', b.desc ?? 'Novo lançamento', Number(b.value) || 0, b.cat ?? 'Outros']);
  res.json(tx(r.rows[0]));
}));

app.patch('/api/transactions/:id', wrap(async (req, res) => {
  const b = req.body ?? {}, sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.date) add('date', b.date);
  if (b.bank != null) add('bank', b.bank);
  if (b.desc != null) add('description', b.desc);
  if (b.value != null) add('amount', Number(b.value) || 0);
  if (b.cat != null) { add('category', b.cat); sets.push('category_manual=true'); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await q(`update transactions set ${sets.join(', ')} where id=$${vals.length}`, vals);
  res.json({ ok: true });
}));

app.delete('/api/transactions/:id', wrap(async (req, res) => {   // lançamentos do banco são ocultados, para não voltarem no próximo sync
  await q("update transactions set hidden=true where id=$1 and source <> 'manual'", [req.params.id]);
  await q("delete from transactions where id=$1 and source = 'manual'", [req.params.id]);
  res.json({ ok: true });
}));

// ---------- fotos anexadas (nota de compra, boleto — lançamento rápido pelo celular) ----------
// Guardadas no próprio Postgres (não em disco): entram de graça no backup diário que já existe,
// e não dependem de volume compartilhado entre os containers.
const PHOTO_RE = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=]+)$/;
app.post('/api/attachments', wrap(async (req, res) => {
  const m = PHOTO_RE.exec(req.body?.dataUrl ?? '');
  if (!m) return res.status(400).json({ error: 'envie { dataUrl } com uma imagem jpeg/png/webp em base64' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'imagem grande demais (máx. 6MB)' });
  const r = await q('insert into attachments (mime, data) values ($1,$2) returning id', [m[1], buf]);
  res.json({ id: Number(r.rows[0].id) });
}));
app.get('/api/attachments/:id', wrap(async (req, res) => {
  const r = (await q('select mime, data from attachments where id=$1', [req.params.id])).rows[0];
  if (!r) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable').type(r.mime).send(r.data);
}));

// ---------- notas de insumos ----------
const sup = (r) => ({ id: Number(r.id), date: r.date, invoice: r.invoice, supplier: r.supplier, product: r.product, brand: r.brand, unit: r.unit, quantity: r.quantity, price: r.unit_price, photoId: r.photo_id ? Number(r.photo_id) : null });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cleanSupply = (b) => ({
  date: DATE.test(b.date ?? '') ? b.date : new Date().toISOString().slice(0, 10),
  invoice: String(b.invoice ?? '').slice(0, 60), supplier: String(b.supplier ?? '').slice(0, 120), product: String(b.product ?? '').slice(0, 160),
  brand: String(b.brand ?? '').slice(0, 80), unit: String(b.unit ?? 'un').slice(0, 12) || 'un',
  quantity: Number(b.quantity) || 0, price: Number(b.price) || 0,
  photoId: Number.isFinite(Number(b.photoId)) && b.photoId ? Number(b.photoId) : null,
});
const insertSupply = (s) => q(`insert into supplies (date, invoice, supplier, product, brand, unit, quantity, unit_price, photo_id)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [s.date, s.invoice, s.supplier, s.product, s.brand, s.unit, s.quantity, s.price, s.photoId]);

app.get('/api/supplies', wrap(async (_req, res) => res.json((await q('select * from supplies order by date desc, id desc limit 50000')).rows.map(sup))));
app.post('/api/supplies', wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 2000) : [req.body ?? {}];
  const out = [];
  for (const it of items) out.push(sup((await insertSupply(cleanSupply(it))).rows[0]));
  res.json(Array.isArray(req.body?.items) ? out : out[0]);
}));
app.patch('/api/supplies/:id', wrap(async (req, res) => {
  const b = req.body ?? {}, sets = [], vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (b.date && DATE.test(b.date)) add('date', b.date);
  for (const k of ['invoice', 'supplier', 'product', 'brand', 'unit']) if (b[k] != null) add(k, String(b[k]));
  if (b.quantity != null) add('quantity', Number(b.quantity) || 0);
  if (b.price != null) add('unit_price', Number(b.price) || 0);
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await q(`update supplies set ${sets.join(', ')} where id=$${vals.length}`, vals);
  res.json({ ok: true });
}));
app.delete('/api/supplies/:id', wrap(async (req, res) => { await q('delete from supplies where id=$1', [req.params.id]); res.json({ ok: true }); }));

// ---------- lançamento rápido de boleto pelo celular ----------
// Os boletos vivem dentro do blob settings.app (não numa tabela própria — mexer nisso é um
// refactor maior, fora do escopo de hoje). Por isso o append é feito com jsonb_set numa única
// UPDATE, atômica no Postgres: não precisa ler-modificar-escrever em duas viagens, então não
// corre risco de perder um boleto lançado ao mesmo tempo por outra aba/sessão.
app.post('/api/bills', wrap(async (req, res) => {
  const b = req.body ?? {};
  if (!(Number(b.amount) > 0)) return res.status(400).json({ error: 'amount é obrigatório' });
  const bill = {
    id: Date.now(),
    supplier: String(b.supplier ?? '').slice(0, 120),
    amount: Number(b.amount),
    dueDate: DATE.test(b.dueDate ?? '') ? b.dueDate : new Date().toISOString().slice(0, 10),
    status: 'aberto',
    paidBy: '',
    note: String(b.note ?? '').slice(0, 300),
    photoId: Number.isFinite(Number(b.photoId)) && b.photoId ? Number(b.photoId) : null,
    source: 'celular',
    createdAt: new Date().toISOString(),
  };
  await q(`update settings set value = jsonb_set(coalesce(value,'{}'::jsonb), '{bills}',
    coalesce(value->'bills','[]'::jsonb) || $1::jsonb), updated_at = now() where key='app'`, [JSON.stringify([bill])]);
  res.json(bill);
}));

app.get('/api/rules', wrap(async (_req, res) => res.json(await loadRules())));
app.post('/api/rules', wrap(async (req, res) => {
  const { pattern, category } = req.body ?? {};
  if (!pattern || !category) return res.status(400).json({ error: 'pattern e category são obrigatórios' });
  await q('insert into rules (pattern, category, position) values ($1,$2,5)', [pattern, category]);
  res.json({ changed: await applyRules() });
}));
app.delete('/api/rules/:id', wrap(async (req, res) => { await q('delete from rules where id=$1', [req.params.id]); res.json({ ok: true }); }));
app.post('/api/rules/apply', wrap(async (_req, res) => res.json({ changed: await applyRules() })));
app.post('/api/orders/reprocess', wrap(async (_req, res) => res.json(await reprocessOrders())));
app.post('/api/sync/pluggy', wrap(async (_req, res) => res.json(await runPluggy())));
app.post('/api/whatsapp/test', wrap(async (_req, res) => {
  if (!config.whatsapp.enabled) return res.status(400).json({ error: 'WHATSAPP_ENABLED não está ligado no .env' });
  await runWhatsAppCheck();
  res.json({ ok: true });
}));
app.get('/api/assistant/status', async (_req, res) => {
  res.json(await ollamaStatus({
    enabled: config.assistant.enabled,
    url: config.assistant.ollamaUrl,
    model: config.assistant.model,
  }));
});
app.post('/api/assistant/chat', async (req, res) => {
  if (!config.assistant.enabled) return res.status(503).json({ error: 'Assistente desativado. Habilite ASSISTANT_ENABLED no .env do servidor.' });
  let messages, context;
  try {
    messages = cleanConversation(req.body?.messages);
    context = cleanContext(req.body?.context);
  } catch (error) {
    if (error instanceof AssistantInputError) return res.status(400).json({ error: error.message });
    throw error;
  }
  try {
    res.json({ reply: await askOllama({
      messages,
      context,
      url: config.assistant.ollamaUrl,
      model: config.assistant.model,
    }) });
  } catch (error) {
    console.error('Assistente local indisponível:', error.message);
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    res.status(timeout ? 504 : 503).json({
      error: timeout
        ? 'O modelo demorou demais para responder. Tente novamente em alguns instantes.'
        : 'Não foi possível consultar o modelo local. Confira se o Ollama está ativo e se o modelo foi baixado.',
    });
  }
});
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------- tarefas ----------
async function runPluggy(onlyItemId) {
  try {
    const r = await syncPluggy(onlyItemId);
    if (!r.skipped) { await applyRules(); await q(`insert into sync_log (source,last_run,last_ok,message) values ('pluggy',now(),now(),$1)
      on conflict (source) do update set last_run=now(), last_ok=now(), message=$1`, [`${r.inserted} novos de ${r.seen}${r.billsPaid ? ` · ${r.billsPaid} boleto(s) baixado(s) automaticamente` : ''} · ${JSON.stringify(r.perItem)}`]); }
    return r;
  } catch (e) {
    console.error('Sync Pluggy:', e.message);
    await q(`insert into sync_log (source,last_run,message) values ('pluggy',now(),$1) on conflict (source) do update set last_run=now(), message=$1`, [e.message]);
    return { error: e.message };
  }
}

async function seed() {
  await seedRules();
  if (!(await q("select 1 from settings where key='app'")).rowCount)
    await q("insert into settings (key, value) values ('app', $1)", [readFileSync(new URL('../seed/settings.json', import.meta.url), 'utf8')]);
  if (config.seedInitial && !(await q('select 1 from transactions limit 1')).rowCount) {
    const rows = JSON.parse(readFileSync(new URL('../seed/transactions.json', import.meta.url), 'utf8'));
    for (const t of rows) await q("insert into transactions (source, date, bank, description, amount, category, category_manual) values ('extrato-inicial',$1,$2,$3,$4,$5,false)", [t.date, t.bank, t.description, t.amount, t.category]);
    console.log(`Extrato inicial importado: ${rows.length} lançamentos`);
  }
}

export async function start() {
  for (let i = 1; ; i++) {          // espera o Postgres subir
    try { await migrate(); break; } catch (e) { if (i >= 30) throw e; console.log('Aguardando banco...', e.code ?? e.message); await new Promise((r) => setTimeout(r, 2000)); }
  }
  await seed();
  if (!config.webhookToken) console.warn('WEBHOOK_TOKEN vazio: os webhooks ficam desativados.');
  if (pluggyEnabled()) { runPluggy(); setInterval(runPluggy, config.pluggy.syncMinutes * 60 * 1000); } else console.log('Pluggy desativada (chaves ou itens ausentes).');
  if (config.whatsapp.enabled) { scheduleWhatsAppAlerts(); console.log(`Alertas de WhatsApp ativos (resumo diário às ${config.whatsapp.alertHour}h).`); } else console.log('Alertas de WhatsApp desativados (WHATSAPP_ENABLED).');
  const server = app.listen(config.port, () => console.log(`API na porta ${config.port}`));
  process.on('SIGTERM', () => server.close(() => pool.end()));
  return server;
}
export { app };
if (import.meta.url === `file://${process.argv[1]}`) start();
