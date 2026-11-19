// Simulatorul PROCEDURII Testului 1 (docs/redari/FAN_TEST1_PASI.md): parcurge tabelele de pași din document — primul plic (§5–§8), lotul de 3
// (§9) și încheierea (§10) — pe o „lume” cu mai multe loturi, de la LOT GOL (niciun rând FAN, lot nemarcat, plicurile cu toate datele), apăsând
// DOAR butoane pe care ecranul le arată active (stariPasi / stareMarcaj / stariOperatii din fanLot.js, cu starea de după fiecare pas) și
// executând VERIFICĂRILE fără buton ale procedurii (recitirea plafonului, verificarea de dinaintea primei aprobări, selfAWB, tariful, eticheta,
// pagina de control) ca reguli: o verificare lipsă, mutată sau cu altă valoare = eroare la pasul care depinde de ea.
// Identificatorul unui pas e coloana „Acțiune” a tabelului (vocabular închis, mai jos), nu formularea din „Ce apasă” (runda 3, Jakarinos #1130 r2 P3:
// „`1`” vs „1” nu contează; reformulările nevinovate nu pică testul). Documentele vechi, înghețate în git (9ceea228, 9fb88b2f), n-au coloana:
// pentru ele există modul `legacy`, care recunoaște butoanele și verificările din text — DOAR ca să dovedească că constatările recenzentului erau reale
// (9ceea228: „Propune” înaintea marcajului; 9fb88b2f: continuarea cu trei plicuri „repetă §5–§8”, dar verificarea GLOBALĂ din §6 nu mai trece după primul AWB).
// Regulile BD simulate sunt scrise de mână după migrarea 20261212a (L25): aprobarea cere marcajul și plafonul (deja aprobate / trimise pe ACEST lot +
// cele noi ≤ plafon; plafonul e global ca valoare și numărat pe lot), prima aprobare fixează marcajul, propunerea rescrie rândurile „propus”.
// Folosit de fanCourier.test.js (documentul curent) și fanCourierMutanti.test.js (documentele vechi TREBUIE să pice; mutanții ordinii din cod la fel).

/** Codurile de BUTON (coloana „Acțiune” → cheia din ecran, cum o dau stariPasi / stariOperatii / stareMarcaj). `plafon` cere valoarea: `plafon=N`. */
export const ACTIUNI_BUTON = Object.freeze({ 'marcaj-test': 'marcaj_test', evenimente: 'evenimente', plafon: 'plafon', propune: 'propune', aproba: 'aproba', genereaza: 'genereaza', etichete: 'etichete' })
/** Codurile VERIFICĂRILOR fără buton (precondiții ale pașilor următori). `verifica-plafon` cere valoarea recitită: `verifica-plafon=N`. */
export const ACTIUNI_VERIFICARE = Object.freeze(['verifica-plafon', 'verifica-fara-aprobari', 'verifica-lot-nou', 'verifica-selfawb', 'verifica-tarif', 'verifica-eticheta', 'verifica-control', 'tipareste'])
const CU_VALOARE = ['plafon', 'verifica-plafon']
export const VOCABULAR = Object.freeze([...Object.keys(ACTIUNI_BUTON), ...ACTIUNI_VERIFICARE])

/** Acțiunea dintr-o celulă „Acțiune” (cu sau fără accente grave): { cod, cheie (butonul din ecran sau null), valoare (N sau null), text } | null (necunoscută). */
export function actiuneDin(celula) {
  const t = String(celula ?? '').replace(/`/g, '').trim()
  const m = t.match(/^([a-z-]+)(?:=(\d+))?$/)
  if (!m) return null
  const [, cod, val] = m
  if (val != null && !CU_VALOARE.includes(cod)) return null
  const valoare = val == null ? null : Number(val)
  if (cod in ACTIUNI_BUTON) return { cod, cheie: ACTIUNI_BUTON[cod], valoare, text: t }
  if (ACTIUNI_VERIFICARE.includes(cod)) return { cod, cheie: null, valoare, text: t }
  return null
}

/** Documentele VECHI (fără coloana „Acțiune”, înghețate în git): butonul după textul din „Ce apasă” (textele exacte ale ecranului de atunci). */
export function butonDin(text) {
  const t = String(text || '')
  const cu = (cod, valoare = null) => ({ ...actiuneDin(cod), valoare, text: valoare == null ? cod : `${cod}=${valoare}`, legacy: true })
  if (/Marchează TEST/.test(t)) return cu('marcaj-test')
  if (/Schimbă plafonul/.test(t)) { const m = t.match(/`(\d+)`/); return cu('plafon', m ? Number(m[1]) : NaN) }
  if (/Propune/.test(t)) return cu('propune')
  if (/Aprobă/.test(t)) return cu('aproba')
  if (/Generează AWB/.test(t)) return cu('genereaza')
  if (/Lista de evenimente FAN/.test(t)) return cu('evenimente')
  if (/Etichete/.test(t)) return cu('etichete')
  return null
}
/** Documentele VECHI: verificările fără buton, după formularea de atunci (9fb88b2f §6–§8); fără valoare la recitire (nu se compară). */
const verificareVeche = text => {
  const t = String(text || '')
  const cod = /recitirea din BD/.test(t) ? 'verifica-plafon' : /NU există aprobări/.test(t) ? 'verifica-fara-aprobari' : /selfAWB/.test(t) ? 'verifica-selfawb'
    : /^ERP: rândul FAN/.test(t) ? 'verifica-tarif' : /^PDF-ul/.test(t) ? 'verifica-eticheta' : /^pagina de control/.test(t) ? 'verifica-control' : /imprimanta/.test(t) ? 'tipareste' : null
  return cod ? { ...actiuneDin(cod), legacy: true } : null
}

/**
 * Pașii din tabelele documentului între două titluri (ex. „## 5.” → „## 9.”): rândurile cu numărul pasului în prima coloană („#”), cu „Cine”,
 * „Acțiune” (identificatorul stabil) și „Ce apasă” (text liber). Fiecare tabel cu pași trebuie să aibă coloana „Acțiune”, iar fiecare cod să fie
 * din vocabular (cu valoarea, unde e cerută) — altfel eroare: un cod greșit nu trece drept „pas fără buton”. legacy = documentele vechi, fără
 * coloană: butonul și verificarea se recunosc din text (rândurile nerecunoscute rămân cu actiune null și nu fac nimic).
 */
export function pasiDinDocument(text, deLa, panaLa, { legacy = false } = {}) {
  const d = String(text).replace(/\r/g, '')
  const a = d.indexOf(deLa), b = d.indexOf(panaLa)
  if (a < 0 || b < 0 || b <= a) throw new Error(`secțiunile ${deLa} … ${panaLa} lipsesc din document`)
  const pasi = []
  let col = null   // coloana „Acțiune” a tabelului curent (din rândul de antet)
  for (const linie of d.slice(a, b).split('\n')) {
    if (!linie.trim().startsWith('|')) { col = null; continue }
    const cel = linie.split('|').map(s => s.trim())
    const antet = cel.findIndex(c => /^Ac[tț]iune$/i.test(c))
    if (antet > 0) { col = antet; continue }
    if (!/^\d+[a-z]?$/.test(cel[1] || '')) continue
    const nr = cel[1], cine = cel[2] || ''
    if (legacy) { const t = cel[3] || ''; pasi.push({ nr, cine, text: t, actiune: butonDin(t) || verificareVeche(t), legacy: true }); continue }
    if (col == null) throw new Error(`pasul ${nr}: tabelul nu are coloana „Acțiune” (identificatorul stabil al pasului)`)
    const actiune = actiuneDin(cel[col])
    if (!actiune) throw new Error(`pasul ${nr}: acțiune necunoscută „${cel[col]}” (vocabularul: ${VOCABULAR.join(', ')})`)
    if (CU_VALOARE.includes(actiune.cod) && actiune.valoare == null) throw new Error(`pasul ${nr}: acțiunea „${actiune.cod}” cere valoarea (${actiune.cod}=N)`)
    pasi.push({ nr, cine, text: cel[col + 1] || '', actiune })
  }
  if (!pasi.length) throw new Error(`niciun pas cu acțiune între ${deLa} și ${panaLa}`)
  return pasi
}

/** Plicurile lotului simulat, „pregătite” ca în ecran (toate cu datele complete, același hash `h1` cât datele nu se schimbă). */
const pregatite = lot => Array.from({ length: lot.plicuri }, (_, i) => ({ ok: true, plic: { id: `pl${i + 1}` }, hash: 'h1' }))
/** Ce e de propus pe lot (18.11.2026): ACEEAȘI definiție ca ecranul (fanLot.starePropunere) — fără rând FAN viu, sau viu „propus” / „aprobat” pe alt
 *  hash; după generarea tuturor plicurilor „1. Propune” se dezactivează („nimic de propus”). Codul fără starePropunere (forme vechi): toate plicurile. */
const propunere = (lot, fn) => (fn.starePropunere ? fn.starePropunere({ pregatite: pregatite(lot), randuri: lot.randuri }) : { dePropus: pregatite(lot), motiv: '' })
const argumentePasi = (lot, fn, comun) => { const p = propunere(lot, fn); return { ...comun, gataDePropus: p.dePropus.length, motivPropunere: p.motiv } }

/** Starea ecranului pentru starea simulată a unui lot: cheile active ale pașilor + operațiilor + marcajul (TEST și, dacă e activ, real). */
export function activeIn(lot, fn, actor) {
  const { stariPasi, stareMarcaj, stariOperatii, stareMarcajReal } = fn
  const comun = { transportActiv: true, evidentaInstalata: true, proiectCod: lot.proiectCod, fanLot: lot.fanLot, randuri: lot.randuri, ...actor }
  const chei = new Set(stariPasi(argumentePasi(lot, fn, comun)).filter(p => p.activ).map(p => p.cheie))
  for (const o of stariOperatii(comun)) if (o.activ) chei.add(o.cheie)
  if (stareMarcaj(comun).activ) chei.add('marcaj_test')
  if (stareMarcajReal && stareMarcajReal(comun).activ) chei.add('marcaj_real')   // 18.11: niciodată activ cât garda „doar TEST” e pornită
  return [...chei].sort()
}

/** Lumea simulată: setările (plafonul global + dacă a fost recitit după ultima schimbare) și loturile, pe nume. */
export function lumeNoua({ limita = 20 } = {}) { return { setari: { limita, recitit: true }, loturi: {}, awb: 3000000000 } }
const actorDin = cine => ({ esteOwner: /owner/i.test(cine), poateScrie: /admin|editor|owner/i.test(cine), esteAdmin: /admin/i.test(cine) })
const VII = ['aprobat', 'in_curs', 'generat', 'necunoscut', 'ridicat']   // „aprobate / trimise”: NOT IN (propus, eroare, anulat), ca în fn_red_fan_aproba
const vii = r => r.filter(x => VII.includes(x.stare))
const INCHEIATE = ['generat', 'anulat', 'eroare']   // istoricul unui lot încheiat: nimic „în curs” / „necunoscut” / neaprobat

/**
 * Parcurge pașii (pasiDinDocument) pe funcțiile de ecran date, pe lotul `lot` din `lume` (un lot nou e gol și nemarcat). Întoarce
 * { lume, lot, jurnal }: pe fiecare pas, butoanele active ÎNAINTE de apăsare și starea după. Aruncă la primul buton inactiv („pasul N (cod): „…”
 * nu e activ în ecran (<motivul>)”), la o regulă BD încălcată (marcaj lipsă, plafon depășit) sau la o regulă a PROCEDURII încălcată: aprobarea fără
 * recitirea plafonului sau fără verificarea de dinainte; recitirea cu altă valoare decât cea pusă; verificarea globală când există deja istoric;
 * eticheta fără verificarea în selfAWB și a tarifului; tipărirea fără verificarea etichetei și a paginii de control.
 * respinse = pozițiile (1…N) pe care FAN le respinge la generare (simulat: rândul devine „eroare”).
 */
export function parcurge(pasi, fn, { lume = lumeNoua(), lot: numeLot = 'PP-xxxx', proiectCod = 'TEST-RAZVAN', plicuri = 1, respinse = [] } = {}) {
  const lot = lume.loturi[numeLot] || (lume.loturi[numeLot] = { nume: numeLot, proiectCod, fanLot: null, randuri: [], plicuri, verificat: false, selfawb: false, tarif: false, eticheta: false, control: false, tiraj: 0 })
  const jurnal = []
  for (const p of pasi) {
    const actor = actorDin(p.cine)
    const inainte = activeIn(lot, fn, actor)
    const a = p.actiune
    if (!a) { jurnal.push({ nr: p.nr, actiune: null, inainte }); continue }   // legacy: rând nerecunoscut (verificare în text liber)
    const eroare = m => new Error(`pasul ${p.nr} (${a.text}): ${m}`)
    if (a.cheie && !inainte.includes(a.cheie)) {
      const comun = { transportActiv: true, evidentaInstalata: true, proiectCod: lot.proiectCod, fanLot: lot.fanLot, randuri: lot.randuri, ...actor }
      const motiv = a.cheie === 'marcaj_test' ? fn.stareMarcaj(comun).motiv
        : (fn.stariPasi(argumentePasi(lot, fn, comun)).find(x => x.cheie === a.cheie) || fn.stariOperatii(comun).find(x => x.cheie === a.cheie) || {}).motiv
      throw eroare(`„${p.text}” nu e activ în ecran (${motiv || 'buton necunoscut'}); active: ${inainte.join(', ') || '-'}`)
    }
    const generate = () => lot.randuri.filter(x => x.stare === 'generat').length
    switch (a.cod) {
      case 'marcaj-test': lot.fanLot = { ...(lot.fanLot || {}), test: true, prima_aprobare_la: lot.fanLot?.prima_aprobare_la ?? null }; break
      case 'evenimente': break
      case 'plafon':
        if (!Number.isInteger(a.valoare) || a.valoare < 1 || a.valoare > 2000) throw eroare('plafonul lipsește din acțiune (plafon=N, 1…2000)')
        lume.setari = { limita: a.valoare, recitit: false }; break   // scăderea NU retrage aprobări; recitirea din BD e obligatorie după schimbare
      case 'verifica-plafon':
        if (a.valoare != null && lume.setari.limita !== a.valoare) throw eroare(`recitirea din BD arată plafonul ${lume.setari.limita}, documentul așteaptă ${a.valoare}`)
        lume.setari.recitit = true; break
      case 'verifica-fara-aprobari': {   // verificarea inițială GLOBALĂ (înaintea primului plic): zero aprobări / trimiteri oriunde, exact un lot marcat = acesta
        const toate = Object.values(lume.loturi)
        const cuIstoric = toate.filter(l => vii(l.randuri).length || l.fanLot?.prima_aprobare_la)
        if (cuIstoric.length) throw eroare(`verificarea globală „fără aprobări / trimiteri” nu poate trece: ${cuIstoric.map(l => `${l.nume}: ${l.randuri.map(r => r.stare).join(', ') || 'aprobat o dată'}`).join('; ')} (istoricul rămâne în red_fan_awb / red_fan_loturi)`)
        const marcate = toate.filter(l => l.fanLot)
        if (marcate.length !== 1 || marcate[0] !== lot || lot.fanLot.test !== true) throw eroare(`red_fan_loturi nu are exact un rând = acest lot, marcat TEST (marcate: ${marcate.map(l => l.nume).join(', ') || '-'})`)
        lot.verificat = true; break }
      case 'verifica-lot-nou': {   // continuarea: lotul NOU gol și marcat; istoricul celorlalte loturi încheiat și cu verdictul 4a
        const istoric = Object.values(lume.loturi).filter(l => l !== lot)
        if (!istoric.length) throw eroare('nu există niciun lot anterior: înaintea primului plic verificarea e cea globală (verifica-fara-aprobari)')
        if (lot.fanLot?.test !== true || lot.fanLot.prima_aprobare_la || lot.randuri.length) throw eroare('lotul nou trebuie să fie marcat TEST, neaprobat, fără rânduri FAN')
        for (const l of istoric) {
          if (!l.fanLot?.prima_aprobare_la) throw eroare(`lotul ${l.nume} din istoric nu a fost aprobat o dată: nu e un lot încheiat`)
          const rau = l.randuri.filter(r => !INCHEIATE.includes(r.stare))
          if (rau.length) throw eroare(`lotul ${l.nume} are rânduri neîncheiate (${rau.map(r => r.stare).join(', ')}): ambiguu, nu se continuă`)
          if (!l.selfawb) throw eroare(`verdictul 4a lipsește pe lotul ${l.nume}: asocierea AWB ↔ plic nu a fost verificată în selfAWB`)
        }
        lot.verificat = true; break }
      case 'propune': {   // ca fn_red_fan_propune: rândul viu propus / aprobat e rescris „propus”; fără rând viu (sau „eroare” / „anulat”) = rând nou
        for (const p of propunere(lot, fn).dePropus) {
          const i = lot.randuri.findIndex(r => r.plic_id === p.plic.id && !['eroare', 'anulat'].includes(r.stare))
          if (i >= 0) lot.randuri[i] = { ...lot.randuri[i], stare: 'propus', hash_date: p.hash }
          else lot.randuri.push({ id: `r${p.plic.id.slice(2)}${lot.randuri.some(r => r.plic_id === p.plic.id) ? 'b' : ''}`, plic_id: p.plic.id, stare: 'propus', hash_date: p.hash })
        }
        break }
      case 'aproba': {
        if (!lot.fanLot) throw eroare('aprobarea cere marcajul (fn_red_fan_aproba: P0001)')
        const noi = lot.randuri.filter(x => x.stare === 'propus').length
        if (vii(lot.randuri).length + noi > lume.setari.limita) throw eroare(`${vii(lot.randuri).length + noi} plicuri peste plafonul ${lume.setari.limita} (fn_red_fan_aproba: P0001)`)
        if (!lume.setari.recitit) throw eroare('plafonul nu a fost recitit din BD după schimbare (procedura cere verifica-plafon=N înaintea aprobării)')
        if (!lot.fanLot.prima_aprobare_la && !lot.verificat) throw eroare('prima aprobare fără verificarea de dinainte (verifica-fara-aprobari la primul plic, verifica-lot-nou la lotul următor)')
        lot.randuri = lot.randuri.map(x => (x.stare === 'propus' ? { ...x, stare: 'aprobat' } : x))
        lot.fanLot = { ...lot.fanLot, prima_aprobare_la: lot.fanLot.prima_aprobare_la || '2026-11-18T08:00:00Z' }
        break }
      case 'genereaza':
        lot.randuri = lot.randuri.map((x, i) => x.stare !== 'aprobat' ? x
          : respinse.includes(i + 1) ? { ...x, stare: 'eroare', motiv: 'respins de FAN (simulat): localitate' } : { ...x, stare: 'generat', awb: String(++lume.awb), tarif: 12.5 })
        lot.selfawb = false; lot.tarif = false; break   // AWB-uri noi: verificările în selfAWB și a tarifului se refac
      case 'verifica-selfawb': if (!generate()) throw eroare('niciun AWB generat de verificat în selfAWB'); lot.selfawb = true; break
      case 'verifica-tarif': if (!generate()) throw eroare('niciun rând „AWB generat” cu tarif de verificat'); lot.tarif = true; break
      case 'etichete':
        if (!lot.selfawb || !lot.tarif) throw eroare('eticheta înaintea verificării în selfAWB și a tarifului (tarif gol / diferit = OPRIRE)')
        lot.tiraj = lot.tiraj || 1; break   // a doua descărcare = același tiraj
      case 'verifica-eticheta': if (!lot.tiraj) throw eroare('nicio etichetă descărcată'); lot.eticheta = true; break
      case 'verifica-control': if (!lot.tiraj) throw eroare('nicio pagină de control descărcată'); lot.control = true; break
      case 'tipareste': if (!lot.eticheta || !lot.control) throw eroare('tipărirea înaintea verificării etichetei (numărul plicului) și a paginii de control'); break
      default: throw eroare(`acțiune nesimulată ${a.cod}`)
    }
    jurnal.push({ nr: p.nr, actiune: a.cod, text: a.text, inainte, dupa: activeIn(lot, fn, actor) })
  }
  return { lume, lot, jurnal }
}
