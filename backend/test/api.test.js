// Teste de integração: precisa de um Postgres (TEST_DATABASE_URL). Sem ele, é ignorado.
import test from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
test('API ponta a ponta', { skip: !url }, async () => {
  process.env.DATABASE_URL = url; process.env.WEBHOOK_TOKEN = 'segredo'; process.env.PORT = '0';
  const { start } = await import('../src/server.js');
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (path, opt) => { const r = await fetch(base + path, { headers: { 'content-type': 'application/json' }, ...opt }); return { status: r.status, body: await r.json().catch(() => null) }; };

  assert.equal((await j('/webhooks/anotaai/errado', { method: 'POST', body: '{}' })).status, 404);
  const pedido = { id: 'T1', total: 80, discount: 10, createdAt: '2026-10-19T12:00:00Z', origin: 'ifood' };
  assert.equal((await j('/webhooks/anotaai/segredo', { method: 'POST', body: JSON.stringify(pedido) })).status, 200);
  await j('/webhooks/anotaai/segredo', { method: 'POST', body: JSON.stringify(pedido) });     // repetido: não duplica
  await j('/webhooks/anotaai/segredo', { method: 'POST', body: JSON.stringify({ sem: 'id' }) }); // inválido: guarda e segue

  const b = (await j('/api/bootstrap')).body;
  assert.equal(b.auto['2026-10'].orders, 1);
  assert.equal(b.auto['2026-10'].channels[0].name, 'iFood');
  assert.ok(b.transactions.length >= 462);

  const nova = (await j('/api/transactions', { method: 'POST', body: JSON.stringify({ date: '2026-10-19', desc: 'teste', value: -10, cat: 'Outros' }) })).body;
  await j(`/api/transactions/${nova.id}`, { method: 'PATCH', body: JSON.stringify({ value: -12.5 }) });
  assert.equal((await j('/api/bootstrap')).body.transactions.find((t) => t.id === nova.id).value, -12.5);
  await j(`/api/transactions/${nova.id}`, { method: 'DELETE' });
  assert.equal((await j('/api/bootstrap')).body.transactions.some((t) => t.id === nova.id), false);

  const s = (await j('/api/bootstrap')).body.settings;
  assert.equal((await j('/api/settings', { method: 'PUT', body: JSON.stringify({ ...s, cfg: { ...s.cfg, targetProfit: 500 } }) })).status, 200);
  assert.equal((await j('/api/bootstrap')).body.settings.cfg.targetProfit, 500);
  assert.equal((await j('/api/settings', { method: 'PUT', body: '{}' })).status, 400);
  assert.deepEqual((await j('/api/orders/reprocess', { method: 'POST' })).body, { ok: 2, failed: 1 });
  // notas de insumos
  const s1 = (await j('/api/supplies', { method: 'POST', body: JSON.stringify({ date: '2026-10-05', supplier: 'Verona', product: 'Queijo mussarela', brand: 'Tirolez', unit: 'kg', quantity: 5, price: 38.9, invoice: '123' }) })).body;
  assert.equal(s1.price, 38.9); assert.equal(s1.quantity, 5);
  const bulk = (await j('/api/supplies', { method: 'POST', body: JSON.stringify({ items: [{ date: '2026-10-06', supplier: 'Muffato', product: 'Tomate', unit: 'kg', quantity: 2, price: 7 }, { date: 'x', product: 'Sem data' }] }) })).body;
  assert.equal(bulk.length, 2); assert.match(bulk[1].date, /^\d{4}-\d{2}-\d{2}$/);
  await j(`/api/supplies/${s1.id}`, { method: 'PATCH', body: JSON.stringify({ quantity: 6, brand: 'Président' }) });
  const list = (await j('/api/supplies')).body;
  assert.equal(list.find((x) => x.id === s1.id).quantity, 6); assert.equal(list.find((x) => x.id === s1.id).brand, 'Président');
  await j(`/api/supplies/${s1.id}`, { method: 'DELETE' });
  assert.equal((await j('/api/supplies')).body.some((x) => x.id === s1.id), false);
  server.close(); (await import('../src/db.js')).pool.end();
});
