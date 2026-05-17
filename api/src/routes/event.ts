import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../lib/db';
import redis from '../lib/redis';
import { RawUserData, cleanObject, normalizeAndHashUserData } from '../lib/hash';

interface ClientRecord {
  id: string;
  workspace_id?: string | null;
  source_id?: string | null;
  source_type?: string | null;
  source_slug?: string | null;
  tracking_domain?: string | null;
  subdomain?: string | null;
  external_ref?: string | null;
  pixel_id: string;
  test_event_code?: string | null;
  status: string;
}

interface BrowserEventBody {
  workspace_id?: string;
  source_id?: string;
  source_type?: string;
  source_slug?: string;
  tracking_domain?: string;
  external_ref?: string;
  event_name: string;
  event_id: string;
  event_source_url?: string;
  action_source?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string | null;
  custom_data?: Record<string, any>;
  metadata?: Record<string, any>;
}

interface ServerEventBody {
  workspace_id?: string;
  source_id?: string;
  source_type?: string;
  source_slug?: string;
  tracking_domain?: string;
  external_ref?: string;
  event_name: string;
  event_id: string;
  event_source_url?: string;
  action_source?: string;
  conversion_id?: string;
  contact_id?: string;
  schedule_id?: string;
  user_data?: RawUserData;
  custom_data?: Record<string, any>;
  metadata?: Record<string, any>;
}

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

function extractHost(request: FastifyRequest) {
  return normalizeHostname(request.headers.host as string | undefined);
}

function resolvePublicHostSubdomain(host: string) {
  const publicHost = normalizeHostname(process.env.TRACK_SERVER_PUBLIC_HOST || 'track.seudominio.com');
  if (host.endsWith(`.${publicHost}`)) {
    return host.slice(0, -1 * (`.${publicHost}`).length);
  }
  return '';
}

function getAdminSecret() {
  return process.env.TRACK_SERVER_ADMIN_SECRET || process.env.ADMIN_PASSWORD || 'admin_secure_pass';
}

function isServerAuthorized(request: FastifyRequest) {
  const secret = getAdminSecret();
  const headerSecret = request.headers['x-admin-secret'];
  if (headerSecret === secret) return true;

  const authorization = request.headers.authorization || '';
  const [type, token] = authorization.split(' ');
  return type?.toLowerCase() === 'bearer' && token === secret;
}

async function resolveClient(input: {
  source_id?: string;
  tracking_domain?: string;
  source_slug?: string;
  subdomain?: string;
  external_ref?: string;
  workspace_id?: string;
  host?: string;
}): Promise<ClientRecord | null> {
  const host = normalizeHostname(input.host);
  const trackingDomain = normalizeHostname(input.tracking_domain || host);
  const hostSubdomain = resolvePublicHostSubdomain(host);
  const sourceSlug = normalizeSubdomain(input.source_slug || input.subdomain || hostSubdomain);

  const clauses: string[] = [];
  const values: string[] = [];

  const addClause = (clause: string, value?: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    values.push(normalized);
    clauses.push(clause.replace('?', `$${values.length}`));
  };

  addClause('source_id = ?', input.source_id);
  addClause('tracking_domain = ?', trackingDomain);
  addClause('source_slug = ?', sourceSlug);
  addClause('subdomain = ?', sourceSlug);

  if (input.workspace_id && input.external_ref) {
    values.push(input.workspace_id.trim(), input.external_ref.trim());
    clauses.push(`(workspace_id = $${values.length - 1} AND external_ref = $${values.length})`);
  }

  if (clauses.length === 0) return null;

  const result = await query(
    `SELECT id, workspace_id, source_id, source_type, source_slug, tracking_domain, subdomain,
            external_ref, pixel_id, test_event_code, status
     FROM clients
     WHERE (${clauses.join(' OR ')})
     ORDER BY CASE WHEN tracking_domain = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    values
  );

  return result.rows[0] || null;
}

function generateFbp(): string {
  return `fb.1.${Date.now()}.${Math.floor(Math.random() * 1000000000)}`;
}

function generateFbc(fbclid: string): string {
  return `fb.1.${Date.now()}.${fbclid}`;
}

function getCookieDomain(host: string) {
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined;

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return `.${host}`;

  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  const secondLevelCountryTlds = new Set(['com.br', 'net.br', 'org.br', 'adv.br', 'med.br']);

  if (secondLevelCountryTlds.has(lastTwo) && parts.length >= 3) {
    return `.${lastThree}`;
  }

  return `.${lastTwo}`;
}

function setTrackingCookies(reply: FastifyReply, host: string, fbp: string, fbc?: string | null) {
  const cookieOptions = {
    path: '/',
    domain: getCookieDomain(host),
    maxAge: 90 * 24 * 60 * 60,
    sameSite: 'lax' as const,
    secure: true,
    httpOnly: false,
  };

  reply.setCookie('_fbp', fbp, cookieOptions);
  if (fbc) reply.setCookie('_fbc', fbc, cookieOptions);
}

function getBrowserUserData(request: FastifyRequest, body: BrowserEventBody, fbp?: string, fbc?: string | null): RawUserData {
  return cleanObject({
    email: body.email,
    phone: body.phone,
    first_name: body.first_name,
    last_name: body.last_name,
    city: body.city,
    state: body.state,
    country: body.country,
    zip: body.zip,
    external_id: body.external_id,
    client_ip_address: request.ip,
    client_user_agent: String(request.headers['user-agent'] || ''),
    fbp,
    fbc,
  }) as RawUserData;
}

async function enqueueEvent(client: ClientRecord, event: {
  event_name: string;
  event_id: string;
  event_source_url?: string;
  action_source?: string;
  user_data: RawUserData;
  custom_data?: Record<string, any>;
  metadata?: Record<string, any>;
}) {
  const now = Date.now();
  const payload = {
    client_id: client.id,
    workspace_id: client.workspace_id || undefined,
    source_id: client.source_id || undefined,
    source_type: client.source_type || 'custom',
    pixel_id: client.pixel_id,
    test_event_code: client.test_event_code || undefined,
    event_name: event.event_name,
    event_id: event.event_id,
    event_time: Math.floor(now / 1000),
    event_source_url: event.event_source_url,
    action_source: event.action_source || 'website',
    user_data: normalizeAndHashUserData(event.user_data),
    custom_data: event.custom_data || {},
    metadata: event.metadata || {},
  };

  await redis.lpush('queue:events', JSON.stringify(payload));
}

function assertEventRequired(body: { event_name?: string; event_id?: string }) {
  return Boolean(body.event_name && body.event_id);
}

export default async function eventRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions) {
  fastify.post('/api/v1/event', async (request: FastifyRequest<{ Body: BrowserEventBody; Querystring: Record<string, string> }>, reply: FastifyReply) => {
    const body = request.body || {} as BrowserEventBody;
    if (!assertEventRequired(body)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'event_name and event_id are required fields' });
    }

    const host = extractHost(request);
    const client = await resolveClient({
      source_id: body.source_id,
      tracking_domain: body.tracking_domain,
      source_slug: body.source_slug,
      external_ref: body.external_ref,
      workspace_id: body.workspace_id,
      host,
    });

    if (!client || client.status !== 'active') {
      return reply.status(404).send({ error: 'Not Found', message: 'Client not found or inactive' });
    }

    const rateLimitKey = `ratelimit:${client.id}:${Math.floor(Date.now() / 60000)}`;
    const currentReqs = await redis.incr(rateLimitKey);
    if (currentReqs === 1) await redis.expire(rateLimitKey, 60);
    if (currentReqs > 1000) {
      return reply.status(429).header('Retry-After', '60').send({ error: 'Too Many Requests', message: 'Rate limit exceeded' });
    }

    let finalFbp = body.fbp || request.cookies._fbp;
    if (!finalFbp) finalFbp = generateFbp();

    let finalFbc = body.fbc || request.cookies._fbc;
    const fbclid = request.query.fbclid || request.query.FBCLID;
    if (!finalFbc && fbclid) finalFbc = generateFbc(fbclid);

    setTrackingCookies(reply, host, finalFbp, finalFbc);

    await enqueueEvent(client, {
      event_name: body.event_name,
      event_id: body.event_id,
      event_source_url: body.event_source_url,
      action_source: body.action_source,
      user_data: getBrowserUserData(request, body, finalFbp, finalFbc),
      custom_data: body.custom_data,
      metadata: body.metadata,
    });

    return reply.status(200).send({ success: true, event_id: body.event_id, fbp: finalFbp, fbc: finalFbc || null });
  });

  fastify.post('/api/v1/server-event', async (request: FastifyRequest<{ Body: ServerEventBody }>, reply: FastifyReply) => {
    if (!isServerAuthorized(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Invalid server credentials' });
    }

    const body = request.body || {} as ServerEventBody;
    if (!assertEventRequired(body)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'event_name and event_id are required fields' });
    }

    const client = await resolveClient({
      source_id: body.source_id,
      tracking_domain: body.tracking_domain,
      source_slug: body.source_slug,
      external_ref: body.external_ref,
      workspace_id: body.workspace_id,
      host: body.tracking_domain,
    });

    if (!client || client.status !== 'active') {
      return reply.status(404).send({ error: 'client_not_found', message: 'Client not found or inactive' });
    }

    await enqueueEvent(client, {
      event_name: body.event_name,
      event_id: body.event_id,
      event_source_url: body.event_source_url,
      action_source: body.action_source,
      user_data: body.user_data || {},
      custom_data: body.custom_data,
      metadata: cleanObject({
        ...(body.metadata || {}),
        conversion_id: body.conversion_id,
        contact_id: body.contact_id,
        schedule_id: body.schedule_id,
      }),
    });

    return reply.status(200).send({ success: true, event_id: body.event_id });
  });

  fastify.get('/snippet.js', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = extractHost(request);
    const client = await resolveClient({ host });

    if (!client || client.status !== 'active') {
      return reply.status(404).type('application/javascript').send('console.warn("TrackServer client not found");');
    }

    const publicConfig = {
      endpoint: `https://${host}/api/v1/event`,
      source_id: client.source_id,
      source_type: client.source_type || 'custom',
      workspace_id: client.workspace_id,
    };

    const script = `
(function(){
  var CONFIG = ${JSON.stringify(publicConfig)};
  var existingConfig = window.TrackServerConfig || {};
  var autoPageView = existingConfig.autoPageView !== false;
  var autoCaptureForm = existingConfig.autoCaptureForm === true;

  function uuid(){
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16);});
  }
  function getCookie(name){
    var value='; '+document.cookie;
    var parts=value.split('; '+name+'=');
    if(parts.length===2) return parts.pop().split(';').shift();
    return null;
  }
  function params(){ return new URLSearchParams(window.location.search); }
  function getSession(){
    var p=params();
    return {
      fbp:getCookie('_fbp'),
      fbc:getCookie('_fbc'),
      fbclid:p.get('fbclid'),
      event_source_url:window.location.href,
      referrer:document.referrer,
      page_title:document.title,
      utm_source:p.get('utm_source'),
      utm_medium:p.get('utm_medium'),
      utm_campaign:p.get('utm_campaign'),
      utm_content:p.get('utm_content'),
      utm_term:p.get('utm_term')
    };
  }
  function track(eventName, customData, userData, options){
    var session=getSession();
    var eventId=(options&&options.event_id)||eventName.toLowerCase().replace(/[^a-z0-9_]/g,'_')+'_'+uuid();
    var payload=Object.assign({}, userData||{}, {
      workspace_id:(options&&options.workspace_id)||existingConfig.workspace_id||CONFIG.workspace_id,
      source_id:(options&&options.source_id)||existingConfig.source_id||CONFIG.source_id,
      source_type:(options&&options.source_type)||existingConfig.source_type||CONFIG.source_type,
      event_name:eventName,
      event_id:eventId,
      event_source_url:session.event_source_url,
      fbp:session.fbp,
      fbc:session.fbc,
      custom_data:customData||{},
      metadata:session
    });

    if (typeof window.fbq === 'function') {
      var standard=['PageView','Lead','Schedule','CompleteRegistration','Contact','Purchase','SubmitApplication'];
      window.fbq(standard.indexOf(eventName)>=0?'track':'trackCustom', eventName, customData||{}, { eventID:eventId });
    }

    fetch(CONFIG.endpoint+(session.fbclid?('?fbclid='+encodeURIComponent(session.fbclid)):''), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),
      credentials:'include',
      keepalive:true
    }).catch(function(err){ console.warn('[TrackServer] event failed', err); });

    return eventId;
  }
  window.TrackServer={ track:track, getSession:getSession, config:CONFIG };
  if(autoPageView){
    var run=function(){ track('PageView', {}, {}, { event_id:'pageview_'+uuid() }); };
    if(document.readyState==='complete'||document.readyState==='interactive') run();
    else document.addEventListener('DOMContentLoaded', run);
  }
  if(autoCaptureForm){ console.warn('[TrackServer] autoCaptureForm is intentionally disabled in this SDK version. Use TrackServer.track manually.'); }
})();`;

    return reply
      .status(200)
      .header('Cache-Control', 'no-store')
      .type('application/javascript')
      .send(script);
  });
}
