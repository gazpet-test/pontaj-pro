import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEXT_INFORMARE_LOT1, INFORMARE_LOT1_PUBLICATA } from './informareGdpr.js'
import { blocuri, campuriNecompletate, informareGata } from '../RedariInformarePublic.jsx'

describe('informarea GDPR publica (Lot 1)', () => {
  it('textul are cele 7 capitole si nu contine nota interna', () => {
    const titluri = blocuri(TEXT_INFORMARE_LOT1).filter(b => b.tip === 'titlu').map(b => b.text)
    expect(titluri).toHaveLength(7)
    expect(titluri[0]).toMatch(/^1\. Cine folosește/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/NOTĂ INTERNĂ|nu se publică|TEXT SCURT/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/art\. 11 alin\. \(4\)/)
  })
  it('cat timp are campuri [ ] sau nu e marcata publicata, pagina NU e gata (banda PROIECT + noindex)', () => {
    expect(campuriNecompletate(TEXT_INFORMARE_LOT1).length).toBeGreaterThan(0)
    expect(INFORMARE_LOT1_PUBLICATA).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, true)).toBe(false)
    expect(informareGata('Text complet fara campuri.', false)).toBe(false)
    expect(informareGata('Text complet fara campuri.', true)).toBe(true)
  })
  it('textul v3.1 (Final_v2 + juridic#031/#032, 04.11) contine elementele noi', () => {
    const t = TEXT_INFORMARE_LOT1
    const liste = blocuri(t).filter(b => b.tip === 'lista').flatMap(b => b.elemente)
    // SMSLink la „Cine mai vede datele” (capitolul 4)
    const cap4 = t.slice(t.indexOf('### 4.'), t.indexOf('### 5.'))
    expect(cap4).toContain('furnizorul de SMS, SMSLink (ASTINVEST COM S.R.L.)')
    expect(cap4).toContain('datele sunt stocate în România')
    // juridic#032: verificarea o face doar Gazpet — firmele asocierii nu mai apar la destinatari
    expect(cap4).not.toMatch(/firmele care lucrează efectiv la verificarea terenurilor|\[denumiri/)
    expect(cap4).toContain('firmele care ne ajută tehnic, pe bază de contract: curierul și găzduirea aplicației de evidență')
    // dreptul de opozitie + plangerea la ANSPDCP
    expect(t).toContain('vă puteți opune folosirii datelor făcute pentru sarcina de interes public')
    expect(t).toContain('Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro')
    // sursa datelor
    expect(t).toContain('Datele provin de la Transgaz, care le-a obținut pentru acest proiect de la oficiul de cadastru')
    // listele se randeaza ca liste (si in sectiunea 2 / temeiul legal)
    expect(liste).toContain('păstrăm dovezile lucrărilor pentru recepția conductei.')
    // juridic#031: „răspundem la sesizări” e element separat al listei din cap. 2 (nu lipit de procesul-verbal)
    expect(liste).toContain('răspundem la sesizările dumneavoastră despre teren;')
    expect(liste).toContain('întocmim procesul-verbal privind starea terenului: de confirmare, dacă participați, sau de constatare tehnică, dacă nu participați;')
    expect(t).not.toMatch(/Răspundem/)
    // juridic#031: varianta cu cererea depusă la primărie e scoasă (circuitul nu e convenit)
    expect(t).not.toMatch(/primăria comunei/)
    expect(liste.some(e => e.startsWith('pentru identificarea proprietarilor'))).toBe(true)
    // fara textul scurt de pe fata si fara versiunea v2
    expect(t).not.toMatch(/Versiunea 3 din|\[link scurt|Pe verso găsiți/)
  })
  it('campurile [de completat] / [de confirmat] tin pagina in modul PROIECT, chiar daca ar fi marcata publicata', () => {
    expect(campuriNecompletate(TEXT_INFORMARE_LOT1)).toEqual(['[surse exacte – de confirmat de Transgaz]', '[de confirmat]'])
    expect(informareGata(TEXT_INFORMARE_LOT1, true)).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, INFORMARE_LOT1_PUBLICATA)).toBe(false)
  })
  it('juridic#031 Canale: formularul de raspuns are sus linkul catre /redari/informare, iar ruta exista', () => {
    const formular = readFileSync(resolve(process.cwd(), 'src/RedariRaspunsPublic.jsx'), 'utf8')
    const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8')
    expect(formular).toContain("export const LINK_INFORMARE = '/redari/informare'")
    expect(formular).toContain('Informarea privind datele personale')
    // linkul sta in Antet (randat pe toate ecranele formularului, sus)
    const antet = formular.slice(formular.indexOf('function Antet('), formular.indexOf('export default function'))
    expect(antet).toContain('href={LINK_INFORMARE}')
    expect(app).toContain('<Route path="/redari/informare"')
  })
  it('markdown minimal: titlu, lista, paragraf; fara HTML din sursa', () => {
    expect(blocuri('### A\n\n- x\n- y\n\nPar **b** [c]')).toEqual([
      { tip: 'titlu', text: 'A' }, { tip: 'lista', elemente: ['x', 'y'] }, { tip: 'paragraf', text: 'Par **b** [c]' }])
    expect(campuriNecompletate('a [__] b [de completat]')).toEqual(['[__]', '[de completat]'])
  })
})
