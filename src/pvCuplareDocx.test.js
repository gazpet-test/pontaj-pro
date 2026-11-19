// PV predare-primire conductă pentru cuplare: probele se uită la XML-ul din DOCX (ce vede omul în Word), nu doar la model.
// Textele așteptate sunt copiate din specificația lui Eugen (structura PV-ului de la Domnești), nu derivate din cod.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import {
  modelPvCuplare, construiestePvCuplare, dateInitialePv, numeFisierPv, formatDataPv, formatDiametru, formatExemplare,
  formatIntervale, curata, PARTICIPANTI_IMPLICITI, EXECUTANT_IMPLICIT,
} from './pvCuplareDocx.js'

const ORA = '____:____'
const CEDILA_S = String.fromCharCode(0x015F), CEDILA_T = String.fromCharCode(0x0163)
const VIRGULA_S = String.fromCharCode(0x0219), VIRGULA_T = String.fromCharCode(0x021B)

const PROIECT = {
  id: 7, cod_intern: 'DOMNEȘTI-21', nume: 'Racord și SRM Domnești, județul Argeș', beneficiar: 'SNTGN TRANSGAZ SA',
  nr_contract: '21', data_contract: '2026-01-12', sef_santier_employee_id: 10, rte_employee_id: 11,
}
const ANGAJATI = { 10: { name: 'POPESCU ION' }, 11: { name: 'IONESCU ȘTEFAN' } }

const complet = () => ({
  ...dateInitialePv({ proiect: PROIECT, angajati: ANGAJATI }),
  nr_pv: '3', data_cuplarii: '2026-11-26', locul: 'Domnești, județul Argeș',
  sursa_program: 'e-mail Sucursala Mediaș din 19.11.2026',
  intervale: 'punere în siguranță 08:00–09:30\nextragere obturatoare 16:00–17:00',
  srm: 'SRM Domnești AG (SM1104D0)', diametru: '300', exemplare: '4',
})

const xmlDocument = async (date) => {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(construiestePvCuplare(date)))
  return { zip, xml: await zip.file('word/document.xml').async('string') }
}
const decod = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
// textul fiecărui paragraf, în ordine (run-urile lipite)
const paragrafe = xml => (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [])
  .map(p => decod((p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || []).map(t => t.replace(/^<w:t[^>]*>|<\/w:t>$/g, '')).join('')))
// verificare simplă de XML bine format: fiecare tag deschis se închide în ordine
function bineFormat(xml) {
  const stiva = []
  const corp = xml.replace(/<\?xml[^>]*\?>/, '')
  for (const m of corp.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, inchide, nume, auto] = m
    if (auto) continue
    if (inchide) { if (stiva.pop() !== nume) return false } else stiva.push(nume)
  }
  return stiva.length === 0
}

describe('PV cuplare — documentul Word se deschide și are structura din specificație', () => {
  it('pachetul DOCX e complet și XML-ul e bine format', async () => {
    const { zip, xml } = await xmlDocument(complet())
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) expect(zip.file(f), f).toBeTruthy()
    expect(bineFormat(xml)).toBe(true)
    expect(bineFormat(await zip.file('word/styles.xml').async('string'))).toBe(true)
  })

  it('A4, Arial 10,5, titlul bold, tabelul de participanți cu chenar, semnăturile fără chenar', async () => {
    const { zip, xml } = await xmlDocument(complet())
    expect(xml).toMatch(/<w:pgSz[^>]*w:w="11906"[^>]*w:h="16838"/)
    const stiluri = await zip.file('word/styles.xml').async('string')
    expect(stiluri).toMatch(/w:ascii="Arial"/)
    expect(stiluri).toMatch(/<w:sz w:val="21"\/>/)
    const tabele = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)
    expect(tabele).toHaveLength(2)
    expect(tabele[0]).toMatch(/<w:tblBorders>[\s\S]*w:val="single"/)
    expect(tabele[1]).toMatch(/<w:tblBorders>[\s\S]*w:val="none"/)
    expect(tabele[1]).not.toMatch(/w:val="single"/)
    const titlu = (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).find(p => p.includes('PROCES-VERBAL'))
    expect(titlu).toMatch(/<w:b\/>/)
  })

  it('date complete: antetul, Partea I–III și semnăturile, în ordinea modelului', async () => {
    const ps = paragrafe((await xmlDocument(complet())).xml)
    const tot = ps.join('\n')
    const ordine = [
      'PROCES-VERBAL DE PREDARE-PRIMIRE A CONDUCTEI ÎN VEDEREA CUPLĂRII',
      'Nr. 3 / 26.11.2026',
      'Obiectiv: Racord și SRM Domnești, județul Argeș',
      'Contract: nr. 21 din 12.01.2026',
      'Beneficiar: SNTGN TRANSGAZ SA',
      'Executant: GAZPET INSTAL S.R.L.',
      'Locul: Domnești, județul Argeș',
      'Participanți',
      'Calitatea', 'Numele și prenumele', 'Semnătura',
      'Partea I – Predarea conductei de către Beneficiar către Executant',
      'Astăzi, 26.11.2026, conform programului comunicat de SNTGN TRANSGAZ SA (e-mail Sucursala Mediaș din 19.11.2026: punere în siguranță 08:00–09:30; extragere obturatoare 16:00–17:00), s-au constatat următoarele:',
      `1. Sistarea livrărilor prin SRM Domnești AG (SM1104D0) și manevrele de refulare: finalizate la ora ${ORA}.`,
      `2. Introducerea obturatoarelor pneumatice: finalizată la ora ${ORA}.`,
      `3. Debitarea anti-Ex a conductei: finalizată la ora ${ORA}.`,
      `4. Verificarea lipsei de gaze în zona de lucru (detector, % LIE): rezultat __________, ora ${ORA}.`,
      'În urma celor de mai sus, Beneficiarul predă, iar Executantul primește tronsoanele de conductă Dn 300 aferente cuplării lipsite de orice sarcină (fără presiune și fără gaze naturale), în condiții de siguranță pentru executarea lucrărilor de cuplare.',
      `Data și ora predării: 26.11.2026, ora ${ORA}`,
      'Partea II – Executarea cuplării și repredarea conductei către Beneficiar',
      `1. Începerea lucrărilor de cuplare propriu-zise: ora ${ORA}.`,
      `2. Finalizarea sudurilor de cuplare: ora ${ORA}.`,
      `3. Verificarea sudurilor conform proiectului (metoda: __________, rezultat: __________): ora ${ORA}.`,
      'Executantul predă Beneficiarului conducta cuplată, în vederea extragerii obturatoarelor pneumatice, blindării flanșelor multifuncționale și presurizării.',
      `Data și ora repredării: 26.11.2026, ora ${ORA}`,
      'Partea III – Mențiuni',
      'Abateri față de programul comunicat (întârzieri, cauze, partea care le-a generat):',
      'Alte observații:',
      'Prezentul proces-verbal s-a încheiat în 4 exemplare, câte unul pentru fiecare parte.',
      'BENEFICIAR – SNTGN TRANSGAZ SA', 'DIRIGINTE DE ȘANTIER', 'EXECUTANT – GAZPET INSTAL S.R.L.',
    ]
    let poz = -1
    for (const t of ordine) {
      const i = ps.findIndex((p, k) => k > poz && p === t)
      expect(i, `lipsește sau e în altă ordine: ${t}`).toBeGreaterThan(poz)
      poz = i
    }
    // participanții impliciți, cu numele din proiect pentru șef de șantier și RTE
    for (const c of PARTICIPANTI_IMPLICITI) expect(ps).toContain(c)
    expect(ps).toContain('POPESCU ION'); expect(ps).toContain('IONESCU ȘTEFAN')
    // 3 + 2 linii goale în Partea III
    const iAbateri = ps.indexOf('Abateri față de programul comunicat (întârzieri, cauze, partea care le-a generat):')
    expect(ps.slice(iAbateri + 1, iAbateri + 4).every(p => /^_{20,}$/.test(p))).toBe(true)
    const iAlte = ps.indexOf('Alte observații:')
    expect(ps.slice(iAlte + 1, iAlte + 3).every(p => /^_{20,}$/.test(p))).toBe(true)
    expect(tot).not.toMatch(/undefined|null|NaN|\[object/)
  })

  it('„lipsite de orice sarcină” e singurul fragment bold din fraza de predare', async () => {
    const { xml } = await xmlDocument(complet())
    const p = (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).find(x => x.includes('lipsite de orice sarcin'))
    const runuri = p.match(/<w:r>[\s\S]*?<\/w:r>/g)
    expect(runuri).toHaveLength(3)
    expect(runuri.map(x => /<w:b\/>/.test(x))).toEqual([false, true, false])
  })

  it('orele efective rămân MEREU linii goale (9 locuri), oricât de complet e formularul', async () => {
    const date = { ...complet(), ora: '08:15', ora_predare: '09:30', ora_repredare: '17:00' }   // chei străine ignorate
    const tot = paragrafe((await xmlDocument(date)).xml).join('\n')
    expect(tot.split(ORA).length - 1).toBe(9)
    expect(tot).not.toMatch(/\bora \d/)
    expect(tot).not.toContain('08:15')
  })
})

describe('PV cuplare — date lipsă: linii de completat, nimic inventat', () => {
  it('formular gol: fiecare câmp devine linie, niciun „undefined” / „null”', async () => {
    const ps = paragrafe((await xmlDocument({})).xml)
    const tot = ps.join('\n')
    expect(tot).not.toMatch(/undefined|null|NaN|\[object/)
    expect(ps).toContain('Nr. ______ / ____________')
    for (const e of ['Obiectiv', 'Contract', 'Beneficiar', 'Executant', 'Locul']) expect(ps).toContain(`${e}: ____________________`)
    expect(tot).toContain('Astăzi, ____________, conform programului comunicat de ____________________ (__________: ____________________), s-au constatat următoarele:')
    expect(tot).toContain('1. Sistarea livrărilor prin ____________________ și manevrele de refulare')
    expect(tot).toContain('tronsoanele de conductă Dn ______ aferente cuplării')
    expect(tot).toContain('s-a încheiat în ____ exemplare')
    expect(ps).toContain('BENEFICIAR – ____________________')
    expect(ps).toContain('EXECUTANT – ____________________')
    expect(tot.split(ORA).length - 1).toBe(9)
  })

  it('null / undefined pe fiecare câmp și participanți cu valori lipsă nu scriu „null”', async () => {
    const date = Object.fromEntries(Object.keys(complet()).map(k => [k, null]))
    date.participanti = [{ calitate: null, nume: undefined }, {}, null]
    const { xml } = await xmlDocument(date)
    expect(paragrafe(xml).join('\n')).not.toMatch(/undefined|null|NaN|\[object/)
    const tabel = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)[0]
    expect(tabel.match(/<w:tr>/g)).toHaveLength(4)   // antet + 3 rânduri goale de completat de mână
  })

  it('dateInitialePv: proiect fără beneficiar / contract / oameni → câmpuri goale; executantul implicit e firma', () => {
    const d = dateInitialePv({ proiect: { cod_intern: 'X1', nume: 'Lucrare', beneficiar: null, nr_contract: null, data_contract: '2026-01-12' } })
    expect(d.beneficiar).toBe(''); expect(d.contract).toBe(''); expect(d.locul).toBe(''); expect(d.diametru).toBe('')
    expect(d.executant).toBe(EXECUTANT_IMPLICIT)
    expect(d.participanti.map(p => p.calitate)).toEqual(PARTICIPANTI_IMPLICITI)
    expect(d.participanti.every(p => p.nume === '')).toBe(true)
    expect(dateInitialePv().obiectiv).toBe('')
    expect(dateInitialePv({ proiect: { nr_contract: '21/2026' } }).contract).toBe('nr. 21/2026')
  })

  it('dateInitialePv: numele vin din employees așa cum sunt; id fără angajat → gol', () => {
    const d = dateInitialePv({ proiect: { ...PROIECT, rte_employee_id: 99 }, angajati: ANGAJATI })
    expect(d.participanti.find(p => p.calitate === 'Executant – șef de șantier').nume).toBe('POPESCU ION')
    expect(d.participanti.find(p => p.calitate === 'Executant – RTE').nume).toBe('')
    expect(d.contract).toBe('nr. 21 din 12.01.2026')
    expect(d.obiectiv).toBe('Racord și SRM Domnești, județul Argeș')
  })
})

describe('PV cuplare — diacritice și formate', () => {
  it('ș / ț cu sedilă (copy-paste) ies cu virgulă în document', async () => {
    const date = { ...complet(), beneficiar: `Transgaz Sucursala Media${CEDILA_S}`, locul: `Pite${CEDILA_S}ti, ${CEDILA_T}ara`, srm: `SRM ${String.fromCharCode(0x015E)}${String.fromCharCode(0x0162)}` }
    const { xml } = await xmlDocument(date)
    const tot = paragrafe(xml).join('\n')
    expect(tot).not.toContain(CEDILA_S); expect(tot).not.toContain(CEDILA_T)
    expect(tot).toContain(`Beneficiar: Transgaz Sucursala Media${VIRGULA_S}`)
    expect(tot).toContain(`Locul: Pite${VIRGULA_S}ti, ${VIRGULA_T}ara`)
    expect(tot).toContain(`SRM ${String.fromCharCode(0x0218)}${String.fromCharCode(0x021A)}`)
    // textele fixe ale documentului: doar ș / ț cu virgulă
    const fix = paragrafe((await xmlDocument({})).xml).join('\n')
    expect(fix).not.toMatch(new RegExp(`[${CEDILA_S}${CEDILA_T}${String.fromCharCode(0x015E)}${String.fromCharCode(0x0162)}]`))
    expect(fix).toContain(`Numele ${VIRGULA_S}i prenumele`)
  })

  it('caracterele speciale din câmpuri ajung escape-uite (XML valid)', async () => {
    const { xml } = await xmlDocument({ ...complet(), obiectiv: 'Racord <DN 300> & SRM "Nord"' })
    expect(bineFormat(xml)).toBe(true)
    expect(paragrafe(xml)).toContain('Obiectiv: Racord <DN 300> & SRM "Nord"')
  })

  it('formatări: dată, diametru, exemplare, intervale', () => {
    expect(formatDataPv('2026-11-26')).toBe('26.11.2026')
    expect(formatDataPv('2026-01-12T00:00:00')).toBe('12.01.2026')
    expect(formatDataPv('26.11.2026')).toBe('26.11.2026')
    expect(formatDataPv(null)).toBe('')
    expect(formatDiametru('300')).toBe('Dn 300')
    expect(formatDiametru('DN 300 / Pn 63')).toBe('DN 300 / Pn 63')
    expect(formatDiametru('')).toBe('')
    expect(formatExemplare('4')).toBe('4')
    for (const v of ['0', '-1', '2.5', 'patru', '100', '', null]) expect(formatExemplare(v)).toBe('')
    expect(formatIntervale(' a \r\n\n b ')).toBe('a; b')
    expect(curata(undefined)).toBe('')
  })

  it('numele fișierului: cod intern fără diacritice + data cuplării; fără dată → ziua de azi în București', () => {
    expect(numeFisierPv('DOMNEȘTI-21', '2026-11-26')).toBe('PV_predare_conducta_cuplare_DOMNESTI-21_2026-11-26.docx')
    expect(numeFisierPv('Lot 1 / Prunișor', '2026-11-26')).toBe('PV_predare_conducta_cuplare_Lot_1_Prunisor_2026-11-26.docx')
    expect(numeFisierPv(null, '')).toMatch(/^PV_predare_conducta_cuplare_proiect_\d{4}-\d{2}-\d{2}\.docx$/)
    // 23:30 UTC pe 30.11 = 01.12 în București
    expect(numeFisierPv('X', '', new Date(Date.UTC(2026, 10, 30, 23, 30)))).toBe('PV_predare_conducta_cuplare_X_2026-12-01.docx')
  })

  it('modelul nu conține nume de program sau AI', () => {
    const tot = JSON.stringify(modelPvCuplare(complet()))
    expect(tot).not.toMatch(/claude|rocky|\bAI\b|generat automat|pregătit de|ERP/i)
  })
})
