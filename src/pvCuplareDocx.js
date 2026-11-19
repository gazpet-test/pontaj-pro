// ════════════════════════════════════════════════════════════════
// pvCuplareDocx.js — Execuție: „Proces-verbal de predare-primire a conductei în vederea cuplării” (.docx, în browser).
//
// - Generatorul Word e cel deja folosit în aplicație (librăria `docx`, ca în OfertareExport.js; e deja inclusă în build-ul live
//   prin Logistica / Ofertare), deci nimic nou în package.json.
// - Logica e în două trepte, testabile separat: modelPvCuplare(date) → blocuri de text simple; construiestePvCuplare(date) → Document.
// - Ce lipsește rămâne LINIE de completat de mână, niciodată „undefined” / „null”.
// - Orele efective (predare, repredare, fiecare operațiune) NU sunt câmpuri: rămân mereu LINIE_ORA, se scriu de mână pe loc.
// - Diacritice: ş / ţ cu sedilă (din copy-paste) devin ș / ț cu virgulă.
// - Fără nume de program / AI în document; autorul e cel care îl semnează (metadatele: firma, nu librăria).
// - Runda 2 (test live 19.11.2026, modelul de la Domnești): executant implicit / asociere din contractul legat, locul din cartea
//   tehnică (localitate, județ), beneficiarul complet din registru, „DN500”, „ing. Nume Prenume”, fraza programului ca în model,
//   titlul 12 pt, fișierul fără dată = „_fara_data”. Ce nu există în ERP rămâne gol / linie (nimic dedus din text liber).
// ════════════════════════════════════════════════════════════════
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx'

export const FONT_PV = 'Arial'
export const MARIME_PV = 21                  // jumătăți de punct: 10,5 pt
export const MARIME_TITLU = 24               // 12 pt (runda 2)
export const LINIE_ORA = '____:____'
export const LINIE = '____________________'  // câmp text necompletat
export const LINIE_SCURTA = '__________'
export const LINIE_NR = '______'
export const LINIE_DATA = '____________'
export const LINIE_EXEMPLARE = '____'
export const EXECUTANT_IMPLICIT = 'GAZPET INSTAL S.R.L.'
export const TITLU_PV = 'PROCES-VERBAL DE PREDARE-PRIMIRE A CONDUCTEI ÎN VEDEREA CUPLĂRII'

export const PARTICIPANTI_IMPLICITI = [
  'Transgaz – Sucursala Mediaș (punere în siguranță)',
  'Transgaz – Exploatarea Teritorială / Sector (manevre)',
  'Diriginte de șantier',
  'Executant – șef de șantier',
  'Executant – RTE',
]

// ş ţ Ş Ţ (sedilă) → ș ț Ș Ț (virgulă). Codurile scrise numeric, ca să nu le schimbe un editor.
const SEDILE = [[0x015F, 0x0219], [0x0163, 0x021B], [0x015E, 0x0218], [0x0162, 0x021A]]
  .map(([din, in_]) => [String.fromCharCode(din), String.fromCharCode(in_)])

/** Text curat: null / undefined → '', spații de la capete scoase, diacritice cu virgulă. */
export function curata(v) {
  if (v === null || v === undefined) return ''
  // caracterele interzise in XML 1.0 (control, U+FFFE/U+FFFF, surogate izolate) se scot: altfel word/document.xml iese invalid (review #1142)
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').trim()
  for (const [din, in_] of SEDILE) s = s.split(din).join(in_)
  return s
}
const sauLinie = (v, linie = LINIE) => curata(v) || linie

/** 'AAAA-LL-ZZ' (input de tip dată / coloană date) → 'ZZ.LL.AAAA'; textul liber rămâne cum e scris. Fără new Date (fus orar). */
export function formatDataPv(v) {
  const s = curata(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s
}

/** Diametrul, ca în model: „500” / „Dn 500” / „dn500” → „DN500”; orice altceva (ex. „DN 300 / Pn 63”) rămâne cum e scris. */
export function formatDiametru(v) {
  const s = curata(v)
  if (!s) return ''
  const m = /^(?:dn[ \t]*)?(\d{2,4})$/i.exec(s)
  return m ? `DN${m[1]}` : s
}

/** Numele din employees („NUME_FAMILIE PRENUME…”, primul cuvânt = numele de familie) → „ing. Nume Prenume…” (ca în PV-ul de la Domnești), majuscule doar la inițiale. */
export function formatNumeIng(v) {
  const cuvinte = curata(v).split(/\s+/).filter(Boolean)
  if (!cuvinte.length) return ''
  // inițiala mare după început, cratimă sau apostrof (POPESCU-IONESCU → Popescu-Ionescu); diacriticele rămân
  const titlu = w => w.toLocaleLowerCase('ro-RO').replace(/(^|[-'’])(\p{L})/gu, (_, sep, l) => sep + l.toLocaleUpperCase('ro-RO'))
  const [familie, ...prenume] = cuvinte.map(titlu)
  return `ing. ${[familie, ...prenume].join(' ')}`   // ordinea din PV-ul de la Domnești: „ing. Nica Eugen” (decizia Răzvan 19.11.2026)
}

/** Locul, ca în model: „amplasamentul lucrării, <localitate>, jud. <județ>”; ce lipsește se sare; ambele lipsă = gol. */
export function formatLocul(localitate, judet) {
  const loc = curata(localitate)
  const jud = curata(judet).replace(/^jud(?:e[tț]ul)?\.?[ \t]*/i, '')   // „jud. Argeș” / „județul Argeș” / „Argeș” → „Argeș”
  if (!loc && !jud) return ''
  return ['amplasamentul lucrării', loc, jud && `jud. ${jud}`].filter(Boolean).join(', ')
}

/**
 * Executantul din contractul legat (contracte_terti: tip_contract + rol_gazpet). ERP-ul ține doar ROLUL Gazpet în asociere, nu și
 * numele asociatului → acela rămâne linie de completat. Fără asociere (sau rol necunoscut) = GAZPET INSTAL S.R.L. (decizia Răzvan).
 */
export function executantDinContract(contract) {
  if (curata(contract?.tip_contract) !== 'asociere') return EXECUTANT_IMPLICIT
  const rol = curata(contract?.rol_gazpet)
  if (rol === 'lider') return `Asocierea ${EXECUTANT_IMPLICIT} (lider) – ${LINIE} (asociat)`
  if (rol === 'asociat_simplu') return `Asocierea ${LINIE} (lider) – ${EXECUTANT_IMPLICIT} (asociat)`
  return EXECUTANT_IMPLICIT
}

/** Numărul de exemplare: doar un număr întreg 1–99; altfel linie de completat. */
export function formatExemplare(v) {
  const s = curata(v)
  return /^[1-9]\d?$/.test(s) ? s : ''
}

/**
 * Un rând de interval, ca în model: „punere în siguranță 08:00–09:30” → „operațiuni de punere în siguranță în intervalul 08:00–09:30”.
 * Doar rândul care SE TERMINĂ cu „HH:MM–HH:MM” se recompune (cratima devine „–”); textul scris rămâne întreg. „operațiuni de” se
 * pune doar dacă rândul începe cu literă mică și nu începe deja cu „operațiun”; „în intervalul” nu se dublează. Restul = neschimbat.
 */
export function frazaInterval(v) {
  const s = curata(v)
  const m = /^(.*?)[ \t]*(\d{1,2}:\d{2})[ \t]*[-–—][ \t]*(\d{1,2}:\d{2})$/u.exec(s)
  if (!m) return s
  const text = m[1].replace(/[ \t,:;]+$/u, '')
  const ore = `${m[2]}–${m[3]}`
  if (!text) return `în intervalul ${ore}`
  if (/(?:^|[ \t])(?:în[ \t]+intervalul|intervalul|între)$/iu.test(text)) return `${text} ${ore}`
  const pref = /^\p{Ll}/u.test(text) && !/^operațiun/iu.test(text) ? 'operațiuni de ' : ''
  return `${pref}${text} în intervalul ${ore}`
}

/** Intervalele programate: unul pe rând în formular → „a; b” în document, fiecare recompus cu frazaInterval. */
export function formatIntervale(v) {
  return curata(v).split(/\r?\n/).map(frazaInterval).filter(Boolean).join('; ')
}

/** Paranteza din fraza de început a Părții I: „<sursa>: <intervale>”; ce lipsește = linie. Folosită și de previzualizarea din formular. */
export function frazaProgram(d = {}) {
  return `${sauLinie(d?.sursa_program, LINIE_SCURTA)}: ${formatIntervale(d?.intervale) || LINIE}`
}

/** Numele fișierului: PV_predare_conducta_cuplare_[cod_intern]_[AAAA-LL-ZZ].docx (data cuplării); fără dată → „_fara_data” (runda 2). */
export function numeFisierPv(codIntern, dataCuplare) {
  const cod = curata(codIntern).normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'proiect'
  const d = curata(dataCuplare)
  const zi = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : 'fara_data'
  return `PV_predare_conducta_cuplare_${cod}_${zi}.docx`
}

/**
 * Formularul inițial din datele proiectului (coloane reale, verificate în migrări / ecranele care le scriu):
 * - `proiect` = rândul din executie_proiecte (cod_intern, nume, beneficiar, nr_contract, data_contract, contract_id,
 *   sef_santier_employee_id, rte_employee_id); `angajati` = { [id]: { name } };
 * - `carte` = rândul din ctc_carti al proiectului (beneficiar_nume, localitate, judet; UNIQUE pe proiect_id) sau null;
 * - `contract` = rândul din contracte_terti legat prin contract_id (tip_contract, rol_gazpet, beneficiar: { nume } din beneficiari) sau null.
 * Beneficiarul: registrul de beneficiari (prin contract) → cartea tehnică → textul din proiect. Diametrul nu are coloană pe proiect:
 * rămâne gol (nu se deduce din nume). Ce lipsește rămâne gol.
 */
export function dateInitialePv({ proiect, angajati = {}, carte = null, contract = null } = {}) {
  const p = proiect || {}
  const nume = id => (id != null && angajati[id] ? formatNumeIng(angajati[id].name) : '')
  const nr = curata(p.nr_contract)
  const dc = formatDataPv(p.data_contract)
  const contractText = nr ? `nr. ${nr}${dc ? ` din ${dc}` : ''}` : ''
  const persoane = { 'Executant – șef de șantier': nume(p.sef_santier_employee_id), 'Executant – RTE': nume(p.rte_employee_id) }
  return {
    cod_intern: curata(p.cod_intern),
    nr_pv: '', data_cuplarii: '',
    obiectiv: curata(p.nume), contract: contractText,
    beneficiar: curata(contract?.beneficiar?.nume) || curata(carte?.beneficiar_nume) || curata(p.beneficiar),
    executant: executantDinContract(contract),
    locul: formatLocul(carte?.localitate, carte?.judet),
    sursa_program: '', intervale: '', srm: '', diametru: '', exemplare: '',
    participanti: PARTICIPANTI_IMPLICITI.map(calitate => ({ calitate, nume: persoane[calitate] || '' })),
  }
}

// ─── Modelul documentului: blocuri simple, fără docx (testabil direct) ───
// p: { tip:'p', runs:[{ text, bold }], align?, dupa? } · titlu · tabel_participanti · tabel_semnaturi
const r = (text, bold = false) => ({ text, bold })
const par = (runs, o = {}) => ({ tip: 'p', runs: Array.isArray(runs) ? runs : [r(runs)], ...o })
const gol = () => par('')

export function modelPvCuplare(date = {}) {
  const d = date || {}
  const dataC = formatDataPv(d.data_cuplarii) || LINIE_DATA
  const beneficiar = sauLinie(d.beneficiar)
  const executant = sauLinie(d.executant)
  const dn = formatDiametru(d.diametru) || `DN${LINIE_NR}`
  const ex = formatExemplare(d.exemplare) || LINIE_EXEMPLARE
  const antet = (eticheta, v) => par([r(`${eticheta}: `, true), r(sauLinie(v))])
  const participanti = (Array.isArray(d.participanti) ? d.participanti : [])
    .map(x => [curata(x?.calitate), curata(x?.nume)])

  return [
    { tip: 'titlu', text: TITLU_PV },
    par(`Nr. ${sauLinie(d.nr_pv, LINIE_NR)} / ${dataC}`, { align: 'center', dupa: 240 }),
    antet('Obiectiv', d.obiectiv),
    antet('Contract', d.contract),
    antet('Beneficiar', d.beneficiar),
    antet('Executant', d.executant),
    antet('Locul', d.locul),
    gol(),
    par([r('Participanți', true)]),
    { tip: 'tabel_participanti', cap: ['Calitatea', 'Numele și prenumele', 'Semnătura'], randuri: participanti },
    gol(),
    par([r('Partea I – Predarea conductei de către Beneficiar către Executant', true)]),
    par(`Astăzi, ${dataC}, conform programului comunicat de ${beneficiar} (${frazaProgram(d)}), s-au constatat următoarele:`, { align: 'justify' }),
    par(`1. Sistarea livrărilor prin ${sauLinie(d.srm)} și manevrele de refulare: finalizate la ora ${LINIE_ORA}.`),
    par(`2. Introducerea obturatoarelor pneumatice: finalizată la ora ${LINIE_ORA}.`),
    par(`3. Debitarea anti-Ex a conductei: finalizată la ora ${LINIE_ORA}.`),
    par(`4. Verificarea lipsei de gaze în zona de lucru (detector, % LIE): rezultat ${LINIE_SCURTA}, ora ${LINIE_ORA}.`),
    par([
      r(`În urma celor de mai sus, Beneficiarul predă, iar Executantul primește tronsoanele de conductă ${dn} aferente cuplării `),
      r('lipsite de orice sarcină', true),
      r(' (fără presiune și fără gaze naturale), în condiții de siguranță pentru executarea lucrărilor de cuplare.'),
    ], { align: 'justify' }),
    par([r(`Data și ora predării: ${dataC}, ora ${LINIE_ORA}`, true)]),
    gol(),
    par([r('Partea II – Executarea cuplării și repredarea conductei către Beneficiar', true)]),
    par(`1. Începerea lucrărilor de cuplare propriu-zise: ora ${LINIE_ORA}.`),
    par(`2. Finalizarea sudurilor de cuplare: ora ${LINIE_ORA}.`),
    par(`3. Verificarea sudurilor conform proiectului (metoda: ${LINIE_SCURTA}, rezultat: ${LINIE_SCURTA}): ora ${LINIE_ORA}.`),
    par('Executantul predă Beneficiarului conducta cuplată, în vederea extragerii obturatoarelor pneumatice, blindării flanșelor multifuncționale și presurizării.', { align: 'justify' }),
    par([r(`Data și ora repredării: ${dataC}, ora ${LINIE_ORA}`, true)]),
    gol(),
    par([r('Partea III – Mențiuni', true)]),
    par('Abateri față de programul comunicat (întârzieri, cauze, partea care le-a generat):'),
    ...[1, 2, 3].map(() => par(LINIE.repeat(4))),
    par('Alte observații:'),
    ...[1, 2].map(() => par(LINIE.repeat(4))),
    par(`Prezentul proces-verbal s-a încheiat în ${ex} exemplare, câte unul pentru fiecare parte.`),
    gol(),
    { tip: 'tabel_semnaturi', coloane: [`BENEFICIAR – ${beneficiar}`, 'DIRIGINTE DE ȘANTIER', `EXECUTANT – ${executant}`] },
  ]
}

// ─── Documentul Word ───
const run = (x, o = {}) => new TextRun({ text: x.text, bold: x.bold || o.bold || undefined, font: FONT_PV, size: o.size ?? MARIME_PV })
const ALINIERE = { center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED }
const paragraf = (b, o = {}) => new Paragraph({
  alignment: ALINIERE[b.align], spacing: { after: b.dupa ?? 80 },
  children: b.runs.map(x => run(x, o)),
})
const CHENAR = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const FARA = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const chenare = c => ({ top: c, bottom: c, left: c, right: c, insideHorizontal: c, insideVertical: c })
const celula = (paragrafe, latime) => new TableCell({ width: { size: latime, type: WidthType.PERCENTAGE }, children: paragrafe })

function tabelParticipanti(b) {
  const LAT = [40, 35, 25]
  const rand = (valori, bold) => new TableRow({
    children: valori.map((v, i) => celula([new Paragraph({ spacing: { before: 60, after: 60 }, children: [run(r(v, bold))] })], LAT[i])),
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: chenare(CHENAR),
    rows: [rand(b.cap, true), ...b.randuri.map(([calitate, nume]) => rand([calitate, nume, ''], false))],
  })
}

function tabelSemnaturi(b) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: chenare(FARA),
    rows: [new TableRow({ children: b.coloane.map(t => celula([
      new Paragraph({ alignment: AlignmentType.CENTER, children: [run(r(t, true))] }),
      new Paragraph({ children: [] }), new Paragraph({ children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [run(r(LINIE))] }),
    ], 33)) })],
  })
}

export function construiestePvCuplare(date) {
  const copii = modelPvCuplare(date).map(b => {
    if (b.tip === 'titlu') return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(r(b.text, true), { size: MARIME_TITLU })] })
    if (b.tip === 'tabel_participanti') return tabelParticipanti(b)
    if (b.tip === 'tabel_semnaturi') return tabelSemnaturi(b)
    return paragraf(b)
  })
  return new Document({
    // metadatele din Word (Fișier → Informații): firma, nu „Un-named” din librărie
    creator: EXECUTANT_IMPLICIT, lastModifiedBy: EXECUTANT_IMPLICIT, title: TITLU_PV,
    styles: { default: { document: { run: { font: FONT_PV, size: MARIME_PV } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      children: copii,
    }],
  })
}

export const blobPvCuplare = date => Packer.toBlob(construiestePvCuplare(date))
