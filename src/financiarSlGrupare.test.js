import { describe, it, expect } from 'vitest'
import { normalizeazaNrFactura, grupeazaSlFaraFactura, sorteazaCronologic, decidePrecompletare, citesteDateGenerareSL, citesteValoriSL, citesteContractBenef } from './financiarSlGrupare.js'

describe('normalizeazaNrFactura', () => {
  it('formele scrise de mână ajung la SERIE-NR', () => {
    for (const t of ['gaz 418', 'GAZ-418', 'Gaz418', '  gaz   418  ', 'gaz - 418', 'gaz--418', 'gaz\t418', 'GAZ-0418'])
      expect(normalizeazaNrFactura(t)).toEqual({ serie: 'GAZ', nr: 418, canonic: 'GAZ-418' })
    expect(normalizeazaNrFactura('ph 7')).toEqual({ serie: 'PH', nr: 7, canonic: 'PH-7' })
  })
  it('gol / lipsă / format nerecunoscut = null', () => {
    for (const t of [null, undefined, '', '   ', '418', 'GAZ', 'GAZ 418/419', 'GAZ-418, GAZ-419', 'GAZ 418 bis',
      'GAZ.418', 'GAZ_418', '418 GAZ', 'GAZ 0', 'GAZ\n418', 'gaz 418\r\n', 'GĂZ 418', 'GAZ 99999999999999999999'])
      expect(normalizeazaNrFactura(t)).toBeNull()
  })
})

describe('sorteazaCronologic', () => {
  it('an, lună, id; an/lună lipsă la final; nu modifică intrarea', () => {
    const in_ = [{ id: 5, an: 2026, luna: 3 }, { id: 2, an: 2026, luna: 3 }, { id: 9, an: null, luna: 1 }, { id: 1, an: 2025, luna: 12 }, { id: 3, an: 2026, luna: 1 }]
    const copie = JSON.stringify(in_)
    expect(sorteazaCronologic(in_).map(x => x.id)).toEqual([1, 3, 2, 5, 9])
    expect(JSON.stringify(in_)).toBe(copie)
  })
})

describe('grupeazaSlFaraFactura', () => {
  const sl = (id, proiect_id, an, luna) => ({ id, proiect_id, an, luna, nr_situatie: `SL${id}`, cod_intern: `P${proiect_id}` })

  it('cazul din tichet: 4 SL ale aceluiași proiect cu "gaz 418" scris diferit = un grup, ordonat cronologic', () => {
    const alert = [sl(14, 7, 2026, 9), sl(11, 7, 2026, 6), sl(13, 7, 2026, 8), sl(12, 7, 2026, 7), sl(20, 7, 2026, 10)]
    const nr = { 11: 'gaz 418', 12: 'GAZ-418', 13: 'Gaz418', 14: ' gaz  418 ', 20: null }
    const r = grupeazaSlFaraFactura(alert, nr)
    expect(r.map(x => x.tip)).toEqual(['grup', 'individual'])
    expect(r[0]).toMatchObject({ proiect_id: 7, serie: 'GAZ', nr: 418, canonic: 'GAZ-418' })
    expect(r[0].sl.map(x => x.id)).toEqual([11, 12, 13, 14])
    expect(r[1].sl.map(x => x.id)).toEqual([20])
    expect(r[1].nr_factura_text).toBeNull()
  })

  it('proiecte diferite cu același număr = grupuri separate', () => {
    const alert = [sl(1, 7, 2026, 1), sl(2, 8, 2026, 1), sl(3, 7, 2026, 2), sl(4, 8, 2026, 2)]
    const nr = new Map([[1, 'gaz 418'], [2, 'GAZ 418'], [3, 'GAZ-418'], [4, 'gaz-418']])
    const r = grupeazaSlFaraFactura(alert, nr)
    expect(r.map(x => [x.tip, x.proiect_id, x.sl.map(s => s.id)])).toEqual([['grup', 7, [1, 3]], ['grup', 8, [2, 4]]])
    expect(new Set(r.map(x => x.cheie)).size).toBe(2)
  })

  it('proiect_id ca text vs număr = același proiect (cheia e pe text)', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, '7', 2026, 2)], { 1: 'gaz 418', 2: 'gaz 418' })
    expect(r).toHaveLength(1)
    expect(r[0].sl.map(s => s.id)).toEqual([1, 2])
  })

  it('același proiect, numere diferite = nu se grupează; un singur SL cu număr rămâne individual', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, 7, 2026, 3)], { 1: 'gaz 418', 2: 'gaz 419', 3: 'GAZ-419' })
    expect(r.map(x => [x.tip, x.sl.map(s => s.id)])).toEqual([['individual', [1]], ['grup', [2, 3]]])
    expect(r[0].nr_recunoscut).toBe('GAZ-418')
    expect(r[0].nr_factura_text).toBe('gaz 418')
  })

  it('serii diferite cu același număr = grupuri diferite', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, 7, 2026, 3), sl(4, 7, 2026, 4)],
      { 1: 'gaz 5', 2: 'ph 5', 3: 'GAZ5', 4: 'PH-5' })
    expect(r.map(x => [x.canonic, x.sl.map(s => s.id)])).toEqual([['GAZ-5', [1, 3]], ['PH-5', [2, 4]]])
  })

  it('format nerecunoscut sau fără proiect = individual, textul brut rămâne vizibil', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2), sl(3, null, 2026, 3), sl(4, null, 2026, 4)],
      { 1: 'GAZ 418/419', 2: 'GAZ 418/419', 3: 'gaz 418', 4: 'gaz 418' })
    expect(r.every(x => x.tip === 'individual')).toBe(true)
    expect(r.map(x => x.nr_factura_text)).toEqual(['GAZ 418/419', 'GAZ 418/419', 'gaz 418', 'gaz 418'])
    expect(r.map(x => x.nr_recunoscut)).toEqual([null, null, 'GAZ-418', 'GAZ-418'])
  })

  it('fără hartă de numere (citire eșuată) = toate individuale', () => {
    const r = grupeazaSlFaraFactura([sl(1, 7, 2026, 1), sl(2, 7, 2026, 2)], null)
    expect(r.map(x => x.tip)).toEqual(['individual', 'individual'])
  })

  it('proprietate: fiecare SL apare exact o dată, pe combinații aleatoare', () => {
    let seed = 12345
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const forme = [null, '', 'gaz 1', 'GAZ-1', 'gaz 2', 'ph 1', '1', 'GAZ 1/2']
    for (let k = 0; k < 200; k++) {
      const n = 1 + rnd(12)
      const alert = [], nr = {}
      for (let i = 1; i <= n; i++) { alert.push(sl(i, rnd(3) === 0 ? null : 1 + rnd(3), 2026, 1 + rnd(12))); nr[i] = forme[rnd(forme.length)] }
      const r = grupeazaSlFaraFactura(alert, nr)
      const ids = r.flatMap(x => x.sl.map(s => s.id)).sort((a, b) => a - b)
      expect(ids).toEqual(alert.map(s => s.id).sort((a, b) => a - b))
      for (const g of r.filter(x => x.tip === 'grup')) {
        expect(g.sl.length).toBeGreaterThanOrEqual(2)
        expect(new Set(g.sl.map(s => String(s.proiect_id))).size).toBe(1)
        expect(new Set(g.sl.map(s => normalizeazaNrFactura(nr[s.id]).canonic))).toEqual(new Set([g.canonic]))
      }
    }
  })
})

describe('decidePrecompletare', () => {
  const SERII = ['GAZ', 'PH', 'PX']
  const g = { serie: 'GAZ', nr: 418, canonic: 'GAZ-418' }
  it('serie existentă + număr liber = precompletat', () => {
    expect(decidePrecompletare(g, SERII, { stare: 'liber' })).toMatchObject({ serie: 'GAZ', nr: 418 })
  })
  it('număr deja folosit = gol + mesaj', () => {
    const d = decidePrecompletare(g, SERII, { stare: 'folosit' })
    expect(d.nr).toBeNull()
    expect(d.mesaj).toMatch(/deja folosit/)
  })
  it('eroare la verificare = gol (nu se presupune liber)', () => {
    for (const v of [{ stare: 'eroare' }, null, undefined, {}, { stare: 'altceva' }]) {
      const d = decidePrecompletare(g, SERII, v)
      expect(d.nr).toBeNull()
      expect(d.mesaj).toMatch(/Nu am putut verifica/)
    }
  })
  it('serie inexistentă = nimic precompletat, chiar dacă numărul ar fi liber', () => {
    const d = decidePrecompletare({ serie: 'XYZ', nr: 418, canonic: 'XYZ-418' }, SERII, { stare: 'liber' })
    expect([d.serie, d.nr]).toEqual([null, null])
    expect(d.mesaj).toMatch(/nu există/)
  })
  it('grup fără număr valid = nimic precompletat', () => {
    expect(decidePrecompletare(null, SERII, { stare: 'liber' })).toMatchObject({ serie: null, nr: null })
    expect(decidePrecompletare({ serie: 'GAZ', nr: 0 }, SERII, { stare: 'liber' })).toMatchObject({ serie: null, nr: null })
  })
})

// Review #1188 P1: citirile pentru generarea liniilor. Client Supabase fals: fiecare cerere e (tabel, filtre, mod)
// și răspunsul vine din `raspunde` (poate fi { data, error }, o excepție aruncată sau o promisiune respinsă).
function clientFals(raspunde) {
  const cereri = []
  const client = {
    from: tabel => {
      const c = { tabel, filtre: {}, unul: false }
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (k, v) => { c.filtre[k] = v; return q },
        maybeSingle: () => { c.unul = true; return q },
        single: () => { c.unul = true; c.single = true; return q },
        then: (res, rej) => { cereri.push(c); return Promise.resolve().then(() => raspunde(c)).then(res, rej) },
      }
      return q
    },
  }
  return { client, cereri }
}
const SL_RAND = { 11: { valoare_baza_lei: '1000.50', valoare_ajustare_lei: '0', valoare_ajustata_lei: '1000.50', coeficient_ajustare: null },
  12: { valoare_baza_lei: '2000', valoare_ajustare_lei: '150.25', valoare_ajustata_lei: '2150.25', coeficient_ajustare: '1.0751' } }
const serverBun = (peste = {}) => c => {
  const k = `${c.tabel}:${c.filtre.id ?? c.filtre.sl_id}`
  if (Object.prototype.hasOwnProperty.call(peste, k)) { const r = peste[k]; if (typeof r === 'function') return r(c); return r }
  if (c.tabel === 'executie_proiecte') return { data: { contract_id: 3, nr_contract: 'NR-P' }, error: null }
  if (c.tabel === 'contracte_terti') return { data: { numar_contract: '30', data_semnare: null, denumire: 'Lot 1', termen_plata_zile: 45, beneficiar_id: 5 }, error: null }
  if (c.tabel === 'beneficiari') return { data: { id: 5, nume: 'BENEFICIAR SA', retine_gbe_pct: 0, retine_car_pct: 0 }, error: null }
  if (c.tabel === 'executie_situatii_plata') return { data: SL_RAND[c.filtre.id] ?? null, error: null }
  return { data: [], error: null }   // ajustări + linii pe obiect
}
const SL2 = [{ id: 11, nr_situatie: '3' }, { id: 12, nr_situatie: '4' }]

describe('citesteDateGenerareSL (eroare ≠ zero)', () => {
  it('toate citirile bune: valorile vin exact din BD, contractul o singură dată, ordinea SL păstrată', async () => {
    const { client, cereri } = clientFals(serverBun())
    const r = await citesteDateGenerareSL(client, 7, SL2)
    expect(r.contractInfo).toMatchObject({ contractRef: '30', contractDenumire: 'Lot 1', termenPlata: 45, benef: { id: 5, nume: 'BENEFICIAR SA' } })
    expect(r.perSL.map(x => x.sl.id)).toEqual([11, 12])
    expect(r.perSL[0].slVals).toEqual({ valBaza: 1000.5, valAjust: 0, valTotal: 1000.5, coefAjust: 0, ajustariRetro: [] })
    expect(r.perSL[1].slVals).toEqual({ valBaza: 2000, valAjust: 150.25, valTotal: 2150.25, coefAjust: 1.0751, ajustariRetro: [] })
    expect(cereri.filter(c => c.tabel === 'contracte_terti')).toHaveLength(1)
    // fără .single(): un rând lipsă nu e confundat cu o eroare de rețea (și invers)
    expect(cereri.some(c => c.single)).toBe(false)
  })

  const cazuriEroare = [
    ['valorile celei de-a doua SL întorc error', { 'executie_situatii_plata:12': { data: null, error: { message: 'canceling statement due to statement timeout' } } }, /valorile pentru SL 4: canceling statement/],
    ['valorile celei de-a doua SL aruncă excepție', { 'executie_situatii_plata:12': () => { throw new TypeError('Failed to fetch') } }, /valorile pentru SL 4: Failed to fetch/],
    ['a doua SL nu mai există (rând lipsă)', { 'executie_situatii_plata:12': { data: null, error: null } }, /Nu am găsit SL 4/],
    ['ajustările retroactive ale celei de-a doua SL întorc error', { 'executie_sl_ajustari:12': { data: null, error: { message: 'permission denied' } } }, /ajustările retroactive pentru SL 4: permission denied/],
    ['liniile pe obiect ale celei de-a doua SL întorc error', { 'executie_situatii_plata_linii:12': { data: null, error: { code: '57014' } } }, /liniile pe obiect pentru SL 4: 57014/],
    ['liniile pe obiect ating plafonul de 1000 (posibil trunchiate)', { 'executie_situatii_plata_linii:12': { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null } }, /Prea multe rânduri la liniile pe obiect pentru SL 4/],
    ['valoare nenumerică pe SL', { 'executie_situatii_plata:12': { data: { valoare_baza_lei: 'abc' }, error: null } }, /Valoare nenumerică la valoarea de bază pentru SL 4/],
    ['contractul proiectului întoarce error', { 'contracte_terti:3': { data: null, error: { message: 'JWT expired' } } }, /contractul proiectului: JWT expired/],
    ['beneficiarul întoarce error', { 'beneficiari:5': { data: null, error: { message: 'boom' } } }, /beneficiarul contractului: boom/],
    ['proiectul întoarce error', { 'executie_proiecte:7': { data: null, error: { message: 'x' } } }, /proiectul \(contractul legat\): x/],
  ]
  for (const [nume, peste, mesaj] of cazuriEroare) {
    it(`oprește generarea: ${nume}`, async () => {
      const { client } = clientFals(serverBun(peste))
      const p = citesteDateGenerareSL(client, 7, SL2)
      await expect(p).rejects.toMatchObject({ name: 'EroareCitireSL' })
      await expect(citesteDateGenerareSL(clientFals(serverBun(peste)).client, 7, SL2)).rejects.toThrow(mesaj)
    })
  }

  it('eroarea poartă SL-ul în cauză', async () => {
    const { client } = clientFals(serverBun({ 'executie_situatii_plata:12': { data: null, error: { message: 'x' } } }))
    const e = await citesteDateGenerareSL(client, 7, SL2).catch(x => x)
    expect(e.sl).toEqual(SL2[1])
  })

  it('fără contract / fără beneficiar / proiect fără rând = „fără contract”, NU eroare (ca înainte)', async () => {
    const fara = await citesteContractBenef(clientFals(serverBun({ 'executie_proiecte:7': { data: { contract_id: null, nr_contract: 'NR-P' }, error: null } })).client, 7)
    expect(fara).toEqual({ contractRef: 'NR-P', contractDenumire: '', benef: null, termenPlata: null, contactContract: null })
    const lipsa = await citesteContractBenef(clientFals(serverBun({ 'contracte_terti:3': { data: null, error: null } })).client, 7)
    expect(lipsa.benef).toBeNull()
    expect(lipsa.contractRef).toBe('NR-P')
    const faraProiect = await citesteContractBenef(clientFals(() => { throw new Error('nu trebuia citit') }).client, null)
    expect(faraProiect.benef).toBeNull()
  })

  it('ajustările retroactive se întorc în ordinea din BD', async () => {
    const aj = [{ sl_ajustata_nr: '1', valoare_ajustare_lei: '10', coeficient: '1.01' }, { sl_ajustata_nr: '2', valoare_ajustare_lei: '-5', coeficient: null }]
    const v = await citesteValoriSL(clientFals(serverBun({ 'executie_sl_ajustari:11': { data: aj, error: null } })).client, SL2[0])
    expect(v.ajustariRetro).toEqual(aj)
  })
})
