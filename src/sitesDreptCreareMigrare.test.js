// Dreptul de a crea un șantier, pe cont (TKT-2026-0359, 20261222a): verificări statice ale livrării + regula din interfață.
// (1) L15 + L19: corpul AMPRENTA_L15 v1 copiat octet cu octet (fără CR) din scripts/tichete_lot2_amprente.sql în scriptul coordonatorului și în
//     migrare; închiderea (INCHIDERE_L15) identică în script și migrare; BASELINE într-un singur bloc marcat (DE_COMPLETAT = refuz).
// (2) Amprenta corpului funcției noi: aceeași în migrare („după”) și în revenire, egală cu md5 pe corpul real.
// (3) Doar INSERT: o singură politică nouă, nimic pe UPDATE / DELETE; migrarea nu acordă dreptul nimănui; drepturi explicite.
// (4) Interfața: aceeași regulă ca BD-ul (owner sau santiere_creare editor / admin); refuzul bazei explicat.
// Comportamentul pe BD (matricea de conturi, revenire, mutanți): scripts/pglite/test_sites_drept_creare_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { poateCreaSantier, mesajRefuzSantier, CHEIE_SANTIERE_CREARE } from './lib/santiereDrept.js'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/sites_drept_creare_amprente.sql')
const MIG = citeste('supabase/migrations/20261222a_sites_drept_creare.sql')
const REV = citeste('supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql')
const APP = citeste('src/App.jsx')
const WIZ = citeste('src/ProiectNouWizard.jsx')
const X = '20261222a'
const A = '-- >>> AMPRENTA_L15 v1', B = '-- <<< AMPRENTA_L15 v1'
const blocuri = (t, a, b) => {
  const out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
const nr = (t, s) => t.split(s).length - 1
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const corp = () => {
  const i = MIG.indexOf('CREATE FUNCTION public.fn_sites_drept_creare(')
  const a = MIG.indexOf('AS $f$', i) + 'AS $f$'.length
  return MIG.slice(a, MIG.indexOf('$f$;', a))
}
// codul fără comentariile SQL de linie
const fara = t => t.replace(/--[^\n]*/g, '')

describe('20261222a — L15: o singură definiție, baseline marcat', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul AMPRENTA_L15 v1, o dată în script și o dată în migrare, identic cu sursa canonică', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  it('închiderea: un singur bloc, identic în script și în migrare; pornirea = auth.uid() + fn_executie_proiect_permis', () => {
    const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
    const inch = blocuri(SCRIPT, IA, IB)
    expect(inch.length).toBe(1)
    expect(blocuri(MIG, IA, IB)).toEqual(inch)
    expect(inch[0]).toContain("to_regprocedure('auth.uid()')")
    expect(inch[0]).toContain("to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')")
    expect(inch[0]).toContain('amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),')
    expect(MIG).not.toMatch(/amp_functii_explicite\(oid\) AS \(SELECT to_regprocedure\(substr\(b\.eticheta/)
  })
  it('intrarea: tabelul sites, aceeași în script și în migrare; scriptul e doar citire', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (SELECT 'public.sites'::regclass::oid),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    // nicio instrucțiune de scriere (cuvântul poate apărea doar ca argument, ex. has_table_privilege(…, 'INSERT'))
    expect(fara(SCRIPT)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|COMMIT)\b/im)
  })
  it('BASELINE într-un singur loc; până la lipire DOAR rândul DE_COMPLETAT; verificat înainte ȘI după', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.length).toBeGreaterThan(0)
    expect(linii.every(l => /^(, )?\('(tabel [^']+|functie [^']+|DE_COMPLETAT)', '([0-9a-f]{32}|DE_COMPLETAT)'\)$/.test(l))).toBe(true)
    expect(MIG).toContain(`DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_${X}('inainte'); END $l15_inainte$;`)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('dupa');`)
    expect(MIG).toContain("b.amprenta !~ '^[0-9a-f]{32}$'")
  })
  it('amprenta corpului funcției noi: aceeași în „după” și în revenire, egală cu corpul real', () => {
    const h = md5(corp())
    expect(MIG).toContain(`|| 'corp_md5=${h}'`)
    const m = REV.match(/-- AMPRENTA-START predicatul\n\s*'([0-9a-f]{32})'/)
    expect(m).toBeTruthy()
    expect(m[1]).toBe(h)
  })
})

describe('20261222a — migrarea: exact dreptul cerut', () => {
  it('antet NEAPLICAT, gardă de start / final, plafon 2000, lock NOWAIT cu buget, fără BEGIN / COMMIT', () => {
    expect(MIG.startsWith('-- Version 20261222120000. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${X}_sites_drept_creare:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain('LOCK TABLE public.sites IN ACCESS EXCLUSIVE MODE NOWAIT;')
    expect(MIG).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('o singură politică nouă, PERMISSIVE, DOAR pe INSERT; nimic pe UPDATE / DELETE / SELECT', () => {
    const cod = fara(MIG)
    expect(nr(cod, 'CREATE POLICY')).toBe(1)
    expect(cod).toContain('CREATE POLICY sites_insert_drept_creare ON public.sites AS PERMISSIVE FOR INSERT TO authenticated\n  WITH CHECK (public.fn_sites_drept_creare(proiect_id::bigint));')
    expect(cod).not.toMatch(/ALTER POLICY|DROP POLICY|FOR (ALL|UPDATE|DELETE|SELECT)\b/)
  })
  it('predicatul: identitatea din auth.uid() (L08), cheia exactă santiere_creare, editor / admin, proiectul verificat la scriere (L09)', () => {
    const p = corp()
    expect(p).toContain('auth.uid() IS NOT NULL')
    expect(p).toContain("u.profile_id = auth.uid() AND u.module = 'santiere_creare' AND u.access_level IN ('editor', 'admin')")
    expect(p).toContain('(p_proiect IS NULL OR public.fn_executie_proiect_permis(p_proiect, true))')
    expect(p).not.toMatch(/administrativ\.locatii|can_manage_contracts|LIKE/)
    expect(MIG).toContain('CREATE FUNCTION public.fn_sites_drept_creare(p_proiect bigint) RETURNS boolean\nLANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$')
  })
  it('drepturile explicite: REVOKE de la toți, EXECUTE doar authenticated; migrarea nu acordă dreptul nimănui', () => {
    const cod = fara(MIG)
    expect(cod.split('\n').filter(l => /^GRANT /.test(l))).toEqual(['GRANT EXECUTE ON FUNCTION public.fn_sites_drept_creare(bigint) TO authenticated;'])
    expect(cod).toContain('REVOKE ALL ON FUNCTION public.fn_sites_drept_creare(bigint) FROM PUBLIC, anon, authenticated, service_role;')
    expect(cod).not.toMatch(/INSERT INTO public\.user_module_access/)
    expect(cod).toContain("IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN")
    // cheia de modul: de nivel superior, nu pe pagina de start
    expect(cod).toContain("VALUES ('santiere_creare', NULL, 'Creare șantiere'")
  })
})

describe('20261222a — revenirea', () => {
  it('lock-uri NOWAIT înaintea verificării „niciun drept acordat”; scoate exact politica, funcția și cheia', () => {
    const iLock = REV.indexOf('LOCK TABLE public.sites IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iCheie = REV.indexOf("PERFORM 1 FROM public.app_modules WHERE key = 'santiere_creare' FOR UPDATE NOWAIT;")
    const iDrept = REV.indexOf("IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN")
    expect(iLock).toBeGreaterThan(0)
    expect(iCheie).toBeGreaterThan(iLock)
    expect(iDrept).toBeGreaterThan(iCheie)
    for (const d of ['DROP POLICY sites_insert_drept_creare ON public.sites;', 'DROP FUNCTION public.fn_sites_drept_creare(bigint);',
                     "DELETE FROM public.app_modules WHERE key = 'santiere_creare';"]) expect(REV).toContain(d)
    expect(fara(REV)).not.toMatch(/CASCADE|TRUNCATE|DELETE FROM public\.user_module_access/)
    expect(REV).toContain(`'${X}_sites_drept_creare_ROLLBACK:' || txid_current()`)
  })
})

describe('interfața: aceeași regulă ca BD-ul', () => {
  it('owner da; santiere_creare editor / admin da; viewer, alte chei (administrativ.locatii), can_manage_contracts singur: nu', () => {
    expect(CHEIE_SANTIERE_CREARE).toBe('santiere_creare')
    expect(poateCreaSantier(null)).toBe(false)
    expect(poateCreaSantier({ is_owner: true })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'editor' } })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'admin' } })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'viewer' } })).toBe(false)
    expect(poateCreaSantier({ module_access_levels: { 'administrativ.locatii': 'admin' } })).toBe(false)
    expect(poateCreaSantier({ can_manage_contracts: true, module_access_levels: { executie: 'admin' } })).toBe(false)
    expect(poateCreaSantier({ is_owner: 'true' })).toBe(false)
  })
  it('refuzul bazei (42501 / RLS) are mesaj clar; alte erori rămân erori', () => {
    expect(mesajRefuzSantier(null)).toBe(null)
    expect(mesajRefuzSantier({ code: '42501', message: 'new row violates row-level security policy for table "sites"' })).toMatch(/nu are dreptul „Creare șantiere”/)
    expect(mesajRefuzSantier({ code: 'PGRST301', message: 'JWT expired' })).toBe('Eroare la crearea șantierului: JWT expired')
  })
  it('Admin → Șantiere: formularul doar cu drept; redenumire / dezactivare / ștergere / depozite doar owner', () => {
    expect(APP).toContain("const tabsNonOwner = poateCreaSantier(profile) ? ['employees','semnaturi','sites'] : ['employees','semnaturi']")
    expect(APP).toContain('{poateCreaSantier(profile) ? (')
    expect(APP).toContain('{isSuperAdmin ? <>')
    expect(APP).toContain('{/* ═══════════ DEPOZITE MATERIALE (doar owner) ═══════════ */}\n        {isSuperAdmin && (')
    expect(APP).toContain("showToast(mesajRefuzSantier(error),'error')")
  })
  it('wizard: „Șantier nou” doar cu drept; șantierul se creează cu proiect_id în INSERT, fără UPDATE pe sites; legătura proiectului verificată', () => {
    expect(WIZ).toContain("...(poateCreaSantier ? [{ k:'nou', l:'🏗️ Șantier nou' }] : []),")
    expect(WIZ).toContain("useState(poateCreaSantier ? 'nou' : 'existent')")
    expect(WIZ).toContain('proiect_id: proiect.id })')
    expect(WIZ).not.toMatch(/from\('sites'\)\s*\.update/)
    expect(WIZ).toContain(".update({ site_id: site.id }).eq('id', proiect.id).select('id')")
  })
})
