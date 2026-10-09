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
//   b) fisierele vin ca .p7s (container CMS) -> desface (../_shared/semnaturaCms.mjs); iar ce iese poate fi la randul
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
// 4. Fisierele .p7s au continutul FRAGMENTAT in ASN.1 (vezi ../_shared/semnaturaCms.mjs). Decuparea
//    naiva intre %PDF si %%EOF lasa antetele fragmentelor in interiorul fisierului:
//    pe documentatia Manastirea, TOATE cele 27 de fisiere semnate ieseau alterate.
// 5. tip are CHECK in BD ('duae' nu e valoare valida), iar erorile de scriere se
//    raporteaza - altfel fisierul ajunge in storage si documentul lipseste din lista.
// 6. NUMELE MINTE (11.09.2026). Un PDF numit "...POTLOGI-GAZE pdf" (spatiu in loc de punct,
//    gresit tastat de cine l-a pus in SEAP) era catalogat non-PDF, sarit de la citire SI
//    urcat cu contentType octet-stream. Formularul propunerii tehnice a zacut necitit de la
//    inceput. Acum se verifica si semnatura reala: orice PDF incepe cu octetii %PDF-.
// 7. NUMELE NU E IDENTITATE (audit #4 var. B, Razvan 08.10.2026; anti-bug Racari 16.09): o republicare sub ACELASI nume,
//    cu alt continut, era sarita in tacere de dedup-ul pe nume. Acum decide codul SEAP (noticeDocumentCode) inainte de
//    descarcare — regulile in ../_shared/codSeap.mjs; fara cod, regula pe nume de azi. Rezerva DownloadArchive ramane doar pe nume.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { randManifest, sha256Hex, MANIFEST_CONFLICT, type ManifestRand } from './manifest.ts';
import { shaDovedit, stareIdentitate, adaugaDocument, alegeNume } from '../_shared/identitateFisier.mjs';
import { ghicesteTip, esteArhiva, tipInArhiva, indiciuArhiva } from '../_shared/tipDocument.mjs';
import { desfaceFaraArhiveP7m as desface, eArhivaP7m, numeDesfacut, cheieRand as cheieRandCu, cheiSeap as cheiSeapCu } from '../_shared/semnaturaCms.mjs';
import { curataOrfani } from './orfani.ts';
import { Flux, fluxDinBuf, parcurgeZip } from '../_shared/zipFlux.mjs';
import { toatePaginile } from '../_shared/paginat.mjs';
import { scrieDocument } from './placeholder.ts';
import { codDin, inventarCod, adaugaRand, indexLista, coduriInstabile, decideSeap, rezolvaVerificare, verificabil, campuriCod, adoptaCod, mutaCod, candidatiMutare, copiiDinManifest, ADOPTIE, ALT_CONTINUT } from '../_shared/codSeap.mjs';
import { autorizeaza } from './acces.ts';

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
// plafonul TOTAL al unui ZIP desfacut inline (review PR-C, 08.10): plafonul pe intrare nu ajunge — un ZIP cu multe intrari
// mari ar urca zeci de GB intr-un singur document, fiindca bugetul se verifica doar intre documente. Peste plafon (sau peste
// bugetul de timp) intrarile ramase se sar, iar ZIP-ul intreg merge la extractorul izolat de pe NAS.
const MAX_ZIP_INLINE = 3 * PRAG_MARE;
// audit #4 (review PR-1): octetii cititi din Storage pentru candidatii UNUI document la verificarea pe continut (anti-bug 3:
// memoria e cumulativa pe rulare). Se citesc doar candidatii cu ACEEASI marime ca documentul; peste plafon = necunoscut.
const PLAFON_CANDIDATI = PRAG_MARE;
// segment ÎNTREG (ca în worker): „__MACOSX_documentatie.pdf” nu e gunoi (audit Jakarinos 07.10, #18)
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
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

// Tipul după nume și detectarea arhivelor: sursa unică în ../_shared/tipDocument.mjs (aceleași reguli în worker, api, UI).

// -- Desfacerea semnaturii electronice (.p7s / .p7m, CMS) ------------------------
// Sursa unica: ../_shared/semnaturaCms.mjs (aceeasi regula in worker, veghe, api). Parcurge STRUCTURA CMS si lipeste
// bucatile OCTET STRING in ordine (anti-bug 4). Var. B (Razvan 07.10.2026): „X.pdf.p7m” → „X (semnat).pdf”.
// Audit Jakarinos #20: o desfacere ESUATA nu mai scoate sufixul — CMS-ul brut nu mai intra drept „X.pdf” valid.
// O ARHIVA .p7m („X.rar.p7m”) ramane intreaga, cu numele SEAP: o desface workerul NAS (#644; Jakarinos #7 pe #649).

// -- Citirea arhivei ----------------------------------------------------------------
// Parserul ZIP in flux e comun cu /api/seap-import: ../_shared/zipFlux.mjs (audit Jakarinos #9 / #10): sfarsit valid doar
// la directorul central, refuz pentru data descriptor fara marimi / ZIP64 / antet necunoscut, plafon de iesire anti-bomba.

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

// E3 (review PR-1, r5): SEAP refuza INTERMITENT (403/429/5xx, masurat pe veghe 16.09: 403,403,200 pe GetDfNoticeSectionFiles).
// Fara reincercare, un singur 403 pe lista trimitea importul pe rezerva DownloadArchive (minute, doar pe nume), iar unul pe un
// document il pierdea pe rularea asta. COPIE a tiparului fetchSeap din ofertare-seap-veghe (edge functions nu impart cod):
// 4 incercari, pauze 0,7 / 1,4 / 2,1 s, doar la 403/429/5xx. In plus aici: nicio reincercare noua daca pauza ar depasi bugetul
// de timp al rularii (pesteBuget). Se intoarce raspunsul incercarii REUSITE — cookie-urile ei leaga linkurile de descarcare.
const asteapta = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchSeap(url: string, init: RequestInit, pesteBuget: (pauzaMs: number) => boolean, incercari = 4): Promise<Response> {
  let ultim: Response | null = null;
  for (let i = 0; i < incercari; i++) {
    const r = await fetch(url, init);
    if (r.ok) return r;
    ultim = r;
    const merita = r.status === 403 || r.status === 429 || r.status >= 500;
    const pauza = 700 * (i + 1);   // 0,7s / 1,4s / 2,1s
    if (!merita || i === incercari - 1 || pesteBuget(pauza)) return r;
    try { await r.body?.cancel(); } catch (_) { /* deja inchis */ }
    await asteapta(pauza);
  }
  return ultim!;
}

const esteZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
// ANTI-BUG 15.09.2026, prins la prima rulare pe SCN1179776: .docx/.xlsx/.pptx SUNT arhive ZIP.
// Cu decizia luata doar pe semnatura PK, un formular Word a fost "despachetat" in bucatile lui
// interne si au intrat 24 de randuri gunoi (word/styles.xml, docProps/app.xml, [Content_Types].xml).
// Se despacheteaza DOAR ce e arhiva adevarata dupa nume; formatele Office raman fisiere intregi.
// `nume` = numele DUPA desfacerea semnaturii („X.zip.p7s” / „X.zip.p7m” → „X.zip”)
const eArhivaAdevarata = (nume: string, b: Uint8Array) =>
  esteZip(b) && /\.zip$/i.test(String(nume || ''));
// Inventarul randurilor existente: un rand ramas cu semnatura BRUTA („X.pdf.p7s” detasata / nedesfacuta) isi pastreaza
// sufixul in cheie — nu e documentul „X.pdf” (Copilot NO-GO r1 pe #649). Cautarea dupa un nume SEAP incearca toate cheile
// lui: desfacut, „X (semnat).pdf” (var. B), randul brut.
const cheieRand = (n: unknown) => cheieRandCu(String(n ?? ''), cheieNume);
const dejaSubUnNume = (urcate: Set<string>, numeSeap: string) => cheiSeapCu(numeSeap, cheieNume).some((k: string) => urcate.has(k));

// -- Curatenie: obiecte ramase in bucket fara rand in BD --------------------------
// Un import intrerupt, un rand sters ca duplicat sau un fisier explodat gresit lasa in urma obiecte orfane. Regulile
// (fail-closed, inventar paginat, doar obiecte mai vechi de o ora) sunt in ./orfani.ts. Ruleaza doar la finalul unui
// import dus pana la capat (nu pe rulari partiale).

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supa = createClient(SUPA_URL, SERVICE);

  // secretul rutinelor / cheia service (veghea) ca înainte; un JWT de utilizator cere acces la modulul Ofertare (./acces.ts, audit #19)
  const refuz = await autorizeaza(req, () => secretOk(req, supa), SERVICE);
  if (refuz) return refuz;

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const licitatieId = Number(body?.licitatie_id);
  const deLaIndex = Number(body?.de_la_index) || 0;
  // E6 (review PR-1, r5): veghea pornește importul DOAR pentru versiuni → fără rezerva DownloadArchive (merge pe nume și nu poate
  // aduce o versiune „N (COD).ext”; ar parcurge arhiva minute întregi degeaba). Implicit (UI, rutine, documente noi): ca înainte.
  const faraRezervaArhiva = body?.fara_rezerva_arhiva === true;
  if (!licitatieId) return json({ error: 'licitatie_id lipsa' }, 400);

  const { data: lic, error: eLic } = await supa.from('ofertare_licitatii')
    .select('id, nr_anunt, c_notice_id, sys_notice_type_id').eq('id', licitatieId).single();
  if (eLic || !lic) return json({ error: 'licitatie inexistenta' }, 404);
  if (!lic.c_notice_id || !lic.sys_notice_type_id) {
    return json({ error: 'licitatia nu are c_notice_id / sys_notice_type_id (se completeaza la promovarea din radar)' }, 400);
  }

  const t0 = Date.now();
  const raport = { metoda: 'per-fisier' as 'per-fisier' | 'arhiva', rezerva_arhiva: false, adaugate: 0, completate: 0, sarite_existente: 0, lasate_pentru_vercel: [] as string[], erori: [] as string[], index: deLaIndex, orfani_stersi: [] as string[], manifest_randuri: 0, avertismente: [] as string[],
    // audit #4 var. B: sarite pe cod, coduri adoptate pe randuri vechi, coduri mutate (versiune republicata identic, F5), versiuni / frati noi, ramase pe regula veche
    sarite_cod: 0, coduri_adoptate: [] as { id: number; cod: string }[], coduri_mutate: [] as { id: number; de: string; la: string }[], versiuni_noi: [] as string[], frati: [] as string[], coduri_ambigue: [] as string[], identitate_neverificata: [] as string[], coduri_instabile: null as string | null,
    // intrarile peste 20 MB din ZIP-urile documentelor: ZIP-ul pleaca intreg la NAS, care le aduce (nu sunt „sarite”)
    lasate_pentru_nas: [] as string[],
    // E6: motivul pentru care rezerva DownloadArchive ar fi pornit, dar a fost sarita la cerere (fara_rezerva_arhiva); altfel null
    rezerva_arhiva_sarita: null as string | null };

  // inventarele pe pagini, fail-closed (audit Jakarinos #21): o listă trunchiată / o eroare NU e „nimic în platformă”
  const { data: dejaAre, error: eInv } = await toatePaginile((de: number, la: number) => supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path, seap_cod, tip, size_bytes, seap_meta').eq('licitatie_id', licitatieId).order('id').range(de, la));
  if (eInv) return json({ error: `inventarul documentelor nu s-a putut citi: ${eInv.message}` }, 500);
  const urcate = new Set((dejaAre || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieRand(d.nume_original)));
  // fișierele din ZIP-urile desfăcute aici (07.10.2026, review PR #641 + Copilot NO-GO r1 pe #643): înainte, o potrivire pe
  // cheieNume sărea în tăcere un fișier cu ALT conținut („Caiet de sarcini.pdf” din Lot1.zip și din Lot2.zip). Acum „deja”
  // doar cu sha256 DOVEDIT de manifest ('urcat') — aceeași regulă ca workerul: _shared/identitateFisier.mjs.
  const { data: manUrcat, error: eMan } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest')
    .select('arhiva_cheie, cale, document_id, sha256, stare').eq('licitatie_id', licitatieId).eq('stare', 'urcat').not('document_id', 'is', null).order('id').range(de, la));
  if (eMan) return json({ error: `manifestul nu s-a putut citi: ${eMan.message}` }, 500);
  const identitate = stareIdentitate((dejaAre || []).filter((d: any) => !estePlaceholder(d)), shaDovedit(manUrcat || []), cheieNume);
  const placeholders = new Map((dejaAre || []).filter(estePlaceholder).map((d: any) => [cheieRand(d.nume_original), d.id]));
  // audit #4 var. B: inventarul pe cod (doar randuri reale); copiii de arhiva dovediti din manifest nu primesc cod pe nume
  const inv = inventarCod(dejaAre || [], { cheieRand, cheiSeap: (n: string) => cheiSeapCu(n, cheieNume), copii: copiiDinManifest(manUrcat || [], dejaAre || []) });

  const scrie = async (rand: any, nume: string, numeSeap: string | null = null): Promise<{ id: number | null; duplicat?: true }> => {
    // placeholder-ul se completează o singură dată, doar dacă e încă placeholder (./placeholder.ts, audit #2);
    // var. B: „X (semnat).pdf” completează placeholder-ul veghei pus pe numele SEAP („X.pdf.p7m”)
    const cheie = placeholders.has(cheieRand(nume)) || !numeSeap ? cheieRand(nume) : cheieRand(numeSeap);
    // F1 (review PR-1): placeholder-ul unei VERSIUNI l-a pus veghea DUPĂ ce a anunțat-o (notificare + mail) — completarea lui
    // nu o mai anunță a doua oară: de_anuntat = false chiar în scrierea care îl completează
    const deCompletat = placeholders.has(cheie) && rand?.seap_meta?.de_anuntat === true;
    if (deCompletat) rand = { ...rand, seap_meta: { ...rand.seap_meta, de_anuntat: false, anuntat_la: new Date().toISOString(), anuntat_prin: 'placeholder veghe' } };
    const r = await scrieDocument(supa, rand, cheie, placeholders);
    // audit #4: codul SEAP e deja pe alt rand (alt drum l-a adus intre timp) = prezent, nu eroare
    if (r.duplicat) {
      raport.sarite_cod++; raport.sarite_existente++;
      raport.avertismente.push(`${nume}: codul SEAP e deja pe alt rând (adus între timp de alt drum) — sărit`);
      return { id: null, duplicat: true };
    }
    if (r.eroare) { raport.erori.push(`${nume}: scriere rand - ${r.eroare}`); return { id: null }; }
    if (r.completat) raport.completate++; else raport.adaugate++;
    return { id: r.id };
  };

  // R6: manifest de integritate (SHA-256 pe byte-ii urcati). Se strange in memorie si se scrie la final;
  // o eroare de manifest NU opreste importul — devine avertisment (raport + seap_meta pe documente).
  const manifest: ManifestRand[] = [];
  const noteazaManifest = async (arhivaCheie: string | null, cale: string, buf: Uint8Array, documentId: number | null, motiv: string | null) => {
    try {
      manifest.push(randManifest({ licitatieId, arhivaCheie, cale, marime: buf.length, sha256: await sha256Hex(buf), documentId, motiv }));
    } catch (e) { raport.avertismente.push(`manifest ${cale}: ${String((e as Error)?.message || e)}`); }
  };
  // true = toate randurile s-au scris (Jakarinos pe PR-C: predarea unei arhive catre NAS cere dovezile PERSISTATE)
  const scrieManifest = async (): Promise<boolean> => {
    if (!manifest.length) return true;
    // aceeasi cheie de 2 ori in acelasi upsert => Postgres refuza TOT lotul ("cannot affect row a second time"); pastram ultimul
    const unice = [...new Map(manifest.map(r => [`${r.arhiva_cheie}\u0000${r.cale}`, r])).values()];
    const esuate: ManifestRand[] = [];
    for (let k = 0; k < unice.length; k += 200) {
      const felie = unice.slice(k, k + 200);
      const { error } = await supa.from('ofertare_seap_manifest').upsert(felie, { onConflict: MANIFEST_CONFLICT });
      if (error) { raport.avertismente.push(`manifest: ${error.message}`); esuate.push(...felie); }
      else raport.manifest_randuri += felie.length;
    }
    // avertismentul ajunge si pe document, ca sa se vada in platforma (nu doar in raportul apelului)
    const ids = esuate.map(r => r.document_id).filter((x): x is number => !!x);
    if (!ids.length) return !esuate.length;
    try {
      const { data: meta } = await supa.from('ofertare_documente_atribuire').select('id, seap_meta').in('id', ids);
      for (const d of meta || []) {
        await supa.from('ofertare_documente_atribuire')
          .update({ seap_meta: { ...(d.seap_meta || {}), manifest_avertisment: `manifest nescris (${new Date().toISOString()})` } }).eq('id', d.id);
      }
    } catch (_) { /* avertismentul e deja in raport */ }
    return false;
  };

  // Urcarea unui fisier (deja desfacut din semnatura) + randul in BD. Aceleasi reguli
  // in ambele cai: ghicesteTip, calea de storage, status_procesare, sursa:'seap', size_bytes.
  let urcatiOcteti = 0;
  // intrari / arhive care NU au ajuns in platforma in aceasta rulare (Jakarinos pe PR-C): atingerea directorului central
  // dovedeste ca parcurgerea s-a terminat, nu ca documentele s-au importat — cu ele, documentatie_adusa_la nu se seteaza
  let nerecuperate = 0;
  // dinZip = numele ZIP-ului desfăcut aici: copiii lui se clasifică exact ca în worker (regula proprie, folderul, indiciul arhivei)
  // nota = semnatura nedesfacuta / detasata (document, nu arhiva): „ignorat” cu nota, nu PDF fals (audit #20).
  // numeSeap = numele de dinainte de desfacere (placeholder-ul veghei). caleManifest = calea din arhiva (audit #14: aceeasi
  // semnificatie ca in worker — `cale` = intrarea sursa, nu numele final sub care s-a urcat).
  // seap = campurile de cod SEAP (audit #4: campuriCod pe nivelul de sus; la copiii unei versiuni doar aparut_ulterior, NICIODATA cod)
  const urcaFisier = async (numeFinal: string, buf: Uint8Array, arhivaCheie: string | null = null, dinZip: string | null = null,
    nota: string | null = null, numeSeap: string | null = null, caleManifest: string | null = null, seap: Record<string, unknown> | null = null) => {
    // numele SAU semnatura reala - vezi anti-bug 6
    const estePdf = /\.pdf$/i.test(numeFinal) || areSemnaturaPdf(buf);
    const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
    const path = `${licitatieId}/atribuire/${Date.now().toString(36)}_${safe}`;
    const { error: eUp } = await supa.storage.from('ofertare')
      .upload(path, buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' });
    if (eUp) { nerecuperate++; raport.erori.push(`${numeFinal}: ${eUp.message}`); await noteazaManifest(arhivaCheie, caleManifest ?? numeFinal, buf, null, eUp.message); return false; }
    const deCitit = !nota && (estePdf || esteArhiva(numeFinal));
    const sc = await scrie({
      licitatie_id: licitatieId, fisier_path: path, nume_original: numeFinal,
      tip: dinZip ? tipInArhiva(numeFinal, indiciuArhiva(dinZip)) : ghicesteTip(numeFinal), size_bytes: buf.length,
      // 07.10.2026: o arhivă (rar / 7z, ZIP din rezerva DownloadArchive sau arhivă din ZIP) intră „neprocesat”, fără notă:
      // o despachetează bucla workerului NAS (extractor izolat, limite, adâncime maximă). Dacă drumul SEAP al workerului a
      // desfăcut-o deja (evidență „ok” / manifest), bucla o închide cu notă, fără a doua despachetare (review #641 r2).
      status_procesare: deCitit ? 'neprocesat' : 'ignorat',
      eroare: deCitit ? null : (nota || 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)'),
      sursa: 'seap',
      ...(seap || {}),   // o versiune isi poate aduce tipul mostenit (codSeap.mjs, tipMostenit)
    }, numeFinal, numeSeap);
    if (sc.duplicat) {
      // codul e deja pe alt rand: obiectul abia urcat nu ramane orfan; fara manifest si fara „nerecuperat” (e prezent)
      try { await supa.storage.from('ofertare').remove([path]); } catch (_) { /* il ia curatenia orfanilor dupa o ora */ }
      urcatiOcteti += buf.length;
      return true;
    }
    const docId = sc.id;
    await noteazaManifest(arhivaCheie, caleManifest ?? numeFinal, buf, docId, docId ? null : 'rand BD nescris');
    urcate.add(cheieRand(numeFinal));
    if (docId) {
      adaugaDocument(identitate, numeFinal, docId, await sha256Hex(buf));
      adaugaRand(inv, { id: docId, nume_original: numeFinal, fisier_path: path, seap_cod: (seap?.seap_cod as string) ?? null, dinRulare: true,
        inlocuieste_id: (seap?.seap_meta as any)?.inlocuieste_id ?? null, cod_anterior: (seap?.seap_meta as any)?.cod_anterior ?? null });
    }
    else nerecuperate++;   // fișier în Storage fără rând în BD = nu e în platformă (Jakarinos r2 pe #651)
    urcatiOcteti += buf.length;
    return !!docId;
  };

  const bugetDepasit = () => urcatiOcteti > BUGET_OCTETI || Date.now() - t0 > BUGET_MS;
  // E3: o reincercare SEAP nu porneste daca pauza ei ar trece de bugetul de timp al rularii
  const pesteBuget = (pauzaMs: number) => Date.now() - t0 + pauzaMs > BUGET_MS;
  let continua = false;
  let index = deLaIndex;

  // -- CALEA PRINCIPALA: fisier cu fisier (15.09.2026) ----------------------------
  const qs = `initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
  const CHEI_LISTE = ['dfNoticeDocs', 'contractingStrategyDocs', 'duaeDocs', 'decisionDocs', 'exAnteDocs'];
  // cod = noticeDocumentCode (audit #4 var. B). Fara dedup in lista: pozitia (next_index) inseamna acelasi lucru la fiecare apel
  let documente: { nume: string; url: string; cod: string }[] = [];
  let cookie = '';
  let perFisierOk = false;
  let motivRezerva = '';

  try {
    // E3: cu reincercari (403/429/5xx); cookie-urile vin din raspunsul incercarii REUSITE (fetchSeap il intoarce pe el)
    const rl = await fetchSeap(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?${qs}`, { headers: SEAP_HDR }, pesteBuget);
    if (!rl.ok) motivRezerva = `GetDfNoticeSectionFiles HTTP ${rl.status}`;
    else {
      cookie = cookieDin(rl);   // tokenul din noticeDocumentUrl e legat de ACEASTA sesiune
      const d = await rl.json();
      for (const cheie of CHEI_LISTE) {
        for (const f of (d?.[cheie] || [])) {
          const nume = String(f?.noticeDocumentName || '');
          const link = String(f?.noticeDocumentUrl || '');
          if (nume && link) documente.push({ nume, url: link, cod: codDin(f) });
        }
      }
      if (!documente.length) motivRezerva = 'lista de documente goala';
    }
  } catch (e) {
    motivRezerva = 'GetDfNoticeSectionFiles: ' + String((e as Error)?.message || e);
  }

  // audit #4 var. B: indexul listei COMPLETE a acestui apel (nu felia de la de_la_index) + siguranta pe coduri instabile
  const lista = indexLista(documente, (n: string) => cheiSeapCu(n, cheieNume));
  const instabil = coduriInstabile(inv, lista, documente, (n: string) => cheiSeapCu(n, cheieNume));
  if (instabil) { inv.instabile = true; raport.coduri_instabile = instabil; raport.erori.push(instabil); nerecuperate++; }
  // sha-ul unor randuri existente (verificarea pe continut, decizia 4 = A; fratele identic): intai dovada din manifest / urcarea
  // din rularea asta (fara cost); apoi marimea — alta marime decat documentul (desfacut sau brut) = alt continut, fara citire;
  // abia la ACEEASI marime obiectul din Storage, cu plafon pe document (PLAFON_CANDIDATI) si octetii in buget (anti-bug 3).
  // Un candidat FARA marime nu se descarca deloc (Copilot r2 + Jakarinos r9 pe #652: download() aduce tot obiectul in memorie
  // inainte de orice verificare de marime) — ramane necunoscut, deci identitatea ramane NEVERIFICATA (fail-closed, mai jos).
  // Masurat 08.10.2026: 2 randuri fara marime din 1342.
  // Se opreste la prima potrivire. Nu arunca: necunoscut = null.
  const shaStocat = new Map<number, string | null>();
  const shaDinStorage = async (r: any): Promise<string | null> => {
    if (shaStocat.has(r.id)) return shaStocat.get(r.id) ?? null;
    let sha: string | null = null;
    try {
      const marime = Number(r.size_bytes);
      if (r.fisier_path && Number.isFinite(marime) && marime > 0 && marime <= PRAG_MARE) {
        const { data, error } = await supa.storage.from('ofertare').download(r.fisier_path);
        if (!error && data && data.size <= PRAG_MARE) {
          const b = new Uint8Array(await data.arrayBuffer());
          urcatiOcteti += b.length;
          sha = await sha256Hex(b);
        }
      }
    } catch (_) { sha = null; }
    shaStocat.set(r.id, sha);
    return sha;
  };
  const shaRanduri = async (randuri: any[], shas: Set<string>, lungimi: number[]): Promise<Map<number, string | null>> => {
    const m = new Map<number, string | null>();
    for (const r of randuri) {
      const d = r.id != null ? identitate.shaDoc.get(r.id) : null;
      if (!d) continue;
      m.set(r.id, d);
      if (shas.has(d)) return m;
    }
    let citit = 0;
    for (const r of randuri) {
      if (m.has(r.id)) continue;
      const marime = Number(r.size_bytes);
      if (!(marime > 0)) { m.set(r.id, null); continue; }   // fara marime: nu se descarca (vezi shaDinStorage)
      if (!lungimi.includes(marime)) { m.set(r.id, ALT_CONTINUT); continue; }
      if (citit + marime > PLAFON_CANDIDATI) { m.set(r.id, null); continue; }
      citit += marime;
      const sha = await shaDinStorage(r);
      m.set(r.id, sha);
      if (sha && shas.has(sha)) return m;
    }
    return m;
  };
  const areDovada = (r: any) => !!(r?.id != null && identitate.shaDoc.get(r.id));
  // documente fara cod / noi cazute pe drumul per fisier: dupa rezerva se verifica daca le-a adus ea (altfel = lipsa)
  const esuatePerFisier: string[] = [];
  let esecuriLaRand = 0;   // descarcari per fisier cazute la rand (dupa reincercari) — vezi E3 mai jos
  // R2 (r4): randurile pe care s-a mutat deja un cod in rularea asta (F5) — un al doilea document nu se muta pe acelasi rand
  const tinteMutare = new Set<number>();

  if (documente.length) {
    perFisierOk = true;
    const antetDesc = cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR;
    let i = 0;
    for (const doc0 of documente) {
      if (i < deLaIndex) { i++; continue; }
      if (JUNK_RE.test(doc0.nume)) {
        if (dejaSubUnNume(urcate, doc0.nume)) raport.sarite_existente++;
        i++;
        continue;
      }
      // audit #4 var. B: codul SEAP decide INAINTE de descarcare (../_shared/codSeap.mjs). Orice iesire timpurie face i++.
      const dec: any = decideSeap(inv, lista, doc0, cheiSeapCu(doc0.nume, cheieNume), { adoptie: ADOPTIE });
      if (doc0.cod) inv.decise.add(doc0.cod);
      if (dec.fel === 'fara_cod' && dejaSubUnNume(urcate, doc0.nume)) {   // fara cod: regula pe nume de azi
        raport.sarite_existente++;
        i++;
        continue;
      }
      if (dec.fel === 'sari') {
        raport.sarite_existente++;
        if (dec.motiv === 'cod' || dec.motiv === 'dublu') raport.sarite_cod++;
        else if (dec.motiv !== 'semnatura') raport.coduri_ambigue.push(`${doc0.nume} (${doc0.cod}): ${dec.motiv === 'volum' ? 'volum RAR, nu se versionează' : 'rămas pe regula veche (după nume)'}`);
        i++;
        continue;
      }
      if (dec.fel === 'adopta') {
        // rand vechi fara cod, unic pe nume (L1 = A) sau urcat sub numele cu cod „N (COD).ext”: codul pe el, fara descarcare
        const a = await adoptaCod(supa, licitatieId, inv, dec.rand, doc0.cod);
        if (a === 'adoptat') raport.coduri_adoptate.push({ id: dec.rand.id, cod: doc0.cod });
        else if (typeof a === 'object') raport.avertismente.push(`${doc0.nume}: codul SEAP ${doc0.cod} nu s-a putut înregistra pe #${dec.rand.id} — ${a.eroare}`);
        raport.sarite_existente++;
        i++;
        if (bugetDepasit() && i < documente.length) { continua = true; break; }
        continue;
      }
      // versiune / frate / verificare: numele distinct „N (COD).ext” e hotarat pe numele SEAP brut, inainte de desfacere
      const doc = dec.fel === 'versiune' || dec.fel === 'frate' || dec.fel === 'verifica' ? { ...doc0, nume: dec.nume as string } : doc0;
      // rezerva DownloadArchive (doar pe nume) nu poate aduce un astfel de document: numele vechi e deja in platforma
      const strict = doc !== doc0;
      const numeCurat = eArhivaP7m(doc.nume) ? doc.nume : numeDesfacut(doc.nume);
      const esec = () => { if (strict) nerecuperate++; else { esuatePerFisier.push(doc0.nume); motivRezerva ||= 'descarcari per fisier esuate'; } };
      // Copilot r1 pe #652 (P1): identitatea NEDOVEDITA nu e „exista deja” — fail-closed: raportata, numarata la nerecuperate
      // (documentatia nu se declara adusa), reluata la rularea urmatoare. verificabil() e fals cand niciun candidat n-are dovada
      // sau marime (fara marime nu se descarca — memoria edge-ului).
      const neverificat = (motiv: string) => {
        const t = `${doc0.nume} (${doc0.cod}): identitatea nu s-a putut verifica — ${motiv}`;
        raport.identitate_neverificata.push(t); raport.erori.push(t); nerecuperate++;
      };
      if (!verificabil(dec, areDovada)) {
        neverificat('niciun candidat nu are dovadă sau mărime (urcă din nou documentul din platformă, sau verifică-l de mână)');
        i++;
        if (bugetDepasit() && i < documente.length) { continua = true; break; }
        continue;
      }
      try {
        const link = doc.url.startsWith('http') ? doc.url : `https://e-licitatie.ro/${doc.url.replace(/^\/+/, '')}`;
        // E3: reincercari, in buget. Review PR-1 r5: dupa 3 descarcari la rand cazute (SEAP refuza per fisier), o singura
        // incercare — altfel pauzele ar consuma bugetul inaintea rezervei DownloadArchive, care aduce restul dintr-o bucata
        const rd = await fetchSeap(link, { headers: antetDesc }, pesteBuget, esecuriLaRand >= 3 ? 1 : 4);
        if (!rd.ok) { esecuriLaRand++; raport.erori.push(`${numeCurat}: descarcare HTTP ${rd.status}`); esec(); i++; continue; }
        esecuriLaRand = 0;
        const cl = Number(rd.headers.get('content-length') || 0);
        if (cl > PRAG_MARE) {
          if (dec.fel === 'verifica') neverificat(`peste 20 MB (${(cl / 1e6).toFixed(0)}MB) — o verifică workerul NAS sau omul`);
          else if (strict) { nerecuperate++; raport.erori.push(`${numeCurat}: versiune/frate nouă peste 20 MB — /api/seap-import o sare după nume; o aduce workerul NAS (licitații GO) sau manual`); }
          // la fel ca la arhiva: fisierele mari le duce /api/seap-import (Vercel)
          else raport.lasate_pentru_vercel.push(`${numeCurat} (${(cl / 1e6).toFixed(0)}MB)`);
          try { await rd.body?.cancel(); } catch (_) { /* deja inchis */ }
          i++;
          continue;
        }
        const brut = new Uint8Array(await rd.arrayBuffer());
        if (!brut.length) { raport.erori.push(`${numeCurat}: fisier gol`); esec(); i++; continue; }
        const ds = desface(brut, doc.nume);
        const { buf, nume: numeFinal } = ds;

        // verificarea pe continut (decizia 4 = A / copii de arhiva): acelasi sha → codul pe ACEL rand, fara upload. Candidatii se
        // citesc DUPA descarcare si dupa pragul de marime (nimic citit degeaba), doar cei cu aceeasi marime (shaRanduri).
        let decF: any = dec;
        const lungimi = [buf.length, brut.length];
        // F5: și la o versiune — republicată IDENTIC sub cod nou nu e versiune (mai jos)
        const shas = dec.fel === 'verifica' || dec.fel === 'frate' || dec.fel === 'versiune' ? [await sha256Hex(buf), ...(brut !== buf ? [await sha256Hex(brut)] : [])] : [];
        if (dec.fel === 'verifica') {
          decF = rezolvaVerificare(dec, shas, await shaRanduri(dec.candidati, new Set(shas), lungimi));
          if (decF.fel === 'adopta' || decF.fel === 'sari') {
            if (decF.fel === 'adopta') {
              const a = await adoptaCod(supa, licitatieId, inv, decF.rand, doc0.cod);
              if (a === 'adoptat') raport.coduri_adoptate.push({ id: decF.rand.id, cod: doc0.cod });
              else if (typeof a === 'object') raport.avertismente.push(`${doc0.nume}: codul SEAP ${doc0.cod} nu s-a putut înregistra pe #${decF.rand.id} — ${a.eroare}`);
              raport.sarite_existente++;
            } else if (decF.motiv === 'volum') { raport.coduri_ambigue.push(`${doc0.nume} (${doc0.cod}): volum RAR, nu se versionează`); raport.sarite_existente++; }
            else neverificat('conținutul unui candidat nu s-a putut citi');
            urcatiOcteti += brut.length;   // anti-bug 3: memoria e cumulativa pe rulare, si fara upload
            i++;
            if (bugetDepasit() && i < documente.length) { continua = true; break; }
            continue;
          }
        }
        // fratele cu ACELASI continut ca un rand existent (acelasi fisier listat de doua ori cu coduri diferite, un document GetAll pus si
        // in lista principala): nu se dubleaza — ar fi un rand „neprocesat” de citit inca o data, care tine poarta. Codul lui nu are
        // rand (P = A): se re-descarca la rularile urmatoare, cat timp e listat (raportat in avertismente).
        if (decF.fel === 'frate') {
          const rude = (decF.rude || []).map((id: number) => inv.peId.get(id)).filter(Boolean);
          const shaR = await shaRanduri(rude, new Set(shas), lungimi);
          const identic = rude.find((r: any) => shas.includes(shaR.get(r.id) as string));
          if (identic) {
            raport.avertismente.push(`${doc0.nume} (${doc0.cod}): conținut identic cu #${identic.id} „${identic.nume_original}” — nu se dublează (codul nu are rând)`);
            raport.sarite_existente++;
            urcatiOcteti += brut.length;   // anti-bug 3
            i++;
            if (bugetDepasit() && i < documente.length) { continua = true; break; }
            continue;
          }
        }
        // F5 (review PR-1): „versiunea” cu EXACT continutul randului inlocuit (autoritatea a republicat documentul identic sub cod
        // nou) nu e versiune: fara upload, fara de_anuntat (fara mail fals); codul nou se MUTA pe randul inlocuit (mutaCod), ca
        // rularile urmatoare sa-l sara pe cod. Dovada ca la frate (shaRanduri: manifest, apoi Storage doar la aceeasi marime, cu
        // plafon si octetii in buget). Sha-ul inlocuitului necunoscut (necitibil) → versiune, ca inainte (anuntata).
        // D1 (review PR-1, r3): DOAR pe un inlocuit FARA nume de cod (original / adoptat / nume vechi) si fara placeholder pe N2
        // (aceleasi chei ca scrie()); altfel versiunea de mai jos, fara citiri din Storage (cu placeholder: F1, de_anuntat = false)
        // R2 (r4): cu mai multi inlocuiti posibili (frati cu acelasi nume republicati integral identic) dovada se cauta pe FIECARE
        // candidat mutabil (candidatiMutare: mutaPeIdentic + tintele deja folosite in rulare), intr-un singur shaRanduri (aceleasi
        // limite: PLAFON_CANDIDATI pe document, octetii in buget), oprita la prima potrivire; codul se muta pe ACEL rand. Un rand e
        // tinta unei singure mutari pe rulare (tinteMutare). Niciunul identic → versiune cu inlocuit = numarul cel mai mare, ca inainte.
        const phN2 = placeholders.has(cheieRand(doc.nume)) || placeholders.has(cheieRand(numeFinal));
        const deMutat: any[] = candidatiMutare(decF, phN2, tinteMutare);
        if (deMutat.length) {
          const shaC = await shaRanduri(deMutat, new Set(shas), lungimi);
          const inl = deMutat.find((r: any) => shas.includes(shaC.get(r.id) as string));
          if (inl) {
            tinteMutare.add(inl.id);
            const codVechi = String(inl.seap_cod ?? '');
            const m = await mutaCod(supa, licitatieId, inv, inl, codVechi, doc0.cod);
            if (m === 'mutat') {
              raport.coduri_mutate.push({ id: inl.id, de: codVechi, la: doc0.cod });
              raport.avertismente.push(`${doc0.nume} (${doc0.cod}): republicat identic sub cod nou — codul mutat pe #${inl.id}, fără versiune`);
            } else if (m === 'duplicat') raport.sarite_cod++;   // codul nou e deja pe alt rand (alt drum l-a adus intre timp)
            else raport.avertismente.push(`${doc0.nume} (${doc0.cod}): republicat identic cu #${inl.id}, dar codul nu s-a putut muta — ${typeof m === 'object' ? m.eroare : 'codul rândului s-a schimbat între timp'}; se reia la rularea următoare`);
            raport.sarite_existente++;
            urcatiOcteti += brut.length;   // anti-bug 3
            i++;
            if (bugetDepasit() && i < documente.length) { continua = true; break; }
            continue;
          }
        }
        // campurile de cod: doar pe randul documentului SEAP (nivelul de sus); copiii unei versiuni primesc doar aparut_ulterior
        const campuri = doc0.cod && !inv.instabile ? campuriCod(doc0.cod, decF, { esteArhiva: esteArhiva(numeFinal) }) : null;
        const planCopii = decF.fel === 'versiune' ? { aparut_ulterior: true } : null;
        const nou = (ok: boolean) => {
          if (ok && decF.fel === 'versiune') raport.versiuni_noi.push(numeFinal);
          else if (ok && decF.fel === 'frate') raport.frati.push(numeFinal);
        };

        if (eArhivaAdevarata(numeFinal, buf)) {
          // ZIP in interiorul documentului: ACEEASI despachetare si aceleasi nume ca la arhiva
          let necititeDinZip = 0, octetiZip = 0;
          const rz = await parcurgeZip(
            fluxDinBuf(buf),
            (h: { nume: string; usize: number }) => {
              const nc = eArhivaP7m(h.nume) ? h.nume : numeDesfacut(h.nume);
              if (JUNK_RE.test(h.nume)) return false;
              // „deja” se decide DUPĂ desfacere, pe sha256 (mai jos) — numele și mărimea din antet nu dovedesc conținutul
              // peste 20 MB: ZIP-ul pleaca intreg la NAS (mai jos), care aduce intrarea — nu e „sarita” (review PR-1)
              if (h.usize > PRAG_MARE) { necititeDinZip++; raport.lasate_pentru_nas.push(`${nc} (${(h.usize / 1e6).toFixed(0)}MB)`); return false; }
              if (octetiZip + h.usize > MAX_ZIP_INLINE || Date.now() - t0 > BUGET_MS) { necititeDinZip++; return false; }
              octetiZip += h.usize;
              return true;
            },
            async (h: { nume: string }, brutIntrare: Uint8Array) => {
              const r = desface(brutIntrare, h.nume);
              // același conținut dovedit → sărit; alt conținut sub un nume ocupat → prefixul ZIP-ului („Lot2/Caiet de sarcini.pdf”)
              const prefix = numeFinal.replace(/\.zip$/i, '').replace(/[\\/]+/g, '_').trim() || 'arhiva';
              const alegere = alegeNume(identitate, r.nume, prefix, await sha256Hex(r.buf));
              if ('deja' in alegere) {
                raport.sarite_existente++;
                // Jakarinos pe PR-C: legatura (ACEASTA arhiva, cale) → documentul existent, cu acelasi sha. Fara ea, daca ZIP-ul
                // ajunge intreg la NAS, fisiereDejaImportate nu gaseste dovada pentru arhiva curenta si dubleaza fisierul.
                // Alta arhiva_cheie decat dovada 'urcat' a documentului → upsert-ul nu o atinge (#646, R6).
                // Jakarinos r2/r3: la o REluare peste ACEEASI arhiva, cheia (arhiva, cale) e chiar dovada 'urcat' din prima rulare —
                // nu se suprascrie (altfel a treia rulare n-ar mai gasi sha-ul dovedit si ar urca o dublura). Doar daca dovada spune
                // ACELASI lucru (acelasi document si acelasi sha); o dovada veche pentru alt continut (ZIP-ul s-a schimbat) se inlocuieste.
                try {
                  const rand = randManifest({ licitatieId, arhivaCheie: doc.nume, cale: h.nume, marime: r.buf.length, sha256: await sha256Hex(r.buf), documentId: alegere.deja, stare: 'deja_in_platforma' });
                  const areDovada = (rr: { stare?: string; arhiva_cheie?: string; cale?: string; document_id?: number | null; sha256?: string }) =>
                    rr.stare === 'urcat' && rr.arhiva_cheie === rand.arhiva_cheie && rr.cale === rand.cale && rr.document_id === rand.document_id && rr.sha256 === rand.sha256;
                  if (!(manUrcat || []).some(areDovada) && !manifest.some(areDovada)) manifest.push(rand);
                } catch (e) { raport.avertismente.push(`manifest ${h.nume}: ${String((e as Error)?.message || e)}`); }
                return 'continua';
              }
              await urcaFisier(alegere.nume, r.buf, doc.nume, doc.nume, esteArhiva(r.nume) ? null : r.nota, h.nume, h.nume, planCopii);
              return 'continua';
            },
            (n: string, m: string) => { necititeDinZip++; raport.erori.push(`${n}: ${m}`); },
            { maxIesire: PRAG_MARE },
          );
          // audit Jakarinos #9 / #10: ZIP necitit complet (trunchiat, data descriptor, bombă, criptat, intrare prea mare, peste
          // plafonul total) → urcat ÎNTREG, „neprocesat”: îl despachetează extractorul izolat de pe NAS; fișierele urcate deja
          // aici au dovada sha în manifest, deci bucla workerului le sare și aduce doar lipsurile.
          // Review PR-C P1: dovezile se scriu ÎNAINTE de rândul ZIP-ului — bucla NAS (la 15 s) îl poate revendica imediat, iar
          // fără manifest ar re-urca toate intrările sub „X.zip (#id)/…” (dubluri); la fel dacă rularea edge moare după upload.
          if (!rz.complet || necititeDinZip) {
            raport.erori.push(`${numeCurat}: ZIP interior ${rz.complet ? `cu ${necititeDinZip} intrări necitite aici` : `incomplet (${rz.motiv})`} — urcat întreg, îl despachetează serverul NAS`);
            if (await scrieManifest()) {
              manifest.length = 0;
              await urcaFisier(numeFinal, buf, null, null, null, doc.nume, null, campuri).then(nou);
            } else {
              // dovezile nu s-au putut scrie: ZIP-ul NU pleaca la NAS (l-ar desface fara dovezi → dubluri). Randurile raman
              // in lista (se reincearca la final), iar ZIP-ul se reia la rularea urmatoare (numele lui nu e in platforma).
              nerecuperate++;
              raport.erori.push(`${numeCurat}: dovezile din manifest nu s-au putut scrie — ZIP-ul intreg NU s-a urcat (s-ar dubla la NAS), se reia la rularea urmatoare`);
            }
          } else if (strict) {
            // audit #4 var. B: ZIP-ul unei VERSIUNI / al unui FRATE, desfacut complet aici, se urca si INTREG, cu codul — altfel codul
            // n-ar sta nicaieri (un ZIP desfacut n-are rand), versiunea s-ar re-descarca la fiecare rulare, iar veghea ar pune pe
            // numele ei un placeholder fals „nu a putut fi adus”. Dovezile copiilor se scriu INAINTE (ca mai sus): bucla NAS ii sare.
            if (await scrieManifest()) {
              manifest.length = 0;
              await urcaFisier(numeFinal, buf, null, null, null, doc.nume, null, campuri).then(nou);
            } else {
              nerecuperate++;
              raport.erori.push(`${numeCurat}: dovezile din manifest nu s-au putut scrie — ZIP-ul versiunii NU s-a urcat întreg, se reia la rularea urmatoare`);
            }
          }
        } else {
          // o arhiva nedesfacuta urca bruta, „neprocesat”: workerul NAS incearca desfacerea si scrie eroarea vizibil
          await urcaFisier(numeFinal, buf, null, null, esteArhiva(numeFinal) ? null : ds.nota, doc.nume, null, campuri).then(nou);
        }
      } catch (e) {
        raport.erori.push(`${numeCurat}: ${String((e as Error)?.message || e)}`);
        esec();
      }
      i++;
      if (bugetDepasit() && i < documente.length) { continua = true; break; }
    }
    index = i;
  }

  // -- CALEA VECHE, REZERVA: arhiva intreaga (DownloadArchive) --------------------
  // Se incearca doar daca lista a esuat / a venit goala / un document nu s-a putut aduce.
  const cerutaArhiva = !continua && (!perFisierOk || !!motivRezerva);
  // E6 (r5): pornit doar pentru versiuni (fara_rezerva_arhiva) → rezerva NU porneste: o spune raportul, iar rularea nu se declara
  // „adusa” (ce a cazut ramane lipsa); rularea programata urmatoare reia drumul per fisier
  const nevoieDeArhiva = cerutaArhiva && !faraRezervaArhiva;
  if (cerutaArhiva && faraRezervaArhiva) {
    raport.rezerva_arhiva_sarita = motivRezerva || 'lista indisponibila';
    nerecuperate++;
    raport.erori.push(`rezerva arhiva SARITA (fara_rezerva_arhiva: import pornit doar pentru versiuni — DownloadArchive merge pe nume si nu poate aduce „N (COD).ext”): ${raport.rezerva_arhiva_sarita}`);
  }
  let arhivaIncompleta = false;
  const lasateArhiva = new Set<string>();   // cheile intrarilor lasate pe seama /api/seap-import (peste PRAG_MARE)
  // dovezile ZIP-urilor desfacute inline se scriu INAINTE ca rezerva sa urce arhive intregi (bucla NAS le-ar putea revendica
  // in timpul rularii, fara dovezi → dubluri). Dovezi nescrise → rezerva se AMANA (Jakarinos r2 pe #651): randurile raman in
  // lista (se reincearca la final), rularea nu se declara „adusa”, iar rularea urmatoare reia rezerva.
  const doveziScrise = !nevoieDeArhiva || await scrieManifest();
  if (nevoieDeArhiva && doveziScrise) manifest.length = 0;
  if (nevoieDeArhiva && !doveziScrise) {
    nerecuperate++;
    raport.erori.push('rezerva arhiva AMANATA: dovezile din manifest nu s-au putut scrie (arhivele intregi s-ar dubla la NAS) — se reia la rularea urmatoare');
  }
  // E5 (r5): arhiva se parcurge MEREU de la prima intrare — de la R3 un de_la_index primit e o pozitie in lista SEAP, niciodata
  // in ZIP (next_index pe arhiva e 0); dedup-ul pe nume / sha sare ce e deja in platforma. `index` numara intrarile ZIP-ului.
  if (nevoieDeArhiva && doveziScrise) {
    if (!perFisierOk) { raport.metoda = 'arhiva'; index = 0; }
    raport.rezerva_arhiva = true;
    raport.erori.push(`rezerva arhiva: ${motivRezerva || 'lista indisponibila'}`);

    const url = `${SEAP}/NoticeCommon/DownloadArchive/?${qs}`;
    let res: Response | null = null;
    // E3: doar cererea initiala se reincearca (fluxul ZIP de dupa nu se reia)
    try { res = await fetchSeap(url, { headers: SEAP_HDR }, pesteBuget); } catch (e) { raport.erori.push('arhiva: ' + String((e as Error)?.message || e)); }
    if (!res || !res.ok || !res.body) {
      if (!perFisierOk) return json({ ...raport, error: `SEAP HTTP ${res?.status ?? 'fetch esuat'}` }, 502);
      raport.erori.push(`arhiva: HTTP ${res?.status ?? 'fetch esuat'}`);
    } else {
      const flux = new Flux(res.body.getReader());
      let iArh = 0;
      try {
        const rz = await parcurgeZip(
          flux,
          (h: { nume: string; usize: number }) => {
            const numeCurat = eArhivaP7m(h.nume) ? h.nume : numeDesfacut(h.nume);
            const preaMare = h.usize > PRAG_MARE;
            const sarim = dejaSubUnNume(urcate, h.nume) || JUNK_RE.test(h.nume) || preaMare;
            if (sarim) {
              if (dejaSubUnNume(urcate, h.nume)) raport.sarite_existente++;
              else if (preaMare) { raport.lasate_pentru_vercel.push(`${numeCurat} (${(h.usize / 1e6).toFixed(0)}MB)`); lasateArhiva.add(cheieRand(h.nume)).add(cheieNume(h.nume)); }
              iArh++;
              return false;
            }
            return true;
          },
          async (h: { nume: string }, brut: Uint8Array) => {
            const r = desface(brut, h.nume);
            await urcaFisier(r.nume, r.buf, 'seap:downloadarchive', null, esteArhiva(r.nume) ? null : r.nota, h.nume);
            iArh++;
            if (bugetDepasit()) { continua = true; return 'stop'; }
            return 'continua';
          },
          (n: string, m: string) => { nerecuperate++; raport.erori.push(`${numeDesfacut(n)}: ${m}`); },
          { maxIesire: PRAG_MARE },
        );
        // audit Jakarinos #9: arhiva necitită până la directorul central NU e „adusă” (documentele de după s-ar pierde tăcut)
        if (!rz.complet) { arhivaIncompleta = true; raport.erori.push(`arhiva: ${rz.motiv}`); }
      } catch (e) {
        arhivaIncompleta = true;
        raport.erori.push('flux: ' + String((e as Error)?.message || e));
      } finally {
        try { await res.body?.cancel(); } catch (_) { /* deja inchis */ }
      }
      if (!perFisierOk) index = iArh;
    }
  }

  // audit #4 (alaturat): un document fara cod / nou, cazut pe drumul per fisier si neadus nici de rezerva (arhiva indisponibila,
  // amanata sau incompleta) lipseste — inainte se pierdea tacut, iar licitatia era declarata „adusa”
  if (!continua) {
    for (const n of esuatePerFisier) {
      if (cheiSeapCu(n, cheieNume).some((k: string) => urcate.has(k) || lasateArhiva.has(k))) continue;
      nerecuperate++;
      raport.erori.push(`${numeDesfacut(n)}: căzut pe drumul per fișier și neadus nici de rezerva arhivă`);
    }
  }

  await scrieManifest();
  if (!continua) {
    // „adusa” o declara doar o trecere COMPLETA (de la indexul 0, fara continuari) fara lipsuri — o continuare (de_la_index > 0)
    // nu stie de esecurile apelurilor dinainte (Jakarinos r3 pe #651); o rulare ulterioara completa o seteaza cand nu mai lipseste nimic
    if (deLaIndex === 0 && !arhivaIncompleta && !nerecuperate) await supa.from('ofertare_licitatii').update({ documentatie_adusa_la: new Date().toISOString() }).eq('id', licitatieId);
    raport.orfani_stersi = await curataOrfani(supa, licitatieId);
  }
  raport.index = index;
  // R3 (review PR-1, r4): pe rezerva arhiva (si pe metoda 'arhiva') pozitia de continuare numara intrarile ZIP-ului, nu lista SEAP —
  // trimisa ca de_la_index, apelul urmator ar sari documente din lista per fisier (veghea si lantul „Adu din SEAP” din UI fac
  // deLa = next_index). Continuarea porneste atunci de la 0: ce e deja in platforma se sare pe cod / nume.
  const peArhiva = raport.rezerva_arhiva || raport.metoda === 'arhiva';
  return json({ ...raport, continua, next_index: continua ? (peArhiva ? 0 : index) : null });
});
