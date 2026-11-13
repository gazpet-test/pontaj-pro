// Vremea zilei din Vaisala Xweather (20261221a): verificări statice ale livrării.
// (1) L15 + L19: amprenta funcțiilor de drept folosește O SINGURĂ definiție — corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql,
//     copiat octet cu octet (fără CR) în scriptul coordonatorului (scripts/meteo_xweather_amprente.sql) și în migrare; BASELINE într-un singur
//     bloc marcat (DE_COMPLETAT = refuz până îl lipește coordonatorul). (2) Revenirea poartă amprenta EXACTĂ a corpului fiecărei funcții create.
// (3) Drepturile și nemodificarea, scrise explicit; anon nimic. (4) Edge fn: credențialele nu ajung în cererea salvată / mesaje.
// Comportamentul: scripts/pglite/test_meteo_xweather_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/meteo_xweather_amprente.sql')
const MIG = citeste('supabase/migrations/20261221a_meteo_xweather_zilnic.sql')
const REV = citeste('supabase/revenire/20261221a_meteo_xweather_zilnic_ROLLBACK.sql')
const EDGE = citeste('supabase/functions/meteo-sync/index.ts')
const LOGICA = citeste('supabase/functions/meteo-sync/xweather_zilnic_logica.ts')
const X = '20261221a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const corp = (fn) => {
  const i = MIG.indexOf(`CREATE FUNCTION public.${fn}(`)
  const a = MIG.indexOf('AS $f$', i) + 'AS $f$'.length
  return MIG.slice(a, MIG.indexOf('$f$;', a))
}

describe('20261221a — AMPRENTA_L15: o singură definiție', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('restul secțiunii scriptului (lanțul de callee, linia de baseline, atenționările) = cel din sursă', () => {
    const coada = t => t.slice(t.indexOf('amp_start(oid, sursa) AS ('), t.indexOf('ORDER BY c.eticheta COLLATE "C";') + 32)
    expect(coada(SCRIPT)).toBe(coada(SURSA))
  })
  it('intrarea: niciun tabel existent; pornirea = funcțiile de drept ale predicatului; aceeași în migrare', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe('amp_tabele(oid) AS (SELECT c.oid FROM pg_class c WHERE false),')
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(intrare).toContain("to_regprocedure('public.fn_raport_santier_drept(bigint)')")
    expect(intrare).toContain("to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')")
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
  })
  it('BASELINE într-un singur loc marcat; până la lipire DOAR rândul DE_COMPLETAT (= refuz); verificat înainte ȘI după', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.every(l => /^(, )?\('(tabel [^']+|functie [^']+|DE_COMPLETAT)', '([0-9a-f]{32}|DE_COMPLETAT)'\)$/.test(l))).toBe(true)
    expect(MIG).toContain(`DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_${X}('inainte'); END $l15_inainte$;`)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('dupa');`)
    expect(MIG).toContain("b.amprenta !~ '^[0-9a-f]{32}$'")
  })
})

describe('20261221a — migrarea: garda, plafonul, obiectele, drepturile', () => {
  it('antet de versiune, gardă de start / final, plafon 2000 cerut, READ COMMITTED, lock NOWAIT cu buget', () => {
    expect(MIG.startsWith('-- Version 20261221120000. NEAPLICAT.')).toBe(true)
    expect(MIG).toContain(`IS DISTINCT FROM '${X}_meteo_xweather_zilnic:' || txid_current()`)
    expect(nr(MIG, `'${X}_meteo_xweather_zilnic:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain('LOCK TABLE public.sites IN SHARE ROW EXCLUSIVE MODE NOWAIT;')
    expect(MIG).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('nemodificabil: niciun UPDATE / DELETE / TRUNCATE acordat; trigger-ele pe UPDATE / DELETE / TRUNCATE; versiunea și preluat_la de la server', () => {
    const grant = MIG.split('\n').filter(l => /^GRANT /.test(l))
    expect(grant).toEqual([
      'GRANT EXECUTE ON FUNCTION public.fn_meteo_vede_site(bigint) TO authenticated;',
      'GRANT SELECT ON public.meteo_zilnic_xweather TO authenticated;',
      'GRANT SELECT, INSERT ON public.meteo_zilnic_xweather TO service_role;',
      'GRANT SELECT ON public.v_meteo_zilnic_xweather TO authenticated, service_role;',
    ])
    expect(MIG).toContain('REVOKE ALL ON public.meteo_zilnic_xweather FROM PUBLIC, anon, authenticated, service_role;')
    expect(MIG).toContain('REVOKE ALL ON public.v_meteo_zilnic_xweather FROM PUBLIC, anon, authenticated, service_role;')
    expect(MIG).toContain('BEFORE UPDATE OR DELETE ON public.meteo_zilnic_xweather')
    expect(MIG).toContain('BEFORE TRUNCATE ON public.meteo_zilnic_xweather')
    expect(corp('fn_meteo_xw_inserare')).toContain('NEW.preluat_la := now();')
    expect(corp('fn_meteo_xw_inserare')).toContain("IF NEW.data >= (now() AT TIME ZONE 'Europe/Bucharest')::date THEN")
    // postcondiții pe fiecare drept, inclusiv anon
    for (const d of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) expect(MIG).toContain(`('anon', 'public.meteo_zilnic_xweather', '${d}', false)`)
  })
  it('citirea: UN predicat (L19) folosit de politică; identitatea din auth.uid() (L08), nu din parametri', () => {
    expect(MIG).toContain('CREATE POLICY meteo_xw_citire ON public.meteo_zilnic_xweather FOR SELECT TO authenticated USING (public.fn_meteo_vede_site(site_id));')
    expect(nr(MIG, 'CREATE POLICY')).toBe(1)
    const p = corp('fn_meteo_vede_site')
    expect(p).toContain('auth.uid() IS NOT NULL')
    expect(p).toContain('public.fn_raport_santier_drept(p_site)')
    expect(p).toContain('public.fn_executie_proiect_permis(s.proiect_id::bigint, false)')
    expect(MIG).toContain('CREATE VIEW public.v_meteo_zilnic_xweather WITH (security_invoker = on) AS')
  })
  it('sursa numită exact; niciodată „senzor Vaisala”', () => {
    expect(MIG).toContain("'Vaisala Xweather'::text AS sursa")
    expect(MIG + LOGICA).not.toMatch(/senzor(ul)? Vaisala/i)
  })
})

describe('20261221a — revenirea', () => {
  it('amprenta EXACTĂ a corpului fiecărei funcții create', () => {
    for (const [et, fn] of [['predicatul', 'fn_meteo_vede_site'], ['inserarea', 'fn_meteo_xw_inserare'], ['nemodificabil', 'fn_meteo_xw_nemodificabil']]) {
      const m = REV.match(new RegExp(`-- AMPRENTA-START ${et}\\n\\s*'([0-9a-f]{32})'`))
      expect(m, et).toBeTruthy()
      expect(m[1], et).toBe(md5(corp(fn)))
    }
  })
  it('refuză cu rânduri, sub ACCESS EXCLUSIVE luat ÎNAINTE; gardă + plafon; scoate tot', () => {
    const iLock = REV.indexOf('LOCK TABLE public.meteo_zilnic_xweather IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iGol = REV.indexOf('IF EXISTS (SELECT 1 FROM public.meteo_zilnic_xweather) THEN')
    expect(iLock).toBeGreaterThan(0)
    expect(iGol).toBeGreaterThan(iLock)
    expect(REV).toContain(`'${X}_meteo_xweather_zilnic_ROLLBACK:' || txid_current()`)
    expect(REV).toContain("IS DISTINCT FROM '2000/session'")
    for (const d of ['DROP VIEW public.v_meteo_zilnic_xweather;', 'DROP TABLE public.meteo_zilnic_xweather;', 'DROP FUNCTION public.fn_meteo_vede_site(bigint);',
                     'DROP FUNCTION public.fn_meteo_xw_inserare();', 'DROP FUNCTION public.fn_meteo_xw_nemodificabil();']) expect(REV).toContain(d)
    // codul (fără comentarii) nu șterge rânduri și nu cascadează
    expect(REV.replace(/--[^\n]*/g, '')).not.toMatch(/DELETE FROM|TRUNCATE|CASCADE/)
  })
})

describe('edge fn meteo-sync: credențialele nu ies din apel', () => {
  it('cererea salvată e fără credențiale; URL-ul cu ele se construiește doar în fetch; backfill-ul doar pentru owner', () => {
    expect(EDGE).toContain('fetch(`${API}/${cuCredentiale(cerere, cid, csec)}`')
    expect(nr(EDGE, 'cuCredentiale(')).toBe(1)
    expect(EDGE).toMatch(/if \(body\.xweather_backfill\) \{\n\s*if \(!esteOwner\) return json\(/)
    expect(EDGE).toContain("await db.from('meteo_zilnic_xweather').insert(z.rand)")
    expect(EDGE).not.toMatch(/meteo_zilnic_xweather'\)\.(upsert|update|delete)/)
  })
})
