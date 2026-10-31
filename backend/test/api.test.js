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

  // fotos anexadas (lançamento rápido pelo celular)
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  assert.equal((await j('/api/attachments', { method: 'POST', body: JSON.stringify({ dataUrl: 'lixo' }) })).status, 400);
  const foto = (await j('/api/attachments', { method: 'POST', body: JSON.stringify({ dataUrl: pixel }) })).body;
  assert.ok(Number.isInteger(foto.id));
  const r2 = await fetch(`${base}/api/attachments/${foto.id}`);
  assert.equal(r2.status, 200); assert.equal(r2.headers.get('content-type'), 'image/png');
  assert.equal((await r2.arrayBuffer()).byteLength > 0, true);
  assert.equal((await j('/api/attachments/999999')).status, 404);

  // nota de insumo com foto anexada
  const s2 = (await j('/api/supplies', { method: 'POST', body: JSON.stringify({ date: '2026-10-07', supplier: 'Verona', product: 'Pão', quantity: 10, price: 1.5, photoId: foto.id }) })).body;
  assert.equal(s2.photoId, foto.id);

  // boleto lançado pelo celular (rota dedicada, sem passar pelo PUT /api/settings inteiro)
  assert.equal((await j('/api/bills', { method: 'POST', body: JSON.stringify({ amount: 0 }) })).status, 400);
  const bill = (await j('/api/bills', { method: 'POST', body: JSON.stringify({ supplier: 'Energia', amount: 250.5, dueDate: '2026-11-05', photoId: foto.id }) })).body;
  assert.equal(bill.status, 'aberto'); assert.equal(bill.source, 'celular'); assert.equal(bill.photoId, foto.id);
  assert.ok((await j('/api/bootstrap')).body.settings.bills.some((x) => x.id === bill.id));

  // condição de corrida: um save do painel (com settings "desatualizados", sem o boleto do celular)
  // não pode apagar o boleto recém-lançado pelo celular
  const s3 = (await j('/api/bootstrap')).body.settings;
  const semBoleto = { ...s3, bills: s3.bills.filter((x) => x.id !== bill.id) }; // simula painel que carregou antes do boleto existir
  await j('/api/settings', { method: 'PUT', body: JSON.stringify(semBoleto) });
  assert.ok((await j('/api/bootstrap')).body.settings.bills.some((x) => x.id === bill.id), 'boleto do celular não deveria ter sido apagado pelo save do painel');

  server.close(); (await import('../src/db.js')).pool.end();
});
