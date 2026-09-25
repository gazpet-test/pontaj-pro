// R4 (25.09.2026, audit T4/T11/C3/C4): scrieri concurente, versiuni nemixate, proveniență pe regiune.
// Funcții pure + scrierea compare-and-set — testate în concurenta_test.ts fără rețea.
//
// De ce compare-and-set (CAS) și nu lacăt: o rundă ține ~1–3 minute (4 zone × Opus). Un lacăt cu expirare
// fie blochează al doilea tab tot timpul ăsta (și rămâne agățat dacă funcția moare — worker killed), fie
// expiră prea devreme și nu mai protejează nimic. CAS nu ține nimic ocupat: fiecare scriere spune „scriu doar
// dacă analiza e încă cea pe care am citit-o" (citire_ai.rev). La conflict se recitește, se FUZIONEAZĂ pe zone
// și se reîncearcă — rezultatele deja plătite ale ambelor rulări se păstrează. Costul dublu (două taburi care
// citesc aceeași zonă) nu îl previne nici CAS; îl rezolvă coada persistentă (docs/R4_COADA_PERSISTENTA_ZONE.md).

export const INCERCARI_CAS = 3;
export const CALE_REV = 'analiza->citire_ai->>rev';
export const CALE_TAIAT = 'analiza->plansa->>taiat_la';

// Cheia de compatibilitate: aceeași logică de citire (cod), același model, același prompt.
export function cheieVersiune(v: any): string | null {
  if (!v?.cod || !v?.model || !v?.prompt_sha) return null;
  return `${v.cod}|${v.model}|${v.prompt_sha}`;
}

// Reluarea ('continua' / 'reia_erori' / de_la>0) pe o citire salvată cu altă versiune ar amesteca zone citite cu
// alt prompt/model într-un singur total. Implicit: refuz. Citire veche fără versiune = necunoscută = incompatibilă.
export function versiuneIncompatibila(caSalvata: any, curenta: any, mixarePermisa = false): string | null {
  if (!caSalvata || mixarePermisa) return null;
  const a = cheieVersiune(caSalvata.versiune), b = cheieVersiune(curenta);
  if (a === b) return null;
  return `Citirea salvată e făcută cu altă versiune (${a || 'necunoscută'}) decât cea curentă (${b}) — zonele nu se amestecă. ` +
    'Pornește „citește” din nou (sau reia explicit cu mixare_permisa=true).';
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
