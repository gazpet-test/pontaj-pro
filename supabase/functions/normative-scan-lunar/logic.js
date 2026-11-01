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
// v11: „sursa” = 'oficial' (citit direct pe legislatie.just.ro) sau 'ai' (cautare web); „curent” = consolidarea vazuta.
export function faraRand(verdicte) {
  return (verdicte || []).map((v) => ({
    id: v.id, identificator: v.identificator, verdict: v.verdict, tip: v.tip ?? null, data_act: v.data_act ?? null, detalii: v.detalii ?? '',
    sursa: v.sursa === 'oficial' ? 'oficial' : 'ai', curent: v.curent ?? null, nr_consolidari: v.nr_consolidari ?? null,
    // r2: ce a vazut verificarea oficiala (pentru scrierea conditionata a urmei in finalizare)
    doc: v.doc ?? null, baza: v.baza ?? null, vazut_la: v.vazut_la ?? null,
  }));
}

// ── v11 (01.11.2026): verificare pe sursa oficiala (legislatie.just.ro), fara AI ──
// r2 (review Copilot + Jakarinos r1, NO-GO): fara dovada pozitiva NU exista „neschimbat”. Pagina se accepta doar daca
// (1) identitatea actului e dovedita (tip + numar + an din <title> si emitentul din fisa) si (2) blocul „istoric
// consolidari” e gasit si citit COMPLET (fiecare link din bloc e o consolidare cu data calendaristica valida).
// Altfel → null (actul cade pe AI, unde un „neschimbat” nu se mai accepta, vezi plafoneazaAI).

// r3 (Copilot r2 P3-01): id strict intreg pozitiv la frontiera DB → HTTP (gazda e fixa)
export const idOficialValid = (id) => Number.isSafeInteger(Number(id)) && Number(id) > 0 && String(id).trim() === String(Number(id));
export const URL_LEGISLATIE = (id) => `https://legislatie.just.ro/Public/DetaliiDocument/${idOficialValid(id) ? Number(id) : 0}`;

// Data calendaristica valida (31.02 / 00.13 / ani absurzi → null).
export function dataISO(z, l, a) {
  const d = Number(z), m = Number(l), y = Number(a);
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Istoricul consolidarilor DIN BLOCUL <div id="istoric_fa">…</div> (comentariile HTML scoase).
// Intoarce datele ISO unice, descrescator; null = bloc lipsa, gol sau citit incomplet (orice <a> din bloc fara
// data valida) — adica NU exista dovada ca istoricul e complet.
// r4 (Jakarinos r3 P1-1/P1-2): fara regex pe HTML. Tokenizator minimal care separa tagurile, atributele si
// valorile lor citate (un `id=` sau `</div>` scris IN valoarea altui atribut nu mai conteaza), sare comentariile si
// continutul <script>/<style>. Taguri si atribute fara distinctie de majuscule.
// r5 (Jakarinos r4): STRICT. Intoarce { tags, complet }. complet=false la ORICE anomalie, oriunde in pagina:
// comentariu / valoare citata / tag / text brut (script, style, textarea, title) neinchise; nume de tag urmat de
// alt caracter decat spatiu, '>' sau '/'; atribut dublat; atribut sau valoare care incep cu ghilimele. Fara limite
// de lungime (numele si valorile se consuma integral). Consumatorii nu confirma nimic dintr-o pagina incompleta.
const SP = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const TEXT_BRUT = new Set(['script', 'style', 'textarea', 'title']);
export function analizeazaHTML(html) {
  const s = String(html || '');
  // r6 (Jakarinos r5): litere mici DOAR ASCII — pastreaza lungimea (toLowerCase pe Unicode, ex. U+0130 → 2 caractere,
  // ar decala indicii folositi pe sirul original)
  const mic = s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  const n = s.length;
  const tags = [];
  const rupt = () => ({ tags, complet: false });
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); if (e < 0) return rupt(); i = e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt + 2); if (e < 0) return rupt(); i = e + 1; continue; } // <!DOCTYPE>
    let j = lt + 1;
    const inchis = s[j] === '/';
    if (inchis) j++;
    if (!/[A-Za-z]/.test(s[j] || '')) { i = lt + 1; continue; } // „<” in text (ex. a<b) nu e tag
    const k0 = j;
    while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
    const nume = mic.slice(k0, j);
    if (j < n && !SP(s[j]) && s[j] !== '>' && s[j] !== '/') return rupt(); // <div.foo>
    const attrs = new Map();
    let gata = false;
    while (j < n) {
      while (j < n && SP(s[j])) j++;
      if (s[j] === '>') { j++; gata = true; break; }
      if (s[j] === '/' && s[j + 1] === '>') { j += 2; gata = true; break; }
      if (s[j] === '/') { j++; continue; }
      if (s[j] === '"' || s[j] === "'" || s[j] === '=') return rupt();
      const a0 = j;
      while (j < n && !SP(s[j]) && s[j] !== '=' && s[j] !== '>' && s[j] !== '/' && s[j] !== '"' && s[j] !== "'") j++;
      const an = mic.slice(a0, j);
      while (j < n && SP(s[j])) j++;
      let val = '';
      if (s[j] === '=') {
        j++;
        while (j < n && SP(s[j])) j++;
        if (s[j] === '"' || s[j] === "'") {
          const q = s[j];
          const e = s.indexOf(q, j + 1);
          if (e < 0) return rupt();
          val = s.slice(j + 1, e);
          j = e + 1;
        } else {
          const v0 = j;
          while (j < n && !SP(s[j]) && s[j] !== '>') j++;
          val = s.slice(v0, j);
        }
      }
      if (attrs.has(an)) return rupt(); // atribut dublat
      attrs.set(an, val);
    }
    if (!gata) return rupt();
    tags.push({ inchis, nume, attrs, poz: lt, sf: j });
    i = j;
    if (!inchis && TEXT_BRUT.has(nume)) {
      // sfarsitul exact: </nume urmat de spatiu, '/' sau '>' (</scriptX> nu inchide)
      let e = i;
      for (;;) {
        e = mic.indexOf(`</${nume}`, e);
        if (e < 0) return rupt();
        const c = s[e + 2 + nume.length];
        if (c === undefined) return rupt();
        if (SP(c) || c === '>' || c === '/') break;
        e += 2;
      }
      i = e;
    }
  }
  return { tags, complet: true };
}

// Compatibilitate: doar tagurile (fara stare). Consumatorii noi folosesc analizeazaHTML().
export function* taguri(html) { yield* analizeazaHTML(html).tags; }

// Istoricul consolidarilor: elementul <div> cu atributul id EXACT „istoric_fa” (unul singur in pagina), pana la
// </div>-ul lui; orice <div> imbricat sau sfarsitul paginii inainte de </div> = ambiguu → null. In fiecare <a>,
// atributul title real trebuie sa fie „Consolidarea|Republicarea din ZZ.LL.AAAA” cu data valida, altfel null.
// Intoarce datele ISO unice, descrescator; null = fara dovada ca istoricul a fost citit complet.
export function consolidari(html) {
  const { tags: toate, complet } = analizeazaHTML(html);
  if (!complet) return null;
  const idx = toate.map((t, k) => (!t.inchis && t.nume === 'div' && t.attrs.get('id') === 'istoric_fa') ? k : -1).filter((k) => k >= 0);
  if (idx.length !== 1) return null;
  const out = new Set();
  let linkuri = 0;
  for (let k = idx[0] + 1; k < toate.length; k++) {
    const t = toate[k];
    if (t.nume === 'div') {
      if (t.inchis) return linkuri ? [...out].sort().reverse() : null;
      return null; // div imbricat
    }
    if (t.nume === 'a' && !t.inchis) {
      linkuri++;
      // formele din istoric: „Consolidarea din …” si „Republicarea din …” (ex. Legea 307/2006, republicata 17.04.2019)
      const m = /^\s*(?:Consolidarea|Republicarea) din (\d{2})\.(\d{2})\.(\d{4})\s*$/i.exec(t.attrs.get('title') ?? '');
      const iso = m && dataISO(m[1], m[2], m[3]);
      if (!iso) return null;
      out.add(iso);
    }
  }
  return null; // pagina s-a terminat inainte de </div>
}

// Tipul actului din ERP → tipul din titlul paginii + emitentul din fisa (S_EMT_BDY).
const TIPURI = {
  hg: { titlu: /^HG$/, emitent: /GUVERNUL/ },
  oug: { titlu: /^(OUG|ORD DE URGENTA|ORDONANTA DE URGENTA)$/, emitent: /GUVERNUL/ },
  lege: { titlu: /^LEGE$/, emitent: /PARLAMENTUL/ },
  ordin_anre: { titlu: /^ORDIN$/, emitent: /AUTORITATEA NA.IONAL. DE REGLEMENTARE .N DOMENIUL ENERGIEI/ },
  // r3 (Jakarinos r2 P1-2): „ordin” de ministru NU e pe calea oficiala — emitentul din ERP e o abreviere
  // („MDRAP / MDLPA”), nu se poate dovedi exact; actul merge pe AI (plafonat).
};

// Identitatea actului: titlul „HG        395 02/06/2016 - Portal Legislativ” → tip HG, nr. 395, anul 2016 (exact),
// plus emitentul din fisa. Orice nepotrivire sau tip necunoscut → false.
// Textul dintre tagul de deschidere al unui element unic (cautat cu tokenizatorul) si primul lui tag de inchidere.
// r4: element lipsa sau dublat → null (identitatea nu se dovedeste din ceva ambiguu).
function textElementUnic(html, potrivire, numeInchidere) {
  const s = String(html || '');
  const { tags: toate, complet } = analizeazaHTML(s);
  if (!complet) return null;
  const idx = toate.map((t, k) => (!t.inchis && potrivire(t)) ? k : -1).filter((k) => k >= 0);
  if (idx.length !== 1) return null;
  const inc = toate.slice(idx[0] + 1).find((t) => t.inchis && t.nume === numeInchidere);
  if (!inc) return null;
  return s.slice(toate[idx[0]].sf, inc.poz).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
}

export function paginaPotrivita(html, rand) {
  const reg = TIPURI[String(rand?.tip || '')];
  const m = String(rand?.numar || '').match(/^(\d+)\/(\d{4})$/);
  if (!reg || !m) return false;
  const t = textElementUnic(html, (x) => x.nume === 'title', 'title');
  const p = String(t ?? '').trim().toUpperCase().match(/^([A-Z][A-Z ]*?)\s+(\d+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+-\s+PORTAL LEGISLATIV$/);
  if (!p) return false;
  if (!reg.titlu.test(p[1].trim()) || p[2] !== String(Number(m[1])) || p[5] !== m[2]) return false;
  const em = textElementUnic(html, (x) => x.nume === 'span' && x.attrs.get('class') === 'S_EMT_BDY', 'span');
  return em != null && reg.emitent.test(em.toUpperCase());
}

const ro = (iso) => iso ? iso.split('-').reverse().join('.') : '—';

// Verdict determinist, DOAR cu istoric complet (date = array nevid din consolidari(); altfel nu se cheama).
//  - fara baza confirmata → necunoscut (de setat o singura data), indiferent de istoric
//  - consolidare curenta > baza → schimbare_noua (sau forma_incompleta daca era deja publicata la ultimul scan)
//  - egala → neschimbat, confirmat automat; mai veche decat baza → necunoscut (baza gresita?)
export function verdictOficial(rand, date, refScan, vazutLa = null) {
  const b = String(rand?.forma_oficiala_la || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const baza = b ? dataISO(b[3], b[2], b[1]) : null;
  const curent = (date || [])[0] || null;
  const v = {
    id: rand.id, identificator: rand.identificator || `${rand.tip} ${rand.numar}`, tip: null, data_act: null,
    sursa: 'oficial', curent, nr_consolidari: (date || []).length, rand,
    doc: Number(rand.legislatie_doc_id) || null, baza, vazut_la: vazutLa,
  };
  const url = URL_LEGISLATIE(rand.legislatie_doc_id);
  if (!curent) return { ...v, verdict: 'necunoscut', detalii: `istoric de consolidări necitit — ${url}` };
  if (!baza) return { ...v, verdict: 'necunoscut', detalii: `bază nesetată: forma consolidată curentă e din ${ro(curent)} — de confirmat o dată (${url})` };
  if (curent === baza) {
    return { ...v, verdict: 'neschimbat', detalii: `confirmat automat pe legislatie.just.ro: forma curentă din ${ro(curent)} = forma confirmată — ${url}` };
  }
  if (curent < baza) return { ...v, verdict: 'necunoscut', detalii: `forma curentă (${ro(curent)}) e mai veche decât baza confirmată (${ro(baza)}) — de verificat baza (${url})` };
  const noi = (date || []).filter((d) => d > baza);
  const verdict = refScan && curent <= refScan ? 'forma_incompleta' : 'schimbare_noua';
  return {
    ...v, verdict, tip: 'modificat', data_act: curent,
    detalii: `legislatie.just.ro: ${noi.length} consolidare(i) nouă(i) după forma confirmată (${ro(baza)}): ${noi.map(ro).join(', ')} — ${url}`,
  };
}

// Imparte lotul: actele cu id oficial se verifica direct, restul (standarde etc.) merg la AI.
export function imparteLot(lot) {
  const oficial = [], ai = [];
  for (const n of lot || []) (idOficialValid(n?.legislatie_doc_id) ? oficial : ai).push(n);
  return { oficial, ai };
}

// r2 (Jakarinos P1-3): un act CU id oficial ajuns pe AI (portal indisponibil / pagina nedovedita) nu poate iesi
// „neschimbat” din AI — AI-ul nu confirma ce sursa oficiala n-a putut confirma (si nu poate sterge un semnal
// oficial vazut la o incercare anterioara). Semnalele AI raman; „neschimbat” devine „necunoscut”.
export function plafoneazaAI(verdicte, idsCuOficial) {
  const ids = new Set((idsCuOficial || []).map(String));
  return (verdicte || []).map((v) => (ids.has(String(v.id)) && v.verdict === 'neschimbat')
    ? { ...v, verdict: 'necunoscut', detalii: `sursa oficială indisponibilă; AI spune „neschimbat”, neconfirmat — ${String(v.detalii || '').slice(0, 250)}` }
    : v);
}

// r4 (Jakarinos r3): ordinea pe prioritate e explicita (text: ACTUALIZARE ar iesi alfabetic inaintea lui CRITIC).
const RANG = { CRITIC: 0, IMPORTANT: 1, ACTUALIZARE: 2 };
export function ordinePrioritate(norme) {
  return [...(norme || [])].sort((a, b) => ((RANG[a?.prioritate] ?? 9) - (RANG[b?.prioritate] ?? 9)) || (Number(a?.id) - Number(b?.id)));
}

// r2: actele cu id oficial primele in rulare → loturile sunt cat mai „pure” (oficial sau AI), mai putine loturi mixte.
// r3 (Jakarinos r2 P2-3): se aplica DUPA selectia pe prioritate (slice la plafon), nu inainte.
export function ordineRulare(norme) {
  const a = (norme || []).filter((n) => idOficialValid(n?.legislatie_doc_id));
  const b = (norme || []).filter((n) => !idOficialValid(n?.legislatie_doc_id));
  return [...a, ...b];
}

// Lot sarit dupa prea multe incercari (invocari omorate la rand): toate actele → necunoscut.
export function lotSarit(lot, motiv) {
  return faraRand(leagaLot([], lot, null).map((v) => ({ ...v, detalii: motiv })));
}

// Eșec trecător al API-ului AI (se reîncearcă lotul, nu se salvează „necunoscut”): 408/409/429/5xx/529.
// Orice alt 4xx (cerere greșită, cheie invalidă) nu se repară prin reîncercare.
export function esteTranzitoriu(status) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
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
  const nOficial = (r.verdicte || []).filter((v) => v.sursa === 'oficial').length;
  const nAuto = g.neschimbat.filter((v) => v.sursa === 'oficial').length;
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
    `<p style="margin:0 0 10px;color:#5a6975;font-size:12px">${nOficial} acte citite direct pe legislatie.just.ro (${nAuto} confirmate automat, fără AI) · ` +
    `${r.cautari || 0} căutări web pentru restul · ~$${cost.toFixed(2)}. Scanul doar semnalează — validează pe M. Oficial înainte de a schimba citările.</p>` +
    (nSemn ? tabel('🔴 Schimbări noi (după ultimul scan)', g.schimbare_noua) : `<p style="color:#17703c"><b>Nicio schimbare nouă după ${esc(r.ref_scan || 'ultima verificare')}.</b></p>`) +
    tabel('🟠 Forma cunoscută incompletă (goluri vechi, nu noutăți)', g.forma_incompleta) +
    tabel('🟡 Necunoscut', g.necunoscut) +
    tabel('🟢 Neschimbat', g.neschimbat) +
    (erori.length ? `<p style="color:#a32a21">Erori AI: ${esc(erori.join(' | '))}</p>` : '') +
    `<p style="margin:14px 0 0"><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Ofertare → Referințe → Normative</a></p>` +
    `<p style="color:#c0392b;font-size:12px;margin-top:16px"><b>⚠️ Nu răspunde la acest email</b> — e trimis automat.</p></div>`;
  return { subiect, html, nSemn };
}
