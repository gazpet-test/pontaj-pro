// Clarificări automate pe tichete (20261223a): verificări statice ale livrării. Comportamentul: scripts/pglite/test_tichete_clarificari_local.mjs
// (PGlite) și scripts/tichete_clarificari_concurenta.mjs (clonă, două sesiuni).
// (1) L15 + L19: corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql, copiat octet cu octet (fără CR) în scriptul coordonatorului și
//     în migrare; închiderea (INCHIDERE_L15) o singură dată, identică în script și migrare; BASELINE într-un singur bloc marcat (DE_COMPLETAT).
// (2) Drepturile: niciun GRANT; REVOKE de la PUBLIC / anon / authenticated / service_role pe fiecare funcție; verificarea apelantului în cod.
// (3) Lock-ul rândului (L01 / L06), deduplicarea, limita de runde, textul fix (semnătura „Echipa ERP”, fără numele asistentului).
// (4) Revenirea poartă amprenta EXACTĂ a corpului fiecărei funcții create și refuză după folosire.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const SURSA = citeste('scripts/tichete_lot2_amprente.sql')
const SCRIPT = citeste('scripts/tichete_clarificari_amprente.sql')
const MIG = citeste('supabase/migrations/20261223a_tichete_clarificari.sql')
const REV = citeste('supabase/revenire/20261223a_tichete_clarificari_ROLLBACK.sql')
const DOC = citeste('docs/TICHETE_CLARIFICARI.md')
const X = '20261223a'
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
  if (i < 0) throw new Error('lipsește ' + fn)
  const a = MIG.indexOf('AS $f$', i) + 'AS $f$'.length
  return MIG.slice(a, MIG.indexOf('$f$;', a))
}
const FUNCTII = ['fn_tichet_clarificare_zile_lucratoare', 'fn_tichet_clarificare_intrebari_motiv', 'fn_tichet_clarificare_apelant_ok',
  'fn_tichet_clarificare_stare_tichet', 'fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie', 'fn_tichet_clarificare_stare']

describe('20261223a — AMPRENTA_L15: o singură definiție', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
  it('închiderea: un singur bloc, identic în script și în migrare, înaintea corpului v1; pornirea = triggerele scrierilor noastre', () => {
    const inch = blocuri(SCRIPT, IA, IB)
    expect(inch.length).toBe(1)
    expect(blocuri(MIG, IA, IB)).toEqual(inch)
    for (const t of [SCRIPT, MIG]) expect(t.indexOf(IB)).toBeLessThan(t.indexOf(A))
    expect(inch[0]).toContain("(tg.tgrelid = 'public.tichete'::regclass AND (tg.tgtype & 16) <> 0)")
    expect(inch[0]).toContain("(tg.tgrelid IN ('public.tichete_comentarii'::regclass, 'public.notifications'::regclass) AND (tg.tgtype & 4) <> 0)")
    // fără limită de adâncime, fără restricție la câteva scheme; cu dependențele din catalog și triggerele tabelelor scrise de lanț
    expect(inch[0]).not.toMatch(/adancime|regnamespace IN \(|'public'::regnamespace/)
    expect(inch[0]).toContain("WHERE d.classid = 'pg_proc'::regclass AND d.objid = l.oid")
    expect(inch[0]).toContain('(insert[[:space:]]+into|update|delete[[:space:]]+from)')
    expect(inch[0]).toContain('amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),')
  })
  it('intrarea: exact cele trei tabele în care scriem; aceeași în migrare; scriptul e doar citire', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.notifications'::regclass::oid), ('public.tichete'::regclass::oid), ('public.tichete_comentarii'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    // în afara comentariilor și a titlurilor \echo: nicio instrucțiune de scriere
    expect(SCRIPT.replace(/--[^\n]*/g, '').replace(/^\\echo[^\n]*/gm, '')).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/)
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
  it('pe lanț: EXECUTE dinamic / limbaj neanalizabil / DEFINER fără search_path = REFUZ; funcțiile noi cheamă doar una pe alta', () => {
    expect(MIG).toContain("RAISE EXCEPTION '20261223a: lantul scrierilor are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;")
    expect(MIG).toContain("RAISE EXCEPTION '20261223a: o functie SECURITY DEFINER din lantul scrierilor nu are search_path propriu';")
    expect(MIG).toContain("RAISE EXCEPTION '20261223a post: functiile noi cheama in afara lor: %'")
    expect(SCRIPT).toContain("'EXECUTE pe lant (migrarea refuza)'")
    // corpurile noi nu au cuvântul „execute” (nici în comentarii: poarta l-ar lua drept SQL dinamic)
    for (const f of FUNCTII) expect(corp(f), f).not.toMatch(/\bexecute\b/i)
  })
})

describe('20261223a — migrarea: garda, plafonul, drepturile, apelantul', () => {
  it('antet de versiune, gardă de start / final, plafon 2000 cerut, READ COMMITTED, lock NOWAIT cu buget, fără BEGIN / COMMIT', () => {
    expect(MIG.startsWith('-- Version 20261223120000. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${X}_tichete_clarificari:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain('LOCK TABLE public.notifications, public.tichete, public.tichete_comentarii IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;')
    expect(MIG).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('niciun GRANT; REVOKE de la toate rolurile API pe fiecare funcție; postcondiții pe fiecare rol', () => {
    expect(MIG.split('\n').filter(l => /^\s*GRANT /.test(l))).toEqual([])
    for (const f of FUNCTII) expect(MIG).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`))
    expect(MIG).toContain("FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP")
    // nu se creează tabele / politici / triggere; nu se scriu date în migrare
    expect(MIG.replace(/--[^\n]*/g, '')).not.toMatch(/CREATE (TABLE|POLICY|TRIGGER|VIEW)|ALTER TABLE/)
  })
  it('verificarea apelantului ÎN COD, la începutul fiecărei funcții expuse rutinei; identitatea nu vine din parametri / auth.uid()', () => {
    expect(corp('fn_tichet_clarificare_apelant_ok').trim()).toBe("SELECT session_user = 'postgres' AND current_setting('role') = 'none'")
    for (const f of ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie', 'fn_tichet_clarificare_stare']) {
      const c = corp(f)
      const i = c.indexOf('BEGIN\n')
      expect(c.slice(i, i + 80), f).toContain('IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN')
    }
    for (const f of FUNCTII) expect(corp(f), f).not.toMatch(/auth\.uid\(\)|request\.jwt|set_config/)
  })
  it('lock pe rândul tichetului ÎNAINTE de verificări; deduplicarea înaintea oricărei scrieri; limita de runde', () => {
    for (const f of ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie']) {
      const c = corp(f)
      const iLock = c.indexOf('FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;')
      expect(iLock, f).toBeGreaterThan(0)
      expect(c.indexOf('s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);'), f).toBeGreaterThan(iLock)
      expect(c.indexOf('INSERT INTO public.tichete_comentarii') === -1 || c.indexOf('INSERT INTO public.tichete_comentarii') > iLock, f).toBe(true)
    }
    const t = corp('fn_tichet_clarificare_trimite')
    expect(t).toContain('IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN')
    expect(t.indexOf("IF p_runda <= (s ->> 'runda')::integer THEN")).toBeLessThan(t.indexOf('INSERT INTO public.tichete_comentarii'))
    expect(t).toContain("IF p_runda = 2 AND (s ->> 'raspuns_autor')::boolean IS NOT TRUE THEN")
    // statusul tichetului nu se schimbă niciodată (doar metadata)
    for (const f of ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie']) {
      expect(corp(f).match(/UPDATE public\.tichete x SET [^\n]*/g), f).toEqual(["UPDATE public.tichete x SET metadata = coalesce(x.metadata, '{}'::jsonb) || jsonb_build_object('clarificari_erp', m) WHERE x.id = t.id;"])
    }
  })
  it('textul fix: șablonul din cerere, semnătura „Echipa ERP”, comentariul fără autor; fără numele asistentului', () => {
    const t = corp('fn_tichet_clarificare_trimite'), i = corp('fn_tichet_clarificare_incheie')
    expect(t).toContain("'Mesaj automat pentru clarificare. Nu reprezintă o aprobare de acces, modificare sau termen de realizare.'")
    expect(t).toContain("'Răspunde aici, pe tichet, fără parole sau date personale.' || chr(10) || 'Echipa ERP'")
    expect(i).toContain("'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. '")
    expect(i).toContain("'Acest mesaj nu confirmă implementarea sau un termen.' || chr(10) || 'Echipa ERP'")
    for (const c of [t, i]) expect(c).toContain('INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt)')
    expect(MIG + DOC).not.toMatch(/Rocky|Claude|Anthropic|\bAI\b|asistent(ul)? automat/i)
  })
  it('pragul de tăcere într-un singur loc (3 zile lucrătoare), ziua la București', () => {
    expect(nr(MIG, 'c_prag_tacere constant integer := 3;')).toBe(1)
    expect(corp('fn_tichet_clarificare_zile_lucratoare')).toContain("AT TIME ZONE 'Europe/Bucharest'")
  })
})

describe('20261223a — regulile validatorului runnerului cu plafon (scripts/livrare_validator.py)', () => {
  // verifica_plafon: pe textul BRUT (și comentariile), fără majuscule, și pe textul comprimat la [a-z0-9_], transaction_timeout / pg_settings
  // apar EXACT de câte ori apare citirea permisă; parametrii lexicali nicăieri; RESET ALL nicăieri
  const CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
  for (const [nume, text] of [['migrarea', MIG], ['revenirea', REV]]) {
    it(nume, () => {
      const permise = text.split(CITIRE).length - 1
      expect(permise).toBe(1)
      const mic = text.toLowerCase(), comprimat = mic.replace(/[^a-z0-9_]/g, '')
      for (const n of ['transaction_timeout', 'pg_settings']) {
        expect(mic.split(n).length - 1, n).toBe(permise)
        expect(comprimat.split(n).length - 1, n + ' (comprimat)').toBe(permise)
      }
      for (const p of ['standard_conforming_strings', 'client_encoding', 'escape_string_warning', 'backslash_quote']) expect(mic).not.toContain(p)
      expect(mic).not.toMatch(/(^|[^a-z0-9_$])reset[ \t\n\r\f\v]+all($|[^a-z0-9_$])/)
      expect(text).toContain("current_setting('gazpet.livrare_migrare', true)")
    })
  }
})

describe('20261223a — revenirea', () => {
  it('amprenta EXACTĂ a corpului fiecărei funcții create', () => {
    for (const [et, fn] of [['zile', 'fn_tichet_clarificare_zile_lucratoare'], ['intrebari', 'fn_tichet_clarificare_intrebari_motiv'],
      ['apelant', 'fn_tichet_clarificare_apelant_ok'], ['stare_tichet', 'fn_tichet_clarificare_stare_tichet'], ['trimite', 'fn_tichet_clarificare_trimite'],
      ['incheie', 'fn_tichet_clarificare_incheie'], ['stare', 'fn_tichet_clarificare_stare']]) {
      const m = REV.match(new RegExp(`-- AMPRENTA-START ${et}\\n\\s*'([0-9a-f]{32})'`))
      expect(m, et).toBeTruthy()
      expect(m[1], et).toBe(md5(corp(fn)))
    }
  })
  it('refuză după folosire, sub lock luat ÎNAINTE; gardă + plafon; scoate doar funcțiile, fără ștergeri de date', () => {
    const iLock = REV.indexOf('LOCK TABLE public.tichete IN EXCLUSIVE MODE NOWAIT;')
    const iDate = REV.indexOf("IF EXISTS (SELECT 1 FROM public.tichete x WHERE x.metadata -> 'clarificari_erp' IS NOT NULL) THEN")
    expect(iLock).toBeGreaterThan(0)
    expect(iDate).toBeGreaterThan(iLock)
    expect(REV).toContain(`'${X}_tichete_clarificari_ROLLBACK:' || txid_current()`)
    expect(REV).toContain("IS DISTINCT FROM '2000/session'")
    for (const f of FUNCTII) expect(REV).toMatch(new RegExp(`DROP FUNCTION public\\.${f}\\(`))
    expect(REV.replace(/--[^\n]*/g, '')).not.toMatch(/DELETE FROM|TRUNCATE|CASCADE|UPDATE public/)
  })
})

describe('docs/TICHETE_CLARIFICARI.md — textul pentru promptul rutinei', () => {
  it('blocul de lipit are 12–18 rânduri și folosește EXCLUSIV funcțiile din migrare', () => {
    const bloc = DOC.slice(DOC.indexOf('```text\n') + 8, DOC.indexOf('```', DOC.indexOf('```text\n') + 8)).trim().split('\n')
    expect(bloc.length).toBeGreaterThanOrEqual(12)
    expect(bloc.length).toBeLessThanOrEqual(18)
    const t = bloc.join('\n')
    for (const f of ['fn_tichet_clarificare_stare()', 'fn_tichet_clarificare_trimite(', 'fn_tichet_clarificare_incheie(']) expect(t).toContain(f)
  })
})
