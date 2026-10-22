// Converte o payload do webhook da Anota AI em um pedido padronizado.
// O formato exato pode variar por conta/versão: o payload bruto é guardado em webhook_events,
// então, se algum campo vier diferente, ajuste só este arquivo e use POST /api/orders/reprocess.

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const pick = (o, keys) => { for (const k of keys) { const v = k.split('.').reduce((a, p) => a?.[p], o); if (v != null && v !== '') return v; } return undefined; };

export function channelName(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'Anota AI';
  if (/ifood/i.test(s)) return 'iFood';
  if (/^(anota|whats|site|cardapio|cardápio|app\b|balc|pdv|loja|proprio|próprio)/i.test(s)) return 'Anota AI';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseOrder(payload, fees = {}) {
  const o = payload?.order ?? payload?.data ?? payload?.pedido ?? payload ?? {};
  const externalId = pick(o, ['id', '_id', 'order_id', 'orderId', 'shortReference', 'short_id', 'code', 'numero']);
  if (externalId == null) throw new Error('Pedido sem identificador');
  const placedRaw = pick(o, ['createdAt', 'created_at', 'createdDate', 'date', 'data', 'dateTime', 'timestamp']);
  const placed = placedRaw ? new Date(placedRaw) : new Date();
  if (Number.isNaN(placed.getTime())) throw new Error('Data do pedido inválida: ' + placedRaw);

  const total = num(pick(o, ['total', 'totalPrice', 'total_price', 'valor_total', 'amount', 'value', 'payment.total']));
  const discount = num(pick(o, ['discount', 'desconto', 'discounts.total', 'totalDiscount']));
  const subtotal = num(pick(o, ['subtotal', 'subTotal', 'itemsTotal']));
  const gross = subtotal > 0 ? subtotal : total + discount;
  const channel = channelName(pick(o, ['channel', 'origin', 'origem', 'from', 'source', 'salesChannel', 'marketplace']));
  const status = String(pick(o, ['status', 'situacao', 'state']) ?? '');
  const canceled = o.canceled === true || o.cancelled === true || /cancel|rejeit|recus|negad/i.test(status) || o.check === -1;
  const feePct = Number(fees[channel] ?? 0);
  const fee = Math.round(gross * feePct) / 100;
  const net = Math.round((gross - discount - fee) * 100) / 100;
  return { externalId: String(externalId), placedAt: placed.toISOString(), channel, status, canceled, gross, discount, fee, net };
}
