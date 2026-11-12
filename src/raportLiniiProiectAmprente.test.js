// Liniile raportului zilnic pe proiectul șantierului citit sub lock (20261217a): verificări statice ale livrării.
// (1) L15 + L19: amprenta stării de acces folosește O SINGURĂ definiție — corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql, copiat
//     octet cu octet (fără CR) în scriptul coordonatorului (scripts/raport_linii_proiect_amprente.sql) și în migrare; BASELINE într-un singur
//     bloc marcat, verificat ÎNAINTE și DUPĂ. (2) Revenirea poartă amprenta EXACTĂ a corpului funcției din migrare. (3) Scripturile pentru
//     coordonator sunt doar citire; scriptul de concurență e bash valid. Comportamentul: scripts/pglite/test_raport_linii_proiect_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/raport_linii_proiect_amprente.sql')
const MIG = citeste('supabase/migrations/20261217a_executie_raport_linii_proiect.sql')
const REV = citeste('supabase/revenire/20261217a_executie_raport_linii_proiect_ROLLBACK.sql')
const DATE_SQL = citeste('scripts/raport_linii_proiect_verifica_date.sql')
const HARNESS = citeste('scripts/test_executie_raport_linii_proiect.sql')
const X = '20261217a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1
const faraComentarii = t => t.replace(/--[^\n]*/g, '')

describe('20261217a — AMPRENTA_L15: o singură definiție (sursa = scriptul coordonatorului = migrarea)', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic există, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('restul secțiunii scriptului (lanțul de callee, linia de baseline, atenționările) = cel din sursă', () => {
    const coada = t => t.slice(t.indexOf('amp_start(oid, sursa) AS ('), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT)).toBe(coada(SURSA))
  })
  it('aceleași tabele în script și în migrare (raport_lucrari, rapoarte_zilnice, sites); pornirea = RPC-ul de salvare', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.raport_lucrari'::regclass::oid), ('public.rapoarte_zilnice'::regclass::oid), ('public.sites'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(intrare).toContain("to_regprocedure('public.fn_raport_zilnic_salveaza(bigint, date, jsonb, jsonb, jsonb, integer, uuid)')")
  })
  it('BASELINE într-un singur loc marcat, funcțiile explicite citite DOAR din el; necompletat = refuz', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(nr(MIG, `CREATE FUNCTION pg_temp.amp_baseline_${X}()`)).toBe(1)
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    expect(MIG).toContain(`amp_functii_explicite(oid) AS (SELECT to_regprocedure(substr(b.eticheta, 9))::oid FROM pg_temp.amp_baseline_${X}() b WHERE b.eticheta LIKE 'functie %'),`)
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.length).toBeGreaterThan(0)
    // până la lipirea valorilor de producție: exact un rând DE_COMPLETAT (= refuz); după: doar perechi (etichetă, md5), fără dubluri
    if (linii.length === 1 && linii[0] === "('DE_COMPLETAT', 'DE_COMPLETAT')") return
    linii.forEach((l, i) => expect(l).toMatch(i === 0 ? /^\('(tabel|functie) [^']+', '[0-9a-f]{32}'\)$/ : /^, \('(tabel|functie) [^']+', '[0-9a-f]{32}'\)$/))
    const et = linii.map(l => l.match(/\('([^']+)'/)[1])
    expect(new Set(et).size).toBe(et.length)
  })
  it('verificarea rulează ÎNAINTE (înaintea lock-urilor și a schimbării) și DUPĂ (după postcondiții), apoi funcțiile pg_temp se șterg', () => {
    const iInainte = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('inainte')`)
    const iLock = MIG.indexOf('DO $lock$')
    const iSchimbare = MIG.indexOf('CREATE FUNCTION public.fn_raport_lucrari_proiect_garda()')
    const iPost = MIG.indexOf('DO $post$')
    const iDupa = MIG.indexOf(`PERFORM pg_temp.amp_verifica_${X}('dupa')`)
    const iDrop = MIG.indexOf(`DROP FUNCTION pg_temp.amp_verifica_${X}(text), pg_temp.amp_calc_${X}(), pg_temp.amp_baseline_${X}();`)
    expect(iInainte).toBeGreaterThan(MIG.indexOf('DO $pre$'))
    expect(iLock).toBeGreaterThan(iInainte)
    expect(iSchimbare).toBeGreaterThan(iLock)
    expect(iPost).toBeGreaterThan(iSchimbare)
    expect(iDupa).toBeGreaterThan(iPost)
    expect(iDrop).toBeGreaterThan(iDupa)
    expect(MIG.slice(iDrop).trim().split('\n')).toHaveLength(1)
  })
  it('excepțiile „după” sunt EXACT cele declarate: triggerul nou al lui raport_lucrari + funcția lui', () => {
    const f = MIG.slice(MIG.indexOf(`CREATE FUNCTION pg_temp.amp_verifica_${X}`), MIG.indexOf('DO $l15_inainte$'))
    expect(f).toContain("WHEN p_moment = 'dupa' AND c.eticheta = 'tabel raport_lucrari | triggere' THEN")
    expect(f).toContain("WHERE NOT (p_moment = 'dupa' AND c.eticheta = 'functie fn_raport_lucrari_proiect_garda()')")
    expect(nr(f, "p_moment = 'dupa'")).toBe(2)
  })
})

describe('20261217a — migrarea și revenirea', () => {
  it('migrarea NU atinge RPC-ul de salvare, datele, drepturile sau politicile (doar o funcție de trigger + un trigger)', () => {
    const cod = faraComentarii(MIG)
    expect(cod).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.fn_raport_zilnic_salveaza/)
    expect(cod).not.toMatch(/\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|GRANT|CREATE POLICY|ALTER POLICY|DROP POLICY|ALTER TABLE)\b/i)
    expect(cod.match(/^CREATE (OR REPLACE )?FUNCTION public\./gm)).toHaveLength(1)
    expect(cod.match(/^CREATE TRIGGER /gm)).toHaveLength(1)
    expect(cod).toContain('REVOKE ALL ON FUNCTION public.fn_raport_lucrari_proiect_garda() FROM PUBLIC, anon, authenticated, service_role;')
  })
  it('ordinea lock-urilor în gardă: rândul raportului, apoi rândul șantierului, ambele FOR SHARE', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_raport_lucrari_proiect_garda()'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_raport_lucrari_proiect_garda()'))
    const iR = corp.indexOf('FROM public.rapoarte_zilnice r WHERE r.id = NEW.raport_id FOR SHARE OF r;')
    const iS = corp.indexOf('FROM public.sites s WHERE s.id = v_site FOR SHARE OF s;')
    const iC = corp.indexOf('IF NEW.proiect_id IS DISTINCT FROM v_proiect THEN')
    expect(iR).toBeGreaterThan(0)
    expect(iS).toBeGreaterThan(iR)
    expect(iC).toBeGreaterThan(iS)
  })
  it('revenirea poartă amprenta exactă a corpului funcției din migrare (md5 pe textul dintre $f$ … $f$)', () => {
    const i = MIG.indexOf('CREATE FUNCTION public.fn_raport_lucrari_proiect_garda()')
    const a = MIG.indexOf('AS $f$', i) + 'AS $f$'.length, b = MIG.indexOf('$f$;', a)
    const md5 = createHash('md5').update(MIG.slice(a, b), 'utf8').digest('hex')
    const m = /-- AMPRENTA-START\n\s*AND md5\(replace\(p\.prosrc, chr\(13\), ''\)\) = '([0-9a-f]{32})'\n\s*-- AMPRENTA-END/.exec(REV)
    expect(m && m[1]).toBe(md5)
  })
  it('revenirea: marcajul runnerului cu numele ei, plafonul, starea verificată și fără lock și sub lock, apoi DROP', () => {
    expect(REV).toContain("IS DISTINCT FROM '20261217a_executie_raport_linii_proiect_ROLLBACK:' || txid_current()")
    expect(REV).toContain("v_plafon IS DISTINCT FROM '2000/session'")
    expect(REV).toContain('FOR v_pas IN 1 .. 2 LOOP')
    expect(REV.indexOf('LOCK TABLE public.raport_lucrari IN ACCESS EXCLUSIVE MODE;')).toBeLessThan(REV.indexOf('DROP TRIGGER trg_raport_lucrari_zz_proiect'))
  })
  it('harness-ul: defectul reprodus ÎNAINTE de migrare, apoi aplicarea, testele, revenirea, re-aplicarea; tranzacția anulată', () => {
    const iT1 = HARNESS.indexOf('-- ── T1: ÎNAINTE de migrare')
    const iMig = HARNESS.indexOf('\\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql')
    expect(iT1).toBeGreaterThan(0)
    expect(iMig).toBeGreaterThan(iT1)
    for (const t of ['T2', 'T3', 'T4', 'T5', 'T6']) expect(HARNESS.indexOf(`-- ── ${t}:`)).toBeGreaterThan(iMig)
    expect(nr(HARNESS, '\\ir ../supabase/migrations/20261217a_executie_raport_linii_proiect.sql')).toBe(2)
    expect(HARNESS.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(HARNESS).not.toMatch(/^COMMIT;$/m)
  })
})

describe('scripturile pentru coordonator: doar citire', () => {
  for (const [nume, t] of [['amprentele', SCRIPT], ['datele', DATE_SQL]]) {
    it(`${nume}: o tranzacție READ ONLY, încheiată cu ROLLBACK, fără scrieri`, () => {
      expect(t).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
      expect(t.trim().endsWith('ROLLBACK;')).toBe(true)
      const fara = faraComentarii(t)
      expect(fara).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMIT)\b/i)
    })
  }
  it('scriptul de date: garda țintei înaintea oricărei citiri de date', () => {
    expect(DATE_SQL.indexOf("RAISE EXCEPTION 'REFUZ: system_identifier")).toBeLessThan(DATE_SQL.indexOf('FROM public.rapoarte_zilnice'))
  })
})

describe('scriptul de concurență (clonă)', () => {
  const cale = fileURLToPath(new URL('../scripts/raport_linii_proiect_concurenta.sh', import.meta.url))
  it('bash valid (bash -n), fără shebang CRLF, cu garda țintei înaintea oricărei scrieri', () => {
    const r = spawnSync('bash', ['-n', cale], { encoding: 'utf8' })
    if (r.error) return   // fără bash pe mașină: doar verificările de text
    expect(r.status, r.stderr).toBe(0)
    const t = readFileSync(cale, 'utf8')
    expect(t.includes('\r')).toBe(false)
    expect(t.indexOf('REFUZ: system_identifier')).toBeLessThan(t.indexOf('INSERT INTO public.proiect_activitati'))
    expect(t).toContain("trap 'curata || exit 25' EXIT")
  })
  it('r2: fereastra se deschide pe lock-uri observate, nu pe timp; proba nefuncțională are ieșirea ei', () => {
    const t = readFileSync(cale, 'utf8')
    // așteptarea salvării e observată pe pid-ul controlului (nu „orice sesiune în Lock”)
    expect(t).toMatch(/v_c = ANY \(pg_blocking_pids\(a\.pid\)\)/)
    expect(t).toContain("a.application_name = 'rlp17_$1_s'")
    // nicio ținere pe pg_sleep (doar pași de sondare de 0,05 s) și nicio eroare a probei în tranzacția salvării pe criteriu de durată
    expect(t.match(/pg_sleep\(([^)]*)\)/g).every((s) => s === 'pg_sleep(0.05)')).toBe(true)
    expect(t).not.toMatch(/salvarea nu a asteptat la activitate/)
    // trei stări, ieșiri distincte; modul doar-barieră
    expect(t).toContain('verdict NEFUNCTIONAL')
    expect(t).toMatch(/^\s*exit 26$/m)
    expect(t).toContain('--verifica-bariera) VERIFICA=1')
    expect(t).toContain('salvare B0 172170001 2001-02-01 0 ROLLBACK')
  })
})
