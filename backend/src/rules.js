// Classificação automática de lançamentos por regras de texto (sem acento, sem maiúsculas).
import { q } from './db.js';

export const OWN = 'Transferência própria / aporte-retirada';
export const PLATFORM = 'Receita de vendas / plataforma';
export const COMPRAS = 'Compras / estoque / operação';

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const KEYWORDS_COMPRAS = ['JJ EMBALAGENS', 'HISO', 'MUFFATO', 'MARCHI', 'SANCHES', 'OESA', 'NAPOLES', 'G.R. COMERCIO', 'GR COMERCIO',
  'GR EMBALAGENS', 'BELLA VITA', 'MOLICENTER', 'WEBCIA', 'MOLIANI', 'BOX ATACADISTA', 'MOLIPLAST', 'SUPERCENTER', 'SIRIEMA', 'PJBANK',
  'VERONA', 'DIFAL', 'SPAL', 'CASA DE CARNE', 'SUPERMERCADO', 'DISTRIBUIDORA'];

export const DEFAULT_RULES = [
  ['IFD*IFOOD', 'Taxa / plataforma'],
  ['IFOOD', PLATFORM],
  ['RODRIGO MORAES DE LIRIO', OWN],
  ['COPEL', 'Energia elétrica'],
  ['RECEITA FEDERAL', 'Impostos e tributos'],
  ['PERSOCLEAN', 'Limpeza / insumos'],
  ...KEYWORDS_COMPRAS.map((k) => [k, COMPRAS]),
];

/** Retorna a categoria da primeira regra que casar; sem regra, "a classificar" conforme o sinal. */
export function classify(description, amount, rules) {
  const d = norm(description);
  for (const r of rules) if (d.includes(norm(r.pattern))) return r.category;
  return amount >= 0 ? 'Entrada a classificar' : 'Saída a classificar';
}

export async function loadRules() {
  const { rows } = await q('select id, pattern, category, position from rules order by position, id');
  return rows;
}

export async function seedRules() {
  const { rows } = await q('select count(*)::int n from rules');
  if (rows[0].n > 0) return;
  let pos = 10;
  for (const [pattern, category] of DEFAULT_RULES) await q('insert into rules (pattern, category, position) values ($1,$2,$3)', [pattern, category, pos++]);
}

/** Reclassifica tudo que não foi categorizado manualmente. */
export async function applyRules() {
  const rules = await loadRules();
  const { rows } = await q('select id, description, amount, category from transactions where category_manual = false');
  let changed = 0;
  for (const t of rows) {
    const cat = classify(t.description, t.amount, rules);
    if (cat !== t.category) { await q('update transactions set category=$1 where id=$2', [cat, t.id]); changed++; }
  }
  return changed;
}
