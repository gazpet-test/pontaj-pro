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
//   b) fisierul e container CMS/PKCS#7 (.p7s / .p7m) - se desface cu desface din ../_shared/semnaturaCms.mjs
//      (aceeasi regula in import, worker, api; var. B 07.10.2026: „X.pdf.p7m” → „X (semnat).pdf”).
// O singura cerere GetAll per licitatie per rulare: SEAP blocheaza IP-ul la trafic automat.
// Citirea AI NU porneste automat (costa) - documentele apar in "Documente noi din SEAP" si in
// ecranul Clarificari, cu buton manual.
//
// v10 (08.10.2026, audit motor import #4 var. B): si in LISTA PRINCIPALA identitatea e codul SEAP, nu numele (regulile in
//   ../_shared/codSeap.mjs). Veghea doar DECIDE pe cod (nu scrie coduri): o republicare sub acelasi nume cu cod nou (versiune,
//   numele distinct „N (COD).ext”) e treaba IMPORTULUI pe drumul principal si se anunta ca modificare a documentatiei, cu mail
//   (decizia M = A), DOAR dupa ce a fost importata (R1, mai jos); adoptiile de cod, fratii si verificarile pe continut pornesc
//   importul in tacere (le rezolva ofertare-seap-import).
//   Review PR-1 (08.10): (1) importurile TACUTE ruleaza intr-o a doua trecere, DUPA toate anunturile si mailurile (termenul si
//   raspunsurile GetAll se scriu inainte — o oprire a functiei in timpul unui import nu le mai pierde anuntul), cu buget de timp;
//   (2) rundele de import isi trec de_la_index (un document care nu converge nu mai opreste toate rundele in acelasi loc);
//   (3) o versiune adusa de ORICINE (UI, workerul NAS) poarta seap_meta.de_anuntat — veghea o anunta + mail si pune false
//   (singura scriere noua a veghei); (4) un JWT de utilizator cere acces la modulul Ofertare (poarta comuna, ca importul):
//   veghea citeste continut extern (SEAP) si scrie / trimite mail (CLAUDE.md pct. 7d).
//   Review PR-1, runda 2 (08.10): (5) a doua trecere (importurile tacute) ruleaza DOAR la rularea programata (fara licitatie_id
//   in body): „Verifica acum” din UI ramane rapida, iar „Adu din SEAP” face importul singur. Limita acceptata: intr-o rulare a
//   carei bucla principala depaseste BUGET_TACUT_MS, treaba tacuta asteapta rularea urmatoare — licitatiile amanate apar in
//   raspuns la `tacute_amanate` (azi 7 licitatii active); (6) rundele de import trec next_index mai departe doar de la o runda
//   'per-fisier', iar pe a doua trecere o runda pornita de la de_la_index > 0 e urmata de O runda de la 0 (reincercari, rezerva
//   arhiva, documentatie_adusa_la). Runda 3 (D3): next_index nici de la o runda cu rezerva_arhiva.
//   Runda 4 (R1, cauza radacina): o versiune se anunta DOAR dupa ce a fost efectiv importata. Decizia 'versiune' NU mai intra in
//   `noi` si NU primeste placeholder: e treaba importului pe drumul principal (treapta 1 ruleaza cand exista documente noi SAU
//   versiuni), iar anuntul vine numai din randul importat (seap_meta.de_anuntat = true → avertisment + mail, apoi false), in
//   aceeasi rulare. Treapta Vercel ramane doar pentru `noi` reale (merge pe nume, nu poate aduce „N (COD).ext”). Au disparut
//   filtrul „versiuni identice” (F5/D2 de dinainte: nimic nu se mai anunta inainte de import) si indicatia „urca-l sub numele
//   EXACT, cu codul SEAP in paranteza”. GOL ACCEPTAT: o versiune pe care importul n-o poate aduce (ex. peste 20 MB pe o
//   licitatie fara GO) NU se anunta inca — ramane in raport (coduri.versiuni + coduri.import_erori) si se reia la rularea
//   urmatoare (veghea decide iar 'versiune' si porneste importul); o aduce ulterior workerul NAS (PR-2) sau omul, manual.
//   R4: runda finala de la 0 doar pe a doua trecere (cuBuget, in buget) — pe drumul principal niciodata.
//   Runda 5 (E2): anuntul unei versiuni se confirma PE CANAL (seap_meta.notificat_la / mail_la); de_anuntat = false doar cu
//   amandoua, iar rularea urmatoare reia doar canalul cazut. E4: un lant al drumului principal oprit de la de > 0 primeste O runda
//   de la 0 pe a doua trecere (coduri.import_de_la_0). E6: importul pornit doar pentru versiuni merge cu fara_rezerva_arhiva.
//   Raportul spune si versiuni_anuntate (butonul „Verifica SEAP acum” din UI, E7).
//   Jakarinos r4: rulari simultane (cron + „Verifica acum”) — anuntul unei versiuni il da doar rularea care a revendicat-o atomic
//   (seap_meta.revendicare / revendicat_pana, expira in 10 min), confirmarea trece doar cu revendicarea inca a ei; mailul poarta
//   Idempotency-Key (amprenta continutului), clopotelul versiunilor nu se repeta cu acelasi continut in 24 h (versiuni_in_lucru).
//   Jakarinos r5 + r6: o livrare are UN rand-ancora (grupul de reluat, altfel versiunea cu id-ul cel mai mic); pe el stau
//   revendicarea si seap_meta.grup (continutul exact + ce a plecat), scris INAINTE de trimitere. Reluarea o face doar cine
//   revendica ancora, cu acelasi continut; ancora se confirma ultima si isi sterge grupul doar cand toate canalele au plecat si toti
//   membrii sunt confirmati (reluari in raport).
//
// notifications.modul are CHECK pe lista fixa de module - pentru ofertare valoarea
// corecta e 'Comercial'. Cu 'ofertare' insertul pica silentios.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { termenRO } from '../_shared/oraRO.ts'
import { desfaceFaraArhiveP7m as desface, eArhivaP7m, numeDesfacut, cheieRand as cheieRandCu, cheiSeap as cheiSeapCu } from '../_shared/semnaturaCms.mjs'
import { esteArhiva } from '../_shared/tipDocument.mjs'
import { toatePaginile } from '../_shared/paginat.mjs'
import { tipRaspuns } from './tip.ts'
import { codDin, inventarCod, indexLista, coduriInstabile, decideSeap, verificabil, copiiDinManifest, ADOPTIE } from '../_shared/codSeap.mjs'
import { shaDovedit } from '../_shared/identitateFisier.mjs'
import { poartaOfertare } from '../_shared/poartaOfertare.ts'
// inventarul unei licitații pe pagini (audit Jakarinos #21) — o listă trunchiată ar face placeholder-e fantomă
const inventar = (supa: any, licId: number, col: string) => toatePaginile((de: number, la: number) =>
  supa.from('ofertare_documente_atribuire').select(col).eq('licitatie_id', licId).order('id').range(de, la));

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
// a doua trecere (importurile tacute): un apel de import poate tine pana la ~240 s, iar platforma opreste functia pe la ~400 s —
// dupa acest prag nu se mai porneste niciunul (raman pentru rularea urmatoare; nimic de anuntat nu se pierde, anunturile s-au dat)
const BUGET_TACUT_MS = 150000;

// Jakarinos r4 (P1): cronul si „Verifica acum” pot rula SIMULTAN pe aceeasi licitatie — ambele vedeau aceeasi versiune restanta
// si o anuntau amandoua (2 notificari + 2 mailuri). Acum anuntul unei versiuni il da DOAR rularea care a REVENDICAT-o: un UPDATE
// conditionat pe rand (de_anuntat inca true, canalele exact cum le-a citit rularea, nicio revendicare vie) = o singura instructiune,
// deci din doua rulari simultane castiga una. Revendicarea expira dupa REVENDICARE_MS (peste durata maxima a unei rulari, ~400 s):
// o rulare oprita intre revendicare si confirmare nu blocheaza anuntul — il reia prima rulare de dupa expirare. Confirmarea
// canalelor se scrie doar cat revendicarea e inca a acestei rulari si o elibereaza (si cand niciun canal n-a reusit).
const REVENDICARE_MS = 10 * 60 * 1000;
async function revendicaAnunt(supa: any, d: any, token: string): Promise<{ meta?: Record<string, unknown>; eroare?: string }> {
  const m0 = d.seap_meta || {}, acum = Date.now();
  const meta = { ...m0, revendicare: token, revendicat_pana: acum + REVENDICARE_MS };
  let q = supa.from('ofertare_documente_atribuire').update({ seap_meta: meta }).eq('id', d.id).eq('seap_meta->>de_anuntat', 'true');
  for (const c of ['notificat_la', 'mail_la']) q = m0[c] ? q.eq(`seap_meta->>${c}`, String(m0[c])) : q.is(`seap_meta->>${c}`, null);
  // revendicat_pana = milisecunde (13 cifre): comparatia text a lui ->> are aceeasi ordine ca cea numerica
  const { data, error } = await q.or(`seap_meta->>revendicat_pana.is.null,seap_meta->>revendicat_pana.lt.${acum}`).select('id');
  if (error) return { eroare: error.message };
  return Array.isArray(data) && data.length === 1 ? { meta } : {};
}
async function confirmaAnunt(supa: any, d: any, token: string, meta: Record<string, unknown>): Promise<string | null> {
  const fin: Record<string, unknown> = { ...meta };
  delete fin.revendicare; delete fin.revendicat_pana;
  const { data, error } = await supa.from('ofertare_documente_atribuire').update({ seap_meta: fin })
    .eq('id', d.id).eq('seap_meta->>revendicare', token).select('id');
  if (error) return error.message;
  return Array.isArray(data) && data.length === 1 ? null : 'revendicarea a expirat si a preluat-o alta rulare - canalele de acum nu s-au confirmat';
}
// Jakarinos r5 + r6 (P1): GRUPUL livrarii. Un anunt de versiuni are UN SINGUR rand-ancora (versiunea cu id-ul cel mai mic, sau
// randul care poarta deja un grup); pe el stau revendicarea si seap_meta.grup = { id, la, membri, notif (text + destinatari + ids),
// mail (corp + cheie + complet + ids), trimis } — scris INAINTE de orice trimitere, intr-o singura scriere. Reluarea (dupa o oprire)
// o poate face doar cine revendica ancora, si trimite ACELASI continut. 20 h < fereastra de 24 h a cheii Resend si a verificarii
// clopotelului pe continut.
const GRUP_VALABIL_MS = 20 * 3600 * 1000;
const grupValid = (g: any, acumMs: number) => !!g && typeof g.id === 'string' && Array.isArray(g.membri) && Number(g.la) > acumMs - GRUP_VALABIL_MS;
// revendicarea ancorei care poarta un grup: conditia = ACELASI grup + nicio revendicare vie (de_anuntat poate fi deja false)
async function revendicaGrup(supa: any, d: any, token: string): Promise<{ meta?: Record<string, unknown>; eroare?: string }> {
  const m0 = d.seap_meta || {}, acum = Date.now();
  const meta = { ...m0, revendicare: token, revendicat_pana: acum + REVENDICARE_MS };
  const { data, error } = await supa.from('ofertare_documente_atribuire').update({ seap_meta: meta })
    .eq('id', d.id).eq('seap_meta->grup->>id', String(m0.grup?.id))
    .or(`seap_meta->>revendicat_pana.is.null,seap_meta->>revendicat_pana.lt.${acum}`).select('id');
  if (error) return { eroare: error.message };
  return Array.isArray(data) && data.length === 1 ? { meta } : {};
}
// grupul (sau starea lui „trimis”) pe ancora, doar cat revendicarea e a acestei rulari
async function scrieGrup(supa: any, d: any, token: string, grup: unknown): Promise<string | null> {
  const meta = { ...(d.seap_meta || {}), grup };
  const { data, error } = await supa.from('ofertare_documente_atribuire').update({ seap_meta: meta })
    .eq('id', d.id).eq('seap_meta->>revendicare', token).select('id');
  if (error) return error.message;
  if (!(Array.isArray(data) && data.length === 1)) return 'revendicarea nu mai e a acestei rulari';
  d.seap_meta = meta;
  return null;
}
// clopotelul unui mesaj: un singur INSERT cu toti destinatarii (totul sau nimic — Jakarinos r2); cu `faraRepetare`, cei care au
// deja ACELASI mesaj (titlu + text, ultimele 24 h) sunt sariti (r4: tabelul notifications n-are cheie de idempotenta — continutul
// e identitatea). Jakarinos r7 (P1): verificarea necitita = EROARE, fara INSERT — canalul ramane netrimis pe grup si se reia
// identic (nimic pierdut), in loc sa trimita lotul intreg si sa dubleze clopotelul celor care il au. Intoarce eroarea sau null.
async function clopotel(supa: any, catre: string[], m: { type: string; title: string; message: string }, faraRepetare: boolean): Promise<string | null> {
  let lot = [...catre];
  if (faraRepetare && lot.length) {
    const { data: deja, error: eD } = await supa.from('notifications').select('profile_id').in('profile_id', lot)
      .eq('title', m.title).eq('message', m.message).gte('created_at', new Date(Date.now() - 864e5).toISOString());
    if (eD) return `verificarea clopotelului: ${eD.message}`;
    const au = new Set((deja || []).map((x: any) => x.profile_id));
    lot = lot.filter((pid) => !au.has(pid));
  }
  if (!lot.length) return null;
  const { error } = await supa.from('notifications').insert(lot.map((pid) => ({
    profile_id: pid, type: m.type, modul: 'Comercial',
    title: m.title, message: m.message, link_to: '/ofertare',
  })));
  return error ? error.message : null;
}
// mailul prin Resend, cu Idempotency-Key (acelasi corp + aceeasi cheie in 24 h = acelasi raspuns, fara al doilea mail)
async function trimiteMail(corp: string, cheie: string): Promise<{ ok: boolean; text: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: true, text: 'sarit: lipseste RESEND_API_KEY' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': cheie },
      body: corp,
    });
    return { ok: r.ok, text: r.ok ? 'trimis' : `esuat HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, text: 'esuat: ' + String((e as Error)?.message || e) };
  }
}
const sha256Hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

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

// -- Desfacerea semnaturii electronice: ../_shared/semnaturaCms.mjs ---------------
// Un document SEAP („X.pdf.p7m”) poate sta in platforma sub numele SEAP (brut, inainte de var. B) sau desfacut
// („X (semnat).pdf”): orice comparatie „e deja / a intrat” se face pe AMBELE nume, altfel veghea pune placeholder-e fantoma.
// Randurile se cheiaza cu cheieRand: unul ramas cu semnatura BRUTA („X.pdf.p7s” detasata / nedesfacuta) nu e „X.pdf”
// (Copilot NO-GO r1 pe #649); numele SEAP se cauta pe toate cheile lui (cheiSeap). Numele SEAP pastreaza aici sufixul .p7s.
const cheieRand = (n: unknown) => cheieRandCu(String(n ?? ''), cheieNume);
const cheiSeap = (n: unknown) => cheiSeapCu(String(n ?? ''), cheieNume) as string[];
const areNume = (chei: Set<string> | Map<string, unknown>, numeSeap: string) => cheiSeap(numeSeap).some((k) => chei.has(k));
// afisare / placeholder: fara .p7s (ca pana acum); „.p7m” ramane — e chiar numele fisierului din SEAP
const afis = (n: string) => String(n ?? '').replace(/\.p7s$/i, '');

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
  // r4: identitatea rularii pentru revendicarea anunturilor de versiune (vezi revendicaAnunt)
  const tokenRulare = crypto.randomUUID();

  const antet = req.headers.get('x-veghe-secret');
  let cuSecret = false;
  if (antet) {
    const { data: ok } = await supa.rpc('fn_verifica_secret', { p_nume: 'SEAP_VEGHE_SECRET', p_secret: antet });
    cuSecret = ok === true;
  }
  if (!cuSecret) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);
    // review PR-1 (CLAUDE.md pct. 7d): un JWT valid NU ajunge — veghea lucreaza cu service_role, citeste SEAP, scrie randuri,
    // porneste importul (adoptii de cod, versiuni) si trimite mail. Ca la import (./acces.ts): acces la modulul Ofertare.
    if (jwt !== SERVICE) {
      const refuz = await poartaOfertare(req);
      if (refuz) return refuz;
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* gol */ }
  const t0 = Date.now();
  // importul rapid din Supabase; rundele isi trec de_la_index (review PR-1: altfel un document care nu converge — o verificare
  // fara potrivire, o versiune peste 20 MB — oprea toate cele 4 runde in acelasi loc, iar ce era dupa el nu se mai aducea).
  // F2/F4 (review PR-1): next_index se trece mai departe DOAR de la o runda 'per-fisier' — pe rezerva 'arhiva' e pozitia in ZIP,
  // nu in lista SEAP (de la 0). O runda pornita de la de_la_index > 0 nu stie de esecurile rundelor de dinainte: nu reincearca
  // documentele cazute acolo, nu porneste rezerva DownloadArchive pentru ele si nu poate pune documentatie_adusa_la. De aceea,
  // pe a doua trecere, cand o astfel de runda termina (!continua), urmeaza O SINGURA runda de la 0, daca mai sunt runde — ieftina:
  // codurile si numele cunoscute se sar inainte de descarcare — apoi stop (fara alt lant, oricum ar raspunde).
  // D3 (r3): nici de la un raspuns 'per-fisier' cu rezerva_arhiva — next_index e atunci capatul listei per fisier (deja parcursa),
  // iar continuarea e in ZIP: de acolo rezerva nu mai porneste (fara esecuri per fisier), continuarea s-ar pierde → de la 0.
  // (Importul insusi intoarce acum next_index = 0 pe rezerva / metoda arhiva — R3; regula de aici ramane, compatibila.)
  // R4 (r4): runda finala de la 0 DOAR pe a doua trecere (cuBuget = true; bugetul il verifica capul buclei) — pe drumul principal
  // (cuBuget = false) niciodata: ea poate porni rezerva DownloadArchive (minute) INAINTE de anunturile acestei licitatii.
  // E4 (r5): pe drumul principal, un lant terminat de la de > 0 (fara runda de la 0, R4) pune licitatia O DATA in a doua trecere,
  // pentru O SINGURA runda de la 0 (rularea programata, in buget) — reincercarile, rezerva si documentatie_adusa_la nu se pierd.
  // cuBuget: importurile tacute (a doua trecere) nu pornesc dupa BUGET_TACUT_MS.
  // erori (R1): erorile raportate de import (fara dubluri intre runde, plafonate) — o versiune neadusa ramane vizibila in raport.
  // optiuni (E6): campuri in plus in corpul importului (ex. fara_rezerva_arhiva); runde: plafonul rundelor (E4: 1).
  const deLa0 = new Set<number>();
  const importa = async (licId: number, cuBuget: boolean, erori: string[] | null = null, optiuni: Record<string, unknown> = {}, runde = RUNDE_IMPORT): Promise<string> => {
    let de = 0, reluare = false;
    for (let i = 0; i < runde; i++) {
      if (cuBuget && Date.now() - t0 > BUGET_TACUT_MS) return `amanat (bugetul de timp al veghei), dupa ${i} runde`;
      try {
        const r = await fetch(`${SUPA_URL}/functions/v1/ofertare-seap-import`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ licitatie_id: licId, de_la_index: de, ...optiuni }),
        });
        const rez = await r.json().catch(() => ({}));
        if (erori) {
          for (const e of [...(Array.isArray(rez?.erori) ? rez.erori : []), ...(rez?.error ? [rez.error] : [])].map(String)) {
            if (erori.length < 20 && !erori.includes(e)) erori.push(e);
          }
        }
        if (reluare) return `${i + 1} runde (ultima de la 0${rez?.continua ? ', ramas de continuat' : ''})`;
        if (!rez?.continua) {
          const finala = de > 0 && i + 1 < runde;
          if (finala && cuBuget) { de = 0; reluare = true; continue; }
          if (de > 0 && !cuBuget) deLa0.add(licId);   // E4: runda de la 0 o face a doua trecere
          return `${i + 1} runde${finala ? ' (fara runda finala de la 0: drumul principal)' : ''}`;
        }
        if (rez?.metoda === 'per-fisier' && !rez?.rezerva_arhiva) de = Number(rez.next_index) || 0;
        else de = 0;
      } catch (e) { return 'eroare: ' + String((e as Error)?.message || e); }
    }
    return `${runde} runde, ramas de continuat`;
  };
  // licitatiile cu doar treaba TACUTA (adoptii de cod, frati, verificari pe continut; versiunile NU — R1): importul lor ruleaza DUPA
  // toate anunturile (a doua trecere, mai jos) — nu mai sta intre scrierile deja facute (termen, GetAll) si anuntul lor.
  // camp = unde se scrie rezultatul in coduri: 'import' (treaba tacuta) sau 'import_de_la_0' (E4: runda de la 0 a drumului principal,
  // cu aceleasi optiuni si runde = 1 — coduri.import pastreaza lantul drumului principal)
  const tacute: { id: number; coduri: any; camp: 'import' | 'import_de_la_0'; runde?: number; optiuni?: Record<string, unknown> }[] = [];

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
  // O cerere pe pagina de 50 (de regula una singura pe licitatie pe rulare). Nu arunca niciodata: erorile se raporteaza.
  // Audit Jakarinos #17 (07.10.2026): se citea DOAR pagina 0 — un anunt cu peste 50 de documente pierdea tacut restul. Acum
  // paginile se citesc pana la una incompleta (plafon PAGINI_GETALL); peste plafon = eroare vizibila, „enumerare incompleta”.
  // Fiecare pagina are cookie-urile ei (tokenul de fisier e legat de sesiunea care l-a emis) — perechea ramane legata.
  const PAGINA_GETALL = 50, PAGINI_GETALL = 10;
  async function raspunsuriNotice(lic: any): Promise<{ adusi: string[]; eroare: string | null }> {
    const adusi: string[] = [];
    const lista: { it: any; cookie: string }[] = [];
    const chei = new Set<string>();
    let total: number | null = null;
    let incompleta: string | null = null;
    try {
      for (let pagina = 0; ; pagina++) {
        if (pagina >= PAGINI_GETALL) { incompleta = `enumerare incompleta: peste ${PAGINI_GETALL * PAGINA_GETALL} documente in GetAll`; break; }
        const r = await fetchSeap(`${SEAP}/NoticeDocument/GetAll/`, {
          method: 'POST',
          headers: { ...SEAP_HDR, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sortProperty: 'transmissionDate', pageSize: PAGINA_GETALL, pageIndex: pagina,
            initNoticeId: String(lic.c_notice_id), sysNoticeTypeId: String(lic.sys_notice_type_id),
            procedureId: null, sysNoticeDocumentState: null, sysNoticeDocumentType: null,
            sysValidationDocType: null, noticeDocumentPostDateFrom: null, noticeDocumentPostDateTo: null,
            sortProperties: null, sadId: null,
          }),
        });
        if (!r.ok) {
          if (!pagina) return { adusi, eroare: `GetAll HTTP ${r.status}` };
          incompleta = `enumerare incompleta: GetAll pagina ${pagina} HTTP ${r.status}`; break;
        }
        const cookie = cookieDin(r);
        const txt = await r.text();
        let d: any = null;
        try { d = JSON.parse(txt); } catch (_) {
          if (!pagina) return { adusi, eroare: 'GetAll: raspuns non-JSON' };
          incompleta = `enumerare incompleta: GetAll pagina ${pagina} non-JSON`; break;
        }
        const items = Array.isArray(d?.items) ? d.items : [];
        // review PR-C P2: dublurile dintre pagini (sortare instabilă pe transmissionDate, publicări între cereri) nu umflă
        // numărătoarea — un document se ține o dată, după cod (sau nume + url, fără cod)
        for (const it of items) {
          const k = String(it?.noticeDocumentCode || '') || `${it?.documentName || it?.noticeDocumentName || ''}|${it?.noticeDocumentUrl || ''}`;
          if (chei.has(k)) continue;
          chei.add(k);
          lista.push({ it, cookie });
        }
        // `total` contează doar dacă e un număr pozitiv: Number(null) / Number('') = 0 ar opri citirea după prima pagină
        if (d?.total != null && Number(d.total) > 0) total = Number(d.total);
        if (items.length < PAGINA_GETALL || (total != null && lista.length >= total)) break;
      }
      if (!incompleta && total != null && lista.length < total) incompleta = `enumerare incompleta: ${lista.length} din ${total} documente in GetAll`;
    } catch (e) {
      if (!lista.length) return { adusi, eroare: 'GetAll: ' + String((e as Error)?.message || e) };
      incompleta = 'enumerare incompleta: ' + String((e as Error)?.message || e);
    }
    if (!lista.length) return { adusi, eroare: incompleta };

    const { data: aveamDeja, error: eInv } = await inventar(supa, lic.id, 'nume_original, tip, seap_cod');
    if (eInv) return { adusi, eroare: `inventarul documentelor nu s-a putut citi: ${eInv.message}` };
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
      (aveamDeja || []).map((d: any) => [cheieRand(d.nume_original), d]),
    );
    const erori: string[] = [];

    for (const { it, cookie } of lista) {
      const cod = String(it?.noticeDocumentCode || '');
      const brutNume = String(it?.documentName || it?.noticeDocumentName || '');
      // arhiva .p7m ramane intreaga, cu numele SEAP: o desface workerul NAS (#644; Jakarinos #7 pe #649)
      const fisier = eArhivaP7m(brutNume) ? brutNume : numeDesfacut(brutNume);
      const titlu = String(it?.noticeDocumentName || '').trim();
      if (!fisier) continue;
      // idempotent (ruleaza de 2x/zi): codul e cheia. Fara cod, cadem pe vechea regula.
      if (cod ? coduriCunoscute.has(cod) : areNume(numeCunoscute, brutNume)) continue;
      // Republicare: acelasi nume de fisier ca un document pe care deja il avem => e o
      // VERSIUNE NOUA a lui. Se aduce oricum, sub un nume care o deosebeste, si mosteneste
      // tipul documentului inlocuit (un caiet de sarcini revizuit ramane caiet de sarcini,
      // nu devine „raspuns la clarificari" - altfel iese din motorul de acoperire).
      const inlocuit = numeCunoscute.get(cheieRand(fisier)) ?? numeCunoscute.get(cheieRand(brutNume));
      let nume = inlocuit && titlu && titlu !== fisier ? `${titlu} — ${fisier}` : fisier;
      const url = String(it?.noticeDocumentUrl || '');
      if (!url) { erori.push(`${nume}: fara noticeDocumentUrl`); continue; }
      try {
        // tokenul e temporar SI legat de sesiune -> trimitem inapoi cookie-urile de la GetAll
        const rd = await fetchSeap(url.startsWith('http') ? url : `https://e-licitatie.ro/${url.replace(/^\/+/, '')}`, {
          headers: cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR,
        });
        if (!rd.ok) { erori.push(`${nume}: descarcare HTTP ${rd.status}`); continue; }
        const brut = new Uint8Array(await rd.arrayBuffer());
        if (!brut.length) { erori.push(`${nume}: fisier gol`); continue; }
        // audit Jakarinos #20: desfacere esuata = numele ramane cu sufixul (nu „X.pdf” cu CMS brut). Un DOCUMENT nedesfacut
        // intra „ignorat”, cu nota; o ARHIVA nedesfacuta intra „neprocesat”, fara nota — workerul NAS incearca si scrie eroarea.
        const ds = desface(brut, brutNume);
        const buf = ds.buf;
        if (ds.nume !== fisier) nume = inlocuit && titlu && titlu !== ds.nume ? `${titlu} — ${ds.nume}` : ds.nume;
        const notaSemn = ds.nota && !esteArhiva(ds.nume) ? ds.nota : null;
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
          tip: tipRaspuns(ds.nume, inlocuit?.tip, eRaspunsSeap(it)),
          sursa: 'seap', aparut_ulterior: true, status_procesare: notaSemn ? 'ignorat' : 'neprocesat',
          ...(notaSemn ? { eroare: notaSemn } : {}),
          size_bytes: buf.length,
          seap_cod: cod || null,
          // metadatele descriptive stau separat de `antet`, ca sa nu se bata cu citirea AI
          seap_meta: { titlu: titlu || null, publicat: it?.publicationDate || null,
                       inlocuieste: inlocuit ? inlocuit.nume_original : null },
        });
        if (eIns) { erori.push(`${nume}: insert ${eIns.message}`); continue; }
        if (cod) coduriCunoscute.add(cod);
        numeCunoscute.set(cheieRand(nume), { nume_original: nume, tip: inlocuit?.tip });
        adusi.push(inlocuit ? `${nume} (INLOCUIESTE versiunea veche)` : nume);
      } catch (e) {
        erori.push(`${nume}: ${String((e as Error)?.message || e)}`);
      }
    }
    if (incompleta) erori.push(incompleta);
    return { adusi, eroare: erori.length ? erori.join(' | ') : null };
  }

  for (const lic of licitatii || []) {
    const qs = `initNoticeId=${lic.c_notice_id}&sysNoticeTypeId=${lic.sys_notice_type_id}`;
    const laSeap: { nume: string; cod: string }[] = [];   // cod = noticeDocumentCode (audit #4 var. B)
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
          const n = String(f?.noticeDocumentName || '');   // numele SEAP brut: areNume cauta desfacut, „X (semnat).pdf” si randul brut
          if (n) laSeap.push({ nume: n, cod: codDin(f) });
        }
      }
    } catch (e) {
      raport.push({ licitatie: lic.nr_anunt, eroare: String((e as Error)?.message || e) });
      continue;
    }

    const { data: aveam, error: eAveam } = await inventar(supa, lic.id, 'id, nume_original, fisier_path, seap_cod, size_bytes, seap_meta');
    if (eAveam) { raport.push({ licitatie: lic.nr_anunt, eroare: `inventar: ${eAveam.message}` }); continue; }
    const cunoscute = new Set((aveam || []).map((d: any) => cheieRand(d.nume_original)));
    // audit #4 var. B: decizia pe cod, aceeasi ca in import (doar citire). Copiii de arhiva se dovedesc din manifest; manifestul
    // necitit = regula pe nume de azi pentru licitatia asta (fail-closed: fara copii dovediti, o adoptie ar putea nimeri un copil).
    const { data: manV, error: eManV } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest')
      .select('arhiva_cheie, cale, document_id, sha256, stare').eq('licitatie_id', lic.id).eq('stare', 'urcat').not('document_id', 'is', null).order('id').range(de, la));
    const inv = inventarCod(aveam || [], { cheieRand, cheiSeap, copii: copiiDinManifest(manV || [], aveam || []) });
    const lista = indexLista(laSeap, cheiSeap);
    const dovezi = shaDovedit(manV || []);
    const instabile = eManV ? `manifest necitit (${eManV.message}) — regula pe nume` : coduriInstabile(inv, lista, laSeap, cheiSeap);
    inv.instabile = !!instabile;
    // `noi` pastreaza numele BRUTE din SEAP (se scriu ca nume_original la placeholdere),
    // dar atat deduplicarea cat si comparatia cu ce avem se fac pe cheie.
    const noi: string[] = [];
    const vazute = new Set<string>();
    // R1 (r4): „N (COD).ext” — republicare sub acelasi nume, cod nou (codul vechi a iesit din lista). NU intra in `noi` si nu primeste
    // placeholder: o aduce importul pe drumul principal, iar anuntul vine doar din randul importat (seap_meta.de_anuntat). Aici: raport.
    const versiuni = new Set<string>();
    const versiuniCod: { nume: string; cod: string }[] = [];   // Copilot r1 (P2): „neaduse” se judeca dupa import, pe cod
    const neverificate: string[] = [];    // Copilot r1 (P1): identitate fara nicio cale de dovada — raportata, nu „exista deja”
    let deRezolvat = 0;                   // adoptii de cod / frati / verificari pe continut: importul le rezolva, fara anunt
    for (const d of laSeap) {
      const n = d.nume;
      const dec: any = decideSeap(inv, lista, d, cheiSeap(d.nume), { adoptie: ADOPTIE });
      if (d.cod) inv.decise.add(d.cod);
      if (dec.fel === 'sari') continue;
      // o verificare fara NICIO cale de dovada (fara dovada, marime sau fisier): importul n-o poate rezolva — nu se porneste
      // degeaba, dar se RAPORTEAZA (identitate_neverificata), nu se tace ca si cum documentul ar exista deja
      if (dec.fel === 'verifica' && !verificabil(dec, (r: any) => !!dovezi.get(r.id))) { neverificate.push(`${d.nume} (${d.cod})`); continue; }
      if (dec.fel === 'adopta' || dec.fel === 'verifica' || dec.fel === 'frate') { deRezolvat++; continue; }
      if (dec.fel === 'versiune') { versiuni.add(dec.nume); versiuniCod.push({ nume: dec.nume, cod: d.cod }); continue; }
      const k = cheieNume(n);
      if (vazute.has(k) || areNume(cunoscute, n)) continue;
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

    const coduri: any = { de_rezolvat: deRezolvat, versiuni: [...versiuni], instabile, import: null, ...(neverificate.length ? { identitate_neverificata: neverificate } : {}) };
    // versiunile aduse de ORICINE (UI, workerul NAS, veghea) si inca neanuntate (seap_meta.de_anuntat, pus de campuriCod)
    const versiuneDeAnuntat = (d: any) => !estePlaceholder(d) && d?.seap_meta?.de_anuntat === true;
    const areDeAnuntat = (aveam || []).some(versiuneDeAnuntat);
    if (!noi.length && !versiuni.size && !raspunsuriAduse.length && !termen?.nou && !areDeAnuntat) {
      raport.push({ licitatie: lic.nr_anunt, noi: 0, raspunsuri_aduse: 0, raspunsuri_eroare: raspunsuriEroare, termen, coduri });
      if (deRezolvat) tacute.push({ id: lic.id, coduri, camp: 'import' });   // importul tacut, in a doua trecere
      continue;
    }

    // treapta 1: importul rapid din Supabase — documente noi SAU versiuni (R1: versiunea se aduce si se anunta in ACEEASI rulare;
    // una pe care importul n-o aduce ramane in coduri.versiuni + coduri.import_erori si se reia la rularea urmatoare, neanuntata).
    // Treaba doar tacuta asteapta a doua trecere.
    // E6 (r5): pornit DOAR de versiuni (fara documente noi) → fara rezerva DownloadArchive: merge pe nume, nu poate aduce
    // „N (COD).ext”, iar arhiva ar tine minute bucla principala (anunturile licitatiilor de dupa). Importul spune ca a sarit-o.
    let optImport: Record<string, unknown> = {};
    if (noi.length || versiuni.size) {
      const erori: string[] = [];
      optImport = noi.length ? {} : { fara_rezerva_arhiva: true };
      coduri.import = await importa(lic.id, false, erori, optImport);
      if (erori.length) coduri.import_erori = erori;
    }

    // treapta 2: ce a ramas trece prin Vercel, unde arhiva se parcurge integral
    // review PR-C P2: o eroare de inventar NU mai sare restul licitatiei — termenul si raspunsurile au fost deja scrise mai sus,
    // iar la rularea urmatoare n-ar mai aparea ca noutati (notificarea s-ar pierde definitiv). Fara inventar sigur: fara
    // treapta Vercel, fara placeholder-e si fara marcare; anunturile spun ca starea aducerii nu s-a putut verifica.
    // R1: doar pentru `noi` reale — /api/seap-import merge pe nume si nu poate aduce o versiune „N (COD).ext”.
    const { data: dupaEdge, error: eDupaEdge } = await inventar(supa, lic.id, 'nume_original, fisier_path');
    const urcateAcum = new Set((dupaEdge || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieRand(d.nume_original)));
    let vercel: string | null = eDupaEdge ? `sarit: inventar dupa edge indisponibil (${eDupaEdge.message})` : null;
    if (!eDupaEdge && noi.some((n) => !areNume(urcateAcum, n))) {
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
    const { data: acum, error: eAcum } = await inventar(supa, lic.id, 'id, nume_original, fisier_path, seap_cod, seap_meta');
    // fără inventar sigur NU se pun placeholder-e (ar fi fantome), nu se marchează nimic și nu se spune „adus” / „lipsă”
    const inventarOk = !eAcum;
    // Copilot r1 (P2): versiunile decise si inca NEADUSE = codul lor nu e pe niciun rand dupa import (o republicare identica mutata
    // pe randul vechi, mutaCod, e adusa — nu „neadusa”). Fara inventar sigur: toate se socotesc neaduse.
    if (versiuniCod.length) {
      const coduriAcum = new Set((acum || []).map((d: any) => d.seap_cod).filter(Boolean));
      coduri.versiuni_neaduse = versiuniCod.filter((v) => !inventarOk || !coduriAcum.has(v.cod)).map((v) => v.nume);
    }
    if (eAcum) raport.push({ licitatie: lic.nr_anunt, eroare: `inventar dupa import: ${eAcum.message}` });
    const urcate = new Set((acum || []).filter((d: any) => !estePlaceholder(d)).map((d: any) => cheieRand(d.nume_original)));
    const toateCunoscute = new Set((acum || []).map((d: any) => cheieRand(d.nume_original)));
    const auIntrat = inventarOk ? noi.filter((n) => areNume(urcate, n)) : [];
    const ramase = inventarOk ? noi.filter((n) => !areNume(urcate, n)) : [];
    const NESTIUT = 'Starea aducerii nu s-a putut verifica (inventarul platformei nu s-a putut citi) — verifica in Ofertare.';

    // v4: tot ce e nou (urcat sau nu) se marcheaza ca aparut ulterior importului initial.
    // Filtrarea „ce e nou" e pe cheie, dar interogarea BD cere numele BRUTE asa cum stau in
    // nume_original - deci se iau din randurile din BD, nu din numele normalizate de SEAP.
    let marcate = 0;
    const cheiNoi = new Set(noi.flatMap((n) => cheiSeap(n)));
    const numeDeMarcat = [...new Set(
      (acum || []).filter((d: any) => cheiNoi.has(cheieRand(d.nume_original))).map((d: any) => d.nume_original as string),
    )];
    if (numeDeMarcat.length) {
      const { data: m, error: eM } = await supa.from('ofertare_documente_atribuire')
        .update({ aparut_ulterior: true })
        .eq('licitatie_id', lic.id).in('nume_original', numeDeMarcat).select('id');
      if (eM) raport.push({ licitatie: lic.nr_anunt, marcare_esuata: eM.message });
      marcate = (m || []).length;
    }

    for (const n of ramase) {
      if (areNume(toateCunoscute, n)) continue;
      const safe = afis(n).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180);
      await supa.from('ofertare_documente_atribuire').insert({
        licitatie_id: lic.id,
        fisier_path: `${lic.id}/atribuire/neincarcat/${safe}`,
        nume_original: afis(n), tip: 'alta', status_procesare: 'ignorat', sursa: 'seap', aparut_ulterior: true,
        eroare: 'Aparut nou in SEAP, dar nu a putut fi adus automat - urca-l din "Urca fisiere".',
      });
    }

    // Jakarinos r2 (P1): o eroare la citirea destinatarilor NU confirma canalul versiunilor — lista ar fi incompleta
    // (o reincercare imediata: o eroare trecatoare nu lasa canalul restant — reluarea ar dubla clopotelul celor deja notificati)
    let { data: owners, error: eOwners } = await supa.from('profiles').select('id').eq('is_owner', true);
    if (eOwners) ({ data: owners, error: eOwners } = await supa.from('profiles').select('id').eq('is_owner', true));
    if (eOwners) raport.push({ licitatie: lic.nr_anunt, destinatari_necunoscuti: `owneri: ${eOwners.message}` });
    const catre = new Set<string>((owners || []).map((o: any) => o.id));
    if (lic.created_by) catre.add(lic.created_by);
    if (lic.responsabil_id) catre.add(lic.responsabil_id);
    // review PR-1 r5: INSERT-ul e acum unul singur, cu toti destinatarii — un id fara profil (cont sters) l-ar pica pentru TOTI.
    // Se pastreaza doar destinatarii cu profil; citirea esuata = destinatari necunoscuti (canalul versiunilor ramane restant).
    let eValizi: any = null;
    if (catre.size) {
      const { data: valizi, error } = await supa.from('profiles').select('id').in('id', [...catre]);
      eValizi = error;
      if (error) raport.push({ licitatie: lic.nr_anunt, destinatari_necunoscuti: `profiluri: ${error.message}` });
      else { const ok = new Set((valizi || []).map((x: any) => x.id)); for (const id of [...catre]) if (!ok.has(id)) catre.delete(id); }
    }
    const nume = (l: string[]) => l.slice(0, 4).map(afis).join(', ') + (l.length > 4 ? ` (+${l.length - 4})` : '');

    // v2: raspunsurile autoritatii se anunta separat, ca sa nu se piarda printre planse.
    // v10 (decizia M = A): o versiune noua a unui document din lista principala (acelasi nume, cod nou) intra tot aici — e o
    // modificare a documentatiei, cu mail catre office@ + responsabil, ca raspunsurile.
    // R1 (r4): o versiune se anunta DOAR din randul ei real, cu seap_meta.de_anuntat (pus de campuriCod la import) — oricine
    // l-ar fi adus (importul de mai sus, UI, workerul NAS); o singura data (flag-ul se stinge mai jos). Nimic dinainte de import.
    // E2 (r5, Jakarinos P1): confirmarea e PE CANAL — seap_meta.notificat_la (clopotelul) si seap_meta.mail_la (mailul) se pun
    // separat, doar cand canalul a reusit; de_anuntat = false abia cand le are pe amandoua. La rularea urmatoare, o versiune deja
    // notificata intra DOAR in mail (si invers): listele de versiuni se fac pe canal, fara a doua notificare / al doilea mail.
    // Jakarinos r4 (P1): rulari simultane (cron + „Verifica acum”) — anuntul versiunilor il da doar rularea care a revendicat atomic
    // ANCORA livrarii (vezi revendicaAnunt / revendicaGrup); versiunile ei (membrii) se revendica si ele, ca nicio versiune sa nu intre
    // in doua livrari. Jakarinos r5 + r6 (P1): grupul (continutul exact trimis) sta pe ancora si se scrie INAINTE de orice trimitere;
    // o rulare oprita oriunde e reluata de cine revendica ancora, cu ACELASI continut (clopotelul identic sarit pentru cine il are,
    // mailul identic oprit de cheia Resend, nimic retrimis daca grupul spune ca a plecat); ancora se confirma ULTIMA si isi sterge
    // grupul doar cand toti membrii sunt confirmati. Versiunile restante din afara grupului de reluat asteapta rularea urmatoare.
    const acumMs = Date.now();
    const restante = inventarOk ? (acum || []).filter(versiuneDeAnuntat) : [];
    const cuGrup = inventarOk ? (acum || []).filter((d: any) => grupValid(d.seap_meta?.grup, acumMs)) : [];
    const minId = (l: any[]) => l.reduce((a: any, b: any) => (b.id < a.id ? b : a));
    const ancoraCit = cuGrup.length ? minId(cuGrup) : restante.length ? minId(restante) : null;
    let versiuniInLucru = 0, versiuniAnuntate = 0;
    let anc: any = null;           // ancora revendicata de aceasta rulare
    let G: any = null;             // grupul de RELUAT (gasit pe ancora)
    const membriRev: any[] = [];   // celelalte versiuni ale livrarii, revendicate
    let incomplet = false;         // un membru nerevendicat / neconfirmat → grupul ramane pe ancora (se reia)
    if (ancoraCit) {
      const rv = cuGrup.length ? await revendicaGrup(supa, ancoraCit, tokenRulare) : await revendicaAnunt(supa, ancoraCit, tokenRulare);
      if (rv.eroare) raport.push({ licitatie: lic.nr_anunt, anunt_versiune_nerevendicat: `#${ancoraCit.id}: ${rv.eroare}` });
      else if (!rv.meta) versiuniInLucru = Math.max(restante.length, 1);
      else {
        anc = { ...ancoraCit, seap_meta: rv.meta };
        G = cuGrup.length ? (rv.meta as any).grup : null;
        for (const id of (G ? G.membri : restante.map((d: any) => d.id))) {
          if (id === anc.id) continue;
          const d = (acum || []).find((x: any) => x.id === id);
          if (!d || !versiuneDeAnuntat(d)) continue;     // confirmata deja (sau stearsa)
          const r2 = await revendicaAnunt(supa, d, tokenRulare);
          if (r2.meta) membriRev.push({ ...d, seap_meta: r2.meta });
          else {
            incomplet = true;
            if (r2.eroare) raport.push({ licitatie: lic.nr_anunt, anunt_versiune_nerevendicat: `#${d.id}: ${r2.eroare}` });
            else versiuniInLucru++;
          }
        }
      }
    }
    // confirmarea unei versiuni: canalele reusite acum isi pun data; de_anuntat = false doar cu amandoua (E2); `grup` = grupul pastrat
    // pe ancora (null = sters). Scrierea elibereaza revendicarea, doar cat e a acestei rulari (r4). Intoarce reusita.
    const confirma = async (d: any, notifAcum: boolean, mailAcum: boolean, grup: any): Promise<boolean> => {
      const m0 = d.seap_meta || {}, cand = new Date().toISOString();
      const meta: Record<string, unknown> = { ...m0 };
      if (!meta.notificat_la && notifAcum) meta.notificat_la = cand;
      if (!meta.mail_la && mailAcum) meta.mail_la = cand;
      if (meta.notificat_la !== m0.notificat_la || meta.mail_la !== m0.mail_la) versiuniAnuntate++;
      // ambele canale confirmate (acum sau mai demult) → flag-ul se stinge; altfel ramane pentru rularea urmatoare
      if (meta.notificat_la && meta.mail_la) { meta.de_anuntat = false; meta.anuntat_la = cand; }
      if (grup) meta.grup = grup; else delete meta.grup;
      const eF = await confirmaAnunt(supa, d, tokenRulare, meta);
      if (eF) raport.push({ licitatie: lic.nr_anunt, anunt_versiune_nemarcat: `#${d.id}: ${eF}` });
      return !eF;
    };
    // incheierea unei livrari: ce a plecat → pe ancora (o scriere), apoi membrii, apoi ancora ULTIMA. Grupul se sterge doar cand
    // TOATE canalele lui au plecat si toti membrii au fost revendicati si confirmati; altfel ramane (cu „trimis”) si se reia identic
    // — un canal cazut nu se mai reface cu alt continut cat timp e posibil sa fi ajuns deja la cineva.
    const incheie = async (grup: any, steag: (d: any) => [boolean, boolean]) => {
      if (grup) { const eT = await scrieGrup(supa, anc, tokenRulare, grup); if (eT) raport.push({ licitatie: lic.nr_anunt, grup_trimis_nemarcat: `#${anc.id}: ${eT}` }); }
      for (const d of membriRev) { const [n, m] = steag(d); if (!(await confirma(d, n, m, null))) incomplet = true; }
      const neplecat = !!grup && ((!!grup.notif && !grup.trimis?.notif) || (!!grup.mail && !grup.trimis?.mail));
      const [n, m] = steag(anc);
      await confirma(anc, n, m, incomplet || neplecat ? grup : null);
    };

    // RELUAREA grupului gasit pe ancora: canalele care nu figureaza ca trimise pleaca din nou, IDENTIC (destinatarii din grup care
    // mai au profil, fara cei care au deja mesajul; corpul + cheia mailului din grup); se confirma doar ce acopera grupul.
    const reluari: any[] = [];
    if (anc && G) {
      const trimis = { notif: !!G.trimis?.notif, mail: !!G.trimis?.mail };
      const st: any = { grup: G.id, versiuni: 1 + membriRev.length };
      if (G.notif && !trimis.notif) {
        const { data: vz, error: eVz } = await supa.from('profiles').select('id').in('id', G.notif.catre || []);
        if (eVz) st.clopotel = `profiluri: ${eVz.message}`;
        else {
          const ok = new Set((vz || []).map((x: any) => x.id));
          const eN = await clopotel(supa, (G.notif.catre || []).filter((pid: string) => ok.has(pid)), G.notif, true);
          trimis.notif = !eN; st.clopotel = eN || 'ok';
        }
      }
      if (G.mail && !trimis.mail) {
        const rm = await trimiteMail(G.mail.corp, G.mail.cheie);
        trimis.mail = rm.ok; st.mail = rm.text;
      }
      await incheie({ ...G, trimis }, (d) => [
        trimis.notif && !!G.notif?.ids?.includes(d.id),
        trimis.mail && G.mail?.complet === true && !!G.mail?.ids?.includes(d.id),
      ]);
      reluari.push(st);
    }

    // Jakarinos r3 (P1): cu destinatari necunoscuti (owneri / profiluri necitite), clopotelul versiunilor se AMANA intreg — trimis
    // doar unei parti, s-ar repeta la reluare pentru cei care l-au primit deja. Raspunsurile / termenul pleaca oricum (ca inainte).
    const destinatariNecunoscuti = !!eOwners || !!eValizi;
    const grupNou = anc && !G ? [anc, ...membriRev] : [];
    const cheiRaspunsuriAduse = new Set(raspunsuriAduse.map(cheieRand));
    const restul = noi.filter((n) => !esteRaspuns(n) && !areNume(cheiRaspunsuriAduse, n));
    // mesajele si mailul rularii, pentru versiunile date (o scriere de grup esuata → se refac FARA versiuni: nimic trimis fara grup)
    const alcatuieste = async (vNotif: any[], vMail: any[]) => {
      const versiuniNotif = vNotif.map((d: any) => d.nume_original as string);
      const versiuniMail = vMail.map((d: any) => d.nume_original as string);
      // grupa „raspuns / modificare a documentatiei” a unui canal: raspunsurile noi + versiunile canalului + raspunsurile GetAll
      const grupa = (versiuniCanal: string[]) => {
        const out: string[] = [], vazuteR = new Set<string>();
        for (const n of [...noi.filter(esteRaspuns), ...versiuniCanal, ...raspunsuriAduse]) {
          const k = cheieNume(n);
          if (vazuteR.has(k)) continue;
          vazuteR.add(k);
          out.push(n);
        }
        return out;
      };
      const raspunsuri = grupa(versiuniNotif);       // clopotelul
      const raspunsuriMail = grupa(versiuniMail);    // mailul

      const mesaje: { type: string; title: string; message: string }[] = [];
      if (termen?.nou) {
        const ro = (x: string) => new Date(x).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
        mesaje.push({
          type: 'warning',
          title: `SEAP: TERMEN MUTAT la ${lic.nr_anunt}`,
          message: `Autoritatea a schimbat termenul de depunere: ${termen.vechi ? ro(termen.vechi) : '(nesetat)'} -> ${ro(termen.nou)}. Data din platforma a fost actualizata automat din anuntul SEAP. Verifica graficul de lucru si valabilitatea garantiei de participare.`,
        });
      }
      // E2: mesajul care poarta versiunile — doar inserturile LUI confirma canalul clopotelului (notificat_la)
      let mesajVersiuni: { type: string; title: string; message: string } | null = null;
      if (raspunsuri.length) {
        const parti = [`Autoritatea a publicat ${raspunsuri.length} document(e) care par raspuns la clarificari sau modificare a documentatiei: ${nume(raspunsuri)}.`];
        if (raspunsuriAduse.length) parti.push(`Dintre ele, ${raspunsuriAduse.length} sunt raspunsuri publicate de autoritate, aduse automat din SEAP: ${nume(raspunsuriAduse)}. Se citesc din Ofertare -> Clarificari.`);
        if (versiuniNotif.length) parti.push(`${versiuniNotif.length} sunt VERSIUNI NOI ale unor documente din documentatie (acelasi nume, cod SEAP nou — versiunea veche nu mai e cea in vigoare): ${nume(versiuniNotif)}.`);
        const intrate = raspunsuri.filter((n) => areNume(urcate, n));
        if (!inventarOk) parti.push(NESTIUT);
        else if (intrate.length < raspunsuri.length) parti.push('ATENTIE: nu toate au putut fi aduse automat - urca-le din "Urca fisiere".');
        parti.push('Citeste-le si treci intrebarea si raspunsul in Clarificari. Daca raspunsul schimba o cerinta, cerinta din registru trebuie actualizata.');
        const m = {
          type: 'warning',
          title: `SEAP: RASPUNS de la autoritate la ${lic.nr_anunt}`,
          message: parti.join(' '),
        };
        mesaje.push(m);
        if (versiuniNotif.length) mesajVersiuni = m;
      }
      if (restul.length) {
        const parti: string[] = [];
        const intrate = restul.filter((n) => areNume(urcate, n));
        const lipsa = restul.filter((n) => !areNume(urcate, n));
        if (!inventarOk) parti.push(`Detectate in SEAP: ${nume(restul)}. ${NESTIUT}`);
        else {
          if (intrate.length) parti.push(`Aduse in platforma: ${nume(intrate)}.`);
          if (lipsa.length) parti.push(`Raman de urcat manual: ${nume(lipsa)}.`);
        }
        mesaje.push({
          type: 'info',
          title: `SEAP: ${restul.length} document(e) nou(i) la ${lic.nr_anunt}`,
          message: parti.join(' '),
        });
      }

      // v3: MAIL doar pentru raspunsuri si erate. Restul ramane in clopotel. r5: mailul se COMPUNE inainte de orice trimitere (intra
      // in grup); pleaca dupa clopotel, ca inainte.
      // E2: mailOk = mailul a plecat, sau nu era datorat (nimic de trimis / Resend neconfigurat — ca inainte, nu tine anuntul pe loc)
      let mail: string | null = null;
      let mailOk = !raspunsuriMail.length;
      let planMail: { corp: string; cheie: string; to: string[] } | null = null;
      // Jakarinos r2 (P1): responsabilul necitit (eroare) = lista de mail incompleta → mailul pleaca (raspunsurile nu se pierd), dar
      // canalul versiunilor ramane restant si se reia (o dublura la office e preferabila unui anunt pierdut pentru responsabil)
      let destinatariOk = true;
      if (raspunsuriMail.length) {
        if (!Deno.env.get('RESEND_API_KEY')) {
          mail = 'sarit: lipseste RESEND_API_KEY';
          mailOk = true;
        } else {
          const to = [OFFICE];
          if (lic.responsabil_id) {
            let { data: resp, error: eResp } = await supa.from('profiles').select('email, name').eq('id', lic.responsabil_id).maybeSingle();
            if (eResp) ({ data: resp, error: eResp } = await supa.from('profiles').select('email, name').eq('id', lic.responsabil_id).maybeSingle());
            if (eResp) { destinatariOk = false; raport.push({ licitatie: lic.nr_anunt, destinatari_necunoscuti: `responsabil: ${eResp.message}` }); }
            else if (resp?.email && !to.includes(resp.email)) to.push(resp.email);
          }
          const neaduse = raspunsuriMail.filter((n) => !areNume(urcate, n));
          const html = `
          <p>Autoritatea a publicat <b>${raspunsuriMail.length} document(e)</b> care par raspuns la clarificari sau modificare a documentatiei.</p>
          <p><b>Licitatie:</b> ${esc(lic.nr_anunt || '')} — ${esc(lic.obiect || '')}<br>
             <b>Termen depunere:</b> ${termenRO(lic.termen_depunere) || '—'}</p>
          <p><b>Documente:</b></p><ul>${raspunsuriMail.map((n) => `<li>${esc(afis(n))}${!inventarOk ? '' : areNume(urcate, n) ? (/\.(rar|7z|zip)(\.p7[sm])?$/i.test(n) ? ' <i>(arhiva — serverul o despacheteaza singur in cateva minute; fisierele apar ca documente separate, cu numele arhivei in fata)</i>' : '') : ' <i>(nu a putut fi adus automat — urca-l din „Urca fisiere”)</i>'}</li>`).join('')}</ul>
          ${raspunsuriAduse.length ? `<p><b>${raspunsuriAduse.length}</b> dintre ele sunt <b>raspunsuri publicate de autoritate</b>, aduse automat din SEAP. Se citesc din <b>Ofertare &rarr; &#10067; Clarificari</b>.</p>` : ''}
          ${versiuniMail.length ? `<p><b>${versiuniMail.length}</b> dintre ele sunt <b>versiuni noi</b> ale unor documente din documentatie (acelasi nume, cod SEAP nou): ${versiuniMail.map((n) => esc(afis(n))).join(', ')}. Versiunea veche NU mai e cea in vigoare.</p>` : ''}
          ${!inventarOk ? `<p><b>Atentie:</b> ${esc(NESTIUT)}</p>` : neaduse.length ? '<p><b>Atentie:</b> nu toate au intrat automat in platforma.</p>' : '<p>Toate au fost aduse automat in platforma.</p>'}
          <p>Citeste-le si treci intrebarea si raspunsul in <b>Clarificari</b>. Daca raspunsul schimba o cerinta, actualizeaza cerinta din registru.</p>
          <p><a href="https://pontaj-pro-sooty.vercel.app/ofertare">Deschide modulul Ofertare</a></p>`;
          const corp = JSON.stringify({
            from: 'PontajPRO <rapoarte@gazpet.ro>', to,
            subject: `SEAP — raspuns de la autoritate: ${lic.nr_anunt}`, html,
          });
          // r4 (idempotenta mailului): cheia = amprenta continutului — acelasi mail retrimis in 24 h (reluarea unui grup, sau doua
          // rulari simultane cu acelasi continut) Resend il intoarce fara sa-l trimita iar
          planMail = { corp, cheie: `seap-veghe/${lic.id}/${await sha256Hex(corp)}`, to };
        }
      }
      return { raspunsuri, mesaje, mesajVersiuni, mail, mailOk, planMail, destinatariOk };
    };

    let vNotif = destinatariNecunoscuti ? [] : grupNou.filter((d: any) => !d.seap_meta?.notificat_la);
    let vMail = grupNou.filter((d: any) => !d.seap_meta?.mail_la);
    let A = await alcatuieste(vNotif, vMail);
    // r5/r6: grupul livrarii proaspete — pe ancora, INAINTE de orice trimitere. Fara continut de versiune de trimis (doar canale deja
    // confirmate) = fara grup. Scrierea esuata → versiunile nu se trimit acum (raman restante), mesajele se refac fara ele.
    let grupScris: any = null, grupEsuat = false;
    if (anc && !G && (A.mesajVersiuni || (A.planMail && vMail.length))) {
      const grup = {
        id: `${tokenRulare}/${lic.id}`, la: acumMs, membri: grupNou.map((d: any) => d.id),
        notif: A.mesajVersiuni ? { ...A.mesajVersiuni, catre: [...catre], ids: vNotif.map((d: any) => d.id) } : null,
        mail: A.planMail && vMail.length ? { corp: A.planMail.corp, cheie: A.planMail.cheie, complet: A.destinatariOk, ids: vMail.map((d: any) => d.id) } : null,
        trimis: { notif: false, mail: false },
      };
      const eG = await scrieGrup(supa, anc, tokenRulare, grup);
      if (!eG) grupScris = grup;
      else {
        raport.push({ licitatie: lic.nr_anunt, grup_nescris: `#${anc.id}: ${eG}` });
        grupEsuat = true; vNotif = []; vMail = [];
        A = await alcatuieste([], []);
      }
    }
    const { raspunsuri, mesaje, mesajVersiuni, planMail } = A;
    let { mail, mailOk } = A;

    // E2: clopotelul versiunilor e confirmat doar daca mesajul lor a ajuns la TOTI destinatarii (fara destinatari = nimic de
    // confirmat). Jakarinos r2 (P1): un singur INSERT per mesaj, cu toti destinatarii (o instructiune = totul sau nimic) — altfel un
    // esec partial lasa canalul neconfirmat, iar reluarea il trimitea din nou si celor care il primisera deja.
    // r4 (idempotenta clopotelului): mesajul versiunilor nu mai pleaca la cei care au deja ACELASI mesaj (titlu + text, 24 h).
    let notifOk = !eOwners && !eValizi;
    for (const m of mesaje) {
      if (!catre.size) continue;
      const eN = await clopotel(supa, [...catre], m, m === mesajVersiuni);
      if (eN) {
        raport.push({ licitatie: lic.nr_anunt, notificare_esuata: eN });
        if (m === mesajVersiuni) notifOk = false;
      }
    }
    let mailPlecat = false;
    if (planMail) {
      const rm = await trimiteMail(planMail.corp, planMail.cheie);
      mail = rm.ok ? `trimis catre ${planMail.to.join(', ')}` : rm.text;
      mailOk = rm.ok && A.destinatariOk;
      mailPlecat = rm.ok;
    }

    // E2: fiecare versiune primeste data canalului reusit acum (notificat_la / mail_la); de_anuntat = false (+ anuntat_la) doar
    // cand le are pe AMANDOUA. Un canal cazut ramane pentru rularea urmatoare, singur (fara sa repete canalul reusit). r6: ce a
    // plecat se noteaza intai pe grup; o eroare / oprire la confirmari = grupul ramane pe ancora si se reia (fara retrimitere).
    // versiuni_anuntate = versiunile anuntate acum pe macar un canal (reluari incluse).
    // grupul nescris → versiunile NU au plecat: nicio data de canal, doar eliberarea revendicarilor (raman restante)
    if (anc && !G) await incheie(grupScris ? { ...grupScris, trimis: { notif: !!grupScris.notif && notifOk, mail: !!grupScris.mail && mailPlecat } } : null,
      () => (grupEsuat ? [false, false] : [notifOk, mailOk]));

    raport.push({ licitatie: lic.nr_anunt, termen, noi: noi.length, raspunsuri: raspunsuri.length, raspunsuri_aduse: raspunsuriAduse.length, raspunsuri_eroare: raspunsuriEroare, aduse: auIntrat.length, ramase: ramase.length, marcate, vercel, mail, versiuni_anuntate: versiuniAnuntate, versiuni_in_lucru: versiuniInLucru, ...(reluari.length ? { reluari } : {}), nume: noi.slice(0, 10), coduri });
    // importul a rulat deja mai sus (coduri.import) cand existau documente noi sau versiuni — nu inca o data in a doua trecere
    if (coduri.import == null && deRezolvat) tacute.push({ id: lic.id, coduri, camp: 'import' });
    // E4: lantul drumului principal s-a oprit de la de > 0 → O runda de la 0 pe a doua trecere (o singura data pe licitatie)
    else if (deLa0.has(lic.id) && !tacute.some((t) => t.id === lic.id)) tacute.push({ id: lic.id, coduri, camp: 'import_de_la_0', runde: 1, optiuni: optImport });
  }

  // A DOUA TRECERE: importurile tacute (adoptii de cod / frati / verificari pe continut), dupa toate anunturile, cat tine
  // bugetul de timp. Ordinea se amesteca la fiecare rulare, ca o licitatie de la coada sa nu ramana mereu fara buget.
  // F3/F6 (review PR-1): DOAR la rularea programata (fara body.licitatie_id). „Verifica acum” din UI trimite licitatie_id cu JWT
  // de utilizator si trebuie sa raspunda repede (nu asteapta importuri tacute); „Adu din SEAP” din UI face importul singur.
  // Limita acceptata: intr-o rulare a carei bucla principala depaseste bugetul, treaba tacuta asteapta rularea urmatoare —
  // licitatiile amanate apar in `tacute_amanate` (vizibile, nu infometate in tacere). Fara fire-and-forget, fara cron nou.
  // E4: aici intra si runda de la 0 a drumului principal (camp 'import_de_la_0', runde = 1), cu acelasi buget si aceeasi regula UI.
  const programata = !body?.licitatie_id;
  if (programata) {
    for (let k = tacute.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [tacute[k], tacute[j]] = [tacute[j], tacute[k]]; }
    for (const t of tacute) t.coduri[t.camp] = await importa(t.id, true, null, t.optiuni ?? {}, t.runde ?? RUNDE_IMPORT);
  } else for (const t of tacute) t.coduri[t.camp] = 'nepornit: verificare din UI (importul il face „Adu din SEAP” sau rularea programata)';
  const nrAnunt = new Map((licitatii || []).map((l: any) => [l.id, l.nr_anunt]));
  const tacute_amanate = tacute.filter((t) => String(t.coduri[t.camp] ?? '').startsWith('amanat')).map((t) => nrAnunt.get(t.id));

  return json({ verificate: (licitatii || []).length, raport, tacute_amanate });
});
