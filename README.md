# My JobSpy 🎯

**Um painel local para caçar vagas de tecnologia.** Busca vagas no LinkedIn, Indeed, Glassdoor, Google Jobs e outros sites ao mesmo tempo, junta tudo num só lugar, remove duplicadas e dá uma **nota de 0 a 100 para cada vaga de acordo com o seu currículo**. Também ajuda a fazer a triagem, agenda buscas automáticas e acompanha suas candidaturas até a oferta.

Construído em cima da biblioteca open source [JobSpy](https://github.com/speedyapply/JobSpy) (MIT), que faz a raspagem dos sites. Este repositório adiciona uma interface web completa (FastAPI + JavaScript puro) pensada para quem procura vaga no Brasil, remoto ou no exterior.

> Tudo roda **na sua máquina**. Não há conta, servidor externo nem banco na nuvem: as vagas, o seu perfil e as suas anotações ficam num SQLite local.

---

## Sumário

- [O que ele faz](#o-que-ele-faz)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Como rodar](#como-rodar)
- [Primeiros passos (10 minutos)](#primeiros-passos-10-minutos)
- [Guia das abas](#guia-das-abas)
  - [Vagas](#vagas)
  - [Buscar](#buscar)
  - [Candidaturas](#candidaturas)
  - [Execuções](#execuções)
  - [Painel](#painel)
  - [Automação](#automação)
  - [Perfil / CV](#perfil--cv)
- [Como o score funciona](#como-o-score-funciona)
- [Limitações de cada site](#limitações-de-cada-site)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Estrutura do projeto](#estrutura-do-projeto)
- [API HTTP](#api-http)
- [Usando só a biblioteca (Python)](#usando-só-a-biblioteca-python)
- [Solução de problemas](#solução-de-problemas)
- [Créditos e licença](#créditos-e-licença)

---

## O que ele faz

| | |
|---|---|
| 🔎 **Busca em vários sites de uma vez** | LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt, Naukri e BDJobs, cada site numa thread separada. Se um site falha, os outros continuam. |
| 🧠 **Score baseado no seu CV** | Cada vaga recebe uma nota de 0 a 100 calculada a partir das suas stacks, da senioridade pedida, da modalidade (remoto/híbrido/presencial), da localização, da exigência de inglês fluente e dos anos de experiência pedidos. A nota vem com o detalhamento de cada parcela. |
| 📄 **Perfil gerado a partir do PDF do currículo** | Você envia o CV e ele monta o perfil (stacks e pesos, senioridade, cidade, nível de inglês) e cria templates de busca para você. |
| 🧹 **Duplicadas resolvidas** | A mesma vaga em sites diferentes vira um cartão só ("também no Indeed"). Mudar o status de uma muda o de todas as cópias. |
| 🗂️ **Triagem rápida** | Filtros com contagem, busca textual, atalhos de teclado (`j`/`k`/`s`/`a`/`d`…), vagas não vistas destacadas e o aviso de quantas vagas chegaram desde a sua última visita. |
| 📋 **Kanban de candidaturas** | Salva → Aplicada → Entrevista → Oferta → Recusada, com data de candidatura e lembrete de follow-up quando a empresa some. |
| ⏰ **Buscas agendadas** | Escolha um template, o horário e os dias. Ele busca só o que foi publicado desde a última execução e avisa quando termina. |
| 🧽 **Limpeza automática** | Vagas antigas que você nunca triou são arquivadas sozinhas e o histórico de buscas não acumula. |
| 🩺 **Saúde dos sites** | Mostra quais sites estão voltando sem resultados ou com erro e permite desativá-los em todas as buscas. |

---

## Requisitos

- **Python 3.10 ou mais novo.** Atenção: no macOS o `python3` que vem com o sistema é o 3.9 e **não funciona**. Instale um mais novo com [python.org](https://www.python.org/downloads/), `brew install python@3.12`, `uv python install 3.12` ou `pyenv`.
- Um navegador moderno (Chrome, Firefox, Safari ou Edge).
- Funciona em macOS, Linux e Windows. O script `start.sh` é para macOS e Linux; no Windows use o comando equivalente mostrado abaixo.

Confira a versão:

```bash
python3 --version   # precisa ser 3.10+
```

---

## Instalação

```bash
git clone https://github.com/Dev-Etto/my-job-spy.git
cd my-job-spy

# cria o ambiente virtual dentro do projeto (use o seu Python 3.10+)
python3.12 -m venv .venv

# instala a biblioteca de raspagem e as dependências da interface
.venv/bin/pip install . -r webapp/requirements.txt
```

No **Windows** (PowerShell):

```powershell
py -3.12 -m venv .venv
.venv\Scripts\pip install . -r webapp\requirements.txt
```

<details>
<summary>Prefere Poetry?</summary>

```bash
poetry config virtualenvs.in-project true   # para criar o .venv dentro do projeto
poetry install
.venv/bin/pip install -r webapp/requirements.txt
```
</details>

---

## Como rodar

```bash
./start.sh
```

O script sobe o servidor em **http://127.0.0.1:8765**, abre o navegador e reinicia o servidor sozinho quando você edita um arquivo `.py`. Se o servidor já estiver rodando, ele só abre o navegador.

Outras formas:

```bash
./start.sh --no-reload                        # sem reinício automático (bom para deixar rodando o dia todo)
.venv/bin/python -m webapp.server --open      # o mesmo, sem o script
.venv/bin/python -m webapp.server --port 9000 # outra porta (ou PORT=9000)
```

No **Windows**:

```powershell
.venv\Scripts\python -m webapp.server --open
```

Para parar, use `Ctrl+C` no terminal.

> 💡 As buscas agendadas só rodam enquanto o servidor está ligado. Se o horário passar com ele desligado, a busca roda assim que você ligá-lo de novo, desde que seja no mesmo dia.

---

## Primeiros passos (10 minutos)

1. **Gere o seu perfil.** Abra a aba **Perfil / CV**, clique em **Escolher PDF…** e envie o seu currículo. Revise o que ele encontrou (stacks, anos de experiência, cidade, inglês) e clique em **Aplicar**.
   > O perfil que vem no projeto é o do autor (Full Stack Node/React/Java, Caruaru-PE). Se você não importar o seu CV, as notas vão refletir o perfil dele.
2. **Rode uma busca.** Na aba **Buscar**, aparecem os templates do grupo 📄 **Do seu CV**, criados no passo anterior. Clique em **Executar** em um deles. A busca leva de 30 segundos a alguns minutos; o LinkedIn é o mais lento porque abre cada vaga para ler a descrição.
3. **Faça a triagem.** Quando terminar, um aviso oferece **Ver novas**. Na aba **Vagas**, use `j`/`k` para navegar, `s` para salvar, `d` para descartar e `o` para abrir a vaga no site.
4. **Candidate-se e acompanhe.** Marque a vaga como **Aplicada** (tecla `a`) e acompanhe tudo na aba **Candidaturas**.
5. **Automatize.** Na aba **Buscar**, clique em **Agendar** num template, por exemplo todo dia útil às 9h. A partir daí você só abre o app e vê o que chegou.

---

## Guia das abas

### Vagas

A tela principal, com três colunas: filtros, lista e detalhe.

**Lista**
- Cada cartão mostra o score (anel colorido), o título, a empresa, o local, as etiquetas (site, senioridade, modalidade, idade da vaga, salário, CLT/PJ, inglês fluente, anos exigidos) e as stacks encontradas. Em azul ficam as do seu CV (negrito quando estão no título); em vermelho, as que você não domina.
- 🔵 O ponto azul antes do título indica uma vaga que você ainda **não abriu**.
- A aba mostra o total e quantas vagas ainda não foram vistas, por exemplo `Vagas (169 · 12 novas)`.
- Ao abrir o app, um aviso diz quantas vagas chegaram **desde a sua última visita**, com o botão **Ver só elas**.
- A lista pode ser ordenada por score, data de publicação, data em que a vaga foi encontrada, salário ou empresa.
- **CSV** exporta as vagas filtradas. **Descartar filtradas** descarta de uma vez todas as vagas "Nova" do filtro atual, o que é útil depois de filtrar por uma stack que você não quer.

**Filtros** (todos com contagem ao lado, calculada sobre os outros filtros ativos)
- Status, score mínimo, região (Brasil/Internacional), modalidade, senioridade, idioma da descrição, contrato (CLT/PJ/Contractor), site e origem (template ou busca).
- **Stacks do seu CV**: "alguma" ou "todas" as marcadas.
- **Excluir stacks fora do CV**: no título ou em qualquer parte do texto.
- Publicada nos últimos N dias e experiência máxima exigida.
- Salário: só vagas com salário, valor mínimo mensal e moeda.
- Texto livre: "precisa conter", "excluir se o título contém", "excluir se o texto contém" e "excluir empresas" (vários termos separados por vírgula).
- Outros: ocultar duplicadas, ocultar vagas que exigem inglês fluente, somente com link direto de candidatura, somente com descrição, somente não vistas.
- **Filtros salvos**: guarde combinações que você usa sempre, como "Remoto pleno sem PHP".

**Detalhe**
- Botões de status: Nova, Salva, Aplicada, Entrevista, Descartada; Oferta e Recusada aparecem depois que você se candidata.
- **Por que esse score**: a nota decomposta em parcelas (veja [Como o score funciona](#como-o-score-funciona)).
- Fatos extraídos: data de publicação, data em que a vaga foi encontrada e em que você aplicou, senioridade, modalidade, salário, contrato, anos exigidos, setor, porte da empresa e e-mails.
- **Anotações**, salvas automaticamente.
- Descrição completa, com as suas stacks marcadas em amarelo e as que você não domina em vermelho.
- Links para as cópias da mesma vaga em outros sites.

**Atalhos de teclado** (na aba Vagas, fora de campos de texto)

| Tecla | Ação |
|---|---|
| `j` / `k` | próxima / anterior |
| `s` | salvar |
| `a` | marcar como aplicada |
| `e` | marcar como entrevista |
| `d` | descartar |
| `n` | voltar para "Nova" |
| `o` | abrir a vaga no site |
| `/` | focar a busca |

Apertar o status que a vaga já tem volta ela para "Nova". Quando você descarta uma vaga, a seleção pula para a próxima, para a triagem seguir sem o mouse.

### Buscar

**Templates** são buscas prontas, com os parâmetros já ajustados às manias de cada site. Eles ficam em grupos:

- 🇧🇷 **Brasil**: Full Stack, Back-end Node/TS, Java/Spring, Front React/Next, Go, Cloud/GCP, startups, Recife/PE, Caruaru/PE e uma varredura ampla de "pleno".
- 🌎 **Internacional**: LATAM remoto, Worldwide, EUA remoto, Europa, Portugal e Java remoto.
- 📄 **Do seu CV**: gerados a partir do seu PDF.
- ⭐ **Meus templates**: os que você salvou.

Em cada template você pode:
- **Executar** a busca, ou marcar vários e usar **Executar selecionados**. Há também atalhos para executar todos do grupo Brasil ou Internacional.
- **Editar**: carrega o template no formulário. Depois de ajustar, use **Salvar alterações no template**. Um template pronto editado ganha a etiqueta "editado" e o botão **Restaurar original**.
- **Agendar**: cria um agendamento na aba Automação.

**Busca personalizada**: o formulário expõe tudo o que a biblioteca aceita.

| Campo | Para que serve |
|---|---|
| Sites | quais sites consultar; sites com problema aparecem com ⚠ |
| Termo de busca | o que procurar, por exemplo `desenvolvedor back-end node` |
| Termo do Google | o Google Jobs ignora os outros campos e usa só esta frase, então escreva como escreveria na busca do Google |
| Localização | cidade, estado, país ou região (`Latin America`, `Worldwide`, `European Union`…) |
| País (Indeed/Glassdoor) | qual domínio regional do Indeed/Glassdoor usar |
| Região das vagas | usada para classificar vagas sem localização (Brasil × Internacional) |
| Tipo de contrato | tempo integral, meio período, estágio, contrato |
| Publicadas nas últimas | 24h, 3, 7, 14 ou 30 dias |
| Resultados por site | quantas vagas pedir a cada site (máx. ~1000) |
| Distância | raio em milhas a partir da localização |
| Somente remoto, Candidatura simplificada | filtros dos próprios sites |
| LinkedIn: buscar descrição completa | mais lento, mas sem descrição o score fica bem menos preciso |
| Ajustes por site | outro termo ou local só para um site (ex.: no Indeed, colocar "remoto" no termo) |
| Proxies | um por linha (`user:pass@host:port` ou `socks5://…`) |
| IDs de empresas no LinkedIn | restringe a busca a empresas específicas |

Enquanto você preenche o formulário, ele avisa sobre **combinações que o site vai ignorar** (veja [Limitações de cada site](#limitações-de-cada-site)).

### Candidaturas

Um quadro Kanban com as colunas **Salva → Aplicada → Entrevista → Oferta → Recusada**.

- Arraste os cartões entre as colunas ou use o seletor do próprio cartão, que é mais prático no celular.
- O cartão mostra o score, a empresa, os sites onde a vaga apareceu, há quanto tempo você aplicou, há quanto tempo a vaga está na etapa atual e o começo das suas anotações.
- ⏰ **Follow-up**: uma vaga **Aplicada** sem novidade há N dias (7 por padrão) ganha um aviso, e a aba mostra um contador. Clique em **Fiz follow-up** depois de mandar mensagem ao recrutador para reiniciar a contagem.
- **Abrir** leva à vaga na aba Vagas, com descrição e anotações.

### Execuções

O histórico de buscas, com atualização ao vivo enquanto alguma está rodando.

- Status de cada busca (na fila, rodando, concluída, parcial, erro, cancelada) e, por site, quantas vagas vieram, quantas eram novas e o tempo gasto.
- **Ver N novas**: só as vagas que aquela busca encontrou pela primeira vez. **Ver todas**: tudo o que ela retornou.
- **Log** com as mensagens dos raspadores; útil quando um site falha.
- **Cancelar** uma busca que ainda está na fila.
- **Excluir** uma busca, ou **Limpar histórico**, com duas opções:
  - **Só do histórico**: as vagas ficam.
  - **Excluir com as vagas**: remove apenas as vagas que só aquela busca encontrou e que você ainda não triou. Vagas salvas, aplicadas, em entrevista ou descartadas nunca são apagadas.

Quando uma busca termina, aparece um aviso com o botão **Ver novas**. Se a aba estiver em segundo plano, aparece uma notificação do navegador; a permissão é pedida quando você cria o primeiro agendamento.

### Painel

Gráficos sobre as vagas (todas ou só as do filtro atual): as stacks do seu CV mais pedidas, as stacks fora do CV que mais aparecem, a distribuição de score, senioridade, modalidade, região, site, contrato, as empresas com mais vagas, as publicações por dia e a mediana salarial em BRL. **Clicar numa barra aplica o filtro** na aba Vagas.

Serve para responder perguntas como "vale estudar Angular?" ou "quanto paga um pleno remoto?".

### Automação

**Buscas agendadas**
- Escolha o template, o horário e os dias da semana.
- **Só vagas novas** (recomendado): cada execução busca apenas o que foi publicado desde a anterior, no mínimo 24h e no máximo 14 dias. Se você pular o fim de semana, a busca de segunda cobre sábado e domingo.
- As buscas agendadas aparecem em Execuções com ⏰ no nome.

**Limpeza automática** (roda ao iniciar o servidor e uma vez por dia)

| Configuração | Padrão | O que faz |
|---|---|---|
| Arquivar vagas "Nova" não vistas em buscas há | 21 dias | a vaga provavelmente fechou e vai para **Arquivada**. Se aparecer de novo numa busca, volta a ser "Nova" |
| Apagar do histórico buscas com mais de | 30 dias | só o registro da busca; as vagas ficam |
| Lembrar follow-up após | 7 dias | prazo do aviso na aba Candidaturas |

`0` desativa. A limpeza **nunca** mexe em vagas salvas, aplicadas, em entrevista, com oferta, recusadas ou descartadas. O botão **Limpar agora** mostra antes quantas vagas e buscas seriam afetadas.

**Saúde dos sites**: uma tabela com buscas, vagas, buscas zeradas e erros por site. Um site que voltou zerado ou com erro nas últimas execuções fica marcado. A opção **Desativar** pula o site em todas as buscas, manuais e agendadas, sem precisar editar os templates.

### Perfil / CV

- **Gerar a partir de um CV (PDF)**: lê o texto do PDF e propõe um perfil e templates. Nada é salvo antes de você clicar em **Aplicar**.
  - *Stacks*: compara o texto com um catálogo de ~40 tecnologias. O peso cresce com o número de menções.
  - *Stacks fora do CV*: tecnologias do catálogo que não aparecem no seu CV passam a tirar pontos (PHP, .NET, Angular…).
  - *Senioridade*: a partir de "X anos de experiência".
  - *Local*: o primeiro "Cidade, UF" do CV. A cidade e a capital do estado viram locais preferidos.
  - *Inglês*: básico, intermediário, avançado ou fluente.
  - *Templates*: Full Stack, Back-end e Front-end com as suas stacks principais, um template local e um LATAM (se o seu inglês for intermediário ou melhor).
  - PDFs escaneados (imagem) não têm texto extraível e não funcionam.
- **Perfil usado no score**: tudo é editável. Você pode mudar o peso de cada stack e os padrões de busca (expressões regulares), os pontos por senioridade e por modalidade, os locais preferidos, a penalidade por inglês fluente, o máximo de anos aceitável e a saturação de stack. **Salvar e recalcular** reprocessa todas as vagas na hora.
- **Restaurar padrão do CV** volta ao perfil que vem no projeto.

---

## Como o score funciona

A nota vai de 0 a 100 e é a soma de parcelas, todas visíveis em **Por que esse score**:

| Parcela | Como é calculada |
|---|---|
| **Base** | ponto de partida fixo |
| **Aderência de stack** | até **+55**. Soma os pesos das suas stacks encontradas na vaga; stacks no título valem ×1,5. Ao atingir a "saturação" (35 por padrão), a parcela chega ao máximo |
| **Stacks fora do CV** | no **título**: −peso×4 (uma vaga "Desenvolvedor PHP" despenca). Só na **descrição**: −peso×0,4, porque costuma ser "diferencial" |
| **Senioridade** | pontos por nível detectado **no título** (estágio, júnior, pleno, sênior, lead) conforme o perfil. "Pleno" é verificado antes de "sênior", para "Pleno/Sênior" contar como pleno |
| **Modalidade** | remoto, híbrido ou presencial, detectados pelo site, pelo título, pela localização e pela descrição |
| **Localização preferida** | bônus se a vaga híbrida ou presencial for numa das suas cidades |
| **Inglês fluente** | penalidade se a descrição exigir inglês fluente ou avançado |
| **Anos exigidos** | penalidade por ano pedido acima do seu máximo aceitável ("5+ anos de experiência") |
| **Sem descrição** | quando o site não traz descrição, a nota se apoia só no título |

Outras informações extraídas por heurística (expressões regulares sobre o texto sem acentos):
- **Contrato**: CLT, PJ ou Contractor.
- **Salário mensal**: do campo estruturado do site ou, na falta dele, de valores "R$" encontrados na descrição (marcados com `*`).
- **Idioma da descrição**: português ou inglês.
- **Região**: Brasil ou Internacional.

São heurísticas e podem errar. Por isso cada parcela é exibida, para você saber por que uma vaga ficou com aquela nota.

---

## Limitações de cada site

Os templates já contornam estas limitações, e o formulário avisa quando você esbarra numa delas.

| Site | O que saber |
|---|---|
| **LinkedIn** | O melhor para o Brasil. Aceita regiões (`Latin America`, `Worldwide`). Não combina "publicadas nas últimas" com "candidatura simplificada". Costuma bloquear (erro 429) por volta da 10ª página por IP, então use proxies se pedir muitos resultados. "Buscar descrição completa" faz uma requisição extra por vaga. |
| **Indeed** | Aceita **só um** destes por busca: "publicadas nas últimas", ("tipo de contrato" + "somente remoto") ou "candidatura simplificada". Por isso os templates do Brasil colocam "remoto" no termo em vez de usar o filtro. Use o país certo (`brazil`). |
| **Google Jobs** | Usa apenas o "Termo do Google", em linguagem natural. Muda e bloqueia com frequência; se voltar zerado, desative-o em Automação. |
| **Glassdoor** | Só em alguns países e bloqueia com frequência. |
| **ZipRecruiter** | Só EUA e Canadá. |
| **Bayt / Naukri / BDJobs** | Oriente Médio, Índia e Bangladesh. |

Todos os sites limitam a ~1000 resultados por busca. As buscas rodam **uma de cada vez** (fila), para não chamar atenção dos sites; dentro de uma busca, os sites rodam em paralelo.

---

## Onde ficam os dados

Tudo o que é seu fica em `webapp/data/`, que está no `.gitignore`:

| Arquivo | Conteúdo |
|---|---|
| `jobs.db` | SQLite com as vagas, status, anotações, datas e o histórico de buscas |
| `profile.json` | o seu perfil de score (só existe se você editou ou importou um CV) |
| `templates.json` | os seus templates e os templates prontos que você editou |
| `settings.json` | agendamentos, limpeza, dias de follow-up e sites desativados |

- **Backup**: copie a pasta `webapp/data/`.
- **Começar do zero**: apague a pasta com o servidor desligado.
- O app não envia seus dados a lugar nenhum. As únicas requisições externas são as buscas nos sites de vagas e duas bibliotecas JavaScript carregadas de CDN (`marked` e `DOMPurify`, para exibir as descrições).

Também dá para importar um `jobs.csv` gerado pela biblioteca: com a lista vazia, use o botão **Importar jobs.csv** (o arquivo precisa estar na raiz do projeto).

---

## Estrutura do projeto

```
.
├── start.sh                 # sobe a interface e abre o navegador
├── webapp/                  # a interface web
│   ├── server.py            # FastAPI: rotas da API + arquivos estáticos + CLI (--open/--reload/--port)
│   ├── runner.py            # fila de buscas, raspagem por site, agendador e limpeza
│   ├── store.py             # SQLite: vagas, buscas, migrações
│   ├── analysis.py          # heurísticas e cálculo do score
│   ├── profile.py           # perfil padrão e leitura/gravação do perfil
│   ├── templates.py         # templates prontos + templates do usuário
│   ├── settings.py          # configurações e agendamentos
│   ├── cv_import.py         # PDF → perfil + templates
│   ├── requirements.txt     # fastapi, uvicorn, pypdf
│   ├── static/              # index.html, app.js, style.css (sem build)
│   └── data/                # seus dados (não versionado)
├── jobspy/                  # biblioteca de raspagem (upstream JobSpy)
│   ├── __init__.py          # scrape_jobs()
│   ├── model.py             # tipos: Site, JobPost, Country, JobType…
│   ├── util.py              # sessões HTTP, proxies, conversões
│   └── linkedin/ indeed/ glassdoor/ google/ ziprecruiter/ bayt/ naukri/ bdjobs/
├── docs/jobspy-library.md   # documentação original da biblioteca
└── CLAUDE.md                # notas de arquitetura para assistentes de código
```

**Decisões de arquitetura**
- **Sem etapa de build no front-end**: HTML, CSS e JavaScript puros. Basta editar e recarregar a página.
- **Filtros no navegador**: a API entrega todas as vagas e a filtragem e as contagens acontecem no cliente. Funciona bem até alguns milhares de vagas.
- **Um site por thread**: cada busca chama `scrape_jobs(site_name=[site])` separadamente, para que a falha de um site não derrube os outros.
- **Biblioteca local**: `server.py` coloca a raiz do repositório no `sys.path`, então mudanças em `jobspy/` valem na hora, sem reinstalar.
- **Migrações simples**: colunas novas são adicionadas ao banco na inicialização (`_MIGRATIONS` em `store.py`).

---

## API HTTP

A interface usa uma API JSON que você também pode chamar de scripts. Com o servidor rodando, a documentação interativa fica em **http://127.0.0.1:8765/docs**.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/meta` | sites, países, templates, perfil e configurações |
| GET | `/api/jobs` | todas as vagas com a análise |
| PATCH | `/api/jobs` | `{ids, status?, notes?, seen?, followup?}` |
| POST | `/api/jobs/delete` | `{ids}` ou `{status}` |
| POST | `/api/import-csv` | `{path, region}` importa um CSV da biblioteca |
| POST | `/api/validate` | avisos sobre combinações de parâmetros |
| POST | `/api/runs` | `{params, label}` ou `{template_ids: [...]}` enfileira buscas |
| GET | `/api/runs`, `/api/runs/{id}` | histórico e uma busca com o log completo |
| POST | `/api/runs/{id}/cancel` | cancela uma busca na fila |
| POST | `/api/runs/delete` | `{ids}` ou `{all}`, com `delete_jobs` opcional |
| POST / DELETE | `/api/templates`, `/api/templates/{id}` | salva, edita ou exclui/restaura um template |
| GET / PUT | `/api/settings` | configurações e agendamentos |
| POST | `/api/cleanup` | `{dry_run}` arquiva vagas antigas e limpa o histórico |
| POST | `/api/cv/parse` | corpo = bytes do PDF; devolve uma proposta de perfil e templates |
| POST | `/api/cv/apply` | `{profile?, templates?}` aplica a proposta |
| GET / PUT | `/api/profile` | lê ou salva o perfil (e recalcula os scores) |
| POST | `/api/profile/reset` | volta ao perfil padrão |

Exemplo: disparar um template pelo terminal (para usar no cron, por exemplo):

```bash
curl -X POST http://127.0.0.1:8765/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"template_ids": ["br-backend-node-ts"]}'
```

---

## Usando só a biblioteca (Python)

A interface é opcional. A biblioteca pode ser usada diretamente:

```python
from jobspy import scrape_jobs

jobs = scrape_jobs(
    site_name=["indeed", "linkedin"],
    search_term="desenvolvedor back-end node",
    location="Brazil",
    country_indeed="brazil",
    results_wanted=30,
    hours_old=72,
    linkedin_fetch_description=True,
)
print(len(jobs), "vagas")
jobs.to_csv("jobs.csv", index=False)  # pode ser importado na interface depois
```

Todos os parâmetros, colunas retornadas e detalhes por site estão em [`docs/jobspy-library.md`](docs/jobspy-library.md).

---

## Solução de problemas

| Problema | O que fazer |
|---|---|
| `pip install .` falha com erro de versão do Python | Você está com Python < 3.10. Recrie o `.venv` com um Python mais novo (veja [Requisitos](#requisitos)). |
| `./start.sh: Permission denied` | `chmod +x start.sh` |
| `JobSpy UI já está rodando` | Já existe um servidor na porta. Use a aba aberta ou rode com `--port 9000`. |
| LinkedIn com erro **429** | Bloqueio por excesso de requisições. Diminua "Resultados por site", espere um pouco ou use proxies. |
| Google Jobs sempre com 0 vagas | Acontece com frequência. Desative o site em **Automação → Saúde dos sites**. |
| Glassdoor com erro | Comum. Desative o site ou confira se o país é suportado. |
| Vagas do LinkedIn com score baixo e "Sem descrição" | Marque "LinkedIn: buscar descrição completa" no formulário ou no template. |
| O CV não foi lido | O PDF provavelmente é uma imagem escaneada. Exporte o currículo como PDF a partir do editor de texto. |
| Uma busca ficou como "interrompida" | O servidor foi desligado ou reiniciado no meio dela (o `--reload` reinicia ao salvar um `.py`). Rode de novo. |
| Agendamento não rodou | O servidor precisa estar ligado no dia. Confira se o agendamento está marcado e se o dia da semana está selecionado. |
| Quero apagar tudo e recomeçar | Com o servidor desligado, apague `webapp/data/`. |

---

## Créditos e licença

- Raspagem: [**JobSpy**](https://github.com/speedyapply/JobSpy), de Cullen Watson, Zachary Hampton e contribuidores, sob licença MIT. O código em `jobspy/` vem desse projeto.
- Interface web, score, automações e importação de CV: [Dev-Etto](https://github.com/Dev-Etto).

Distribuído sob a licença MIT; veja [`LICENSE`](LICENSE).

> **Uso responsável:** este projeto acessa páginas públicas dos sites de vagas para uso pessoal. Respeite os termos de uso de cada site, não faça buscas em volume abusivo e não use os dados para spam.
