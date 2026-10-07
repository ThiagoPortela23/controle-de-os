# Central de Serviços

Aplicação em Node.js 24, Express 5, React, TypeScript e PostgreSQL 17. Interface em português, responsiva, com autorização no backend, PDF e aceite por email/QR code.

## Chamados, dashboard e preferências

Todos os perfis entram em **Chamados** (`/ordens`); o endereço `/` redireciona para essa tela. O solicitante abre e acompanha somente suas OS, com filtros de data e número. Técnicos consultam seus atendimentos. Administradores também acessam **Dashboard** e **Usuários** pelo menu.

Novos chamados têm título de 3 a 50 caracteres e descrição de 5 a 255 caracteres, após remover espaços das extremidades. Contadores aparecem no formulário; a API também valida os limites. Cada solicitante pode abrir até **10 chamados bem-sucedidos nos últimos 60 minutos**, independentemente de dispositivo ou reinício da aplicação. Ao atingir a quota, a API retorna HTTP 429, `Retry-After` e `retryAfterSeconds`. Registros antigos com textos maiores permanecem íntegros. Consultas de OS, PDF e dashboard compartilham um limite de 120 requisições por minuto por usuário, por instância do backend.

O **Dashboard** é exclusivo do administrador. Escolha ano e mês e clique em **Aplicar período**:

- **Chamados hoje:** aberturas do dia atual em Brasília, independentemente do filtro.
- **Chamados no mês:** aberturas no mês escolhido; reaberturas não criam outra OS.
- **Abertos, atribuídos e aceites pendentes:** situação atual de toda a fila, independentemente do período.
- **Top 5 atribuídos:** OS atualmente atribuídas e ainda aguardando resolução, de todos os meses.
- **Top 5 resolvidos:** OS atualmente resolvidas cuja última resolução aconteceu no mês selecionado. Uma recusa/reabertura retira a OS desta contagem; uma nova resolução usa a nova data e o novo técnico.
- **Gráfico mensal:** aberturas e resoluções dos 12 meses do ano escolhido; meses sem registros mostram zero. Os valores também estão disponíveis em **Ver dados do gráfico**.

Rankings incluem técnicos desativados quando ainda houver atendimentos pertinentes e desempates usam nome e ID. Os totais são calculados em uma única leitura do PostgreSQL. Datas usam `America/Sao_Paulo`; o relógio avança no navegador sem consultas adicionais, e o total diário é atualizado na virada do dia.

A lista, os detalhes e o dashboard recebem atualizações por **SSE** (`/api/events`). O backend mantém uma conexão PostgreSQL `LISTEN` por instância; triggers enviam notificações somente após o commit. Alterações de envio do email também atualizam os detalhes. Cada perfil recebe apenas eventos autorizados, inclusive o técnico que perde uma atribuição. A interface agrupa atualizações por 300 ms, preservando filtros e campos em edição. Ao reconectar, consulta novamente a situação atual; não há reprodução de eventos antigos. O estado da conexão aparece no menu.

São permitidas até três telas conectadas por usuário em cada instância do backend. Sessões são verificadas em lote a cada 30 segundos; expiração ou desativação encerra a atualização. Se houver reverse proxy, mantenha o streaming sem buffering e permita conexões duradouras para `/api/events`.

No cabeçalho, o administrador pode clicar em **Ativar som**. Um aviso sonoro toca para novas OS recebidas enquanto aquela aba estiver conectada. Atribuições, resoluções, carregamentos e reconexões não reproduzem esse aviso. **Desativar som** interrompe os alertas; após recarregar a página é necessário ativá-los novamente, respeitando a política de áudio do navegador.

Todos os usuários podem alternar **Tema claro/escuro**, inclusive no login e na confirmação pública. A preferência fica em `localStorage` por usuário e navegador; não acompanha outros dispositivos. Sem preferência salva, segue o tema do sistema operacional. Páginas públicas têm uma preferência própria.

## Executar com Docker

Requisitos: Docker Engine/Desktop com containers Linux e Docker Compose v2 ou superior.

No PowerShell, dentro do projeto:

```powershell
Copy-Item .env.example .env
```

Edite `.env`: defina `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` e um `SESSION_SECRET` aleatório de pelo menos 32 caracteres. Para gerar um segredo:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

O Compose calcula a conexão do container com o banco. Para executar Node fora do Docker, mantenha `DATABASE_URL` consistente com a senha do banco; caracteres especiais na senha precisam de URL encoding.

```powershell
docker compose up --build -d
docker compose ps
docker compose logs app
```

- Aplicação: http://localhost:3000
- Emails de teste no Mailpit: http://localhost:8025
- O administrador inicial vem das variáveis `ADMIN_*`. A primeira entrada exige trocar a senha.
- Migrations são aplicadas automaticamente antes da aplicação iniciar. O bootstrap não altera senhas de contas existentes.
- O volume `postgres_data` preserva dados entre reinicializações. `docker compose down` preserva esse volume; não use `--volumes` para parar uma instância com dados que deseja manter.

### Docker no Windows: engine e portas

Ter `docker` no PATH disponibiliza o comando; o Docker Desktop também precisa iniciar seu engine Linux. Confira:

```powershell
docker --version
docker compose version
docker info
docker compose config --quiet
```

Se o Docker Desktop informar `Virtual Machine Platform not enabled`, habilite esse recurso em um PowerShell aberto como administrador:

```powershell
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

Reinicie o Windows para aplicar o recurso, abra o Docker Desktop e verifique novamente `docker info`. O backend WSL 2 também exige WSL atualizado e virtualização habilitada no BIOS/UEFI. Consulte os [requisitos do Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) e a [ativação da Virtual Machine Platform pela Microsoft](https://learn.microsoft.com/en-us/windows/wsl/install-manual#step-3---enable-virtual-machine-feature).

O banco do Compose usa a porta local `5433` por padrão para evitar conflito com outro PostgreSQL na porta `5432`. Configure `POSTGRES_PORT` no `.env` se precisar de outra porta. A comunicação entre os containers continua usando `db:5432`; no desenvolvimento com Node fora do Docker, ajuste a porta em `DATABASE_URL` para o mesmo valor de `POSTGRES_PORT`.

## Perfis e atendimento

- **Solicitante:** abre OS com título e descrição, consulta suas ordens e baixa PDFs.
- **Técnico:** consulta OS atribuídas a ele e registra a solução. Não pode resolver OS de outro técnico.
- **Administrador:** cria contas, redefine senhas temporárias, ativa/desativa usuários e atribui/reatribui técnicos. Não resolve OS no lugar do técnico.

Fluxo: **aberto**, **atribuído a [técnico]**, **resolvido por [técnico]**. O aceite permanece separado do status.

Ao resolver, a aplicação envia email com QR code e botão. Ambos abrem a mesma página; abrir a página não confirma o atendimento. O solicitante escolhe confirmar ou recusar sem precisar de login. A recusa exige justificativa, reabre a ordem e remove a atribuição atual. Soluções e responsáveis anteriores permanecem no histórico.

O token vale por 72 horas, é armazenado somente como hash e permite uma resposta. Reenvio invalida o link anterior. Expiração não confirma nem reabre automaticamente a OS. Falhas de envio ficam visíveis e permitem reenvio pelo administrador ou técnico responsável. Acesso ao link representa o aceite pelo canal de email; não inclui assinatura desenhada nem verificação documental da identidade.

Desativar uma conta encerra suas sessões e impede novos acessos. OS existentes não são removidas; o administrador deve reatribuir atendimentos de técnicos desativados.

Os filtros combinam data de abertura, nome parcial do solicitante e número exato. Datas inicial/final incluem todo o dia em `America/Sao_Paulo`. O banco armazena instantes em UTC. Listagens têm 20 registros por página, mais recentes primeiro.

O PDF está disponível desde a abertura e reflete o estado atual: identificação, descrição, solução, histórico e registros do aceite. Ao confirmar o atendimento, um novo download inclui a confirmação.

## QR pelo celular e SMTP real

Para o celular acessar a aplicação local, configure `APP_PUBLIC_URL` com o IP real do computador na rede e a porta `3000`, por exemplo `http://<IP-DO-COMPUTADOR>:3000`. Reinicie a aplicação e reenvie o email para gerar outro link. Celular e computador precisam de conectividade; o firewall deve permitir a porta. `localhost` no celular aponta para o próprio celular.

O Mailpit captura emails para desenvolvimento; não os entrega a caixas externas. Para SMTP real, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM`. Porta 465 normalmente usa `SMTP_SECURE=true`; STARTTLS na porta 587 usa `false`.

Para uma publicação futura, use `NODE_ENV=production`, `APP_PUBLIC_URL` com HTTPS e um reverse proxy TLS. A aplicação confia em um proxy e ativa cookies seguros em produção; restrinja o acesso direto ao backend. As credenciais de exemplo e as portas do Mailpit são para desenvolvimento. A publicação externa não faz parte desta entrega.

## Desenvolvimento sem container da aplicação

Inicie somente banco e Mailpit:

```powershell
docker compose stop app
docker compose up -d db mailpit
npm.cmd ci
```

Ajuste `DATABASE_URL` em `.env` para `localhost:5433` (ou a porta definida em `POSTGRES_PORT`), conforme a senha configurada. Para o frontend Vite e o SMTP local:

A porta `5432` é interna ao container do banco; o Node executado no Windows usa a porta publicada `5433`. Apontar para `localhost:5432` pode acessar outro PostgreSQL instalado no computador e gerar `password authentication failed for user "os"`. O container `app` deve ficar parado neste modo para liberar a porta `3000` ao backend local. Após alterar `.env`, reinicie `npm.cmd run dev`.

```powershell
$env:APP_PUBLIC_URL = 'http://localhost:5173'
$env:SMTP_HOST = 'localhost'
npm.cmd run dev
```

Abra http://localhost:5173. A API fica na porta 3000 e o Vite encaminha `/api`. Os emails usam a URL configurada, inclusive para a validação de origem das operações autenticadas.

Se aparecer **Origem não permitida**, `APP_PUBLIC_URL` precisa corresponder ao endereço usado no navegador, incluindo protocolo, IP ou nome e porta. Para acesso pela rede ao Vite, use `http://<IP-DO-COMPUTADOR>:5173`, tanto para autorizar as operações quanto para gerar os links dos emails. O Vite precisa permanecer em execução para que esses links funcionem.

Se a API estiver no Docker, altere `APP_PUBLIC_URL` em `.env` e aplique com `docker compose up -d --force-recreate app`. Se estiver executando `npm.cmd run dev`, pare e inicie novamente após ajustar a variável. Uma variável `$env:APP_PUBLIC_URL` já definida no terminal tem precedência sobre `.env`; ajuste-a também. Recarregue a página após reiniciar a API. A validação de origem e o token CSRF devem permanecer ativos.

Para executar a versão compilada fora do Docker, use `APP_PUBLIC_URL=http://localhost:3000`, `SMTP_HOST=localhost`, `npm.cmd run build` e `npm.cmd start`.

## Validação

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd audit --omit=dev
```

Os testes de integração iniciam um PostgreSQL 17 isolado, sem Docker, por meio de `embedded-postgres`. Eles não usam `.env` nem o banco da aplicação. Os dados temporários permanecem em `.test-data/`, ignorado pelo Git. Em Linux, execute esses testes com um usuário comum, pois PostgreSQL não inicia como root.

Cobertura: migrations, sessões, CSRF, troca obrigatória de senha, desativação, autorização entre perfis, atribuição concorrente, resolução, confirmações simultâneas, recusa/reabertura, versões do atendimento, reenvio, expiração, falha de SMTP, filtros, paginação e conteúdo do PDF.

### Validar os containers

Com o engine Docker disponível e o `.env` configurado:

```powershell
npm.cmd run validate:containers
```

O comando valida o Compose, constrói a imagem, inicia os serviços e verifica a API, o bundle React, as proteções de sessão/CSRF, o PostgreSQL 17, as migrations, o administrador inicial e o Mailpit. Também verifica a conexão com o SMTP a partir do container da aplicação, sem enviar mensagens. Os serviços permanecem em execução após a validação. Não cria usuários nem OS de teste e não altera senhas existentes.

Se o comando não encontrar `docker` em uma sessão antiga do terminal, reabra o terminal ou defina `DOCKER_BINARY` com o caminho do `docker.exe`. Os testes de integração e navegador abaixo continuam cobrindo o atendimento completo em um banco isolado.

### Testes no navegador com email real

Instale Chromium para Playwright:

```powershell
npx.cmd playwright install chromium
```

Os testes usam um executável Mailpit. No Windows, obtenha a distribuição oficial:

```powershell
New-Item -ItemType Directory -Force .test-data
Invoke-WebRequest -Uri 'https://github.com/axllent/mailpit/releases/download/v1.27.0/mailpit-windows-amd64.zip' -OutFile '.test-data/mailpit.zip'
Expand-Archive -LiteralPath '.test-data/mailpit.zip' -DestinationPath '.test-data/mailpit' -Force
```

Em outros sistemas, instale Mailpit ou configure `MAILPIT_BINARY` com o caminho do executável. Depois:

```powershell
npm.cmd run build
npm.cmd run test:e2e
```

Portas de teste: aplicação `3317`, SMTP `11025`, Mailpit `18025`; devem estar livres. PostgreSQL usa uma porta aleatória. O ambiente é criado e encerrado pelos testes. Capturas de tela e PDFs de verificação ficam em `test-results/`.

## API

Todas as rotas privadas exigem sessão. Operações de escrita exigem `X-CSRF-Token`, recebido em `/api/auth/csrf` e renovado no login/troca de senha.

```text
GET    /api/health
GET    /api/auth/csrf
POST   /api/auth/login                     { email, password }
GET    /api/auth/me
POST   /api/auth/password                  { currentPassword, newPassword }
POST   /api/auth/logout
GET    /api/users
POST   /api/users                          { name, email, role, temporaryPassword }
PATCH  /api/users/:id                      { active?, temporaryPassword? }
GET    /api/technicians
GET    /api/dashboard                     ?year=YYYY&month=MM (ADMIN)
GET    /api/events                        (SSE autenticado)
GET    /api/orders                        ?from=YYYY-MM-DD&to=YYYY-MM-DD&requester=...&number=...&page=1
POST   /api/orders                        { title, description }
GET    /api/orders/:id
POST   /api/orders/:id/assign              { technicianId }
POST   /api/orders/:id/resolve             { solution }
POST   /api/orders/:id/resend
GET    /api/orders/:id/pdf
GET    /api/confirmations/:token
POST   /api/confirmations/:token           { response: CONFIRMED|REJECTED, reason? }
```

Perfis: `REQUESTER`, `TECHNICIAN`, `ADMIN`. Status: `OPEN`, `ASSIGNED`, `RESOLVED`. Aceite: `NOT_REQUESTED`, `PENDING`, `CONFIRMED`, `REJECTED`. A listagem retorna `{ items, total, page, pageSize }`. Erros retornam `{ message }`; links inválidos, usados ou expirados retornam HTTP 410. Apenas os endpoints de confirmação dispensam login e CSRF; o token exclusivo autoriza essa resposta.

## Estrutura

`server/src` contém configuração, autenticação, regras do atendimento, email, PDF e API. `server/migrations` contém migrations SQL versionadas. `client/src` contém as telas React. `tests` contém integração com PostgreSQL e fluxos com Playwright/Mailpit. `teste.py` não participa da aplicação.

## Fluxo do usuário: da abertura ao aceite

### 1. Administrador prepara os acessos

1. Acesse http://localhost:3000 com o email e a senha inicial definidos em `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env`.
2. No primeiro acesso, informe a senha atual e defina uma nova senha na tela **Defina sua senha**.
3. Abra **Usuários** e crie uma conta com perfil **Solicitante** e outra com perfil **Técnico**. Informe nome, email e senha temporária para cada uma.
4. Entregue os acessos aos respectivos usuários. Cada usuário deverá trocar sua senha temporária no primeiro login.

Para simular os três perfis no mesmo computador, saia da conta antes de entrar com outro usuário ou use perfis separados do navegador. Abas da mesma janela compartilham a sessão.

### 2. Solicitante abre o chamado

1. Entre com a conta de solicitante e conclua a troca da senha temporária, se solicitada.
2. Em **Chamados**, clique em **Nova ordem**.
3. Preencha **Título do chamado** (até 50 caracteres) e **Descrição** (até 255 caracteres) e clique em **Abrir ordem de serviço**. São permitidas até 10 aberturas em 60 minutos.
4. Anote o número gerado. A OS aparece como **Aberto**, com solicitante e data de abertura registrados automaticamente.

O solicitante pode consultar suas OS e usar **Baixar PDF** desde essa etapa.

### 3. Administrador atribui o técnico

1. Entre como administrador e encontre a OS em **Chamados**. Use o número, o nome do solicitante ou o intervalo da data de abertura. Para receber avisos sonoros de novas OS, clique em **Ativar som**.
2. Abra a OS, selecione um técnico ativo no campo **Técnico** e clique em **Atribuir OS**.
3. Confira o status **Atribuído a [nome do técnico]**. A ordem passa a aparecer na lista desse técnico.

Se necessário, o administrador pode selecionar outro técnico e clicar em **Reatribuir OS** antes da resolução.

### 4. Técnico registra a solução

1. Entre com a conta do técnico atribuído e abra a OS.
2. Após realizar o atendimento, preencha **Solução realizada**.
3. Clique em **Resolver e solicitar aceite**.
4. Confira **Resolvido por [nome do técnico]** e **Aceite pendente**. A aplicação envia o pedido de confirmação ao email do solicitante.

Se o envio falhar, a solução permanece registrada. O técnico responsável ou o administrador pode abrir a OS e clicar em **Reenviar email**.

### 5. Solicitante confirma ou recusa

1. Abra o email recebido e clique em **Revisar atendimento** ou escaneie o QR code. No ambiente local padrão, consulte o email no Mailpit em http://localhost:8025.
2. Revise a descrição, o técnico e a solução na página de confirmação. Não é necessário fazer login; abrir o link não registra o aceite.
3. Se o problema foi resolvido, clique em **Confirmar atendimento**. A OS permanece resolvida e passa a mostrar **Aceite confirmado**, com data e registro no histórico.
4. Se o problema continua, clique em **O problema continua**, preencha a justificativa e clique em **Recusar e reabrir OS**. A ordem volta para **Aberto**, sem técnico atribuído, com **Aceite recusado** e o atendimento anterior preservado no histórico.

Após uma recusa, o administrador atribui novamente um técnico. A próxima resolução gera uma nova versão do atendimento e outro pedido de aceite.

O link vale por 72 horas e permite uma única resposta. Se expirar, peça um reenvio à equipe; o novo email invalida o link anterior. Para escanear pelo celular, configure antes um `APP_PUBLIC_URL` acessível na rede, conforme a seção **QR pelo celular e SMTP real**.

### 6. Consultar e baixar o registro

1. Retorne a **Chamados** com uma conta autorizada a acessar a OS.
2. Combine **Data inicial**, **Data final** e **Número da OS** e clique em **Consultar**. Técnicos e administradores também têm o filtro **Solicitante**. As datas filtram a abertura do chamado, não a resolução.
3. Abra a ordem para revisar o status, a situação do aceite e o histórico.
4. Clique em **Baixar PDF** para obter o relatório atualizado. Após o aceite, o PDF inclui o registro da confirmação; após uma recusa, inclui a justificativa e a reabertura.

### 7. Administrador acompanha o dashboard

1. Abra **Dashboard** no menu. Consulte os totais do dia, do mês e da fila atual.
2. Escolha ano e mês e clique em **Aplicar período** para atualizar o total mensal e o ranking de resolvidos. O gráfico considera os 12 meses do ano escolhido.
3. Acompanhe as mudanças automaticamente, sem recarregar a página. O ranking de atribuídos continua mostrando toda a carga pendente atual.
4. Use o botão de tema no cabeçalho para escolher claro ou escuro; cada usuário mantém sua preferência naquele navegador.

## Atualização e reversão da versão

`002_live_updates.sql` é aditiva: cria índices e triggers, sem alterar campos, chamados, histórico ou senhas. A inicialização aplica migrations pendentes uma única vez, dentro de transação. Faça o rebuild com `docker compose up -d --build` e confira a validação dos containers. Não remova o volume do PostgreSQL.

Para reverter a aplicação, restaure a versão anterior do código e reconstrua a imagem mantendo o banco e a migration aditiva. A versão anterior pode continuar lendo os mesmos dados; os índices e triggers não exigem redução de campos ou remoção de registros. A quota de abertura é uma regra da aplicação nova e deixa de ser aplicada caso volte ao backend anterior.
