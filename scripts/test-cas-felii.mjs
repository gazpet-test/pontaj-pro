// R4 (Copilot) pct. 2 — traseul COMPLET al scrierii din /api/plansa-felii (scrieAnalizaCAS din api/_cas.js, aceeași
// funcție pe care o importă handlerul), cu client Supabase simulat: update real + filtre pe calea JSON.
// Rulare: node scripts/test-cas-felii.mjs
import { readFileSync } from 'node:fs'
import { scrieAnalizaCAS, INCERCARI_CAS, rezervariActive, refuzInLucru, verificaRetaiere, REZERVARE_EXPIRA_MS, TOLERANTA_CEAS_MS } from '../api/_cas.js'
import { scrieAnalizaCAS as dinHandler, rezervariActive as rezDinHandler, refuzInLucru as refuzDinHandler, verificaRetaiere as verDinHandler } from '../api/plansa-felii.js'

const cale = (row, c) => { let v = row; for (const p of c.split(/->>?/)) v = v == null ? undefined : v[p]; return c.includes('->>') ? (v == null ? null : String(v)) : v }
function db(rows, { inainteDeUpdate } = {}) {
  const n = { update: 0, conflicte: 0, citiri: 0 }
  const from = () => {
    const filtre = []; let patch = null
    const potrivite = () => rows.filter((r) => filtre.every((f) => f(r)))
    const b = {
      update: (p) => { patch = p; return b },
      select: () => b,
      eq: (c, v) => { filtre.push((r) => String(cale(r, c)) === String(v)); return b },
      is: (c, v) => { filtre.push((r) => (cale(r, c) ?? null) === v); return b },
      maybeSingle: async () => { n.citiri++; return { data: structuredClone(potrivite()[0] ?? null), error: null } },
      then: (ok, ko) => (async () => {
        if (!patch) return { data: structuredClone(potrivite()), error: null }
        if (inainteDeUpdate) await inainteDeUpdate(rows)
        const r = potrivite(); n.update++
        if (!r.length) n.conflicte++
        for (const x of r) Object.assign(x, structuredClone(patch))
        return { data: r.map((x) => ({ id: x.id })), error: null }
      })().then(ok, ko),
    }
    return b
  }
  return { supa: { from }, n }
}

let ok = 0, tot = 0
const verifica = (c, m) => { tot++; if (c) ok++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}`) }
verifica(dinHandler === scrieAnalizaCAS, '0: /api/plansa-felii folosește exact funcția din api/_cas.js')

// 1) Două scrieri din ACEEAȘI revizie: A (retăiere) și B (o rundă de citire). B scrie primul; A reîncearcă și
//    reconstruiește peste analiza PROASPĂTĂ (citirea lui B nu se pierde; jetonul se schimbă).
{
  const rows = [{ id: 7, analiza: { plansa: { taiat_la: 'T1' }, citire_ai: { rev: 'r0', felii: ['z1_1'] } } }]
  const { supa, n } = db(rows)
  const docCitit = structuredClone(rows[0])       // ambele au citit rev r0
  // B: o rundă de citire scrie între timp (rev r1, zonă nouă)
  const wB = await scrieAnalizaCAS(supa, 7, docCitit, (a) => ({ ...a, citire_ai: { ...a.citire_ai, rev: 'r1', felii: ['z1_1', 'z1_2'] } }))
  let apeluri = 0
  const wA = await scrieAnalizaCAS(supa, 7, docCitit, (a) => { apeluri++
    return { ...a, plansa: { taiat_la: 'T2' }, ...(a.citire_ai ? { citire_ai: { ...a.citire_ai, rev: 'taiere-2' } } : {}) } })
  verifica(wB.ok && wB.incercari === 1, '1: prima scriere trece din prima')
  verifica(wA.ok && wA.incercari === 2 && apeluri === 2, '1: a doua (aceeași revizie) are conflict, reîncearcă și reconstruiește')
  const a = rows[0].analiza
  verifica(a.plansa.taiat_la === 'T2' && a.citire_ai.rev === 'taiere-2', '1: tăierea nouă scrisă, jeton nou')
  verifica(JSON.stringify(a.citire_ai.felii) === '["z1_1","z1_2"]', '1: reconstruită peste analiza proaspătă — citirea lui B păstrată')
  verifica(n.conflicte === 1, '1: exact un conflict')
}

// 2) Epuizare: înainte de FIECARE update, altă rulare schimbă jetonul => după INCERCARI_CAS încercări, 409 explicit,
//    nimic din ce e salvat nu e suprascris.
{
  let k = 0
  const rows = [{ id: 8, analiza: { plansa: { taiat_la: 'T1', felii: 12 }, citire_ai: { rev: 'r0', felii: ['z1_1', 'z1_2'] } } }]
  const { supa, n } = db(rows, { inainteDeUpdate: (rs) => { rs[0].analiza.citire_ai = { ...rs[0].analiza.citire_ai, rev: `alt-${++k}`, felii: [...rs[0].analiza.citire_ai.felii, `x${k}`] } } })
  const w = await scrieAnalizaCAS(supa, 8, structuredClone(rows[0]), (a) => ({ ...a, plansa: { taiat_la: 'T9' } }))
  verifica(!w.ok && w.status === 409 && w.conflict === true, '2: epuizare => 409 explicit')
  verifica(w.incercari === INCERCARI_CAS && n.update === INCERCARI_CAS && n.conflicte === INCERCARI_CAS, `2: exact ${INCERCARI_CAS} încercări`)
  verifica(/încercări fără succes/.test(w.error), '2: mesaj explicit')
  const a = rows[0].analiza
  verifica(a.plansa.taiat_la === 'T1' && a.plansa.felii === 12, '2: tăierea salvată rămâne intactă')
  verifica(JSON.stringify(a.citire_ai.felii) === '["z1_1","z1_2","x1","x2","x3"]' && a.citire_ai.rev === 'alt-3', '2: citirile salvate de celelalte rulări rămân intacte')
}

// 3) Prima tăiere (fără citire_ai): filtrul e `rev IS NULL`; o citire care apare între timp => reconstruire peste ea
{
  const rows = [{ id: 9, analiza: { plansa: { taiat_la: 'T1' } } }]
  let prim = true
  const { supa } = db(rows, { inainteDeUpdate: (rs) => { if (prim) { prim = false; rs[0].analiza.citire_ai = { rev: 'r1', felii: ['z1_1'] } } } })
  const w = await scrieAnalizaCAS(supa, 9, structuredClone(rows[0]), (a) => ({ ...a, plansa: { taiat_la: 'T2' },
    ...(a.citire_ai ? { citire_ai: { ...a.citire_ai, rev: 'taiere-2' } } : {}) }))
  verifica(w.ok && w.incercari === 2, '3: rev null -> conflict la apariția citirii, reîncercare reușită')
  verifica(rows[0].analiza.citire_ai.rev === 'taiere-2' && rows[0].analiza.citire_ai.felii[0] === 'z1_1', '3: citirea apărută păstrată, jeton schimbat de retăiere')
}

// 4) document dispărut între încercări => 404, nu 409
{
  const rows = [{ id: 10, analiza: { citire_ai: { rev: 'r0' } } }]
  const { supa } = db(rows, { inainteDeUpdate: (rs) => { rs.length = 0 } })
  const w = await scrieAnalizaCAS(supa, 10, structuredClone(rows[0]), (a) => a)
  verifica(!w.ok && w.status === 404, '4: document șters => 404')
}

// 5) R4 runda 3: retăierea e refuzată cât timp o citire din alt tab are zone rezervate (active, pe tăierea curentă)
{
  const acum = Date.parse('2026-09-25T12:00:00Z')
  const an = (zone) => ({ plansa: { taiat_la: 'T1' }, rezervari_zone: { rev: 'x', zone } })
  verifica(rezDinHandler === rezervariActive, '5: /api/plansa-felii folosește exact rezervariActive din api/_cas.js')
  const r = rezervariActive(an({ z1_5: { rulare: 'A', taiat_la: 'T1', pana_la: '2026-09-25T12:05:00Z' } }), acum)
  verifica(r.length === 1 && r[0].cheie === 'z1_5' && r[0].pana_la === '2026-09-25T12:05:00Z', '5: rezervare activă pe tăierea curentă => blochează retăierea')
  verifica(rezervariActive(an({ z1_5: { rulare: 'A', taiat_la: 'T1', pana_la: '2026-09-25T11:59:00Z' } }), acum).length === 0, '5: rezervare expirată (tab închis) => nu blochează')
  verifica(rezervariActive(an({ z1_5: { rulare: 'A', taiat_la: 'T0', pana_la: '2026-09-25T12:05:00Z' } }), acum).length === 0, '5: rezervare pe altă tăiere => nu blochează')
  verifica(rezervariActive({ plansa: { taiat_la: 'T1' } }, acum).length === 0 && rezervariActive(null, acum).length === 0, '5: fără rezervări => nu blochează')
  verifica(rezervariActive(an({ 'lipire:z1_1+z1_2': { rulare: 'B', taiat_la: 'T1', pana_la: '2026-09-25T12:05:00Z' } }), acum).length === 1, '5: și perechile „note tăiate” în lucru blochează')
}

// 6) Verificator R4 (runda 1): plafon pe pana_la — activă doar dacă now < pana_la <= now + termen + toleranță
{
  const acum = Date.parse('2026-09-25T12:00:00Z')
  const la = (ms) => new Date(acum + ms).toISOString()
  const an = (pana_la) => ({ plansa: { taiat_la: 'T1' }, rezervari_zone: { rev: 'x', zone: { z1_5: { rulare: 'A', taiat_la: 'T1', pana_la } } } })
  verifica(rezervariActive(an(la(REZERVARE_EXPIRA_MS)), acum).length === 1, '6: rezervare normală (now + 7 min) => activă')
  verifica(rezervariActive(an(la(REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS)), acum).length === 1, '6: la limita toleranței de ceas (+60 s) => activă')
  verifica(rezervariActive(an(la(REZERVARE_EXPIRA_MS + TOLERANTA_CEAS_MS + 1000)), acum).length === 0, '6: peste plafon => ignorată (expirată)')
  verifica(rezervariActive(an('2099-01-01T00:00:00Z'), acum).length === 0 && refuzInLucru(an('2099-01-01T00:00:00Z'), acum) === null, '6: rezervare forjată pe 2099 => NU blochează retăierea')
  verifica(rezervariActive(an('nu-e-data'), acum).length === 0, '6: pana_la invalid => ignorată')
  // constantele trebuie să fie identice cu cele din edge (concurenta.ts)
  const ts = readFileSync(new URL('../supabase/functions/ofertare-plansa-citeste/concurenta.ts', import.meta.url), 'utf8')
  const val = (nume) => { const m = new RegExp(`export const ${nume} = ([^;\\n]+);`).exec(ts); return m ? Function(`return ${m[1]}`)() : NaN }
  verifica(val('REZERVARE_EXPIRA_MS') === REZERVARE_EXPIRA_MS && val('TOLERANTA_CEAS_MS') === TOLERANTA_CEAS_MS, '6: REZERVARE_EXPIRA_MS / TOLERANTA_CEAS_MS identice cu concurenta.ts')
}

// 7) Verificator R4 (runda 1): re-verificarea pe starea proaspătă înaintea scrierilor „necitibilă” și a ștergerii feliilor
{
  const acum = Date.parse('2026-09-25T12:00:00Z')
  verifica(verDinHandler === verificaRetaiere && refuzDinHandler === refuzInLucru, '7: /api/plansa-felii folosește exact verificaRetaiere / refuzInLucru din api/_cas.js')
  const activa = { plansa: { taiat_la: 'T1' }, rezervari_zone: { rev: 'x', zone: { z1_5: { rulare: 'A', taiat_la: 'T1', pana_la: '2026-09-25T12:05:00Z' } } } }
  const r1 = await verificaRetaiere(db([{ id: 11, analiza: activa }]).supa, 11, acum)
  verifica(r1?.status === 409 && r1.body.in_lucru[0] === 'z1_5' && /în citire în alt tab/.test(r1.body.error), '7: rezervare activă pe starea proaspătă => 409')
  const r2 = await verificaRetaiere(db([{ id: 12, analiza: { plansa: { taiat_la: 'T1' } } }]).supa, 12, acum)
  verifica(r2 === null, '7: fără rezervări => se poate retăia')
  const cuEroare = { from: () => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }) }; return b } }
  const r3 = await verificaRetaiere(cuEroare, 13, acum)
  verifica(r3?.status === 503 && /nu retai pe nesigure/.test(r3.body.error), '7: re-citirea întoarce eroare => refuz (fail-closed), nu trece mai departe')
  const cuExceptie = { from: () => { const b = { select: () => b, eq: () => b, maybeSingle: async () => { throw new Error('rețea') } }; return b } }
  const r4 = await verificaRetaiere(cuExceptie, 14, acum)
  verifica(r4?.status === 503, '7: excepție la re-citire => refuz (fail-closed)')
  const r5 = await verificaRetaiere(db([]).supa, 15, acum)
  verifica(r5?.status === 404, '7: document dispărut => 404')
  // ordinea în handler: re-verificarea stă înaintea FIECĂREI scrieri „necitibilă” (w0) și înaintea ștergerii feliilor
  const src = readFileSync(new URL('../api/plansa-felii.js', import.meta.url), 'utf8')
  const w0 = [...src.matchAll(/const w0 = await scrieAnalizaCAS\(/g)].map((m) => m.index)
  const rv = [...src.matchAll(/await reverifica\(\)/g)].map((m) => m.index)
  const sterge = src.indexOf(".remove(vechi.map(")
  verifica(w0.length === 3 && w0.every((i) => rv.some((j) => j < i && src.slice(j, i).split('\n').length <= 3)), '7: fiecare din cele 3 scrieri „necitibilă” e precedată imediat de re-verificare')
  verifica(sterge > 0 && rv.some((j) => j < sterge && src.slice(j, sterge).split('\n').length <= 5), '7: ștergerea feliilor e precedată imediat de re-verificare')
}

console.log(`\n${ok}/${tot} verificări trecute`)
process.exit(ok === tot ? 0 : 1)
