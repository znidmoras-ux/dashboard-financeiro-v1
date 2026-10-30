import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrder, channelName } from '../src/anotaai.js';
import { classify } from '../src/rules.js';
import { signedAmount } from '../src/pluggy.js';

test('pedido com campos básicos', () => {
  const o = parseOrder({ id: 'A1', total: 62.85, discount: 5, createdAt: '2026-10-18T15:00:00Z', from: 'ifood', status: 'accepted' });
  assert.equal(o.externalId, 'A1'); assert.equal(o.channel, 'iFood'); assert.equal(o.gross, 67.85); assert.equal(o.net, 62.85); assert.equal(o.canceled, false);
});
test('pedido cancelado e formato aninhado', () => {
  const o = parseOrder({ order: { _id: 9, total: '1.234,50', status: 'Cancelado', createdAt: '2026-10-01T10:00:00Z' } });
  assert.equal(o.canceled, true); assert.equal(o.gross, 1234.5); assert.equal(o.channel, 'Anota AI');
});
test('taxa por canal reduz o líquido', () => {
  const o = parseOrder({ id: 1, total: 100, createdAt: '2026-10-01T10:00:00Z', origin: 'iFood' }, { iFood: 12 });
  assert.equal(o.fee, 12); assert.equal(o.net, 88);
});
test('pedido sem id é recusado', () => assert.throws(() => parseOrder({ total: 10 })));
test('canal desconhecido mantém o nome', () => assert.equal(channelName('rappi'), 'Rappi'));
test('classificação por regra e fallback', () => {
  const rules = [{ pattern: 'ifood', category: 'Receita de vendas / plataforma' }, { pattern: 'Distribuidora', category: 'Compras' }];
  assert.equal(classify('IFOODCOM AGENCIA', 10, rules), 'Receita de vendas / plataforma');
  assert.equal(classify('DISTRIBUIDORA GUARAPUAVA', -5, rules), 'Compras');
  assert.equal(classify('FULANO', -5, rules), 'Saída a classificar');
  assert.equal(classify('FULANO', 5, rules), 'Entrada a classificar');
});
test('sem regra, usa a categoria da Pluggy em vez de descartar', () => {
  const rules = [{ pattern: 'ifood', category: 'Receita de vendas / plataforma' }];
  assert.equal(classify('PADARIA DO BAIRRO', -20, rules, 'Food delivery'), 'Pluggy: Food delivery');
  assert.equal(classify('PADARIA DO BAIRRO', -20, rules, ''), 'Saída a classificar');
});
test('regra de texto tem prioridade sobre a categoria da Pluggy', () => {
  const rules = [{ pattern: 'ifood', category: 'Receita de vendas / plataforma' }];
  assert.equal(classify('IFOODCOM AGENCIA', 10, rules, 'Transfers'), 'Receita de vendas / plataforma');
});
test('sinal das transações da Pluggy vem do tipo', () => {
  assert.equal(signedAmount({ type: 'DEBIT', amount: -10 }), -10);
  assert.equal(signedAmount({ type: 'DEBIT', amount: 10 }), -10);
  assert.equal(signedAmount({ type: 'CREDIT', amount: 10 }), 10);
});
