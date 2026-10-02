// Logica pura pentru normative-scan-lunar (fara Deno/Supabase) — testata cu vitest.
// Fisier .js ca sa fie importabil si din Deno (index.ts), si din vitest.

export const VERDICTE = ['neschimbat', 'schimbare_noua', 'forma_incompleta', 'necunoscut'];

// Data ultimului scan = cea mai recenta data „SCAN yyyy-mm-dd” din notele randurilor.
export function ultimulScan(norme) {
  let max = null;
  for (const n of norme || []) {
    for (const m of String(n.note || '').matchAll(/SCAN (\d{4}-\d{2}-\d{2})/g)) if (!max || m[1] > max) max = m[1];
  }
  return max;
}

// Inventarul trimis modelului: id-ul randului e cheia, nu identificatorul text.
export function inventarLot(lot) {
  return lot.map((n) =>
    `- id=${n.id} | ${n.identificator || (n.tip + ' ' + n.numar)}: ${n.titlu}` +
    (n.modificari_ulterioare ? ` [forma cunoscută: ${n.modificari_ulterioare}]` : '') +
    (n.stare !== 'în vigoare' ? ` [stare curentă: ${n.stare}]` : '')).join('\n');
}

// Extrage array-ul JSON din textul modelului (poate avea text in jur).
export function extrageJSON(brut) {
  const m = String(brut || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { const a = JSON.parse(m[0]); return Array.isArray(a) ? a : null; } catch { return null; }
}

const normId = (v) => String(v ?? '').replace(/^id\s*=\s*/i, '').trim();

// Normalizeaza un verdict si il leaga de randul din lot DUPA ID.
// Reguli: valoare necunoscuta → 'necunoscut'; schimbare_noua cu data_act <= ultimul
// scan → retrogradata la forma_incompleta (golul era vechi, nu e noutate).
export function clasifica(v, lot, refScan) {
  const id = normId(v?.id);
  const rand = (lot || []).find((n) => String(n.id) === id);
  if (!rand) return null;
  let verdict = VERDICTE.includes(v.verdict) ? v.verdict : 'necunoscut';
  const dataAct = /^\d{4}-\d{2}-\d{2}$/.test(String(v.data_act || '')) ? v.data_act : null;
  if (verdict === 'schimbare_noua' && refScan && dataAct && dataAct <= refScan) verdict = 'forma_incompleta';
  return {
    id: rand.id,
    identificator: rand.identificator || `${rand.tip} ${rand.numar}`,
    verdict,
    tip: ['modificat', 'abrogat', 'inlocuit'].includes(v.tip) ? v.tip : null,
    data_act: dataAct,
    detalii: String(v.detalii || '').slice(0, 400),
    rand,
  };
}

// Leaga verdictele unui lot; randurile fara verdict primesc 'necunoscut' (nu dispar
// din raport); dublurile pe acelasi id se ignora; id-uri straine lotului se ignora.
export function leagaLot(brute, lot, refScan) {
  const out = new Map();
  for (const v of brute || []) {
    const c = clasifica(v, lot, refScan);
    if (c && !out.has(c.id)) out.set(c.id, c);
  }
  for (const n of lot) if (!out.has(n.id)) {
    out.set(n.id, { id: n.id, identificator: n.identificator || `${n.tip} ${n.numar}`, verdict: 'necunoscut', tip: null, data_act: null, detalii: 'fără verdict de la model', rand: n });
  }
  return [...out.values()];
}

// Grupe pentru mail: semnalele (schimbari noi) primele, separat.
export function grupeaza(verdicte) {
  const g = { schimbare_noua: [], forma_incompleta: [], necunoscut: [], neschimbat: [] };
  for (const v of verdicte) (g[v.verdict] || g.necunoscut).push(v);
  return g;
}

// Comparare in timp constant (bucla pe lungimea secretului). Secret gol/lipsa → false.
export function egalConstant(primit, secret) {
  if (typeof primit !== 'string' || typeof secret !== 'string' || !secret) return false;
  const enc = new TextEncoder();
  const a = enc.encode(primit), b = enc.encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
