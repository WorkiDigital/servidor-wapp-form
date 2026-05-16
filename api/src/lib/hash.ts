import crypto from 'crypto';

/**
 * Normaliza e hashea um dado sensível (PII) usando SHA-256.
 * Retorna o hash de 64 caracteres hexadecimais se o dado for fornecido, senão undefined.
 */
export function hashSHA256(value: string | undefined): string | undefined {
  if (!value) return undefined;
  
  // Limpar e sanitizar string
  const sanitized = value.trim().toLowerCase();
  
  return crypto.createHash('sha256').update(sanitized).digest('hex');
}

/**
 * Sanitiza e hashea um número de telefone no padrão E.164.
 * Deve possuir apenas números incluindo código do país (ex: 5511999999999).
 */
export function hashPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;

  // Manter apenas dígitos
  const digits = phone.replace(/\D/g, '');

  if (digits.length < 10) return undefined; // telefone inválido

  return crypto.createHash('sha256').update(digits).digest('hex');
}
