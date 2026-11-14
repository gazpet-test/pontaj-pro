import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { autorizat, numeDinPlatforma, toateRandurile, coloane, SURSE_NUME, NUME_MAX_TABEL } from './logic.js'

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
    for (const dupa of ['citesteCorp(req', "corp.actiune === 'nume'", "corp.actiune === 'preia'", 'numeDinPlatforma(']) {
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
