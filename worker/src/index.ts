import redis from './lib/redis';
import { query } from './lib/db';
import { decrypt } from './lib/crypto';
import { sendBatchToMeta, QueueEvent, MetaEvent } from './lib/meta';

const LOCK_KEY = 'worker:lock';
const LOCK_TTL = 30;
const RENEW_INTERVAL = 10000;
let lockInterval: NodeJS.Timeout | null = null;
let isRunning = true;

interface CachedClientCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
  expiresAt: number;
}

const credentialsCache = new Map<string, CachedClientCredentials>();
const CREDENTIALS_TTL = 60 * 1000;

async function acquireLock(): Promise<boolean> {
  try {
    const res = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
    return res === 'OK';
  } catch (err) {
    console.error('[WORKER] Erro ao tentar adquirir trava no Redis:', err);
    return false;
  }
}

async function renewLock() {
  try {
    await redis.expire(LOCK_KEY, LOCK_TTL);
  } catch (err) {
    console.error('[WORKER] Erro ao renovar trava no Redis:', err);
  }
}

async function getClientCredentials(clientId: string): Promise<CachedClientCredentials | null> {
  const cached = credentialsCache.get(clientId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) return cached;

  try {
    const res = await query('SELECT pixel_id, access_token, test_event_code FROM clients WHERE id = $1 AND status = \'active\'', [clientId]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const creds: CachedClientCredentials = {
      pixelId: row.pixel_id,
      accessToken: decrypt(row.access_token),
      testEventCode: row.test_event_code || null,
      expiresAt: now + CREDENTIALS_TTL,
    };

    credentialsCache.set(clientId, creds);
    return creds;
  } catch (err) {
    console.error(`[WORKER] Erro ao obter credenciais do cliente ${clientId}:`, err);
    return null;
  }
}

function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as Partial<T>;
}

function toMetaEvent(ev: QueueEvent): MetaEvent {
  return cleanObject({
    event_name: ev.event_name,
    event_time: ev.event_time,
    event_id: ev.event_id,
    action_source: ev.action_source || 'website',
    event_source_url: ev.event_source_url,
    user_data: cleanObject(ev.user_data || {}),
    custom_data: ev.custom_data || {},
  }) as MetaEvent;
}

async function logEvent(ev: QueueEvent, success: boolean, response: any) {
  try {
    await query(
      `INSERT INTO events_log (
        client_id, workspace_id, source_id, source_type, event_name, event_id, event_time,
        event_source_url, sent_to_meta, meta_response, request_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        ev.client_id,
        ev.workspace_id || null,
        ev.source_id || null,
        ev.source_type || null,
        ev.event_name,
        ev.event_id,
        ev.event_time,
        ev.event_source_url || null,
        success,
        JSON.stringify(response),
        JSON.stringify(ev),
      ]
    );
  } catch (dbErr) {
    console.error('[WORKER] Erro ao gravar log de auditoria no Postgres:', dbErr);
  }
}

async function processBatch(events: QueueEvent[]) {
  console.log(`[WORKER] Iniciando processamento de lote com ${events.length} eventos.`);

  const groups = new Map<string, QueueEvent[]>();
  for (const ev of events) {
    const list = groups.get(ev.client_id) || [];
    list.push(ev);
    groups.set(ev.client_id, list);
  }

  for (const [clientId, clientEvents] of groups.entries()) {
    const creds = await getClientCredentials(clientId);

    if (!creds) {
      console.warn(`[WORKER] Ignorando lote para cliente ${clientId}: inativo ou inexistente.`);
      continue;
    }

    const metaEvents = clientEvents.map(toMetaEvent);

    try {
      console.log(`[WORKER] Enviando batch de ${metaEvents.length} eventos para Pixel ${creds.pixelId}`);
      const metaResult = await sendBatchToMeta(creds.pixelId, creds.accessToken, metaEvents, creds.testEventCode);

      await Promise.all(clientEvents.map((ev) => logEvent(ev, metaResult.success, metaResult.response)));
      console.log(`[WORKER] Lote de ${clientEvents.length} eventos concluído. Sucesso: ${metaResult.success}`);
    } catch (err) {
      console.error(`[WORKER] Falha crítica ao processar lote para cliente ${clientId}:`, err);
      await Promise.all(clientEvents.map((ev) => logEvent(ev, false, { error: err instanceof Error ? err.message : String(err) })));
    }
  }
}

async function startWorker() {
  console.log('[WORKER] Iniciando ciclo de consumo...');

  while (isRunning) {
    try {
      const res = await redis.blpop('queue:events', 5);

      if (res) {
        const [, firstRawEvent] = res;
        const batch: QueueEvent[] = [JSON.parse(firstRawEvent) as QueueEvent];
        const startTime = Date.now();

        while (batch.length < 1000 && (Date.now() - startTime) < 5000) {
          const rawExtra = await redis.rpop('queue:events');
          if (!rawExtra) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const recheck = await redis.rpop('queue:events');
            if (!recheck) break;
            batch.push(JSON.parse(recheck) as QueueEvent);
          } else {
            batch.push(JSON.parse(rawExtra) as QueueEvent);
          }
        }

        await processBatch(batch);
      }
    } catch (err) {
      console.error('[WORKER] Erro no loop de consumo:', err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function bootstrap() {
  console.log('[WORKER] Tentando obter trava de concorrência...');

  const gotLock = await acquireLock();
  if (!gotLock) {
    console.error('[WORKER] Outro worker ativo detectado. Encerrando processo para evitar duplicidades.');
    process.exit(0);
  }

  console.log('[WORKER] Trava de concorrência adquirida. Iniciando daemon.');
  lockInterval = setInterval(renewLock, RENEW_INTERVAL);
  startWorker();
}

function shutdown(signal: string) {
  console.log(`[WORKER] Recebido sinal ${signal}. Encerrando suavemente...`);
  isRunning = false;

  if (lockInterval) clearInterval(lockInterval);

  redis.del(LOCK_KEY).then(() => {
    console.log('[WORKER] Trava liberada com sucesso.');
    process.exit(0);
  }).catch((err) => {
    console.error('[WORKER] Erro ao liberar trava no shutdown:', err);
    process.exit(1);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap();
