// Dreptul de a crea un șantier, pe cont (TKT-2026-0359, 20261222a, runda 2): verificări statice ale livrării + logica din interfață.
// (1) L15 + L19: corpul AMPRENTA_L15 v1 copiat octet cu octet (fără CR) din scripts/tichete_lot2_amprente.sql în scriptul coordonatorului și în
//     migrare; închiderea (INCHIDERE_L15) identică în script și migrare; BASELINE într-un singur bloc marcat (DE_COMPLETAT = refuz).
// (2) Amprenta corpului RPC-ului: aceeași în migrare („după”) și în revenire, egală cu md5 pe corpul real.
// (3) Nicio politică nouă (INSERT direct rămâne al owner-ului); RPC cu parametri limitați, ordinea legătură → INSERT, drepturi explicite;
//     migrarea nu acordă dreptul nimănui. Scheletul probei: politicile lui executie_proiecte = șabloanele din 20261209a.
// (4) Interfața: regula de cont (owner sau santiere_creare + executie editor / admin), clasificarea răspunsului (refuz / indisponibil / eroare
//     determinată / necunoscut), reconcilierea din BD și reîncercarea idempotentă, mesajele fără fals succes; wizard-ul și Admin-ul o folosesc.
// Comportamentul pe BD (matricea, fluxul wizard-ului, combinațiile de livrare, revenire, mutanți): scripts/pglite/test_sites_drept_creare_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { poateCreaSantier, mesajRefuzSantier, CHEIE_SANTIERE_CREARE, RPC_SANTIER, clasificaRaspuns, creeazaSantier, mesajSantier } from './lib/santiereDrept.js'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/sites_drept_creare_amprente.sql')
const MIG = citeste('supabase/migrations/20261222a_sites_drept_creare.sql')
const REV = citeste('supabase/revenire/20261222a_sites_drept_creare_ROLLBACK.sql')
const SCHELET = citeste('supabase/tests/20261222a_sites_drept_creare_schelet.sql')
const ACCES = citeste('supabase/migrations/20261209a_executie_acces_proiect.sql')
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
  const i = MIG.indexOf('CREATE FUNCTION public.fn_sites_creeaza(')
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
  it('închiderea: un singur bloc, identic în script și în migrare; pornirea = auth.uid() + fn_executie_proiect_permis + RPC-ul nou', () => {
    const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
    const inch = blocuri(SCRIPT, IA, IB)
    expect(inch.length).toBe(1)
    expect(blocuri(MIG, IA, IB)).toEqual(inch)
    expect(inch[0]).toContain("to_regprocedure('auth.uid()')")
    expect(inch[0]).toContain("to_regprocedure('public.fn_executie_proiect_permis(bigint, boolean)')")
    expect(inch[0]).toContain("to_regprocedure('public.fn_sites_creeaza(text, bigint, text)')")
    expect(inch[0]).toContain('amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),')
  })
  it('intrarea: tabelul sites, aceeași în script și în migrare; scriptul e doar citire', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (SELECT 'public.sites'::regclass::oid),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(fara(SCRIPT)).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|COMMIT)\b/im)
  })
  it('BASELINE într-un singur loc; până la lipire DOAR rândul DE_COMPLETAT; verificat înainte ȘI după', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii).toEqual(["('DE_COMPLETAT', 'DE_COMPLETAT')"])
    expect(MIG).toContain(`DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_${X}('inainte'); END $l15_inainte$;`)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('dupa');`)
    expect(MIG).toContain("b.amprenta !~ '^[0-9a-f]{32}$'")
    // triggerul de proiect automat, pe care se sprijină ordinea din RPC, trebuie să fie în baseline
    expect(MIG).toContain("b.eticheta = 'functie fn_auto_create_executie_proiect()'")
  })
  it('amprenta corpului RPC-ului: aceeași în „după” și în revenire, egală cu corpul real; fără caractere de control', () => {
    const h = md5(corp())
    expect(MIG).toContain(`|| 'corp_md5=${h}'`)
    expect(detaliuRev()).toContain(`, corp_md5=${h}, `)
    expect([...corp()].filter(c => c.charCodeAt(0) < 32 && c !== '\n')).toEqual([])
  })
})

// detaliul acceptat „după” de migrare (literalele concatenate din amp_verifica_20261222a) și cel cerut de revenire (runda 3, P2-2)
const literale = t => [...fara(t).matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")).join('')
const detaliuMig = () => { const i = MIG.indexOf('    IF v_fn IS DISTINCT FROM '); return literale(MIG.slice(i + '    IF v_fn IS DISTINCT FROM '.length, MIG.indexOf(' THEN', i))) }
const detaliuRev = () => { const m = REV.match(/-- DETALIU-DUPA-START rpc\n\s*'([^'\n]*)'\n\s*-- DETALIU-DUPA-END rpc/); return m ? m[1] : null }
const linii = t => t.split('\n').map(l => l.trim()).filter(Boolean)
describe('20261222a — revenirea: starea exactă = detaliul acceptat „după” de migrare (runda 3, P2-2)', () => {
  it('constanta din revenire = detaliul „după” din migrare, cu ACL-ul întreg (doar authenticated + proprietarul)', () => {
    expect(detaliuMig()).toMatch(/^tip=f, limbaj=plpgsql, definer=true, .*, acl=authenticated:EXECUTE, postgres:EXECUTE, corp_md5=[0-9a-f]{32}, sqlbody_md5=-$/)
    expect(detaliuRev()).toBe(detaliuMig())
    expect(nr(REV, '-- DETALIU-DUPA-START rpc')).toBe(1)
  })
  it('expresia detaliului din revenire = expresia rândului „functie” din AMPRENTA_L15 v1 (L19), linie cu linie', () => {
    const canonic = blocuri(SURSA, A, B)[0]
    const i = canonic.indexOf("           'tip=' || p.prokind::text")
    const j = canonic.indexOf("'-')\n", canonic.indexOf("|| ', sqlbody_md5=' ||", i)) + 4
    const expr = canonic.slice(i, j)
    expect(expr).toMatch(/', acl=' \|\| coalesce\(/)
    const k = REV.indexOf('-- >>> DETALIU_FUNCTIE'), l = REV.indexOf('-- <<< DETALIU_FUNCTIE')
    expect(k).toBeGreaterThan(0)
    const rev = linii(REV.slice(REV.indexOf('\n', k) + 1, l))
    expect(rev[0].startsWith('SELECT ')).toBe(true)
    expect([rev[0].slice('SELECT '.length), ...rev.slice(1)]).toEqual(linii(expr))
    // calculată pe funcția exactă (semnătura), într-o variabilă comparată cu IS DISTINCT FROM (lipsă = NULL = refuz)
    expect(REV).toContain("FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('public.fn_sites_creeaza(text, bigint, text)');")
    expect(REV).toContain('    IF v_det IS DISTINCT FROM\n')
  })
  it('rândul cheii de modul: aceleași valori ca INSERT-ul migrării', () => {
    const ins = MIG.slice(MIG.indexOf("VALUES ('santiere_creare', NULL, "), MIG.indexOf(';', MIG.indexOf("VALUES ('santiere_creare', NULL, ")))
    const rand = REV.slice(REV.indexOf('-- RAND-CHEIE-START'), REV.indexOf('-- RAND-CHEIE-END'))
    expect(literale(rand.slice(rand.indexOf('\n')))).toBe(literale(ins).replace(/^santiere_creare/, ''))
    expect(rand).toMatch(/\(NULL::text, 'Creare șantiere'/)
    expect(rand.replace(/\s+/g, ' ')).toMatch(/', true, false\) $/)
    expect(ins.replace(/\s+/g, ' ')).toMatch(/', true, false\)$/)
  })
})

describe('20261222a — migrarea: exact dreptul cerut, printr-un RPC', () => {
  it('antet NEAPLICAT, gardă de start / final, plafon 2000, lock NOWAIT cu buget, fără BEGIN / COMMIT', () => {
    expect(MIG.startsWith('-- Version 20261222120000. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${X}_sites_drept_creare:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain('LOCK TABLE public.sites IN SHARE MODE NOWAIT;')
    expect(MIG).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('nicio politică creată / schimbată: INSERT / UPDATE / DELETE direct rămân ale owner-ului', () => {
    const cod = fara(MIG)
    expect(cod).not.toMatch(/CREATE POLICY|ALTER POLICY|DROP POLICY|ALTER TABLE/)
  })
  it('preflight: secvența lui sites, fără cheie străină pe executie_proiecte.site_id, triggerul de proiect automat exact', () => {
    expect(MIG).toContain("pg_get_serial_sequence('public.sites', 'id') IS NULL")
    expect(MIG).toContain("c.conrelid = 'public.executie_proiecte'::regclass AND c.contype = 'f' AND a.attname = 'site_id'")
    expect(MIG).toContain("tg.tgtype = 5 AND tg.tgenabled = 'O'")
    expect(MIG).toContain('AND tg.tgnargs = 0 AND tg.tgqual IS NULL AND NOT tg.tgisinternal')
  })
  it('RPC-ul: identitatea din auth.uid() (L08), cheile exacte + Execuție editor / admin, proiectul la scriere (L09), parametri limitați', () => {
    const p = corp()
    expect(MIG).toContain('CREATE FUNCTION public.fn_sites_creeaza(p_nume text, p_proiect bigint, p_beneficiar text) RETURNS jsonb\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$')
    expect(p).toContain('v_uid uuid := auth.uid();')
    expect(p).toContain("WHERE u.profile_id = v_uid AND u.module = 'santiere_creare' AND u.access_level IN ('editor', 'admin'))")
    expect(p).toContain("WHERE u.profile_id = v_uid AND u.module = 'executie' AND u.access_level IN ('editor', 'admin'))))")
    expect(p).toContain('OR public.fn_executie_proiect_permis(p_proiect, true) IS NOT TRUE THEN')
    expect(p).not.toMatch(/administrativ\.locatii|can_manage_contracts|LIKE|request\.jwt|current_user|set_config/)
    expect(p).not.toMatch(/\bexecute\b/i)
    // ce scrie: DOAR nume / activ / beneficiar / proiect (+ id-ul din secvență); restul coloanelor rămân implicite
    const ins = p.match(/INSERT INTO public\.sites \([^)]*\)/g)
    expect(ins).toEqual(['INSERT INTO public.sites (name, active, beneficiar_principal)', 'INSERT INTO public.sites (id, name, active, beneficiar_principal, proiect_id)'])
  })
  it('RPC-ul: proiectul blocat întâi, legătura ÎNAINTEA rândului din sites (fără proiect automat), postcondiția unicității, idempotent', () => {
    const p = corp()
    const iLock = p.indexOf('WHERE e.id = p_proiect FOR UPDATE;')
    const iIdem = p.indexOf("RETURN jsonb_build_object('site_id', v_leg, 'creat', false);")
    const iSeq = p.indexOf("v_site := nextval(pg_get_serial_sequence('public.sites', 'id'));")
    const iUpd = p.indexOf('UPDATE public.executie_proiecte SET site_id = v_site WHERE id = p_proiect;')
    const iIns = p.indexOf('INSERT INTO public.sites (id, name')
    const iPost = p.indexOf('IF v_n IS DISTINCT FROM 1')
    expect(iLock).toBeGreaterThan(0)
    expect(iIdem).toBeGreaterThan(iLock)
    expect(iSeq).toBeGreaterThan(iIdem)
    expect(iUpd).toBeGreaterThan(iSeq)
    expect(iIns).toBeGreaterThan(iUpd)
    expect(iPost).toBeGreaterThan(iIns)
  })
  it('drepturile explicite: REVOKE de la toți, EXECUTE doar authenticated; migrarea nu acordă dreptul nimănui', () => {
    const cod = fara(MIG)
    expect(cod.split('\n').filter(l => /^GRANT /.test(l))).toEqual(['GRANT EXECUTE ON FUNCTION public.fn_sites_creeaza(text, bigint, text) TO authenticated;'])
    expect(cod).toContain('REVOKE ALL ON FUNCTION public.fn_sites_creeaza(text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;')
    expect(cod).not.toMatch(/INSERT INTO public\.user_module_access/)
    expect(cod).toContain("IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN")
    expect(cod).toContain("VALUES ('santiere_creare', NULL, 'Creare șantiere'")
  })
})

describe('20261222a — scheletul probei: RLS-ul real pe executie_proiecte', () => {
  it('politicile RESTRICTIVE = șabloanele din 20261209a (clasa proiect, cheia id), garda pe id', () => {
    const [cit, scr] = [ACCES.match(/v_cit := format\('(\(SELECT public\.fn_executie_acces_nerestrans\(\)\) OR public\.fn_executie_proiect_permis\(%I::bigint, false\))', r\.cheie\);/)[1],
                        ACCES.match(/v_scr := format\('(\(SELECT public\.fn_executie_acces_nerestrans\(\)\) OR public\.fn_executie_proiect_permis\(%I::bigint, true\))', r\.cheie\);/)[1]].map(s => s.replace(/%I/g, 'id'))
    expect(SCHELET).toContain(`CREATE POLICY executie_acces_citire ON public.executie_proiecte AS RESTRICTIVE FOR SELECT TO authenticated USING (${cit});`)
    expect(SCHELET).toContain(`CREATE POLICY executie_acces_adauga ON public.executie_proiecte AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (${scr});`)
    expect(SCHELET).toContain(`CREATE POLICY executie_acces_modifica ON public.executie_proiecte AS RESTRICTIVE FOR UPDATE TO authenticated USING (${scr}) WITH CHECK (${scr});`)
    expect(SCHELET).toContain(`CREATE POLICY executie_acces_sterge ON public.executie_proiecte AS RESTRICTIVE FOR DELETE TO authenticated USING (${scr});`)
    expect(SCHELET).toContain("EXECUTE FUNCTION public.fn_executie_acces_garda('id');")
    expect(ACCES).toContain("('tabel', 'executie_proiecte', 'proiect', 'id', NULL::text, 'proiectul însuși'),")
  })
  it('triggerul de proiect automat: corpurile copiate din producție (md5-ul îl verifică proba PGlite), triggerul AFTER INSERT', () => {
    expect(SCHELET).toContain('CREATE OR REPLACE FUNCTION public.fn_auto_create_executie_proiect()')
    expect(SCHELET).toContain('IF EXISTS (SELECT 1 FROM executie_proiecte WHERE site_id = NEW.id) THEN')
    expect(SCHELET).toContain('CREATE TRIGGER tr_auto_create_executie_proiect AFTER INSERT ON public.sites FOR EACH ROW EXECUTE FUNCTION public.fn_auto_create_executie_proiect();')
  })
})

describe('20261222a — revenirea', () => {
  it('lock NOWAIT pe cheie înaintea verificării „niciun drept acordat”; scoate exact funcția și cheia', () => {
    const iCheie = REV.indexOf("PERFORM 1 FROM public.app_modules WHERE key = 'santiere_creare' FOR UPDATE NOWAIT;")
    const iDrept = REV.indexOf("IF EXISTS (SELECT 1 FROM public.user_module_access WHERE module = 'santiere_creare') THEN")
    expect(iCheie).toBeGreaterThan(0)
    expect(iDrept).toBeGreaterThan(iCheie)
    for (const d of ['DROP FUNCTION public.fn_sites_creeaza(text, bigint, text);', "DELETE FROM public.app_modules WHERE key = 'santiere_creare';"]) expect(REV).toContain(d)
    expect(fara(REV)).not.toMatch(/CASCADE|TRUNCATE|DELETE FROM public\.user_module_access|DELETE FROM public\.sites|POLICY/)
    expect(REV).toContain(`'${X}_sites_drept_creare_ROLLBACK:' || txid_current()`)
  })
})

// ── interfața ──
// client fals tip supabase-js: răspunsurile RPC și ale citirilor, în ordine; jurnalul apelurilor
function clientFals({ rpc = [], citiri = [] } = {}) {
  const jurnal = []
  return {
    jurnal,
    rpc: async (fn, args) => { jurnal.push(['rpc', fn, args]); const r = rpc.shift(); if (r instanceof Error) throw r; return r },
    from: (t) => ({ select: (c) => ({ eq: (k, v) => ({ maybeSingle: async () => { jurnal.push(['citire', t, c, k, v]); return citiri.shift() } }) }) }),
  }
}
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } }

describe('interfața: regula de cont = cea din BD', () => {
  it('owner da; santiere_creare editor / admin + executie editor / admin da; orice altă combinație nu', () => {
    expect(CHEIE_SANTIERE_CREARE).toBe('santiere_creare')
    expect(RPC_SANTIER).toBe('fn_sites_creeaza')
    expect(poateCreaSantier(null)).toBe(false)
    expect(poateCreaSantier({ is_owner: true })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'editor', executie: 'editor' } })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'admin', executie: 'admin' } })).toBe(true)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'editor' } })).toBe(false)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'editor', executie: 'viewer' } })).toBe(false)
    expect(poateCreaSantier({ module_access_levels: { santiere_creare: 'viewer', executie: 'editor' } })).toBe(false)
    expect(poateCreaSantier({ module_access_levels: { 'administrativ.locatii': 'admin', executie: 'admin' } })).toBe(false)
    expect(poateCreaSantier({ can_manage_contracts: true, module_access_levels: { executie: 'admin' } })).toBe(false)
    expect(poateCreaSantier({ is_owner: 'true' })).toBe(false)
  })
  it('INSERT direct refuzat (calea owner-ului din Admin): mesaj clar; alte erori rămân erori', () => {
    expect(mesajRefuzSantier(null)).toBe(null)
    expect(mesajRefuzSantier({ code: '42501', message: 'new row violates row-level security policy for table "sites"' })).toMatch(/nu are dreptul „Creare șantiere”/)
    expect(mesajRefuzSantier({ code: 'PGRST301', message: 'JWT expired' })).toBe('Eroare la crearea șantierului: JWT expired')
  })
})

describe('interfața: răspunsul RPC-ului (L05 / L18)', () => {
  it('clasificarea: ok doar cu id + creat; funcția lipsă; refuz; eroare determinată (cod din bază / PostgREST); necunoscut (fără cod / fără id)', () => {
    expect(clasificaRaspuns({ data: { site_id: 7, creat: true }, error: null })).toEqual({ tip: 'ok', siteId: 7, creat: true })
    expect(clasificaRaspuns({ data: { site_id: 7, creat: false }, error: null })).toEqual({ tip: 'ok', siteId: 7, creat: false })
    expect(clasificaRaspuns({ data: null, error: null }).tip).toBe('necunoscut')
    expect(clasificaRaspuns({ data: { site_id: '7', creat: true }, error: null }).tip).toBe('ok')
    expect(clasificaRaspuns({ data: { site_id: 0, creat: true }, error: null }).tip).toBe('necunoscut')
    expect(clasificaRaspuns({ data: { site_id: 7 }, error: null }).tip).toBe('necunoscut')
    expect(clasificaRaspuns({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })).toEqual({ tip: 'indisponibil' })
    expect(clasificaRaspuns({ data: null, error: { code: '42883', message: 'function does not exist' } })).toEqual({ tip: 'indisponibil' })
    expect(clasificaRaspuns({ data: null, error: { code: '42501', message: 'x' } })).toEqual({ tip: 'refuz' })
    expect(clasificaRaspuns({ data: null, error: { code: 'P0001', message: 'proiectul are deja alt șantier legat' } })).toEqual({ tip: 'eroare', mesaj: 'proiectul are deja alt șantier legat' })
    expect(clasificaRaspuns({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).tip).toBe('eroare')
    expect(clasificaRaspuns({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }).tip).toBe('eroare')
    expect(clasificaRaspuns(RETEA).tip).toBe('necunoscut')
    expect(clasificaRaspuns({ data: null, error: { message: '<html>504 Gateway Time-out</html>' } }).tip).toBe('necunoscut')
    expect(clasificaRaspuns(undefined).tip).toBe('necunoscut')
  })
  it('cu proiect, răspuns pierdut: recitește starea din BD; legat în ambele sensuri = creat (verificat), fără al doilea apel', async () => {
    const c = clientFals({ rpc: [RETEA], citiri: [{ data: { site_id: 9 }, error: null }, { data: { id: 9, proiect_id: 5 }, error: null }] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5, beneficiar: null })
    expect(r).toEqual({ tip: 'ok', siteId: 9, creat: false, verificat: true })
    expect(c.jurnal.filter(x => x[0] === 'rpc').length).toBe(1)
    expect(c.jurnal[0]).toEqual(['rpc', 'fn_sites_creeaza', { p_nume: 'S', p_proiect: 5, p_beneficiar: null }])
  })
  it('cu proiect, nelegat după răspuns pierdut: reapelează O dată cu ACEIAȘI parametri', async () => {
    const c = clientFals({ rpc: [new Error('Failed to fetch'), { data: { site_id: 11, creat: true }, error: null }], citiri: [{ data: { site_id: null }, error: null }] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5, beneficiar: 'B' })
    expect(r).toEqual({ tip: 'ok', siteId: 11, creat: true })
    const apeluri = c.jurnal.filter(x => x[0] === 'rpc')
    expect(apeluri.length).toBe(2)
    expect(apeluri[1]).toEqual(apeluri[0])
  })
  it('legat de șantierul ALTUI proiect: nu e succes', async () => {
    const c = clientFals({ rpc: [RETEA, RETEA], citiri: [{ data: { site_id: 9 }, error: null }, { data: { id: 9, proiect_id: 6 }, error: null },
                                                       { data: { site_id: 9 }, error: null }, { data: { id: 9, proiect_id: 6 }, error: null }] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
    expect(r.tip).toBe('necunoscut')
    expect(mesajSantier(r).ok).toBe(false)
  })
  // runda 3 (Jakarinos r2, P2-1): primul apel ambiguu → eșecul determinat al reîncercării NU înlocuiește incertitudinea; decide doar
  // reconcilierea finală din BD
  const REFUZ = { data: null, error: { code: '42501', message: 'Crearea șantierului: contul nu are dreptul' } }
  const DISPARUT = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
  const CITIRE_PICATA = { data: null, error: { message: 'TypeError: Failed to fetch' } }
  it('scenariul Jak: commit + răspuns pierdut, recitirea picată, dreptul retras → 42501, recitirea finală picată = NECUNOSCUT, nu „fără șantier”', async () => {
    const c = clientFals({ rpc: [RETEA, REFUZ], citiri: [CITIRE_PICATA, CITIRE_PICATA] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
    expect(r.tip).toBe('necunoscut')
    expect(r.motiv).toMatch(/nu s-a putut verifica/)
    const m = mesajSantier(r)
    expect(m.ok).toBe(false)
    expect(m.text).not.toMatch(/fără șantier/)
    expect(m.text).toMatch(/Nu se știe dacă șantierul s-a creat/)
    // reconcilierea finală a fost încercată: 2 apeluri RPC + 2 citiri ale proiectului
    expect(c.jurnal.map(x => x[0])).toEqual(['rpc', 'citire', 'rpc', 'citire'])
  })
  it('la fel cu funcția dispărută între apeluri (PGRST202): necunoscut, nu „nu e încă disponibilă … fără șantier”', async () => {
    const c = clientFals({ rpc: [RETEA, DISPARUT], citiri: [CITIRE_PICATA, CITIRE_PICATA] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
    expect(r.tip).toBe('necunoscut')
    expect(mesajSantier(r).text).not.toMatch(/fără șantier|nu e încă disponibilă/)
  })
  it('reconcilierea finală găsește șantierul (primul apel scrisese) → ok verificat, chiar dacă reîncercarea a fost refuzată', async () => {
    for (const r2 of [REFUZ, DISPARUT, { data: null, error: { code: 'P0001', message: 'x' } }]) {
      const c = clientFals({ rpc: [RETEA, r2], citiri: [CITIRE_PICATA, { data: { site_id: 9 }, error: null }, { data: { id: 9, proiect_id: 5 }, error: null }] })
      const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
      expect(r).toEqual({ tip: 'ok', siteId: 9, creat: false, verificat: true })
      expect(mesajSantier(r).ok).toBe(true)
    }
  })
  // runda 4 (Jakarinos r3, P2): „nelegat” la reconcilierea finală NU dovedește eșecul — prima cerere poate fi încă în lucru
  it('reconcilierea finală vede proiectul NElegat după un refuz / funcție lipsă / eroare: tot NECUNOSCUT, fără „fără șantier”', async () => {
    for (const [r2, re] of [[REFUZ, /reîncercarea: refuzată de baza de date/], [DISPARUT, /reîncercarea: funcția nu e disponibilă/],
                            [{ data: null, error: { code: 'P0001', message: 'proiectul are deja alt șantier legat' } }, /reîncercarea: eroare: proiectul are deja/],
                            [RETEA, /reîncercarea: TypeError: Failed to fetch/]]) {
      const c = clientFals({ rpc: [RETEA, r2], citiri: [CITIRE_PICATA, { data: { site_id: null }, error: null }] })
      const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
      expect(r.tip).toBe('necunoscut')
      expect(r.verificat).toBeUndefined()
      expect(r.motiv).toMatch(re)
      expect(r.motiv).toMatch(/prima cerere poate fi încă în lucru/)
      const m = mesajSantier(r)
      expect(m.ok).toBe(false)
      expect(m.text).not.toMatch(/fără șantier|nu e încă disponibilă|refuzat crearea/)
      expect(m.text).toMatch(/Nu se știe dacă șantierul s-a creat .*Verifică în editarea proiectului înainte să creezi altul/)
    }
  })
  // Reproducerea lui Jak, cu o ordine controlată: un „server” fals cu starea proiectului; prima cerere TRECE de verificarea dreptului, apoi
  // „așteaptă lock-ul” (răspunsul se pierde la client), dreptul e retras, reîncercarea primește 42501, citirea finală vede site_id = NULL,
  // iar DUPĂ ce clientul a terminat, prima cerere continuă și face COMMIT (proiectul ajunge legat).
  function serverCuPrimaInCurs() {
    const st = { drept: true, siteId: null, santiere: [], ramas: null }
    const rpc = async (fn, args) => {
      if (!st.drept) return REFUZ
      if (st.siteId != null) return { data: { site_id: st.siteId, creat: false }, error: null }
      // autorizarea a trecut; scrierea rămâne în așteptare (lock-ul proiectului), răspunsul nu mai ajunge la client
      st.ramas = () => { st.siteId = 77; st.santiere.push({ id: 77, proiect_id: args.p_proiect }) }
      st.drept = false // dreptul retras (comis) înainte de reîncercare
      throw new Error('TypeError: Failed to fetch')
    }
    const from = (t) => ({ select: () => ({ eq: (k, v) => ({ maybeSingle: async () => {
      if (t === 'executie_proiecte') return { data: { site_id: st.siteId }, error: null }
      return { data: st.santiere.find(s => s.id === v) || null, error: null }
    } }) }) })
    return { st, client: { rpc, from } }
  }
  it('scenariul Jak r3: prima cerere încă în lucru, reîncercarea refuzată, citirea finală NULL → NECUNOSCUT; apoi prima face COMMIT', async () => {
    const { st, client } = serverCuPrimaInCurs()
    const r = await creeazaSantier(client, { nume: 'S', proiectId: 5 })
    st.ramas() // prima cerere își termină tranzacția DUPĂ ce clientul a afișat rezultatul
    expect(st.siteId).toBe(77) // șantierul există: un mesaj „fără șantier” ar fi fost fals
    expect(r.tip).toBe('necunoscut')
    const m = mesajSantier(r)
    expect(m.ok).toBe(false)
    expect(m.text).not.toMatch(/Proiectul s-a creat fără șantier/)
    expect(m.text).toMatch(/Nu se știe dacă șantierul s-a creat/)
  })
  it('mutantul (regula din r3: „nelegat” + reîncercare refuzată = eșec verificat) PICĂ pe reproducerea lui Jak', async () => {
    const SRC = readFileSync(new URL('./lib/santiereDrept.js', import.meta.url), 'utf8').replace(/\r/g, '')
    const din = "  if (fin.tip === 'ok') return fin\n"
    expect(nr(SRC, din)).toBe(1)
    const mut = SRC.replace(din, din + "  if (fin.tip === 'nelegat' && r2.tip !== 'necunoscut') return { ...r2, verificat: true }\n")
    // modulul nu are importuri: mutantul se încarcă direct din text (fără fișier temporar), cu exporturile întoarse explicit
    expect(/^import /m.test(SRC)).toBe(false)
    const M = new Function(mut.replace(/^export /gm, '') + '\nreturn { creeazaSantier, mesajSantier }')()
    const { st, client } = serverCuPrimaInCurs()
    const r = await M.creeazaSantier(client, { nume: 'S', proiectId: 5 })
    st.ramas()
    // mutantul dă exact defectul raportat: refuz „verificat” + „Proiectul s-a creat fără șantier”, deși șantierul a fost comis
    expect(r).toEqual({ tip: 'refuz', verificat: true })
    expect(M.mesajSantier(r).text).toMatch(/Proiectul s-a creat fără șantier/)
    expect(st.siteId).toBe(77)
    // originalul încărcat la fel (controlul metodei) și originalul importat: necunoscut pe același scenariu
    const O = new Function(SRC.replace(/^export /gm, '') + '\nreturn { creeazaSantier, mesajSantier }')()
    expect((await O.creeazaSantier(serverCuPrimaInCurs().client, { nume: 'S', proiectId: 5 })).tip).toBe('necunoscut')
    expect((await creeazaSantier(serverCuPrimaInCurs().client, { nume: 'S', proiectId: 5 })).tip).toBe('necunoscut')
  })
  it('legat de șantierul ALTUI proiect la reconcilierea finală, după un refuz: necunoscut, nu eșec confirmat', async () => {
    const c = clientFals({ rpc: [RETEA, REFUZ], citiri: [CITIRE_PICATA, { data: { site_id: 9 }, error: null }, { data: { id: 9, proiect_id: 6 }, error: null }] })
    const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
    expect(r.tip).toBe('necunoscut')
    expect(mesajSantier(r).text).not.toMatch(/fără șantier/)
  })
  it('fără proiect (Admin): fără reconciliere și fără reîncercare (un al doilea apel ar crea alt șantier)', async () => {
    const c = clientFals({ rpc: [RETEA] })
    const r = await creeazaSantier(c, { nume: 'S' })
    expect(r.tip).toBe('necunoscut')
    expect(c.jurnal.length).toBe(1)
    expect(mesajSantier(r, { cuProiect: false }).text).toMatch(/Verifică lista înainte să încerci din nou/)
  })
  it('refuzul / funcția lipsă / eroarea determinată: fără reîncercare, mesaj de eșec (ok = false)', async () => {
    for (const [raspuns, re] of [[{ data: null, error: { code: '42501', message: 'x' } }, /refuzat crearea șantierului/],
                                 [{ data: null, error: { code: 'PGRST202', message: 'x' } }, /nu e încă disponibilă/],
                                 [{ data: null, error: { code: 'P0001', message: 'proiectul are deja alt șantier legat' } }, /Șantierul nu s-a creat: proiectul are deja alt șantier legat/]]) {
      const c = clientFals({ rpc: [raspuns] })
      const r = await creeazaSantier(c, { nume: 'S', proiectId: 5 })
      expect(c.jurnal.length).toBe(1)
      const m = mesajSantier(r)
      expect(m.ok).toBe(false)
      expect(m.text).toMatch(re)
      expect(m.text).toMatch(/Proiectul s-a creat fără șantier/)
    }
  })
  it('mesajele de succes doar pentru ok', () => {
    expect(mesajSantier({ tip: 'ok', siteId: 1, creat: true })).toEqual({ ok: true, text: '🏗️ șantier nou creat' })
    expect(mesajSantier({ tip: 'ok', siteId: 1, creat: false, verificat: true }).ok).toBe(true)
    expect(mesajSantier({ tip: 'ok', siteId: 1, creat: false }).text).toMatch(/exista deja/)
    expect(mesajSantier({ tip: 'necunoscut', motiv: 'x' }).ok).toBe(false)
    expect(mesajSantier(undefined).ok).toBe(false)
  })
})

describe('interfața: wizard-ul și Admin-ul folosesc RPC-ul', () => {
  it('wizard: „Șantier nou” doar cu drept; un singur apel creeazaSantier cu proiect.id; nicio scriere directă în sites', () => {
    expect(WIZ).toContain("...(poateCreaSantier ? [{ k:'nou', l:'🏗️ Șantier nou' }] : []),")
    expect(WIZ).toContain("useState(poateCreaSantier ? 'nou' : 'existent')")
    expect(WIZ).toContain("const r = await creeazaSantier(supabase, { nume: siteNumeEfectiv, proiectId: proiect.id, beneficiar: f.beneficiar.trim() || null })")
    expect(WIZ).toContain('pasi.push(mesajSantier(r, { cuProiect: true }).text)')
    expect(WIZ).not.toMatch(/from\('sites'\)\s*\.(insert|update|upsert)/)
    expect(WIZ).not.toMatch(/\.update\(\{ site_id/)
  })
  it('Admin → Șantiere: owner = INSERT direct (ca azi); contul cu drept = RPC fără proiect; redenumire / dezactivare / ștergere / depozite doar owner', () => {
    expect(APP).toContain("if (isSuperAdmin) { const {error}=await supabase.from('sites').insert({name:siteName.trim(),active:true});")
    expect(APP).toContain('const m=mesajSantier(await creeazaSantier(supabase,{nume:siteName.trim()}),{cuProiect:false});')
    expect(APP).toContain("const tabsNonOwner = poateCreaSantier(profile) ? ['employees','semnaturi','sites'] : ['employees','semnaturi']")
    expect(APP).toContain('{poateCreaSantier(profile) ? (')
    expect(APP).toContain('{isSuperAdmin ? <>')
    expect(APP).toContain('{/* ═══════════ DEPOZITE MATERIALE (doar owner) ═══════════ */}\n        {isSuperAdmin && (')
  })
})
