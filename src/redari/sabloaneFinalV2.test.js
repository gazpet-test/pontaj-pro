// Șabloanele refăcute din modelele Final_v2 ale juristului (03.11.2026): conținutul cerut de deciziile juridic#028 + #029.
// Textul se citește direct din DOCX-urile reale (public/redari/sabloane), independent de generatoare.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
// exportXlsx.js → ui/comune.jsx importă clientul Supabase; testul nu face cereri (la fel ca exportXlsx.test.js)
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { TERMEN_CONVOCARE_ZILE } from './setari.js'
import { STARI, etichetaStare, calculeazaStare } from './stare.js'
import { randRegistru, construiesteWorkbook, foaieCentralizator } from './exportXlsx.js'
import { genereazaPvB, BIFA_DA, BIFA_NU } from './pv.js'
import { OPTIUNI_RASPUNS } from './ui/comune.jsx'

const SABLOANE = ['convocator', 'pv_a', 'pv_b', 'adresa_uat', 'pv_c']

// Detectorul „lipsa răspunsului = acord” (Copilot f-v2 r3 P2-02) lucrează pe text normalizat: fără diacritice, litere mici,
// spații comprimate; fiecare paragraf / celulă separat.
const normalizeaza = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
// Excepțiile legitime, numite explicit și scoase ÎNAINTE de detecție (restul frazei se verifică în continuare, deci o negație
// nu acoperă un acord adăugat după ea): numele actului „Acordul de mediu” și negația „nu reprezintă / nu valorează acceptarea tacită”.
const NEUTRE = [
  /\bacord(?:ul|ului)? de mediu\b/g,
  /\bnu (?:reprezinta|valoreaza|inseamna|constituie|echivaleaza cu) (?:o |un )?(?:acceptare|acceptarea|acord|acordul|consimtamant|consimtamantul) tacit(?:a|e|ul)?\b/g,
]
const ACORD = String.raw`\b(?:de acord|acord\w*|accept\w*|consimt\w*)`
const DETECTORI = [
  // orice „tacit” rămas după scoaterea negației explicite (acord tacit, acceptare tacită, consimțământ tacit)
  /\btacit/,
  // „acord prezumat”, „se prezumă acordul”
  new RegExp(String.raw`\bprezum\w*.{0,40}${ACORD}|${ACORD}.{0,20}\bprezum`),
  // „se consideră de acord”, „este considerat că acceptă”, „se interpretează ca acord”
  new RegExp(String.raw`\b(?:consider|interpret|socot|reput)\w*.{0,60}${ACORD}`),
  // „în lipsa unui răspuns … de acord”, „nerăspunsul reprezintă acceptare”, „tăcerea … acord”, „fără răspuns … acceptat”
  new RegExp(String.raw`\b(?:lipsa|absenta|neraspuns\w*|nerespuns\w*|tacere\w*|fara (?:un |niciun )?raspuns)\b.{0,160}${ACORD}`),
  // condiționale (Copilot f-v2 r4 P3): „dacă nu răspundeți, sunteți de acord”, „dacă nu vă prezentați … acceptați”,
  // „în cazul în care nu transmiteți obiecții … acceptată”; verbul după „nu” e o acțiune a deținătorului, deci
  // „dacă nu sunteți de acord, formulați obiecții” (dezacord explicit) rămâne nemarcat
  new RegExp(String.raw`\b(?:daca|in cazul in care|cand|atunci cand) nu (?:va |ne |ni |se |le )?(?:(?:puteti|poti|doriti|veti|mai) )?(?:raspund|prezent|semn|transmit|comunic|formul|depun|contest|opun|trimit|return|participa|veni)\w*\b.{0,120}${ACORD}`),
  // substantivele negate (Copilot f-v2 r4 P3): „nesemnarea înseamnă acord”, „neprezentarea valorează acceptare”, „necontestarea …”
  new RegExp(String.raw`\bne(?:semn|prezent|contest|formul|opun|transmit|depun|participa|returna)\w*\b.{0,80}${ACORD}`),
]
function gasesteAcord(text) {
  let t = normalizeaza(text)
  for (const rx of NEUTRE) t = t.replace(rx, ' ')
  for (const rx of DETECTORI) { const m = rx.exec(t); if (m) return m[0] }
  return null
}
const acorduri = texte => texte.map(gasesteAcord).filter(Boolean)
const RX_P = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g
const RX_T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
const decodeaza = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

async function citeste(nume) {
  const zip = await JSZip.loadAsync(readFileSync(`public/redari/sabloane/${nume}.docx`))
  const xml = await zip.file('word/document.xml').async('string')
  const paragrafe = [...xml.matchAll(RX_P)].map(m => decodeaza([...m[0].matchAll(RX_T)].map(t => t[1]).join(''))).filter(Boolean)
  return { zip, xml, paragrafe, text: paragrafe.join('\n') }
}

describe('șabloanele Final_v2', () => {
  it.each(SABLOANE)('%s: fără linia „MODEL – DRAFT INTERN”, fără miniatură și fără numele ultimului editor', async nume => {
    const { zip, text } = await citeste(nume)
    expect(text).not.toMatch(/DRAFT/)
    expect(zip.file('docProps/thumbnail.jpeg')).toBeNull()
    expect(await zip.file('docProps/core.xml').async('string')).toMatch(/<cp:lastModifiedBy><\/cp:lastModifiedBy>|<cp:lastModifiedBy\/>|^(?![\s\S]*lastModifiedBy)/)
  })

  it.each(SABLOANE)('%s: lipsa răspunsului nu e marcată nicăieri ca acord (detector pe text normalizat)', async nume => {
    const { paragrafe } = await citeste(nume)
    expect(acorduri(paragrafe)).toEqual([])
  })


  it('PV A: semnează și Antreprenorul (3 semnatari), fără fotografii', async () => {
    const { paragrafe, text } = await citeste('pv_a')
    expect(paragrafe).toEqual(expect.arrayContaining(['Deținătorul terenului', 'S.N.T.G.N. TRANSGAZ S.A. – Beneficiar', 'GAZPET INSTAL S.R.L. – Antreprenor']))
    expect(paragrafe.slice(-3)).toEqual(['{{semnatar_detinator}}', '{{semnatar_tgz}}', '{{semnatar_gazpet}}'])
    expect(text).not.toMatch(/fotograf|foto_nr|bifa_foto/i)
    expect(text).toContain('Plan de situație anexat: {{bifa_plan_da}} DA {{bifa_plan_nu}} NU.')
  })

  it('PV B: fără fotografii, topo / plan de situație și jurnal de șantier; trimiterea la PV A rămâne', async () => {
    const { paragrafe, text } = await citeste('pv_b')
    expect(text).not.toMatch(/fotograf|topo|plan de situa|jurnal|bifa_plan|bifa_foto/i)
    expect(paragrafe).toContain('{{pv_a_referinta}}')
    expect(paragrafe[paragrafe.indexOf('{{pv_a_referinta}}') - 1]).toMatch(/^Nume: \{\{nume\}\}/)
    expect(text).toContain('{{bifa_fara_raspuns}} fără răspuns')
  })

  it('convocator: „Date personale” + {{text_gdpr}} pe tot paragraful, {{qr}} singur, lipsa răspunsului duce la constatarea tehnică', async () => {
    const { paragrafe } = await citeste('convocator')
    expect(paragrafe[paragrafe.indexOf('Date personale') + 1]).toBe('{{text_gdpr}}')
    expect(paragrafe).toContain('{{qr}}')
    expect(paragrafe).toContain('În lipsa participării sau a unui răspuns, reprezentanții Beneficiarului, ai Antreprenorului și ai Primăriei pot efectua o constatare tehnică documentată a stării terenului.')
  })

  it('adresa UAT: termenul din text = TERMEN_CONVOCARE_ZILE, un singur rând-șablon, antetul firmei din convocator și fără „online”', async () => {
    const { xml, text, paragrafe } = await citeste('adresa_uat')
    expect(text).toContain(`(cu cel puțin ${TERMEN_CONVOCARE_ZILE} zile înainte de prima sesiune)`)
    expect(xml.match(/\{\{rand\.nr\}\}/g)).toHaveLength(1)
    expect(text).not.toMatch(/online la/)
    // excepția (9), DE CONFIRMAT (claude#026 întrebarea 1): antetul = exact primul paragraf din convocator, la începutul documentului
    const { paragrafe: conv } = await citeste('convocator')
    expect(conv[0]).toContain('Lider al Asocierii')
    expect(paragrafe[0]).toBe(conv[0])
    expect(paragrafe[0]).toBe('GAZPET INSTAL S.R.L. · Str. Fluturilor nr. 34, Ploiești, jud. Prahova · CUI RO 22029920 · Tel./Fax 0244 435 005 · office@gazpet.ro'
      + 'Lider al Asocierii Gazpet Instal – Moldocor – Habau – Comesad RO · Contract Transgaz nr. {{contract_nr}}/{{contract_data}} · {{proiect_denumire}}')
    expect(paragrafe[1]).toMatch(/^ADRESĂ către Primăria \{\{uat\}\}/)
    expect(text.match(/Lider al Asocierii/g)).toHaveLength(1)
    expect(text).toContain('GAZPET INSTAL S.R.L. – {{reprezentant_gazpet}}')
  })
})

describe('detectorul „lipsa răspunsului = acord” (mutanți)', () => {
  const MUTANTI = [
    'În lipsa unui răspuns, vom considera că sunteți de acord cu starea terenului.',
    'ÎN   LIPSA  UNUI  RĂSPUNS ÎN 10 ZILE, PROCESUL-VERBAL SE SEMNEAZĂ ȘI SUNTEȚI DE ACORD.',
    'Dacă nu răspundeți, se consideră de acord.',
    'Proprietarul care nu se prezintă este considerat că acceptă procesul-verbal.',
    'Lipsa oricărui răspuns se interpretează ca acord.',
    'Lipsa răspunsului valorează acord prezumat.',
    'Se prezumă acordul deținătorului.',
    'Nerăspunsul reprezintă acceptare.',
    'Tăcerea proprietarului valorează acord.',
    'Fără răspuns până la sesiune, procesul-verbal se consideră acceptat.',
    'Absența răspunsului înseamnă consimțământ.',
    'Constatarea valorează acceptare tacită.',
    'Acord tacit al deținătorului.',
    // negația nu acoperă ce vine după ea
    'Această constatare nu reprezintă acceptarea tacită; tăcerea valorează acord.',
    'Această constatare nu reprezintă acceptarea tacită, ci acord tacit.',
    // condiționale (Copilot f-v2 r4 P3)
    'Dacă nu răspundeți, sunteți de acord.',
    'Dacă nu vă prezentați la sesiune, sunteți de acord cu procesul-verbal.',
    'Dacă nu vă prezentați, acceptați constatarea comisiei.',
    'Dacă nu vă puteți prezenta, sunteți de acord cu starea terenului.',
    'În cazul în care nu transmiteți obiecții, starea terenului este acceptată.',
    'Nesemnarea procesului-verbal înseamnă acord.',
    'Neprezentarea la sesiune valorează acceptare.',
    'În absența unei obiecții scrise, procesul-verbal este acceptat.',
  ]
  it.each(MUTANTI)('prinde: %s', m => { expect(gasesteAcord(m)).not.toBeNull() })
  it.each(['convocator', 'adresa_uat', 'pv_b'])('mutant injectat într-un paragraf real din %s → detectorul pică șablonul', async nume => {
    const { paragrafe } = await citeste(nume)
    for (const m of MUTANTI) {
      const injectat = paragrafe.map((p, i) => (i === paragrafe.length - 3 ? `${p} ${m}` : p))
      expect(acorduri(injectat), m).toHaveLength(1)
    }
  })
  it.each([
    'această constatare nu reprezintă acceptarea tacită din partea dumneavoastră.',
    'Afișarea e publicitate suplimentară; nu valorează acceptare tacită.',
    '☐ Nu particip. Nu am obiecții privind starea terenului și sunt de acord să primesc procesul-verbal completat, spre semnare, prin poștă / electronic.',
    'Sunt de acord ca procesul-verbal să fie întocmit în lipsa mea.',
    'Dacă nu sunteți de acord cu starea terenului, formulați obiecții la sesiune.',
    'Dacă nu vă puteți prezenta, ne puteți răspunde la telefon 0000 000 000, pe e-mail la test@example.invalid.',
    '☐ deținătorul nu s-a prezentat după convocare și afișare',
    'Neprezentarea nu oprește procedura: parcela se finalizează prin procesul-verbal de constatare tehnică (tip B).',
    'potrivit Acordului de mediu nr. 4/18.07.2022 recepția lor se face cu proprietarii',
    'În lipsa participării sau a unui răspuns, reprezentanții Beneficiarului, ai Antreprenorului și ai Primăriei pot efectua o constatare tehnică documentată a stării terenului.',
  ])('excepție / text legitim, NU e marcat: %s', t => { expect(gasesteAcord(t)).toBeNull() })
})

// Fluxul: deținătorul convocat care nu răspunde rămâne „Convocat, fără răspuns” și se finalizează prin PV B; nicio stare,
// etichetă sau celulă de export nu îl transformă în „acord”.
describe('fluxul „convocat, fără răspuns” → PV B, nicăieri „acord”', () => {
  const primita = [{ id: 'c1', detinator_id: 'd1', stare: 'activ', sters_la: null, canal: 'posta', created_at: '2026-11-20', data_expediere: '2026-11-20', data_confirmare_primire: '2026-11-23', nr_document: 'C-0001' }]
  it('stare.js: fără răspuns = CONVOCAT_FARA_RASPUNS; cu PV B = PV_B_CONSTATARE; nicio stare / etichetă de acord', () => {
    expect(acorduri(STARI.flatMap(s => [s.eticheta, s.cod.replace(/_/g, ' ')]))).toEqual([])
    expect(STARI.filter(s => /acord|accept|tacit|consimt/.test(normalizeaza(`${s.cod} ${s.eticheta}`)))).toEqual([])
    const fara = calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta: true, convocari: primita, raspunsuri: [] })
    expect(fara.stare).toBe('CONVOCAT_FARA_RASPUNS')
    expect(etichetaStare(fara.stare)).toBe('Convocat, fără răspuns')
    const cuPvB = calculeazaStare({ calitate: 'proprietar', adresa_cunoscuta: true, convocari: primita, raspunsuri: [], pvs: [{ tip: 'B', stare: 'generat', sters_la: null }] })
    expect(cuPvB.stare).toBe('PV_B_CONSTATARE')
  })
  it('etichetele UI: opțiunile de răspuns și toate textele literale din ecranele Redări nu marchează lipsa răspunsului ca acord', () => {
    expect(acorduri(OPTIUNI_RASPUNS.map(o => o.eticheta))).toEqual([])
    const surse = [...readdirSync('src/redari/ui').filter(f => f.endsWith('.jsx') && !f.includes('.test.')).map(f => `src/redari/ui/${f}`), 'src/Redari.jsx', 'src/RedariRaspunsPublic.jsx']
    const literale = surse.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}\n]+)</g)].map(m => m[1] ?? m[2] ?? m[3] ?? m[4]))
    expect(literale.length).toBeGreaterThan(500)
    expect(acorduri(literale)).toEqual([])
  })
  it('export (registru intern, TGZ, centralizator, legendă): nicio celulă nu marchează lipsa răspunsului ca acord', () => {
    const rand = randRegistru({ parcela: { id: 'p1', id_parcela: 'TEST-1' }, uat: { id: 'u1', nume: 'UAT Fictiv' }, detinator: { id: 'd1', nume: 'FICTIV UNU', calitate: 'proprietar' },
      convocari: primita, raspunsuri: [], stare: 'CONVOCAT_FARA_RASPUNS' })
    expect(rand.AK).toBe('Convocat, fără răspuns')
    expect(rand.X).toBe('')
    const centralizator = foaieCentralizator([{ uat_id: 'u1', stare: 'CONVOCAT_FARA_RASPUNS', numar: 1 }], [{ id: 'u1', nume: 'UAT Fictiv' }])
    for (const pentruTgz of [false, true]) {
      const wb = construiesteWorkbook({ registru: [rand], centralizator, pentruTgz })
      const celule = wb.SheetNames.flatMap(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).flat().map(String))
      expect(celule).toContain('Convocat, fără răspuns')
      expect(acorduri(celule)).toEqual([])
    }
  })
  it('PV B pentru deținătorul fără răspuns: „fără răspuns” bifat, nu „fără obiecții”; documentul nu conține acord', async () => {
    const r = await genereazaPvB({
      proiect: { contract_nr: 'TEST-1', contract_data: '2026-11-02', denumire: 'Test', reprezentant_gazpet_nume: 'FICTIV G', reprezentant_tgz_nume: 'FICTIV T' },
      uat: { nume: 'UAT TEST', reprezentant_uat_nume: 'FICTIV U', sesiune_zi1: '2026-12-10', afisare_data_start: '2026-11-20', afisare_data_end: '2026-12-12' },
      parcela: { tronson: 3, categoria_folosinta: 'Arabil', verificare_data: '2026-12-11', verificare_de_gazpet: 'G', verificare_de_tgz: 'T' },
      pv: { nr_pv: 'PVB-ZZZ-0001', data_pv: '2026-12-13', locul: 'Test', motiv_pv_b: 'neprezentat', lucrari: { nivelare: true }, stare_teren: { nivelat: true } },
      detinatori: [{ id: 'd1', nume: 'FICTIV UNU', calitate: 'proprietar' }], convocari: primita, raspunsuri: [], pvs: [],
      templateArrayBuffer: readFileSync('public/redari/sabloane/pv_b.docx'),
    })
    expect(r.campuri).toMatchObject({ bifa_fara_raspuns: BIFA_DA, bifa_raspuns_fara_obiectii: BIFA_NU, bifa_alt_raspuns: BIFA_NU, bifa_sit_neprezentat: BIFA_DA, bifa_sit_declaratie: BIFA_NU })
    const xml = await (await JSZip.loadAsync(await r.blob.arrayBuffer())).file('word/document.xml').async('string')
    const paragrafe = [...xml.matchAll(RX_P)].map(m => decodeaza([...m[0].matchAll(RX_T)].map(t => t[1]).join(''))).filter(Boolean)
    expect(acorduri(paragrafe)).toEqual([])
  })
})
