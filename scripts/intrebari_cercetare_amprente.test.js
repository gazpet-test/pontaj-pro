// Teste statice pentru amprentele migrării 20261131e_intrebari_cercetare_surse (PR #1012 r4, review Jakarinos r3 P2 / L15): legătura
// dintre migrare, revenire, scriptul coordonatorului și migrarea de bază 20261105a. Nu ating nicio bază; proba pe date e dry-run-ul
// pe clonă (supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql, T4–T5 = refuzul la o versiune ulterioară a unei funcții).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261131e_intrebari_cercetare_surse.sql')
const RB = citeste('supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql')
const BAZA = citeste('supabase/migrations/20261105a_intrebari_tehnice.sql')
const AMP = citeste('scripts/intrebari_cercetare_amprente.sql')
const DRY = citeste('supabase/tests/20261131e_intrebari_cercetare_surse_dryrun.sql')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

// textul dintre linia care începe cu marcajul de deschidere și cea care începe cu marcajul de închidere (fără ele)
function intre(text, deschide, inchide) {
  const linii = text.split('\n')
  const a = linii.findIndex(l => l.startsWith(deschide)), b = linii.findIndex(l => l.startsWith(inchide))
  expect(a, 'marcaj ' + deschide).toBeGreaterThanOrEqual(0)
  expect(b, 'marcaj ' + inchide).toBeGreaterThan(a)
  expect(linii.filter(l => l.startsWith(deschide)).length).toBe(1)
  return linii.slice(a + 1, b).join('\n')
}
// {semnătura fără spații: md5(corpul $$…$$, exact ce e în prosrc)} pentru fiecare CREATE [OR REPLACE] FUNCTION public.fn_…
function corpuri(text) {
  const out = {}
  for (const m of text.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(fn_[a-z_]+)\(([^)]*)\)/g)) {
    const a = text.indexOf('AS $$', m.index), b = text.indexOf('$$;', a + 5)
    expect(a, 'corp ' + m[1]).toBeGreaterThan(0)
    const tipuri = m[2].split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/\s+DEFAULT\s+.*$/i, '').split(/\s+/).pop())
    out[`public.${m[1]}(${tipuri.join(',')})`] = md5(text.slice(a + 5, b))
  }
  return out
}
// constanta jsonb `nume CONSTANT jsonb := '{…}'::jsonb` dintr-un fișier
function constanta(text, nume) {
  const m = new RegExp(`${nume} CONSTANT jsonb := '(\\{[^']*\\})'::jsonb`).exec(text)
  expect(m, 'constanta ' + nume).not.toBeNull()
  return JSON.parse(m[1])
}

describe('20261131e: amprentele schemei (L15)', () => {
  it('interogarea amprentelor e IDENTICĂ în migrare și în scriptul coordonatorului', () => {
    const q1 = intre(MIG, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    const q2 = intre(AMP, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    expect(q1.length).toBeGreaterThan(2000)
    expect(q1).toBe(q2)
  })

  it('interogarea acoperă funcțiile înlocuite și dependențele, triggerele + politicile tabelelor atinse, ACL, RLS / FORCE, constrângerile', () => {
    const q = intre(MIG, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    for (const s of ["'public.fn_intrebari_inainte_insert()'", "'public.fn_intrebari_preia()'", "'public.fn_intrebari_amana(bigint,uuid)'",
                     "'public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)'", "'auth.uid()'", "'public.fn_are_acces_intrebari()'",
                     "('public.intrebari_tehnice'), ('public.notifications')", 'unnest(p.proacl)', '--- functia triggerului ---',
                     'UNION SELECT trg.tgfoid FROM trg', 'pg_catalog.pg_policy pol', "E'\\nforce_rls: ' || tb.relforcerowsecurity::text",
                     "'constrangeri:public.intrebari_tehnice'", 'pg_get_constraintdef(co.oid)', "('storage.objects', 'name')"]) {
      expect(q).toContain(s)
    }
    expect(q).not.toMatch(/relacl::text\s*\|\|/)
    expect(q).not.toMatch(/prosrc\s+(NOT\s+)?LIKE/i)
  })

  it('valorile baseline stau într-UN singur loc și, necompletate, refuză (fail-closed)', () => {
    const bloc = intre(MIG, '  -- >>> AMPRENTE BASELINE', '  -- <<< AMPRENTE BASELINE')
    const json = JSON.parse(bloc.trim().replace(/^SELECT '/, '').replace(/'::jsonb$/, ''))
    const chei = Object.keys(json)
    expect(chei).toEqual([...chei].sort())
    expect(chei).toEqual(expect.arrayContaining([
      'fn:auth.uid()', 'fn:public.fn_intrebari_preia()', 'fn:public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)',
      'tabel:public.intrebari_tehnice', 'tabel:public.notifications', 'trg:public.intrebari_tehnice.intrebari_tehnice_inainte_insert',
      'constrangeri:public.intrebari_tehnice', 'coloane:public.notifications',
    ]))
    expect(MIG.split('__DE_COMPLETAT__').length - 1).toBe(chei.length + 1)   // + verificarea din $pre$
    expect(MIG).toContain("IF position('__DE_COMPLETAT__' IN v_asteptat::text) > 0 THEN")
    // amprentele se verifică după LOCK-ul pe tabel și înaintea oricărei schimbări de schemă
    const iLock = MIG.indexOf('LOCK TABLE public.intrebari_tehnice IN ACCESS EXCLUSIVE MODE;')
    const iPre = MIG.indexOf('DO $pre$'), iAlter = MIG.indexOf('ALTER TABLE public.intrebari_tehnice')
    expect(iLock).toBeGreaterThan(0)
    expect(iLock).toBeLessThan(iPre)
    expect(iPre).toBeLessThan(iAlter)
    // funcțiile temporare se șterg înaintea gărzii finale
    expect(MIG.indexOf('DROP FUNCTION pg_temp.fn_20261131e_amprente();')).toBeLessThan(MIG.indexOf('DO $final$'))
  })

  it('scriptul coordonatorului e DOAR citire: tranzacție READ ONLY încheiată cu ROLLBACK, fără scrieri / DDL', () => {
    expect(AMP).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
    expect(AMP.trimEnd().endsWith('ROLLBACK;')).toBe(true)
    const nivel0 = AMP.split('\n').filter(l => /^[A-Za-z]/.test(l))
    for (const l of nivel0) expect(l).toMatch(/^(BEGIN TRANSACTION|SET LOCAL search_path|SELECT|WITH|ORDER BY|ROLLBACK)\b/)
    expect(AMP).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|TRUNCATE)\b/im)
    expect(AMP).toContain('SET LOCAL search_path = pg_catalog, pg_temp;')
    expect(MIG).toContain("SET search_path TO 'pg_catalog', 'pg_temp'")
  })
})

describe('20261131e: corpurile funcțiilor — migrare, revenire, 20261105a', () => {
  const dinMigrare = corpuri(MIG), dinRevenire = corpuri(RB), dinBaza = corpuri(BAZA)

  it('postcondiția migrării are md5-ul corpului FIECĂREI funcții create / înlocuite (recalculat din fișier)', () => {
    expect(Object.keys(dinMigrare).sort()).toEqual([
      'public.fn_intrebari_amana(bigint,uuid)', 'public.fn_intrebari_de_verificat(bigint)', 'public.fn_intrebari_inainte_insert()',
      'public.fn_intrebari_preia()', 'public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text,jsonb,jsonb)', 'public.fn_intrebari_reia(bigint)',
    ])
    expect(constanta(MIG, 'c_corpuri')).toEqual(dinMigrare)
  })

  it('revenirea verifică ACELEAȘI md5-uri înainte de orice DROP (o versiune ulterioară a unei funcții = refuz)', () => {
    expect(constanta(RB, 'c_mig')).toEqual(dinMigrare)
    const iDrop = RB.indexOf('DROP FUNCTION public.fn_intrebari_reia(bigint);')
    expect(iDrop).toBeGreaterThan(0)
    const inainte = RB.slice(0, iDrop)
    for (const s of ['IF NOT FOUND OR f.corp IS DISTINCT FROM c_mig->>k THEN', 'NOT f.prosecdef',
                     "f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']", 'f.supraincarcari <> 1',
                     'LOCK TABLE public.intrebari_tehnice, public.intrebari_preluari IN ACCESS EXCLUSIVE MODE']) {
      expect(inainte).toContain(s)
    }
    expect(RB).not.toMatch(/prosrc\s+(NOT\s+)?LIKE/i)
  })

  it('revenirea readuce corpurile VERBATIM din 20261105a și le verifică în postcondiție', () => {
    expect(Object.keys(dinRevenire).sort()).toEqual([
      'public.fn_intrebari_amana(bigint,uuid)', 'public.fn_intrebari_inainte_insert()', 'public.fn_intrebari_preia()',
      'public.fn_intrebari_raspunde(bigint,uuid,text,text,jsonb,text)',
    ])
    for (const [k, v] of Object.entries(dinRevenire)) expect(dinBaza[k], k).toBe(v)
    expect(constanta(RB, 'c_105a')).toEqual(dinRevenire)
  })

  it('dry-run-ul probează refuzul la o versiune ulterioară, în migrare (T4) și în revenire (T5)', () => {
    expect(DRY).toContain("\\copy r31e_src (linie) FROM 'supabase/migrations/20261131e_intrebari_cercetare_surse.sql'")
    expect(DRY).toContain("\\copy r31e_src (linie) FROM 'supabase/revenire/20261131e_intrebari_cercetare_surse_ROLLBACK.sql'")
    expect(DRY).toMatch(/T4[a-z]? .*amprentele schemei difera/)
    expect(DRY).toMatch(/T5[a-z]? .*alt corp decat versiunea 20261131e/)
  })
})
