import dotenv from 'dotenv';

dotenv.config();

export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  zp?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string | null;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, any>;
}

export interface QueueEvent {
  client_id: string;
  workspace_id?: string;
  source_id?: string;
  source_type?: string;
  pixel_id: string;
  test_event_code?: string;
  event_name: string;
  event_id: string;
  event_time: number;
  event_source_url?: string;
  action_source?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, any>;
  metadata?: Record<string, any>;
}

export async function sendBatchToMeta(
  pixelId: string,
  accessToken: string,
  events: MetaEvent[],
  testEventCode?: string | null,
  maxRetries = 3
): Promise<{ success: boolean; response: any; status: number }> {
  const version = process.env.META_API_VERSION || 'v22.0';
  const url = `https://graph.facebook.com/${version}/${pixelId}/events?access_token=${accessToken}`;
  const payload = {
    data: events,
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  };

  let attempt = 0;
  let delay = 1000;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const status = response.status;
      const resData = await response.json();

      if (status === 200) {
        return { success: true, response: resData, status };
      }

      if (status === 429 || (status >= 500 && status < 600)) {
        attempt += 1;
        if (attempt <= maxRetries) {
          console.warn(`[META CAPI] Tentativa ${attempt} falhou com status ${status}. Retentando em ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
      }

      return { success: false, response: resData, status };
    } catch (err: any) {
      attempt += 1;
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
