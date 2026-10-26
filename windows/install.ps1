#requires -Version 5.1
<#
  Instalador do Dashboard Executivo para servidor Linux (Ubuntu/Debian) via SSH + Tailscale.
  Rode via install.bat (duplo clique) ou: powershell -ExecutionPolicy Bypass -File install.ps1

  O que este script faz:
    1. Pergunta os dados do servidor (endereço, usuário SSH) e das chaves do sistema
       (reaproveitando o que já estiver salvo no .env local, na raiz do repositório).
    2. Gera segredos que estiverem faltando (senha do Postgres, senha do painel, token de webhook).
    3. Envia docker-compose.yml, server/setup.sh e a configuração para o servidor via scp.
    4. Roda o setup.sh no servidor (como root) — ele instala Docker, Tailscale, baixa as imagens
       do GHCR e sobe o sistema, publicando o painel só na rede Tailscale e os webhooks publicamente.
    5. Apaga os arquivos de configuração temporários, local e remotamente. Nada de segredo fica
       perdido por aí: tudo volta pro .env local (que nunca vai pro Git) para reaproveitar depois.

  Seguro rodar de novo: atualiza a versão (TAG) e reconfigura sem apagar dados do banco.
#>

$ErrorActionPreference = 'Stop'
# Força UTF-8 na saída do console — sem isso, o Windows PowerShell clássico (5.1) exibe
# acentos quebrados (ex. "EndereÃ§o") em consoles com codepage diferente de UTF-8.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null
} catch { }
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'docker-compose.yml'))) { $Root = $PSScriptRoot }  # fallback se movido pra fora do repo

function Say($msg) { Write-Host "`n==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "!! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

function Read-Default([string]$Prompt, [string]$Default) {
  $shown = if ($Default) { " [$Default]" } else { '' }
  $v = Read-Host "$Prompt$shown"
  if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
  return $v
}

function Read-Secret([string]$Prompt) {
  $sec = Read-Host $Prompt -AsSecureString
  if ($sec.Length -eq 0) { return '' }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function New-RandomSecret([int]$Length = 32) {
  $chars = (48..57) + (65..90) + (97..122)
  -join (1..$Length | ForEach-Object { [char]($chars | Get-Random) })
}

function Read-DotEnv([string]$Path) {
  $map = @{}
  if (Test-Path $Path) {
    foreach ($line in Get-Content $Path) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $k, $v = $line -split '=', 2
      $map[$k.Trim()] = $v
    }
  }
  return $map
}

Write-Host '================================================================' -ForegroundColor Cyan
Write-Host ' Instalador — Dashboard Executivo (servidor Linux + Tailscale)' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan

# ---------- 0. pré-requisitos ----------
foreach ($cmd in 'ssh', 'scp') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "`"$cmd`" não encontrado. No Windows 10/11: Configurações > Aplicativos > Recursos opcionais > Adicionar recurso > `"Cliente OpenSSH`"."
  }
}
if (-not (Test-Path (Join-Path $Root 'docker-compose.yml'))) { Fail "docker-compose.yml não encontrado. Rode este instalador de dentro da pasta do projeto (windows/install.bat)." }

$envPath = Join-Path $Root '.env'
$saved = Read-DotEnv $envPath

# ---------- 1. servidor ----------
Say '1/6 — Dados do servidor'
$ServerHost = Read-Default 'Endereço do servidor (IP ou hostname Tailscale, ex: 100.x.x.x ou servidor.tailnet.ts.net)' ''
if (-not $ServerHost) { Fail 'Endereço do servidor é obrigatório.' }
$SshUser = Read-Default 'Usuário SSH' 'root'
$SshPort = Read-Default 'Porta SSH' '22'
$SshKeyPath = Read-Default 'Caminho da chave privada SSH (em branco = usar senha / chave padrão)' ''
$sshKeyArgs = @()
if ($SshKeyPath) {
  if (-not (Test-Path $SshKeyPath)) { Fail "Chave não encontrada em $SshKeyPath" }
  $sshKeyArgs = @('-i', $SshKeyPath)
}
$sshBase = @('-p', $SshPort) + $sshKeyArgs + @('-o', 'StrictHostKeyChecking=accept-new')

Say 'Testando conexão SSH...'
& ssh @sshBase "$SshUser@$ServerHost" 'echo ok' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail @"
Não consegui conectar em $SshUser@$ServerHost na porta $SshPort. Causas mais comuns:
  - Esse é o IP/hostname da VM ou servidor UBUNTU (não do seu PC Windows)?
  - O Ubuntu Server já está instalado e com o "OpenSSH server" habilitado nele?
  - O usuário existe de verdade NESSA máquina Linux (ex: "ubuntu") — não é o seu usuário do Windows?
  - A VM/servidor está ligada e na mesma rede (dá pra confirmar com: ping $ServerHost)?
Veja o passo a passo no README, seção "Servidor Windows Server em vez de Ubuntu/Debian?".
"@
}
Write-Host 'Conexão OK.'

# ---------- 2. imagens (GHCR) ----------
Say '2/6 — Imagens do GitHub Container Registry'
$ImagePrefix = Read-Default 'IMAGE_PREFIX (ex: ghcr.io/seu-usuario/dashboard)' $saved['IMAGE_PREFIX']
if (-not $ImagePrefix) { Fail 'IMAGE_PREFIX é obrigatório (veja em Settings > Packages no seu repositório GitHub).' }
$Tag = Read-Default 'TAG da imagem' ($(if ($saved['TAG']) { $saved['TAG'] } else { 'latest' }))
$pkgPrivate = Read-Default 'O pacote no GHCR é privado? precisa de login para baixar (s/N)' 'N'
$GhcrUser = ''; $GhcrToken = ''
if ($pkgPrivate -match '^[sS]') {
  $GhcrUser = Read-Default 'Usuário GitHub (dono do token)' ''
  $GhcrToken = Read-Secret 'Token do GitHub com permissão read:packages (não aparece na tela)'
}

# ---------- 3. segredos da aplicação (reaproveita o que já existe) ----------
Say '3/6 — Segredos da aplicação'
$PgPass = $saved['POSTGRES_PASSWORD']; if (-not $PgPass) { $PgPass = New-RandomSecret 32; Write-Host 'Gerada nova senha do Postgres.' } else { Write-Host 'Reaproveitando a senha do Postgres já salva no .env local.' }
$DashUser = Read-Default 'Usuário de login do painel' ($(if ($saved['DASH_USER']) { $saved['DASH_USER'] } else { 'admin' }))
$DashPass = $saved['DASH_PASSWORD']; if (-not $DashPass) { $DashPass = New-RandomSecret 20; Write-Host 'Gerada nova senha do painel.' } else { Write-Host 'Reaproveitando a senha do painel já salva no .env local.' }
$WebhookToken = $saved['WEBHOOK_TOKEN']; if (-not $WebhookToken) { $WebhookToken = New-RandomSecret 48; Write-Host 'Gerado novo WEBHOOK_TOKEN.' } else { Write-Host 'Reaproveitando o WEBHOOK_TOKEN já salvo (as URLs do Anota AI/Pluggy não mudam).' }

$PluggyId = $saved['PLUGGY_CLIENT_ID']; $PluggySecret = $saved['PLUGGY_CLIENT_SECRET']; $PluggyItems = $saved['PLUGGY_ITEM_IDS']
if (-not $PluggyId) {
  $usePluggy = Read-Default 'Configurar o Pluggy agora? (s/N)' 'N'
  if ($usePluggy -match '^[sS]') {
    $PluggyId = Read-Default 'PLUGGY_CLIENT_ID' ''
    $PluggySecret = Read-Secret 'PLUGGY_CLIENT_SECRET (não aparece na tela)'
    $PluggyItems = Read-Default 'PLUGGY_ITEM_IDS (separados por vírgula)' ''
  }
} else { Write-Host 'Reaproveitando as credenciais do Pluggy já salvas no .env local.' }

# ---------- 4. Tailscale ----------
Say '4/6 — Tailscale'
Write-Host 'Se o servidor já está na sua rede Tailscale, deixe em branco (o setup pede pra autorizar pelo navegador).'
$TsAuthKey = Read-Secret 'Chave de autenticação Tailscale (opcional, não aparece na tela)'

# ---------- monta os arquivos ----------
$installEnvLines = @(
  "IMAGE_PREFIX=$ImagePrefix"
  "TAG=$Tag"
  "POSTGRES_PASSWORD=$PgPass"
  "DASH_USER=$DashUser"
  "DASH_PASSWORD=$DashPass"
  "WEBHOOK_TOKEN=$WebhookToken"
  "PLUGGY_CLIENT_ID=$PluggyId"
  "PLUGGY_CLIENT_SECRET=$PluggySecret"
  "PLUGGY_ITEM_IDS=$PluggyItems"
  'PLUGGY_SYNC_MINUTES=15'
  'PLUGGY_INITIAL_DAYS=90'
  'SEED_INITIAL=true'
)
if ($GhcrUser) { $installEnvLines += "GHCR_USER=$GhcrUser"; $installEnvLines += "GHCR_TOKEN=$GhcrToken" }
if ($TsAuthKey) { $installEnvLines += "TS_AUTHKEY=$TsAuthKey" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("dash-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $installEnvFile = Join-Path $tmp 'install.env'
  Set-Content -Path $installEnvFile -Value $installEnvLines -NoNewline:$false -Encoding utf8

  Say '5/6 — Enviando arquivos para o servidor'
  & scp @sshBase (Join-Path $Root 'docker-compose.yml') "${SshUser}@${ServerHost}:~/.dashboard-compose.yml"
  if ($LASTEXITCODE -ne 0) { Fail 'Falha ao enviar docker-compose.yml.' }
  & scp @sshBase (Join-Path $Root 'server/setup.sh') "${SshUser}@${ServerHost}:~/setup.sh"
  if ($LASTEXITCODE -ne 0) { Fail 'Falha ao enviar setup.sh.' }
  & scp @sshBase $installEnvFile "${SshUser}@${ServerHost}:~/.dashboard-install.env"
  if ($LASTEXITCODE -ne 0) { Fail 'Falha ao enviar a configuração.' }
}
finally {
  Remove-Item -Recurse -Force $tmp  # segredos não ficam no disco local depois do envio
}

# ---------- roda o setup no servidor ----------
Say '6/6 — Rodando o instalador no servidor (pode levar alguns minutos)'
& ssh @sshBase -t "$SshUser@$ServerHost" 'chmod +x ~/setup.sh && sudo INSTALL_ENV=$HOME/.dashboard-install.env bash ~/setup.sh'
$setupExit = $LASTEXITCODE

# ---------- salva localmente pra reaproveitar da próxima vez (sem GHCR/Tailscale, que não devem persistir) ----------
$localEnvLines = @(
  '# Gerado/atualizado pelo instalador do Windows. NUNCA commitar (já está no .gitignore).'
  "IMAGE_PREFIX=$ImagePrefix"
  "TAG=$Tag"
  "POSTGRES_PASSWORD=$PgPass"
  "DASH_USER=$DashUser"
  "DASH_PASSWORD=$DashPass"
  "WEBHOOK_TOKEN=$WebhookToken"
  "PLUGGY_CLIENT_ID=$PluggyId"
  "PLUGGY_CLIENT_SECRET=$PluggySecret"
  "PLUGGY_ITEM_IDS=$PluggyItems"
  'PLUGGY_SYNC_MINUTES=15'
  'PLUGGY_INITIAL_DAYS=90'
  'SEED_INITIAL=true'
)
Set-Content -Path $envPath -Value $localEnvLines -Encoding utf8
Write-Host "`nConfiguração salva em $envPath para reaproveitar na próxima vez que rodar o instalador."

if ($setupExit -ne 0) { Fail 'O setup no servidor terminou com erro — veja as mensagens acima.' }

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host ' Pronto! Veja acima as URLs do painel e dos webhooks.' -ForegroundColor Cyan
Write-Host ' Cole a URL do webhook do Anota AI nas configurações de integração do Anota AI.' -ForegroundColor Cyan
Write-Host '================================================================' -ForegroundColor Cyan
