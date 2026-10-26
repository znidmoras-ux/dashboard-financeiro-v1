import { Injectable, computed, effect, signal } from '@angular/core';
import { SEED_PLATFORM, SEED_TX } from './seed';

export interface Tx { id: number; date: string; bank: string; desc: string; value: number; cat: string; }
export interface Item { id: number; name: string; cat: string; value: number; }
export interface Pay { id: number; role: string; name: string; value: number; receiving: boolean; }
export interface Chan { id: number; name: string; net: number; }
export interface Sales { month: string; channels: Chan[]; discounts: number; orders: number; cmvPct: number; auto?: boolean; }
export interface Supply { id: number; date: string; invoice: string; supplier: string; product: string; brand: string; unit: string; quantity: number; price: number; }
export interface Rule { id: number; pattern: string; category: string; }
export interface Bill { id: number; supplier: string; amount: number; dueDate: string; status: 'aberto' | 'pago'; paidBy: string; note: string; }
export interface Payout { id: number; date: string; amount: number; note: string; }
export interface Supplier { id: number; name: string; termDays: number; note: string; }
export interface ChangeLogEntry { id: number; date: string; area: string; description: string; }
export interface CardInvoice { id: number; bank: string; total: number; minPayment: number; dueDate: string; status: 'aberta' | 'paga'; }
export interface CardInstallment { id: number; cardBank: string; supplier: string; description: string; amount: number; current: number; total: number; startDate: string; }
export interface AutoMonth { channels: { name: string; net: number }[]; discounts: number; orders: number; }
export interface ServerStatus { pluggy: boolean; lastOrderAt: string | null; orders: number; sync: Record<string, { lastRun: string; lastOk: string | null; message: string }>; }
export interface Cfg { includePayments: boolean; targetProfit: number; excludeOwn: boolean; fees?: Record<string, number>; }

export const OWN = 'Transferência própria / aporte-retirada';
export const PLATFORM = 'Receita de vendas / plataforma';
export const CATS = [
  PLATFORM, 'Entrada a classificar', OWN, 'Compras / estoque / operação', 'Saída a classificar',
  'Energia elétrica', 'Impostos e tributos', 'Taxa / plataforma', 'Limpeza / insumos', 'Folha / pagamentos', 'Outros'
];
export const FIXED_CATS = ['AGUA', 'ENERGIA', 'INTERNET', 'SISTEMA', 'DIVIDAS', 'GOVERNO', 'OUTROS'];
export const PALETTE = ['#1b7f57', '#2f6fdb', '#d98a0b', '#7a5bd0', '#0e9aa7', '#c2467f', '#6b7a72', '#8a6d3b'];

const KEY = 'dash-exec-v2';
let uid = 1000;
const nid = () => ++uid;

// "CARTAO MAGAZINE" saiu daqui em 21/10: agora é calculado a partir das parcelas reais (ver SEED_CARD_INSTALLMENTS),
// porque o valor fixo que estava aqui (R$ 680) não batia com a fatura de verdade.
const SEED_FIXED: Item[] = [
  ['SANEPAR', 'AGUA', 150], ['COPEL', 'ENERGIA', 550], ['CONECTIVA', 'INTERNET', 100], ['ANOTA AI', 'SISTEMA', 79.9],
  ['IFOOD MENSALIDADE', 'SISTEMA', 130], ['EMPRESTIMO', 'DIVIDAS', 361.27],
  ['TUNA PAGAMENTOS', 'SISTEMA', 79.99], ['GUIA DAS', 'GOVERNO', 82.9]
].map(([name, cat, value], i) => ({ id: i + 1, name: name as string, cat: cat as string, value: value as number }));

// Em 21/10: só Aldo (entregador) e Nicolly (caixa) estão recebendo de fato. Dirlete e os dois sócios (Valter, Rodrigo)
// não estão sendo pagos no momento — o valor deles continua aqui como pró-labore/salário devido, não como saída de caixa real.
const SEED_PAY: Pay[] = [
  ['SOCIO', 'VALTER', 1500, false], ['OPERAÇÃO', 'ALDO', 1300, true], ['SOCIO', 'RODRIGO', 1500, false], ['OPERAÇÃO', 'DIRLETE', 1300, false], ['OPERAÇÃO', 'NICOLLY', 280, true]
].map(([role, name, value, receiving], i) => ({ id: i + 1, role: role as string, name: name as string, value: value as number, receiving: receiving as boolean }));

function seedSales(): Sales[] {
  const s: Sales[] = [{
    month: '2026-10', discounts: 399.38, orders: 88, cmvPct: 38.5,
    channels: [{ id: 1, name: 'Anota AI', net: 1733.75 }, { id: 2, name: 'iFood', net: 3796.62 }]
  }];
  for (const m of ['2026-09', '2026-08']) {
    s.push({ month: m, discounts: 0, orders: 0, cmvPct: 38.5, channels: [{ id: nid(), name: 'iFood (estimado do extrato)', net: SEED_PLATFORM[m] ?? 0 }] });
  }
  return s;
}

const SEED_CFG: Cfg = { includePayments: true, targetProfit: 0, excludeOwn: true };

// Lançado em 21/10/2026 a partir do assistente de pagamentos e do relatório de conciliação do iFood.
const SEED_BILLS: Bill[] = [
  // Corrigido em 22/10: o Pix de 527 de Rodrigo NÃO era da Agência de Fomento — foi usado para quitar
  // (por outro meio, fora do boleto em si) o boleto da Oesa de R$641, abaixo.
  { id: 1, supplier: 'Agência de Fomento do Paraná S.A.', amount: 361.27, dueDate: '2026-10-13', status: 'aberto', paidBy: '',
    note: 'Parcela do empréstimo — vence todo dia 13 (recorrente). Atrasada.' },
  { id: 2, supplier: 'Oesa Comercio e Representações S.A.', amount: 507.48, dueDate: '2026-10-21', status: 'aberto', paidBy: '',
    note: 'O repasse do iFood previsto para o mesmo dia (R$ 469,01) não cobre sozinho. Valor corrigido em 22/10 (era estimado em 486,40).' },
  { id: 3, supplier: 'Marchi Maringá C.A. Ltda', amount: 364.68, dueDate: '2026-10-23', status: 'aberto', paidBy: '', note: '' },
  { id: 6, supplier: 'Oesa Comercio e Representações S.A.', amount: 641, dueDate: '2026-10-20', status: 'pago',
    paidBy: 'Quitado por outro meio (não especificado)',
    note: 'Pix pessoal de Rodrigo (R$527) contribuiu para o pagamento, mas o boleto foi de fato quitado por outra via.' },
  { id: 4, supplier: 'Moliplast Embalagens', amount: 154.90, dueDate: '2026-11-04', status: 'aberto', paidBy: '',
    note: 'Pedido N20261020110228 de 20/10, boleto 15 dias.' },
  { id: 5, supplier: 'Moliplast Embalagens', amount: 186.85, dueDate: '2026-11-04', status: 'aberto', paidBy: '',
    note: 'Pedido N20261020110758 de 20/10, boleto 15 dias.' },
];
const SEED_PAYOUTS: Payout[] = [
  { id: 1, date: '2026-10-21', amount: 469.01, note: 'Repasse iFood (relatório de conciliação)' },
  { id: 2, date: '2026-10-28', amount: 692.38, note: 'Repasse iFood (relatório de conciliação)' },
  { id: 3, date: '2026-11-04', amount: 530.11, note: 'Repasse iFood (relatório de conciliação)' },
  { id: 4, date: '2026-11-11', amount: 365.95, note: 'Repasse iFood (relatório de conciliação)' },
  { id: 5, date: '2026-11-18', amount: 34.35, note: 'Repasse iFood (relatório de conciliação)' },
];
// Prazo de pagamento por fornecedor. termDays = 0 significa "ainda não confirmado" — preencher conforme for descobrindo.
const SEED_SUPPLIERS: Supplier[] = [
  { id: 1, name: 'Moliplast Embalagens', termDays: 15, note: 'Confirmado: "Boleto 15 dias" no espelho de pedido.' },
  { id: 2, name: 'Oesa Comercio e Representações S.A.', termDays: 21, note: 'Confirmado em 22/10.' },
  { id: 3, name: 'Marchi Maringá C.A. Ltda', termDays: 7, note: 'Confirmado em 22/10.' },
  { id: 4, name: 'Agência de Fomento do Paraná S.A.', termDays: 0, note: 'Não é boleto por pedido — é empréstimo com parcela recorrente todo dia 13.' },
  { id: 5, name: 'Persoclean', termDays: 0, note: 'Compra feita no cartão (parcelado), não por boleto.' },
];
// Histórico de lançamentos/correções feitos no dashboard — toda vez que um dado financeiro for criado, editado
// ou corrigido por aqui, registra uma linha. Mais recente primeiro.
const SEED_CHANGELOG: ChangeLogEntry[] = [
  { id: -4, date: '2026-10-26', area: 'Repasses', description: 'Criado importador de repasses colados (data; valor; observação) na aba Contas a pagar — evita digitar manualmente o relatório de conciliação do iFood toda semana.' },
  { id: -3, date: '2026-10-25', area: 'Relatórios', description: 'Criada aba "Relatórios" + botão no topo da tela para gerar um PDF completo da saúde financeira (resumo, equilíbrio, custos, cartões, contas a pagar, fornecedores e histórico).' },
  { id: -2, date: '2026-10-25', area: 'Infra', description: 'Corrigido bug real no docker-compose: variáveis do WhatsApp (EVOLUTION_*) quebravam a instalação de qualquer um, mesmo sem usar WhatsApp. Corrigida também vulnerabilidade alta no body-parser (backend).' },
  { id: -1, date: '2026-10-24', area: 'WhatsApp', description: 'Criados alertas proativos por WhatsApp: resumo diário de boleto vencido, fatura perto de vencer e repasse da semana não cobrindo os boletos (via Evolution API, opcional).' },
  { id: 0, date: '2026-10-23', area: 'Infra', description: 'Código conectado ao GitHub (znidmoras-ux/dashboard-financeiro-v1) — primeiro push feito, CI rodando (build, testes, validação do docker-compose e varredura de segredos passando).' },
  { id: 1, date: '2026-10-22', area: 'Fornecedores', description: 'Prazos confirmados: Oesa 21 dias, Marchi 7 dias.' },
  { id: 2, date: '2026-10-22', area: 'Contas a pagar', description: 'Boleto Oesa corrigido de R$486,40 (estimado) para R$507,48 (real), vencido em 21/10.' },
  { id: 3, date: '2026-10-22', area: 'Contas a pagar', description: 'Lançado boleto Oesa de R$641 (20/10) como pago — quitado por outro meio, não pelo Pix pessoal de R$527 como se pensava antes.' },
  { id: 4, date: '2026-10-22', area: 'Contas a pagar', description: 'Lançada parcela do empréstimo Agência de Fomento: R$361,27/mês, vence todo dia 13 (recorrente), atrasada.' },
  { id: 5, date: '2026-10-22', area: 'Custos fixos', description: 'Valor do empréstimo nos custos fixos ajustado de R$360 (estimado) para R$361,27 (real).' },
  { id: 6, date: '2026-10-21', area: 'Fornecedores', description: 'Criado cadastro de fornecedores com prazo de pagamento + geração automática de boleto a partir do cadastro.' },
  { id: 7, date: '2026-10-21', area: 'Contas a pagar', description: 'Lançados 2 boletos da Moliplast Embalagens (R$154,90 e R$186,85), vencimento 04/11.' },
  { id: 8, date: '2026-10-21', area: 'Folha', description: 'Separado pagamento "recebendo de fato" (Aldo, Nicolly) de "comprometido e não pago" (Valter, Rodrigo, Dirlete) — ponto de equilíbrio passou a usar só o caixa real.' },
  { id: 9, date: '2026-10-21', area: 'Cartões de crédito', description: 'Criado módulo de cartões: fatura Sicredi (R$2.600,63, vencida) + parcelas Magazine Luiza (Persoclean embalagens e freezer).' },
  { id: 10, date: '2026-10-21', area: 'Custos fixos', description: 'Removido valor fixo chutado de R$680 para "cartão Magazine" — substituído pela soma real das parcelas em andamento.' },
  { id: 11, date: '2026-10-21', area: 'Contas a pagar', description: 'Criado módulo de Contas a pagar + Repasses previstos para acompanhamento semanal de caixa.' },
];
// Fatura do cartão Sicredi, vencida em 10/10, usada em insumos da semana — e as duas parcelas do cartão Magazine Luiza.
const SEED_CARD_INVOICES: CardInvoice[] = [
  { id: 1, bank: 'Sicredi', total: 2600.63, minPayment: 2446.10, dueDate: '2026-10-10', status: 'aberta' },
];
const SEED_CARD_INSTALLMENTS: CardInstallment[] = [
  { id: 1, cardBank: 'Magazine Luiza', supplier: 'Persoclean', description: 'Embalagens', amount: 992.43, current: 3, total: 6, startDate: '2026-08-15' },
  { id: 2, cardBank: 'Magazine Luiza', supplier: '', description: 'Freezer', amount: 408.21, current: 4, total: 10, startDate: '2026-06-29' },
];

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const dim = (m: string) => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
export const monthLabel = (m: string) => {
  const n = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return n[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);
};
export const shortMonth = (m: string) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m.slice(5, 7) - 1] + '/' + m.slice(2, 4);

@Injectable({ providedIn: 'root' })
export class Store {
  fixed = signal<Item[]>(SEED_FIXED);
  pay = signal<Pay[]>(SEED_PAY);
  sales = signal<Sales[]>(seedSales());
  tx = signal<Tx[]>(SEED_TX.map((r, i) => ({ id: i + 1, date: r[0], bank: r[1], desc: r[2], value: r[3], cat: r[4] })));
  cfg = signal<Cfg>({ ...SEED_CFG });
  month = signal('2026-10');
  seed = signal(7);
  theme = signal<'light' | 'dark' | 'auto'>('auto');
  /** 'server': dados no Postgres via API; 'local': só neste navegador (modo demonstração). */
  mode = signal<'loading' | 'server' | 'local'>('loading');
  autoMap = signal<Record<string, AutoMonth>>({});
  status = signal<ServerStatus | null>(null);
  rules = signal<Rule[]>([]);
  syncing = signal(false);
  private lastSaved = '';
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  supplies = signal<Supply[]>([]);
  bills = signal<Bill[]>(SEED_BILLS.map(x => ({ ...x })));
  payouts = signal<Payout[]>(SEED_PAYOUTS.map(x => ({ ...x })));
  suppliers = signal<Supplier[]>(SEED_SUPPLIERS.map(x => ({ ...x })));
  changelog = signal<ChangeLogEntry[]>(SEED_CHANGELOG.map(x => ({ ...x })));
  appVersion = { tag: 'local-dev', source: 'ambiente local (ainda não implantado em servidor)', updatedAt: '2026-10-22' };
  cardInvoices = signal<CardInvoice[]>(SEED_CARD_INVOICES.map(x => ({ ...x })));
  cardInstallments = signal<CardInstallment[]>(SEED_CARD_INSTALLMENTS.map(x => ({ ...x })));
  private txTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private txPatches = new Map<string, Record<string, unknown>>();

  today = new Date();
  todayMonth = this.today.getFullYear() + '-' + String(this.today.getMonth() + 1).padStart(2, '0');

  constructor() {
    this.load();
    effect(() => {
      const d = { f: this.fixed(), p: this.pay(), s: this.sales(), t: this.tx(), sp: this.supplies(), b: this.bills(), py: this.payouts(), ci: this.cardInvoices(), cp: this.cardInstallments(), sup: this.suppliers(), log: this.changelog(), c: this.cfg(), m: this.month(), th: this.theme() };
      const mode = this.mode();
      try {
        // no modo servidor o navegador guarda só preferências; os dados ficam no Postgres
        localStorage.setItem(KEY, JSON.stringify(mode === 'server' ? { m: d.m, th: d.th } : d));
      } catch { /* sem armazenamento */ }
      if (mode === 'server') this.queueSettingsSave({ fixed: d.f, pay: d.p, sales: d.s, cfg: d.c, bills: d.b, payouts: d.py, cardInvoices: d.ci, cardInstallments: d.cp, suppliers: d.sup, changelog: d.log });
    });
    this.connect();
  }

  // ---------- servidor ----------
  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch('/api' + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }

  private async connect() {
    try {
      type ServerSettings = {
        fixed: Item[]; pay: Pay[]; sales: Sales[]; cfg: Cfg;
        bills?: Bill[]; payouts?: Payout[]; cardInvoices?: CardInvoice[]; cardInstallments?: CardInstallment[]; suppliers?: Supplier[]; changelog?: ChangeLogEntry[];
      };
      const b = await this.api<{ settings: ServerSettings | null; transactions: Tx[]; auto: Record<string, AutoMonth>; status: ServerStatus }>('/bootstrap');
      if (b.settings) {
        this.fixed.set(b.settings.fixed); this.pay.set(b.settings.pay); this.sales.set(b.settings.sales);
        this.cfg.set({ ...SEED_CFG, ...b.settings.cfg });
        // Campos adicionados depois (bills/cartões/fornecedores/changelog): se o servidor ainda não tem nada
        // salvo pra eles (settings antigas), mantém a semente local em vez de apagar com um array vazio.
        if (b.settings.bills) this.bills.set(b.settings.bills);
        if (b.settings.payouts) this.payouts.set(b.settings.payouts);
        if (b.settings.cardInvoices) this.cardInvoices.set(b.settings.cardInvoices);
        if (b.settings.cardInstallments) this.cardInstallments.set(b.settings.cardInstallments);
        if (b.settings.suppliers) this.suppliers.set(b.settings.suppliers);
        if (b.settings.changelog) this.changelog.set(b.settings.changelog);
        this.lastSaved = JSON.stringify({
          fixed: b.settings.fixed, pay: b.settings.pay, sales: b.settings.sales, cfg: this.cfg(),
          bills: this.bills(), payouts: this.payouts(), cardInvoices: this.cardInvoices(), cardInstallments: this.cardInstallments(), suppliers: this.suppliers(), changelog: this.changelog(),
        });
      }
      this.tx.set(b.transactions); this.autoMap.set(b.auto); this.status.set(b.status);
      this.supplies.set(await this.api<Supply[]>('/supplies'));
      uid = Math.max(uid, ...this.fixed().map(x => x.id), ...this.pay().map(x => x.id), ...this.sales().flatMap(s => s.channels.map(c => c.id))) + 10;
      this.mode.set('server');
      const last = this.months()[0]; if (!this.months().includes(this.month())) this.month.set(last);
      this.loadRules();
      setInterval(() => this.refresh(), 30000);
    } catch {
      this.mode.set('local');
    }
  }

  /** Atualiza extrato, vendas automáticas e status sem tocar nas configurações em edição. */
  async refresh() {
    if (this.mode() !== 'server' || this.txTimers.size) return;
    try {
      const b = await this.api<{ transactions: Tx[]; auto: Record<string, AutoMonth>; status: ServerStatus }>('/bootstrap');
      this.tx.set(b.transactions); this.autoMap.set(b.auto); this.status.set(b.status);
      this.supplies.set(await this.api<Supply[]>('/supplies'));
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  private queueSettingsSave(body: { fixed: Item[]; pay: Pay[]; sales: Sales[]; cfg: Cfg; bills: Bill[]; payouts: Payout[]; cardInvoices: CardInvoice[]; cardInstallments: CardInstallment[]; suppliers: Supplier[]; changelog: ChangeLogEntry[] }) {
    const json = JSON.stringify(body);
    if (json === this.lastSaved) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try { await this.api('/settings', { method: 'PUT', body: json }); this.lastSaved = json; } catch { /* repete na próxima edição */ }
    }, 700);
  }

  /** Junta as edições de um mesmo registro (digitação) e envia uma vez só, 600 ms depois da última. */
  private queuePatch(path: string, patch: Record<string, unknown>) {
    this.txPatches.set(path, { ...(this.txPatches.get(path) ?? {}), ...patch });
    clearTimeout(this.txTimers.get(path));
    this.txTimers.set(path, setTimeout(async () => {
      const body = this.txPatches.get(path); this.txPatches.delete(path); this.txTimers.delete(path);
      try { await this.api(path, { method: 'PATCH', body: JSON.stringify(body) }); } catch { /* */ }
    }, 600));
  }

  async loadRules() { try { this.rules.set(await this.api<Rule[]>('/rules')); } catch { /* */ } }
  async addRule(pattern: string, category: string) {
    if (!pattern.trim()) return;
    await this.api('/rules', { method: 'POST', body: JSON.stringify({ pattern: pattern.trim(), category }) });
    await this.loadRules(); await this.refresh();
  }
  async delRule(id: number) { await this.api('/rules/' + id, { method: 'DELETE' }); await this.loadRules(); }
  async applyRules() { await this.api('/rules/apply', { method: 'POST' }); await this.refresh(); }
  async syncNow() {
    this.syncing.set(true);
    try { await this.api('/sync/pluggy', { method: 'POST' }); await this.refresh(); } finally { this.syncing.set(false); }
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.f) this.fixed.set(d.f);
      if (d.p) this.pay.set(d.p);
      if (d.s) this.sales.set(d.s);
      if (d.t) this.tx.set(d.t);
      if (d.sp) this.supplies.set(d.sp);
      if (d.b) this.bills.set(d.b);
      if (d.py) this.payouts.set(d.py);
      if (d.ci) this.cardInvoices.set(d.ci);
      if (d.cp) this.cardInstallments.set(d.cp);
      if (d.sup) this.suppliers.set(d.sup);
      if (d.log) this.changelog.set(d.log);
      if (d.c) this.cfg.set({ ...SEED_CFG, ...d.c });
      if (d.m) this.month.set(d.m);
      if (d.th) this.theme.set(d.th);
      uid = Math.max(uid, ...this.tx().map(t => t.id), ...this.fixed().map(t => t.id), ...this.pay().map(t => t.id)) + 10;
    } catch { /* ignora dados inválidos */ }
  }

  resetAll() {
    this.fixed.set(SEED_FIXED.map(x => ({ ...x }))); this.pay.set(SEED_PAY.map(x => ({ ...x })));
    this.sales.set(seedSales());
    this.bills.set(SEED_BILLS.map(x => ({ ...x }))); this.payouts.set(SEED_PAYOUTS.map(x => ({ ...x })));
    this.cardInvoices.set(SEED_CARD_INVOICES.map(x => ({ ...x }))); this.cardInstallments.set(SEED_CARD_INSTALLMENTS.map(x => ({ ...x })));
    this.suppliers.set(SEED_SUPPLIERS.map(x => ({ ...x })));
    this.changelog.set(SEED_CHANGELOG.map(x => ({ ...x })));
    this.cfg.set({ ...SEED_CFG }); this.month.set(this.todayMonth);
    if (this.mode() === 'server') return; // no servidor o extrato e as notas vêm do banco e não são apagados aqui
    this.supplies.set([]);
    this.tx.set(SEED_TX.map((r, i) => ({ id: i + 1, date: r[0], bank: r[1], desc: r[2], value: r[3], cat: r[4] })));
    this.cfg.set({ ...SEED_CFG }); this.month.set('2026-10');
  }

  // ---------- edição genérica ----------
  upd<T extends { id: number }>(s: { update: (f: (v: T[]) => T[]) => void }, id: number, patch: Partial<T>) {
    s.update(l => l.map(x => x.id === id ? { ...x, ...patch } : x));
    if (this.mode() === 'server') {
      if (s === (this.tx as unknown)) this.queuePatch('/transactions/' + id, patch as Record<string, unknown>);
      else if (s === (this.supplies as unknown)) this.queuePatch('/supplies/' + id, patch as Record<string, unknown>);
    }
  }
  del<T extends { id: number }>(s: { update: (f: (v: T[]) => T[]) => void }, id: number) {
    s.update(l => l.filter(x => x.id !== id));
    if (this.mode() === 'server') {
      if (s === (this.tx as unknown)) this.api('/transactions/' + id, { method: 'DELETE' }).catch(() => {});
      else if (s === (this.supplies as unknown)) this.api('/supplies/' + id, { method: 'DELETE' }).catch(() => {});
    }
  }
  addFixed() { this.fixed.update(l => [...l, { id: nid(), name: 'Novo custo', cat: 'OUTROS', value: 0 }]); }
  addPay() { this.pay.update(l => [...l, { id: nid(), role: 'OPERAÇÃO', name: 'Novo', value: 0, receiving: true }]); }
  addBill(base?: Partial<Bill>) { this.bills.update(l => [{ id: nid(), supplier: '', amount: 0, dueDate: this.today.toISOString().slice(0, 10), status: 'aberto', paidBy: '', note: '', ...base }, ...l]); }
  addSupplier() { this.suppliers.update(l => [...l, { id: nid(), name: '', termDays: 0, note: '' }]); }
  addChangeEntry(area: string, description: string) {
    this.changelog.update(l => [{ id: nid(), date: this.today.toISOString().slice(0, 10), area, description }, ...l]);
  }
  /** Gera um boleto a partir de um fornecedor cadastrado: calcula o vencimento (data do pedido + prazo do fornecedor). */
  addBillFromSupplier(supplierId: number, orderDate: string, amount: number, note = '') {
    const sup = this.suppliers().find(s => s.id === supplierId);
    if (!sup) return;
    const due = new Date(orderDate + 'T12:00:00'); due.setDate(due.getDate() + (+sup.termDays || 0));
    this.addBill({ supplier: sup.name, amount, dueDate: due.toISOString().slice(0, 10), note: note || `Prazo do fornecedor: ${sup.termDays} dias.` });
  }
  addPayout() { this.payouts.update(l => [{ id: nid(), date: this.today.toISOString().slice(0, 10), amount: 0, note: '' }, ...l]); }
  /** Importa vários repasses colados de uma vez (ex.: do relatório de conciliação do iFood). */
  importPayouts(rows: Omit<Payout, 'id'>[]) { if (rows.length) this.payouts.update(l => [...rows.map(r => ({ id: nid(), ...r })), ...l]); }
  addCardInvoice() { this.cardInvoices.update(l => [{ id: nid(), bank: '', total: 0, minPayment: 0, dueDate: this.today.toISOString().slice(0, 10), status: 'aberta' }, ...l]); }
  addCardInstallment() { this.cardInstallments.update(l => [{ id: nid(), cardBank: '', supplier: '', description: '', amount: 0, current: 1, total: 1, startDate: this.today.toISOString().slice(0, 10) }, ...l]); }
  async addSupply(base?: Partial<Supply>) {
    const row = { date: this.today.toISOString().slice(0, 10), invoice: '', supplier: '', product: '', brand: '', unit: 'un', quantity: 1, price: 0, ...base };
    if (this.mode() === 'server') {
      try { const r = await this.api<Supply>('/supplies', { method: 'POST', body: JSON.stringify(row) }); this.supplies.update(l => [r, ...l]); return; } catch { /* modo local */ }
    }
    this.supplies.update(l => [{ id: nid(), ...row }, ...l]);
  }
  async importSupplies(rows: Omit<Supply, 'id'>[]) {
    if (!rows.length) return;
    if (this.mode() === 'server') {
      try { const r = await this.api<Supply[]>('/supplies', { method: 'POST', body: JSON.stringify({ items: rows }) }); this.supplies.update(l => [...r, ...l]); return; } catch { /* modo local */ }
    }
    this.supplies.update(l => [...rows.map(r => ({ id: nid(), ...r })), ...l]);
  }
  async addTx() {
    const base = { date: this.month() + '-01', bank: 'Manual', desc: 'Novo lançamento', value: 0, cat: 'Outros' };
    if (this.mode() === 'server') {
      try { const row = await this.api<Tx>('/transactions', { method: 'POST', body: JSON.stringify(base) }); this.tx.update(l => [row, ...l]); return; } catch { /* cai no modo local */ }
    }
    this.tx.update(l => [{ id: nid(), ...base }, ...l]);
  }

  private manualOf = (m: string): Sales => this.sales().find(s => s.month === m) ?? { month: m, channels: [], discounts: 0, orders: 0, cmvPct: 38.5 };
  /** Vendas da competência: pedidos recebidos pela Anota AI têm prioridade sobre o lançamento manual. */
  salesOf = (m: string): Sales => {
    const manual = this.manualOf(m), a = this.autoMap()[m];
    if (!a) return manual;
    return { month: m, cmvPct: manual.cmvPct, auto: true, discounts: a.discounts, orders: a.orders, channels: a.channels.map((c, i) => ({ id: -(i + 1), name: c.name, net: c.net })) };
  };
  patchSales(m: string, patch: Partial<Sales>) {
    const base = this.manualOf(m);
    this.sales.update(l => l.some(s => s.month === m) ? l.map(s => s.month === m ? { ...s, ...patch } : s) : [...l, { ...base, ...patch }]);
  }
  addChannel(m: string) { this.patchSales(m, { channels: [...this.manualOf(m).channels, { id: nid(), name: 'Novo canal', net: 0 }] }); }
  updChannel(m: string, id: number, patch: Partial<Chan>) { this.patchSales(m, { channels: this.manualOf(m).channels.map(c => c.id === id ? { ...c, ...patch } : c) }); }
  delChannel(m: string, id: number) { this.patchSales(m, { channels: this.manualOf(m).channels.filter(c => c.id !== id) }); }
  addMonth(m: string) { if (!this.sales().some(s => s.month === m)) this.patchSales(m, {}); this.month.set(m); }

  // ---------- derivados ----------
  months = computed(() => {
    const set = new Set<string>([this.todayMonth]);
    this.sales().forEach(s => set.add(s.month));
    Object.keys(this.autoMap()).forEach(m => set.add(m));
    this.tx().forEach(t => set.add(t.date.slice(0, 7)));
    return [...set].filter(Boolean).sort().reverse();
  });

  fixedTotal = computed(() => this.fixed().reduce((a, b) => a + (+b.value || 0), 0));
  /** Total comprometido (o que deveria ser pago a sócios/equipe, recebendo ou não). */
  payTotal = computed(() => this.pay().reduce((a, b) => a + (+b.value || 0), 0));
  /** Só quem está recebendo de fato — é o que sai do caixa hoje. */
  payActiveTotal = computed(() => this.pay().filter(p => p.receiving).reduce((a, b) => a + (+b.value || 0), 0));
  /** O que está comprometido mas não está sendo pago — vira dívida de pró-labore/salário acumulando. */
  payDeferredTotal = computed(() => this.pay().filter(p => !p.receiving).reduce((a, b) => a + (+b.value || 0), 0));
  /** Soma das parcelas de cartão ainda em aberto (parcela atual <= total). Substitui o valor fixo que havia para o cartão. */
  cardMonthly = computed(() => this.cardInstallments().filter(c => c.current <= c.total).reduce((a, c) => a + (+c.amount || 0), 0));
  /** Custo real de caixa: usa só os pagamentos que estão de fato saindo (payActiveTotal), não o total comprometido. */
  costTotal = computed(() => this.fixedTotal() + (this.cfg().includePayments ? this.payActiveTotal() : 0) + this.cardMonthly());

  daysOf(m: string) {
    const total = dim(m);
    const elapsed = m < this.todayMonth ? total : m === this.todayMonth ? this.today.getDate() : 0;
    return { total, elapsed, remaining: total - elapsed };
  }

  ledger(m: string) {
    const own = this.cfg().excludeOwn;
    const rows = this.tx().filter(t => t.date.startsWith(m));
    let platform = 0, other = 0, out = 0, ownIn = 0, ownOut = 0;
    const byCat = new Map<string, number>(); const wd = Array(7).fill(0); const daily = new Map<string, number>();
    const parties = new Map<string, number>();
    for (const t of rows) {
      const v = +t.value || 0;
      if (t.cat === OWN) { v > 0 ? ownIn += v : ownOut += -v; if (own) continue; }
      if (v > 0) {
        if (t.cat === PLATFORM) platform += v; else other += v;
        wd[new Date(t.date + 'T12:00:00').getDay()] += v; daily.set(t.date, (daily.get(t.date) ?? 0) + v);
      } else if (v < 0) {
        out += -v; byCat.set(t.cat, (byCat.get(t.cat) ?? 0) - v);
        const k = t.desc.replace(/^(CARTAO DEBITO|PAGAMENTO PIX)\s*-\s*/i, '').split(' - ')[0].replace(/\s*-\s*$/, '').replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d*-?\d*/g, '').trim().slice(0, 34) || t.desc;
        parties.set(k, (parties.get(k) ?? 0) - v);
      }
    }
    const inflow = platform + other;
    return {
      count: rows.length, platform, other, inflow, out, net: inflow - out, ownIn, ownOut,
      byCat: [...byCat].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v),
      parties: [...parties].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v).slice(0, 8), wd, daily
    };
  }

  metrics = computed(() => {
    const m = this.month(); const s = this.salesOf(m); const d = this.daysOf(m);
    const net = s.channels.reduce((a, c) => a + (+c.net || 0), 0);
    const gross = net + (+s.discounts || 0);
    const cmv = net * (+s.cmvPct || 0) / 100;
    const costs = this.costTotal();
    const profit = net - cmv - costs;
    const contrib = 1 - (+s.cmvPct || 0) / 100;
    const breakeven = contrib > 0 ? costs / contrib : 0;
    const target = contrib > 0 ? (costs + (+this.cfg().targetProfit || 0)) / contrib : 0;
    const ticket = s.orders > 0 ? net / s.orders : 0;
    const runRate = d.elapsed > 0 ? net / d.elapsed : 0;
    const projected = d.elapsed > 0 ? runRate * d.total : net;
    const missing = Math.max(0, breakeven - net);
    const needPerDay = d.remaining > 0 ? missing / d.remaining : missing;
    const ordersPerDay = d.elapsed > 0 ? s.orders / d.elapsed : 0;
    return {
      s, d, net, gross, cmv, costs, profit, margin: net > 0 ? profit / net * 100 : 0, contrib, breakeven, target, ticket, runRate, projected,
      projectedProfit: projected * contrib - costs, missing, needPerDay, needOrdersDay: ticket > 0 ? needPerDay / ticket : 0, ordersPerDay,
      progress: breakeven > 0 ? Math.min(100, net / breakeven * 100) : 0, progressRaw: breakeven > 0 ? net / breakeven * 100 : 0,
      discPct: gross > 0 ? (+s.discounts || 0) / gross * 100 : 0
    };
  });

  led = computed(() => this.ledger(this.month()));

  /** Contas a pagar: boletos de fornecedor + faturas de cartão em aberto, numa lista só. */
  private debtItems = computed(() => [
    ...this.bills().filter(b => b.status === 'aberto').map(b => ({ label: b.supplier || '(sem fornecedor)', amount: +b.amount || 0, dueDate: b.dueDate, kind: 'boleto' as const })),
    ...this.cardInvoices().filter(c => c.status === 'aberta').map(c => ({ label: `Fatura cartão ${c.bank || ''}`.trim(), amount: +c.total || 0, dueDate: c.dueDate, kind: 'cartão' as const })),
  ]);
  /** O que está vencido, o que vence nos próximos dias, e se os repasses previstos cobrem isso. */
  billStats = computed(() => {
    const today = this.today.toISOString().slice(0, 10), in7 = new Date(this.today.getTime() + 7 * 864e5).toISOString().slice(0, 10);
    const open = this.debtItems();
    const overdue = open.filter(b => b.dueDate < today);
    const soon = open.filter(b => b.dueDate >= today && b.dueDate <= in7);
    const totalOpen = open.reduce((a, b) => a + b.amount, 0);
    const totalOverdue = overdue.reduce((a, b) => a + b.amount, 0);
    const totalSoon = soon.reduce((a, b) => a + b.amount, 0);
    const payoutsSoon = this.payouts().filter(p => p.date >= today && p.date <= in7).reduce((a, p) => a + (+p.amount || 0), 0);
    return { open, overdue, soon, totalOpen, totalOverdue, totalSoon, payoutsSoon, gap: totalSoon - payoutsSoon };
  });

  trend = computed(() => {
    const ms = [...new Set([...this.sales().map(s => s.month), ...Object.keys(this.autoMap()), ...this.tx().map(t => t.date.slice(0, 7))])].sort();
    return ms.map(m => {
      const s = this.salesOf(m); const net = s.channels.reduce((a, c) => a + (+c.net || 0), 0);
      const l = this.ledger(m);
      const profit = net * (1 - s.cmvPct / 100) - this.costTotal();
      return { m, net, profit, inflow: l.inflow, out: l.out, bank: l.net };
    });
  });

  fixedByCat = computed(() => {
    const mp = new Map<string, number>();
    this.fixed().forEach(f => mp.set(f.cat, (mp.get(f.cat) ?? 0) + (+f.value || 0)));
    if (this.cfg().includePayments) {
      this.pay().forEach(p => mp.set(p.role.startsWith('SOC') ? 'SÓCIOS' : 'EQUIPE', (mp.get(p.role.startsWith('SOC') ? 'SÓCIOS' : 'EQUIPE') ?? 0) + (+p.value || 0)));
    }
    return [...mp].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  });

  /** Monte Carlo: reamostra o ritmo diário de entradas do extrato para os dias restantes do mês. */
  sim = computed(() => {
    const m = this.metrics(); const d = m.d;
    if (d.remaining <= 0 || m.runRate <= 0) return null;
    const own = this.cfg().excludeOwn; const days = new Map<string, number>();
    let min = '9999', max = '0000';
    for (const t of this.tx()) {
      if (t.date < min) min = t.date; if (t.date > max) max = t.date;
      if (t.value > 0 && !(own && t.cat === OWN)) days.set(t.date, (days.get(t.date) ?? 0) + t.value);
    }
    const arr: number[] = [];
    for (let x = new Date(min + 'T12:00:00'); x <= new Date(max + 'T12:00:00'); x.setDate(x.getDate() + 1)) {
      arr.push(days.get(x.toISOString().slice(0, 10)) ?? 0);
    }
    const mean = arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const mult = mean > 0 && arr.length > 7 ? arr.map(v => v / mean) : [1];
    const rnd = mulberry(this.seed()); const N = 4000; const res: number[] = [];
    for (let i = 0; i < N; i++) {
      let sum = 0; for (let k = 0; k < d.remaining; k++) sum += mult[Math.floor(rnd() * mult.length)];
      res.push(m.net + sum * m.runRate);
    }
    res.sort((a, b) => a - b);
    const q = (p: number) => res[Math.min(N - 1, Math.floor(p * N))];
    const hit = res.filter(v => v >= m.breakeven).length / N;
    const lo = res[0], hi = res[N - 1], bins = 14, w = (hi - lo) / bins || 1;
    const hist = Array(bins).fill(0); res.forEach(v => hist[Math.min(bins - 1, Math.floor((v - lo) / w))]++);
    const labels = hist.map((_, i) => lo + w * i + w / 2);
    return { hit, p10: q(0.1), p50: q(0.5), p90: q(0.9), hist: hist.map(h => h / N * 100), labels, lo, w, profit: (v: number) => v * m.contrib - m.costs };
  });

  insights = computed(() => {
    const m = this.metrics(); const out: { icon: string; tone: 'bad' | 'warn' | 'good' | 'info'; text: string }[] = [];
    const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (m.net <= 0) { out.push({ icon: 'edit_note', tone: 'info', text: 'Sem vendas lançadas nesta competência. Informe os canais na aba Vendas.' }); return out; }
    if (m.profit < 0) out.push({ icon: 'trending_down', tone: 'bad', text: `Faltam ${brl(m.missing)} de faturamento para cobrir os custos (ponto de equilíbrio em ${brl(m.breakeven)}).` });
    else out.push({ icon: 'trending_up', tone: 'good', text: `Ponto de equilíbrio superado em ${brl(m.net - m.breakeven)}. Lucro real de ${brl(m.profit)}.` });
    if (m.d.remaining > 0 && m.missing > 0) out.push({ icon: 'event', tone: 'warn', text: `Restam ${m.d.remaining} dias: é preciso vender ${brl(m.needPerDay)} por dia${m.needOrdersDay ? ` (cerca de ${m.needOrdersDay.toFixed(1).replace('.', ',')} pedidos/dia)` : ''}; o ritmo atual é ${brl(m.runRate)} por dia.` });
    const costsTot = m.costs || 1;
    const pays = this.cfg().includePayments ? this.payTotal() : 0;
    if (pays > 0) out.push({ icon: 'groups', tone: 'warn', text: `Sócios e equipe consomem ${(pays / costsTot * 100).toFixed(0)}% dos custos fixos (${brl(pays)}).` });
    const debt = this.fixed().filter(f => f.cat === 'DIVIDAS').reduce((a, b) => a + b.value, 0);
    if (debt > 0) out.push({ icon: 'account_balance', tone: 'warn', text: `Dívidas somam ${brl(debt)} por mês (${(debt / costsTot * 100).toFixed(0)}% dos custos).` });
    const top = [...m.s.channels].sort((a, b) => b.net - a.net)[0];
    if (top && m.s.channels.length > 1 && top.net / m.net > 0.6) out.push({ icon: 'hub', tone: 'info', text: `${top.name} concentra ${(top.net / m.net * 100).toFixed(0)}% da receita. Reduza a dependência de um único canal.` });
    if (m.discPct > 5) out.push({ icon: 'sell', tone: 'warn', text: `Descontos e taxas consomem ${m.discPct.toFixed(1).replace('.', ',')}% do faturamento bruto.` });
    const l = this.led(); const sc = l.byCat.find(c => c.k === 'Saída a classificar');
    if (sc && l.out > 0 && sc.v / l.out > 0.25) out.push({ icon: 'label_off', tone: 'info', text: `${(sc.v / l.out * 100).toFixed(0)}% das saídas do extrato ainda estão sem categoria. Classifique na aba Extrato.` });
    return out;
  });
}
