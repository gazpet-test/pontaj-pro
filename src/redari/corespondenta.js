// Redări — corespondența de trimis (red_corespondenta, migrarea 20261129h). Logică pură, fără React / Supabase.
// Evidență: ERP-ul NU trimite nimic. Regula „nimic nu pleacă fără da-ul lui Răzvan” e în BD (trigger): `aprobat` doar owner,
// `trimis` / `raspuns_primit` doar după aprobare și cu data trimiterii. Aici doar oglindim regulile ca UI-ul să nu ofere pași care vor fi refuzați.

export const STARI_CORESPONDENTA = [
  { cod: 'draft',          eticheta: 'Draft',           culoare: '#8B949E' },
  { cod: 'la_avocat',      eticheta: 'La avocat',       culoare: '#D29922' },
  { cod: 'aprobat',        eticheta: 'Aprobat Răzvan',  culoare: '#58A6FF' },
  { cod: 'trimis',         eticheta: 'Trimis',          culoare: '#2EA043' },
  { cod: 'raspuns_primit', eticheta: 'Răspuns primit',  culoare: '#3FB950' },
  { cod: 'anulat',         eticheta: 'Anulat',          culoare: '#6E7681' },
]
const PE_COD = Object.fromEntries(STARI_CORESPONDENTA.map(s => [s.cod, s]))
export const etichetaStareCoresp = cod => PE_COD[cod]?.eticheta ?? String(cod ?? '')
export const culoareStareCoresp = cod => PE_COD[cod]?.culoare ?? '#8B949E'

export const COL_CORESPONDENTA = 'id, proiect_id, cod, ordine, destinatar, subiect, expeditor, documente, depinde_de, stare, aprobat_de, aprobat_la, trimis_la, nr_inregistrare, observatii, versiune, updated_at'

// Stările pe care le poate alege cineva dintr-un rând (fără `aprobat`, care are buton separat, doar pentru owner).
export function stariPermise(rand) {
  const aprobat = !!rand?.aprobat_la
  return STARI_CORESPONDENTA.map(s => s.cod).filter(c => c !== 'aprobat' && (aprobat || !['trimis', 'raspuns_primit'].includes(c)))
    .concat(rand?.stare === 'aprobat' ? ['aprobat'] : [])
}

// Gemini r1 P3: dacă în formular s-a schimbat conținutul unui rând aprobat, aprobarea cade (BD) → oferim doar stările permise atunci.
export const CAMPURI_CONTINUT = ['destinatar', 'subiect', 'expeditor', 'documente']
export const continutSchimbat = (rand, f) => !!rand && CAMPURI_CONTINUT.some(k => String(rand[k] ?? '').trim() !== String(f?.[k] ?? '').trim())
export function stariInFormular(rand, f) {
  if (!rand) return ['draft', 'la_avocat']
  if (rand.aprobat_la && continutSchimbat(rand, f)) return ['draft', 'la_avocat', 'anulat']
  return stariPermise(rand)
}

export const poateAproba = (rand, esteOwner) => !!esteOwner && ['draft', 'la_avocat'].includes(rand?.stare)

// Următorul pas: primul rând (după ordine) care nu e încheiat. Rândurile `aprobat` sunt „de trimis acum”.
export function urmatorul(randuri) {
  return [...(randuri || [])].sort((a, b) => a.ordine - b.ordine || String(a.cod).localeCompare(String(b.cod)))
    .find(r => !['trimis', 'raspuns_primit', 'anulat'].includes(r.stare)) || null
}

const txt = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }

// Validare + normalizare pentru salvare. Întoarce { erori:[], valori:{} }. `nou` = rând nou (cere cod).
export function valideazaCorespondenta(f, { nou = false } = {}) {
  const erori = []
  const valori = {
    ordine: Number(f.ordine),
    destinatar: txt(f.destinatar, 300), subiect: txt(f.subiect, 500), expeditor: txt(f.expeditor, 200),
    documente: txt(f.documente, 2000), depinde_de: txt(f.depinde_de, 1000), stare: f.stare || 'draft',
    trimis_la: f.trimis_la || null, nr_inregistrare: txt(f.nr_inregistrare, 100), observatii: txt(f.observatii, 4000),
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
  return { erori, valori }
}

// Mesajul pentru erorile din BD (triggerul / RLS), pe înțelesul echipei.
export function mesajEroareCoresp(e) {
  const m = String(e?.message || e || '')
  if (/doar Razvan/.test(m)) return 'Doar Răzvan poate aproba o corespondență.'
  if (e?.code === '42501') return 'Nu ai drept de scriere în Redări (sau accesul s-a schimbat). Reîncarcă pagina.'
  if (/doar dupa aprobarea/.test(m)) return 'Se marchează „Trimis” doar după aprobarea lui Răzvan.'
  if (/continutul s-a schimbat/.test(m)) return 'Ai schimbat destinatarul / ce se trimite / expeditorul / documentele după aprobare: trece rândul în Draft sau La avocat și cere din nou aprobarea.'
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
