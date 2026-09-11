// ofertare-seap-import - aduce documentatia de atribuire DIRECT din SEAP in platforma.
//
// 11.09.2026: functia rula in productie FARA sa fie in repo. Adusa aici cu doua modificari
// (vezi mai jos), ca sa nu mai fie cod care exista doar pe server.
//
// De ce arhiva si nu fisier cu fisier: endpoint-ul per document
// (api-pub/files/noticedoc/<hash>) da 500 din exterior, inclusiv cu cookie de sesiune;
// arhiva (NoticeCommon/DownloadArchive/) e publica, dar NU suporta Range. ZIP-ul SEAP
// tine dimensiunile in local file header, deci se poate parcurge streaming.
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
  const raport = { adaugate: 0, completate: 0, sarite_existente: 0, lasate_pentru_vercel: [] as string[], erori: [] as string[], index: deLaIndex };

  const { data: dejaAre } = await supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licitatieId);
  const urcate = new Set((dejaAre || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => d.nume_original));
  const placeholders = new Map((dejaAre || []).filter(estePlaceholder).map((d: any) => [d.nume_original, d.id]));

  const scrie = async (rand: any, nume: string) => {
    const idPh = placeholders.get(nume);
    const { error } = idPh
      ? await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
      : await supa.from('ofertare_documente_atribuire').insert(rand);
    if (error) { raport.erori.push(`${nume}: scriere rand - ${error.message}`); return; }
    if (idPh) raport.completate++; else raport.adaugate++;
  };

  const url = `${SEAP}/NoticeCommon/DownloadArchive/?initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
  const res = await fetch(url, { headers: SEAP_HDR });
  if (!res.ok || !res.body) return json({ error: `SEAP HTTP ${res.status}` }, 502);

  const flux = new Flux(res.body.getReader());
  let index = 0, continua = false, urcatiOcteti = 0;

  try {
    while (true) {
      const head = await flux.exact(30);
      if (!head) break;
      const dv = new DataView(head.buffer, head.byteOffset, 30);
      if (dv.getUint32(0, true) !== 0x04034b50) break;
      const metoda = dv.getUint16(8, true);
      const csize = dv.getUint32(18, true);
      const usize = dv.getUint32(22, true);
      const nl = dv.getUint16(26, true), el = dv.getUint16(28, true);
      const numeBuf = await flux.exact(nl); if (!numeBuf) break;
      const nume = new TextDecoder().decode(numeBuf);
      if (el && !(await flux.sari(el))) break;

      const numeCurat = nume.replace(/\.p7s$/i, '');
      const preaMare = usize > PRAG_MARE;
      const sarim = index < deLaIndex || urcate.has(numeCurat) || JUNK_RE.test(nume) || preaMare;

      if (sarim) {
        if (index >= deLaIndex) {
          if (urcate.has(numeCurat)) raport.sarite_existente++;
          else if (preaMare) raport.lasate_pentru_vercel.push(`${numeCurat} (${(usize / 1e6).toFixed(0)}MB)`);
        }
        if (!(await flux.sari(csize))) break;
        index++;
        continue;
      }

      try {
        const comprimat = await flux.exact(csize);
        if (!comprimat) { raport.erori.push(`${numeCurat}: flux intrerupt`); break; }
        const brut = await dezumfla(comprimat, metoda);
        const { buf, nume: numeFinal } = desfaSemnatura(brut, nume);
        // numele SAU semnatura reala - vezi anti-bug 6
        const estePdf = /\.pdf$/i.test(numeFinal) || areSemnaturaPdf(buf);
        const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
        const path = `${licitatieId}/atribuire/${Date.now().toString(36)}_${safe}`;
        const { error: eUp } = await supa.storage.from('ofertare')
          .upload(path, buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' });
        if (eUp) { raport.erori.push(`${numeFinal}: ${eUp.message}`); index++; continue; }
        await scrie({
          licitatie_id: licitatieId, fisier_path: path, nume_original: numeFinal,
          tip: ghicesteTip(numeFinal), size_bytes: buf.length,
          status_procesare: estePdf ? 'neprocesat' : 'ignorat',
          eroare: estePdf ? null : 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)',
          sursa: 'seap',
        }, numeFinal);
        urcate.add(numeFinal);
        urcatiOcteti += buf.length;
      } catch (e) {
        raport.erori.push(`${numeCurat}: ${String((e as Error)?.message || e)}`);
      }

      index++;
      if (urcatiOcteti > BUGET_OCTETI || Date.now() - t0 > BUGET_MS) { continua = true; break; }
    }
  } catch (e) {
    raport.erori.push('flux: ' + String((e as Error)?.message || e));
  } finally {
    try { await res.body?.cancel(); } catch (_) { /* deja inchis */ }
  }

  if (!continua) {
    await supa.from('ofertare_licitatii').update({ documentatie_adusa_la: new Date().toISOString() }).eq('id', licitatieId);
  }
  raport.index = index;
  return json({ ...raport, continua, next_index: continua ? index : null });
});
