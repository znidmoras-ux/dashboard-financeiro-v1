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

O `server/setup.sh` é feito para Ubuntu/Debian, não para Windows. A forma mais simples e mais
estável de rodar isso num Windows Server é criar uma **VM Ubuntu dentro dele com o Hyper-V**
(já vem com o Windows Server, não precisa instalar nada de fora) e apontar o instalador pra essa VM.
O sistema roda na VM; o Windows Server só hospeda ela.

Passo a passo completo, com um exemplo do início ao fim (troque os nomes/IPs pelos seus):

#### 1. Ativar o Hyper-V no Windows Server

No **PowerShell como Administrador**, no próprio Windows Server:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools -Restart
```

O servidor reinicia sozinho. Depois de voltar, abra **Gerenciador do Hyper-V**
(`virtmgmt.msc` ou procure "Hyper-V Manager" no menu Iniciar) para confirmar que instalou.

#### 2. Criar uma rede virtual que sai pra sua rede local (vSwitch externo)

Isso é o que permite a VM pegar um IP da sua rede normal (a mesma do roteador/switch),
pra você — e o Tailscale — conseguirem alcançá-la depois.

No Gerenciador do Hyper-V: **Gerenciador de Comutador Virtual** (menu da direita) →
**Novo comutador de rede virtual** → tipo **Externo** → escolha a placa de rede física do
servidor (ex.: `Ethernet`) → nomeie como `vSwitch-Externo` → OK.

> Isso derruba a rede do servidor por alguns segundos enquanto reconfigura — normal, não precisa se preocupar.

#### 3. Baixar a imagem do Ubuntu Server

Baixe o **Ubuntu Server 24.04 LTS** (`.iso`) em https://ubuntu.com/download/server
e salve em algo como `C:\ISOs\ubuntu-24.04-server.iso`.

#### 4. Criar a VM

No Gerenciador do Hyper-V, clique com o botão direito no servidor → **Novo → Máquina Virtual**:

| Tela do assistente | O que escolher (exemplo) |
|---|---|
| Nome | `ubuntu-dashboard` |
| Geração | **Geração 2** |
| Memória inicial | `4096` MB, com **Memória Dinâmica** marcada (mín. 2048 / máx. 6144 é um bom intervalo) |
| Rede | `vSwitch-Externo` (o que você criou no passo 2) |
| Disco rígido virtual | Novo, 40 GB, em `C:\VMs\ubuntu-dashboard\disco.vhdx` |
| Opções de instalação | "Instalar um sistema operacional de um CD/DVD-ROM de inicialização" → aponte pro `.iso` do passo 3 |

Depois de criado, antes de ligar: clique com o botão direito na VM → **Configurações** →
**Segurança** → **desmarque** "Ativar Inicialização Segura" (o instalador do Ubuntu às vezes
precisa disso desligado; se o Ubuntu bootar normalmente com a opção ligada, pode deixar).

#### 5. Instalar o Ubuntu Server na VM

Clique duas vezes na VM pra abrir a tela dela (Conectar) e **Iniciar**. O instalador do Ubuntu abre:

- Idioma, teclado: como preferir.
- **Network connections**: deixe pegando IP automático (DHCP) — anote o IP que aparecer, ex. `192.168.1.50`.
  (Melhor ainda: reserve esse IP pro endereço MAC da VM no seu roteador/DHCP, pra ele nunca mudar.)
- **Profile setup**: crie um usuário, ex. usuário `ubuntu`, nome do servidor (hostname) `dashboard`.
- **SSH Setup**: marque **"Install OpenSSH server"** — isso é essencial, é por aqui que o instalador do Windows vai conectar depois.
- **Featured Server Snaps**: pode pular tudo (não marque Docker aqui — quem instala o Docker certinho é o nosso `setup.sh`).
- Deixe terminar a instalação, **Reboot Now**, e quando pedir "Please remove the installation medium" dê Enter.

Depois que reiniciar e aparecer a tela de login, confirme o IP:

```bash
ip a
```

Procure a linha da interface principal (geralmente `eth0`), algo como `inet 192.168.1.50/24`. É esse IP que você vai usar no passo 7.

#### 6. Testar o acesso SSH a partir do Windows Server

De volta no **PowerShell do Windows Server** (não dentro da VM):

```powershell
ssh ubuntu@192.168.1.50
```

Na primeira vez ele pergunta se confia na chave do host — digite `yes`. Se pedir senha e você
conseguir entrar, está tudo certo; digite `exit` para sair e seguir pro próximo passo.

> Se der "ssh não é reconhecido": ative o Cliente OpenSSH do Windows em
> Configurações → Aplicativos → Recursos opcionais → Adicionar recurso → **Cliente OpenSSH**.

#### 7. Rodar o instalador do dashboard, apontando pra VM

Ainda no Windows Server (ou em qualquer PC Windows da mesma rede):

1. Baixe/clone este repositório.
2. Abra a pasta `windows\` e dê duplo clique em **`install.bat`**.
3. Quando perguntar o **endereço do servidor**, responda `192.168.1.50` (o IP da VM, não do Windows Server).
4. Usuário SSH: `ubuntu` (o que você criou no passo 5).
5. Responda o resto (`IMAGE_PREFIX` do GHCR, token do Pluggy, etc.) — veja a seção
   [Instalar num servidor novo](#instalar-num-servidor-novo-windows--linux) acima para o que cada campo significa.

O instalador conecta na VM por SSH, copia os arquivos, instala Docker + Tailscale **dentro da VM**
e sobe o sistema lá.

#### 8. Conferir que subiu

No fim o instalador mostra a URL do painel (algo como `https://dashboard.sua-rede.ts.net:8443/`,
só acessível pela sua rede Tailscale) e as URLs dos webhooks. Abra a URL do painel num navegador
pra confirmar que está no ar.

#### Alternativas ao Hyper-V

- **VMware Workstation/ESXi**: mesma ideia — crie uma VM Ubuntu Server com rede em modo bridge
  (pra pegar IP da rede local) e siga a partir do passo 5 acima.
- **WSL2**: veja a seção abaixo — mais rápido de montar, mas só recomendado pra testar, não para produção.

### Testar rápido no Windows 10/11 com WSL2 (sem criar VM)

Pra só testar o sistema agora, sem passar pelo Hyper-V, dá pra rodar dentro do **WSL2**
(o "Linux dentro do Windows"), direto no mesmo PC onde você vai rodar o `install.bat`.
**Não é recomendado deixar assim de vez** — se o PC reiniciar, hibernar ou desligar, o sistema
para até você abrir o Ubuntu do WSL de novo. Quando quiser algo permanente, migre para a
VM Hyper-V (acima) ou um servidor/VPS de verdade — o `install.bat` funciona igual, só muda o endereço.

1. **Instalar o WSL com Ubuntu** — PowerShell **como Administrador**:
   ```powershell
   wsl --install -d Ubuntu-24.04
   ```
   Reinicia se pedir. Depois, abra **"Ubuntu"** no menu Iniciar — na primeira vez ele pede pra
   criar um usuário e senha Linux (ex.: usuário `ubuntu`). **Anote esse usuário**, é o que vai
   usar no instalador.

2. **Ativar o systemd dentro do WSL** (o `setup.sh` precisa dele para gerenciar Docker/Tailscale/SSH).
   Dentro da janela do Ubuntu:
   ```bash
   sudo tee /etc/wsl.conf > /dev/null <<'EOF'
   [boot]
   systemd=true
   EOF
   ```
   Feche a janela do Ubuntu. No **PowerShell** (fora do WSL):
   ```powershell
   wsl --shutdown
   ```
   Abra o **"Ubuntu"** de novo no menu Iniciar — ele reinicia já com o systemd ativo.

3. **Instalar e ligar o SSH dentro do WSL** (é por aqui que o instalador do Windows vai conectar):
   ```bash
   sudo apt update && sudo apt install -y openssh-server
   sudo systemctl enable --now ssh
   sudo systemctl status ssh   # confirme que aparece "active (running)"
   ```

4. **Rodar o instalador** — no Windows, abra a pasta `windows\` e dê duplo clique em **`install.bat`**:
   - Endereço do servidor: **`localhost`** (o WSL2 encaminha automaticamente pro Windows local;
     se não conectar, use o IP que aparece em `ip a` dentro do Ubuntu — algo como `172.x.x.x`).
   - Usuário SSH: o que você criou no passo 1 (ex.: `ubuntu`).
   - Porta SSH: `22` (padrão).
   - O resto, responda normalmente (veja a seção [Instalar num servidor novo](#instalar-num-servidor-novo-windows--linux) acima).

5. Ele instala Docker + Tailscale **dentro do WSL** e sobe o sistema lá, igual numa VM de verdade.

> Pra rodar de novo depois de reiniciar o PC: abra o app **"Ubuntu"** no menu Iniciar (isso
> acorda o WSL e os serviços voltam sozinhos, graças ao systemd) antes de tentar acessar o painel.

#### Atualizar depois

Pra atualizar a versão mais tarde, rode o `windows\install.bat` de novo com o mesmo IP da VM —
é seguro, não apaga dados do banco nem troca senhas já definidas.

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
| `ASSISTANT_ENABLED` / `OLLAMA_MODEL` | Chat local de dicas de gestão (opcional) — veja a seção abaixo |

## Assistente de gestão por chat (opcional)

O chat usa o Ollama no próprio servidor, sem cobrança por chamada nem envio de indicadores a um provedor de IA.
O modelo padrão é `qwen2.5:1.5b`; ele exige memória e CPU do servidor e pode responder mais devagar. O contexto
enviado contém somente indicadores resumidos do painel, não lançamentos individuais do extrato. As respostas
são informativas e devem ser conferidas.

1. No `.env` do servidor, defina `ASSISTANT_ENABLED=true` e `OLLAMA_MODEL=qwen2.5:1.5b`.
2. Na pasta `/opt/dashboard`, baixe e inicie o serviço:
   ```bash
   sudo docker compose --profile assistant pull ollama backend frontend
   sudo docker compose --profile assistant up -d ollama backend frontend
   ```
3. Baixe o modelo (a primeira vez pode demorar e requer internet):
   ```bash
   sudo docker compose exec ollama ollama pull qwen2.5:1.5b
   ```
4. Abra ou recarregue o painel e selecione **Assistente IA**. Sem o perfil habilitado, o restante do dashboard
   continua funcionando normalmente.

O volume Docker `ollama_data` mantém o modelo após reinicializações. Para desativar, mude
`ASSISTANT_ENABLED=false` no `.env` e recrie o backend; não remova o volume se quiser manter o modelo baixado.

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
- O deploy automático usa os secrets `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_USER` e
  `DEPLOY_HOST`. `DEPLOY_HOST` deve ser o IP Tailscale do servidor (`100.x.y.z`) ou seu hostname
  MagicDNS — não o IP público/LAN. O usuário e a tag `tag:ci` também precisam estar autorizados
  pela política SSH da tailnet. O workflow resolve o destino para o IP Tailscale antes de abrir o SSH.

## Segurança

- `.env` nunca vai para o Git (`.gitignore` + checagem no CI).
- O painel fica só na rede Tailscale (`tailscale serve`) — jamais use `tailscale funnel` nele.
- Só `/webhooks/...` é público, protegido por token na URL e rate limit por IP.
- Segredos do GHCR/Tailscale usados pelo instalador do Windows nunca ficam salvos em disco —
  são enviados direto ao servidor e descartados depois de usados.
