import { q } from './db.js';
import { parseOrder } from './anotaai.js';
import { config } from './config.js';

async function fees() {
  const r = await q("select value from settings where key='app'");
  return r.rows[0]?.value?.cfg?.fees ?? {};
}

export async function saveOrder(payload) {
  const o = parseOrder(payload, await fees());
  await q(
    `insert into orders (external_id, placed_at, channel, status, canceled, gross, discount, fee, net)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (external_id) do update set placed_at=excluded.placed_at, channel=excluded.channel, status=excluded.status,
       canceled=excluded.canceled, gross=excluded.gross, discount=excluded.discount, fee=excluded.fee, net=excluded.net, updated_at=now()`,
    [o.externalId, o.placedAt, o.channel, o.status, o.canceled, o.gross, o.discount, o.fee, o.net]);
  return o;
}

export async function reprocessOrders() {
  const { rows } = await q("select id, payload from webhook_events where source='anotaai' order by id");
  let ok = 0, failed = 0;
  for (const ev of rows) {
    try { await saveOrder(ev.payload); await q('update webhook_events set processed=true, error=null where id=$1', [ev.id]); ok++; }
    catch (e) { await q('update webhook_events set processed=false, error=$2 where id=$1', [ev.id, e.message]); failed++; }
  }
  return { ok, failed };
}

/** Totais por competência e canal, no fuso do restaurante, sem pedidos cancelados. */
export async function autoSales() {
  const { rows } = await q(
    `select to_char(placed_at at time zone $1, 'YYYY-MM') as month, channel,
            sum(net)::float8 as net, sum(discount + fee)::float8 as discounts, count(*)::int as orders
       from orders where not canceled group by 1, 2 order by 1, 2`, [config.timezone]);
  const out = {};
  for (const r of rows) {
    const m = (out[r.month] ??= { channels: [], discounts: 0, orders: 0 });
    m.channels.push({ name: r.channel, net: r.net });
    m.discounts += r.discounts; m.orders += r.orders;
  }
  return out;
}
