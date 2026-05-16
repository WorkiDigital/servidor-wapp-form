import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';

import eventRoutes from './routes/event';
import adminRoutes from './routes/admin';

dotenv.config();

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const host = '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          hostname: request.hostname,
          remoteAddress: request.ip,
          userAgent: request.headers['user-agent'],
        };
      },
    },
  },
  trustProxy: true, // Necessário para pegar IP real atrás do proxy reverso do Nginx
});

// Configurar o CORS de maneira ultra-amigável para subdomínios wildcard e CNAMEs first-party
fastify.register(cors, {
  origin: (origin, cb) => {
    // Permite que qualquer origem acesse, mantendo a capacidade de enviar cookies (credentials: true)
    // O browser requer que a origem seja refletida exatamente na resposta quando credentials é true.
    if (!origin) {
      cb(null, true);
      return;
    }
    
    // Permitir todas as conexões CORS (será restrito em nível DNS e Hostname do cliente)
    cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Secret'],
});

// Registrar suporte a Cookies
fastify.register(cookie, {
  secret: process.env.JWT_SECRET || 'fallback_secret_for_cookies_key',
  hook: 'onRequest',
});

// Registrar Rotas da Aplicação
fastify.register(eventRoutes);
fastify.register(adminRoutes);

// Health Check do Container
fastify.get('/health', async (_request, reply) => {
  return reply.status(200).send({ status: 'ok', timestamp: Date.now() });
});

// Tratamento global de erros não capturados
fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);
  if (error.validation) {
    return reply.status(400).send({ error: 'Bad Request', message: error.message });
  }
  return reply.status(500).send({ error: 'Internal Server Error', message: 'Something went wrong inside the server' });
});

// Iniciar servidor
const start = async () => {
  try {
    await fastify.listen({ port, host });
    console.log(`TrackServer API rodando com sucesso em http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
