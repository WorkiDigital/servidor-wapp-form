# Manual de Onboarding DNS & Snippet do Cliente

Bem-vindo ao **TrackServer**! Este manual guiará você e seus clientes no processo de apontamento de domínio first-party (CNAME) e na instalação do código de rastreamento para garantir a nota máxima de Event Match Quality (EMQ) na Meta.

---

## 🌐 1. Configurando o Domínio Customizado (CNAME)

Para escapar dos bloqueios de navegadores (como o Safari ITP e Adblocks), o rastreamento precisa rodar sob um **subdomínio próprio do cliente** (ex: `track.cliente.com`).

### Instruções para o Cliente:
Peça ao cliente para entrar no provedor de hospedagem de domínio dele (ex: Cloudflare, GoDaddy, Hostgator, Registro.br) e adicionar a seguinte entrada na Zona DNS:

| Tipo | Nome (Host) | Destino (Points to) | TTL | Proxy Status |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `track` | `track.seusaas.com` | Automático ou 3600 | **Desativado (Cinza na Cloudflare)** |

> [!IMPORTANT]
> Se o cliente usar **Cloudflare**, o ícone de nuvem laranja (Proxy) **DEVE ser mantido como Cinza (DNS Only)**. Caso contrário, a Cloudflare barrará a geração de certificado SSL automático na VPS do TrackServer.

---

## 🛠️ 2. Cadastro no Painel do SaaS

Como administrador do SaaS, assim que o cliente fizer o apontamento DNS, registre-o fazendo um POST para o endpoint administrativo ou preenchendo no seu painel:

### Requisição HTTP (Onboarding):
```http
POST https://api.seusaas.com/admin/clients
Authorization: Basic <CREDENCIAIS_BASE64>
Content-Type: application/json

{
  "subdomain": "clientejoao",
  "pixel_id": "123456789012345",
  "access_token": "EAAG..."
}
```

---

## 💻 3. Integrando o Snippet no Site

Após a propagação DNS (geralmente menos de 10 minutos) e o cadastro do cliente, integre o snippet abaixo diretamente no cabeçalho (dentro da tag `<head>`) do site do cliente:

```html
<!-- TrackServer Unified Tracking -->
<script>
(function() {
  var CONFIG = {
    subdomain: 'clientejoao', // Subdomínio cadastrado
    trackingDomain: 'seusaas.com', // Domínio principal do seu SaaS
    pixelId: '123456789012345' // Meta Pixel ID do cliente
  };

  // Carregar o SDK do TrackServer
  var script = document.createElement('script');
  script.src = 'https://' + CONFIG.subdomain + '.' + CONFIG.trackingDomain + '/docs/snippet.js';
  script.async = true;
  document.head.appendChild(script);
})();
</script>
```

---

## 🧪 4. Como Testar e Validar

1. Acesse o site do cliente e abra o **Google Chrome DevTools** (F12).
2. Vá na aba **Network** (Rede) e filtre por `event`.
3. Preencha e envie um formulário de teste.
4. Verifique se o disparo `POST` foi feito para `https://track.cliente.com/api/v1/event` com status `200 OK`.
5. Na aba **Application** -> **Cookies**, confirme se o cookie `_fbp` foi criado e possui expiração para 90 dias no futuro.
