import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ColumnsChart, DonutChart, brl } from './charts';
import { Bill, CardInstallment, CardInvoice, Cfg, CATS, FIXED_CATS, OWN, PALETTE, Payout, Store, Supplier, Supply, Tx, monthLabel, shortMonth } from './store';
import { buildFinancialReportPdf } from './report';

type Tab = 'geral' | 'vendas' | 'custos' | 'insumos' | 'extrato' | 'projecoes' | 'relatorios' | 'logs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ColumnsChart, DonutChart],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  s = inject(Store);
  brl = brl; CATS = CATS; FIXED_CATS = FIXED_CATS; PALETTE = PALETTE; OWN = OWN; monthLabel = monthLabel; shortMonth = shortMonth;
  Math = Math;
  tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'geral', label: 'Visão geral', icon: 'dashboard' },
    { id: 'vendas', label: 'Vendas', icon: 'point_of_sale' },
    { id: 'custos', label: 'Custos e pagamentos', icon: 'receipt_long' },
    { id: 'insumos', label: 'Notas de insumos', icon: 'inventory_2' },
    { id: 'extrato', label: 'Extrato', icon: 'account_balance_wallet' },
    { id: 'projecoes', label: 'Projeções', icon: 'insights' },
    { id: 'relatorios', label: 'Relatórios', icon: 'summarize' },
    { id: 'logs', label: 'Atualizações', icon: 'history' },
  ];
  tab = signal<Tab>(this.readHash());
  confirmReset = signal(false);
  newMonth = '';
  generatingReport = signal(false);

  private readHash(): Tab {
    try { const h = location.hash.slice(1) as Tab; if (['geral', 'vendas', 'custos', 'insumos', 'extrato', 'projecoes', 'relatorios', 'logs'].includes(h)) return h; } catch { /* */ }
    return 'geral';
  }

  /** Gera e baixa o relatório completo em PDF (disponível no cabeçalho em qualquer aba, e com mais detalhe na aba Relatórios). */
  async gerarRelatorio() {
    if (this.generatingReport()) return;
    this.generatingReport.set(true);
    try {
      // dá um instante pro ícone de "gerando" aparecer antes do trabalho síncrono da montagem do PDF
      await new Promise(r => setTimeout(r, 30));
      buildFinancialReportPdf(this.s);
    } finally {
      this.generatingReport.set(false);
    }
  }
  go(t: Tab) { this.tab.set(t); try { history.replaceState(null, '', '#' + t); } catch { /* */ } }
  num(v: unknown) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; }
  pct(v: number, d = 1) { return v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%'; }
  n1(v: number) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  setTheme() {
    const o = { auto: 'dark', dark: 'light', light: 'auto' } as const; const t = o[this.s.theme()]; this.s.theme.set(t);
  }
  themeIcon = computed(() => ({ auto: 'brightness_auto', dark: 'dark_mode', light: 'light_mode' }[this.s.theme()]));
  doReset() { if (this.confirmReset()) { this.s.resetAll(); this.confirmReset.set(false); } else { this.confirmReset.set(true); setTimeout(() => this.confirmReset.set(false), 4000); } }

  // ---- visão geral ----
  channelItems = computed(() => this.s.metrics().s.channels.map(c => ({ k: c.name, v: +c.net || 0 })).filter(c => c.v > 0));
  trendLabels = computed(() => this.s.trend().map(t => shortMonth(t.m)));
  trendSeries = computed(() => [
    { name: 'Vendas líquidas', color: PALETTE[1], values: this.s.trend().map(t => t.net) },
    { name: 'Lucro real', color: PALETTE[0], values: this.s.trend().map(t => t.profit), colors: this.s.trend().map(t => t.profit < 0 ? '#d12f2f' : PALETTE[0]) },
  ]);
  bankSeries = computed(() => [
    { name: 'Entradas', color: PALETTE[0], values: this.s.trend().map(t => t.inflow) },
    { name: 'Saídas', color: PALETTE[2], values: this.s.trend().map(t => -t.out) },
  ]);
  dailyLabels = computed(() => Array.from({ length: this.s.metrics().d.total }, (_, i) => String(i + 1)));
  dailySeries = computed(() => {
    const m = this.s.month(), l = this.s.led();
    return [{ name: 'Entradas do dia', color: PALETTE[1], values: this.dailyLabels().map((_, i) => l.daily.get(`${m}-${String(i + 1).padStart(2, '0')}`) ?? 0) }];
  });
  wdLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  wdSeries = computed(() => [{ name: 'Entradas', color: PALETTE[4], values: this.s.led().wd }]);
  maxOf(l: { v: number }[]) { return Math.max(1, ...l.map(x => x.v)); }

  // ---- contas a pagar ----
  today0 = this.s.today.toISOString().slice(0, 10);
  billTone(b: Bill) { return b.status === 'pago' ? 'ok' : b.dueDate < this.today0 ? 'bad' : b.dueDate <= this.in7() ? 'warn' : 'info'; }
  billLabel(b: Bill) { return b.status === 'pago' ? 'Pago' : b.dueDate < this.today0 ? 'Vencido' : b.dueDate === this.today0 ? 'Vence hoje' : b.dueDate <= this.in7() ? 'Vence em breve' : 'A vencer'; }
  in7() { return new Date(this.s.today.getTime() + 7 * 864e5).toISOString().slice(0, 10); }
  togglePaid(b: Bill) { this.s.upd(this.s.bills, b.id, { status: b.status === 'pago' ? 'aberto' : 'pago' }); }
  invoiceTone(c: CardInvoice) { return c.status === 'paga' ? 'ok' : c.dueDate < this.today0 ? 'bad' : c.dueDate <= this.in7() ? 'warn' : 'info'; }
  invoiceLabel(c: CardInvoice) { return c.status === 'paga' ? 'Paga' : c.dueDate < this.today0 ? 'Em atraso' : 'Em aberto'; }
  toggleInvoicePaid(c: CardInvoice) { this.s.upd(this.s.cardInvoices, c.id, { status: c.status === 'paga' ? 'aberta' : 'paga' }); }
  installmentDone(c: CardInstallment) { return c.current > c.total; }
  installmentLeft(c: CardInstallment) { return Math.max(0, c.total - c.current + 1); }
  cardInvoicesOpenTotal = computed(() => this.s.cardInvoices().filter(c => c.status === 'aberta').reduce((a, c) => a + (+c.total || 0), 0));

  // ---- fornecedores ----
  newBillSupplierId = signal<number | null>(null);
  newBillOrderDate = signal(this.today0);
  newBillAmount = signal(0);
  newBillNote = signal('');
  supplierDue = computed(() => {
    const sup = this.s.suppliers().find(x => x.id === this.newBillSupplierId());
    if (!sup) return '';
    const d = new Date(this.newBillOrderDate() + 'T12:00:00'); d.setDate(d.getDate() + (+sup.termDays || 0));
    return d.toISOString().slice(0, 10);
  });
  genBillFromSupplier() {
    const id = this.newBillSupplierId();
    if (!id) return;
    this.s.addBillFromSupplier(id, this.newBillOrderDate(), this.newBillAmount(), this.newBillNote());
    this.newBillSupplierId.set(null); this.newBillAmount.set(0); this.newBillNote.set(''); this.newBillOrderDate.set(this.today0);
  }

  // ---- custos ----
  costItems = computed(() => this.s.fixedByCat());
  planned = computed(() => this.s.fixedTotal() + this.s.payActiveTotal());
  payTone(p: { receiving: boolean }) { return p.receiving ? 'ok' : 'bad'; }
  togglePayReceiving(p: { id: number; receiving: boolean }) { this.s.upd(this.s.pay, p.id, { receiving: !p.receiving }); }

  // ---- extrato ----
  q = signal(''); nat = signal<'all' | 'in' | 'out'>('all'); catF = signal('all'); scope = signal<'month' | 'all'>('month'); page = signal(0); PS = 25;
  rows = computed(() => {
    const q = this.q().trim().toLowerCase(), n = this.nat(), c = this.catF(), m = this.s.month(), sc = this.scope();
    return this.s.tx().filter(t => (sc === 'all' || t.date.startsWith(m)) && (n === 'all' || (n === 'in' ? t.value > 0 : t.value < 0)) && (c === 'all' || t.cat === c)
      && (!q || (t.desc + t.cat + t.bank).toLowerCase().includes(q))).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  });
  pageRows = computed(() => { const p = Math.min(this.page(), Math.max(0, Math.ceil(this.rows().length / this.PS) - 1)); return this.rows().slice(p * this.PS, p * this.PS + this.PS); });
  pages = computed(() => Math.max(1, Math.ceil(this.rows().length / this.PS)));
  sum = computed(() => {
    let i = 0, o = 0; for (const t of this.rows()) t.value > 0 ? i += t.value : o += -t.value; return { i, o, n: i - o };
  });
  setF(k: 'q' | 'nat' | 'catF' | 'scope', v: any) { (this[k] as any).set(v); this.page.set(0); }
  signed(t: Tx, v: unknown) { const a = Math.abs(this.num(v)); this.s.upd(this.s.tx, t.id, { value: t.value < 0 ? -a : a }); }
  flip(t: Tx) { this.s.upd(this.s.tx, t.id, { value: -t.value }); }

  // ---- notas de insumos ----
  GROUPS = [
    { id: 'supplier', label: 'Fornecedor' }, { id: 'product', label: 'Produto' }, { id: 'brand', label: 'Marca' },
    { id: 'month', label: 'Mês' }, { id: 'unit', label: 'Unidade' },
  ] as const;
  sq = signal(''); sSup = signal(''); sProd = signal(''); sBrand = signal(''); sUnit = signal('');
  sPeriod = signal<'month' | 'all' | 'range'>('month'); sFrom = signal(''); sTo = signal(''); sPage = signal(0);
  group = signal<'supplier' | 'product' | 'brand' | 'month' | 'unit'>('supplier');
  importText = ''; importMsg = signal('');
  total = (r: { quantity: number; price: number }) => Math.round((+r.quantity || 0) * (+r.price || 0) * 100) / 100;
  setS(k: 'sq' | 'sSup' | 'sProd' | 'sBrand' | 'sUnit' | 'sPeriod' | 'sFrom' | 'sTo' | 'group', v: any) { (this[k] as any).set(v); this.sPage.set(0); }
  clearS() { this.sq.set(''); this.sSup.set(''); this.sProd.set(''); this.sBrand.set(''); this.sUnit.set(''); this.sPage.set(0); }
  private uniq(f: (r: Supply) => string) { return [...new Set(this.s.supplies().map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')); }
  optSup = computed(() => this.uniq(r => r.supplier)); optProd = computed(() => this.uniq(r => r.product));
  optBrand = computed(() => this.uniq(r => r.brand)); optUnit = computed(() => this.uniq(r => r.unit));
  supRows = computed(() => {
    const q = this.sq().trim().toLowerCase(), m = this.s.month(), per = this.sPeriod(), f = this.sFrom(), to = this.sTo();
    return this.s.supplies().filter(r =>
      (per === 'all' || (per === 'month' ? r.date.startsWith(m) : (!f || r.date >= f) && (!to || r.date <= to))) &&
      (!this.sSup() || r.supplier === this.sSup()) && (!this.sProd() || r.product === this.sProd()) &&
      (!this.sBrand() || r.brand === this.sBrand()) && (!this.sUnit() || r.unit === this.sUnit()) &&
      (!q || (r.product + r.supplier + r.brand + r.invoice).toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  });
  supPages = computed(() => Math.max(1, Math.ceil(this.supRows().length / this.PS)));
  supPage = computed(() => { const p = Math.min(this.sPage(), this.supPages() - 1); return this.supRows().slice(p * this.PS, p * this.PS + this.PS); });
  supSum = computed(() => {
    const r = this.supRows();
    return { total: r.reduce((a, x) => a + this.total(x), 0), items: r.length, notes: new Set(r.map(x => x.invoice).filter(Boolean)).size, suppliers: new Set(r.map(x => x.supplier).filter(Boolean)).size };
  });
  /** Balancete: total comprado agrupado, com participação e variação de preço por produto. */
  balancete = computed(() => {
    const g = this.group(), rows = this.supRows(), map = new Map<string, Supply[]>();
    const key = (r: Supply) => g === 'supplier' ? r.supplier || '(sem fornecedor)' : g === 'product' ? `${r.product || '(sem produto)'} · ${r.unit}`
      : g === 'brand' ? r.brand || '(sem marca)' : g === 'month' ? r.date.slice(0, 7) : r.unit;
    for (const r of rows) { const k = key(r); (map.get(k) ?? map.set(k, []).get(k)!).push(r); }
    const grand = rows.reduce((a, x) => a + this.total(x), 0) || 1;
    const out = [...map].map(([k, l]) => {
      const total = l.reduce((a, x) => a + this.total(x), 0), qty = l.reduce((a, x) => a + (+x.quantity || 0), 0);
      const byDate = [...l].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id), prices = l.map(x => +x.price || 0).filter(p => p > 0);
      const first = byDate[0]?.price || 0, last = byDate[byDate.length - 1]?.price || 0;
      return { k: g === 'month' ? monthLabel(k) : k, sort: k, n: l.length, qty, total, share: total / grand * 100,
        avg: qty > 0 ? total / qty : 0, min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0, last,
        varPct: first > 0 && byDate.length > 1 ? (last - first) / first * 100 : null as number | null };
    });
    return g === 'month' ? out.sort((a, b) => b.sort.localeCompare(a.sort)) : out.sort((a, b) => b.total - a.total);
  });
  /** Conferência com o extrato e com o CMV informado. */
  conf = computed(() => {
    const per = this.sPeriod(), m = this.s.month();
    const from = per === 'month' ? m + '-01' : per === 'range' ? this.sFrom() : '', to = per === 'month' ? m + '-31' : per === 'range' ? this.sTo() : '';
    const bank = this.s.tx().filter(t => t.cat === 'Compras / estoque / operação' && t.value < 0 && (!from || t.date >= from) && (!to || t.date <= to)).reduce((a, t) => a - t.value, 0);
    const notes = this.s.supplies().filter(r => (!from || r.date >= from) && (!to || r.date <= to)).reduce((a, r) => a + this.total(r), 0);
    const mm = this.s.metrics();
    return { bank, notes, diff: notes - bank, cov: bank > 0 ? notes / bank * 100 : 0,
      cmvReal: per === 'month' && mm.net > 0 ? notes / mm.net * 100 : null as number | null, cmvInf: mm.s.cmvPct };
  });
  qty(v: number) { return (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }

  /** Importa linhas coladas ou de um arquivo: data; fornecedor; produto; marca; quantidade; un; valor unitário; nota. */
  private brNum(s: string) { const n = parseFloat(String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
  private isoDate(s: string) {
    const t = (s ?? '').trim(), m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/), i = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (i) return `${i[1]}-${i[2]}-${i[3]}`;
    if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
  }
  async doImport() {
    const rows: Omit<Supply, 'id'>[] = []; let skipped = 0;
    for (const line of this.importText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split(line.includes('\t') ? '\t' : ';').map(x => x.trim()), date = this.isoDate(c[0]);
      if (!date || c.length < 7) { skipped++; continue; }
      rows.push({ date, supplier: c[1], product: c[2], brand: c[3], quantity: this.brNum(c[4]), unit: c[5] || 'un', price: this.brNum(c[6]), invoice: c[7] ?? '' });
    }
    await this.s.importSupplies(rows);
    this.importMsg.set(`${rows.length} itens importados${skipped ? `, ${skipped} linhas ignoradas (cabeçalho ou formato incorreto)` : ''}.`);
    if (rows.length) this.importText = '';
  }
  readFile(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { this.importText = String(r.result ?? ''); }; r.readAsText(f);
  }

  // ---- simulador ----
  ov = signal<{ orders?: number; ticket?: number; cmv?: number; cut?: number; days?: number }>({});
  setOv(k: 'orders' | 'ticket' | 'cmv' | 'cut' | 'days', v: unknown) { this.ov.update(o => ({ ...o, [k]: this.num(v) })); }
  scn = computed(() => {
    const m = this.s.metrics(), o = this.ov();
    const orders = o.orders ?? (m.ordersPerDay || 3), ticket = o.ticket ?? (m.ticket || 60), cmv = o.cmv ?? m.s.cmvPct, cut = o.cut ?? 0, days = o.days ?? m.d.total;
    const net = orders * ticket * days, costs = m.costs * (1 - cut / 100), contrib = 1 - cmv / 100;
    const profit = net * contrib - costs;
    return { orders, ticket, cmv, cut, days, net, costs, profit, margin: net > 0 ? profit / net * 100 : 0,
      beOrders: contrib > 0 && ticket > 0 && days > 0 ? costs / contrib / ticket / days : 0, beNet: contrib > 0 ? costs / contrib : 0 };
  });
  histSeries = computed(() => {
    const sm = this.s.sim(), m = this.s.metrics(); if (!sm) return [];
    return [{ name: 'Probabilidade', color: PALETTE[1], values: sm.hist, colors: sm.labels.map(l => l >= m.breakeven ? PALETTE[0] : PALETTE[1]) }];
  });
  histLabels = computed(() => (this.s.sim()?.labels ?? []).map(l => (l / 1000).toFixed(1).replace('.', ',') + 'k'));
  rulePattern = ''; ruleCat = 'Compras / estoque / operação';
  addRule() { const p = this.rulePattern; this.rulePattern = ''; this.s.addRule(p, this.ruleCat); }
  ago(iso?: string | null) {
    if (!iso) return 'ainda sem sincronizar';
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  }
  syncTitle() {
    const st = this.s.status(); if (!st) return '';
    const p = st.sync?.['pluggy']; const o = st.lastOrderAt ? new Date(st.lastOrderAt).toLocaleString('pt-BR') : 'nenhum ainda';
    return `Último pedido da Anota AI: ${o} (${st.orders} no total)` + (p ? `\nBanco: ${p.message}` : '');
  }
  tabLabel() { return this.tabs.find(x => x.id === this.tab())?.label ?? ''; }
  dayTitle = (i: number) => 'Dia ' + (i + 1);
  histTitle = (i: number) => 'Faixa ' + this.histLabels()[i];
  patchCfg(p: Partial<Cfg>) { this.s.cfg.update(c => ({ ...c, ...p })); }
  resetOv() { this.ov.set({}); }
  pctFmt = (v: number) => v.toFixed(1).replace('.', ',') + '%';
  toneOf(p: number) { return p >= 0.6 ? 'good' : p >= 0.25 ? 'warn' : 'bad'; }
  addMonth() { if (/^\d{4}-\d{2}$/.test(this.newMonth)) { this.s.addMonth(this.newMonth); this.newMonth = ''; } }
}
