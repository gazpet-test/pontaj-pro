// Regresie pe dovezile testului din 24.11.2026 (docs/ofertare/grafic_automat_test_jilava/): graficul Y generat de AI.
// Referința e calculul independent din cpm.py (Python) — grafic_Y_pert.txt și grafic_Y_ai.txt, scrise atunci, necitite de motor.
//  1. Pe calendarul de ATUNCI (luni–vineri FĂRĂ sărbători, mod schiță), motorul trebuie să dea exact aceleași ES/EF/LS/LF/marje
//     pentru toate cele 161 de activități și aceleași intervale pe rezumate.
//  2. Pe calendarul CORECT (cu sărbătorile legale), finalul devine 04.02.2027 și motorul trebuie să spună singur că termenul
//     de 3 luni (01.02.2027) e depășit — constatarea pe care în test a făcut-o abia verificatorul (spec §6.1).
import { describe, it, expect } from 'vitest'
import { calculeazaGrafic, tabelPERT, genereazaMSPDI } from './index.js'
import { citesteGraficY, liniiFisier, parseazaPredecesori } from '../../scripts/grafic/fixtura_jilava.mjs'

const citeste = (f) => liniiFisier(f)
const graficY = () => citesteGraficY()

describe('regresie Jilava — graficul Y (161 de activități)', () => {
  const y = graficY()
  const intrare = (calendar) => ({ mod: 'schita', data_start: '2026-11-02', termen: { tip: 'luni', valoare: 3 }, activitati: y.activitati, legaturi: y.legaturi, parametri: { calendar } })

  it('fixtura e citită întreagă (161 activități, 23 jaloane, rezumatele separat)', () => {
    const frunze = y.activitati.filter(a => !a.rezumat)
    expect(frunze.length).toBe(161)
    expect(frunze.filter(a => a.jalon).length).toBe(23)
  })

  it('calendarul de atunci (fără sărbători): ES/EF/LS/LF/marja identice cu cpm.py pe toate activitățile', () => {
    const r = calculeazaGrafic(intrare({ fara_sarbatori_legale: true }))
    expect(r.calculat).toBe(true)
    expect(r.durata_zile_lucratoare).toBe(63)
    expect(r.data_final).toBe('2027-01-27')
    expect(r.termen).toMatchObject({ data_limita: '2027-02-01', rezerva_zile_lucratoare: 3, incadrat: true })
    const pert = new Map(tabelPERT(r).map(p => [p.cod, p]))
    const [antet, ...linii] = citeste('grafic_Y_pert.txt')
    expect(antet).toBe('WBS | denumire | durata | ES | EF | LS | LF | marja | critic')
    expect(linii.length).toBe(161)
    const diferente = []
    for (const l of linii) {
      const c = l.split(' | ').map(x => x.trim())
      const [wbs, durata, ES, EF, LS, LF, marja, critic] = [c[0], c[c.length - 7], ...c.slice(-6)]
      const p = pert.get(wbs)
      const noi = [p.durata, p.ES, p.EF, p.LS, p.LF, p.marja, p.critic ? 'DA' : 'nu'].map(String)
      const ref = [durata, ES, EF, LS, LF, marja, critic]
      if (noi.join('|') !== ref.join('|')) diferente.push(`${wbs}: motor ${noi.join(' ')} ≠ cpm.py ${ref.join(' ')}`)
    }
    expect(diferente).toEqual([])
  })

  it('rezumatele: durata ca în cpm.py; intervalul = primul început / ultimul sfârșit al activităților din el (regula MS Project)', () => {
    const r = calculeazaGrafic(intrare({ fara_sarbatori_legale: true }))
    const p = new Map(r.pozitii.map(x => [x.cod, x]))
    const frunze = y.randuri.filter(x => !x.rezumat)
    const diferente = []
    for (const x of y.randuri.filter(z => z.rezumat)) {
      const din = frunze.filter(f => x.wbs === '0' || f.wbs.startsWith(x.wbs + '.'))
      // jalonul e la sfârșitul zilei afișate: la aceeași dată, o activitate care începe dimineața e mai devreme
      const inc = din.map(f => `${f.start}${f.jalon && f.start !== '2026-11-02' ? 'T17' : 'T08'}`).sort()[0].slice(0, 10)
      const sf = din.map(f => f.final).sort().at(-1)
      const z = p.get(x.wbs)
      if (`${z.durata} ${z.start} ${z.final}` !== `${x.dur} ${inc} ${sf}`) diferente.push(`${x.wbs}: ${z.durata} ${z.start} ${z.final} ≠ ${x.dur} ${inc} ${sf}`)
    }
    expect(diferente).toEqual([])
    // cpm.py punea rezumatul în ziua ES și la cele două rezumate care încep cu un jalon (6.2, 7.2); MS Project (și MPXJ) — în ziua jalonului
    const vechi = y.randuri.filter(z => z.rezumat && p.get(z.wbs).start !== z.start).map(z => `${z.wbs} ${z.start}→${p.get(z.wbs).start}`)
    expect(vechi).toEqual(['6.2 2027-01-14→2027-01-13', '7.2 2027-01-13→2027-01-12'])
  })

  it('drumul critic: aceeași listă, în aceeași ordine, ca grafic_Y_drum_critic.txt', () => {
    const r = calculeazaGrafic(intrare({ fara_sarbatori_legale: true }))
    const ref = citeste('grafic_Y_drum_critic.txt').filter(l => /^\d+ \| /.test(l)).map(l => l.split(' | ')[1].trim())
    expect(ref.length).toBeGreaterThan(20)
    expect(r.drum_critic.lista).toEqual(ref)
  })

  it('cu sărbătorile legale: finalul 04.02.2027, termenul de 3 luni depășit — motorul o spune singur', () => {
    const r = calculeazaGrafic(intrare({}))
    expect(r.data_final).toBe('2027-02-04')
    expect(r.termen).toMatchObject({ data_limita: '2027-02-01', incadrat: false, rezerva_zile_lucratoare: -3 })
    expect(r.probleme.find(p => p.cod === 'TERMEN_DEPASIT')).toMatchObject({ gravitate: 'eroare', depasire_zile_lucratoare: 3 })
    expect(r.poate_fi_go).toBe(false)
    // 138 de marcaje PRESUPUS (inclusiv 2 jaloane): la depunere fiecare e eroare — și cel de pe jalon (r1 Jak P1)
    const presupuse = y.activitati.filter(a => !a.rezumat && /^PRESUPUS/i.test(a.sursa_durata))
    expect(presupuse.length).toBe(138)
    const d = calculeazaGrafic({ ...intrare({}), mod: 'depunere' })
    expect(d.probleme.filter(p => p.cod === 'DURATA_PRESUPUSA').length).toBe(138)

  })

  it('exportul MSPDI al graficului Y: bine format, cu sărbătorile ca excepții și toate cele 161 + rezumatele ca sarcini', () => {
    const r = calculeazaGrafic(intrare({}))
    const xml = genereazaMSPDI(r, { titlu: 'Grafic Y (test)', fisier: 'grafic_Y' })
    expect((xml.match(/<Task>/g) || []).length).toBe(y.activitati.length)
    for (const d of ['2026-11-30', '2026-12-01', '2026-12-25', '2027-01-01', '2027-01-06', '2027-01-07']) expect(xml).toContain(`<FromDate>${d}T00:00:00</FromDate>`)
    expect((xml.match(/<Summary>1<\/Summary>/g) || []).length).toBe(y.activitati.filter(a => a.rezumat).length)
  })
})

describe('cititorul fixturii e strict (r1 Jak: L13)', () => {
  it('predecesorii: forma completă trece, sufixele neînțelese opresc citirea', () => {
    expect(parseazaPredecesori('4.3.16 SS+1z; 4.3.16 FF+1z; 1.1 FS', 'x')).toEqual([{ de: '4.3.16', tip: 'SS', lag_zile: 1 }, { de: '4.3.16', tip: 'FF', lag_zile: 1 }, { de: '1.1', tip: 'FS', lag_zile: 0 }])
    expect(parseazaPredecesori('2.1 SS - 3', 'x')).toEqual([{ de: '2.1', tip: 'SS', lag_zile: -3 }])
    expect(() => parseazaPredecesori('4.3 FS+2ore', 'x')).toThrow(/neînțeles/)
    expect(() => parseazaPredecesori('4.3 FS+2z REST', 'x')).toThrow(/neînțeles/)
    expect(() => parseazaPredecesori('4.3 XX', 'x')).toThrow(/neînțeles/)
  })
})
