# Manual de Rotação de Access Tokens da Meta

Os tokens de acesso da Conversions API (CAPI) gerados no Meta Events Manager podem expirar ou precisar de revogação por motivos de segurança. Este runbook explica como atualizar o token de um cliente de forma segura no **TrackServer** com **zero downtime** e sem perda de eventos.

---

## 🔒 Como Funciona a Rotação Segura

O TrackServer utiliza criptografia de ponta **AES-256-GCM** para persistir as chaves no banco de dados Postgres e usa cache local (TTL de 60 segundos) tanto na API Fastify quanto no Worker.

Quando você rotaciona um token:
1. O novo token é criptografado e salvo imediatamente no Postgres.
2. A fila do Redis continua a receber eventos normalmente sem rejeitar nenhuma requisição.
3. No máximo em 60 segundos, o cache expira e o Worker passa a descriptografar e usar o novo token nas requisições batch para a Meta.

---

## 🛠️ Executando a Rotação via API Administrativa

Para atualizar o token do cliente, envie uma requisição `PATCH` ao endpoint administrativo com o ID do cliente:

### Requisição HTTP (PATCH):
```http
PATCH https://api.seusaas.com/admin/clients/c48679d7-8ab2-4b2e-9d29-c89b8d2345ef
Authorization: Basic <CREDENCIAIS_BASE64>
Content-Type: application/json

{
  "access_token": "EAAG_NOVO_TOKEN_GERADO_NO_EVENTS_MANAGER"
}
```

### Resposta de Sucesso:
```json
{
  "message": "Client updated successfully",
  "client": {
    "id": "c48679d7-8ab2-4b2e-9d29-c89b8d2345ef",
    "subdomain": "clinicajoao",
    "pixel_id": "123456789012345",
    "status": "active",
    "updated_at": "2026-05-16T22:45:00.000Z"
  }
}
```

---

## 🔍 Verificando os Logs do Worker

Após a rotação, você pode monitorar o sucesso dos disparos no terminal do Worker:

```bash
docker compose logs -f worker
```

**Log esperado após 60 segundos:**
```text
[WORKER] Iniciando processamento de lote com 5 eventos.
[WORKER] Enviando batch de 5 eventos para Pixel 123456789012345
[WORKER] Lote de 5 eventos concluído. Sucesso: true
```
