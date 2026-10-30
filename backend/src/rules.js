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

/** Retorna a categoria da primeira regra que casar; sem regra, usa a categoria que a própria
 *  Pluggy já devolve na transação (ex.: "Food delivery", "Utilities") em vez de descartá-la;
 *  só na ausência de ambas cai em "a classificar" conforme o sinal. */
export function classify(description, amount, rules, pluggyCategory) {
  const d = norm(description);
  for (const r of rules) if (d.includes(norm(r.pattern))) return r.category;
  if (pluggyCategory) return `Pluggy: ${pluggyCategory}`;
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

/** Reclassifica tudo que não foi categorizado manualmente, aplicando só regras de texto que
 *  efetivamente casaram. Importante: nunca rebaixa um lançamento que já tem uma categoria melhor
 *  (ex.: a categoria que a própria Pluggy devolveu, gravada na hora do sync) de volta pra
 *  "a classificar" só porque nenhuma regra de texto bateu — isso era um bug que apagava a
 *  categorização da Pluggy no sync seguinte. */
export async function applyRules() {
  const rules = await loadRules();
  const { rows } = await q('select id, description, category from transactions where category_manual = false');
  let changed = 0;
  for (const t of rows) {
    const d = norm(t.description);
    const rule = rules.find((r) => d.includes(norm(r.pattern)));
    if (rule && rule.category !== t.category) {
      await q('update transactions set category=$1 where id=$2', [rule.category, t.id]);
      changed++;
    }
  }
  return changed;
}
