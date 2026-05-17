# TrackServer API Universal

O TrackServer é uma camada genérica de tracking server-side multi-tenant. Ele pode ser usado por formulários, landing pages, checkouts, CRMs, sites e qualquer aplicação que precise enviar eventos para a Meta Conversions API com fila, retry, cookies first-party e deduplicação.

## 1. Criar ou sincronizar um client

Endpoint administrativo:

```http
POST /admin/clients
Authorization: Bearer <TRACK_SERVER_ADMIN_SECRET>
Content-Type: application/json
```

Payload:

```json
{
  "workspace_id": "workspace_123",
  "source_id": "source_123",
  "source_type": "form",
  "source_slug": "lead-form",
  "tracking_domain": "track.empresa.com",
  "external_ref": "opcional",
  "pixel_id": "123456789",
  "access_token": "EAAB...",
  "test_event_code": "TEST123",
  "status": "active",
  "metadata": {}
}
```

O `access_token` é criptografado antes de ser salvo no banco.

## 2. Evento server-side

Use esse endpoint para enviar conversões a partir de qualquer backend.

```http
POST /api/v1/server-event
Authorization: Bearer <TRACK_SERVER_ADMIN_SECRET>
Content-Type: application/json
```

Payload:

```json
{
  "workspace_id": "workspace_123",
  "source_id": "source_123",
  "source_type": "form",
  "tracking_domain": "track.empresa.com",
  "event_name": "Lead",
  "event_id": "lead_123",
  "event_source_url": "https://site.com/pagina",
  "action_source": "website",
  "conversion_id": "submission_123",
  "contact_id": "lead_123",
  "schedule_id": null,
  "user_data": {
    "email": "email@email.com",
    "phone": "+5585999999999",
    "first_name": "João",
    "last_name": "Silva",
    "city": "Fortaleza",
    "state": "CE",
    "country": "br",
    "zip": "60000000",
    "external_id": "lead_123",
    "client_ip_address": "179.0.0.1",
    "client_user_agent": "Mozilla/5.0...",
    "fbp": "fb.1....",
    "fbc": "fb.1...."
  },
  "custom_data": {
    "value": 100,
    "currency": "BRL",
    "content_name": "Lead Form",
    "lead_score": 87,
    "lead_segment": "qualified"
  },
  "metadata": {}
}
```

Campos hasheados automaticamente:

- email -> `em`
- phone -> `ph`
- first_name -> `fn`
- last_name -> `ln`
- city -> `ct`
- state -> `st`
- country -> `country`
- zip -> `zp`
- external_id -> `external_id`

Campos que não são hasheados:

- client_ip_address
- client_user_agent
- fbp
- fbc

## 3. Snippet browser

```html
<script src="https://track.empresa.com/snippet.js"></script>
```

Configuração opcional antes do script:

```html
<script>
  window.TrackServerConfig = {
    autoPageView: true,
    autoCaptureForm: false,
    source_id: 'source_123',
    source_type: 'form'
  }
</script>
<script src="https://track.empresa.com/snippet.js"></script>
```

O snippet:

- dispara PageView por padrão;
- cria/lê `_fbp` e `_fbc`;
- captura `fbclid`, UTMs, referrer e URL;
- expõe `window.TrackServer.getSession()`;
- não dispara Lead automaticamente.

Enviar um evento browser manual:

```js
window.TrackServer.track(
  'Lead',
  { value: 100, currency: 'BRL', content_name: 'Landing Page' },
  { email: 'email@email.com', phone: '+5585999999999' },
  { event_id: 'lead_123', source_id: 'source_123', source_type: 'landing_page' }
)
```

## 4. Deduplicação

Use o mesmo `event_id` no browser e no servidor:

```txt
PageView: pageview_{uuid}
Lead: lead_{conversion_id}
QualifiedLead: qualified_lead_{conversion_id}
Schedule: schedule_{schedule_id}
Purchase: purchase_{order_id}
```

## 5. DNS

Para domínio customizado, recomende CNAME:

```txt
track.empresa.com -> track.seudominio.com
```

Depois carregue o snippet usando o domínio do cliente:

```html
<script src="https://track.empresa.com/snippet.js"></script>
```
