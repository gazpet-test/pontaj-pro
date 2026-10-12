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

// ── v10 (12.10.2026): scan in bucati — o invocare = un lot, progresul in normative_scan_rulari ──

// Numarul de loturi pentru n acte.
export function nrLoturi(n, marime) {
  if (!(marime > 0)) throw new Error('marime invalida');
  return Math.ceil(Math.max(0, n | 0) / marime);
}

// ID-urile actelor din lotul k (0-based), in ordinea fixata la pornirea rularii.
export function idsLot(acteIds, k, marime) {
  return (acteIds || []).slice(k * marime, (k + 1) * marime).map(Number);
}

// Pastreaza ordinea din rulare chiar daca baza le intoarce altfel; randurile disparute se sar.
export function ordoneazaDupaIds(randuri, ids) {
  const m = new Map((randuri || []).map((r) => [Number(r.id), r]));
  return ids.map((id) => m.get(Number(id))).filter(Boolean);
}

// Verdictele salvate in rulare nu poarta randul intreg (note etc.) — doar ce trebuie in mail.
export function faraRand(verdicte) {
  return (verdicte || []).map((v) => ({
    id: v.id, identificator: v.identificator, verdict: v.verdict, tip: v.tip ?? null, data_act: v.data_act ?? null, detalii: v.detalii ?? '',
  }));
}

// Lot sarit dupa prea multe incercari (invocari omorate la rand): toate actele → necunoscut.
export function lotSarit(lot, motiv) {
  return faraRand(leagaLot([], lot, null).map((v) => ({ ...v, detalii: motiv })));
}

// Ce face o invocare cu rularea: 'lot' (mai sunt loturi), 'final' (toate loturile gata,
// mailul inca netrimis) sau 'nimic'.
export function urmatorulPas(r) {
  if (!r || r.stare !== 'in_curs') return 'nimic';
  if (r.lot_curent < r.nr_loturi) return 'lot';
  return r.mail_la ? 'nimic' : 'final';
}

// Nota de azi exista deja pe rand → nu o mai adaugam (a doua garda, dupa cea din baza).
export function areNotaScan(note, azi) {
  return String(note || '').includes(`SCAN ${azi}`);
}

export function linieNota(v, azi) {
  return v.verdict === 'schimbare_noua'
    ? `⚠ SCAN ${azi}: ${v.tip || 'schimbare'}${v.data_act ? ' din ' + v.data_act : ''} — ${String(v.detalii || '').slice(0, 300)} (de validat pe M. Oficial)`
    : `ℹ SCAN ${azi}: forma cunoscută incompletă${v.data_act ? ' (act din ' + v.data_act + ')' : ''} — ${String(v.detalii || '').slice(0, 300)}`;
}

// Cost aproximativ: Opus 5 $5/$25 per MTok + $10 / 1000 cautari
export function costAprox(tokIn, tokOut, cautari) {
  return (tokIn || 0) * 5e-6 + (tokOut || 0) * 25e-6 + (cautari || 0) * 0.01;
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Subiect + HTML pentru mailul final, din randul rularii (verdicte acumulate pe toate loturile).
export function construiesteMail(r, notate) {
  const g = grupeaza(r.verdicte || []);
  const erori = r.erori || [];
  const nActe = (r.acte_ids || []).length;
  const nSemn = g.schimbare_noua.length;
  const cost = costAprox(r.tok_in, r.tok_out, r.cautari);
  const culoare = { schimbare_noua: '#a32a21', forma_incompleta: '#b5651d', necunoscut: '#8a6d1a', neschimbat: '#17703c' };
  const tabel = (titlu, rows) => !rows.length ? '' :
    `<h3 style="margin:16px 0 6px;color:${culoare[rows[0].verdict]}">${esc(titlu)} (${rows.length})</h3>` +
    `<table style="border-collapse:collapse;font-size:13px">` + rows.map((v) =>
      `<tr><td style="padding:3px 10px 3px 0"><b>${esc(v.identificator)}</b></td>` +
      `<td style="padding:3px 10px 3px 0">${esc([v.tip, v.data_act].filter(Boolean).join(' · '))}</td>` +
      `<td style="padding:3px 0">${esc(v.detalii)}</td></tr>`).join('') + `</table>`;
  const subiect = `${r.test ? '[TEST] ' : ''}📜 Normative — ${nSemn ? nSemn + ' schimbări noi de verificat' : erori.length ? 'scan cu erori' : 'nicio schimbare nouă'} (${nActe} acte)`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a232c;max-width:760px">` +
    `<h2 style="margin:0 0 4px">Scan lunar normative — Ofertare</h2>` +
    `<p style="margin:0 0 6px;color:#5a6975">${esc(r.azi)} · ${nActe} acte · ${r.nr_loturi} loturi · rularea #${esc(r.id)} · referință: ${esc(r.ref_scan || 'fără scan anterior')} · ` +
    `schimbări noi: ${nSemn} · forme incomplete: ${g.forma_incompleta.length} · necunoscut: ${g.necunoscut.length} · neschimbat: ${g.neschimbat.length}` +
    `${r.test ? ' · TEST: nimic scris în bibliotecă' : ' · note scrise: ' + (notate ?? '?')}</p>` +
    `<p style="margin:0 0 10px;color:#5a6975;font-size:12px">${r.cautari || 0} căutări web · ~$${cost.toFixed(2)}. Scanul doar semnalează — validează pe M. Oficial înainte de a schimba citările.</p>` +
    (nSemn ? tabel('🔴 Schimbări noi (după ultimul scan)', g.schimbare_noua) : `<p style="color:#17703c"><b>Nicio schimbare nouă după ${esc(r.ref_scan || 'ultima verificare')}.</b></p>`) +
    tabel('🟠 Forma cunoscută incompletă (goluri vechi, nu noutăți)', g.forma_incompleta) +
    tabel('🟡 Necunoscut', g.necunoscut) +
    tabel('🟢 Neschimbat', g.neschimbat) +
    (erori.length ? `<p style="color:#a32a21">Erori AI: ${esc(erori.join(' | '))}</p>` : '') +
    `<p style="margin:14px 0 0"><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Ofertare → Referințe → Normative</a></p>` +
    `<p style="color:#c0392b;font-size:12px;margin-top:16px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat.</p></div>`;
  return { subiect, html, nSemn };
}
