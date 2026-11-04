// Anexa 7: antet dupa continut, identitate comuna cu TGZ, fara Nr.Crt.
import * as XLSX from 'xlsx-js-style'
import { cheie, text, numar, cheieSursa, cheieSursaVeche, idParcelaProvizoriu, tronsonOptional, tronsonDatInvalid } from './importTgz.js'
import { normalizeazaNume } from './idParcela.js'

const ANTETE = [
  ['uat', 'UAT'], ['sat', 'Sat'], ['tarla', 'Tarla'], ['nr_cadastral', 'Nr. cadastral / parcela'],
  ['poz_hg', 'Poz. HG'], ['suprafata', 'Suprafata afectata temporar (mp)'],
  ['categorie', 'Categoria de folosinta'], ['tronson', 'Tronson / km'],
  ['nume', 'Nume si prenume / denumire'], ['calitate', 'Calitate'], ['cota', 'Cota'],
  ['act', 'Act doveditor cunoscut Beneficiarului (DA/NU)'], ['strada', 'Adresa: strada, nr.'],
  ['sat_adresa', 'Sat'], ['comuna', 'Comuna'], ['judet', 'Judet'], ['cod_postal', 'Cod postal'],
  ['telefon', 'Telefon'], ['email', 'E-mail'], ['neidentificat', 'Proprietar neidentificat (DA/NU)'],
  ['decedat', 'Decedat (DA/NU)'], ['mostenitori', 'Mostenitori cunoscuti (nume)'],
  ['sursa_mostenitori', 'Sursa informatiei mostenitori'], ['utilizator', 'Utilizator / arendas (daca e cunoscut)'],
  ['reprezentant', 'Reprezentant + referinta mandatului'],
  ['despagubire', 'Despagubire achitata (DA/NU, nr./data document; fara suma)'],
  ['stadiu', 'Stadiul verificarii calitatii detinatorului'], ['observatii', 'Observatii'],
  ['sursa', 'Sursa datelor (CF / ANCPI / primarie / notificare L185)'], ['data', 'Data ultimei actualizari'],
]
// Aceeasi lista de valori ca CALITATI din comune.jsx; nu importam React in parser.
const CALITATI = ['proprietar', 'coproprietar', 'mostenitor', 'arendas', 'utilizator', 'neidentificat']

const MAX_RAND_ANTET = 30   // ca în parserul TGZ: antetul e în primele 30 de rânduri (Gemini f3b r1 P3)
function gasesteAntet(sheet, range) {
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + MAX_RAND_ANTET - 1); r++) {
    const chei = []
    for (let c = range.s.c; c <= range.e.c; c++) chei.push(cheie(sheet[XLSX.utils.encode_cell({ r, c })]?.v))
    if (chei.includes('uat') && chei.includes('numesiprenumedenumire')) return { rand: r, chei }
  }
  return null
}

export function parseazaAnexa7(arrayBuffer, { uats = [], tronsonPeUat = {}, versiune = null, sursa = 'ANEXA7' } = {}) {
  const rez = { parcele: [], detinatori: [], contacte: [], dubluri: [], neidentificati: [], fara_cheie: [], ambigue: [], erori: [], antet: null }
  const st = rez.statistici = { randuri_total: 0, randuri_goale: 0, parcele: 0, parcele_fara_cheie: 0, parcele_ambigue: 0, detinatori: 0, contacte: 0, dubluri: 0, neidentificati: 0, fara_cheie: 0, ambigue: 0, judet_diferit: 0, erori: 0, pe_uat: {}, parcele_de_importat: 0, detinatori_de_importat: 0, contacte_de_importat: 0 }
  const eroare = (rand, motiv, alte = {}) => { rez.erori.push({ rand, motiv, ...alte }); st.erori++ }
  let wb
  try { wb = XLSX.read(arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer, { type: 'array', cellDates: false }) }
  catch { eroare(null, 'Fisierul nu poate fi citit ca Excel'); return rez }
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet?.['!ref']) { eroare(null, 'Fisierul nu are nicio foaie cu date'); return rez }
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const antet = gasesteAntet(sheet, range)
  if (!antet) { eroare(null, 'Nu gasesc antetul Anexa 7 (UAT si Nume si prenume / denumire)'); return rez }
  rez.antet = antet // Index 0-based, conform contractului Anexa 7.
  const col = {}
  const numeIndex = antet.chei.indexOf(cheie('Nume si prenume / denumire'))
  const adresaIndex = antet.chei.indexOf(cheie('Adresa: strada, nr.'))
  const lipsa = []
  for (const [camp, eticheta] of ANTETE) {
    const candidati = antet.chei.flatMap((k, i) => k === cheie(eticheta) ? [i] : [])
      .filter(i => camp === 'sat' ? i < numeIndex : camp === 'sat_adresa' ? i > adresaIndex && adresaIndex >= 0 : true)
    if (candidati.length !== 1) lipsa.push(camp)
    else col[camp] = range.s.c + candidati[0]
  }
  if (lipsa.length) { eroare(antet.rand + 1, `Coloane lipsa sau ambigue: ${lipsa.join(', ')}`); return rez }
  const dupaUat = new Map(); const ambigue = new Set()   // Copilot f3b r1 P3-02: chei care duc la mai multe UAT-uri → refuz explicit
  const idUat = u => u.id ?? u.uat3 ?? u.nume   // Gemini f3b r2 P3: identitatea nu depinde de prezența id-ului
  const pune = (k, u) => { if (!k) return; const e = dupaUat.get(k); if (e && idUat(e) !== idUat(u)) ambigue.add(k); else dupaUat.set(k, u) }
  for (const u of uats) if (u) { if (u.nume) pune(normalizeazaNume(u.nume), u); if (u.uat3) pune(normalizeazaNume(u.uat3), u) }
  const parcele = new Map(); const detinatori = new Map(); const contoare = new Map()
  const judetDet = new Map()   // cheie detinator → județul UAT-ului (implicit, aplicat la final — Copilot f3b r3 P2-01)
  for (let r = antet.rand + 1; r <= range.e.r; r++) {
    const rand = r + 1
    const brut = camp => sheet[XLSX.utils.encode_cell({ r, c: col[camp] })]?.v
    const v = camp => text(brut(camp))
    if (!ANTETE.some(([c]) => v(c))) { st.randuri_goale++; continue }   // Copilot f3b r1 P3-01: gol = TOATE coloanele goale
    st.randuri_total++
    if (!v('uat')) { eroare(rand, 'UAT lipsa pe un rand cu date', { nume: v('nume') }); continue }
    const cheieUat = normalizeazaNume(v('uat'))
    const context = { uat: v('uat'), nume: v('nume') }
    if (ambigue.has(cheieUat)) { eroare(rand, 'UAT ambiguu: mai multe UAT-uri din proiect au acest nume normalizat', context); continue }
    const uat = dupaUat.get(cheieUat)
    if (!uat) { eroare(rand, 'UAT necunoscut', context); continue }
    const s = st.pe_uat[uat.uat3] ??= { parcele: 0, detinatori: 0, dubluri: 0, neidentificati: 0, fara_cheie: 0, ambigue: 0, erori: 0 }
    const refuza = motiv => { eroare(rand, motiv, context); s.erori++ }
    if (!v('nume')) { refuza('Nume detinator gol'); continue }
    if (tronsonDatInvalid(tronsonPeUat?.[uat.uat3])) { refuza(`Tronson invalid pentru UAT ${uat.uat3} (1..11 sau gol)`); continue }
    const tronson = tronsonOptional(tronsonPeUat?.[uat.uat3])
    const suprafata = v('suprafata') ? numar(brut('suprafata')) : null
    if (v('suprafata') && (suprafata == null || suprafata < 0)) { refuza('Suprafata invalida'); continue }
    const cheieS = cheieSursa(uat.uat3, v('poz_hg'), v('nr_cadastral'), v('tarla'))
    const cheieP = cheieS || `fara_cheie:${rand}`
    const atribute = { sat: v('sat') || null, tarla: v('tarla') || null, nr_cadastral: v('nr_cadastral') || null, poz_hg: v('poz_hg') || null, suprafata_temporara_mp: suprafata, categoria_folosinta: v('categorie') || null }
    let p = parcele.get(cheieP)
    if (!p) {
      contoare.set(uat.uat3, (contoare.get(uat.uat3) || 0) + 1)
      p = { cheie: cheieP, cheie_sursa: cheieS, cheie_sursa_veche: cheieS ? cheieSursaVeche(uat.uat3, v('poz_hg'), v('nr_cadastral'), v('tarla')) : null, ambigua: false, motiv_ambiguitate: null, nr_crt: null, uat_id: uat.id ?? null, uat3: uat.uat3, tronson, id_parcela: idParcelaProvizoriu(uat.uat3), nr_provizoriu: contoare.get(uat.uat3), ...atribute, observatii: null, note: [], rand, randuri: [], nr_detinatori: 0 }
      parcele.set(cheieP, p); rez.parcele.push(p); s.parcele++
      if (!cheieS) st.parcele_fara_cheie++
    } else {
      // Gemini f3b r1 P2: un atribut gol pe primul rând se COMPLETEAZĂ din rândul următor (coproprietarii pot avea date parțiale);
      // doar valorile diferite și nenule sunt contradictorii; numerele se compară numeric, nu prin normalizarea numelor
      for (const camp of ['sat', 'suprafata_temporara_mp', 'categoria_folosinta']) {
        if (atribute[camp] == null) continue
        if (p[camp] == null) { p[camp] = atribute[camp]; continue }
        const difera = camp === 'suprafata_temporara_mp' ? Number(atribute[camp]) !== Number(p[camp]) : normalizeazaNume(atribute[camp]) !== normalizeazaNume(p[camp])
        if (difera) p.note.push(`Rand ${rand}: ${camp} contradictoriu (${atribute[camp]}); pastrat primul (${p[camp]})`)
      }
    }
    const configurareTronson = tronson == null ? 'neatribuit' : `T${tronson}`
    if (v('tronson') && !p.note.some(n => n.endsWith(`Tronson / km din fisier: ${v('tronson')} (configurare: ${configurareTronson})`))) p.note.push(`Rand ${rand}: Tronson / km din fisier: ${v('tronson')} (configurare: ${configurareTronson})`)
    p.observatii = p.note.join('; ') || null
    p.randuri.push({ rand, nr_crt: null, nume: v('nume') })
    const numeNorm = normalizeazaNume(v('nume'))
    const cheieD = `${cheieP}|${numeNorm}`
    if (detinatori.has(cheieD)) {
      rez.dubluri.push({ rand, nr_crt: null, nume: v('nume'), nume_normalizat: numeNorm, cheie_parcela: cheieP, rand_original: detinatori.get(cheieD).rand }); s.dubluri++
      // Nu pierdem informatiile randului duplicat la deduplicarea dupa nume.
      const date = ANTETE.filter(([camp]) => v(camp)).map(([camp, et]) => `${et}: ${v(camp)}`).join('; ')
      const d0 = detinatori.get(cheieD)
      d0.sursa_date += `; Dublura rand ${rand}: ${date}`
      // Gemini f3b r1 P2: contactul de pe rândul-dublură nu se pierde dacă primul rând nu avea contact; cota / decedat se completează dacă lipseau
      if (!d0.cota && v('cota')) d0.cota = v('cota')
      if (!d0.decedat && normalizeazaNume(v('decedat')) === 'DA') d0.decedat = true
      const act = normalizeazaNume(v('act'))
      if (d0.act_doveditor_cunoscut == null && (act === 'DA' || act === 'NU')) d0.act_doveditor_cunoscut = act === 'DA'
      const campuriContact = { adresa_strada: 'strada', adresa_sat: 'sat_adresa', adresa_comuna: 'comuna', adresa_judet: 'judet', cod_postal: 'cod_postal', telefon: 'telefon', email: 'email' }
      if (Object.values(campuriContact).some(c => v(c))) {
        // Copilot f3b r2 P2-01: contactul existent (chiar parțial, ex. doar telefon) se COMPLETEAZĂ cu câmpurile lipsă de pe dublură;
        // valorile deja prezente nu se suprascriu (diferențele rămân în sursa_date); adresa_cunoscuta se recalculează pe contactul consolidat
        let c0 = rez.contacte.find(c => c.cheie_detinator === cheieD)
        if (!c0) { c0 = { cheie_detinator: cheieD, adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: null, cod_postal: null, telefon: null, email: null, adresa_cunoscuta: false }; rez.contacte.push(c0) }
        for (const [camp, col] of Object.entries(campuriContact)) if (!c0[camp] && v(col)) c0[camp] = v(col)
        c0.adresa_cunoscuta = d0.calitate !== 'neidentificat' && !!(c0.adresa_strada || c0.adresa_comuna)
        d0.adresa_cunoscuta = c0.adresa_cunoscuta
      }
      continue
    }
    const note = []
    const act = normalizeazaNume(v('act'))
    const actDoveditorCunoscut = act === 'DA' ? true : act === 'NU' ? false : null
    let calitate = CALITATI.find(c => cheie(v('calitate')).startsWith(c))
    if (!calitate) { calitate = 'proprietar'; note.push(`Calitate ${v('calitate') || 'lipsa'}: presupus proprietar, necesita verificare`) }
    const neidentificat = normalizeazaNume(v('neidentificat')) === 'DA' || calitate === 'neidentificat'
    if (neidentificat) calitate = 'neidentificat'
    for (const camp of ['act', 'neidentificat', 'decedat', 'mostenitori', 'sursa_mostenitori', 'utilizator', 'reprezentant', 'despagubire', 'stadiu', 'observatii', 'data']) {
      if (camp === 'act' && actDoveditorCunoscut !== null) continue
      if (v(camp)) note.push(`${camp === 'reprezentant' ? 'reprezentant' : ANTETE.find(([c]) => c === camp)[1]}: ${v(camp)}`)
    }
    // Helperul TGZ interpreteaza punctul urmat de 3 cifre ca separator de mii; semnalam ambiguitatea.
    if (typeof brut('suprafata') === 'string' && /^\d+\.\d{3}$/.test(v('suprafata'))) note.push(`Suprafata ambigua: ${v('suprafata')}; interpretare TGZ ${suprafata}, necesita verificare`)
    const adresaCunoscuta = !neidentificat && !!(v('strada') || v('comuna'))
    const d = { cheie: cheieD, cheie_parcela: cheieP, id_parcela: p.id_parcela, nr_crt: null, nume: v('nume'), nume_normalizat: numeNorm, calitate, cota: v('cota') || null, decedat: normalizeazaNume(v('decedat')) === 'DA', adresa_cunoscuta: adresaCunoscuta, sursa_date: [v('sursa') || sursa, ...note].join('; '), versiune_lista_tgz: versiune, rand }
    detinatori.set(cheieD, d); rez.detinatori.push(d); p.nr_detinatori++; s.detinatori++
    d.act_doveditor_cunoscut = actDoveditorCunoscut
    judetDet.set(cheieD, uat.judet || null)
    const intrare = { rand, nr_crt: null, nume: d.nume, cheie_parcela: cheieP }
    if (neidentificat) { rez.neidentificati.push(intrare); s.neidentificati++ }
    if (!cheieS) { rez.fara_cheie.push(intrare); s.fara_cheie++ }
    if (['strada', 'sat_adresa', 'comuna', 'judet', 'cod_postal', 'telefon', 'email'].some(c => v(c))) {
      rez.contacte.push({ cheie_detinator: cheieD, adresa_strada: v('strada') || null, adresa_sat: v('sat_adresa') || null, adresa_comuna: v('comuna') || null, adresa_judet: v('judet') || null, cod_postal: v('cod_postal') || null, telefon: v('telefon') || null, email: v('email') || null, adresa_cunoscuta: adresaCunoscuta })
    }
  }
  // Județul implicit (al UAT-ului) intră doar unde niciun rând (nici dublura) nu a dat un județ explicit (Copilot f3b r3 P2-01)
  for (const c of rez.contacte) if (!c.adresa_judet) c.adresa_judet = judetDet.get(c.cheie_detinator) ?? null
  for (const camp of ['parcele', 'detinatori', 'contacte', 'dubluri', 'neidentificati', 'fara_cheie']) st[camp] = rez[camp].length
  const eligibile = new Set(rez.parcele.filter(p => p.cheie_sursa).map(p => p.cheie))
  const detEligibili = rez.detinatori.filter(d => eligibile.has(d.cheie_parcela))
  const cheiDet = new Set(detEligibili.map(d => d.cheie))
  st.parcele_de_importat = eligibile.size; st.detinatori_de_importat = detEligibili.length
  st.contacte_de_importat = rez.contacte.filter(c => cheiDet.has(c.cheie_detinator)).length
  return rez
}
