import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../lib/db';
import { encrypt } from '../lib/crypto';

interface ClientBody {
  subdomain: string;
  pixel_id: string;
  access_token: string;
  status?: 'active' | 'paused';
}

export default async function adminRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {

  // Hook global de verificação de autenticação administrativa
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization'];
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin_secure_pass';
    const adminUser = process.env.ADMIN_USER || 'admin';

    if (!authHeader) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing Authorization header' });
    }

    // Suporte para Basic Auth (admin:password)
    const [type, token] = authHeader.split(' ');
    if (type.toLowerCase() === 'basic') {
      const credentials = Buffer.from(token, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      if (username === adminUser && password === adminPassword) {
        return; // Autenticado com sucesso
      }
    }

    // Suporte para Token customizado no Bearer ou X-Admin-Secret
    const directSecret = request.headers['x-admin-secret'];
    if (directSecret === adminPassword) {
      return;
    }

    return reply.status(403).send({ error: 'Forbidden', message: 'Invalid administrative credentials' });
  });

  // POST /admin/clients - Criar/Onboardar novo cliente
  fastify.post('/admin/clients', async (request: FastifyRequest<{ Body: ClientBody }>, reply: FastifyReply) => {
    const { subdomain, pixel_id, access_token, status } = request.body;

    if (!subdomain || !pixel_id || !access_token) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'subdomain, pixel_id, and access_token are required fields',
      });
    }

    // Validar formato do subdomínio (somente letras, números e hífens)
    const subdomainRegex = /^[a-z0-9](-?[a-z0-9])*$/i;
    if (!subdomainRegex.test(subdomain)) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid subdomain format. Use letters, numbers, and dashes only.',
      });
    }

    try {
      // 1. Encriptar o token da Meta API com AES-256-GCM
      const encryptedToken = encrypt(access_token);

      // 2. Inserir no banco
      const res = await query(
        `INSERT INTO clients (subdomain, pixel_id, access_token, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, subdomain, pixel_id, status, created_at`,
        [subdomain.toLowerCase(), pixel_id, encryptedToken, status || 'active']
      );

      const client = res.rows[0];

      // 3. Gerar instruções DNS CNAME
      const dnsTarget = 'track.seusaas.com'; // O endereço principal do seu SaaS
      const dnsInstruction = {
        type: 'CNAME',
        host: `${client.subdomain}.track.seusaas.com`,
        points_to: dnsTarget,
        status: 'pending_dns_propagation',
      };

      return reply.status(201).send({
        message: 'Client onboarded successfully',
        client,
        dns_instruction: dnsInstruction,
      });
    } catch (err: any) {
      if (err.code === '23505') { // erro de restrição UNIQUE no Postgres
        return reply.status(409).send({ error: 'Conflict', message: 'Subdomain already registered' });
      }
      fastify.log.error(err, 'Error onboarding client');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to onboard client' });
    }
  });

  // PATCH /admin/clients/:id - Atualizar/Rotacionar Token ou Pixel
  fastify.patch('/admin/clients/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<ClientBody> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { pixel_id, access_token, status } = request.body;

    if (!pixel_id && !access_token && !status) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'At least one field (pixel_id, access_token, status) must be provided for update',
      });
    }

    try {
      const updates: string[] = [];
      const values: any[] = [];
      let valCounter = 1;

      if (pixel_id) {
        updates.push(`pixel_id = $${valCounter++}`);
        values.push(pixel_id);
      }

      if (access_token) {
        // Encriptar o novo token
        const encrypted = encrypt(access_token);
        updates.push(`access_token = $${valCounter++}`);
        values.push(encrypted);
      }

      if (status) {
        updates.push(`status = $${valCounter++}`);
        values.push(status);
      }

      values.push(id);
      const queryText = `
        UPDATE clients
        SET ${updates.join(', ')}
        WHERE id = $${valCounter}
        RETURNING id, subdomain, pixel_id, status, updated_at
      `;

      const res = await query(queryText, values);

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Client not found' });
      }

      return reply.status(200).send({
        message: 'Client updated successfully',
        client: res.rows[0],
      });
    } catch (err) {
      fastify.log.error(err, 'Error updating client');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update client' });
    }
  });

  // GET /admin/clients - Listar clientes ativos e contadores
  fastify.get('/admin/clients', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const res = await query(`
        SELECT 
          c.id, 
          c.subdomain, 
          c.pixel_id, 
          c.status, 
          c.created_at,
          COUNT(e.id) as total_events_sent
        FROM clients c
        LEFT JOIN events_log e ON e.client_id = c.id AND e.sent_to_meta = true
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);

      return reply.status(200).send({
        clients: res.rows.map((row: any) => ({
          ...row,
          total_events_sent: parseInt(row.total_events_sent, 10),
        })),
      });
    } catch (err) {
      fastify.log.error(err, 'Error listing clients');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list clients' });
    }
  });
}
