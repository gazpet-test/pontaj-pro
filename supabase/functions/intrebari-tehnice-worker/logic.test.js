import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { autorizat, numeDinPlatforma, toateRandurile, coloane, SURSE_NUME, NUME_MAX_TABEL,
         inceputZiBucuresti, interogariCoada, coadaDePreluat, raspunsCoada, COADA_EXPIRARE_MIN, COADA_PLAFON_ZI } from './logic.js'
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

// ─── acțiunea „coada” (14.11.2026): doar citire, un boolean; aceleași condiții ca fn_intrebari_preia ───
// „Acum” fix: 15.07.2026 11:00 la București (vară, UTC+3) → miezul nopții local = 14.07.2026 21:00 UTC.
const ACUM = new Date('2026-07-15T08:00:00Z')
const MIEZ = Date.parse('2026-07-14T21:00:00Z')
// Bază falsă cu filtrele PostgREST (eq = egal exact; lt / gte pe timestamptz, NULL nu trece) și număr ca `count: 'exact', head: true`.
function bazaCoada(caz, acum = ACUM, { eroareLa = null, count = null } = {}) {
  const iso = ms => new Date(ms).toISOString()
  const tabele = {
    intrebari_tehnice: caz.intrebari.map((q, i) => ({ id: i + 1, stare: q.stare, preluat_la: q.min === undefined ? null : iso(acum.getTime() - q.min * 60e3) })),
    intrebari_preluari: caz.preluari.map((p, i) => ({ id: i + 1, rezultat: p.rezultat, preluat_la: iso(MIEZ + p.zi * 60e3) })),
  }
  const cereri = []
  const numara = async (tabel, filtre) => {
    cereri.push({ tabel, filtre })
    if (tabel === eroareLa) return { count: null, error: { message: 'permission denied' } }
    if (count !== null) return { count, error: null }
    const r = (tabele[tabel] || []).filter(x => filtre.every(([op, c, v]) => {
      if (op === 'eq') return x[c] === v
      if (x[c] === null || x[c] === undefined) return false
      return op === 'lt' ? Date.parse(x[c]) < Date.parse(v) : Date.parse(x[c]) >= Date.parse(v)
    }))
    return { count: r.length, error: null }
  }
  return { numara, cereri }
}

describe('coada: ziua Europe/Bucharest (plafonul zilnic), exact și în zilele schimbării orei', () => {
  it('miezul nopții local în UTC — valori scrise de mână', () => {
    const z = s => inceputZiBucuresti(new Date(s))?.toISOString()
    expect(z('2026-07-15T08:00:00Z')).toBe('2026-07-14T21:00:00.000Z')   // vară, UTC+3
    expect(z('2026-11-14T08:00:00Z')).toBe('2026-11-13T22:00:00.000Z')   // iarnă, UTC+2
    expect(z('2026-07-14T21:30:00Z')).toBe('2026-07-14T21:00:00.000Z')   // 00:30 local: deja ziua următoare
    expect(z('2026-07-14T20:59:00Z')).toBe('2026-07-13T21:00:00.000Z')   // 23:59 local: încă ziua de ieri
    expect(z('2026-03-29T12:00:00Z')).toBe('2026-03-28T22:00:00.000Z')   // ziua trecerii la ora de vară: miezul nopții era UTC+2
    expect(z('2026-10-25T12:00:00Z')).toBe('2026-10-24T21:00:00.000Z')   // ziua trecerii la ora de iarnă: miezul nopții era UTC+3
    expect(z('2026-01-01T00:30:00Z')).toBe('2025-12-31T22:00:00.000Z')   // 02:30 local pe 1 ianuarie
    for (const x of [new Date('nu'), null, undefined, '2026-07-15', 1784102400000]) expect(inceputZiBucuresti(x), String(x)).toBe(null)
  })
})

describe('coada: răspunde dacă `preia` are ceva de făcut acum (cazurile comune cu proba PGlite)', () => {
  for (const caz of CAZURI_COADA) {
    it(caz.nume, async () => {
      const { numara } = bazaCoada(caz)
      expect(await coadaDePreluat(numara, ACUM)).toBe(caz.asteptat)
      expect(await raspunsCoada(numara, ACUM)).toEqual({ status: 200, corp: { de_preluat: caz.asteptat } })
    })
  }
  it('tabelul de cazuri acoperă ce cere sarcina (gol, o întrebare, amânată, nescadentă, plafon) și ambele răspunsuri', () => {
    const nume = CAZURI_COADA.map(c => c.nume).join(' | ')
    for (const x of ['coada goală', 'o întrebare nouă', 'amânată', 'nescadentă', 'plafon atins']) expect(nume, x).toContain(x)
    expect(new Set(CAZURI_COADA.map(c => c.asteptat))).toEqual(new Set([true, false]))
    expect(CAZURI_COADA.filter(c => c.marja).every(c => c.asteptat === true)).toBe(true)   // marja greșește doar spre „are ceva”
  })
  it('filtrele exacte (ca fn_intrebari_preia): expirare la 30 min minus marja de 60 s, ziua locală, stările, amânatele', () => {
    const q = interogariCoada(ACUM)
    expect(q).toEqual({
      expirate: { tabel: 'intrebari_tehnice', filtre: [['eq', 'stare', 'in_lucru'], ['lt', 'preluat_la', '2026-07-15T07:31:00.000Z']] },
      preluariAzi: { tabel: 'intrebari_preluari', filtre: [['gte', 'preluat_la', '2026-07-14T21:00:00.000Z']] },
      amanateAzi: { tabel: 'intrebari_preluari', filtre: [['gte', 'preluat_la', '2026-07-14T21:00:00.000Z'], ['eq', 'rezultat', 'amanat']] },
      noua: { tabel: 'intrebari_tehnice', filtre: [['eq', 'stare', 'noua']] },
    })
    expect(interogariCoada(new Date('nu'))).toBe(null)
  })
  it('ordinea citirilor: expirate → toate azi → amânate azi → noi; o expirată oprește citirile (are ceva)', async () => {
    const b = bazaCoada(CAZURI_COADA.find(c => c.nume.startsWith('o întrebare nouă')))
    await coadaDePreluat(b.numara, ACUM)
    expect(b.cereri.map(c => `${c.tabel}:${c.filtre.length}`)).toEqual(['intrebari_tehnice:2', 'intrebari_preluari:1', 'intrebari_preluari:2', 'intrebari_tehnice:1'])
    const e = bazaCoada({ intrebari: [{ stare: 'in_lucru', min: 31 }], preluari: [] })
    expect(await coadaDePreluat(e.numara, ACUM)).toBe(true)
    expect(e.cereri.length).toBe(1)
  })
  it('L18: eroarea nu e „coadă goală” — orice citire eșuată / număr invalid / excepție / „acum” invalid → 500, nu false', async () => {
    const caz = { intrebari: [], preluari: [] }
    for (const t of ['intrebari_tehnice', 'intrebari_preluari']) {
      expect(await coadaDePreluat(bazaCoada(caz, ACUM, { eroareLa: t }).numara, ACUM), t).toBe(null)
      expect(await raspunsCoada(bazaCoada(caz, ACUM, { eroareLa: t }).numara, ACUM), t).toEqual({ status: 500, corp: { error: 'Eroare internă' } })
    }
    for (const c of [null, undefined, NaN, -1, 1.5, '0', Infinity]) {
      expect(await coadaDePreluat(async () => ({ count: c, error: null }), ACUM), String(c)).toBe(null)
    }
    expect(await coadaDePreluat(async () => { throw new Error('retea') }, ACUM)).toBe(null)
    expect(await coadaDePreluat(bazaCoada(caz).numara, new Date('nu'))).toBe(null)
    // o eroare DUPĂ prima citire (plafonul) nu devine nici ea „goală”
    let i = 0
    const aDoua = async () => (++i === 2 ? { count: null, error: { message: 'timeout' } } : { count: 0, error: null })
    expect(await coadaDePreluat(aDoua, ACUM)).toBe(null)
  })
  it('răspunsul are DOAR `de_preluat` (boolean) — niciun număr, id sau conținut de întrebare', async () => {
    const r = await raspunsCoada(bazaCoada({ intrebari: [{ stare: 'noua' }], preluari: [] }).numara, ACUM)
    expect(Object.keys(r.corp)).toEqual(['de_preluat'])
    expect(typeof r.corp.de_preluat).toBe('boolean')
  })
  it('index.ts: „coada” doar numără (HEAD, count exact, filtre pe lista albă), nu cheamă RPC-uri și nu scrie', () => {
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/index.ts', 'utf8').replace(/\r/g, '')
    const ramura = src.slice(src.indexOf("if (corp.actiune === 'coada')"), src.indexOf("if (corp.actiune === 'nume')"))
    expect(ramura).toContain('raspunsCoada(numaraCoada(sb), new Date())')
    expect(ramura).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|storage/)
    const fn = src.slice(src.indexOf('function numaraCoada('), src.indexOf('Deno.serve('))
    expect(fn).toContain("select('id', { count: 'exact', head: true })")
    expect(fn).toContain("if (op !== 'eq' && op !== 'lt' && op !== 'gte') return")
    expect(fn).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  })
  it('poarta: fără secret / cu JWT / secret greșit → refuz ÎNAINTE de „coada” (aceeași poartă pentru toate acțiunile)', async () => {
    for (const antet of ['', ANON_JWT, 'b'.repeat(64)]) expect(await autorizat(antet, verifica)).toBe(false)
    expect(await autorizat(SECRET, verifica)).toBe(true)
    const src = readFileSync('supabase/functions/intrebari-tehnice-worker/index.ts', 'utf8')
    expect(src.indexOf("corp.actiune === 'coada'")).toBeGreaterThan(src.indexOf('await autorizat('))
  })
  it('aceleași constante ca fn_intrebari_preia din ULTIMA migrare care o definește (altfel „coada” trebuie revăzută)', () => {
    const dir = 'supabase/migrations'
    const cu = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
      .filter(f => /FUNCTION public\.fn_intrebari_preia\(\)/.test(readFileSync(`${dir}/${f}`, 'utf8')))
    expect(cu.at(-1)).toBe('20261131e_intrebari_cercetare_surse.sql')
    const m = readFileSync(`${dir}/${cu.at(-1)}`, 'utf8').replace(/\r/g, '')
    const corp = m.slice(m.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_preia()'), m.indexOf('CREATE OR REPLACE FUNCTION public.fn_intrebari_amana('))
    expect(corp).toContain(`WHERE t.stare = 'in_lucru' AND t.preluat_la < now() - interval '${COADA_EXPIRARE_MIN} minutes'`)
    expect(corp).toContain('IF (SELECT count(*) FROM public.intrebari_preluari')
    expect(corp).toContain("WHERE preluat_la >= (date_trunc('day', now() AT TIME ZONE 'Europe/Bucharest') AT TIME ZONE 'Europe/Bucharest')")
    expect(corp).toContain(`AND rezultat IS DISTINCT FROM 'amanat') >= ${COADA_PLAFON_ZI} THEN`)
    expect(corp).toContain("SELECT * INTO r FROM public.intrebari_tehnice WHERE stare = 'noua' ORDER BY creat_la LIMIT 1 FOR UPDATE SKIP LOCKED;")
    // ordinea din preia: expirarea, apoi plafonul, apoi preluarea
    const i = s => corp.indexOf(s)
    expect(i("t.stare = 'in_lucru'")).toBeLessThan(i('FROM public.intrebari_preluari\n'))
    expect(i('>= 40 THEN')).toBeLessThan(i("WHERE stare = 'noua'"))
  })
})
