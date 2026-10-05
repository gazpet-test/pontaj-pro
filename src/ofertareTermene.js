// Registrul de termene al unei licitații — logică pură (fără React, fără Supabase), testată în ofertareTermene.test.js.
// Lecția Mânăstirea (05.10.2026): termenul de întrebări (18 zile), termenul de răspuns al AC (11 zile din fișă / 10 din lege)
// și termenul de contestație (L101 art. 8) s-au calculat de trei ori de mână, iar colegii umblau cu „3 zile” din memorie.
// Aici se calculează o singură dată, din fișa de date + termenul din SEAP, și se afișează cu starea lor (trecut / azi / viitor).
// Toate calculele sunt ORIENTATIVE, în zile calendaristice, pe ora României — confirmarea juridică rămâne a omului.

export const FUS = 'Europe/Bucharest'

// Pragul valoric pentru contracte de LUCRĂRI (L98/2016 art. 7 alin. (1) lit. a) — valabil în 2026, confirmat de sesiunea juridică
// la 05.10.2026 (VERIFICARE_TEMEIURI_05.10.2026.md). Peste prag termenul de contestație e 10 zile, sub prag 7 zile (L101 art. 8 alin. (1)).
// Pragurile se revizuiesc din doi în doi ani (regulament UE) — de actualizat la 01.01.2028.
export const PRAG_LUCRARI_LEI = 26_960_556

// L98 art. 161 alin. (1): răspunsul AC se publică cu cel puțin 10 zile înainte de termen la licitația deschisă (CN),
// 6 zile la procedura simplificată (SCN). Fișa de date poate cere mai mult (Mânăstirea: 11 zile) — fișa primează.
export const ZILE_RASPUNS_IMPLICIT = { seap_cn: 10, seap_scn: 6 }

// „AAAA-LL-ZZ” al unui timestamp, pe ora României (termenele SEAP sunt ora locală; în BD stau în UTC).
export function ziRo(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('sv-SE', { timeZone: FUS })   // sv-SE dă exact „YYYY-MM-DD”
}

// Adună zile calendaristice la o zi „AAAA-LL-ZZ” (aritmetică pe UTC, fără surprize de DST).
export function plusZile(zi, n) {
  if (!zi) return null
  const [y, m, d] = zi.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + Number(n) * 86400000
  if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) return null   // n uriaș / NaN → nu aruncăm RangeError în randare
  return new Date(t).toISOString().slice(0, 10)
}

// „AAAA-LL-ZZ” validă și calendaristic (2026-02-31 trece regex-ul, dar nu e o zi) — altfel null.
export function ziValida(zi) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(zi || '')) return null
  const d = new Date(zi + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== zi ? null : zi
}

// Zile întregi între două zile „AAAA-LL-ZZ” (b − a).
export function zileIntre(a, b) {
  if (!a || !b) return null
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// Citește din textul fișei de date (text extras, nu rezumat AI) cele două numere de zile din secțiunea I.3 / VI.3.
// Formulările SEAP: „Numar zile pana la care se pot solicita clarificari inainte de data limita de depunere a ofertelor/candidaturilor 18”
// și „Termenul limita in care autoritatea contractanta va raspunde in mod clar si complet ... este cu 11 zile inainte de data limita”.
// Întoarce null unde nu găsește — NU inventează.
export function extrageZileDinFisa(text) {
  const t = String(text || '')
  // Cerem și „inainte de data limita” între frază și cifră: altfel „se pot solicita clarificari conform art. 8” dădea 8 zile.
  const mi = t.match(/se\s+pot\s+solicita\s+clarific[aă]ri\s+[iî]nainte\s+de\s+data\s+limit[aă][^0-9]{0,80}?(\d{1,2})\b/i)
  // Formulări întâlnite în fișele reale: „cu 11 zile inainte”, „in a 6-a zi inainte”, „in a 7 a zi inainte”.
  // Răspunsul: se caută doar în PROPOZIȚIA care conține „răspunde / Răspunsul / Răspunsurile” (până la „. ” urmat de majusculă
  // sau liniuță, ori paragraf nou, max 320 de caractere) — altfel o cifră dintr-o propoziție vecină („Vizita amplasamentului …
  // cu 5 zile înainte”) ar fi luată drept răspuns (review Jakarinos r3, B1). Fiecare propoziție-ancoră se încearcă pe rând.
  // Fără `\b` înaintea lui „î” (în JS, \b nu vede diacriticele ca litere → „în a 6-a zi” nu se potrivea).
  // Un candidat precedat DIRECT de „primite/transmise/depuse/solicitate” (oricâte spații, fără punctuație) e termenul de ÎNTREBĂRI,
  // nu de răspuns — se sare; „primite, cu 11 zile înainte” (cu virgulă) rămâne candidat (r2 N3, r3 B2).
  let zileRaspuns = null
  const reAncora = /r[aă]spun(?:de|sul|surile)/gi
  const reCandidat = /(?:^|[^a-zăâîșț])(?:cu\s+(\d{1,2})\s+zile\s+[iî]nainte|[iî]n\s+a\s+(\d{1,2})\s*-?\s*a\s+zi\s+[iî]nainte)/gi
  let anc
  while (zileRaspuns == null && (anc = reAncora.exec(t))) {
    let zona = t.slice(anc.index, anc.index + 320)
    const sfarsit = zona.search(/\.\s+(?=[A-ZĂÂÎȘȚ\-–•])|\n\s*\n/)
    if (sfarsit > 0) zona = zona.slice(0, sfarsit)
    reCandidat.lastIndex = 0
    let m
    while ((m = reCandidat.exec(zona))) {
      if (/(primite|transmise|depuse|solicitate)\s*$/i.test(zona.slice(0, m.index + 1))) continue
      zileRaspuns = Number(m[1] || m[2]); break
    }
  }
  return { zileIntrebari: mi ? Number(mi[1]) : null, zileRaspuns }
}

// O fișă de date poate fi spartă în mai multe documente (split): zilele de întrebări pot fi într-o parte, cele de răspuns în alta.
// Se ia, pentru fiecare cifră, primul document care o are, cu proveniența ei (docIntrebari / docRaspuns).
export function combinaFise(fise) {
  const r = { zileIntrebari: null, zileRaspuns: null, docIntrebari: null, docRaspuns: null }
  for (const f of fise || []) {
    const z = extrageZileDinFisa(f.text_extras)
    if (r.zileIntrebari == null && z.zileIntrebari != null) { r.zileIntrebari = z.zileIntrebari; r.docIntrebari = f.id }
    if (r.zileRaspuns == null && z.zileRaspuns != null) { r.zileRaspuns = z.zileRaspuns; r.docRaspuns = f.id }
  }
  return r
}

// Canalul real al procedurii: numărul anunțului spune adevărul (CN… = licitație deschisă, SCN… = simplificată),
// câmpul `canal` din ERP e completat de om și poate fi greșit (lic. 3 Mânăstirea: CN1095546 dar canal 'seap_scn').
export function canalDinAnunt(nrAnunt, canal = null) {
  const n = String(nrAnunt || '').trim().toUpperCase()
  if (/^SCN\d/.test(n)) return 'seap_scn'
  if (/^CN\d/.test(n)) return 'seap_cn'
  return canal || null
}

// Actele AC care pot fi atacate (L101 art. 8): răspunsuri la clarificări, erate, documente publicate după anunț.
// `aparut_ulterior` marchează loturi întregi (lic. 3: 21 de documente pe 29.08), deci actul = ZIUA publicării, nu fișierul:
// toate documentele apărute în aceeași zi sunt o singură luare la cunoștință. Data = data_document din citirea AI
// (dacă există, „AAAA-LL-ZZ”), altfel ziua apariției în platformă (created_at, ora României).
const RANG_TIP = { erata: 3, raspuns_clarificare: 2, document_nou: 1 }
export function acteContestabile(docs) {
  const peZi = new Map()
  for (const d of docs || []) {
    if (!d) continue
    const tipCitire = String(d.citire?.tip || d.tip_citire || '').toLowerCase()
    const dataDoc = d.citire?.data_document || d.data_document
    const eAct = d.tip === 'raspuns_clarificare' || d.aparut_ulterior === true || tipCitire === 'erata'
    if (!eAct) continue
    const dinCitire = ziValida(dataDoc)
    const zi = dinCitire || ziRo(d.created_at)
    if (!zi) continue
    const tip = tipCitire === 'erata' ? 'erata' : d.tip === 'raspuns_clarificare' ? 'raspuns_clarificare' : 'document_nou'
    const sursa = dinCitire ? 'citire' : 'import'
    const a = peZi.get(zi) || { zi, tip: 'document_nou', docs: [], areRaspuns: false, sursaZi: sursa }
    if (a.sursaZi !== sursa) a.sursaZi = 'mixt'    // în aceeași zi, unele documente au data din citirea AI, altele ziua importului
    if ((RANG_TIP[tip] || 0) > (RANG_TIP[a.tip] || 0)) a.tip = tip
    if (d.tip === 'raspuns_clarificare') a.areRaspuns = true     // calitatea de răspuns e separată de tipul dominant (o erată nu e răspuns)
    a.docs.push({ id: d.id, nume: d.nume_original || `doc ${d.id}` })
    peZi.set(zi, a)
  }
  return [...peZi.values()].sort((a, b) => (a.zi < b.zi ? -1 : a.zi > b.zi ? 1 : 0))
}

// Calculul propriu-zis. Întoarce un obiect fără efecte, gata de afișat.
//  termenDepunere  — ofertare_licitatii.termen_depunere (timestamptz)
//  zileIntrebari / zileRaspuns — din fișă (extrageZileDinFisa) sau editate de om; null = necunoscut
//  canal           — 'seap_cn' | 'seap_scn' | … (pentru implicitul legal al răspunsului)
//  valoareEstimata — lei fără TVA; prag — lei (implicit PRAG_LUCRARI_LEI)
//  docs            — rândurile din ofertare_documente_atribuire (vezi acteContestabile)
//  acum            — Date (injectabil în teste)
export function calculeazaTermene({ termenDepunere, zileIntrebari = null, zileRaspuns = null, canal = null, valoareEstimata = null, prag = PRAG_LUCRARI_LEI, docs = [], acum = new Date() } = {}) {
  const azi = ziRo(acum)
  const depunere = ziRo(termenDepunere)
  const stare = zi => zi == null ? null : zileIntre(azi, zi) < 0 ? 'trecut' : zileIntre(azi, zi) === 0 ? 'azi' : 'viitor'
  const reper = (cheie, eticheta, zi, extra = {}) => ({ cheie, eticheta, zi, zile: zi ? zileIntre(azi, zi) : null, stare: stare(zi), ...extra })

  const raspImplicit = canal && ZILE_RASPUNS_IMPLICIT[canal] != null ? ZILE_RASPUNS_IMPLICIT[canal] : null
  const zr = zileRaspuns ?? raspImplicit
  const repere = []
  if (depunere) {
    repere.push(reper('intrebari', 'Întrebări de clarificare până la', zileIntrebari != null ? plusZile(depunere, -zileIntrebari) : null,
      { sursa: zileIntrebari != null ? `fișa de date: ${zileIntrebari} zile înainte` : 'fișa de date nu a fost citită — completează zilele' }))
    repere.push(reper('raspuns', 'AC răspunde consolidat până la', zr != null ? plusZile(depunere, -zr) : null,
      { sursa: zileRaspuns != null ? `fișa de date: ${zileRaspuns} zile înainte` : raspImplicit != null ? `implicit L98 art. 161: ${raspImplicit} zile (${canal === 'seap_scn' ? 'procedură simplificată' : 'licitație deschisă'})` : 'necunoscut — canal nespecificat' }))
    repere.push(reper('depunere', 'Depunerea ofertei', depunere, { ora: termenDepunere ? new Date(termenDepunere).toLocaleTimeString('ro-RO', { timeZone: FUS, hour: '2-digit', minute: '2-digit' }) : null }))
  }

  // L101 art. 8 alin. (1): 7 zile sub prag, 10 zile la/peste prag, de la luarea la cunoștință de actul atacat (zile calendaristice).
  const peste = valoareEstimata != null && prag != null ? Number(valoareEstimata) >= Number(prag) : null
  const zileContestatie = peste == null ? null : peste ? 10 : 7
  const contestatii = zileContestatie == null ? [] : acteContestabile(docs).map(a => {
    const pana_la = plusZile(a.zi, zileContestatie)
    return { ...a, pana_la, zile: zileIntre(azi, pana_la), stare: stare(pana_la) }
  }).reverse()   // cele mai recente primele

  // AC în întârziere: a trecut termenul de răspuns, oferta încă nu s-a depus, și nu există niciun răspuns la clarificări
  // publicat după termenul de întrebări. Dacă există unul, nu știm din date dacă e consolidat (lic. 3: RAR-ul din 02.10
  // avea liste noi, nu răspunsuri) — de aceea întoarcem și `ultimRaspuns`, iar ecranul cere verificarea omului.
  const rRasp = repere.find(r => r.cheie === 'raspuns')
  const rIntreb = repere.find(r => r.cheie === 'intrebari')
  const raspunsuri = acteContestabile(docs).filter(a => a.areRaspuns)
  const ultimRaspuns = raspunsuri.length ? raspunsuri[raspunsuri.length - 1].zi : null
  const dupaIntrebari = !!ultimRaspuns && (!rIntreb?.zi || ultimRaspuns >= rIntreb.zi)
  const intarziereAC = !!(rRasp?.zi && rRasp.stare === 'trecut' && depunere && zileIntre(azi, depunere) >= 0 && !dupaIntrebari)

  return { azi, depunere, repere, contestatii, prag: { lei: prag, peste, zile: zileContestatie }, intarziereAC, ultimRaspuns }
}
