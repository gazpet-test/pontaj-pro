// R5 runda 4 (verificator R3, 26.09.2026): poarta graficului se RECALCULEAZĂ ÎNTREAGĂ pe cantitățile recitite înainte de
// îngheț (GraficPoarta.genereaza). Aici: funcția pură — aceleași intrări, cantități diferite => rândurile „cant" și „front"
// se schimbă amândouă (înainte, la îngheț se actualiza doar „cant").
import { describe, it, expect } from 'vitest'
import { calculeazaPoartaGrafic, durataMaxDinCerinte, totalFronturi } from './graficPoartaCalcul.js'
import { fronturiDinCantitati } from './ofertareCantitatiAprobare.js'
import { aplicaRegulaAprobare } from './ofertareCantitatiInvalidare.js'

const rand = (id, dn, m, status = 'validat') => ({ id, obiect: null, categorie: 'Conducte și montaj', denumire: `Țeavă PE100 SDR11 Dn${dn} — Str. ${id}`, um: 'm', cantitate: m, cantitate_plansa: m, status })
const CANT = [rand(1, 110, 1000), rand(2, 90, 500)]
const norme = [{ cod: 'PE_LANT', tip_lucrare: 'retea_pehd', um: 'm', productie_zi: 100, incredere: 'validat' }]
const cerinte = [{ id: 1, text_cerinta: 'Durata maximă de execuție este de 12 luni.', tip: 'propunere' }]
const p = { tip_lucrare: 'retea_pehd', mod: 'oferta', data_start: '2026-10-01', durata_luni: 10, cantitati_asumate: '', echipe: 2, mediu: 'sat',
  include_bransamente: false, nr_bransamente: 0, ferestre_operator: 'cuplări în ferestre', fronturi: fronturiDinCantitati(CANT, '').fronturi }
const stare = (poarta, k) => poarta.find(r => r.k === k)?.stare

describe('calculeazaPoartaGrafic', () => {
  it('toate intrările în platformă, fronturi din rânduri validate => nimic block', () => {
    const g = calculeazaPoartaGrafic({ p, cantitati: CANT, norme, cerinte, durataMax: durataMaxDinCerinte(cerinte) })
    expect(g.map(r => r.k)).toEqual(['cant', 'front', 'norme', 'echipe', 'durata', 'cerinte', 'brans', 'ferestre'])
    expect(g.filter(r => r.stare === 'block')).toEqual([])
    expect(totalFronturi(p)).toBe(1500)
  })
  it('recalcul pe cantitățile RECITITE: un rând redeschis între încărcare și click => „cant" ȘI „front" block (înainte: doar „cant")', () => {
    const proaspete = CANT.map(c => c.id === 2 ? { ...c, status: 'diferenta', cantitate_plansa: 650 } : c)
    const g = calculeazaPoartaGrafic({ p, cantitati: proaspete, norme, cerinte, durataMax: 12 })
    expect(stare(g, 'cant')).toBe('block'); expect(stare(g, 'front')).toBe('block')
    expect(g.find(r => r.k === 'front').detalii).toMatch(/rândul-sursă #2 nu e validat/)
  })
  it('durata peste maximul din cerințe => block (neschimbat)', () => {
    expect(durataMaxDinCerinte(cerinte)).toBe(12)
    expect(stare(calculeazaPoartaGrafic({ p: { ...p, durata_luni: 14 }, cantitati: CANT, norme, cerinte, durataMax: 12 }), 'durata')).toBe('block')
  })
  it('fără p => []', () => expect(calculeazaPoartaGrafic({ p: null })).toEqual([]))
  // R5 (Copilot 26.09.2026, condiția 2): rândul invalidat pe material (lungime identică) nu dispare tacit din poartă
  it('rând invalidat pe material după propunere => „cant” block cu `lista` (#2), „front” marcat incomplet; ce se îngheață conține lista', () => {
    const inval = CANT.map(c => c.id === 2 ? { ...c, ...aplicaRegulaAprobare(c, { denumire: 'Țeavă OL Dn90 — Str. 2' }).patch } : c)
    const g = calculeazaPoartaGrafic({ p, cantitati: inval, norme, cerinte, durataMax: 12 })
    const cant = g.find(r => r.k === 'cant'), front = g.find(r => r.k === 'front')
    expect([cant.stare, cant.lista.map(x => [x.id, x.status, x.cantitate, x.um])]).toEqual(['block', [[2, 'diferenta', 500, 'm']]])
    expect(cant.detalii).toMatch(/lipsește 1 rând necesar nevalidat \(500 m\): #2 „Țeavă OL Dn90 — Str\. 2” \(diferenta, 500 m\)/)
    expect([front.stare, front.incomplet]).toEqual(['block', true])
    expect(front.detalii).toMatch(/^INCOMPLET, de reverificat — /)
    expect(JSON.parse(JSON.stringify(g)).find(r => r.k === 'cant').lista).toHaveLength(1) // grafic_versiuni.poarta (jsonb)
  })
})
