// Redări — Anexa 2 a adresei către primărie (Model 4) = trimiterea la anunțul de afișare (decizia Răzvan 19.11.2026; SABLOANE.md §1
// excepția (12), §2.4). O singură definiție a textului public: lista parcelelor publică stă DOAR în anunț (anunt_afisare.docx).
// Valorile așteptate vin din decizie (anexa2Anunt.testutil.js), din șablonul de pe origin/main (git show) și din textul-sursă al
// anunțului (docs/redari/TEXT_ANUNT_AFISARE.md), nu din scriptul care construiește șablonul sau din generator.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { CHEI_ANUNT_AFISARE, CAMPURI_PARCELA_ANUNT, COL_PARCELA_ADRESA, INDICIU_ANEXA2_ANUNT } from './docx.js'
import { TEXT_ANEXA2_DECIZIE, TITLU_ANEXA2, TITLU_ANEXA3 } from './anexa2Anunt.testutil.js'

const CALE = 'public/redari/sabloane/adresa_uat.docx'
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
// blocurile de nivel superior din <w:body>: tabel întreg, paragraf auto-închis sau paragraf
const RX_BLOC = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>/])[\s\S])*?<\/w:p>|<w:sectPr[\s\S]*?<\/w:sectPr>/g
const dez = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const text = x => dez([...x.matchAll(RX_T)].map(m => m[1]).join(''))
const documentXml = async buf => (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')
// [început până după paragraful titlului Anexei 2, blocurile corpului Anexei 2, de la blocul de după corp până la final]
function imparte(xml) {
  const corp = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)[1]
  const baza = xml.indexOf('<w:body>') + '<w:body>'.length
  const blocuri = [...corp.matchAll(RX_BLOC)]
  const i = blocuri.findIndex(b => text(b[0]) === TITLU_ANEXA2), j = blocuri.findIndex(b => text(b[0]) === TITLU_ANEXA3)
  expect(i).toBeGreaterThan(0); expect(j).toBeGreaterThan(i + 1)
  // ultimul bloc al corpului = paragraful cu saltul de pagină dinaintea Anexei 3 (rămâne)
  const salt = blocuri[j - 1]
  expect(salt[0]).toMatch(/^<w:p[^>]*><w:r><w:br w:type="page"\/><\/w:r><\/w:p>$/)
  const capat = baza + blocuri[i].index + blocuri[i][0].length
  return { inainte: xml.slice(0, capat), corp: blocuri.slice(i + 1, j - 1).map(b => b[0]), dupa: xml.slice(baza + salt.index) }
}
const areOriginMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main^{commit}'], { stdio: ['ignore', 'pipe', 'ignore'] }); return true } catch { return false } })()
const sablonMain = () => execFileSync('git', ['show', `origin/main:${CALE}`], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 })

describe('adresa UAT (Model 4), Anexa 2 = anunțul de afișare (19.11.2026)', () => {
  it('șablonul: după titlul Anexei 2 vin EXACT cele două paragrafe din decizie, apoi saltul de pagină și Anexa 3; fără tabel și fără câmpuri de parcelă', async () => {
    const xml = await documentXml(readFileSync(CALE))
    const { corp } = imparte(xml)
    expect(corp.map(text)).toEqual(TEXT_ANEXA2_DECIZIE)
    for (const b of corp) { expect(b.startsWith('<w:tbl>')).toBe(false); expect(b).not.toContain('{{') }
    expect(xml).not.toMatch(/\{\{rand\.|\{\{(?:sat|tarla|nr_cadastral|poz_hg|tronson|program_text)\}\}/)
    // titlul Anexei 2 și trimiterea din lista de anexe a adresei rămân (textul adresei e neschimbat)
    expect(text(xml)).toContain('Anexe: 1. Împuternicirea Beneficiarului; 2. Convocarea pentru afișare + lista parcelelor; 3. Model proces-verbal de afișare.')
  })

  it.skipIf(!areOriginMain)('paritate cu origin/main: aceleași intrări în arhivă, octet cu octet în afara word/document.xml; în document.xml XML-ul identic înainte și după corpul Anexei 2, cu formatarea paragrafelor refolosită', async () => {
    const [zMain, zNou] = await Promise.all([JSZip.loadAsync(sablonMain()), JSZip.loadAsync(readFileSync(CALE))])
    const fisiere = z => Object.values(z.files).filter(f => !f.dir).map(f => f.name).sort()
    expect(fisiere(zNou)).toEqual(fisiere(zMain))
    for (const n of fisiere(zMain).filter(n => n !== 'word/document.xml')) {
      expect(Buffer.from(await zNou.file(n).async('uint8array')).equals(Buffer.from(await zMain.file(n).async('uint8array'))), n).toBe(true)
    }
    const [vechi, nou] = [imparte(await zMain.file('word/document.xml').async('string')), imparte(await zNou.file('word/document.xml').async('string'))]
    expect(nou.inainte).toBe(vechi.inainte)
    expect(nou.dupa).toBe(vechi.dupa)
    // corpul vechi chiar era convocarea scurtă + tabelul listei (un singur rând-șablon)
    expect(text(vechi.corp.join(''))).toContain('Lista parcelelor (fără date personale):')
    expect(vechi.corp.filter(b => b.startsWith('<w:tbl>'))).toHaveLength(1)
    expect(vechi.corp.join('').match(/\{\{rand\.nr\}\}/g)).toHaveLength(1)
    // paragrafele noi = primele două paragrafe ale corpului vechi, cu alt text: același XML în afara conținutului <w:t>
    const faraText = p => p.replace(RX_T, '<w:t/>')
    expect(nou.corp.map(faraText)).toEqual(vechi.corp.slice(0, 2).map(faraText))
  })

  it('ce promite Anexa 2 despre anunț chiar e în anunț: zilele / programul / satele, răspunsul, publicitatea fără acceptare tacită, informarea cu QR și lista (sat, tarla, nr. cadastral, poz. HG, tronson), fără date personale', () => {
    const sursa = readFileSync('docs/redari/TEXT_ANUNT_AFISARE.md', 'utf8')
    for (const k of ['zi1', 'program1', 'sate_zi1', 'qr', 'link_informare', 'rand.sat', 'rand.tarla', 'rand.nr_cadastral', 'rand.poz_hg', 'rand.tronson']) expect(CHEI_ANUNT_AFISARE, k).toContain(k)
    expect(CAMPURI_PARCELA_ANUNT).toEqual(['sat', 'tarla', 'nr_cadastral', 'poz_hg', 'tronson'])
    for (const t of ['### Cum ne puteți răspunde', 'Prezenta afișare este o publicitate suplimentară a convocării; ea nu valorează acceptare tacită',
      'Prezentul anunț nu conține date personale.', '| Nr. | Sat | Tarla | Nr. cadastral / parcelă | Poz. HG | Tronson |']) expect(sursa, t).toContain(t)
  })

  it('ecranul UAT: adresa citește din parcele doar ce trebuie numărării; indiciul spre butonul anunțului, sub butoane și după salvare', () => {
    expect(COL_PARCELA_ADRESA.split(',').map(s => s.trim())).toEqual(['id_parcela', 'sters_la'])
    const ui = readFileSync('src/redari/ui/UatEcran.jsx', 'utf8')
    const corpAdresa = ui.slice(ui.indexOf('const adresa = async'), ui.indexOf('const anunt = async'))
    expect(corpAdresa).toContain('.select(COL_PARCELA_ADRESA)')
    expect(corpAdresa).not.toMatch(/nr_cadastral|poz_hg|tarla/)
    expect(corpAdresa).toContain('salvată. ${INDICIU_ANEXA2_ANUNT}')
    expect(INDICIU_ANEXA2_ANUNT).toContain('„Anunț de afișare (DOCX)”')
    expect(ui).toContain('>Anunț de afișare (DOCX)</button>')   // butonul la care trimite indiciul există, cu exact acest nume
  })
})
