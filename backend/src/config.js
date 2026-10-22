// Toda configuração vem de variáveis de ambiente (arquivo .env no servidor, nunca no repositório).
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${k}`); return v; };
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? `postgres://${process.env.POSTGRES_USER ?? 'dashboard'}:${process.env.POSTGRES_PASSWORD ?? ''}@${process.env.POSTGRES_HOST ?? 'db'}:5432/${process.env.POSTGRES_DB ?? 'dashboard'}`,
  timezone: process.env.TZ_NAME ?? 'America/Sao_Paulo',
  webhookToken: process.env.WEBHOOK_TOKEN ?? '',
  pluggy: {
    clientId: process.env.PLUGGY_CLIENT_ID ?? '',
    clientSecret: process.env.PLUGGY_CLIENT_SECRET ?? '',
    itemIds: list(process.env.PLUGGY_ITEM_IDS),
    syncMinutes: Number(process.env.PLUGGY_SYNC_MINUTES ?? 15),
    initialDays: Number(process.env.PLUGGY_INITIAL_DAYS ?? 90),
  },
  seedInitial: (process.env.SEED_INITIAL ?? 'true') === 'true',
  need,
};
