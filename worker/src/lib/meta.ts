import dotenv from 'dotenv';

dotenv.config();

// Definição da interface do payload individual de evento da Meta CAPI
export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source: string;
  action_source: string;
  user_data: {
    em?: string[]; // email hash SHA-256
    ph?: string[]; // phone hash SHA-256
    client_ip_address?: string;
    client_user_agent?: string;
    fbp?: string;
    fbc?: string | null;
  };
  custom_data?: Record<string, any>;
}

// Interface de entrada que vem do Redis
export interface QueueEvent {
  client_id: string;
  pixel_id: string;
  event_name: string;
  event_id: string;
  email?: string;
  phone?: string;
  fbp?: string;
  fbc?: string | null;
  custom_data?: Record<string, any>;
  ip?: string;
  user_agent?: string;
  event_time: number;
}

/**
 * Envia um lote de eventos para o Facebook Conversions API.
 * Suporta retry com backoff exponencial.
 */
export async function sendBatchToMeta(
  pixelId: string,
  accessToken: string,
  events: MetaEvent[],
  maxRetries = 3
): Promise<{ success: boolean; response: any; status: number }> {
  const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;
  const payload = {
    data: events,
  };

  let attempt = 0;
  let delay = 1000; // 1s inicial

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const status = response.status;
      const resData = await response.json();

      if (status === 200) {
        return { success: true, response: resData, status };
      }

      // Se for 429 (Rate Limit) ou 5xx (Erro no servidor da Meta), tentamos novamente
      if (status === 429 || (status >= 500 && status < 600)) {
        attempt++;
        if (attempt <= maxRetries) {
          console.warn(`[META CAPI] Tentativa ${attempt} falhou com status ${status}. Retentando em ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Dobra o delay (1s, 2s, 4s...)
          continue;
        }
      }

      // Erros de cliente (400, 401, 403, etc.) não sofrem retry pois a requisição está inválida
      return { success: false, response: resData, status };
    } catch (err: any) {
      attempt++;
      console.error(`[META CAPI] Erro de rede na tentativa ${attempt}: ${err.message}`);
      
      if (attempt <= maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      
      return { success: false, response: { error: err.message }, status: 0 };
    }
  }

  return { success: false, response: { error: 'Max retries reached' }, status: 0 };
}
