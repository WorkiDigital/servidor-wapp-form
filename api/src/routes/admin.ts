import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../lib/db';
import { encrypt } from '../lib/crypto';

interface ClientBody {
  workspace_id?: string;
  source_id?: string;
  source_type?: string;
  source_slug?: string;
  tracking_domain?: string;
  subdomain?: string;
  external_ref?: string;
  pixel_id?: string;
  access_token?: string;
  test_event_code?: string;
  status?: 'active' | 'paused';
  dns_status?: string;
  ssl_status?: string;
  last_error?: string | null;
  metadata?: Record<string, any>;
}

const PUBLIC_HOST = process.env.TRACK_SERVER_PUBLIC_HOST || 'track.seudominio.com';

function normalizeHostname(value?: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function normalizeSubdomain(value?: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function isAdminAuthorized(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  const adminPassword = process.env.TRACK_SERVER_ADMIN_SECRET || process.env.ADMIN_PASSWORD || 'admin_secure_pass';
  const adminUser = process.env.ADMIN_USER || 'admin';

  const directSecret = request.headers['x-admin-secret'];
  if (directSecret === adminPassword) return true;

  if (!authHeader) return false;

  const [type, token] = authHeader.split(' ');
  if (type?.toLowerCase() === 'bearer' && token === adminPassword) return true;

  if (type?.toLowerCase() === 'basic' && token) {
    const credentials = Buffer.from(token, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    return username === adminUser && password === adminPassword;
  }

  return false;
}

function buildDnsInstruction(client: { subdomain?: string; tracking_domain?: string }) {
  const host = client.tracking_domain || (client.subdomain ? `${client.subdomain}.${PUBLIC_HOST}` : PUBLIC_HOST);

  return {
    type: 'CNAME',
    host,
    points_to: PUBLIC_HOST,
    status: 'pending_dns',
  };
}

async function findExistingClient(body: ClientBody) {
  const trackingDomain = normalizeHostname(body.tracking_domain);
  const sourceId = body.source_id?.trim();
  const externalRef = body.external_ref?.trim();
  const workspaceId = body.workspace_id?.trim();
  const subdomain = normalizeSubdomain(body.subdomain || body.source_slug);

  if (sourceId) {
    const res = await query('SELECT id FROM clients WHERE source_id = $1 LIMIT 1', [sourceId]);
    if (res.rows[0]) return res.rows[0].id as string;
  }

  if (trackingDomain) {
    const res = await query('SELECT id FROM clients WHERE tracking_domain = $1 LIMIT 1', [trackingDomain]);
    if (res.rows[0]) return res.rows[0].id as string;
  }

  if (workspaceId && externalRef) {
    const res = await query('SELECT id FROM clients WHERE workspace_id = $1 AND external_ref = $2 LIMIT 1', [workspaceId, externalRef]);
    if (res.rows[0]) return res.rows[0].id as string;
  }

  if (subdomain) {
    const res = await query('SELECT id FROM clients WHERE subdomain = $1 LIMIT 1', [subdomain]);
    if (res.rows[0]) return res.rows[0].id as string;
  }

  return null;
}

export default async function adminRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/admin/')) return;

    if (!isAdminAuthorized(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Invalid administrative credentials' });
    }
  });

  fastify.post('/admin/clients', async (request: FastifyRequest<{ Body: ClientBody }>, reply: FastifyReply) => {
    const body = request.body || {};
    const trackingDomain = normalizeHostname(body.tracking_domain);
    const subdomain = normalizeSubdomain(body.subdomain || body.source_slug || trackingDomain.split('.')[0]);

    if (!body.pixel_id || !body.access_token) {
      return reply.status(400).send({ error: 'Bad Request', message: 'pixel_id and access_token are required fields' });
    }

    if (!trackingDomain && !subdomain && !body.source_id) {
      return reply.status(400).send({ error: 'Bad Request', message: 'tracking_domain, subdomain, or source_id is required' });
    }

    try {
      const encryptedToken = encrypt(body.access_token);
      const existingId = await findExistingClient(body);
      const metadata = JSON.stringify(body.metadata || {});

      const values = [
        body.workspace_id || null,
        body.source_id || null,
        body.source_type || 'custom',
        body.source_slug || null,
        trackingDomain || null,
        subdomain || null,
        body.external_ref || null,
        body.pixel_id,
        encryptedToken,
        body.test_event_code || null,
        body.status || 'active',
        body.dns_status || 'pending',
        body.ssl_status || 'pending',
        metadata,
      ];

      if (existingId) {
        const res = await query(
          `UPDATE clients
           SET workspace_id = $1,
               source_id = $2,
               source_type = $3,
               source_slug = $4,
               tracking_domain = $5,
               subdomain = $6,
               external_ref = $7,
               pixel_id = $8,
               access_token = $9,
               test_event_code = $10,
               status = $11,
               dns_status = $12,
               ssl_status = $13,
               last_error = NULL,
               metadata = $14
           WHERE id = $15
           RETURNING id, workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain, external_ref, pixel_id, test_event_code, status, dns_status, ssl_status, created_at, updated_at`,
          [...values, existingId]
        );

        const client = res.rows[0];
        return reply.status(200).send({ success: true, message: 'Client updated successfully', client, dns_instruction: buildDnsInstruction(client) });
      }

      const res = await query(
        `INSERT INTO clients (
          workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain, external_ref,
          pixel_id, access_token, test_event_code, status, dns_status, ssl_status, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id, workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain, external_ref, pixel_id, test_event_code, status, dns_status, ssl_status, created_at, updated_at`,
        values
      );

      const client = res.rows[0];
      return reply.status(201).send({ success: true, message: 'Client onboarded successfully', client, dns_instruction: buildDnsInstruction(client) });
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Conflict', message: 'Client identifier already registered' });
      }
      fastify.log.error(err, 'Error onboarding client');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to onboard client' });
    }
  });

  fastify.patch('/admin/clients/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<ClientBody> }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = request.body || {};

    try {
      const updates: string[] = [];
      const values: any[] = [];
      let index = 1;

      const addUpdate = (column: string, value: any) => {
        updates.push(`${column} = $${index++}`);
        values.push(value);
      };

      if (body.workspace_id !== undefined) addUpdate('workspace_id', body.workspace_id);
      if (body.source_id !== undefined) addUpdate('source_id', body.source_id);
      if (body.source_type !== undefined) addUpdate('source_type', body.source_type);
      if (body.source_slug !== undefined) addUpdate('source_slug', body.source_slug);
      if (body.tracking_domain !== undefined) addUpdate('tracking_domain', normalizeHostname(body.tracking_domain));
      if (body.subdomain !== undefined) addUpdate('subdomain', normalizeSubdomain(body.subdomain));
      if (body.external_ref !== undefined) addUpdate('external_ref', body.external_ref);
      if (body.pixel_id !== undefined) addUpdate('pixel_id', body.pixel_id);
      if (body.access_token !== undefined) addUpdate('access_token', encrypt(body.access_token));
      if (body.test_event_code !== undefined) addUpdate('test_event_code', body.test_event_code);
      if (body.status !== undefined) addUpdate('status', body.status);
      if (body.dns_status !== undefined) addUpdate('dns_status', body.dns_status);
      if (body.ssl_status !== undefined) addUpdate('ssl_status', body.ssl_status);
      if (body.last_error !== undefined) addUpdate('last_error', body.last_error);
      if (body.metadata !== undefined) addUpdate('metadata', JSON.stringify(body.metadata || {}));

      if (updates.length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'No fields provided for update' });
      }

      values.push(id);
      const res = await query(
        `UPDATE clients
         SET ${updates.join(', ')}
         WHERE id = $${index}
         RETURNING id, workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain, external_ref, pixel_id, test_event_code, status, dns_status, ssl_status, updated_at`,
        values
      );

      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Client not found' });
      }

      return reply.status(200).send({ success: true, message: 'Client updated successfully', client: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Error updating client');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update client' });
    }
  });

  fastify.get('/admin/clients', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const res = await query(`
        SELECT 
          c.id, c.workspace_id, c.source_id, c.source_type, c.source_slug, c.tracking_domain,
          c.subdomain, c.external_ref, c.pixel_id, c.test_event_code, c.status, c.dns_status,
          c.ssl_status, c.created_at, c.updated_at, COUNT(e.id) as total_events_sent
        FROM clients c
        LEFT JOIN events_log e ON e.client_id = c.id AND e.sent_to_meta = true
        GROUP BY c.id
        ORDER BY c.created_at DESC
      `);

      return reply.status(200).send({
        clients: res.rows.map((row: any) => ({ ...row, total_events_sent: parseInt(row.total_events_sent, 10) })),
      });
    } catch (err) {
      fastify.log.error(err, 'Error listing clients');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list clients' });
    }
  });

  fastify.get('/admin/clients/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const res = await query(
        `SELECT id, workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain,
                external_ref, pixel_id, test_event_code, status, dns_status, ssl_status, metadata,
                created_at, updated_at
         FROM clients WHERE id = $1 LIMIT 1`,
        [request.params.id]
      );

      if (!res.rows[0]) {
        return reply.status(404).send({ error: 'Not Found', message: 'Client not found' });
      }

      return reply.status(200).send({ client: res.rows[0] });
    } catch (err) {
      fastify.log.error(err, 'Error getting client');
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to get client' });
    }
  });
}
