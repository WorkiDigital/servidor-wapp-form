import redis from './lib/redis';
import { query } from './lib/db';
import { decrypt } from './lib/crypto';
import { sendBatchToMeta, QueueEvent, MetaEvent } from './lib/meta';

// Configuração do Worker
const LOCK_KEY = 'worker:lock';
const LOCK_TTL = 30; // 30 segundos
const RENEW_INTERVAL = 10000; // 10 segundos
let lockInterval: NodeJS.Timeout | null = null;
let isRunning = true;

// Cache local de Tokens e Pixels decriptados (evita sobrecarga no banco)
interface CachedClientCredentials {
  pixelId: string;
  accessToken: string;
  expiresAt: number;
}
const credentialsCache = new Map<string, CachedClientCredentials>();
const CREDENTIALS_TTL = 60 * 1000; // 1 minuto

/**
 * Adquire o Mutex no Redis para garantir que apenas um Worker rode por vez.
 */
async function acquireLock(): Promise<boolean> {
  try {
    const res = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
    return res === 'OK';
  } catch (err) {
    console.error('[WORKER] Erro ao tentar adquirir trava no Redis:', err);
    return false;
  }
}

/**
 * Renova a expiração do Mutex do Worker.
 */
async function renewLock() {
  try {
    await redis.expire(LOCK_KEY, LOCK_TTL);
  } catch (err) {
    console.error('[WORKER] Erro ao renovar trava no Redis:', err);
  }
}

/**
 * Obtém as credenciais do cliente decriptadas, com cache.
 */
async function getClientCredentials(clientId: string): Promise<CachedClientCredentials | null> {
  const cached = credentialsCache.get(clientId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached;
  }

  try {
    const res = await query('SELECT pixel_id, access_token FROM clients WHERE id = $1 AND status = \'active\'', [clientId]);
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const decryptedToken = decrypt(row.access_token);

    const creds: CachedClientCredentials = {
      pixelId: row.pixel_id,
      accessToken: decryptedToken,
      expiresAt: now + CREDENTIALS_TTL,
    };

    credentialsCache.set(clientId, creds);
    return creds;
  } catch (err) {
    console.error(`[WORKER] Erro ao obter credenciais do cliente ${clientId}:`, err);
    return null;
  }
}

/**
 * Processa um lote acumulado de eventos agrupando por cliente.
 */
async function processBatch(events: QueueEvent[]) {
  console.log(`[WORKER] Iniciando processamento de lote com ${events.length} eventos.`);

  // 1. Agrupar eventos por client_id
  const groups = new Map<string, QueueEvent[]>();
  for (const ev of events) {
    const list = groups.get(ev.client_id) || [];
    list.push(ev);
    groups.set(ev.client_id, list);
  }

  // 2. Processar cada cliente individualmente
  for (const [clientId, clientEvents] of groups.entries()) {
    const creds = await getClientCredentials(clientId);

    if (!creds) {
      console.warn(`[WORKER] Ignorando lote para cliente ${clientId}: Inativo ou inexistente.`);
      continue;
    }

    // Mapear para o payload do Facebook CAPI
    const metaEvents: MetaEvent[] = clientEvents.map((ev) => {
      const uData: any = {};
      
      if (ev.email) uData.em = [ev.email];
      if (ev.phone) uData.ph = [ev.phone];
      if (ev.ip) uData.client_ip_address = ev.ip;
      if (ev.user_agent) uData.client_user_agent = ev.user_agent;
      if (ev.fbp) uData.fbp = ev.fbp;
      if (ev.fbc) uData.fbc = ev.fbc;

      return {
        event_name: ev.event_name,
        event_time: ev.event_time,
        event_id: ev.event_id,
        event_source: 'website',
        action_source: 'website',
        user_data: uData,
        custom_data: ev.custom_data || {},
      };
    });

    try {
      console.log(`[WORKER] Enviando batch de ${metaEvents.length} eventos para Pixel ${creds.pixelId}`);
      
      const metaResult = await sendBatchToMeta(creds.pixelId, creds.accessToken, metaEvents);

      // 3. Salvar os resultados no Postgres (events_log)
      const insertPromises = clientEvents.map(async (ev) => {
        try {
          await query(
            `INSERT INTO events_log (client_id, event_name, event_id, event_time, sent_to_meta, meta_response)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              ev.client_id,
              ev.event_name,
              ev.event_id,
              ev.event_time,
              metaResult.success,
              JSON.stringify(metaResult.response),
            ]
          );
        } catch (dbErr) {
          console.error('[WORKER] Erro ao gravar log de auditoria no Postgres:', dbErr);
        }
      });

      await Promise.all(insertPromises);
      console.log(`[WORKER] Lote de ${clientEvents.length} eventos concluído. Sucesso: ${metaResult.success}`);

    } catch (err) {
      console.error(`[WORKER] Falha crítica ao processar lote para cliente ${clientId}:`, err);
    }
  }
}

/**
 * Loop principal de consumo de fila.
 */
async function startWorker() {
  console.log('[WORKER] Iniciando ciclo de consumo...');

  while (isRunning) {
    try {
      // BLPOP bloqueia a conexão por até 5 segundos esperando por uma mensagem
      const res = await redis.blpop('queue:events', 5);

      if (res) {
        const [, firstRawEvent] = res;
        const firstEvent = JSON.parse(firstRawEvent) as QueueEvent;

        const batch: QueueEvent[] = [firstEvent];
        const startTime = Date.now();

        // Tentar ler mais eventos rapidamente acumulando em lote (até 1000 ou 5 segundos)
        while (batch.length < 1000 && (Date.now() - startTime) < 5000) {
          const rawExtra = await redis.rpop('queue:events');
          if (!rawExtra) {
            // Dormir um pouco se a fila estiver vazia antes de testar de novo
            await new Promise((resolve) => setTimeout(resolve, 100));
            const recheck = await redis.rpop('queue:events');
            if (!recheck) break; // Sai se realmente não houver mais eventos imediatos
            batch.push(JSON.parse(recheck));
          } else {
            batch.push(JSON.parse(rawExtra));
          }
        }

        // Processar o lote de forma assíncrona para não travar o loop
        await processBatch(batch);
      }
    } catch (err) {
      console.error('[WORKER] Erro no loop de consumo:', err);
      // Evita loops infinitos de erro rápido travando a CPU
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/**
 * Função de inicialização com mutex.
 */
async function bootstrap() {
  console.log('[WORKER] Tentando obter trava de concorrência...');
  
  const gotLock = await acquireLock();

  if (!gotLock) {
    console.error('[WORKER] Outro worker ativo detectado. Encerrando processo para evitar duplicidades.');
    process.exit(0);
  }

  console.log('[WORKER] Trava de concorrência adquirida. Iniciando daemon.');

  // Configurar renovação periódica da trava
  lockInterval = setInterval(renewLock, RENEW_INTERVAL);

  // Iniciar loop
  startWorker();
}

// Tratamento suave de encerramento do processo (Graceful Shutdown)
function shutdown(signal: string) {
  console.log(`[WORKER] Recebido sinal ${signal}. Encerrando suavemente...`);
  isRunning = false;
  
  if (lockInterval) {
    clearInterval(lockInterval);
  }

  // Deletar a trava no Redis antes de fechar
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
