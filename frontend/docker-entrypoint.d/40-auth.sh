#!/bin/sh
# Senha do painel (HTTP Basic) gerada a partir de DASH_USER/DASH_PASSWORD, sem gravar nada na imagem.
if [ -n "$DASH_PASSWORD" ]; then
  printf '%s:%s\n' "${DASH_USER:-admin}" "$(openssl passwd -apr1 "$DASH_PASSWORD")" > /etc/nginx/.htpasswd
  printf 'auth_basic "Dashboard";\nauth_basic_user_file /etc/nginx/.htpasswd;\n' > /etc/nginx/auth.conf
else
  echo "AVISO: DASH_PASSWORD vazio. O painel fica sem senha (acesso só pela rede Tailscale)."
  : > /etc/nginx/auth.conf
fi
