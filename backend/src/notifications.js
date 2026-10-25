// Alertas proativos por WhatsApp: boleto/fatura vencendo, e gap de caixa nos próximos dias.
// Lê o mesmo blob de configurações que o painel salva (settings.value) — nenhuma tabela nova precisa existir
// para isso funcionar, já que bills/payouts/cardInvoices vivem dentro desse JSON (ver store.ts do frontend).
import { config } from './config.js';
import { q } from './db.js';

const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: config.timezone }); // 'sv-SE' => YYYY-MM-DD
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

async function getFinanceData() {
  const row = (await q("select value from settings where key='app'")).rows[0];
  const s = row?.value ?? {};
  return {
    bills: Array.isArray(s.bills) ? s.bills : [],
    payouts: Array.isArray(s.payouts) ? s.payouts : [],
    cardInvoices: Array.isArray(s.cardInvoices) ? s.cardInvoices : [],
  };
}

/** Monta o texto do alerta. Retorna null se não houver nada relevante a avisar. */
export function buildAlertMessage({ bills, payouts, cardInvoices }) {
  const today = todayStr(), soonLimit = addDays(today, config.whatsapp.dueSoonDays);
  const openBills = bills.filter((b) => b.status === 'aberto');
  const openInvoices = cardInvoices.filter((c) => c.status === 'aberta');
  const debts = [
    ...openBills.map((b) => ({ label: b.supplier || '(sem fornecedor)', amount: +b.amount || 0, dueDate: b.dueDate })),
    ...openInvoices.map((c) => ({ label: `Fatura ${c.bank || 'cartão'}`, amount: +c.total || 0, dueDate: c.dueDate })),
  ];
  const overdue = debts.filter((d) => d.dueDate < today);
  const soon = debts.filter((d) => d.dueDate >= today && d.dueDate <= soonLimit);
  const payoutsSoon = (payouts ?? []).filter((p) => p.date >= today && p.date <= soonLimit).reduce((a, p) => a + (+p.amount || 0), 0);
  const totalSoon = soon.reduce((a, d) => a + d.amount, 0);
  const gap = totalSoon - payoutsSoon;

  if (!overdue.length && !soon.length) return null; // nada a avisar hoje

  const lines = [`*Dashboard financeiro* — resumo de ${new Date(today + 'T12:00:00').toLocaleDateString('pt-BR')}`];
  if (overdue.length) {
    lines.push('', `⚠️ *${overdue.length} vencido(s)*, total ${brl(overdue.reduce((a, d) => a + d.amount, 0))}:`);
    for (const d of overdue) lines.push(`• ${d.label} — ${brl(d.amount)} (venceu ${new Date(d.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')})`);
  }
  if (soon.length) {
    lines.push('', `📅 *Vencendo nos próximos ${config.whatsapp.dueSoonDays} dias*, total ${brl(totalSoon)}:`);
    for (const d of soon) lines.push(`• ${d.label} — ${brl(d.amount)} (${new Date(d.dueDate + 'T12:00:00').toLocaleDateString('pt-BR')})`);
    lines.push('', `Repasses previstos no período: ${brl(payoutsSoon)}`);
    lines.push(gap > 0 ? `❌ Falta ${brl(gap)} pra cobrir.` : `✅ Cobre, sobra ${brl(-gap)}.`);
  }
  return lines.join('\n');
}

async function sendWhatsApp(to, message) {
  const { evolutionUrl, evolutionApiKey, evolutionInstance } = config.whatsapp;
  const res = await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evolutionApiKey },
    body: JSON.stringify({ number: to, text: message }),
  });
  if (!res.ok) throw new Error(`Evolution API respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Roda uma vez por dia (ver scheduleWhatsAppAlerts). Manda pra todos os números configurados. */
export async function runWhatsAppCheck() {
  if (!config.whatsapp.enabled) return;
  if (!config.whatsapp.evolutionUrl || !config.whatsapp.evolutionApiKey || !config.whatsapp.numbers.length) {
    console.warn('WHATSAPP_ENABLED=true mas falta EVOLUTION_API_URL/EVOLUTION_API_KEY/WHATSAPP_NUMBERS — alertas desativados até configurar.');
    return;
  }
  const message = buildAlertMessage(await getFinanceData());
  if (!message) { await markSent('sem pendências'); return; }
  let ok = 0, lastErr = '';
  for (const to of config.whatsapp.numbers) {
    try { await sendWhatsApp(to, message); ok++; }
    catch (e) { lastErr = e.message; console.error('Falha ao enviar WhatsApp para', to, e.message); }
  }
  await markSent(ok ? `enviado para ${ok}/${config.whatsapp.numbers.length}` : `falhou: ${lastErr}`);
}

const markSent = (message) => q(
  `insert into sync_log (source, last_run, last_ok, message) values ('whatsapp-alert', now(), now(), $1)
   on conflict (source) do update set last_run=now(), last_ok=now(), message=excluded.message`,
  [message],
);

/** Confere a cada 5 min se é a hora do alerta diário (fuso configurado) e se ainda não mandou hoje. */
export function scheduleWhatsAppAlerts() {
  if (!config.whatsapp.enabled) return;
  const check = async () => {
    const now = new Date();
    const hour = Number(now.toLocaleString('en-US', { timeZone: config.timezone, hour: '2-digit', hour12: false }));
    if (hour !== config.whatsapp.alertHour) return;
    const last = (await q("select last_ok from sync_log where source='whatsapp-alert'")).rows[0]?.last_ok;
    const lastDay = last ? new Date(last).toLocaleDateString('sv-SE', { timeZone: config.timezone }) : '';
    if (lastDay === todayStr()) return; // já mandou hoje
    await runWhatsAppCheck().catch((e) => console.error('Erro no alerta de WhatsApp:', e.message));
  };
  setInterval(() => check().catch(() => {}), 5 * 60 * 1000);
  check().catch(() => {}); // também confere uma vez ao subir, caso o horário já tenha passado hoje e falte pouco
}
