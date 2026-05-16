# 🚀 TrackServer v1.0 — Servidor de Tracking Multi-Tenant Self-Hosted

O **TrackServer** é um servidor de tracking server-side multi-tenant robusto, de baixíssimo custo e altíssima performance, equivalente funcional à plataforma Stape, mas completamente self-hosted. 

Ele foi desenhado para receber eventos do navegador (através de domínios customizados do cliente), tratá-los, persistir cookies first-party ultra-persistentes para contornar o ITP/Adblocks e despachar os eventos enriquecidos em lotes otimizados para a **Meta Conversions API (CAPI)**.

---

## ⚡ Diferenciais Técnicos

- **Custo Operacional de R$120/mês:** Roda perfeitamente em uma única VPS Hetzner CPX51 (8vCPU, 16GB RAM) suportando até 2.000 clientes ativos.
- **Match Quality Imbatível (EMQ >= 8.5):** Sanitização avançada e hashing SHA-256 de dados PII (e-mail, telefone) do lado do servidor antes de enviar à Meta.
- **First-Party Cookies Duráveis (90 dias):** Injeção automatizada de cookies `_fbp`/`_fbc` via header HTTP `Set-Cookie` com diretivas `SameSite=Lax; Secure` diretamente na resposta do servidor, contornando a expiração de 7 dias imposta pelo Safari ITP para cookies via JavaScript.
- **Segurança de Criptografia AES-256-GCM:** Todos os tokens de acesso dos clientes são mantidos fortemente encriptados no banco de dados.
- **Dynamic Batch Aggregator:** Worker inteligente que utiliza `BLPOP` + `RPOP` no Redis para acumular dinamicamente lotes de até 1.000 eventos (ou até 5 segundos) por cliente, minimizando o throughput de rede com o endpoint da Meta.
- **Concorrência Protegida por Mutex:** Bloqueio distribuído no Redis impedindo duplicações indesejadas de disparos por múltiplos workers concorrentes.
- **Retry com Backoff Exponencial:** Mecanismo resiliente que retenta requisições falhas de rede ou rate limits (429/5xx) da Meta com delays progressivos de 1s, 2s e 4s.

---

## 🛠️ Stack Tecnológica

- **Core:** Node.js 20 + Fastify (API de baixíssima latência) + TypeScript
- **Fila & Cache:** Redis 7 (Persistência AOF ativada)
- **Banco de Dados:** PostgreSQL 16
- **Proxy Reverso & SSL:** Nginx Alpine (Wildcard SSL via `acme.sh` + Rate limit por IP)
- **Observabilidade:** Grafana 10 + Grafana Loki

---

## 📦 Estrutura do Repositório

```text
├── docker-compose.yml       # Orquestração de todos os 7 serviços Docker
├── .gitignore               # Exclusão segura de builds e chaves
├── api/                     # Servidor Fastify (Recepção & Administração)
│   ├── src/
│   │   ├── index.ts         # Entrypoint, CORS e Cookies
│   │   ├── routes/          # Rotas de Eventos e Administração
│   │   └── lib/             # Criptografia, DB, Redis e Hashing SHA-256
│   └── Dockerfile           # Dockerfile multi-stage de produção
├── worker/                  # Daemon consumidor de fila Redis e integração Meta
│   ├── src/
│   │   ├── index.ts         # Daemon com Mutex Lock e loops
│   │   └── lib/             # Mapeamento Meta CAPI e retries com backoff
│   └── Dockerfile           # Dockerfile multi-stage de produção
├── postgres/
│   └── init.sql             # Scripts SQL DDL de tabelas e indexações
├── nginx/
│   └── nginx.conf           # Proxy reverso, segurança SSL e rate limit por IP
├── grafana/
│   └── provisioning/        # Configuração automática do datasource Loki
└── docs/
    ├── snippet.js           # SDK do cliente para instalação no site
    ├── onboarding.md        # Runbook de CNAME de domínio e cadastro do cliente
    └── token-rotation.md    # Runbook de atualização segura de tokens
```

---

## 🚀 Como Iniciar

### 1. Requisitos Prévios
Certifique-se de ter instalado em sua VPS:
- Docker >= 24.0.0
- Docker Compose >= 2.20.0

### 2. Configurando o Ambiente
Copie o arquivo de exemplo e edite as chaves:
```bash
cp .env.example .env
```
> Edite a variável `ENCRYPTION_KEY` com uma chave hex de exatamente 64 caracteres (32 bytes) para a criptografia AES, e mude as senhas padrões do Postgres, Redis e Grafana.

### 3. Rodando o Sistema
Suba todos os containers de forma integrada:
```bash
docker compose up -d --build
```

---

## 🔍 Monitorando
- **Logs unificados:** Acesse os logs dos containers pelo Docker: `docker compose logs -f`
- **Dashboard de Métricas:** Acesse o painel do Grafana no endereço `http://IP-DA-SUA-VPS:3001` (Credenciais configuradas no `.env`). O datasource Loki já vem provisionado por padrão!

---

## 📄 Licença
Licenciado sob a [MIT License](LICENSE).
