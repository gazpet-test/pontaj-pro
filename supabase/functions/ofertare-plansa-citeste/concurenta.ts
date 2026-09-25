// R4 (25.09.2026, audit T4/T11/C3/C4): scrieri concurente, versiuni nemixate, proveniență pe regiune.
// Funcții pure + scrierea compare-and-set — testate în concurenta_test.ts fără rețea.
//
// De ce compare-and-set (CAS) și nu lacăt: o rundă ține ~1–3 minute (4 zone × Opus). Un lacăt cu expirare
// fie blochează al doilea tab tot timpul ăsta (și rămâne agățat dacă funcția moare — worker killed), fie
// expiră prea devreme și nu mai protejează nimic. CAS nu ține nimic ocupat: fiecare scriere spune „scriu doar
// dacă analiza e încă cea pe care am citit-o" (citire_ai.rev). La conflict se recitește, se FUZIONEAZĂ pe zone
// și se reîncearcă — rezultatele deja plătite ale ambelor rulări se păstrează. Costul dublu (două taburi care
// citesc aceeași zonă) nu îl previne CAS-ul; îl previne REZERVAREA pe zonă (mai jos, docs/R4_REZERVARE_ZONE_SI_COADA_NAS.md):
// înainte de apelul AI, zonele lotului se rezervă prin CAS în analiza.rezervari_zone, cu termen de expirare.

export const INCERCARI_CAS = 3;
export const CALE_REV = 'analiza->citire_ai->>rev';
export const CALE_TAIAT = 'analiza->plansa->>taiat_la';
// Jetonul rezervărilor (analiza.rezervari_zone.rev) — schimbat la FIECARE scriere a rezervărilor. Toate scrierile CAS
// de aici filtrează și pe el: altfel o scriere a citirii (care rescrie toată coloana `analiza`) ar șterge pe tăcute o
// rezervare făcută de alt tab între citirea și scrierea ei.
export const CALE_REZ = 'analiza->rezervari_zone->>rev';

// Cheia de compatibilitate: aceeași logică de citire (cod), același model, același prompt.
export function cheieVersiune(v: any): string | null {
  if (!v?.cod || !v?.model || !v?.prompt_sha) return null;
  return `${v.cod}|${v.model}|${v.prompt_sha}`;
}

// R4 (Copilot) pct. 3: câmpurile care definesc CE s-a citit (tăierea, grila, fișierul). Diferențele aici fac zonele
// incomparabile — 409 INDIFERENT de mixare_permisa. mixare_permisa acoperă DOAR model / prompt_sha / cod.
export const CAMPURI_NEMIXABILE = ['taiat_la', 'cale_felii', 'geom_sha', 'fisier', 'fisier_path'] as const;
export function diferenteNemixabile(vSalvata: any, vCurenta: any): string[] {
  return CAMPURI_NEMIXABILE.filter((c) => String(vSalvata?.[c] ?? '') !== String(vCurenta?.[c] ?? ''));
}

// Reluarea ('continua' / 'reia_erori' / de_la>0) pe o citire salvată cu altă versiune ar amesteca zone citite cu
// alt prompt/model într-un singur total. Implicit: refuz. Citire veche fără versiune = necunoscută = incompatibilă.
export function versiuneIncompatibila(caSalvata: any, curenta: any, mixarePermisa = false): string | null {
  if (!caSalvata) return null;
  const dif = diferenteNemixabile(caSalvata.versiune, curenta);
  if (dif.length) return `Citirea salvată e pe altă tăiere/grilă/fișier (${dif.join(', ')} diferă) — zonele nu se amestecă, ` +
    'nici cu mixare_permisa. Pornește „citește” din nou.';
  if (mixarePermisa) return null;
  const a = cheieVersiune(caSalvata.versiune), b = cheieVersiune(curenta);
  if (a === b) return null;
  return `Citirea salvată e făcută cu altă versiune (${a || 'necunoscută'}) decât cea curentă (${b}) — zonele nu se amestecă. ` +
    'Pornește „citește” din nou (sau reia explicit cu mixare_permisa=true).';
}

// Amprenta geometriei zonelor (zone_geom + zone_asteptate) — o retăiere cu altă grilă o schimbă.
export async function shaGeometrie(plansa: any): Promise<string> {
  const j = JSON.stringify({ g: plansa?.zone_geom ?? null, z: plansa?.zone_asteptate ?? null });
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(j)));
  return Array.from(h.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cheieZona = (r: any) => String(r?.eticheta || '').replace(/\.jpg$/, '');

// Fuziune pe cheia zonei: pleacă de la ce e salvat, peste el pun rezultatele noi; un rezultat BUN existent
// nu e înlocuit de o eroare nouă (al doilea tab a căzut pe o zonă pe care primul a citit-o bine).
export function fuzioneazaZone(salvate: any[], noi: any[]): any[] {
  const m = new Map<string, any>();
  for (const r of salvate || []) m.set(cheieZona(r), r);
  for (const r of noi || []) {
    const k = cheieZona(r), prev = m.get(k);
    if (prev && !prev.eroare && r.eroare) continue;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => String(a.eticheta).localeCompare(String(b.eticheta)));
}

// Regiunea zonei în coordonate PDF: puncte (1/72"), origine STÂNGA-JOS ca în PDF (y crește în sus).
// Sursa: plansa.zone_geom[zona] = [left, top, width, height, iSursa] în pixelii sursei tăiate și
// plansa.surse_geom[iSursa] = {pagina, latime, inaltime, dpi, latime_pt, inaltime_pt} (scrise de /api/plansa-felii).
// Fără dimensiunea în pt a paginii (scanare încorporată, tăieri vechi) => regiunea rămâne în pixeli sursă (unitate 'px').
export function regiuneZona(plansa: any, eticheta: string): any | null {
  const zona = String(eticheta || '').replace(/\.jpg$/, '').replace(/^z/, '');
  const g = plansa?.zone_geom?.[zona];
  if (!Array.isArray(g) || g.length < 4) return null;
  const [left, top, width, height, iS = 0] = g.map(Number);
  const s = plansa?.surse_geom?.[iS] || { pagina: 1, latime: plansa?.latime, inaltime: plansa?.inaltime, dpi: plansa?.dpi };
  const H = Number(s.inaltime) || 0;
  let k: number | null = null;
  if (s.latime_pt && s.latime) k = Number(s.latime_pt) / Number(s.latime);
  else if (s.dpi) k = 72 / Number(s.dpi);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  if (!k || !H) return { pagina: s.pagina || 1, unitate: 'px', x0: left, y0: top, x1: left + width, y1: top + height, origine: 'stanga-sus' };
  return { pagina: s.pagina || 1, unitate: 'pt', x0: r2(left * k), y0: r2((H - top - height) * k), x1: r2((left + width) * k), y1: r2((H - top) * k) };
}

export function revNou(): string { return crypto.randomUUID(); }

// Scriere compare-and-set pe ofertare_documente_atribuire.analiza->citire_ai->>rev.
// construieste(doc) -> { upd } (upd.analiza.citire_ai.rev trebuie să fie NOU) sau { stop: {status, error} }.
// La conflict (0 rânduri afectate): recitește documentul și reconstruiește, de maximum INCERCARI_CAS ori.
export async function scrieCAS(supa: any, docId: number, docInitial: any,
  construieste: (doc: any, incercare: number) => Promise<any> | any): Promise<{ ok: boolean; doc?: any; rezultat?: any; stop?: any; incercari: number }> {
  let doc = docInitial;
  for (let i = 0; i < INCERCARI_CAS; i++) {
    const rez = await construieste(doc, i);
    if (rez?.stop) return { ok: false, stop: rez.stop, incercari: i + 1 };
    const revBaza = doc?.analiza?.citire_ai?.rev ?? null;
    let q = supa.from('ofertare_documente_atribuire').update(rez.upd).eq('id', docId);
    q = revBaza == null ? q.is(CALE_REV, null) : q.eq(CALE_REV, String(revBaza));
    // și pe tăiere: la PRIMA tăiere nu există citire_ai (rev null rămâne null după retăiere) — fără filtrul ăsta
    // o rundă în zbor pe tăierea veche ar trece CAS-ul și ar suprascrie analiza.plansa nouă cu cea veche.
    const taiatBaza = doc?.analiza?.plansa?.taiat_la ?? null;
    q = taiatBaza == null ? q.is(CALE_TAIAT, null) : q.eq(CALE_TAIAT, String(taiatBaza));
    const rezBaza = doc?.analiza?.rezervari_zone?.rev ?? null;
    q = rezBaza == null ? q.is(CALE_REZ, null) : q.eq(CALE_REZ, String(rezBaza));
    const { data, error } = await q.select('id');
    if (error) return { ok: false, stop: { status: 500, error: error.message }, incercari: i + 1 };
    if ((data || []).length === 1) return { ok: true, doc, rezultat: rez, incercari: i + 1 };
    const { data: proaspat } = await supa.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, nume_original, analiza, eroare').eq('id', docId).maybeSingle();
    if (!proaspat) return { ok: false, stop: { status: 404, error: 'document inexistent' }, incercari: i + 1 };
    doc = proaspat;
  }
  return { ok: false, stop: { status: 409, error: `Citirea planșei e scrisă simultan din altă parte — ${INCERCARI_CAS} încercări fără succes. Reîncearcă.` }, incercari: INCERCARI_CAS };
}

// R4 (Copilot) pct. 4: transferul în ofertare_cantitati e SERIALIZAT printr-un „lease” pe citire_ai.transfer =
// {stare:'in_curs', de_la, rulare} obținut prin CAS. Doar deținătorul transferă; ceilalți sar.
// Refuz (null = se poate lua): in_curs recent al ALTEI rulări, sau făcut de altă rulare după ce a pornit rularea curentă
// (transfer concurent deja încheiat pe aceeași citire).
export function leaseTransferOcupat(tr: any, rulare: string, pornitMs: number, acumMs = Date.now()): string | null {
  if (!tr || tr.rulare === rulare) return null;
  const t = Date.parse(tr.de_la);
  if (tr.stare === 'in_curs' && Number.isFinite(t) && acumMs - t <= TRANSFER_EXPIRA_MS) return 'transfer în curs de altă rulare';
  if (tr.stare === 'facut' && Number.isFinite(t) && t >= pornitMs) return 'transfer făcut deja de o rulare concurentă';
  return null;
}

// R4 risc 1: transferul în ofertare_cantitati marcat pe citire_ai.sumar.cantitati. Nu se blochează definitiv:
// {eroare} (a căzut) sau {in_curs} mai vechi de 5 min (funcția a murit între marcaj și rezultat) => se reia.
export const TRANSFER_EXPIRA_MS = 5 * 60 * 1000;
export function transferDeReluat(c: any, acumMs = Date.now()): boolean {
  if (!c || c.amanat || c.eroare) return true;
  if (c.in_curs) {
    const t = Date.parse(c.la);
    return !Number.isFinite(t) || acumMs - t > TRANSFER_EXPIRA_MS;
  }
  return false;
}

// ---- R4 (Copilot, runda 3): REZERVARE per (document, zonă, tăiere) înainte de apelul AI --------------------------
// Problema rămasă după CAS: două taburi care pornesc „continuă” / „reia zonele căzute” (sau un „citește” în curs +
// un „continuă”) calculau ACELAȘI lot de zone și plăteau de două ori (CAS-ul păstra rezultatul o singură dată).
// Acum lotul se rezervă ÎNAINTE de AI, prin CAS, în analiza.rezervari_zone = {rev, zone: {cheie: {rulare, taiat_la,
// de_la, pana_la}}} (cheie = eticheta zonei „z1_5”, sau „lipire:z1_1+z1_2” pentru perechile de note). Fără schemă nouă.
//  - rezervarea altei rulări, pe ACEEAȘI tăiere (taiat_la) și neexpirată => zona nu intră în lot (zero AI pe ea);
//  - dacă TOATE zonele candidate sunt rezervate de alții => 409 „în lucru în alt tab”, zero AI, zero scrieri;
//  - rezervarea se eliberează la scrierea rezultatului (sau best-effort la eșec); dacă funcția e omorâtă, expiră
//    singură după REZERVARE_EXPIRA_MS și zona se poate prelua;
//  - rezervările de pe altă tăiere sunt moarte (retăierea schimbă zonele) și se curăță la următoarea scriere.
// Termenul: > durata maximă a unei invocări Edge (limita de ceas: 150 s pe Free, 400 s pe planurile plătite — docs
// Supabase „Edge Functions / Limits”), ca o rulare încă vie să nu-și piardă rezervarea.
export const REZERVARE_EXPIRA_MS = 7 * 60 * 1000;
// Plafon pe pana_la (verificator R4, runda 1): o rezervare e activă DOAR dacă now < pana_la <= now + termen + toleranță.
// Fără plafon, o rezervare coruptă sau scrisă de mână (pana_la = 2099 — politica RLS de update pe `analiza` e a
// modulului Ofertare, nu doar a ownerului) ar bloca pe termen nelimitat citirea (409) și retăierea. Toleranța acoperă
// diferența de ceas între instanțele Edge (cine scrie) și Vercel/Edge (cine verifică). Peste plafon = expirată: se ignoră
// și se curăță la următoarea scriere a rezervărilor. Aceeași regulă în api/_cas.js (rezervariActive) — constante identice.
export const TOLERANTA_CEAS_MS = 60 * 1000;

export const rezActiva = (r: any, taiatLa: string | null, acumMs: number) => {
  if (!r || (r.taiat_la ?? null) !== (taiatLa ?? null)) return false;
  const t = Date.parse(r.pana_la);
  return Number.isFinite(t) && t > acumMs && t <= acumMs + REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS;
};

// Rezervările ACTIVE ale ALTOR rulări pe tăierea curentă: cheie -> rezervare.
export function rezervateDeAltii(rz: any, taiatLa: string | null, rulare: string, acumMs = Date.now()): Map<string, any> {
  const m = new Map<string, any>();
  for (const [k, r] of Object.entries(rz?.zone || {})) if (rezActiva(r, taiatLa, acumMs) && (r as any).rulare !== rulare) m.set(k, r);
  return m;
}

// Obiectul rezervari_zone de scris: păstrează doar rezervările active de pe tăierea curentă, scoate (opțional) pe ale
// unei rulări (eliberare) și adaugă cheile noi. Jeton NOU la fiecare scriere.
export function rezervariNoi(rz: any, taiatLa: string | null, acumMs: number,
  opt: { scoateRulare?: string; adauga?: { chei: string[]; rulare: string; resetare?: boolean } } = {}): { rev: string; zone: Record<string, any> } {
  const zone: Record<string, any> = {};
  for (const [k, r] of Object.entries(rz?.zone || {})) {
    if (!rezActiva(r, taiatLa, acumMs)) continue;
    if (opt.scoateRulare && (r as any).rulare === opt.scoateRulare) continue;
    zone[k] = r;
  }
  // resetare=true: rezervarea unui „citește” de la zero — scrierea lui înlocuiește citirea, deci nicio altă rulare nu
  // cooperează cu el cât timp e activă (vezi rezervaChei / planifica în handler.ts).
  if (opt.adauga) for (const k of opt.adauga.chei) zone[k] = { rulare: opt.adauga.rulare, taiat_la: taiatLa ?? null,
    de_la: new Date(acumMs).toISOString(), pana_la: new Date(acumMs + REZERVARE_EXPIRA_MS).toISOString(),
    ...(opt.adauga.resetare ? { resetare: true } : {}) };
  return { rev: revNou(), zone };
}

// Cheile rezervate de alte rulări care au făcut „citește” de la zero (rezervare cu resetare=true).
export const cheiResetare = (altii: Map<string, any>): string[] => [...altii.entries()].filter(([, r]) => r?.resetare === true).map(([k]) => k);

export function mesajInLucru(chei: string[], altii: Map<string, any>, nota = ''): string {
  const t = chei.map((k) => Date.parse(altii.get(k)?.pana_la)).filter(Number.isFinite);
  const pana = t.length ? new Date(Math.max(...t)).toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }) : null;
  const lista = chei.slice(0, 8).join(', ') + (chei.length > 8 ? ` și încă ${chei.length - 8}` : '');
  return `${chei.length === 1 ? 'Zona' : 'Zonele'} ${lista} ${chei.length === 1 ? 'e' : 'sunt'} în lucru în alt tab (altă rulare)` +
    `${pana ? `, rezervate până la ${pana}` : ''}${nota ? ` — ${nota}` : ''} — nu s-a apelat AI, nu s-a plătit nimic. Lasă celălalt tab să termine; ` +
    'dacă a fost închis, rezervarea expiră singură și zona se poate relua.';
}

// Rezervă cheile lotului prin CAS. planifica(d, altii) calculează pe documentul PROASPĂT (la conflict se recalculează):
//  { cand: chei candidate (ce s-ar citi fără rezervări), lot: chei de rezervat acum, resetare?: bool,
//    blocat?: chei ale altor rulări care blochează TOATĂ rularea (nu doar zonele lor), nota?: motivul blocării } sau { stop }.
// Rezultat: { ok, doc, plan, rezervat } (doc = documentul DUPĂ rezervare — baza scrierii următoare) |
//           { ok:false, inLucru: {chei, mesaj} } (toate candidatele rezervate de alții, sau rularea blocată) | { ok:false, stop }.
export async function rezervaChei(supa: any, docId: number, docStart: any, rulare: string, taiatLa: string | null,
  planifica: (d: any, altii: Map<string, any>, incercare: number) => { cand: string[]; lot: string[]; stop?: any; blocat?: string[]; nota?: string; resetare?: boolean; [k: string]: any },
): Promise<any> {
  let plan: any = null, baza: any = docStart, altii = new Map<string, any>();
  const w = await scrieCAS(supa, docId, docStart, (d: any, incercare: number) => {
    baza = d;
    if ((d?.analiza?.plansa?.taiat_la ?? null) !== (taiatLa ?? null))
      return { stop: { status: 409, error: 'Planșa a fost retăiată între timp — pornește „citește” din nou.' } };
    altii = rezervateDeAltii(d?.analiza?.rezervari_zone, taiatLa, rulare);
    plan = planifica(d, altii, incercare);
    if (plan.stop) return { stop: plan.stop };
    if (plan.blocat?.length) return { stop: { inLucru: true } };
    if (!plan.lot.length) return { stop: plan.cand.length ? { inLucru: true } : { nimic: true } };
    return { upd: { analiza: { ...d.analiza, rezervari_zone: rezervariNoi(d.analiza?.rezervari_zone, taiatLa, Date.now(),
      { adauga: { chei: plan.lot, rulare, resetare: plan.resetare === true } }) } } };
  });
  if (w.ok) return { ok: true, rezervat: true, plan, doc: { ...w.doc, analiza: w.rezultat.upd.analiza } };
  if (w.stop?.nimic) return { ok: true, rezervat: false, plan, doc: baza };
  if (w.stop?.inLucru) {
    const chei: string[] = plan.blocat?.length ? plan.blocat : plan.cand.filter((k: string) => altii.has(k));
    const pana = chei.map((k: string) => altii.get(k)?.pana_la).filter(Boolean).sort().pop() || null;
    return { ok: false, inLucru: { chei, pana_la: pana, mesaj: mesajInLucru(chei, altii, plan.nota || '') } };
  }
  return { ok: false, stop: w.stop };
}

// Eliberare best-effort a rezervărilor unei rulări (după un eșec care n-a scris rezultatul). Pe altă tăiere nu se
// scrie nimic: rezervările vechi sunt oricum moarte. Dacă eliberarea nu reușește, rezervarea expiră singură.
export async function elibereazaRezervari(supa: any, docId: number, rulare: string, taiatLa: string | null): Promise<boolean> {
  try {
    const { data: d } = await supa.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, nume_original, analiza, eroare').eq('id', docId).maybeSingle();
    if (!d) return false;
    const w = await scrieCAS(supa, docId, d, (x: any) => {
      const rz = x.analiza?.rezervari_zone;
      if ((x.analiza?.plansa?.taiat_la ?? null) !== (taiatLa ?? null)) return { stop: { status: 200 } };
      if (!Object.values(rz?.zone || {}).some((r: any) => r?.rulare === rulare)) return { stop: { status: 200 } };
      return { upd: { analiza: { ...x.analiza, rezervari_zone: rezervariNoi(rz, taiatLa, Date.now(), { scoateRulare: rulare }) } } };
    });
    return w.ok;
  } catch (_) { return false; }
}
