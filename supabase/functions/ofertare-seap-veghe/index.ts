// ofertare-seap-veghe - sta cu ochii pe anunturile SEAP ale licitatiilor in lucru,
// pana la termenul de depunere, si trage in platforma orice document APARUT NOU.
//
// De ce: autoritatile publica raspunsurile la clarificari si erratele ca fisiere
// atasate. API-ul public SEAP nu are endpoint de clarificari (toate variantele dau
// 404), dar lista de documente a anuntului se re-interogheaza - diferenta fata de
// ce avem in BD sunt exact documentele noi.
//
// Cum le aduce, in doua trepte:
// 1. ofertare-seap-import (edge) - rapid, dar bugetul lui se consuma pe octetii de
//    arhiva parcursi, deci la arhivele uriase nu ajunge la documentele de la coada;
// 2. /api/seap-import (Vercel) - parcurge arhiva integral, fara plafonul acela.
// Ce tot nu intra ramane pozitie de inventar cu marcajul /neincarcat/, ca sa nu fie
// raportat ca nou la fiecare rulare. Omul afla din clopotel.
//
// v2 (10.09.2026): documentele care arata a RASPUNS LA CLARIFICARI sau a ERATA se
// separa de restul si genereaza o notificare distincta, de tip warning, cu numele lor
// in titlu. Inainte, un raspuns al autoritatii care schimba o cerinta eliminatorie
// ajungea la om ca "3 documente noi", adica lipit de o plansa si de un formular.
//
// v3 (11.09.2026): doua schimbari cerute de Razvan.
// 1. MAIL, nu doar clopotel: raspunsurile si eratele pleaca prin Resend catre office@
//    si catre responsabilul licitatiei (ofertare_licitatii.responsabil_id - cel din
//    rubrica "pe scurt"). Documentele obisnuite NU genereaza mail: daca ar suna la
//    fiecare plansa, nimeni n-ar mai citi mailul cand chiar conteaza.
// 2. Secretul iese din sursa. Se verifica prin fn_verifica_secret contra Vault, care
//    accepta si valoarea precedenta cat tine fereastra de rotire. Tot aici a disparut
//    si valoarea de rezerva a lui SEAP_IMPORT_SECRET: scrisa in cod, ea facea ca
//    verificarea sa treaca chiar si cand variabila de mediu lipsea.
//
// v4 (15.09.2026): documentele noi se MARCHEAZA in BD (aparut_ulterior=true) pe randurile
// licitatiei al caror nume e in `noi` - si cele urcate, si placeholder-ele. Motivul: Razvan
// vrea sa le vada SEPARAT de documentatia initiala, in sectiunea „Documente noi din SEAP”
// din tab-ul Clarificari al fisei, cu citire AI dedicata (ofertare-document-nou-citeste).
// Fara marcaj, un raspuns la clarificari se pierdea printre cele 40 de planse din Documente.
//
// v9 (16.09.2026): codul SEAP a iesit din `antet` in coloana proprie `seap_cod`, cu index
//   unic partial pe (licitatie_id, seap_cod). `antet` era deja folosit de citirea AI pentru
//   antetul documentului, deci prima citire stergea codul si veghea aducea documentul din nou.
// v8 (16.09.2026): termenul de depunere se reciteste din GetSection4View la fiecare rulare si
//   se actualizeaza in platforma cand autoritatea il muta prin erata (vezi comentariul de la
//   `let termen`). Un termen vechi opreste insasi veghea, nu doar induce omul in eroare.
// v7 (16.09.2026): un document din canalul de clarificari e identificat prin
//   `noticeDocumentCode`, nu prin numele fisierului. Autoritatea republica documentatia
//   revizuita sub ACELASI nume ca originalul (Racari: „Caiet de sarcini revizuit" =
//   SCN1179379/00020, fisier identic cu SCN1179379/00002) - deduplicarea pe nume il sarea
//   in tacere si ofertantul lucra pe varianta veche. Vezi ANTI-BUG in raspunsuriNotice.
// v6 (16.09.2026): toate apelurile catre SEAP se reincearca la 403/429/5xx - SEAP
//   refuza intermitent, iar un singur refuz sarea licitatia in tacere (vezi ANTI-BUG mai jos).
// v5 (15.09.2026): veghea aduce SINGURA raspunsurile la clarificari publicate de autoritate.
// Descoperit experimental pe Domnesti (notice 100244241, sysNoticeTypeId 17): raspunsurile
// consolidate ale primariei NU apar DELOC in GetDfNoticeSectionFiles - adica exact documentele
// care conteaza cel mai mult erau ratate complet de veghe. Ele stau in alt endpoint:
//   POST /api-pub/NoticeDocument/GetAll/ (JSON, aceleasi anteturi ca SEAP_HDR - fara Referer
//   raspunde "Referrer cannot be null"), filtrat pe initNoticeId + sysNoticeTypeId.
// Doua capcane:
//   a) `noticeDocumentUrl` (api-pub/files/noticedoc/<hash>) e TOKEN TEMPORAR legat de SESIUNE:
//      se schimba la fiecare apel si descarcarea merge doar daca trimiti inapoi cookie-urile
//      primite la GetAll. Deno nu pastreaza cookie-uri la fetch -> le culegem manual din
//      resp.headers.getSetCookie() si le dam ca antet Cookie. Linkul NU se salveaza niciodata.
//   b) fisierul e container CMS/PKCS#7 (.p7s) - se desface cu desfaSemnatura (copiata din
//      ofertare-seap-import, edge functions nu impart cod).
// O singura cerere GetAll per licitatie per rulare: SEAP blocheaza IP-ul la trafic automat.
// Citirea AI NU porneste automat (costa) - documentele apar in "Documente noi din SEAP" si in
// ecranul Clarificari, cu buton manual.
//
// notifications.modul are CHECK pe lista fixa de module - pentru ofertare valoarea
// corecta e 'Comercial'. Cu 'ofertare' insertul pica silentios.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SEAP = 'https://e-licitatie.ro/api-pub';
const IMPORT_SECRET = Deno.env.get('SEAP_IMPORT_SECRET') || '';
const VERCEL_IMPORT = 'https://pontaj-pro-sooty.vercel.app/api/seap-import';
const OFFICE = 'office@gazpet.ro';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-veghe-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SEAP_HDR: Record<string, string> = {
  'Referer': 'https://e-licitatie.ro/pub',
  'Origin': 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const RUNDE_IMPORT = 4;

// ANTI-BUG 16.09.2026 (tichet TKT-2026-0258, Oana): SEAP intoarce 403 INTERMITENT,
// pe acelasi URL, cu aceleasi anteturi, la o secunda distanta. Masurat: 403,403,200 pe
// GetDfNoticeSectionFiles si 200,403,200,200,403 pe NoticeDocument/GetAll. Nu e blocare
// de IP si nu e ceva ce facem noi gresit - e limitarea lor.
// Pana acum un singur 403 insemna ca licitatia era sarita complet pe rularea aia, in
// tacere: cronul ruleaza de 2x/zi, deci un document publicat intr-o fereastra in care
// ambele rulari au luat 403 nu intra NICIODATA in platforma.
// Reincercam de 4 ori, cu pauza crescatoare. NU reincercam la 4xx care nu-s 403/429 -
// alea sunt erori reale (anunt inexistent, parametri gresiti) si merita raportate.
const asteapta = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchSeap(url: string, init?: RequestInit, incercari = 4): Promise<Response> {
  let ultim: Response | null = null;
  for (let i = 0; i < incercari; i++) {
    const r = await fetch(url, init);
    if (r.ok) return r;
    ultim = r;
    const merita = r.status === 403 || r.status === 429 || r.status >= 500;
    if (!merita || i === incercari - 1) return r;
    await asteapta(700 * (i + 1));   // 0,7s / 1,4s / 2,1s
  }
  return ultim!;
}
// v8 (16.09.2026): termenul de depunere se reciteste din SEAP la fiecare rulare.
// SEAP il da ca 'DD.MM.YYYY HH:mm' in ora Romaniei; il ducem la UTC tinand cont de
// EET/EEST (nu putem lipi '+02:00' fix - in octombrie tara e inca pe +03:00).
function dinOraRomaniei(s: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, zi, luna, an, ora = '0', min = '0'] = m;
  const naiv = Date.UTC(+an, +luna - 1, +zi, +ora, +min);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(naiv))) p[x.type] = x.value;
  const caLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return new Date(naiv - (caLocal - naiv)).toISOString();
}
const estePlaceholder = (d: any) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/');

// ANTI-BUG 15.09.2026 (Clinceni): SEAP normalizeaza numele in API (scoate virgulele,
// pune spatii duble, schimba "(2)" in " 2", strecoara spatiu inainte de extensie), iar
// in arhiva numele sunt cele originale. Cheia scoate TOATE spatiile, nu doar le comprima.
// Compararea pe nume exact producea placeholdere si duplicate ale aceluiasi fisier.
// COPIE identica in ofertare-seap-import (edge functions nu pot importa cod una din alta).
// Cheia e DOAR pentru comparatie - in BD se scrie tot numele real (nume_original).
const cheieNume = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase()
  .replace(/[,()]/g, '').replace(/\s+/g, '');
// Numele sub care autoritatile publica raspunsurile si modificarile documentatiei.
const esteRaspuns = (n: string) => /clarific|r[aă]spuns|erat[aă]|errata|completare|modificare|revizuit|revizie|addendum|notificare/i.test(n);
const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

// -- Desfacerea semnaturii electronice (.p7s / CMS) ------------------------------
// COPIE 1:1 din supabase/functions/ofertare-seap-import/index.ts (edge functions nu pot
// importa cod una din alta). Daca se corecteaza acolo, se corecteaza si aici.
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

const arePdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const faraDiacritice = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// 31 = "Raspuns consolidat la solicitarile de clarificare"; restul se ghiceste din text.
const eRaspunsSeap = (it: any) =>
  Number(it?.sysNoticeDocumentTypeId) === 31 ||
  /clarific|erat|raspuns/i.test(faraDiacritice(`${it?.sysNoticeDocumentType?.text ?? it?.sysNoticeDocumentType ?? ''} ${it?.noticeDocumentName ?? ''}`));

// Cookie-urile din raspunsul GetAll, pregatite pentru antetul Cookie al descarcarii.
// `fetch` din Deno NU le pastreaza singur, iar tokenul de fisier e legat de sesiune.
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supa = createClient(SUPA_URL, SERVICE);

  const antet = req.headers.get('x-veghe-secret');
  let cuSecret = false;
  if (antet) {
    const { data: ok } = await supa.rpc('fn_verifica_secret', { p_nume: 'SEAP_VEGHE_SECRET', p_secret: antet });
    cuSecret = ok === true;
  }
  if (!cuSecret) {
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

  // Licitatiile de vegheat: au anunt SEAP legat si termenul nu a trecut inca
  // (o zi de toleranta - documentele apar uneori chiar in ziua depunerii)
  let q = supa.from('ofertare_licitatii')
    .select('id, nr_anunt, obiect, c_notice_id, sys_notice_type_id, termen_depunere, created_by, responsabil_id, status')
    .not('c_notice_id', 'is', null);
  if (body?.licitatie_id) q = q.eq('id', Number(body.licitatie_id));
  else q = q.gte('termen_depunere', new Date(Date.now() - 86400000).toISOString());
  const { data: licitatii, error: eLic } = await q;
  if (eLic) return json({ error: eLic.message }, 500);

  const raport: any[] = [];

  // v5: raspunsurile la clarificari, din NoticeDocument/GetAll (nu apar in GetDfNoticeSectionFiles).
  // O SINGURA cerere pe licitatie pe rulare. Nu arunca niciodata: erorile se raporteaza.
  async function raspunsuriNotice(lic: any): Promise<{ adusi: string[]; eroare: string | null }> {
    const adusi: string[] = [];
    let lista: any[] = [];
    let cookie = '';
    try {
      const r = await fetchSeap(`${SEAP}/NoticeDocument/GetAll/`, {
        method: 'POST',
        headers: { ...SEAP_HDR, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sortProperty: 'transmissionDate', pageSize: 50, pageIndex: 0,
          initNoticeId: String(lic.c_notice_id), sysNoticeTypeId: String(lic.sys_notice_type_id),
          procedureId: null, sysNoticeDocumentState: null, sysNoticeDocumentType: null,
          sysValidationDocType: null, noticeDocumentPostDateFrom: null, noticeDocumentPostDateTo: null,
          sortProperties: null, sadId: null,
        }),
      });
      if (!r.ok) return { adusi, eroare: `GetAll HTTP ${r.status}` };
      cookie = cookieDin(r);
      const txt = await r.text();
      let d: any = null;
      try { d = JSON.parse(txt); } catch (_) { return { adusi, eroare: 'GetAll: raspuns non-JSON' }; }
      lista = Array.isArray(d?.items) ? d.items : [];
    } catch (e) {
      return { adusi, eroare: 'GetAll: ' + String((e as Error)?.message || e) };
    }
    if (!lista.length) return { adusi, eroare: null };

    const { data: aveamDeja } = await supa.from('ofertare_documente_atribuire')
      .select('nume_original, tip, seap_cod').eq('licitatie_id', lic.id);
    // ANTI-BUG 16.09.2026 (tichet Oana, Racari SCN1179379): identitatea unui document din
    // canalul de clarificari e `noticeDocumentCode` (ex. SCN1179379/00020), NU numele
    // fisierului. Autoritatea republica documentatia revizuita sub ACELASI nume de fisier
    // ca originalul - dedus pe nume, caietul de sarcini revizuit era sarit in tacere, si
    // ofertantul lucra mai departe pe varianta veche. Codurile deja vazute se tin in
    // coloana `seap_cod`; numele ramane doar pentru randurile vechi, fara cod.
    //
    // ANTI-BUG 16.09.2026, partea a doua: codul a stat initial in `antet`. Gresit - `antet`
    // e campul in care citirea AI scrie ANTETUL documentului (obiectiv, beneficiar,
    // proiect_nr, revizie), deci prima citire il suprascria, veghea nu mai recunostea
    // documentul si il aducea a doua oara ca nou. Trei perechi de duplicate in cateva ore,
    // plus riscul ca cineva sa plateasca o a doua citire AI pe un caiet de 27 de pagini.
    // Acum codul are coloana lui, iar un index unic partial pe (licitatie_id, seap_cod)
    // face duplicatele imposibile structural: daca logica de aici greseste din nou,
    // insertul pica in loc sa treaca tacut.
    const coduriCunoscute = new Set(
      (aveamDeja || []).map((d: any) => d?.seap_cod).filter(Boolean).map(String),
    );
    const numeCunoscute = new Map<string, any>(
      (aveamDeja || []).map((d: any) => [cheieNume(d.nume_original), d]),
    );
    const erori: string[] = [];

    for (const it of lista) {
      const cod = String(it?.noticeDocumentCode || '');
      const fisier = String(it?.documentName || it?.noticeDocumentName || '').replace(/\.p7s$/i, '');
      const titlu = String(it?.noticeDocumentName || '').trim();
      if (!fisier) continue;
      // idempotent (ruleaza de 2x/zi): codul e cheia. Fara cod, cadem pe vechea regula.
      if (cod ? coduriCunoscute.has(cod) : numeCunoscute.has(cheieNume(fisier))) continue;
      // Republicare: acelasi nume de fisier ca un document pe care deja il avem => e o
      // VERSIUNE NOUA a lui. Se aduce oricum, sub un nume care o deosebeste, si mosteneste
      // tipul documentului inlocuit (un caiet de sarcini revizuit ramane caiet de sarcini,
      // nu devine „raspuns la clarificari" - altfel iese din motorul de acoperire).
      const inlocuit = numeCunoscute.get(cheieNume(fisier));
      const nume = inlocuit && titlu && titlu !== fisier ? `${titlu} — ${fisier}` : fisier;
      const url = String(it?.noticeDocumentUrl || '');
      if (!url) { erori.push(`${nume}: fara noticeDocumentUrl`); continue; }
      try {
        // tokenul e temporar SI legat de sesiune -> trimitem inapoi cookie-urile de la GetAll
        const rd = await fetchSeap(url.startsWith('http') ? url : `https://e-licitatie.ro/${url.replace(/^\/+/, '')}`, {
          headers: cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR,
        });
        if (!rd.ok) { erori.push(`${nume}: descarcare HTTP ${rd.status}`); continue; }
        const brut = new Uint8Array(await rd.arrayBuffer());
        const { buf } = desfaSemnatura(brut, String(it?.documentName || nume));
        if (!buf.length) { erori.push(`${nume}: fisier gol`); continue; }
        const safe = nume.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
        // codul intra in cale: doua versiuni ale aceluiasi fisier nu se mai suprascriu
        const path = `${lic.id}/atribuire/raspunsuri/${cod ? cod.replace(/[^a-zA-Z0-9]+/g, '_') + '_' : ''}${safe}`;
        const { error: eUp } = await supa.storage.from('ofertare')
          .upload(path, buf, {
            upsert: true,
            contentType: arePdf(buf) || /\.pdf$/i.test(nume) ? 'application/pdf' : 'application/octet-stream',
          });
        if (eUp) { erori.push(`${nume}: upload ${eUp.message}`); continue; }
        const { error: eIns } = await supa.from('ofertare_documente_atribuire').insert({
          licitatie_id: lic.id, fisier_path: path, nume_original: nume,
          tip: inlocuit?.tip || (eRaspunsSeap(it) ? 'raspuns_clarificare' : 'alta'),
          sursa: 'seap', aparut_ulterior: true, status_procesare: 'neprocesat',
          size_bytes: buf.length,
          seap_cod: cod || null,
          // metadatele descriptive stau separat de `antet`, ca sa nu se bata cu citirea AI
          seap_meta: { titlu: titlu || null, publicat: it?.publicationDate || null,
                       inlocuieste: inlocuit ? inlocuit.nume_original : null },
        });
        if (eIns) { erori.push(`${nume}: insert ${eIns.message}`); continue; }
        if (cod) coduriCunoscute.add(cod);
        numeCunoscute.set(cheieNume(nume), { nume_original: nume, tip: inlocuit?.tip });
        adusi.push(inlocuit ? `${nume} (INLOCUIESTE versiunea veche)` : nume);
      } catch (e) {
        erori.push(`${nume}: ${String((e as Error)?.message || e)}`);
      }
    }
    return { adusi, eroare: erori.length ? erori.join(' | ') : null };
  }

  for (const lic of licitatii || []) {
    const qs = `initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
    const laSeap: string[] = [];
    try {
      const r = await fetchSeap(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?${qs}`, { headers: SEAP_HDR });
      if (!r.ok) {
        raport.push({
          licitatie: lic.nr_anunt,
          eroare: `SEAP HTTP ${r.status}` + (r.status === 403
            ? ' — SEAP a refuzat si dupa 4 incercari. Limitarea lor, nu a noastra; reincearca peste cateva minute.'
            : ''),
        });
        continue;
      }
      const d = await r.json();
      for (const cheie of ['dfNoticeDocs', 'duaeDocs', 'decisionDocs', 'contractingStrategyDocs', 'exAnteDocs']) {
        for (const f of (d?.[cheie] || [])) {
          const n = String(f?.noticeDocumentName || '').replace(/\.p7s$/i, '');
          if (n) laSeap.push(n);
        }
      }
    } catch (e) {
      raport.push({ licitatie: lic.nr_anunt, eroare: String((e as Error)?.message || e) });
      continue;
    }

    const { data: aveam } = await supa.from('ofertare_documente_atribuire')
      .select('id, nume_original, fisier_path').eq('licitatie_id', lic.id);
    const cunoscute = new Set((aveam || []).map((d: any) => cheieNume(d.nume_original)));
    // `noi` pastreaza numele BRUTE din SEAP (se scriu ca nume_original la placeholdere),
    // dar atat deduplicarea cat si comparatia cu ce avem se fac pe cheie.
    const noi: string[] = [];
    const vazute = new Set<string>();
    for (const n of laSeap) {
      const k = cheieNume(n);
      if (vazute.has(k) || cunoscute.has(k)) continue;
      vazute.add(k);
      noi.push(n);
    }

    // v8: TERMENUL. Pana acum se scria o singura data, la importul initial, si nu se mai
    // recitea niciodata. Cand autoritatea prelungea prin erata (Racari: 25.09 -> 12.10),
    // platforma ramanea pe data veche - iar veghea insasi filtreaza pe `termen_depunere >=
    // ieri`, deci dupa 25.09 ar fi incetat sa mai urmareasca anuntul, fix in perioada cu cele
    // mai multe clarificari. Un termen vechi nu e doar o data gresita pe ecran: opreste veghea.
    let termen: any = null;
    try {
      const rt = await fetchSeap(`${SEAP}/NoticeCommon/GetSection4View/?${qs}`, { headers: SEAP_HDR });
      if (rt.ok) {
        const d4 = await rt.json();
        const iso = dinOraRomaniei(d4?.tenderReceiptDeadline || '');
        if (iso && (!lic.termen_depunere || Math.abs(new Date(iso).getTime() - new Date(lic.termen_depunere).getTime()) > 60000)) {
          const { error: eT } = await supa.from('ofertare_licitatii')
            .update({ termen_depunere: iso }).eq('id', lic.id);
          termen = eT ? { eroare: eT.message } : { vechi: lic.termen_depunere, nou: iso };
          if (!eT) lic.termen_depunere = iso;
        }
      } else termen = { eroare: `GetSection4View HTTP ${rt.status}` };
    } catch (e) {
      termen = { eroare: 'GetSection4View: ' + String((e as Error)?.message || e) };
    }

    // v5: raspunsurile publicate de autoritate stau in alt endpoint - se aduc oricum,
    // chiar daca lista de documente a anuntului nu s-a schimbat.
    const { adusi: raspunsuriAduse, eroare: raspunsuriEroare } = await raspunsuriNotice(lic);

    if (!noi.length && !raspunsuriAduse.length && !termen?.nou) {
      raport.push({ licitatie: lic.nr_anunt, noi: 0, raspunsuri_aduse: 0, raspunsuri_eroare: raspunsuriEroare, termen });
      continue;
    }

    // treapta 1: importul rapid din Supabase (doar daca s-au vazut documente noi in anunt)
    for (let i = 0; i < (noi.length ? RUNDE_IMPORT : 0); i++) {
      try {
        const r = await fetch(`${SUPA_URL}/functions/v1/ofertare-seap-import`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ licitatie_id: lic.id }),
        });
        const rez = await r.json().catch(() => ({}));
        if (!rez?.continua) break;
      } catch (_) { break; }
    }

    // treapta 2: ce a ramas trece prin Vercel, unde arhiva se parcurge integral
    const { data: dupaEdge } = await supa.from('ofertare_documente_atribuire')
      .select('nume_original, fisier_path').eq('licitatie_id', lic.id);
    const urcateAcum = new Set((dupaEdge || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieNume(d.nume_original)));
    let vercel: string | null = null;
    if (noi.some((n) => !urcateAcum.has(cheieNume(n)))) {
      if (!IMPORT_SECRET) {
        vercel = 'sarit: lipseste SEAP_IMPORT_SECRET din variabilele de mediu';
      } else {
        try {
          const r = await fetch(VERCEL_IMPORT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-import-secret': IMPORT_SECRET },
            body: JSON.stringify({ licitatie_id: lic.id }),
          });
          const rez = await r.json().catch(() => ({}));
          vercel = r.ok ? `adaugate ${rez.adaugate ?? 0}, completate ${rez.completate ?? 0}` : `HTTP ${r.status} ${rez.error || ''}`;
        } catch (e) {
          vercel = 'inaccesibil: ' + String((e as Error)?.message || e);
        }
      }
    }

    // Adevarul se citeste din BD: care dintre documentele NOI au acum fisier real
    const { data: acum } = await supa.from('ofertare_documente_atribuire')
      .select('nume_original, fisier_path').eq('licitatie_id', lic.id);
    const urcate = new Set((acum || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieNume(d.nume_original)));
    const toateCunoscute = new Set((acum || []).map((d: any) => cheieNume(d.nume_original)));
    const auIntrat = noi.filter((n) => urcate.has(cheieNume(n)));
    const ramase = noi.filter((n) => !urcate.has(cheieNume(n)));

    // v4: tot ce e nou (urcat sau nu) se marcheaza ca aparut ulterior importului initial.
    // Filtrarea „ce e nou" e pe cheie, dar interogarea BD cere numele BRUTE asa cum stau in
    // nume_original - deci se iau din randurile din BD, nu din numele normalizate de SEAP.
    let marcate = 0;
    const cheiNoi = new Set(noi.map(cheieNume));
    const numeDeMarcat = [...new Set(
      (acum || []).filter((d: any) => cheiNoi.has(cheieNume(d.nume_original))).map((d: any) => d.nume_original as string),
    )];
    if (numeDeMarcat.length) {
      const { data: m, error: eM } = await supa.from('ofertare_documente_atribuire')
        .update({ aparut_ulterior: true })
        .eq('licitatie_id', lic.id).in('nume_original', numeDeMarcat).select('id');
      if (eM) raport.push({ licitatie: lic.nr_anunt, marcare_esuata: eM.message });
      marcate = (m || []).length;
    }

    for (const n of ramase) {
      if (toateCunoscute.has(cheieNume(n))) continue;
      const safe = n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
      await supa.from('ofertare_documente_atribuire').insert({
        licitatie_id: lic.id,
        fisier_path: `${lic.id}/atribuire/neincarcat/${safe}`,
        nume_original: n, tip: 'alta', status_procesare: 'ignorat', sursa: 'seap', aparut_ulterior: true,
        eroare: 'Aparut nou in SEAP, dar nu a putut fi adus automat - urca-l din "Urca fisiere".',
      });
    }

    const { data: owners } = await supa.from('profiles').select('id').eq('is_owner', true);
    const catre = new Set<string>((owners || []).map((o: any) => o.id));
    if (lic.created_by) catre.add(lic.created_by);
    if (lic.responsabil_id) catre.add(lic.responsabil_id);
    const nume = (l: string[]) => l.slice(0, 4).join(', ') + (l.length > 4 ? ` (+${l.length - 4})` : '');

    // v2: raspunsurile autoritatii se anunta separat, ca sa nu se piarda printre planse.
    const cheiRaspunsuriAduse = new Set(raspunsuriAduse.map(cheieNume));
    const raspunsuri: string[] = [];
    const vazuteR = new Set<string>();
    for (const n of [...noi.filter(esteRaspuns), ...raspunsuriAduse]) {
      const k = cheieNume(n);
      if (vazuteR.has(k)) continue;
      vazuteR.add(k);
      raspunsuri.push(n);
    }
    const restul = noi.filter((n) => !esteRaspuns(n) && !cheiRaspunsuriAduse.has(cheieNume(n)));

    const mesaje: { type: string; title: string; message: string }[] = [];
    if (termen?.nou) {
      const ro = (x: string) => new Date(x).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
      mesaje.push({
        type: 'warning',
        title: `SEAP: TERMEN MUTAT la ${lic.nr_anunt}`,
        message: `Autoritatea a schimbat termenul de depunere: ${termen.vechi ? ro(termen.vechi) : '(nesetat)'} -> ${ro(termen.nou)}. Data din platforma a fost actualizata automat din anuntul SEAP. Verifica graficul de lucru si valabilitatea garantiei de participare.`,
      });
    }
    if (raspunsuri.length) {
      const parti = [`Autoritatea a publicat ${raspunsuri.length} document(e) care par raspuns la clarificari sau modificare a documentatiei: ${nume(raspunsuri)}.`];
      if (raspunsuriAduse.length) parti.push(`Dintre ele, ${raspunsuriAduse.length} sunt raspunsuri publicate de autoritate, aduse automat din SEAP: ${nume(raspunsuriAduse)}. Se citesc din Ofertare -> Clarificari.`);
      const intrate = raspunsuri.filter((n) => urcate.has(cheieNume(n)));
      if (intrate.length < raspunsuri.length) parti.push('ATENTIE: nu toate au putut fi aduse automat - urca-le din "Urca fisiere".');
      parti.push('Citeste-le si treci intrebarea si raspunsul in Clarificari. Daca raspunsul schimba o cerinta, cerinta din registru trebuie actualizata.');
      mesaje.push({
        type: 'warning',
        title: `SEAP: RASPUNS de la autoritate la ${lic.nr_anunt}`,
        message: parti.join(' '),
      });
    }
    if (restul.length) {
      const parti: string[] = [];
      const intrate = restul.filter((n) => urcate.has(cheieNume(n)));
      const lipsa = restul.filter((n) => !urcate.has(cheieNume(n)));
      if (intrate.length) parti.push(`Aduse in platforma: ${nume(intrate)}.`);
      if (lipsa.length) parti.push(`Raman de urcat manual: ${nume(lipsa)}.`);
      mesaje.push({
        type: 'info',
        title: `SEAP: ${restul.length} document(e) nou(i) la ${lic.nr_anunt}`,
        message: parti.join(' '),
      });
    }

    for (const pid of catre) {
      for (const m of mesaje) {
        const { error: eN } = await supa.from('notifications').insert({
          profile_id: pid, type: m.type, modul: 'Comercial',
          title: m.title, message: m.message, link_to: '/ofertare',
        });
        if (eN) raport.push({ licitatie: lic.nr_anunt, notificare_esuata: eN.message });
      }
    }

    // v3: MAIL doar pentru raspunsuri si erate. Restul ramane in clopotel.
    let mail: string | null = null;
    if (raspunsuri.length) {
      const key = Deno.env.get('RESEND_API_KEY');
      if (!key) {
        mail = 'sarit: lipseste RESEND_API_KEY';
      } else {
        const to = [OFFICE];
        if (lic.responsabil_id) {
          const { data: resp } = await supa.from('profiles').select('email, name').eq('id', lic.responsabil_id).maybeSingle();
          if (resp?.email && !to.includes(resp.email)) to.push(resp.email);
        }
        const neaduse = raspunsuri.filter((n) => !urcate.has(cheieNume(n)));
        const html = `
          <p>Autoritatea a publicat <b>${raspunsuri.length} document(e)</b> care par raspuns la clarificari sau modificare a documentatiei.</p>
          <p><b>Licitatie:</b> ${esc(lic.nr_anunt || '')} — ${esc(lic.obiect || '')}<br>
             <b>Termen depunere:</b> ${lic.termen_depunere ? new Date(lic.termen_depunere).toLocaleString('ro-RO') : '—'}</p>
          <p><b>Documente:</b></p><ul>${raspunsuri.map((n) => `<li>${esc(n)}${urcate.has(cheieNume(n)) ? '' : ' <i>(nu a putut fi adus automat — urca-l din „Urca fisiere”)</i>'}</li>`).join('')}</ul>
          ${raspunsuriAduse.length ? `<p><b>${raspunsuriAduse.length}</b> dintre ele sunt <b>raspunsuri publicate de autoritate</b>, aduse automat din SEAP. Se citesc din <b>Ofertare &rarr; &#10067; Clarificari</b>.</p>` : ''}
          ${neaduse.length ? '<p><b>Atentie:</b> nu toate au intrat automat in platforma.</p>' : '<p>Toate au fost aduse automat in platforma.</p>'}
          <p>Citeste-le si treci intrebarea si raspunsul in <b>Clarificari</b>. Daca raspunsul schimba o cerinta, actualizeaza cerinta din registru.</p>
          <p><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Deschide modulul Ofertare</a></p>`;
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'PontajPRO <rapoarte@gazpet.ro>', to,
              subject: `SEAP — raspuns de la autoritate: ${lic.nr_anunt}`, html,
            }),
          });
          mail = r.ok ? `trimis catre ${to.join(', ')}` : `esuat HTTP ${r.status}`;
        } catch (e) {
          mail = 'esuat: ' + String((e as Error)?.message || e);
        }
      }
    }

    raport.push({ licitatie: lic.nr_anunt, termen, noi: noi.length, raspunsuri: raspunsuri.length, raspunsuri_aduse: raspunsuriAduse.length, raspunsuri_eroare: raspunsuriEroare, aduse: auIntrat.length, ramase: ramase.length, marcate, vercel, mail, nume: noi.slice(0, 10) });
  }

  return json({ verificate: (licitatii || []).length, raport });
});
