// Simulatorul PROCEDURII Testului 1 (docs/redari/FAN_TEST1_PASI.md): parcurge tabelele de pași din document, de la LOT GOL (niciun rând FAN,
// lot nemarcat, un plic cu toate datele) până la prima generare permisă, apăsând DOAR butoane pe care ecranul le arată active (stariPasi /
// stareMarcaj / stariOperatii din fanLot.js, cu starea de după fiecare pas). O ordine care nu se poate executa din ecran (ex. „Propune” sau
// plafonul înaintea marcajului TEST, cât garda „doar TEST” le dezactivează) = eroare la pasul respectiv — așa a fost prinsă constatarea
// recenzentului pe PR #1130 (ordinea din 9ceea228). Regulile BD simulate sunt scrise de mână după migrarea 20261212a (L25): aprobarea cere
// marcajul și plafonul (deja aprobate / trimise + cele noi ≤ plafon), prima aprobare fixează marcajul, propunerea rescrie rândurile „propus”.
// Folosit de fanCourier.test.js (documentul curent) și fanCourierMutanti.test.js (documentul vechi TREBUIE să pice; mutanții ordinii din cod la fel).

/** Butoanele recunoscute în coloana „Ce apasă” a tabelelor: textul din document → cheia simulată (și valoarea plafonului, din `N`). */
export function butonDin(text) {
  const t = String(text || '')
  if (/Marchează TEST/.test(t)) return { cheie: 'marcaj_test' }
  if (/Schimbă plafonul/.test(t)) { const m = t.match(/`(\d+)`/); return { cheie: 'plafon', valoare: m ? Number(m[1]) : NaN } }
  if (/Propune/.test(t)) return { cheie: 'propune' }
  if (/Aprobă/.test(t)) return { cheie: 'aproba' }
  if (/Generează AWB/.test(t)) return { cheie: 'genereaza' }
  if (/Lista de evenimente FAN/.test(t)) return { cheie: 'evenimente' }
  if (/Etichete/.test(t)) return { cheie: 'etichete' }
  return null
}

/**
 * Pașii din tabelele documentului între două titluri (ex. „## 5.” → „## 9.”): rândurile cu numărul pasului în prima coloană, coloanele
 * „Cine” și „Ce apasă”. Rândurile fără buton recunoscut (verificări în selfAWB / BD) rămân în listă cu buton null (nu se apasă nimic).
 */
export function pasiDinDocument(text, deLa, panaLa) {
  const d = String(text).replace(/\r/g, '')
  const a = d.indexOf(deLa), b = d.indexOf(panaLa)
  if (a < 0 || b < 0 || b <= a) throw new Error(`secțiunile ${deLa} … ${panaLa} lipsesc din document`)
  const pasi = []
  for (const linie of d.slice(a, b).split('\n')) {
    const cel = linie.split('|').map(s => s.trim())
    if (cel.length < 5 || !/^\d+[a-z]?$/.test(cel[1])) continue
    pasi.push({ nr: cel[1], cine: cel[2], text: cel[3], buton: butonDin(cel[3]) })
  }
  if (!pasi.length) throw new Error(`niciun pas cu buton între ${deLa} și ${panaLa}`)
  return pasi
}

/** Starea ecranului pentru starea simulată: cheile active ale pașilor + operațiilor + marcajul. */
export function activeIn(lot, { stariPasi, stareMarcaj, stariOperatii }, actor) {
  const comun = { transportActiv: true, evidentaInstalata: true, proiectCod: lot.proiectCod, fanLot: lot.fanLot, randuri: lot.randuri, ...actor }
  const chei = new Set(stariPasi({ ...comun, gataDePropus: lot.plicuri }).filter(p => p.activ).map(p => p.cheie))
  for (const o of stariOperatii(comun)) if (o.activ) chei.add(o.cheie)
  if (stareMarcaj(comun).activ) chei.add('marcaj_test')
  return [...chei].sort()
}

const actorDin = cine => ({ esteOwner: /owner/i.test(cine), poateScrie: /admin|editor|owner/i.test(cine), esteAdmin: /admin/i.test(cine) })
const vii = r => r.filter(x => !['propus', 'eroare', 'anulat'].includes(x.stare)).length

/**
 * Parcurge pașii (pasiDinDocument) pe funcțiile de ecran date, de la lot gol. Întoarce jurnalul: pe fiecare pas, butoanele active ÎNAINTE de
 * apăsare și starea după. Aruncă la primul buton inactiv („pasul N: „…” nu e activ: <motivul>”) sau la o regulă BD încălcată (ex. plafon).
 * Precondiție (lotul gol, verificată): niciun rând FAN, lot nemarcat, plafonul implicit.
 */
export function parcurge(pasi, fn, { proiectCod = 'TEST-RAZVAN', plicuri = 1, limita = 20 } = {}) {
  const lot = { proiectCod, fanLot: null, randuri: [], plicuri, limita }
  const jurnal = []
  for (const p of pasi) {
    const actor = actorDin(p.cine)
    const inainte = activeIn(lot, fn, actor)
    if (!p.buton) { jurnal.push({ nr: p.nr, buton: null, inainte }); continue }
    const k = p.buton.cheie
    if (!inainte.includes(k)) {
      const comun = { transportActiv: true, evidentaInstalata: true, proiectCod: lot.proiectCod, fanLot: lot.fanLot, randuri: lot.randuri, ...actor }
      const motiv = k === 'marcaj_test' ? fn.stareMarcaj(comun).motiv
        : (fn.stariPasi({ ...comun, gataDePropus: lot.plicuri }).find(x => x.cheie === k) || fn.stariOperatii(comun).find(x => x.cheie === k) || {}).motiv
      throw new Error(`pasul ${p.nr}: „${p.text}” nu e activ în ecran (${motiv || 'buton necunoscut'}); active: ${inainte.join(', ') || '-'}`)
    }
    switch (k) {
      case 'marcaj_test': lot.fanLot = { ...(lot.fanLot || {}), test: true, prima_aprobare_la: lot.fanLot?.prima_aprobare_la ?? null }; break
      case 'plafon': if (!Number.isInteger(p.buton.valoare) || p.buton.valoare < 1 || p.buton.valoare > 2000) throw new Error(`pasul ${p.nr}: plafonul lipsește din text (\`N\`)`); lot.limita = p.buton.valoare; break
      case 'propune': lot.randuri = Array.from({ length: lot.plicuri }, (_, i) => ({ id: `r${i + 1}`, stare: 'propus' })); break
      case 'aproba': {
        if (!lot.fanLot) throw new Error(`pasul ${p.nr}: aprobarea cere marcajul (fn_red_fan_aproba: P0001)`)
        const noi = lot.randuri.filter(x => x.stare === 'propus').length
        if (vii(lot.randuri) + noi > lot.limita) throw new Error(`pasul ${p.nr}: ${vii(lot.randuri) + noi} plicuri peste plafonul ${lot.limita} (fn_red_fan_aproba: P0001)`)
        lot.randuri = lot.randuri.map(x => (x.stare === 'propus' ? { ...x, stare: 'aprobat' } : x))
        lot.fanLot = { ...lot.fanLot, prima_aprobare_la: lot.fanLot.prima_aprobare_la || '2026-11-18T08:00:00Z' }
        break
      }
      case 'genereaza': lot.randuri = lot.randuri.map((x, i) => (x.stare === 'aprobat' ? { ...x, stare: 'generat', awb: String(3000000001 + i) } : x)); break
      case 'evenimente': case 'etichete': break
      default: throw new Error(`pasul ${p.nr}: buton nesimulat ${k}`)
    }
    jurnal.push({ nr: p.nr, buton: k, inainte, dupa: activeIn(lot, fn, actor) })
  }
  return { lot, jurnal }
}
