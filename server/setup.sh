#!/usr/bin/env bash
# Prepara um servidor Ubuntu/Debian: Docker, Tailscale, sistema no ar e publicação segura (Serve + Funnel).
# Roda como root (o instalador chama com sudo). É seguro rodar de novo: não recria segredos nem apaga dados.
set -euo pipefail

INPUT="${INSTALL_ENV:-$HOME/.dashboard-install.env}"
APP=/opt/dashboard
say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Rode como root (sudo)."; exit 1; }
[ -f "$INPUT" ] || { echo "Arquivo de configuração $INPUT não encontrado."; exit 1; }

. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "Este instalador é para Ubuntu ou Debian (encontrado: ${ID:-desconhecido}). No Windows Server, use uma VM Ubuntu ou WSL2: veja o README."; exit 1;; esac

get() { grep -E "^$1=" "$INPUT" | head -1 | cut -d= -f2-; }

say "1/6 Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

say "2/6 Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi
if ! tailscale status >/dev/null 2>&1; then
  KEY="$(get TS_AUTHKEY || true)"
  # Sem tag por padrão: "--advertise-tags" só funciona se a tag já estiver cadastrada na política (ACL)
  # da sua conta Tailscale — a maioria das contas pessoais não tem isso configurado, e tentar usa uma
  # tag inexistente derruba a autorização. Quem quiser usar tags configura manualmente depois.
  if [ -n "$KEY" ]; then
    tailscale up --ssh --authkey="$KEY"
  else
    echo "Abra o link abaixo no navegador para autorizar este servidor na sua rede Tailscale:"
    tailscale up --ssh
  fi
else
  tailscale set --ssh || true
fi
HOST="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

say "3/6 Arquivos do sistema em $APP"
mkdir -p "$APP/backups"
install -m 0644 "$HOME/.dashboard-compose.yml" "$APP/docker-compose.yml"
touch "$APP/.env"; chmod 600 "$APP/.env"
# Só acrescenta o que falta: segredos já existentes nunca são trocados. IMAGE_PREFIX e TAG sempre atualizam.
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue;; GHCR_*|TS_AUTHKEY=*) continue;; esac
  k="${line%%=*}"
  if grep -q "^$k=" "$APP/.env"; then
    case "$k" in IMAGE_PREFIX|TAG) sed -i "s|^$k=.*|$line|" "$APP/.env";; esac
  else
    echo "$line" >> "$APP/.env"
  fi
done < "$INPUT"

say "4/6 Baixando imagens e subindo o sistema"
cd "$APP"
GU="$(get GHCR_USER || true)"; GT="$(get GHCR_TOKEN || true)"
if [ -n "$GT" ]; then printf '%s' "$GT" | docker login ghcr.io -u "$GU" --password-stdin; fi
PROFILE=()
if [ "$(get WHATSAPP_ENABLED || true)" = "true" ]; then
  getenv() { grep -E "^$1=" "$APP/.env" | head -1 | cut -d= -f2-; }
  EK="$(getenv EVOLUTION_API_KEY || true)"; EP="$(getenv EVOLUTION_DB_PASSWORD || true)"
  if [ -z "$EK" ] || [ "$EK" = "troque-me" ] || [ -z "$EP" ] || [ "$EP" = "troque-me" ]; then
    echo "WHATSAPP_ENABLED=true mas EVOLUTION_API_KEY/EVOLUTION_DB_PASSWORD não estão definidos em $APP/.env."
    echo "Gere com: openssl rand -hex 24 (para cada um) e preencha no .env antes de rodar de novo."
    exit 1
  fi
  PROFILE=(--profile whatsapp)
fi
docker compose "${PROFILE[@]}" pull
docker compose "${PROFILE[@]}" up -d --remove-orphans
[ -n "$GT" ] && docker logout ghcr.io >/dev/null || true
rm -f "$INPUT" "$HOME/.dashboard-compose.yml"

say "5/6 Esperando a API responder"
OK=0
for i in $(seq 1 40); do
  if docker compose exec -T backend wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"ok":true'; then OK=1; break; fi
  sleep 3
done
[ "$OK" = 1 ] || { warn "A API não respondeu. Veja: cd $APP && docker compose logs backend"; exit 1; }

say "6/6 Publicando"
TOKEN="$(grep -E '^WEBHOOK_TOKEN=' "$APP/.env" | cut -d= -f2-)"
# Painel: só pela rede Tailscale (porta 8443). Webhooks: Funnel público, somente o caminho /webhooks (porta 443).
tailscale serve --bg --https=8443 http://127.0.0.1:8080 >/dev/null
if tailscale funnel --bg --https=443 --set-path=/webhooks http://127.0.0.1:8080/webhooks >/dev/null 2>&1; then
  FUNNEL=ok
else
  FUNNEL=falhou
  warn "Não consegui ativar o Funnel. Ative HTTPS e o Funnel para este servidor no painel do Tailscale (veja o README) e rode de novo."
fi

echo
echo "================================================================"
echo " Painel (só na sua rede Tailscale):  https://$HOST:8443/"
echo " Webhook Anota AI:  https://$HOST/webhooks/anotaai/$TOKEN"
echo " Webhook Pluggy:    https://$HOST/webhooks/pluggy/$TOKEN"
echo " Funnel: $FUNNEL"
echo "================================================================"
if [ "$FUNNEL" = ok ]; then
  CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST "https://$HOST/webhooks/anotaai/token-errado" || true)"
  echo " Teste de alcance público do webhook (esperado 404): $CODE"
  CODE2="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$HOST/api/bootstrap" || true)"
  echo " O painel NÃO pode estar público (esperado 404 ou falha): $CODE2"
fi
