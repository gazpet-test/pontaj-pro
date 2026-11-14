import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { autorizat, numeDinPlatforma, toateRandurile, coloane, SURSE_NUME, NUME_MAX_TABEL,
         interogareCoada, filtruOrPostgrest, coadaDePreluat, raspunsCoada, COADA_STARI } from './logic.js'
import { CAZURI_COADA } from '../../../scripts/intrebari/coada_cazuri.mjs'

// intrebari-tehnice-worker (r2, review PR #1086): poarta acțiunii „nume” și sursele de nume. Date INVENTATE.
const SECRET = 'a'.repeat(64)
const verifica = async s => s === SECRET            // ca fn_verifica_secret: true doar pentru secretul din Vault
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.semnatura'

describe('poarta: doar secretul dedicat deschide funcția (inclusiv acțiunea „nume”)', () => {
  it('secretul corect trece', async () => {
    expect(await autorizat(SECRET, verifica)).toBe(true)
  })
  it('cont obișnuit / anon (JWT în loc de secret, sau niciun antet) → refuz', async () => {
    for (const antet of ['', ANON_JWT, `Bearer ${ANON_JWT}`, null, undefined]) expect(await autorizat(antet, verifica), String(antet)).toBe(false)
  })
  it('secret greșit, formă greșită, verificare care aruncă sau răspunde altceva decât true → refuz', async () => {
    expect(await autorizat('b'.repeat(64), verifica)).toBe(false)
    expect(await autorizat('A'.repeat(64), verifica)).toBe(false)               // doar hex mic
    expect(await autorizat(SECRET + 'a', verifica)).toBe(false)
    expect(await autorizat(SECRET, async () => { throw new Error('rpc') })).toBe(false)
    for (const r of ['true', 't', 1, {}, null]) expect(await autorizat(SECRET, async () => r), String(r)).toBe(false)
  })
  it('în index.ts poarta rulează ÎNAINTEA citirii corpului și a oricărei acțiuni; JWT-ul nu e citit deloc', () => {
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/index.ts', 'utf8')
    const poarta = src.indexOf('await autorizat(')
    expect(poarta).toBeGreaterThan(0)
    for (const dupa of ['citesteCorp(req', "corp.actiune === 'nume'", "corp.actiune === 'preia'", 'numeDinPlatforma(',
                        "corp.actiune === 'coada'", 'raspunsCoada(']) {
      expect(src.indexOf(dupa), dupa).toBeGreaterThan(poarta)
    }
    expect(src).not.toMatch(/headers\.get\(['"]authorization['"]\)/i)
    expect(src).toMatch(/if \(!\(await autorizat\(req\.headers\.get\(ANTET\) \|\| '', verifica\)\)\) return raspuns\(401/)
  })
})

// O „bază” în memorie: tabel → rânduri; pagina imită PostgREST (order id, gt dupa, limit 1000).
function bazaFalsa(tabele, { eroareLa = null } = {}) {
  const cereri = []
  const pagina = async (tabel, col, dupa) => {
    cereri.push({ tabel, col, dupa })
    if (tabel === eroareLa) return { data: null, error: { message: 'column does not exist' } }
    const r = (tabele[tabel] || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return { data: r.filter(x => dupa === null || x.id > dupa).slice(0, 1000), error: null }
  }
  return { pagina, cereri }
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('sursele de nume (review P1-1: furnizorii și ceilalți terți lipseau)', () => {
  it('un furnizor / subcontractor / deținător care există DOAR în tabelele noi ajunge în listă', async () => {
    const tabele = {
      employees: [{ id: 1, name: 'POPESCU ION' }],
      beneficiari: [{ id: 1, nume: 'Alfa Construct SRL', contact_nume: 'Ionescu Maria', cif: 'RO12345678' }],
      logistica_furnizori: [{ id: 5, nume: 'Gamma Feronerie SRL', persoana_contact: 'Zamfir Lucretia', cui: '34567890' }],
      logistica_subcontractori: [{ id: 2, nume_scurt: 'Omega', denumire_legala: 'Omega Utilaje SRL', contact_nume: 'Dobre Paul', cui: 'RO 45678901' }],
      red_detinatori: [{ id: uuid(2), nume: 'VLAD ELENA' }, { id: uuid(1), nume: 'NISTOR GHEORGHE' }],
    }
    const { pagina } = bazaFalsa(tabele)
    const r = await numeDinPlatforma(pagina)
    expect(r.persoane).toEqual(expect.arrayContaining(['POPESCU ION', 'Ionescu Maria', 'Zamfir Lucretia', 'Dobre Paul', 'VLAD ELENA', 'NISTOR GHEORGHE']))
    expect(r.firme).toEqual(expect.arrayContaining(['Alfa Construct SRL', 'Gamma Feronerie SRL', 'Omega', 'Omega Utilaje SRL']))
    expect(r.cui).toEqual(expect.arrayContaining(['RO12345678', '34567890', 'RO 45678901']))
  })
  it('r3: localitățile vin DOAR din red_uat (tabel deja citit): numele UAT și satele programate, separat de nume', async () => {
    const { pagina, cereri } = bazaFalsa({
      employees: [{ id: 1, name: 'POPESCU ION' }],
      red_uat: [{ id: uuid(1), nume: 'Berceni', sate_zi1: 'Corlatesti, Berceni', sate_zi2: null, sate_zi3: '', reprezentant_uat_nume: 'Dobre Paul' }],
    })
    const r = await numeDinPlatforma(pagina)
    expect(r.localitati.sort()).toEqual(['Berceni', 'Corlatesti, Berceni'])
    expect(r.persoane).toContain('Dobre Paul')
    expect(r.persoane).not.toContain('Berceni')
    expect(SURSE_NUME.filter(s => s.localitati).map(s => s.tabel)).toEqual(['red_uat'])
    expect(cereri.find(c => c.tabel === 'red_uat').col).toBe('id, reprezentant_uat_nume, nume, sate_zi1, sate_zi2, sate_zi3')
    expect((await numeDinPlatforma(bazaFalsa({ employees: [{ id: 1, name: 'X' }] }).pagina)).localitati).toEqual([])
  })
  it('doar coloane de nume / CUI — niciodată telefon, e-mail, CNP, IBAN, adresă', () => {
    for (const s of SURSE_NUME) {
      expect(coloane(s)).not.toMatch(/telefon|email|e_mail|cnp|iban|adresa|data_nasterii|parola|token/i)
      expect(['int', 'uuid']).toContain(s.cheie)
      expect(['migrare', 'cod']).toContain(s.verificat)
      expect(s.persoane.length + s.firme.length + s.cui.length).toBeGreaterThan(0)
    }
  })
  it('lista conține registrele cerute de recenzent și e cea documentată', () => {
    const t = SURSE_NUME.map(s => s.tabel)
    for (const x of ['employees', 'beneficiari', 'logistica_furnizori', 'logistica_subcontractori', 'contracte_terti', 'hr_personal_extern', 'red_detinatori'])
      expect(t, x).toContain(x)
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8')
    for (const x of t) expect(doc, x).toContain('`' + x + '`')
    expect(new Set(t).size).toBe(t.length)
  })
  // 14.11.2026 (găsit la pornire): acțiunea „nume” răspundea 500 pentru că o sursă nu putea fi citită de rolul funcției, iar
  // verificarea de dinaintea publicării se uita doar la existența coloanelor. De aceea: (1) tabelul documentat, interogarea de
  // verificare și SURSE_NUME sunt ACEEAȘI listă; (2) interogarea cere și dreptul de SELECT al lui service_role, și pe `id`;
  // (3) sursa necitibilă e scoasă și trecută la „Ce NU intră și de ce”, nu lăsată în listă.
  it('documentul, interogarea de verificare și SURSE_NUME sunt aceeași listă; verificarea cere și dreptul de citire al rolului funcției', () => {
    const doc = readFileSync('docs/intrebari/MASCARE_SI_VERDICT.md', 'utf8').replace(/\r/g, '')
    const dinCod = SURSE_NUME.flatMap(s => [...new Set([...s.persoane, ...s.firme, ...s.cui, ...(s.localitati || [])])].map(c => `${s.tabel}.${c}`)).sort()
    const q = (doc.match(/```sql\n(WITH t\(tabel, coloana\) AS \(VALUES[\s\S]*?)\n```/) || [])[1]
    expect(q, 'interogarea de verificare din document').toBeTruthy()
    const dinInterogare = [...q.matchAll(/\('([a-z_]+)','([a-z_0-9]+)'\)/g)].map(m => `${m[1]}.${m[2]}`).sort()
    expect(dinInterogare).toEqual(dinCod)
    expect(new Set(dinInterogare).size).toBe(dinInterogare.length)
    expect(q).toContain("UNION SELECT DISTINCT tabel, 'id' FROM t")
    expect(q).toContain("has_column_privilege('service_role', ('public.' || quote_ident(a.tabel))::regclass, a.coloana, 'SELECT')")
    expect(q).toMatch(/WHERE CASE WHEN c\.column_name IS NULL THEN true\s+ELSE NOT has_column_privilege/)
    // tabelul din document: câte un rând pentru fiecare sursă, cu exact coloanele ei pe cele trei coloane (și localitățile la red_uat)
    const sectiune = doc.slice(doc.indexOf('## De unde vin numele din platformă'), doc.indexOf('**Ce NU intră și de ce:**'))
    // un rând = „| `tabel` | persoane | firme | cui | verificat în |” (celulele goale sunt un singur spațiu)
    const randuri = sectiune.split('\n').filter(l => /^\| `[a-z_]+` \|/.test(l)).map(l => {
      const c = l.split('|').slice(1, -1).map(x => x.trim())
      expect(c.length, l).toBe(5)
      return [l, c[0].replace(/`/g, ''), c[1], c[2], c[3], c[4]]
    })
    expect(randuri.map(r => r[1])).toEqual(SURSE_NUME.map(s => s.tabel))
    const lista = x => x.split(',').map(v => v.trim()).filter(Boolean)
    for (const r of randuri) {
      const s = SURSE_NUME.find(x => x.tabel === r[1])
      expect(lista(r[2]), r[1]).toEqual(s.persoane)
      expect(lista(r[3]), r[1]).toEqual(s.firme)
      expect(lista(r[4]), r[1]).toEqual(s.cui)
      for (const c of s.localitati || []) expect(r[5], r[1]).toContain('`' + c + '`')
    }
    // sursa scoasă: nu mai e în listă și e explicată, cu ce se pierde
    expect(SURSE_NUME.map(s => s.tabel)).not.toContain('izo_documente_intrare')
    const nuIntra = doc.slice(doc.indexOf('**Ce NU intră și de ce:**'), doc.indexOf('**Înainte de publicarea funcției edge**'))
    expect(nuIntra).toContain('`izo_documente_intrare` (`furnizor`, `furnizor_cif`) — **scos pe 14.11.2026, la pornire**')
    expect(nuIntra).toContain('închise intenționat pentru `service_role`')
    expect(nuIntra).toContain('Nu se dă un drept nou pe acele tabele pentru o funcție de mascare.')
    expect(nuIntra).toContain('3 furnizori și 1 CUI care se găsesc **doar** acolo')
    // pierderea e spusă fără garanții: lista nu-i mai acoperă, tiparele doar în formele recunoscute
    expect(nuIntra.replace(/\s+/g, ' ')).toContain('**Cele 3 denumiri și 1 CUI pierd acoperirea prin listă. Tiparele le pot masca în formele recunoscute; denumirile fără formă juridică și CUI-ul fără prefix pot rămâne vizibile.**')
    expect(nuIntra).not.toMatch(/rămân acoperiți de tipare/)
    expect(doc.replace(/\s+/g, ' ')).toContain('**Zero rânduri nu garantează citirea efectivă**')
    expect(doc).toContain('O coloană lipsă **sau necitibilă de `service_role`** se scoate din `SURSE_NUME` (PR), nu se publică edge-ul cu ea.')
  })
  it('paginare keyset până la pagina goală, și pe id întreg, și pe uuid (peste 1000 de rânduri)', async () => {
    const mult = Array.from({ length: 2500 }, (_, i) => ({ id: uuid(i + 1), nume: `NUME${i}` }))
    const { pagina, cereri } = bazaFalsa({ red_detinatori: mult })
    const r = await toateRandurile(pagina, { tabel: 'red_detinatori', cheie: 'uuid', persoane: ['nume'], firme: [], cui: [] })
    expect(r.length).toBe(2500)
    expect(cereri.length).toBe(4)                                              // 1000 + 1000 + 500 + pagina goală
    const intregi = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, name: 'X' }))
    expect((await toateRandurile(bazaFalsa({ employees: intregi }).pagina, SURSE_NUME[0])).length).toBe(1001)
  })
  it('fail closed: eroare / coloană lipsă pe ORICE tabel, id neordonat, angajați zero, peste plafon → null', async () => {
    const baza = { employees: [{ id: 1, name: 'POPESCU ION' }] }
    expect(await numeDinPlatforma(bazaFalsa(baza, { eroareLa: 'logistica_furnizori' }).pagina)).toBe(null)
    expect(await numeDinPlatforma(bazaFalsa({ employees: [] }).pagina)).toBe(null)
    const neordonat = async (t, c, dupa) => ({ data: dupa === null ? [{ id: 5 }, { id: 3 }] : [{ id: 2 }], error: null })
    expect(await toateRandurile(neordonat, SURSE_NUME[0])).toBe(null)
    const uuidRau = async () => ({ data: [{ id: 'nu-e-uuid' }], error: null })
    expect(await toateRandurile(uuidRau, { tabel: 't', cheie: 'uuid', persoane: ['nume'], firme: [], cui: [] })).toBe(null)
    let n = 0
    const infinit = async () => ({ data: Array.from({ length: 1000 }, () => ({ id: ++n })), error: null })
    expect(await toateRandurile(infinit, SURSE_NUME[0])).toBe(null)
    expect(n).toBeLessThanOrEqual(NUME_MAX_TABEL + 1000)
  })
})

// ─── acțiunea „coada” (14.11.2026; r3 15.11.2026): doar citire, un boolean, O SINGURĂ citire, fără ceas / prag / plafon / dată ───
// Ceasul BD fix: 15.07.2026 11:00 la București (vară, UTC+3). Ceasul edge-ului = ceasul BD + `caz.ceas` secunde (r3: fără efect;
// testele îl pun totuși ca ceas de sistem, ca să se vadă că nu schimbă nimic).
const ACUM = new Date('2026-07-15T08:00:00Z')
const MIEZ = Date.parse('2026-07-14T21:00:00Z')   // miezul nopții local al zilei lui ACUM (doar pentru rândurile din preluări)
const ceasEdge = ms => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(ms)) }
afterEach(() => { vi.useRealTimers() })

// Filtrul `or=` evaluat INDEPENDENT de logic.js (alt cod, aceeași gramatică PostgREST): virgulele de pe primul nivel = OR, condiția
// `col.eq."valoare"` = egal exact. Orice altă formă (and(...), lt, gt, valori fără ghilimele) = excepție.
function desparte(s) {
  const r = []; let d = 0, q = false, cur = ''
  for (const ch of s) {
    if (ch === '"') q = !q
    if (!q && ch === '(') d++
    if (!q && ch === ')') d--
    if (!q && d === 0 && ch === ',') { r.push(cur); cur = ''; continue }
    cur += ch
  }
  r.push(cur)
  return r
}
function potrivesteCond(c, x) {
  const m = /^([a-z_]+)\.eq\."([^"]*)"$/.exec(c)
  if (!m) throw new Error('filtru necunoscut: ' + c)
  return x[m[1]] === m[2]
}
const potrivesteOr = (s, x) => desparte(s).some(p => potrivesteCond(p, x))

// Bază falsă: ambele tabele există (preluările doar ca să se vadă că NU sunt citite); număr ca `count: 'exact', head: true`.
function bazaCoada(caz, { eroare = false, count = null } = {}) {
  const iso = ms => new Date(ms).toISOString()
  const tabele = {
    intrebari_tehnice: caz.intrebari.map((q, i) => ({ id: i + 1, stare: q.stare,
      preluat_la: q.min === undefined ? null : iso(ACUM.getTime() - Math.round(q.min * 60e3)) })),
    intrebari_preluari: (caz.preluari || []).map((p, i) => ({ id: i + 1, rezultat: p.rezultat, preluat_la: iso(MIEZ + p.zi * 60e3) })),
  }
  const cereri = []
  const numara = async cerere => {
    cereri.push(cerere)
    if (eroare) return { count: null, error: { message: 'permission denied' } }
    if (count !== null) return { count, error: null }
    return { count: (tabele[cerere.tabel] || []).filter(x => potrivesteOr(cerere.or, x)).length, error: null }
  }
  return { numara, cereri, tabele }
}

describe('coada: e vreo întrebare în „noua” sau „in_lucru”? (cazurile comune cu proba PGlite)', () => {
  for (const caz of CAZURI_COADA) {
    it(caz.nume, async () => {
      ceasEdge(ACUM.getTime() + (caz.ceas ?? 0) * 1e3)
      const { numara } = bazaCoada(caz)
      expect(await coadaDePreluat(numara)).toBe(caz.asteptat)
      expect(await raspunsCoada(numara)).toEqual({ status: 200, corp: { de_preluat: caz.asteptat } })
    })
  }
  it('tabelul de cazuri: acoperă ce cere sarcina și nu are NICIUN caz „goală” când `preia` are de lucru', () => {
    const nume = CAZURI_COADA.map(c => c.nume).join(' | ')
    for (const x of ['coada goală', 'o întrebare nouă', 'amânată', 'în lucru de 1 secundă', 'exact 30 de minute', '30 min + 1 s',
                     'ceasuri diferite', 'plafon atins', 'IERI'])
      expect(nume, x).toContain(x)
    expect(new Set(CAZURI_COADA.map(c => c.asteptat))).toEqual(new Set([true, false]))
    expect(CAZURI_COADA.filter(c => c.asteptat === false && c.preia === true)).toEqual([])
    // cazul reprodus în review-ul r2 (edge cu 61 s în urmă, întrebare expirată de 1 s) și un decalaj mare constant: acum „are ceva”
    expect(CAZURI_COADA.filter(c => c.ceas !== undefined).map(c => c.ceas).sort((a, b) => a - b)).toEqual([-7200, -600, -61, 7200])
    for (const c of CAZURI_COADA.filter(c => c.ceas !== undefined && c.intrebari.length)) expect(c.asteptat, c.nume).toBe(true)
    // în lucru de 1 secundă = „are ceva” (r3: fără prag de vechime)
    expect(CAZURI_COADA.find(c => c.nume.startsWith('în lucru de 1 secundă')).asteptat).toBe(true)
    expect(CAZURI_COADA.find(c => c.nume.startsWith('plafon atins (40 azi) + o întrebare nouă')).asteptat).toBe(true)
  })
  it('condiția exactă: o singură interogare, OR pe stările „noua” / „in_lucru”, fără nicio coloană de timp', () => {
    expect(COADA_STARI).toEqual(['noua', 'in_lucru'])
    expect(interogareCoada()).toEqual({ tabel: 'intrebari_tehnice', oricare: [['eq', 'stare', 'noua'], ['eq', 'stare', 'in_lucru']] })
    expect(filtruOrPostgrest(interogareCoada().oricare)).toBe('stare.eq."noua",stare.eq."in_lucru"')
  })
  it('fără ceas: aceeași condiție la orice oră a edge-ului (1970, miezul nopții local, 2100, ±61 s) și niciun timp în cod', async () => {
    const ref = filtruOrPostgrest(interogareCoada().oricare)
    for (const t of [0, Date.parse('2026-07-14T20:59:59.900Z'), Date.parse('2026-07-14T21:00:00.100Z'), Date.parse('2100-01-01T00:00:00Z'),
                     ACUM.getTime() - 61e3, ACUM.getTime() + 61e3]) {
      ceasEdge(t)
      expect(filtruOrPostgrest(interogareCoada().oricare), new Date(t).toISOString()).toBe(ref)
      const b = bazaCoada({ intrebari: [{ stare: 'in_lucru', min: 30 + 1 / 60 }], preluari: [] })
      expect(await coadaDePreluat(b.numara), new Date(t).toISOString()).toBe(true)
      expect(b.cereri[0].or).toBe(ref)
    }
    expect([interogareCoada.length, coadaDePreluat.length, raspunsCoada.length]).toEqual([0, 1, 1])
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/logic.js', 'utf8').replace(/\r/g, '')
    const sect = src.slice(src.indexOf('// ─── 4. Acțiunea „coada”'))
    expect(sect.length).toBeGreaterThan(100)
    const cod = sect.split('\n').filter(l => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).join('\n')   // fără comentarii
    for (const x of ['Date', 'now', 'getTime', 'preluat_la', 'Europe/Bucharest', 'intrebari_preluari', 'PLAFON', 'MARJA', 'EXPIRARE', 'acum'])
      expect(cod, x).not.toContain(x)
  })
  it('filtruOrPostgrest: lista albă (op eq, coloană și valoare [a-z_]) — altfel null, nu un filtru tăiat', () => {
    expect(filtruOrPostgrest([['eq', 'stare', 'noua']])).toBe('stare.eq."noua"')
    for (const g of [[], null, 'x', [[]], [['lt', 'preluat_la', 'x']], [['gte', 'stare', 'noua']], [['neq', 'stare', 'noua']],
                     [['eq', 'stare.x', 'noua']], [['eq', 'Stare', 'noua']], [['eq', 'stare', 'noua,in_lucru']], [['eq', 'stare', 'a"b']],
                     [['eq', 'stare', 'a)b']], [['eq', 'stare', 'a b']], [['eq', 'stare', '']], [['eq', 'stare', 1]], [['eq', 'stare']],
                     [['eq', 'stare', 'Noua']], [['eq', 'stare', '2026-07-15T07:31:00.000Z']], [[['eq', 'stare', 'noua']]],
                     [['eq', 'stare', 'noua'], ['lt', 'preluat_la', '2026-01-01T00:00:00Z']]]) {
      expect(filtruOrPostgrest(g), JSON.stringify(g)).toBe(null)
    }
  })
  it('O SINGURĂ citire, doar pe intrebari_tehnice (nicio numărătoare de preluări, deci nicio intercalare între citiri)', async () => {
    for (const caz of CAZURI_COADA) {
      const b = bazaCoada(caz)
      await coadaDePreluat(b.numara)
      expect(b.cereri.length, caz.nume).toBe(1)
      expect(b.cereri[0].tabel, caz.nume).toBe('intrebari_tehnice')
    }
  })
  it('cursa care rămâne (documentată): o întrebare pusă / revenită în coadă DUPĂ citire e luată la rularea următoare', async () => {
    const b = bazaCoada({ intrebari: [{ stare: 'raspuns' }], preluari: [] })
    expect(await coadaDePreluat(b.numara)).toBe(false)
    b.tabele.intrebari_tehnice.push({ id: 9, stare: 'noua', preluat_la: null })      // o întrebare pusă după citire
    expect(await coadaDePreluat(b.numara)).toBe(true)
    b.tabele.intrebari_tehnice[1].stare = 'in_lucru'                                  // preluată: tot „are ceva”, la orice vechime
    b.tabele.intrebari_tehnice[1].preluat_la = ACUM.toISOString()
    expect(await coadaDePreluat(b.numara)).toBe(true)
    b.tabele.intrebari_tehnice[1].stare = 'eroare'                                    // închisă (răspuns / eroare / expirată)
    expect(await coadaDePreluat(b.numara)).toBe(false)
    b.tabele.intrebari_tehnice[1].stare = 'noua'                                      // reluată de owner după citire
    expect(await coadaDePreluat(b.numara)).toBe(true)
  })
  it('L18: eroarea nu e „coadă goală” — citire eșuată / număr invalid / excepție → 500, nu false', async () => {
    const caz = { intrebari: [], preluari: [] }
    expect(await coadaDePreluat(bazaCoada(caz, { eroare: true }).numara)).toBe(null)
    expect(await raspunsCoada(bazaCoada(caz, { eroare: true }).numara)).toEqual({ status: 500, corp: { error: 'Eroare internă' } })
    for (const c of [null, undefined, NaN, -1, 1.5, '0', Infinity]) {
      expect(await coadaDePreluat(async () => ({ count: c, error: null })), String(c)).toBe(null)
    }
    expect(await coadaDePreluat(async () => { throw new Error('retea') })).toBe(null)
    expect(await coadaDePreluat(async () => null)).toBe(null)
    expect(await raspunsCoada(async () => { throw new Error('retea') })).toEqual({ status: 500, corp: { error: 'Eroare internă' } })
  })
  it('răspunsul are DOAR `de_preluat` (boolean) — niciun număr, id sau conținut de întrebare', async () => {
    const r = await raspunsCoada(bazaCoada({ intrebari: [{ stare: 'noua' }], preluari: [] }).numara)
    expect(Object.keys(r.corp)).toEqual(['de_preluat'])
    expect(typeof r.corp.de_preluat).toBe('boolean')
  })
  it('index.ts: „coada” = o singură cerere HEAD cu count exact și `or` pe intrebari_tehnice; fără ceas, fără RPC-uri, nu scrie', () => {
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/index.ts', 'utf8').replace(/\r/g, '')
    const ramura = src.slice(src.indexOf("if (corp.actiune === 'coada')"), src.indexOf("if (corp.actiune === 'nume')"))
    expect(ramura).toContain('raspunsCoada(numaraCoada(sb))')
    expect(ramura).not.toMatch(/Date|now\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|storage/)
    const fn = src.slice(src.indexOf('function numaraCoada('), src.indexOf('Deno.serve('))
    expect(fn).toContain("sb.from('intrebari_tehnice').select('id', { count: 'exact', head: true }).or(or)")
    expect(fn).toContain("if (tabel !== 'intrebari_tehnice' || typeof or !== 'string' || !or) return")
    expect(fn.match(/sb\.from\(/g)).toHaveLength(1)
    expect(fn).not.toMatch(/Date|now\(|preluat_la|\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|intrebari_preluari/)
  })
  it('poarta: fără secret / cu JWT / secret greșit → refuz ÎNAINTE de „coada” (aceeași poartă pentru toate acțiunile)', async () => {
    for (const antet of ['', ANON_JWT, 'b'.repeat(64)]) expect(await autorizat(antet, verifica)).toBe(false)
    expect(await autorizat(SECRET, verifica)).toBe(true)
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/index.ts', 'utf8')
    expect(src.indexOf("corp.actiune === 'coada'")).toBeGreaterThan(src.indexOf('await autorizat('))
  })
  it('aceleași stări ca fn_intrebari_preia din ULTIMA migrare care o definește (altfel „coada” trebuie revăzută)', () => {
    const dir = 'supabase/migrations'
    const cu = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
      .filter(f => /FUNCTION public\.fn_intrebari_preia\(\)/.test(readFileSync(`${dir}/${f}`, 'utf8')))
    expect(cu.at(-1)).toBe('20261131e_intrebari_cercetare_surse.sql')
    const m = readFileSync(`${dir}/${cu.at(-1)}`, 'utf8').replace(/\r/g, '')
    const corp = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_preia()'), m.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_amana('))
    // stările pe care preia le CITEȘTE (WHERE / AND), nu cele pe care le scrie (SET): exact cele din „coada”, nimic altceva
    const citite = [...corp.matchAll(/(?:WHERE|AND) (?:t\.)?stare = '([a-z_]+)'/g)].map(x => x[1])
    expect([...new Set(citite)].sort()).toEqual([...COADA_STARI].sort())
    expect(corp).not.toMatch(/stare\s*(?:IN\b|<>|!=|IS\b|~|LIKE)/i)
    // expirarea o decide `preia`, în bază, cu ceasul bazei (now()) — „coada” nu o mai copiază
    expect(corp).toContain("WHERE t.stare = 'in_lucru' AND t.preluat_la < now() - interval '30 minutes'")
    // amânarea readuce întrebarea în „noua” sau o închide în „eroare” (pe care preia n-o mai atinge); nu există stare de amânare
    const amana = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_amana('), m.indexOf('-- ─── worker: răspunsul vine'))
    expect(amana).toContain("SET stare = CASE WHEN incercari >= 3 THEN 'eroare' ELSE 'noua' END")
    expect(m).toContain("CHECK (stare IN ('noua', 'in_lucru', 'raspuns', 'eroare', 'de_verificat'))")
  })
})
