import { createHash, timingSafeEqual } from 'node:crypto';

// Digesturi de lungime fixa: timingSafeEqual compara toti cei 32 de octeti,
// inclusiv cand parolele au lungimi diferite. Nu jurnalizam intrarea sau secretul.
export function verificaSecretHr(req, secret) {
  if (typeof secret !== 'string' || !secret.trim()) return 503;
  const primit = req.headers.get('x-hr-secret') || '';
  const digest = (text) => createHash('sha256').update(text, 'utf8').digest();
  return timingSafeEqual(digest(primit), digest(secret)) ? null : 401;
}
