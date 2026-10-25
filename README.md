# Dashboard Executivo

Sistema financeiro próprio: Postgres + API (Node/Express) + painel (Angular), publicado só na sua rede
via Tailscale, com webhooks do Anota AI e sincronização automática de extrato via Pluggy (Nubank + Sicredi).

## Visão geral

```
┌──────────┐     ┌───────────┐     ┌──────────┐
│  Pluggy  │────▶│  backend  │────▶│ postgres │
│ (extrato)│     │ (Express) │     │          │
└──────────┘     └─────┬─────┘     └──────────┘
┌──────────┐           │
│ Anota AI │──webhook─▶│
└──────────┘           │
                  ┌─────┴─────┐
                  │  frontend │  (nginx + Angular, login básico)
                  └───────────┘
```

- **Painel**: só acessível pela rede Tailscale (`tailscale serve`), nunca exposto publicamente.
- **Webhooks**: só o caminho `/webhooks/...` é exposto à internet (`tailscale funnel`), com token secreto na URL.
- Imagens Docker são construídas pelo GitHub Actions e publicadas no GHCR a cada push — o servidor só baixa, nunca builda.

## Instalar num servidor novo (Windows → Linux)

Pré-requisito: um servidor Ubuntu ou Debian (físico, VM ou VPS) com acesso SSH, e o Cliente OpenSSH
do Windows habilitado (Configurações → Aplicativos → Recursos opcionais → Adicionar recurso → "Cliente OpenSSH").

1. Clone ou baixe este repositório no seu Windows.
2. Abra a pasta `windows/` e dê duplo clique em **`install.bat`**.
3. Responda as perguntas (endereço do servidor, usuário SSH, `IMAGE_PREFIX` do GHCR, etc.) —
   senhas e tokens que você já tiver configurado antes são reaproveitados automaticamente do `.env` local.
4. O instalador conecta por SSH, envia os arquivos necessários e roda `server/setup.sh` no servidor,
   que instala Docker + Tailscale, baixa as imagens e sobe tudo.
5. No final, ele mostra a URL do painel (só na sua rede Tailscale) e as URLs dos webhooks.
6. Cole a URL do webhook do Anota AI nas configurações de integração do painel do Anota AI.

Rodar o instalador de novo é seguro: atualiza a versão e reconfigura sem apagar dados do banco
nem trocar senhas já definidas.

### Servidor Windows Server em vez de Ubuntu/Debian?

O `server/setup.sh` é feito para Ubuntu/Debian. Em um Windows Server, suba uma VM Ubuntu
(Hyper-V, VMware, ou WSL2 com systemd habilitado) e aponte o instalador para o IP dela.

## Instalar manualmente (Linux, sem o instalador do Windows)

```bash
# no servidor, como root
curl -o setup.sh https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/server/setup.sh   # ou copie o arquivo
cp .env.example ~/.dashboard-install.env   # preencha os valores
cp docker-compose.yml ~/.dashboard-compose.yml
bash setup.sh
```

## Variáveis de ambiente

Veja `.env.example` — nunca commitar o `.env` real (já está no `.gitignore`).

| Variável | Para quê |
|---|---|
| `IMAGE_PREFIX` / `TAG` | De onde baixar as imagens Docker (GHCR) |
| `POSTGRES_PASSWORD` | Senha do banco |
| `DASH_USER` / `DASH_PASSWORD` | Login do painel (HTTP Basic Auth via nginx) |
| `WEBHOOK_TOKEN` | Token secreto na URL dos webhooks — gere com `openssl rand -hex 24` |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` / `PLUGGY_ITEM_IDS` | Credenciais do [Pluggy](https://dashboard.pluggy.ai) (open banking) |
| `WHATSAPP_ENABLED` e demais `WHATSAPP_*` / `EVOLUTION_*` | Alertas por WhatsApp (opcional) — veja a seção abaixo |

## Alertas por WhatsApp (opcional)

Manda um resumo automático pelo WhatsApp quando tem boleto vencido, fatura de cartão perto de vencer, ou
repasse previsto não cobrindo os boletos da semana. Usa o [Evolution API](https://github.com/EvolutionAPI/evolution-api)
(gateway não-oficial, conecta a um número de WhatsApp de verdade via QR code) — serve bem pra alertas internos de
baixo volume; não é o canal oficial da Meta, então não é recomendado para mensagens em massa ou marketing.

1. No `.env`, defina `WHATSAPP_ENABLED=true`, gere `EVOLUTION_API_KEY` e `EVOLUTION_DB_PASSWORD`
   (`openssl rand -hex 24` cada um) e preencha `WHATSAPP_NUMBERS` com os números que devem receber o alerta
   (formato internacional sem símbolos, separados por vírgula: `5544999998888,5544988887777`).
2. Rode o instalador normalmente (`windows/install.bat` ou `server/setup.sh`) — com `WHATSAPP_ENABLED=true`,
   ele já sobe o Evolution API junto.
3. Conecte o número de WhatsApp: abra `https://SEU_SERVIDOR_TAILSCALE:8081` (só acessível pela sua rede
   Tailscale) com o header `apikey: SEU_EVOLUTION_API_KEY`, crie a instância `dashboard` e escaneie o QR code
   com o WhatsApp que vai mandar os alertas (Configurações → Aparelhos conectados, no celular).
4. Pronto — todo dia, no horário definido em `WHATSAPP_ALERT_HOUR` (padrão 8h), o backend confere boletos e
   faturas e manda o resumo. Pra testar na hora sem esperar o horário: `curl -X POST http://127.0.0.1:3000/api/whatsapp/test` no servidor (ou pela rede Tailscale).

Isso não cria lançamentos nem responde mensagens — é só aviso, numa direção só, por enquanto. Um bot que também
recebe comando por WhatsApp ("lança boleto X") é um passo seguinte, mais trabalhoso.

## Desenvolvimento local

```bash
# backend
cd backend && npm install && npm test

# frontend
cd frontend && npm install && npm start
```

## CI/CD

- `.github/workflows/ci.yml`: testa o backend e builda o frontend em cada push/PR.
- `.github/workflows/deploy.yml`: em todo push na `main`, builda e publica as imagens no GHCR
  (reaproveitando o `ci.yml`). O deploy no servidor em si é manual — rode o instalador de novo
  (`windows/install.bat` ou `server/setup.sh`) para atualizar a versão em produção.

## Segurança

- `.env` nunca vai para o Git (`.gitignore` + checagem no CI).
- O painel fica só na rede Tailscale (`tailscale serve`) — jamais use `tailscale funnel` nele.
- Só `/webhooks/...` é público, protegido por token na URL e rate limit por IP.
- Segredos do GHCR/Tailscale usados pelo instalador do Windows nunca ficam salvos em disco —
  são enviados direto ao servidor e descartados depois de usados.
