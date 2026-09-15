// ofertare-seap-import - aduce documentatia de atribuire DIRECT din SEAP in platforma.
//
// 11.09.2026: functia rula in productie FARA sa fie in repo. Adusa aici cu doua modificari
// (vezi mai jos), ca sa nu mai fie cod care exista doar pe server.
//
// 15.09.2026 - FISIER CU FISIER (calea principala de azi). De ce s-a schimbat ordinea:
// bugetul unei rulari se consuma pe OCTETII PARCURSI din arhiva, asa ca documentele de la
// coada arhivelor mari nu mai intrau deloc - ramaneau 8 randuri placeholder /neincarcat/,
// dintre care 6 pe SCN1179776 (Clinceni).
// DESCOPERIRE (verificata experimental de pe un IP curat, Domnesti notice 100244241,
// sysNoticeTypeId 17): GET NoticeCommon/GetDfNoticeSectionFiles/ - endpointul pe care il
// foloseam DEJA doar pentru nume - intoarce pentru FIECARE document si un link propriu
// (noticeDocumentUrl = api-pub/files/noticedoc/<hash>), in listele dfNoticeDocs,
// contractingStrategyDocs, duaeDocs, decisionDocs, exAnteDocs.
// Doua capcane, ambele platite:
//   a) linkul e TOKEN TEMPORAR LEGAT DE SESIUNE: se schimba la fiecare apel si descarcarea
//      merge DOAR daca trimiti inapoi cookie-urile primite la apelul care l-a produs. Deno
//      nu pastreaza cookie-uri la fetch -> se culeg din resp.headers.getSetCookie() (fallback
//      pe get('set-cookie')), se pastreaza doar perechile nume=valoare si se dau ca antet
//      Cookie. Linkul NU se salveaza NICIODATA in BD (expira).
//   b) fisierele vin ca .p7s (container CMS) -> desfaSemnatura; iar ce iese poate fi la randul
//      lui un ZIP (semnatura PK\x03\x04), despachetat cu ACEEASI logica si aceleasi reguli de
//      denumire ca la arhiva (nume cu prefix de folder) - altfel se rup legaturile si dedup-ul.
// Implementare de referinta, functionala in productie: ofertare-seap-veghe (cookieDin,
// raspunsuriNotice). Edge functions nu pot importa cod una din alta - cookieDin e copie 1:1.
//
// Calea VECHE (arhiva) ramane REZERVA, nu se sterge: daca lista esueaza / vine goala / un
// document nu se descarca per fisier, se incearca arhiva ca pana acum.
// De ce mergea doar arhiva inainte: endpointul per document dadea 500 din exterior - acum
// merge, cu cookie-ul de sesiune de la apelul de lista. Arhiva (NoticeCommon/DownloadArchive/)
// e publica, dar NU suporta Range; ZIP-ul SEAP tine dimensiunile in local file header, deci
// se poate parcurge streaming.
//
// IMPARTIREA MUNCII: aici se aduc doar fisierele MICI. Bugetul unei rulari se consuma
// pe octetii de arhiva parcursi, iar desfacerea corecta a semnaturii cere fisierul
// intreg in memorie. Fisierele mari le duce /api/seap-import (Vercel), unde nu exista
// plafonul asta - veghea si butonul din UI il cheama automat dupa aceasta treapta.
//
// ANTI-BUG-uri platite in productie:
// 1. In local file header csize e la offset 18 si usize la 22 (de la 20 ies valori
//    aberante si totul pare "prea mare").
// 2. Uploadul cu corp ReadableStream (fetch + duplex:'half') omoara worker-ul chiar
//    si pe 0,3MB - ramane Blob.
// 3. Memoria worker-ului e CUMULATIVA pe rulare: de aceea o rulare urca cel mult
//    BUGET_OCTETI si intoarce continua=true.
// 4. Fisierele .p7s au continutul FRAGMENTAT in ASN.1 (vezi desfaSemnatura). Decuparea
//    naiva intre %PDF si %%EOF lasa antetele fragmentelor in interiorul fisierului:
//    pe documentatia Manastirea, TOATE cele 27 de fisiere semnate ieseau alterate.
// 5. tip are CHECK in BD ('duae' nu e valoare valida), iar erorile de scriere se
//    raporteaza - altfel fisierul ajunge in storage si documentul lipseste din lista.
// 6. NUMELE MINTE (11.09.2026). Un PDF numit "...POTLOGI-GAZE pdf" (spatiu in loc de punct,
//    gresit tastat de cine l-a pus in SEAP) era catalogat non-PDF, sarit de la citire SI
//    urcat cu contentType octet-stream. Formularul propunerii tehnice a zacut necitit de la
//    inceput. Acum se verifica si semnatura reala: orice PDF incepe cu octetii %PDF-.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SEAP = 'https://e-licitatie.ro/api-pub';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-radar-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SEAP_HDR: Record<string, string> = {
  'Referer': 'https://e-licitatie.ro/pub',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const BUGET_MS = 240000;
const BUGET_OCTETI = 12e6;
const PRAG_MARE = 20e6;   // peste asta: lasam fisierul pe seama functiei de pe Vercel
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i;
const estePlaceholder = (d: any) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/');

// ANTI-BUG 15.09.2026 (Clinceni): SEAP normalizeaza numele in API (scoate virgulele,
// pune spatii duble, schimba "(2)" in " 2", strecoara spatiu inainte de extensie), iar
// in arhiva numele sunt cele originale. Compararea pe nume exact producea placeholdere
// fantoma si duplicate ale aceluiasi fisier. Cheia scoate TOATE spatiile, nu doar le
// comprima - altfel "planse .pdf" si "planse.pdf" raman doua fisiere diferite.
// COPIE identica in ofertare-seap-veghe (edge functions nu pot importa cod una din alta).
// Cheia e DOAR pentru comparatie - in BD se scrie tot numele real (nume_original).
const cheieNume = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase()
  .replace(/[,()]/g, '').replace(/\s+/g, '');

// Semnatura reala a unui PDF: %PDF- la inceputul fisierului. Numele e doar un indiciu.
const areSemnaturaPdf = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D;

// Secretul NU sta in sursa: repo-ul e public. Verificare prin RPC contra Vault, care accepta
// si valoarea precedenta cat tine fereastra de rotire. Adaugat 11.09.2026 ca importul sa poata
// fi pornit si din rutine, nu doar din UI cu JWT de utilizator.
async function secretOk(req: Request, db: any): Promise<boolean> {
  const s = req.headers.get('x-radar-secret');
  if (!s) return false;
  const { data, error } = await db.rpc('fn_verifica_radar_secret', { p_secret: s });
  return !error && data === true;
}

// aceleasi reguli ca ghicesteTip din OfertareLicitatii.jsx - valorile trebuie sa
// existe in CHECK-ul coloanei tip
function ghicesteTip(nume: string): string {
  const n = nume.toLowerCase();
  if (/fisa[_ -]?date|instructiuni_ofertanti/.test(n)) return 'fisa_date';
  if (/formular|duae/.test(n)) return 'formular';
  if (/contract/.test(n)) return 'model_contract';
  if (/cantitat|antemasur|^f[1-3][_ .-]|centralizator/.test(n)) return 'lista_cantitati';
  if (/desene|plans|plansa|schema tehnologica|\.dwg|izometri|topo/.test(n)) return 'plansa';
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum';
  if (/raspuns|clarificar/.test(n)) return 'raspuns_clarificare';
  return 'alta';
}

// -- Desfacerea semnaturii electronice (.p7s / CMS) ------------------------------
// Continutul semnat sta intr-un OCTET STRING ASN.1 care, la fisierele mari, e taiat
// in bucati de ~64KB, fiecare cu propriul antet. Se parcurge structura si se lipesc
// bucatile in ordine; altfel antetele raman in mijlocul fisierului si il strica.
function antet(b: Uint8Array, i: number) {
  const tip = b[i]; i += 1;
  let lung = b[i]; i += 1;
  if (lung === 0x80) return { tip, lung: null as number | null, start: i };
  if (lung & 0x80) {
    const n = lung & 0x7f;
    lung = 0;
    for (let k = 0; k < n; k++) lung = lung * 256 + b[i + k];
    i += n;
  }
  return { tip, lung: lung as number | null, start: i };
}

function lipeste(b: Uint8Array, start: number, capat: number): Uint8Array {
  const bucati: Uint8Array[] = [];
  let i = start;
  while (i < capat && i < b.length) {
    const a = antet(b, i);
    if (a.tip === 0x00) break;
    if (a.lung === null) { bucati.push(lipeste(b, a.start, capat)); break; }
    if (a.tip === 0x04) bucati.push(b.subarray(a.start, a.start + a.lung));
    else if (a.tip === 0x24) bucati.push(lipeste(b, a.start, a.start + a.lung));
    i = a.start + a.lung;
  }
  const total = bucati.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of bucati) { out.set(x, p); p += x.length; }
  return out;
}

const OID_DATA = new Uint8Array([0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x01]);

function cautaSecventa(hay: Uint8Array, ac: Uint8Array): number {
  for (let i = 0; i <= hay.length - ac.length; i++) {
    let ok = true;
    for (let j = 0; j < ac.length; j++) if (hay[i + j] !== ac[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function desfaSemnatura(buf: Uint8Array, nume: string): { buf: Uint8Array; nume: string } {
  if (!/\.p7s$/i.test(nume)) return { buf, nume };
  const numeReal = nume.replace(/\.p7s$/i, '');
  const poz = cautaSecventa(buf, OID_DATA);
  if (poz < 0) return { buf, nume: numeReal };
  const dupaOid = antet(buf, poz + OID_DATA.length);
  if (dupaOid.tip !== 0xa0) return { buf, nume: numeReal };
  const capat = dupaOid.lung === null ? buf.length : dupaOid.start + dupaOid.lung;
  const c = antet(buf, dupaOid.start);
  if (c.tip === 0x04 && c.lung !== null) return { buf: buf.subarray(c.start, c.start + c.lung), nume: numeReal };
  if (c.tip === 0x24 || c.lung === null) {
    const sfarsit = c.lung === null ? capat : c.start + c.lung;
    const out = lipeste(buf, c.start, sfarsit);
    if (out.length) return { buf: out, nume: numeReal };
  }
  return { buf, nume: numeReal };
}

// -- Citirea arhivei -------------------------------------------------------------
class Flux {
  private coada: Uint8Array[] = [];
  private disponibil = 0;
  private gata = false;
  constructor(private rdr: ReadableStreamDefaultReader<Uint8Array>) {}
  private async umple(n: number) {
    while (this.disponibil < n && !this.gata) {
      const { value, done } = await this.rdr.read();
      if (done || !value) { this.gata = true; break; }
      this.coada.push(value);
      this.disponibil += value.length;
    }
  }
  private scoate(n: number): Uint8Array {
    const cat = Math.min(n, this.disponibil);
    const out = new Uint8Array(cat);
    let pus = 0;
    while (pus < cat) {
      const b = this.coada[0];
      const iau = Math.min(b.length, cat - pus);
      out.set(b.subarray(0, iau), pus);
      pus += iau;
      if (iau === b.length) this.coada.shift();
      else this.coada[0] = b.subarray(iau);
    }
    this.disponibil -= cat;
    return out;
  }
  async exact(n: number): Promise<Uint8Array | null> {
    await this.umple(n);
    return this.disponibil >= n ? this.scoate(n) : null;
  }
  async sari(n: number): Promise<boolean> {
    let ramas = n;
    while (ramas > 0) {
      await this.umple(Math.min(ramas, 1 << 20));
      if (this.disponibil === 0) return false;
      ramas -= this.scoate(Math.min(ramas, this.disponibil)).length;
    }
    return true;
  }
}

function dezumfla(comprimat: Uint8Array, metoda: number): Promise<Uint8Array> {
  if (metoda === 0) return Promise.resolve(comprimat);
  const ts = new TransformStream<Uint8Array, Uint8Array>();
  const gata = new Response(ts.readable.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  const w = ts.writable.getWriter();
  return (async () => {
    await w.write(comprimat);
    await w.close();
    return new Uint8Array(await gata);
  })();
}

// Cookie-urile de sesiune: COPIE 1:1 din ofertare-seap-veghe (edge functions nu impart cod).
// Deno nu pastreaza cookie-uri intre fetch-uri; tokenul din noticeDocumentUrl e legat de
// sesiunea care l-a emis, deci trebuie trimise inapoi manual la descarcare.
function cookieDin(r: Response): string {
  let brute: string[] = [];
  try { brute = (r.headers as any).getSetCookie?.() || []; } catch (_) { /* runtime vechi */ }
  if (!brute.length) {
    const unul = r.headers.get('set-cookie');
    if (unul) brute = [unul];
  }
  const perechi: string[] = [];
  for (const c of brute) {
    const pereche = String(c).split(';')[0].trim();
    if (pereche.includes('=')) perechi.push(pereche);
  }
  return perechi.join('; ');
}

const esteZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
// ANTI-BUG 15.09.2026, prins la prima rulare pe SCN1179776: .docx/.xlsx/.pptx SUNT arhive ZIP.
// Cu decizia luata doar pe semnatura PK, un formular Word a fost "despachetat" in bucatile lui
// interne si au intrat 24 de randuri gunoi (word/styles.xml, docProps/app.xml, [Content_Types].xml).
// Se despacheteaza DOAR ce e arhiva adevarata dupa nume; formatele Office raman fisiere intregi.
const eArhivaAdevarata = (nume: string, b: Uint8Array) =>
  esteZip(b) && /\.zip$/i.test(String(nume || '').replace(/\.p7s$/i, ''));

// Parcurgerea unui ZIP din flux, folosita si de arhiva mare si de ZIP-urile dinauntrul
// fisierelor aduse per document -> garanteaza ACELEASI reguli de denumire (numele intrarii
// cu tot cu prefixul de folder) si acelasi dedup in ambele cai.
// vrea(h) decide daca intrarea se citeste; primeste(h, brut) intoarce 'stop' ca sa opreasca.
// Intoarce false daca fluxul s-a intrerupt in mijlocul unei intrari.
type IntrareZip = { nume: string; metoda: number; csize: number; usize: number };
async function parcurgeZip(
  flux: Flux,
  vrea: (h: IntrareZip) => boolean,
  primeste: (h: IntrareZip, brut: Uint8Array) => Promise<'stop' | 'continua'>,
  eroare: (nume: string, msg: string) => void,
): Promise<boolean> {
  while (true) {
    const head = await flux.exact(30);
    if (!head) return true;
    const dv = new DataView(head.buffer, head.byteOffset, 30);
    if (dv.getUint32(0, true) !== 0x04034b50) return true;
    // anti-bug 1: csize la 18, usize la 22 (de la 20 ies valori aberante)
    const h: IntrareZip = { metoda: dv.getUint16(8, true), csize: dv.getUint32(18, true), usize: dv.getUint32(22, true), nume: '' };
    const nl = dv.getUint16(26, true), el = dv.getUint16(28, true);
    const numeBuf = await flux.exact(nl); if (!numeBuf) return false;
    h.nume = new TextDecoder().decode(numeBuf);
    if (el && !(await flux.sari(el))) return false;

    if (!vrea(h)) {
      if (!(await flux.sari(h.csize))) return false;
      continue;
    }
    let brut: Uint8Array;
    try {
      const comprimat = await flux.exact(h.csize);
      if (!comprimat) { eroare(h.nume, 'flux intrerupt'); return false; }
      brut = await dezumfla(comprimat, h.metoda);
    } catch (e) {
      eroare(h.nume, String((e as Error)?.message || e));
      continue;
    }
    if ((await primeste(h, brut)) === 'stop') return true;
  }
}

// Flux peste un buffer deja in memorie (ZIP-ul dinauntrul unui document adus per fisier).
const fluxDinBuf = (b: Uint8Array) => new Flux(new Blob([b]).stream().getReader() as ReadableStreamDefaultReader<Uint8Array>);

// -- Curatenie: obiecte ramase in bucket fara rand in BD --------------------------
// Un import intrerupt, un rand sters ca duplicat sau un fisier explodat gresit lasa
// in urma obiecte orfane care ocupa spatiu si nu se mai vad nicaieri in platforma.
// Se sterg DOAR obiectele din prefixul licitatiei curente care nu sunt referite de
// niciun rand din ofertare_documente_atribuire - deci nimic ce se vede in interfata.
// Ruleaza doar la finalul unui import dus pana la capat (nu pe rulari partiale, unde
// randurile inca nu sunt toate scrise si am sterge fisiere bune).
async function curataOrfani(supa: any, licitatieId: number): Promise<string[]> {
  try {
    const prefix = `${licitatieId}/atribuire`;
    const { data: obiecte, error: eLista } = await supa.storage.from('ofertare')
      .list(prefix, { limit: 1000 });
    if (eLista || !obiecte?.length) return [];
    const { data: randuri } = await supa.from('ofertare_documente_atribuire')
      .select('fisier_path').eq('licitatie_id', licitatieId);
    const folosite = new Set((randuri || []).map((r: any) => String(r.fisier_path || '')));
    const orfani = obiecte
      .filter((o: any) => o?.name && o?.id)   // id null = subfolder, nu fisier
      .map((o: any) => `${prefix}/${o.name}`)
      .filter((cale: string) => !folosite.has(cale));
    if (!orfani.length) return [];
    const { error } = await supa.storage.from('ofertare').remove(orfani);
    return error ? [] : orfani;
  } catch (_) {
    return [];   // curatenia nu are voie sa strice importul
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supa = createClient(SUPA_URL, SERVICE);

  if (!(await secretOk(req, supa))) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);
    if (jwt !== SERVICE) {
      const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!);
      const { data: u } = await anon.auth.getUser(jwt);
      if (!u?.user) return json({ error: 'unauthorized' }, 401);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const licitatieId = Number(body?.licitatie_id);
  const deLaIndex = Number(body?.de_la_index) || 0;
  if (!licitatieId) return json({ error: 'licitatie_id lipsa' }, 400);

  const { data: lic, error: eLic } = await supa.from('ofertare_licitatii')
    .select('id, nr_anunt, c_notice_id, sys_notice_type_id').eq('id', licitatieId).single();
  if (eLic || !lic) return json({ error: 'licitatie inexistenta' }, 404);
  if (!lic.c_notice_id || !lic.sys_notice_type_id) {
    return json({ error: 'licitatia nu are c_notice_id / sys_notice_type_id (se completeaza la promovarea din radar)' }, 400);
  }

  const t0 = Date.now();
  const raport = { metoda: 'per-fisier' as 'per-fisier' | 'arhiva', rezerva_arhiva: false, adaugate: 0, completate: 0, sarite_existente: 0, lasate_pentru_vercel: [] as string[], erori: [] as string[], index: deLaIndex, orfani_stersi: [] as string[] };

  const { data: dejaAre } = await supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licitatieId);
  const urcate = new Set((dejaAre || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieNume(d.nume_original)));
  const placeholders = new Map((dejaAre || []).filter(estePlaceholder).map((d: any) => [cheieNume(d.nume_original), d.id]));

  const scrie = async (rand: any, nume: string) => {
    const idPh = placeholders.get(cheieNume(nume));
    const { error } = idPh
      ? await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
      : await supa.from('ofertare_documente_atribuire').insert(rand);
    if (error) { raport.erori.push(`${nume}: scriere rand - ${error.message}`); return; }
    if (idPh) raport.completate++; else raport.adaugate++;
  };

  // Urcarea unui fisier (deja desfacut din semnatura) + randul in BD. Aceleasi reguli
  // in ambele cai: ghicesteTip, calea de storage, status_procesare, sursa:'seap', size_bytes.
  let urcatiOcteti = 0;
  const urcaFisier = async (numeFinal: string, buf: Uint8Array) => {
    // numele SAU semnatura reala - vezi anti-bug 6
    const estePdf = /\.pdf$/i.test(numeFinal) || areSemnaturaPdf(buf);
    const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
    const path = `${licitatieId}/atribuire/${Date.now().toString(36)}_${safe}`;
    const { error: eUp } = await supa.storage.from('ofertare')
      .upload(path, buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' });
    if (eUp) { raport.erori.push(`${numeFinal}: ${eUp.message}`); return false; }
    await scrie({
      licitatie_id: licitatieId, fisier_path: path, nume_original: numeFinal,
      tip: ghicesteTip(numeFinal), size_bytes: buf.length,
      status_procesare: estePdf ? 'neprocesat' : 'ignorat',
      eroare: estePdf ? null : 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)',
      sursa: 'seap',
    }, numeFinal);
    urcate.add(cheieNume(numeFinal));
    urcatiOcteti += buf.length;
    return true;
  };

  const bugetDepasit = () => urcatiOcteti > BUGET_OCTETI || Date.now() - t0 > BUGET_MS;
  let continua = false;
  let index = deLaIndex;

  // -- CALEA PRINCIPALA: fisier cu fisier (15.09.2026) ----------------------------
  const qs = `initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
  const CHEI_LISTE = ['dfNoticeDocs', 'contractingStrategyDocs', 'duaeDocs', 'decisionDocs', 'exAnteDocs'];
  let documente: { nume: string; url: string }[] = [];
  let cookie = '';
  let perFisierOk = false;
  let motivRezerva = '';

  try {
    const rl = await fetch(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?${qs}`, { headers: SEAP_HDR });
    if (!rl.ok) motivRezerva = `GetDfNoticeSectionFiles HTTP ${rl.status}`;
    else {
      cookie = cookieDin(rl);   // tokenul din noticeDocumentUrl e legat de ACEASTA sesiune
      const d = await rl.json();
      for (const cheie of CHEI_LISTE) {
        for (const f of (d?.[cheie] || [])) {
          const nume = String(f?.noticeDocumentName || '');
          const link = String(f?.noticeDocumentUrl || '');
          if (nume && link) documente.push({ nume, url: link });
        }
      }
      if (!documente.length) motivRezerva = 'lista de documente goala';
    }
  } catch (e) {
    motivRezerva = 'GetDfNoticeSectionFiles: ' + String((e as Error)?.message || e);
  }

  if (documente.length) {
    perFisierOk = true;
    const antetDesc = cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR;
    let i = 0;
    for (const doc of documente) {
      if (i < deLaIndex) { i++; continue; }
      const numeCurat = doc.nume.replace(/\.p7s$/i, '');
      if (urcate.has(cheieNume(numeCurat)) || JUNK_RE.test(doc.nume)) {
        if (urcate.has(cheieNume(numeCurat))) raport.sarite_existente++;
        i++;
        continue;
      }
      try {
        const link = doc.url.startsWith('http') ? doc.url : `https://e-licitatie.ro/${doc.url.replace(/^\/+/, '')}`;
        const rd = await fetch(link, { headers: antetDesc });
        if (!rd.ok) { raport.erori.push(`${numeCurat}: descarcare HTTP ${rd.status}`); motivRezerva ||= 'descarcari per fisier esuate'; i++; continue; }
        const cl = Number(rd.headers.get('content-length') || 0);
        if (cl > PRAG_MARE) {
          // la fel ca la arhiva: fisierele mari le duce /api/seap-import (Vercel)
          raport.lasate_pentru_vercel.push(`${numeCurat} (${(cl / 1e6).toFixed(0)}MB)`);
          try { await rd.body?.cancel(); } catch (_) { /* deja inchis */ }
          i++;
          continue;
        }
        const brutP7s = new Uint8Array(await rd.arrayBuffer());
        const { buf, nume: numeFinal } = desfaSemnatura(brutP7s, doc.nume);
        if (!buf.length) { raport.erori.push(`${numeCurat}: fisier gol`); motivRezerva ||= 'descarcari per fisier esuate'; i++; continue; }

        if (eArhivaAdevarata(doc.nume, buf)) {
          // ZIP in interiorul documentului: ACEEASI despachetare si aceleasi nume ca la arhiva
          const ok = await parcurgeZip(
            fluxDinBuf(buf),
            (h) => {
              const nc = h.nume.replace(/\.p7s$/i, '');
              if (JUNK_RE.test(h.nume)) return false;
              if (urcate.has(cheieNume(nc))) { raport.sarite_existente++; return false; }
              if (h.usize > PRAG_MARE) { raport.lasate_pentru_vercel.push(`${nc} (${(h.usize / 1e6).toFixed(0)}MB)`); return false; }
              return true;
            },
            async (h, brut) => {
              const r = desfaSemnatura(brut, h.nume);
              await urcaFisier(r.nume, r.buf);
              return 'continua';
            },
            (n, m) => raport.erori.push(`${n}: ${m}`),
          );
          if (!ok) raport.erori.push(`${numeCurat}: ZIP interior incomplet`);
        } else {
          await urcaFisier(numeFinal, buf);
        }
      } catch (e) {
        raport.erori.push(`${numeCurat}: ${String((e as Error)?.message || e)}`);
        motivRezerva ||= 'descarcari per fisier esuate';
      }
      i++;
      if (bugetDepasit() && i < documente.length) { continua = true; break; }
    }
    index = i;
  }

  // -- CALEA VECHE, REZERVA: arhiva intreaga (DownloadArchive) --------------------
  // Se incearca doar daca lista a esuat / a venit goala / un document nu s-a putut aduce.
  const nevoieDeArhiva = !continua && (!perFisierOk || !!motivRezerva);
  if (nevoieDeArhiva) {
    if (!perFisierOk) { raport.metoda = 'arhiva'; index = deLaIndex; }
    raport.rezerva_arhiva = true;
    raport.erori.push(`rezerva arhiva: ${motivRezerva || 'lista indisponibila'}`);
    const deLaIndexArhiva = perFisierOk ? 0 : deLaIndex;   // pe rezerva partiala parcurgem tot, dedup-ul taie ce avem

    const url = `${SEAP}/NoticeCommon/DownloadArchive/?${qs}`;
    let res: Response | null = null;
    try { res = await fetch(url, { headers: SEAP_HDR }); } catch (e) { raport.erori.push('arhiva: ' + String((e as Error)?.message || e)); }
    if (!res || !res.ok || !res.body) {
      if (!perFisierOk) return json({ ...raport, error: `SEAP HTTP ${res?.status ?? 'fetch esuat'}` }, 502);
      raport.erori.push(`arhiva: HTTP ${res?.status ?? 'fetch esuat'}`);
    } else {
      const flux = new Flux(res.body.getReader());
      let iArh = 0;
      try {
        const intreg = await parcurgeZip(
          flux,
          (h) => {
            const numeCurat = h.nume.replace(/\.p7s$/i, '');
            const preaMare = h.usize > PRAG_MARE;
            const sarim = iArh < deLaIndexArhiva || urcate.has(cheieNume(numeCurat)) || JUNK_RE.test(h.nume) || preaMare;
            if (sarim) {
              if (iArh >= deLaIndexArhiva) {
                if (urcate.has(cheieNume(numeCurat))) raport.sarite_existente++;
                else if (preaMare) raport.lasate_pentru_vercel.push(`${numeCurat} (${(h.usize / 1e6).toFixed(0)}MB)`);
              }
              iArh++;
              return false;
            }
            return true;
          },
          async (h, brut) => {
            const r = desfaSemnatura(brut, h.nume);
            await urcaFisier(r.nume, r.buf);
            iArh++;
            if (bugetDepasit()) { continua = true; return 'stop'; }
            return 'continua';
          },
          (n, m) => raport.erori.push(`${n.replace(/\.p7s$/i, '')}: ${m}`),
        );
        if (!intreg) raport.erori.push('arhiva: flux intrerupt');
      } catch (e) {
        raport.erori.push('flux: ' + String((e as Error)?.message || e));
      } finally {
        try { await res.body?.cancel(); } catch (_) { /* deja inchis */ }
      }
      if (!perFisierOk) index = iArh;
    }
  }

  if (!continua) {
    await supa.from('ofertare_licitatii').update({ documentatie_adusa_la: new Date().toISOString() }).eq('id', licitatieId);
    raport.orfani_stersi = await curataOrfani(supa, licitatieId);
  }
  raport.index = index;
  return json({ ...raport, continua, next_index: continua ? index : null });
});
