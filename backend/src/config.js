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
    syncMinutes: Number(process.env.PLUGGY_SYNC_MINUTES ?? 360), // 6h: é só rede de segurança — o webhook é o gatilho principal
    initialDays: Number(process.env.PLUGGY_INITIAL_DAYS ?? 90),
  },
  seedInitial: (process.env.SEED_INITIAL ?? 'true') === 'true',
  assistant: {
    enabled: (process.env.ASSISTANT_ENABLED ?? 'false') === 'true',
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://ollama:11434').replace(/\/+$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b',
  },
  whatsapp: {
    enabled: (process.env.WHATSAPP_ENABLED ?? 'false') === 'true',
    numbers: list(process.env.WHATSAPP_NUMBERS),             // formato internacional sem símbolos, ex: 5544999998888
    alertHour: Number(process.env.WHATSAPP_ALERT_HOUR ?? 8),  // hora do dia (fuso configurado acima) para o resumo diário
    dueSoonDays: Number(process.env.WHATSAPP_DUE_SOON_DAYS ?? 2),
    evolutionUrl: (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, ''),
    evolutionApiKey: process.env.EVOLUTION_API_KEY ?? '',
    evolutionInstance: process.env.EVOLUTION_INSTANCE ?? 'dashboard',
  },
  need,
};
