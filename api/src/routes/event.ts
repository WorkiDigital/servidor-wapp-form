import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../lib/db';
import redis from '../lib/redis';
import { hashSHA256, hashPhone } from '../lib/hash';

// Cache local de clientes em memória (TTL de 60 segundos)
interface CachedClient {
  id: string;
  pixel_id: string;
  status: string;
  expiresAt: number;
}
const clientCache = new Map<string, CachedClient>();
const CACHE_TTL = 60 * 1000; // 60s

// Interface para o corpo da requisição de evento
interface EventRequestBody {
  event_name: string;
  event_id: string;
  email?: string;
  phone?: string;
  fbp?: string;
  fbc?: string;
  custom_data?: Record<string, any>;
}

// Gerador de cookie _fbp padrão da Meta
function generateFbp(): string {
  const version = '1';
  const creationTime = Date.now();
  const randomVal = Math.floor(Math.random() * 1000000000);
  return `fb.${version}.${creationTime}.${randomVal}`;
}

// Gerador de cookie _fbc padrão da Meta caso exista fbclid
function generateFbc(fbclid: string): string {
  const version = '1';
  const creationTime = Date.now();
  return `fb.${version}.${creationTime}.${fbclid}`;
}

export default async function eventRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  
  fastify.post('/api/v1/event', async (request: FastifyRequest<{ Body: EventRequestBody }>, reply: FastifyReply) => {
    const host = request.headers.host || '';
    
    // 1. Resolver client_id pelo header Host
    // clinicajoao.track.seusaas.com -> clinicajoao
    // track.cliente.com -> track.cliente.com (caso CNAME direto)
    let subdomain = host.split(':')[0]; // remove a porta se houver
    if (subdomain.includes('.track.seusaas.com')) {
      subdomain = subdomain.replace('.track.seusaas.com', '');
    } else {
      // Se for domínio customizado direto, pegamos o hostname inteiro
      subdomain = subdomain.toLowerCase();
    }

    // Buscar no cache local ou no Postgres
    let client: CachedClient | null = null;
    const cached = clientCache.get(subdomain);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      client = cached;
    } else {
      // Query ao Postgres
      try {
        const res = await query(
          'SELECT id, pixel_id, status FROM clients WHERE subdomain = $1 OR subdomain = $2 LIMIT 1',
          [subdomain, host.split(':')[0].toLowerCase()]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          client = {
            id: row.id,
            pixel_id: row.pixel_id,
            status: row.status,
            expiresAt: now + CACHE_TTL,
          };
          clientCache.set(subdomain, client);
        }
      } catch (err) {
        request.log.error(err, 'Database client resolution error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to resolve client' });
      }
    }

    // Se cliente não existe ou está pausado
    if (!client || client.status !== 'active') {
      return reply.status(404).send({ error: 'Not Found', message: 'Client not found or inactive' });
    }

    // 2. Aplicar Rate Limiting por client_id via Redis
    const rateLimitKey = `ratelimit:${client.id}:${Math.floor(now / 60000)}`;
    try {
      const currentReqs = await redis.incr(rateLimitKey);
      if (currentReqs === 1) {
        await redis.expire(rateLimitKey, 60);
      }
      if (currentReqs > 1000) {
        return reply
          .status(429)
          .header('Retry-After', '60')
          .send({ error: 'Too Many Requests', message: 'Rate limit exceeded' });
      }
    } catch (err) {
      request.log.error(err, 'Redis rate limit error');
      // Fallback: não bloqueia caso o Redis falhe temporariamente
    }

    // 3. Validar campos obrigatórios
    const { event_name, event_id, email, phone, fbp, fbc, custom_data } = request.body;
    if (!event_name || !event_id) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'event_name and event_id are required fields',
      });
    }

    // 4. Resolver Cookies First-Party _fbp e _fbc
    let finalFbp = fbp || request.cookies._fbp;
    if (!finalFbp) {
      finalFbp = generateFbp();
    }

    // Tentar obter fbc do body, senão do cookie, senão da URL (fbclid)
    let finalFbc = fbc || request.cookies._fbc;
    const urlQuery = request.query as Record<string, string>;
    const fbclid = urlQuery.fbclid || urlQuery.FBCLID;
    if (!finalFbc && fbclid) {
      finalFbc = generateFbc(fbclid);
    }

    // Definir cookies HTTP na resposta
    reply.setCookie('_fbp', finalFbp, {
      path: '/',
      domain: `.${host.split(':')[0]}`, // garante cookie first-party no nível do domínio principal
      maxAge: 7776000, // 90 dias
      sameSite: 'lax',
      secure: true,
      httpOnly: false, // JavaScript do Pixel também precisa ler
    });

    if (finalFbc) {
      reply.setCookie('_fbc', finalFbc, {
        path: '/',
        domain: `.${host.split(':')[0]}`,
        maxAge: 7776000,
        sameSite: 'lax',
        secure: true,
        httpOnly: false,
      });
    }

    // 5. Preparar payload higienizado para a fila Redis
    const payload = {
      client_id: client.id,
      pixel_id: client.pixel_id,
      event_name,
      event_id,
      email: hashSHA256(email),
      phone: hashPhone(phone),
      fbp: finalFbp,
      fbc: finalFbc || null,
      custom_data: custom_data || {},
      ip: request.ip,
      user_agent: request.headers['user-agent'] || '',
      event_time: Math.floor(now / 1000),
    };

    // Empilhar na fila específica de fila do Redis
    try {
      await redis.lpush('queue:events', JSON.stringify(payload));
    } catch (err) {
      request.log.error(err, 'Redis enqueue error');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to queue event' });
    }

    // Resposta de sucesso rápida (tempo de resposta < 20ms)
    return reply.status(200).send({ success: true, event_id });
  });
}
