/**
 * TrackServer SDK v1.0 - Snippet de Integração Cliente
 * Copie e cole este script no cabeçalho (head) do seu site.
 */
(function() {
  // Configurações principais - Substitua com seus dados
  const CONFIG = {
    subdomain: 'clinicajoao', // Substitua pelo subdomínio do seu SaaS
    trackingDomain: 'track.seusaas.com', // Domínio principal do TrackServer
    pixelId: 'SUO_PIXEL_ID_META' // Seu Pixel ID da Meta
  };

  // Determinar a URL da API do TrackServer
  const apiEndpoint = `https://${CONFIG.subdomain}.${CONFIG.trackingDomain}/api/v1/event`;

  // Utilitário para ler cookies do browser
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // Gerador de UUID v4 nativo e leve
  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Namespace global para o tracking
  const TrackServer = {
    /**
     * Dispara um evento unificado (Meta Pixel + Server-Side Conversions API)
     * @param {string} eventName Nome do evento (ex: Lead, PageView, Purchase)
     * @param {Object} customData Dados personalizados (value, currency, content_name)
     * @param {Object} piiData Dados de identificação do usuário (email, phone)
     */
    track: function(eventName, customData = {}, piiData = {}) {
      const eventId = generateUUID();
      const fbp = getCookie('_fbp');
      const fbc = getCookie('_fbc');

      console.log(`[TrackServer] Rastreando evento: ${eventName}`, { eventId, customData, piiData });

      // 1. Disparar no Browser via Meta Pixel clássico (se estiver presente)
      if (typeof window.fbq === 'function') {
        window.fbq('track', eventName, customData, { eventID: eventId });
      } else {
        console.warn('[TrackServer] Meta Pixel tradicional não encontrado na página.');
      }

      // 2. Preparar payload para o Server-Side
      const payload = {
        event_name: eventName,
        event_id: eventId,
        email: piiData.email || undefined,
        phone: piiData.phone || undefined,
        fbp: fbp || undefined,
        fbc: fbc || undefined,
        custom_data: customData
      };

      // 3. Enviar para a API CAPI self-hosted via fetch
      // credentials: 'include' permite ler/gravar cookies first-party
      fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        credentials: 'include'
      })
      .then(response => response.json())
      .then(data => {
        console.log(`[TrackServer] Sucesso CAPI:`, data);
      })
      .catch(err => {
        console.error(`[TrackServer] Erro CAPI:`, err);
      });
    },

    /**
     * Intercepta automaticamente o preenchimento de e-mail e telefone em qualquer formulário da página.
     */
    autoCaptureForm: function() {
      let capturedEmail = '';
      let capturedPhone = '';

      // Escutar mudanças globais nos inputs para capturar PII antes do submit
      document.addEventListener('input', function(event) {
        const target = event.target;
        if (!target) return;

        // Capturar E-mail
        if (target.type === 'email' || target.name?.toLowerCase().includes('email')) {
          capturedEmail = target.value;
        }

        // Capturar Telefone/WhatsApp
        if (target.type === 'tel' || target.name?.toLowerCase().includes('telefone') || target.name?.toLowerCase().includes('phone') || target.name?.toLowerCase().includes('whatsapp')) {
          capturedPhone = target.value;
        }
      });

      // Interceptar submissão de formulários
      document.addEventListener('submit', function(event) {
        // Delay minúsculo para garantir que outros scripts processem a ação
        setTimeout(() => {
          if (capturedEmail || capturedPhone) {
            TrackServer.track('Lead', {}, {
              email: capturedEmail,
              phone: capturedPhone
            });
          }
        }, 100);
      });
    }
  };

  // Tornar acessível globalmente
  window.TrackServer = TrackServer;

  // Rastrear PageView automaticamente ao inicializar
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    TrackServer.track('PageView');
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      TrackServer.track('PageView');
    });
  }

  // Ativar captura automática de formulários por padrão
  TrackServer.autoCaptureForm();
})();
