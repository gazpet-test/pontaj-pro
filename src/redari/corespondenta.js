// Redări — corespondența de trimis (red_corespondenta, migrarea 20261129h). Logică pură, fără React / Supabase.
import { eEmailValid, eEmailGazpet, normEmail, MAX_SUBIECT_MAIL, MAX_TEXT_MAIL } from '../../supabase/functions/_shared/redariCorespMail.mjs'
// Evidență: ERP-ul NU trimite nimic către instituții. Regula „nimic nu pleacă fără da-ul lui Răzvan” e în BD (trigger): `aprobat` doar owner,
// `trimis` / `raspuns_primit` doar după aprobare și cu data trimiterii. Aici doar oglindim regulile ca UI-ul să nu ofere pași care vor fi refuzați.

export const STARI_CORESPONDENTA = [
  { cod: 'draft',          eticheta: 'Draft',           culoare: '#8B949E' },
  { cod: 'la_avocat',      eticheta: 'La avocat',       culoare: '#D29922' },
  { cod: 'aprobat',        eticheta: 'Aprobat (owner)', culoare: '#58A6FF' },
  { cod: 'trimis',         eticheta: 'Trimis',          culoare: '#2EA043' },
  { cod: 'raspuns_primit', eticheta: 'Răspuns primit',  culoare: '#3FB950' },
  { cod: 'anulat',         eticheta: 'Anulat',          culoare: '#6E7681' },
]
const PE_COD = Object.fromEntries(STARI_CORESPONDENTA.map(s => [s.cod, s]))
export const etichetaStareCoresp = cod => PE_COD[cod]?.eticheta ?? String(cod ?? '')
export const culoareStareCoresp = cod => PE_COD[cod]?.culoare ?? '#8B949E'

// Audit D1 (04.11): cine a aprobat se ia din `aprobat_de` (contul care a pus „da”-ul), nu se presupune. Pe un rând aprobat: „Aprobat de {nume}”;
// fără nume rezolvat (profil necitit / lipsă): doar „Aprobat”. `numeDupaId` = { [profiles.id]: name }.
export const numeAprobator = (rand, numeDupaId) => {
  const n = rand?.aprobat_de ? String(numeDupaId?.[rand.aprobat_de] ?? '').trim() : ''
  return n || null
}
export function etichetaRandCoresp(rand, numeDupaId) {
  if (rand?.stare !== 'aprobat') return etichetaStareCoresp(rand?.stare)
  const n = numeAprobator(rand, numeDupaId)
  return n ? `Aprobat de ${n}` : 'Aprobat'
}

export const COL_CORESPONDENTA = 'id, proiect_id, cod, ordine, destinatar, subiect, expeditor, documente, depinde_de, stare, aprobat_de, aprobat_la, trimis_la, nr_inregistrare, observatii, versiune, updated_at, aprobat_fisier_id, aprobat_sha256, aprobat_storage_etag, destinatar_email, mail_subiect, mail_text, expeditor_email'

// Stările pe care le poate alege cineva dintr-un rând (fără `aprobat`, care are buton separat, doar pentru owner).
export function stariPermise(rand) {
  const aprobat = !!rand?.aprobat_la
  return STARI_CORESPONDENTA.map(s => s.cod).filter(c => c !== 'aprobat' && (aprobat || !['trimis', 'raspuns_primit'].includes(c)))
    .concat(rand?.stare === 'aprobat' ? ['aprobat'] : [])
}

// Gemini r1 P3: dacă în formular s-a schimbat conținutul unui rând aprobat, aprobarea cade (BD) → oferim doar stările permise atunci.
// 20261130f: e-mailul instituției, subiectul / textul mailului și e-mailul expeditorului intră și ele în conținutul aprobat (BD: fn_red_corespondenta_reguli).
export const CAMPURI_CONTINUT = ['destinatar', 'subiect', 'expeditor', 'documente', 'destinatar_email', 'mail_subiect', 'mail_text', 'expeditor_email']
export const continutSchimbat = (rand, f) => !!rand && CAMPURI_CONTINUT.some(k => String(rand[k] ?? '').trim() !== String(f?.[k] ?? '').trim())
export function stariInFormular(rand, f) {
  if (!rand) return ['draft', 'la_avocat']
  if (rand.aprobat_la && continutSchimbat(rand, f)) return ['draft', 'la_avocat', 'anulat']
  return stariPermise(rand)
}

// Bug 04.11 (Răzvan, B1): cu conținut schimbat pe un rând aprobat, `aprobat` dispare din listă; <select> afișa „Draft” dar starea rămânea
// `aprobat` → BD refuza salvarea. Starea efectivă = cea aleasă dacă e permisă, altfel prima permisă (cea pe care o vede utilizatorul).
export function stareEfectiva(rand, f) {
  const opt = stariInFormular(rand, f)
  return opt.includes(f?.stare) ? f.stare : opt[0]
}

export const poateAproba = (rand, esteOwner) => !!esteOwner && ['draft', 'la_avocat'].includes(rand?.stare)

// Următorul pas: primul rând (după ordine) care nu e încheiat. Rândurile `aprobat` sunt „de trimis acum”.
export function urmatorul(randuri) {
  return [...(randuri || [])].sort((a, b) => a.ordine - b.ordine || String(a.cod).localeCompare(String(b.cod)))
    .find(r => !['trimis', 'raspuns_primit', 'anulat'].includes(r.stare)) || null
}

const txt = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
// 20261130f: e-mailurile se salvează normalizate (fără spații, litere mici); goale = null
const eml = v => { const t = normEmail(v); return t || null }

// Validare + normalizare pentru salvare. Întoarce { erori:[], valori:{} }. `nou` = rând nou (cere cod).
export function valideazaCorespondenta(f, { nou = false } = {}) {
  const erori = []
  const valori = {
    ordine: Number(f.ordine),
    destinatar: txt(f.destinatar, 300), subiect: txt(f.subiect, 500), expeditor: txt(f.expeditor, 200),
    documente: txt(f.documente, 2000), depinde_de: txt(f.depinde_de, 1000), stare: f.stare || 'draft',
    trimis_la: f.trimis_la || null, nr_inregistrare: txt(f.nr_inregistrare, 100), observatii: txt(f.observatii, 4000),
    destinatar_email: eml(f.destinatar_email), expeditor_email: eml(f.expeditor_email),
    mail_subiect: String(f.mail_subiect ?? '').trim() || null, mail_text: String(f.mail_text ?? '').replace(/\r\n/g, '\n').trim() || null,
  }
  if (nou) {
    valori.cod = String(f.cod ?? '').trim().toUpperCase()
    if (!/^[A-Z][0-9]{1,2}$/.test(valori.cod)) erori.push('Codul are forma literă + 1–2 cifre (ex. B4).')
    if (valori.stare !== 'draft' && valori.stare !== 'la_avocat') erori.push('Un rând nou pornește din Draft sau La avocat.')
  }
  if (!Number.isInteger(valori.ordine) || valori.ordine < 1 || valori.ordine > 999) erori.push('Ordinea e un număr între 1 și 999.')
  if (!valori.destinatar) erori.push('Destinatarul e obligatoriu.')
  if (!valori.subiect) erori.push('Ce se trimite e obligatoriu.')
  if (['trimis', 'raspuns_primit'].includes(valori.stare) && !valori.trimis_la) erori.push('Pentru „Trimis” completează data trimiterii.')
  if (valori.trimis_la && !/^\d{4}-\d{2}-\d{2}$/.test(valori.trimis_la)) erori.push('Data trimiterii nu e validă.')
  // 20261130f: aceleași reguli ca CHECK-urile din BD (fără trunchiere tăcută: peste limită = eroare, L21)
  if (valori.destinatar_email && !eEmailValid(valori.destinatar_email)) erori.push('E-mailul instituției nu e o adresă validă.')
  if (valori.expeditor_email && !eEmailGazpet(valori.expeditor_email)) erori.push('E-mailul expeditorului trebuie să fie o adresă @gazpet.ro.')
  if (valori.mail_subiect && (valori.mail_subiect.length > MAX_SUBIECT_MAIL || /[\r\n]/.test(valori.mail_subiect))) erori.push('Subiectul mailului: un singur rând, cel mult 300 de caractere.')
  if (valori.mail_text && valori.mail_text.length > MAX_TEXT_MAIL) erori.push('Textul mailului are cel mult 20000 de caractere.')
  return { erori, valori }
}

// Mesajul pentru erorile din BD (triggerul / RLS), pe înțelesul echipei.
export function mesajEroareCoresp(e) {
  const m = String(e?.message || e || '')
  if (/doar Razvan/.test(m)) return 'Doar Răzvan poate aproba o corespondență.'
  // 20261130e: fișierele corespondenței
  if (/aproba doar dupa ce ai urcat fisierul de trimis/.test(m)) return 'Urcă întâi fișierul „de trimis” (varianta finală) — aprobarea se leagă de el.'
  if (/intre timp s-a urcat alt fisier de trimis/.test(m)) return 'Între timp s-a urcat alt fișier „de trimis”: reîncarcă, verifică fișierul nou și aprobă din nou.'
  if (/trebuie sa indice fisierul de trimis/.test(m)) return 'Aprobarea trebuie să indice fișierul „de trimis” confirmat: reîncarcă și aprobă din nou.'
  if (/nu are amprenta \(eTag\)/.test(m)) return 'Obiectul din Storage nu are amprentă (eTag); reîncearcă urcarea.'
  if (/fisierul de trimis nu se mai urca/.test(m)) return 'După trimitere / anulare nu se mai urcă „de trimis”; urcă dovada trimiterii sau răspunsul.'
  if (/fisierul lipseste din Storage/.test(m)) return 'Fișierul nu a ajuns în Storage; reîncearcă urcarea.'
  if (/calea fisierului nu e in folderul/.test(m)) return 'Calea fișierului nu e în folderul corespondenței (reîncarcă pagina și reîncearcă).'
  if (/sunt imutabile/.test(m)) return 'Fișierele urcate nu se modifică și nu se șterg; urcă o variantă nouă.'
  if (e?.code === '23505' && /path/.test(m)) return 'Există deja un fișier cu aceeași cale; reîncearcă urcarea.'
  if (e?.code === '42501') return 'Nu ai drept de scriere în Redări (sau accesul s-a schimbat). Reîncarcă pagina.'
  // 20261130f: CHECK-urile câmpurilor de mail
  if (/red_corespondenta_expeditor_email_ck/.test(m)) return 'E-mailul expeditorului trebuie să fie o adresă @gazpet.ro.'
  if (/red_corespondenta_destinatar_email_ck/.test(m)) return 'E-mailul instituției nu e o adresă validă.'
  if (/red_corespondenta_mail_subiect_ck/.test(m)) return 'Subiectul mailului: un singur rând, cel mult 300 de caractere.'
  if (/red_corespondenta_mail_text_ck/.test(m)) return 'Textul mailului e gol sau prea lung (max. 20000 de caractere).'
  if (/doar dupa aprobarea/.test(m)) return 'Se marchează „Trimis” doar după aprobarea lui Răzvan.'
  if (/continutul s-a schimbat/.test(m)) return 'Ai schimbat destinatarul / ce se trimite / expeditorul / documentele / câmpurile mailului după aprobare: trece rândul în Draft sau La avocat și cere din nou aprobarea.'
  if (/nu se schimba/.test(m)) return 'Codul și proiectul unei corespondențe nu se schimbă.'
  if (e?.code === '23505') return 'Codul există deja în proiect.'
  return m || 'Eroare la salvare.'
}

// Token de sesiune a ecranului (Jakarinos r2/r3 P2-01): `noua()` la fiecare schimbare de proiect și la demontare; o operație pornită
// își ia `expirat = captureaza()` și verifică după fiecare await (inclusiv în catch / finally). A→B→A = două sesiuni noi → operația veche e expirată.
export function sesiuneEcran() {
  let n = 0
  return { noua() { n++ }, captureaza() { const s = n; return () => s !== n } }
}
