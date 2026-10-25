// Gera um relatório em PDF com a saúde financeira do negócio, a partir dos dados já carregados no Store.
// Usa jsPDF + jspdf-autotable — tudo roda no navegador, não depende do backend.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Store, monthLabel } from './store';

const brl = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const dmy = (iso: string) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

const INK = '#1a2420', MUTE = '#6b7a72', LINE = '#dbe4de', GREEN = '#1b7f57', RED = '#c23b3b', AMBER = '#b8790b';

export function buildFinancialReportPdf(s: Store) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 0;

  const m = s.metrics();
  const bs = s.billStats();
  const genAt = new Date();
  const todayIso = s.today.toISOString().slice(0, 10);

  // ---------- cabeçalho ----------
  doc.setFillColor(GREEN);
  doc.rect(0, 0, pageW, 86, 'F');
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('Relatório de Saúde Financeira', margin, 38);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
  doc.text(`Dashboard Executivo · competência ${monthLabel(s.month())}`, margin, 56);
  doc.text(`Gerado em ${genAt.toLocaleDateString('pt-BR')} às ${genAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, margin, 72);
  y = 112;

  const h2 = (title: string, icon?: string) => {
    if (y > 740) { doc.addPage(); y = 50; }
    doc.setTextColor(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5);
    doc.text(title, margin, y);
    doc.setDrawColor(LINE); doc.setLineWidth(1); doc.line(margin, y + 6, pageW - margin, y + 6);
    y += 22;
  };
  const kv = (label: string, value: string, tone: 'ok' | 'bad' | 'warn' | 'plain' = 'plain') => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(MUTE);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.setTextColor(tone === 'ok' ? GREEN : tone === 'bad' ? RED : tone === 'warn' ? AMBER : INK);
    doc.text(value, pageW - margin, y, { align: 'right' });
    y += 16;
  };
  const after = (gap = 18) => { y += gap; };
  const table = (head: string[], rows: (string | number)[][], opts?: { headColor?: string }) => {
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin }, head: [head], body: rows,
      styles: { font: 'helvetica', fontSize: 9, textColor: INK, lineColor: LINE, lineWidth: 0.5, cellPadding: 5 },
      headStyles: { fillColor: opts?.headColor ?? GREEN, textColor: '#ffffff', fontStyle: 'bold' },
      alternateRowStyles: { fillColor: '#f4f8f6' },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  };

  // ---------- resumo executivo ----------
  h2('Resumo executivo');
  kv('Vendas líquidas', brl(m.net));
  kv('Custo da mercadoria vendida (CMV)', `${brl(m.cmv)}  (${pct(m.s.cmvPct)})`);
  kv('Custos fixos + folha ativa + parcelas de cartão', brl(m.costs));
  kv('Lucro líquido real', brl(m.profit), m.profit >= 0 ? 'ok' : 'bad');
  kv('Margem líquida', pct(m.margin), m.margin >= 0 ? 'ok' : 'bad');
  kv('Ponto de equilíbrio (faturamento mínimo)', brl(m.breakeven));
  kv('Progresso até o ponto de equilíbrio', pct(m.progressRaw), m.progressRaw >= 100 ? 'ok' : 'warn');
  kv('Projeção de fechamento do mês', brl(m.projected));
  kv('Lucro projetado no fechamento', brl(m.projectedProfit), m.projectedProfit >= 0 ? 'ok' : 'bad');
  if (m.d.remaining > 0 && m.missing > 0) kv('Necessário vender por dia (dias restantes)', brl(m.needPerDay), 'warn');
  after();

  // ---------- leitura do mês ----------
  if (s.insights().length) {
    h2('Leitura do mês');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    for (const i of s.insights()) {
      if (y > 760) { doc.addPage(); y = 50; }
      doc.setTextColor(i.tone === 'bad' ? RED : i.tone === 'warn' ? AMBER : i.tone === 'good' ? GREEN : INK);
      const lines = doc.splitTextToSize('• ' + i.text, pageW - margin * 2 - 4);
      doc.text(lines, margin, y);
      y += lines.length * 13 + 4;
    }
    after(10);
  }

  // ---------- vendas por canal ----------
  if (m.s.channels.length) {
    h2('Vendas por canal');
    table(['Canal', 'Líquido'], m.s.channels.map(c => [c.name, brl(c.net)]));
  }

  // ---------- custos fixos e folha ----------
  h2('Custos fixos e folha de pagamento');
  table(['Item', 'Categoria', 'Valor'], s.fixed().map(f => [f.name, f.cat, brl(f.value)]));
  const payRows = s.pay().map(p => [p.name, p.role, brl(p.value), p.receiving ? 'Recebendo' : 'Não recebe (acumulando)']);
  table(['Pessoa', 'Função', 'Valor', 'Situação'], payRows);
  kv('Total recebendo de fato (sai do caixa)', brl(s.payActiveTotal()), 'ok');
  kv('Total comprometido e não pago (acumulando)', brl(s.payDeferredTotal()), s.payDeferredTotal() > 0 ? 'warn' : 'plain');
  after();

  // ---------- cartões de crédito ----------
  if (s.cardInvoices().length || s.cardInstallments().length) {
    h2('Cartões de crédito');
    if (s.cardInvoices().length) {
      table(['Banco', 'Fatura', 'Pagamento mínimo', 'Vencimento', 'Status'],
        s.cardInvoices().map(c => [c.bank, brl(c.total), brl(c.minPayment), dmy(c.dueDate), c.status === 'paga' ? 'Paga' : 'Em aberto']));
    }
    if (s.cardInstallments().length) {
      table(['Cartão', 'Fornecedor', 'Descrição', 'Parcela', 'Valor da parcela'],
        s.cardInstallments().map(c => [c.cardBank, c.supplier || '—', c.description, `${Math.min(c.current, c.total)}/${c.total}`, brl(c.amount)]));
    }
    kv('Soma das parcelas em aberto no mês', brl(s.cardMonthly()));
    after();
  }

  // ---------- contas a pagar ----------
  h2('Contas a pagar');
  kv('Total em aberto (boletos + faturas)', brl(bs.totalOpen));
  kv('Vencido', brl(bs.totalOverdue), bs.totalOverdue > 0 ? 'bad' : 'ok');
  kv('Vence nos próximos 7 dias', brl(bs.totalSoon), 'warn');
  kv('Repasses previstos nos próximos 7 dias', brl(bs.payoutsSoon));
  kv('Saldo da semana (repasses − contas a vencer)', brl(bs.gap), bs.gap >= 0 ? 'ok' : 'bad');
  after(6);
  if (bs.open.length) {
    table(['Fornecedor / fatura', 'Valor', 'Vencimento', 'Situação'],
      bs.open.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(b => [b.label, brl(b.amount), dmy(b.dueDate), b.dueDate < todayIso ? 'Vencido' : 'Em aberto']));
  }

  // ---------- fornecedores ----------
  if (s.suppliers().length) {
    h2('Fornecedores cadastrados');
    table(['Fornecedor', 'Prazo de pagamento', 'Observação'],
      s.suppliers().map(su => [su.name || '—', su.termDays > 0 ? `${su.termDays} dias` : '—', su.note || '—']));
  }

  // ---------- repasses previstos ----------
  if (s.payouts().length) {
    h2('Repasses previstos');
    table(['Data', 'Valor', 'Observação'],
      [...s.payouts()].sort((a, b) => a.date.localeCompare(b.date)).map(p => [dmy(p.date), brl(p.amount), p.note || '—']));
  }

  // ---------- histórico recente ----------
  if (s.changelog().length) {
    h2('Histórico recente de atualizações');
    table(['Data', 'Área', 'Descrição'], s.changelog().slice(0, 12).map(c => [dmy(c.date), c.area, c.description]));
  }

  // ---------- rodapé ----------
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(MUTE);
    doc.text(`Dashboard Executivo — relatório gerado automaticamente`, margin, 822);
    doc.text(`Página ${p} de ${pageCount}`, pageW - margin, 822, { align: 'right' });
  }

  const fname = `relatorio-financeiro-${s.month()}-${genAt.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
