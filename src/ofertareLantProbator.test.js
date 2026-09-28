import { describe, expect, it } from 'vitest'
import { compuneLant, clarificareAtingeCerinta, LIPSA } from './ofertareLantProbator.js'
import { incarcaLantProbator } from './ofertareLantProbatorDate.js'

const cerinta = { id:12, licitatie_id:3, versiune:2, text_cerinta:'Responsabil atestat', sursa_document_id:5, raspuns_set_id:9 }
const capitole = [{ id:20, licitatie_id:3, nr:1, titlu:'Personal', versiune:3 }]
const legatura = { id:40, cerinta_id:12, capitol_id:20, fel:'capitol', stare:'atribuita' }
const acoperire = { id:60, cerinta_id:12, mod:'personal', autorizatie_id:1, status:'acoperit', verificat_pe_scan:false, reverificare_ceruta:false }
const fisier = { id:80, pachet_id:70, rol:'propunere_docx', nume:'PT.docx', sha256:'a'.repeat(64), sursa_versiune:'capitole@{20:v2}' }

describe('R17 — lanțul probator', () => {
  it('status acoperit și ales de om nu substituie scanul verificat', () => {
    const l = compuneLant({ cerinta, acoperiri:[{ ...acoperire, ales:true, ales_de:'00000000-0000-4000-8000-000000000001' }] })
    expect(l.acoperire.randuri[0]).toMatchObject({ dovada:false, verificare:'Propusă de AI / neverificată pe scan' })
  })
  it('verificarea pe scan este dovadă numai fără reverificare cerută', () => {
    const l = compuneLant({ cerinta, acoperiri:[
      { ...acoperire, verificat_pe_scan:true },
      { ...acoperire, id:61, verificat_pe_scan:true, reverificare_ceruta:true, reverificare_motiv:'Expirată' },
    ] })
    expect(l.acoperire.randuri.map(a => a.dovada)).toEqual([true, false])
    expect(l.acoperire.randuri[1]).toMatchObject({ verificare:'De reverificat', reverificare_motiv:'Expirată' })
  })
  it('păstrează toate tipurile de candidat, inclusiv dovezile cumulative', () => {
    const l = compuneLant({ cerinta, acoperiri:[acoperire,
      { ...acoperire, id:61, autorizatie_id:null, mod:'firma', doc_firma_id:2 },
      { ...acoperire, id:62, autorizatie_id:null, mod:'partener', partener_id:3, status:'acoperit_partener' },
      { ...acoperire, id:63, autorizatie_id:null, mod:'experienta', experienta_id:4 },
      { ...acoperire, id:64, autorizatie_id:null, mod:'recomandare', recomandare_id:5 },
      { ...acoperire, id:65, autorizatie_id:null, mod:'studii', document_personal_id:6,
        studii:{ emp:{ name:'POP ION' }, tip:{ denumire:'Diplomă' } } },
    ] })
    expect(l.acoperire.randuri.flatMap(a => a.candidati)).toHaveLength(6)
    expect(l.acoperire.randuri[5].candidati[0].descriere).toBe('POP ION · Diplomă')
  })
  it('pune blocata prima fără să modifice array-ul sursă', () => {
    const legaturi = [legatura, { ...legatura, id:41, stare:'blocata', constatare:'Lipsește răspunsul' }]
    const l = compuneLant({ cerinta, legaturi, capitole })
    expect(l.legaturi.randuri.map(r => r.id)).toEqual([41, 40])
    expect(legaturi[0].id).toBe(40)
  })
  it('semnalează verificarea pe versiune veche inclusiv după invalidarea stării', () => {
    const l = compuneLant({ cerinta, capitole, legaturi:[{ ...legatura, verificat_la_versiunea:2 }] })
    expect(l.legaturi.randuri[0].versiuneVeche).toBe(true)
    expect(compuneLant({ cerinta, capitole, legaturi:[{ ...legatura, verificat_la_versiunea:3 }] }).legaturi.randuri[0].versiuneVeche).toBe(false)
  })
  it('nu presupune versiunea 1 pentru un capitol lipsă', () => {
    expect(compuneLant({ cerinta, legaturi:[legatura] }).legaturi.randuri[0]).toMatchObject({ capitol:null, versiuneVeche:false })
  })
  it('toate verigile lipsă au mesaj explicit', () => {
    const l = compuneLant()
    for (const k of ['cerinta', 'acoperire', 'dovezi', 'legaturi', 'clarificari', 'fisierFinal']) expect(l[k].lipsa).toBe(LIPSA)
    expect(l.clarificari.mesajLipsa).toContain('nicio legătură înregistrată')
  })
  it('dovezile PT se leagă prin legatura_id, fără cerinta_id inventat', () => {
    const l = compuneLant({ cerinta, legaturi:[legatura], dovezi:[
      { id:1, legatura_id:40, document_id:5, tip_dovada:'document_atribuire', pagina_locala:2, pagina_globala:50 },
      { id:2, legatura_id:99, tip_dovada:'capitol' },
    ], documente:[{ id:5, nume_original:'Document.pdf' }] })
    expect(l.dovezi.randuri).toHaveLength(1)
    expect(l.dovezi.randuri[0]).toMatchObject({ pagina_locala:2, pagina_globala:50, document:{ nume_original:'Document.pdf' } })
  })
  it('izolează acoperirea și legăturile cerinței inspectate', () => {
    const l = compuneLant({ cerinta, acoperiri:[acoperire, { ...acoperire, id:61, cerinta_id:123 }],
      legaturi:[legatura, { ...legatura, id:41, cerinta_id:123 }] })
    expect(l.acoperire.randuri).toHaveLength(1)
    expect(l.legaturi.randuri).toHaveLength(1)
  })
  it('urmărește inlocuita_de invers și păstrează snapshot-ul istoric separat', () => {
    const istoric = [{ id:11, inlocuita_de:12, versiune:1, acoperire_snapshot:{ acoperiri:[{ ...acoperire, cerinta_id:11, verificat_pe_scan:true }] } },
      { id:8, inlocuita_de:99, versiune:1 }]
    const l = compuneLant({ cerinta, istoric, raspunsSet:{ id:9, titlu:'Răspuns consolidat' } })
    expect(l.cerinta.anterioare.randuri.map(v => v.id)).toEqual([11])
    expect(l.cerinta.anterioare.randuri[0].acopeririIstorice[0].dovada).toBe(true)
    expect(l.acoperire.lipsa).toBe(LIPSA)
    expect(l.cerinta.raspunsSet.titlu).toBe('Răspuns consolidat')
  })
  it.each([
    ['cerința #12 — de clarificat', true], ['cerințe #3, #12, #41', true],
    ['cerinta_id: 12', true], ['{"cerinta_id":12}', true],
    ['cerința #123', false], ['cerințe #112, #123', false],
    ['cantitate_id: 12', false], ['document pagina #12', false], ['cerința #12abc', false],
  ])('clarificarea „%s” are o legătură explicită: %s', (sursa, asteptat) => {
    expect(clarificareAtingeCerinta({ sursa }, cerinta)).toBe(asteptat)
  })
  it('caută referințe și în întrebare/răspuns; cantitățile nu sunt cerințe', () => {
    expect(clarificareAtingeCerinta({ intrebare:'Referitor la cerința #12' }, cerinta)).toBe(true)
    expect(clarificareAtingeCerinta({ raspuns:'cerinta_id=12' }, cerinta)).toBe(true)
    expect(clarificareAtingeCerinta({ cantitate_id:12 }, cerinta)).toBe(false)
  })
  it('arată fișierul care conține capitolul și avertizează versiunea veche', () => {
    const l = compuneLant({ cerinta, legaturi:[legatura], capitole, pachet:{ id:70, versiune:4, fisiere:[fisier] } })
    expect(l.fisierFinal.randuri[0]).toMatchObject({ nume:'PT.docx', sha256:'a'.repeat(64), capitole:[{ id:20, versiuneSursa:'2', depasit:true }] })
  })
  it('borderoul și coincidențele parțiale de ID nu probează conținutul capitolului', () => {
    const l = compuneLant({ cerinta, legaturi:[legatura], capitole, pachet:{ fisiere:[
      { ...fisier, rol:'borderou_docx' }, { ...fisier, id:81, sursa_versiune:'capitole@{120:v3}' },
      { ...fisier, id:82, sursa_versiune:null },
    ] } })
    expect(l.fisierFinal.lipsa).toBe(LIPSA)
  })
  it('arată lipsa fișierului și pentru al doilea capitol, când primul este inclus', () => {
    const l = compuneLant({ cerinta, legaturi:[legatura, { ...legatura, id:41, capitol_id:21 }],
      capitole:[...capitole, { ...capitole[0], id:21, nr:2, titlu:'Metodologie' }], pachet:{ fisiere:[fisier] } })
    expect(l.fisierFinal.randuri).toHaveLength(1)
    expect(l.fisierFinal.capitoleFaraFisier).toEqual([{ id:21, titlu:'Metodologie' }])
  })
})

// Dublu PostgREST pentru calea de citire: aplică filtrele, ordonarea și paginarea,
// fără metode de scriere. Un plafon de 2 rânduri simulează trunchierea serverului.
function baza(tabele, erori = {}) {
  const apeluri = []
  return { apeluri, from(tabel) {
    const filtre = []
    let ordine, interval, limita, single = false
    const q = {
      select(coloane) { apeluri.push({ tabel, coloane, filtre }); return q },
      eq(k, v) { filtre.push(['eq', k, v]); return q },
      not(k, op, v) { filtre.push(['not', k, v]); return q },
      in(k, vs) { filtre.push(['in', k, vs]); return q },
      order(k, opt) { ordine = [k, opt?.ascending !== false]; return q },
      range(a, b) { interval = [a, b]; return q },
      limit(n) { limita = n; return q },
      maybeSingle() { single = true; return q },
      then(resolve, reject) {
        if (erori[tabel]) return Promise.resolve({ data:null, error:{ message:erori[tabel] } }).then(resolve, reject)
        let rows = [...(tabele[tabel] || [])].filter(r => filtre.every(([op, k, v]) =>
          op === 'eq' ? r[k] === v : op === 'in' ? v.includes(r[k]) : r[k] != null))
        if (ordine) rows.sort((a, b) => (a[ordine[0]] - b[ordine[0]]) * (ordine[1] ? 1 : -1))
        if (interval) rows = rows.slice(interval[0], Math.min(interval[1] + 1, interval[0] + 2))
        if (limita) rows = rows.slice(0, limita)
        return Promise.resolve({ data:single ? rows[0] || null : rows, error:null }).then(resolve, reject)
      },
    }
    return q
  } }
}

describe('R17 — citirea datelor', () => {
  const tabele = {
    ofertare_cerinte:[cerinta], ofertare_acoperire:[acoperire], ofertare_pt_legaturi:[legatura],
    ofertare_pt_capitole:capitole, ofertare_raspuns_set:[{ id:9, licitatie_id:3, titlu:'Consolidat' }],
    ofertare_documente_atribuire:[{ id:5, nume_original:'Sursa.pdf' }],
    ofertare_pt_dovezi:[{ id:90, legatura_id:40, document_id:5, tip_dovada:'document_atribuire' }],
    ofertare_pt_pachet:[{ id:70, licitatie_id:3, versiune:2 }, { id:71, licitatie_id:3, versiune:3 }],
    ofertare_pt_pachet_fisiere:[fisier, { ...fisier, id:81, pachet_id:71 }],
  }
  it('citește dovezile după legături și fișierele numai din ultimul pachet', async () => {
    const db = baza(tabele)
    const r = await incarcaLantProbator(db, 3, 12)
    expect(r.erori).toEqual({})
    expect(r.dovezi.map(d => d.id)).toEqual([90])
    expect(r.pachet.id).toBe(71)
    expect(r.pachet.fisiere.map(f => f.id)).toEqual([81])
    expect(db.apeluri.find(a => a.tabel === 'ofertare_pt_dovezi').filtre).toContainEqual(['in', 'legatura_id', [40]])
    expect(r.raspunsSet.titlu).toBe('Consolidat')
  })
  it('paginarea nu pierde clarificările după plafonul serverului', async () => {
    const db = baza({ ...tabele, ofertare_clarificari:Array.from({ length:5 }, (_, i) => ({ id:i + 1, licitatie_id:3, sursa:'cerința #12' })) })
    const r = await incarcaLantProbator(db, 3, 12)
    expect(r.clarificari).toHaveLength(5)
    expect(compuneLant(r).clarificari.randuri).toHaveLength(5)
  })
  it('o eroare de citire rămâne eroare, nu absență probată', async () => {
    const r = await incarcaLantProbator(baza(tabele, { ofertare_pt_dovezi:'Acces refuzat', ofertare_clarificari:'Indisponibil' }), 3, 12)
    expect(r.erori).toEqual({ dovezi:'Acces refuzat', clarificari:'Indisponibil' })
    expect(r.acoperiri).toHaveLength(1)
  })
  it('nu revine la un pachet vechi când ultimul are manifestul gol', async () => {
    const r = await incarcaLantProbator(baza({ ...tabele, ofertare_pt_pachet_fisiere:[fisier] }), 3, 12)
    expect(r.pachet.id).toBe(71)
    expect(compuneLant(r).fisierFinal.lipsa).toBe(LIPSA)
  })
})
