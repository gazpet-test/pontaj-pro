// Teste statice pentru migrarea 20261132a_ofertare_inchidere_garda (PR #1029 r2): legătura dintre migrare, revenire, scriptul de amprente
// și dry-run. Nu ating nicio bază; proba semantică e în scripts/pglite/test_ofertare_inchidere_garda_local.mjs (PGlite) și pe clonă.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const citeste = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const MIG = citeste('supabase/migrations/20261132a_ofertare_inchidere_garda.sql')
const RB = citeste('supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql')
const AMP = citeste('scripts/ofertare_inchidere_garda_amprente.sql')
const DRY = citeste('supabase/tests/20261132a_ofertare_inchidere_garda_dryrun.sql')

// textul dintre linia care începe cu marcajul de deschidere și cea care începe cu marcajul de închidere (fără ele)
function intre(text, deschide, inchide) {
  const linii = text.split('\n')
  const a = linii.findIndex(l => l.startsWith(deschide)), b = linii.findIndex(l => l.startsWith(inchide))
  expect(a, 'marcaj ' + deschide).toBeGreaterThanOrEqual(0)
  expect(b, 'marcaj ' + inchide).toBeGreaterThan(a)
  expect(linii.filter(l => l.startsWith(deschide)).length).toBe(1)
  return linii.slice(a + 1, b).join('\n')
}
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

describe('20261132a: amprentele schemei', () => {
  it('interogarea amprentelor e IDENTICĂ în migrare și în scriptul coordonatorului', () => {
    const q1 = intre(MIG, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    const q2 = intre(AMP, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    expect(q1.length).toBeGreaterThan(2000)
    expect(q1).toBe(q2)
  })

  it('interogarea acoperă ACL-urile funcțiilor, corpul funcțiilor de trigger și RLS / FORCE fără concatenare cu relacl NULL (L15)', () => {
    const q = intre(MIG, '-- >>> AMPRENTE: interogarea', '-- <<< AMPRENTE: interogarea')
    expect(q).toContain('unnest(p.proacl)')
    expect(q).toContain("--- functia triggerului ---")
    expect(q).toContain('UNION SELECT trg.tgfoid FROM trg')
    expect(q).toContain("E'\\nrls: ' || tb.relrowsecurity::text")
    expect(q).toContain("E'\\nforce_rls: ' || tb.relforcerowsecurity::text")
    // relacl intră DOAR prin unnest + coalesce cu marcaj, niciodată concatenat direct (r1: NULL ștergea tot termenul)
    expect(q).not.toMatch(/relacl::text\s*\|\|/)
    expect(q).not.toMatch(/\|\|\s*tb\.relacl\b/)
    expect(q).toContain("'<NULL = drepturile implicite ale proprietarului>'")
  })

  it('valorile baseline stau într-UN singur loc și, necompletate, refuză (fail-closed)', () => {
    const bloc = intre(MIG, '  -- >>> AMPRENTE BASELINE', '  -- <<< AMPRENTE BASELINE')
    const json = JSON.parse(bloc.trim().replace(/^SELECT '/, '').replace(/'::jsonb$/, ''))
    const chei = Object.keys(json)
    expect(chei).toEqual([...chei].sort())
    expect(chei).toEqual(expect.arrayContaining([
      'fn:auth.uid()', 'fn:public.fn_ofertare_poate_cheltui(bigint,uuid)', 'tabel:public.ofertare_licitatii',
      'trg:a00_ofertare_licitatii_scriere', 'pol:ofertare_licitatii_update', 'coloane:public.ofertare_licitatii',
    ]))
    expect(chei.some(k => k.includes('a02_ofertare_licitatii_inchidere_garda'))).toBe(false)
    // în afara blocului nu există nicio altă valoare de completat
    // necompletat: câte una pe cheie + verificarea din $pre$; completat (după rularea pe producție): rămâne doar verificarea
    expect([1, chei.length + 1]).toContain(MIG.split('__DE_COMPLETAT__').length - 1)
    expect(MIG).toContain("IF position('__DE_COMPLETAT__' IN v_asteptat::text) > 0 THEN")
    expect(MIG).not.toContain('__MD5_LA_DRY__')
    expect(RB).not.toContain('__MD5_LA_DRY__')
  })

  it('scriptul coordonatorului e DOAR citire: tranzacție READ ONLY încheiată cu ROLLBACK, fără scrieri / DDL', () => {
    expect(AMP).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m)
    expect(AMP.trimEnd().endsWith('ROLLBACK;')).toBe(true)
    // instrucțiunile de nivel 0 (linii neindentate, fără comentarii / meta-comenzi psql și fără continuările „)” ale interogării)
    const nivel0 = AMP.split('\n').filter(l => /^[A-Za-z]/.test(l))
    for (const l of nivel0) expect(l).toMatch(/^(BEGIN TRANSACTION|SET LOCAL search_path|SELECT|WITH|ORDER BY|ROLLBACK)\b/)
    expect(AMP).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|COMMIT|TRUNCATE)\b/im)
    expect(AMP).toContain('SET LOCAL search_path = pg_catalog, pg_temp;')
    expect(MIG).toContain("SET search_path TO 'pg_catalog', 'pg_temp'")
  })
})

describe('20261132a: garda și revenirea', () => {
  it('md5 pe corpul gărzii (fără CR) e același în migrare (postcondiție) și în revenire (verificarea dinaintea DROP)', () => {
    const a = MIG.indexOf('AS $fn$') + 'AS $fn$'.length
    const corp = MIG.slice(a, MIG.indexOf('$fn$;', a))
    const h = md5(corp)
    expect(MIG).toContain(`c_corp_md5 CONSTANT text := '${h}'`)
    expect(RB).toContain(`c_corp_md5 CONSTANT text := '${h}'`)
  })

  it('revenirea verifică amprenta exactă ÎNAINTE de DROP (corp, atribute, trigger pe câmpuri)', () => {
    const iDrop = RB.indexOf('DROP TRIGGER a02_ofertare_licitatii_inchidere_garda')
    expect(iDrop).toBeGreaterThan(0)
    const inainte = RB.slice(0, iDrop)
    for (const s of ['IF f.corp IS DISTINCT FROM c_corp_md5 THEN', 'NOT f.prosecdef', "f.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']",
                     "t.tgenabled IS DISTINCT FROM 'O'", 't.tgtype IS DISTINCT FROM 19::int2', 'NOT t.fara_when', "t.coloane IS DISTINCT FROM ARRAY['status']",
                     'LOCK TABLE public.ofertare_licitatii IN SHARE ROW EXCLUSIVE MODE']) {
      expect(inainte).toContain(s)
    }
  })

  it('garda: doar OLD pentru termen și responsabili, refuz 42501, excepția UID NULL doar pentru session_user postgres', () => {
    const a = MIG.indexOf('AS $fn$'), corp = MIG.slice(a, MIG.indexOf('$fn$;', a + 8))
    expect(corp).toContain('OLD.termen_depunere <= now()')
    expect(corp).toContain('public.fn_ofertare_poate_cheltui(OLD.id, v_uid)')
    expect(corp).not.toMatch(/NEW\.(termen_depunere|responsabil)/)
    expect(corp).toContain("IF session_user = 'postgres' THEN RETURN NEW; END IF;")
    expect(corp.match(/ERRCODE = '42501'/g)).toHaveLength(2)
  })
})

describe('20261132a: versiune și dry-run', () => {
  it('versiunea de 14 cifre din antet e unică în supabase/migrations', () => {
    const m = /^-- Version (\d{14})\./.exec(MIG)
    expect(m).not.toBeNull()
    const fis = readdirSync(join(ROOT, 'supabase/migrations')).filter(f => f.endsWith('.sql'))
    const cu = fis.filter(f => citeste('supabase/migrations/' + f).includes('Version ' + m[1]))
    expect(cu).toEqual(['20261132a_ofertare_inchidere_garda.sql'])
    expect(fis.filter(f => f.startsWith(m[1].slice(0, 8)))).toEqual(['20261132a_ofertare_inchidere_garda.sql'])
  })

  it('dry-run-ul citește fișierele reale și rulează cazurile ca rolurile aplicației', () => {
    expect(DRY).toContain("\\copy ig_src (linie) FROM 'supabase/migrations/20261132a_ofertare_inchidere_garda.sql'")
    expect(DRY).toContain("\\copy ig_src (linie) FROM 'supabase/revenire/20261132a_ofertare_inchidere_garda_ROLLBACK.sql'")
    expect(DRY).toContain("format('SET LOCAL SESSION AUTHORIZATION %I', p_sesiune)")
    expect(DRY).toContain("format('SET LOCAL ROLE %I', p_rol)")
    expect(DRY.trimEnd().endsWith('ROLLBACK;')).toBe(true)
    // cazurile cerute de review (P2): fiecare are codul așteptat scris explicit
    for (const [caz, cod] of [['P3', '42501'], ['P3b', '42501'], ['P1c', '42501'], ['P1b', '42501'], ['R1c', 'ok:1'], ['R1d', 'ok:1'],
                              ['R4', 'ok:1'], ['R5', 'ok:1'], ['R6', 'ok:1'], ['P7', 'P0001'], ['P8', '42501'], ['RB1', 'refuz'], ['N1', 'refuz'], ['N4', 'refuz']]) {
      expect(DRY).toContain(`ig_rezultat('${caz}', '${cod}'`)
    }
  })
})
