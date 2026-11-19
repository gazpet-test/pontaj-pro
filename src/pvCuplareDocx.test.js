// PV predare-primire conductă pentru cuplare: probele se uită la XML-ul din DOCX (ce vede omul în Word), nu doar la model.
// Textele așteptate sunt copiate din specificația lui Eugen (structura PV-ului de la Domnești), nu derivate din cod.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import {
  modelPvCuplare, construiestePvCuplare, dateInitialePv, numeFisierPv, formatDataPv, formatDiametru, formatExemplare,
  formatIntervale, curata, PARTICIPANTI_IMPLICITI, EXECUTANT_IMPLICIT,
  formatNumeIng, formatLocul, executantDinContract, frazaInterval, frazaProgram,
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
  executant: 'GAZPET INSTAL S.R.L.', nr_pv: '3', data_cuplarii: '2026-11-26', locul: 'Domnești, județul Argeș',
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

  it('runda 2: titlul 12 pt bold, corpul rămâne 10,5 pt', async () => {
    const { xml } = await xmlDocument(complet())
    const ps = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []
    const titlu = ps.find(p => p.includes('PROCES-VERBAL'))
    expect(titlu).toMatch(/<w:b\/>/)
    expect(titlu).toMatch(/<w:sz w:val="24"\/>/)
    expect(titlu).not.toMatch(/<w:sz w:val="21"\/>/)
    const corp = ps.filter(p => p !== titlu && /<w:t[\s>]/.test(p))
    expect(corp.length).toBeGreaterThan(20)
    for (const p of corp) { expect(p).toMatch(/<w:sz w:val="21"\/>/); expect(p).not.toMatch(/<w:sz w:val="24"\/>/) }
  })

  it('runda 2: metadatele Word au autorul firmei, nu „Un-named” din librărie', async () => {
    const { zip } = await xmlDocument(complet())
    const core = await zip.file('docProps/core.xml').async('string')
    expect(core).toMatch(/<dc:creator>GAZPET INSTAL S\.R\.L\.<\/dc:creator>/)
    expect(core).toMatch(/<cp:lastModifiedBy>GAZPET INSTAL S\.R\.L\.<\/cp:lastModifiedBy>/)
    expect(core).not.toMatch(/Un-named/i)
    expect(core).not.toMatch(/claude|rocky|\bAI\b/i)
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
      'Astăzi, 26.11.2026, conform programului comunicat de SNTGN TRANSGAZ SA (e-mail Sucursala Mediaș din 19.11.2026: operațiuni de punere în siguranță în intervalul 08:00–09:30; operațiuni de extragere obturatoare în intervalul 16:00–17:00), s-au constatat următoarele:',
      `1. Sistarea livrărilor prin SRM Domnești AG (SM1104D0) și manevrele de refulare: finalizate la ora ${ORA}.`,
      `2. Introducerea obturatoarelor pneumatice: finalizată la ora ${ORA}.`,
      `3. Debitarea anti-Ex a conductei: finalizată la ora ${ORA}.`,
      `4. Verificarea lipsei de gaze în zona de lucru (detector, % LIE): rezultat __________, ora ${ORA}.`,
      'În urma celor de mai sus, Beneficiarul predă, iar Executantul primește tronsoanele de conductă DN300 aferente cuplării lipsite de orice sarcină (fără presiune și fără gaze naturale), în condiții de siguranță pentru executarea lucrărilor de cuplare.',
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
    expect(ps).toContain('ing. Popescu Ion'); expect(ps).toContain('ing. Ionescu Ștefan')
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
    expect(tot).toContain('tronsoanele de conductă DN______ aferente cuplării')
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

  it('dateInitialePv: proiect fără beneficiar / contract / oameni / carte → câmpuri goale; executantul = implicitul (decizia Răzvan, runda 2)', () => {
    const d = dateInitialePv({ proiect: { cod_intern: 'X1', nume: 'Lucrare', beneficiar: null, nr_contract: null, data_contract: '2026-01-12' } })
    expect(d.beneficiar).toBe(''); expect(d.contract).toBe(''); expect(d.locul).toBe(''); expect(d.diametru).toBe('')
    expect(d.executant).toBe('GAZPET INSTAL S.R.L.')
    expect(EXECUTANT_IMPLICIT).toBe('GAZPET INSTAL S.R.L.')
    expect(d.participanti.map(p => p.calitate)).toEqual(PARTICIPANTI_IMPLICITI)
    expect(d.participanti.every(p => p.nume === '')).toBe(true)
    expect(dateInitialePv().obiectiv).toBe('')
    expect(dateInitialePv({ proiect: { nr_contract: '21/2026' } }).contract).toBe('nr. 21/2026')
  })

  it('dateInitialePv: numele din employees („NUME PRENUME”) ies „ing. Prenume Nume”; id fără angajat → gol', () => {
    const d = dateInitialePv({ proiect: { ...PROIECT, rte_employee_id: 99 }, angajati: ANGAJATI })
    expect(d.participanti.find(p => p.calitate === 'Executant – șef de șantier').nume).toBe('ing. Popescu Ion')
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
    expect(formatDiametru('300')).toBe('DN300')
    for (const v of ['500', 'Dn 500', 'dn500', 'DN 500', ' DN500 ']) expect(formatDiametru(v), v).toBe('DN500')
    expect(formatDiametru('DN 300 / Pn 63')).toBe('DN 300 / Pn 63')
    for (const v of ['5', '12345', 'DN', 'DN 500 mm', 'Ø500']) expect(formatDiametru(v), v).toBe(curata(v))   // negative: rămân cum sunt scrise
    expect(formatDiametru('')).toBe('')
    expect(formatExemplare('4')).toBe('4')
    for (const v of ['0', '-1', '2.5', 'patru', '100', '', null]) expect(formatExemplare(v)).toBe('')
    expect(formatIntervale(' a \r\n\n b ')).toBe('a; b')
    expect(curata(undefined)).toBe('')
  })

  it('numele fișierului: cod intern fără diacritice + data cuplării; fără dată → „_fara_data” (nu ziua de azi, runda 2)', () => {
    expect(numeFisierPv('DOMNEȘTI-21', '2026-11-26')).toBe('PV_predare_conducta_cuplare_DOMNESTI-21_2026-11-26.docx')
    expect(numeFisierPv('Lot 1 / Prunișor', '2026-11-26')).toBe('PV_predare_conducta_cuplare_Lot_1_Prunisor_2026-11-26.docx')
    expect(numeFisierPv('PIS_RAU_DOAMNEI', '')).toBe('PV_predare_conducta_cuplare_PIS_RAU_DOAMNEI_fara_data.docx')
    expect(numeFisierPv(null, null)).toBe('PV_predare_conducta_cuplare_proiect_fara_data.docx')
    for (const v of ['26.11.2026', '2026-11-2', 'mâine']) expect(numeFisierPv('X', v), v).toBe('PV_predare_conducta_cuplare_X_fara_data.docx')
  })

  it('modelul nu conține nume de program sau AI', () => {
    const tot = JSON.stringify(modelPvCuplare(complet()))
    expect(tot).not.toMatch(/claude|rocky|\bAI\b|generat automat|pregătit de|ERP/i)
  })
})

// review #1142: caracterele interzise in XML 1.0 nu ajung in document
import { curata as curataXml } from './pvCuplareDocx.js'
import { describe as descrieXml, it as testXml, expect as asteaptaXml } from 'vitest'
descrieXml('curata: caractere interzise in XML', () => {
  testXml('U+0001, U+000B, U+FFFE si surogate izolate se scot; tab / linie noua si diacriticele raman', () => {
    asteaptaXml(curataXml('Lucru\u0001control')).toBe('Lucrucontrol')
    asteaptaXml(curataXml('a\u000Bb\uFFFEc')).toBe('abc')
    asteaptaXml(curataXml('x\uD800y')).toBe('xy')
    asteaptaXml(curataXml('ș ț\tă\nî')).toBe('ș ț\tă\nî')
    asteaptaXml(curataXml('emoji 😀')).toBe('emoji 😀')
  })
})

// ─── Runda 2 (test live 19.11.2026): completarea ca la modelul de la Domnești ───
// Textele așteptate sunt copiate din PV-ul de referință (referinta\…Domnesti_26.11.2026.docx, analiza_referinta.txt), nu din cod.
describe('PV cuplare r2 — executant, loc, beneficiar, oameni, din datele reale', () => {
  const CARTE = { proiect_id: 7, beneficiar_nume: 'SNTGN TRANSGAZ SA Mediaș (carte)', localitate: 'zona Domnești', judet: 'Argeș' }
  const CONTRACT_LIDER = { id: 40, tip_contract: 'asociere', rol_gazpet: 'lider', beneficiar: { nume: 'SNTGN TRANSGAZ SA Mediaș' } }

  it('executant: fără contract / contract simplu / rol necunoscut = GAZPET INSTAL S.R.L.; asociere = structura cu linia asociatului', () => {
    for (const c of [null, undefined, {}, { tip_contract: 'subcontractare', rol_gazpet: 'lider' }, { tip_contract: 'asociere', rol_gazpet: 'asociat_unic' },
      { tip_contract: 'asociere', rol_gazpet: null }, { tip_contract: 'Asociere ', rol_gazpet: 'LIDER' }]) {
      expect(executantDinContract(c), JSON.stringify(c)).toBe('GAZPET INSTAL S.R.L.')
    }
    expect(executantDinContract(CONTRACT_LIDER)).toBe('Asocierea GAZPET INSTAL S.R.L. (lider) – ____________________ (asociat)')
    expect(executantDinContract({ tip_contract: 'asociere', rol_gazpet: 'asociat_simplu' })).toBe('Asocierea ____________________ (lider) – GAZPET INSTAL S.R.L. (asociat)')
  })

  it('locul: „amplasamentul lucrării, <localitate>, jud. <județ>” ca în model; ce lipsește se sare; ambele lipsă = gol', () => {
    expect(formatLocul('zona Domnești', 'Argeș')).toBe('amplasamentul lucrării, zona Domnești, jud. Argeș')   // = rândul „Locul” din model
    expect(formatLocul('Domnești', 'jud. Argeș')).toBe('amplasamentul lucrării, Domnești, jud. Argeș')
    expect(formatLocul('Domnești', 'Județul Argeș')).toBe('amplasamentul lucrării, Domnești, jud. Argeș')
    expect(formatLocul('Domnești', '')).toBe('amplasamentul lucrării, Domnești')
    expect(formatLocul(null, 'Argeș')).toBe('amplasamentul lucrării, jud. Argeș')
    expect(formatLocul('Jupa', 'Jurilovca')).toBe('amplasamentul lucrării, Jupa, jud. Jurilovca')   // „Ju…” nu e prefixul „jud.”
    for (const [l, j] of [[null, null], ['', '  '], [undefined, undefined]]) expect(formatLocul(l, j)).toBe('')
  })

  it('nume „ing. Prenume Nume” din „NUME_FAMILIE PRENUME”: prenume multiple, cratimă, diacritice, un singur cuvânt, gol', () => {
    expect(formatNumeIng('NICA EUGEN')).toBe('ing. Nica Eugen')
    expect(formatNumeIng('DADULESCU COSMIN GRIGORAS')).toBe('ing. Dadulescu Cosmin Grigoras')
    expect(formatNumeIng('POPESCU-IONESCU ANA-MARIA')).toBe('ing. Popescu-Ionescu Ana-Maria')
    expect(formatNumeIng('  ȘTEFĂNESCU   ȚICU ')).toBe('ing. Ștefănescu Țicu')
    expect(formatNumeIng(`${String.fromCharCode(0x015E)}ERBAN ION`)).toBe('ing. Șerban Ion')   // sedilă → virgulă
    expect(formatNumeIng('POPESCU')).toBe('ing. Popescu')
    for (const v of [null, undefined, '', '   ']) expect(formatNumeIng(v)).toBe('')
  })

  it('beneficiar: registrul (prin contract) → cartea tehnică → proiectul; locul din carte; executantul din contract', () => {
    const tot = dateInitialePv({ proiect: { ...PROIECT, contract_id: 40 }, angajati: ANGAJATI, carte: CARTE, contract: CONTRACT_LIDER })
    expect(tot.beneficiar).toBe('SNTGN TRANSGAZ SA Mediaș')
    expect(tot.locul).toBe('amplasamentul lucrării, zona Domnești, jud. Argeș')
    expect(tot.executant).toBe('Asocierea GAZPET INSTAL S.R.L. (lider) – ____________________ (asociat)')
    expect(dateInitialePv({ proiect: PROIECT, carte: CARTE }).beneficiar).toBe('SNTGN TRANSGAZ SA Mediaș (carte)')
    expect(dateInitialePv({ proiect: PROIECT, carte: { ...CARTE, beneficiar_nume: '  ' }, contract: { beneficiar: null } }).beneficiar).toBe('SNTGN TRANSGAZ SA')
    expect(dateInitialePv({ proiect: PROIECT, contract: { beneficiar: { nume: '' } } }).beneficiar).toBe('SNTGN TRANSGAZ SA')
    // fără carte: locul gol (numele șantierului NU mai e sugestie); diametrul nu are coloană pe proiect → gol, nu dedus din nume
    const fara = dateInitialePv({ proiect: { ...PROIECT, nume: 'Punere în siguranță DN500 Schitu Golești', site_name: 'GAzpet - Punere in siguranta - Transgaz' } })
    expect(fara.locul).toBe(''); expect(fara.diametru).toBe(''); expect(fara.executant).toBe('GAZPET INSTAL S.R.L.')
  })
})

describe('PV cuplare r2 — fraza de început din Partea I, ca în model', () => {
  it('frazaInterval: rândurile care se termină cu HH:MM–HH:MM se recompun; restul rămâne neschimbat', () => {
    expect(frazaInterval('punere în siguranță 08:00–09:30')).toBe('operațiuni de punere în siguranță în intervalul 08:00–09:30')
    expect(frazaInterval('extragere obturatoare 16:00-17:00')).toBe('operațiuni de extragere obturatoare în intervalul 16:00–17:00')
    expect(frazaInterval('punere în siguranță: 8:00 — 9:30')).toBe('operațiuni de punere în siguranță în intervalul 8:00–9:30')
    expect(frazaInterval('Extragere obturatoare 16:00–17:00')).toBe('Extragere obturatoare în intervalul 16:00–17:00')   // majusculă = textul omului, fără prefix
    expect(frazaInterval('operațiuni de punere în siguranță 08:00–09:30')).toBe('operațiuni de punere în siguranță în intervalul 08:00–09:30')
    // deja în forma modelului = neschimbat (fără „în intervalul în intervalul”)
    expect(frazaInterval('operațiuni de punere în siguranță în intervalul 08:00–09:30')).toBe('operațiuni de punere în siguranță în intervalul 08:00–09:30')
    expect(frazaInterval('manevre între 10:00–11:00')).toBe('manevre între 10:00–11:00')
    expect(frazaInterval('08:00–09:30')).toBe('în intervalul 08:00–09:30')
    // negative: fără interval la final = textul exact, nimic pierdut
    for (const v of ['verificare la 10:00', 'punere în siguranță 08:00–09:30 (estimat)', 'între 08:00 și 09:30', 'ora 8', '08:00–09:30–10:00x', ''])
      expect(frazaInterval(v), v).toBe(v)
  })

  it('fraza completă din model, caracter cu caracter', async () => {
    const date = { ...complet(), beneficiar: 'Transgaz', sursa_program: 'e-mail Sucursala Mediaș din 19.11.2026', intervale: 'punere în siguranță 08:00–09:30' }
    const ps = paragrafe((await xmlDocument(date)).xml)
    expect(ps).toContain('Astăzi, 26.11.2026, conform programului comunicat de Transgaz (e-mail Sucursala Mediaș din 19.11.2026: operațiuni de punere în siguranță în intervalul 08:00–09:30), s-au constatat următoarele:')
  })

  it('frazaProgram: ce lipsește e linie; mai multe intervale unite cu „; ”', () => {
    expect(frazaProgram({})).toBe('__________: ____________________')
    expect(frazaProgram({ sursa_program: 'e-mail' })).toBe('e-mail: ____________________')
    expect(frazaProgram({ intervale: 'punere în siguranță 08:00–09:30\n\nextragere obturatoare 16:00–17:00' }))
      .toBe('__________: operațiuni de punere în siguranță în intervalul 08:00–09:30; operațiuni de extragere obturatoare în intervalul 16:00–17:00')
    expect(frazaProgram(null)).toBe('__________: ____________________')
  })

  it('documentul cu executant în asociere: rândul din antet și semnătura poartă aceeași structură', async () => {
    const date = { ...complet(), executant: executantDinContract({ tip_contract: 'asociere', rol_gazpet: 'lider' }) }
    const ps = paragrafe((await xmlDocument(date)).xml)
    expect(ps).toContain('Executant: Asocierea GAZPET INSTAL S.R.L. (lider) – ____________________ (asociat)')
    expect(ps).toContain('EXECUTANT – Asocierea GAZPET INSTAL S.R.L. (lider) – ____________________ (asociat)')
  })
})
