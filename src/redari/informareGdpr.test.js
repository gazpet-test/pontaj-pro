import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEXT_INFORMARE_LOT1, VERSIUNE_INFORMARE_LOT1, TRIMITERE_VERSO_GDPR, COD_PROIECT_INFORMARE_LOT1, autorizareTgzCompleta } from './informareGdpr.js'
import * as docx from './docx.js'
import { blocuri, campuriNecompletate, informareGata } from '../RedariInformarePublic.jsx'

describe('informarea GDPR publica (Lot 1)', () => {
  it('textul are cele 7 capitole si nu contine nota interna', () => {
    const titluri = blocuri(TEXT_INFORMARE_LOT1).filter(b => b.tip === 'titlu').map(b => b.text)
    expect(titluri).toHaveLength(7)
    expect(titluri[0]).toMatch(/^1\. Cine folosește/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/NOTĂ INTERNĂ|nu se publică|TEXT SCURT/)
    expect(TEXT_INFORMARE_LOT1).not.toMatch(/art\. 11 alin\. \(4\)/)
  })
  it('publicarea vine DOAR din autorizarea Transgaz pe proiect (nr. + data + PDF, 20261130m); fara ea pagina NU e gata (banda PROIECT + noindex)', () => {
    expect(campuriNecompletate(TEXT_INFORMARE_LOT1)).toEqual([])
    expect(VERSIUNE_INFORMARE_LOT1).toBe('v3.3 05.11.2026')
    expect(COD_PROIECT_INFORMARE_LOT1).toBe('LOT1-PRUNISOR-JUPA')
    const aut = { autorizare_tgz_nr: '1', autorizare_tgz_data: '2026-11-05', autorizare_tgz_fisier: 'LOT1-PRUNISOR-JUPA/autorizare_tgz/1_a.pdf' }
    expect(autorizareTgzCompleta(aut)).toBe(true)
    for (const p of [null, undefined, {}, { ...aut, autorizare_tgz_nr: ' ' }, { ...aut, autorizare_tgz_data: null }, { ...aut, autorizare_tgz_fisier: '' }]) expect(autorizareTgzCompleta(p)).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, autorizareTgzCompleta({}))).toBe(false)
    expect(informareGata(TEXT_INFORMARE_LOT1, autorizareTgzCompleta(aut))).toBe(true)
    expect(informareGata(TEXT_INFORMARE_LOT1 + ' [de confirmat]', true)).toBe(false)
    expect(informareGata('Text complet fara campuri.', false)).toBe(false)
    expect(informareGata('Text complet fara campuri.', true)).toBe(true)
  })
  it('textul v3.1/v3.2 (Final_v2 + juridic#031/#032, 04.11) contine elementele noi', () => {
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
  it('textul v3.2 (04.11), pastrat in v3.3: fara campuri [ ], sursa datelor, e-mailul redari@, transferul, Gazpet Instal', () => {
    const t = TEXT_INFORMARE_LOT1
    expect(t).not.toMatch(/\[[^\]]*\]/)
    // v3.3 (05.11, juridic#040) pastreaza tot ce verifica acest test si adauga utilizatorul (testul „v3.3”)
    expect(VERSIUNE_INFORMARE_LOT1).toMatch(/^v3\.3 /)
    const cap = (n) => t.slice(t.indexOf(`### ${n}.`), n < 7 ? t.indexOf(`### ${n + 1}.`) : undefined)
    const liste3 = blocuri(cap(3)).filter(b => b.tip === 'lista').flatMap(b => b.elemente)
    expect(cap(3)).toContain('Datele provin de la Transgaz, care le-a obținut pentru acest proiect de la oficiul de cadastru, primării și alte instituții, potrivit Legii nr. 185/2016, și din ce ne spuneți dumneavoastră.')
    expect(liste3).toContain('mesajele pe care ni le trimiteți, inclusiv pe e-mail la redari@gazpet.ro;')
    expect(cap(4)).toContain('Datele din evidența proiectului sunt stocate în Uniunea Europeană. Pentru afișarea paginilor web folosim un furnizor din SUA, care vede doar date tehnice ale vizitei (adresa IP), cu garanțiile prevăzute de GDPR.')
    expect(cap(4)).not.toMatch(/nu ies din Uniunea/)
    expect(cap(5)).toContain('Mesajele primite la redari@gazpet.ro se păstrează în evidența proiectului, pe aceeași durată.')
    expect(t).toContain('**Gazpet Instal** (GAZPET INSTAL S.R.L.')
    expect(t).not.toMatch(/Gazpet(?! Instal|\.ro)/)
  })
  it('v3.3 (juridic#040): utilizatorul / arendasul apare la cap. 2 si cap. 3', () => {
    const t = TEXT_INFORMARE_LOT1
    const cap2 = t.slice(t.indexOf('### 2.'), t.indexOf('### 3.')), cap3 = t.slice(t.indexOf('### 3.'), t.indexOf('### 4.'))
    expect(cap2).toContain('Pe terenul dumneavoastră, pe partea de teren care vă aparține sau pe terenul pe care îl folosiți, s-a lucrat temporar la conductă.')
    const lista3 = blocuri(cap3).filter(b => b.tip === 'lista').flatMap(b => b.elemente)
    expect(lista3).toContain('datele persoanei care folosește terenul (de exemplu, arendașul), dacă este alta decât proprietarul.')
    expect(lista3).toContain('datele celui care vă reprezintă (împuternicit, moștenitor), dacă e cazul;')
  })
  it('trimiterea de pe fata catre verso = exact textul v3.2; daca docx.js are constanta lui (dupa merge cu main), e aceeasi', () => {
    expect(TRIMITERE_VERSO_GDPR).toBe('Pe verso găsiți informațiile complete despre folosirea datelor și drepturile dumneavoastră.')
    if ('TRIMITERE_VERSO_GDPR' in docx) expect(docx.TRIMITERE_VERSO_GDPR).toBe(TRIMITERE_VERSO_GDPR)
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
