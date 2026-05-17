import crypto from 'crypto';

export interface RawUserData {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  external_id?: string;
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string | null;
}

export interface HashedUserData {
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

function normalizeString(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return normalized || undefined;
}

/**
 * Normaliza e hashea um dado sensível usando SHA-256.
 * Retorna o hash de 64 caracteres hexadecimais se o dado for fornecido.
 */
export function hashSHA256(value: string | undefined | null): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) return undefined;

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function normalizePhone(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;

  let digits = String(phone).replace(/\D/g, '');
  if (!digits) return undefined;

  // Brasil: se vier com DDD sem DDI, prefixa 55.
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }

  if (digits.length < 10) return undefined;
  return digits;
}

/**
 * Sanitiza e hashea um número de telefone.
 */
export function hashPhone(phone: string | undefined | null): string | undefined {
  const normalized = normalizePhone(phone);
  if (!normalized) return undefined;

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function asMetaArray(value?: string): string[] | undefined {
  return value ? [value] : undefined;
}

export function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  ) as Partial<T>;
}

export function normalizeAndHashUserData(userData: RawUserData = {}): HashedUserData {
  const output: HashedUserData = {
    em: asMetaArray(hashSHA256(userData.email)),
    ph: asMetaArray(hashPhone(userData.phone)),
    fn: asMetaArray(hashSHA256(userData.first_name)),
    ln: asMetaArray(hashSHA256(userData.last_name)),
    ct: asMetaArray(hashSHA256(userData.city)),
    st: asMetaArray(hashSHA256(userData.state)),
    country: asMetaArray(hashSHA256(userData.country)),
    zp: asMetaArray(hashSHA256(userData.zip)),
    external_id: asMetaArray(hashSHA256(userData.external_id)),

    client_ip_address: userData.client_ip_address || undefined,
    client_user_agent: userData.client_user_agent || undefined,
    fbp: userData.fbp || undefined,
    fbc: userData.fbc || undefined,
  };

  return cleanObject(output) as HashedUserData;
}
