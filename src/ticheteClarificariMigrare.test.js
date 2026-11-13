// Clarificări automate pe tichete (20261223a, r2): verificări statice ale livrării. Comportamentul: scripts/pglite/test_tichete_clarificari_local.mjs
// (PGlite) și scripts/tichete_clarificari_concurenta.mjs (clonă, două sesiuni).
// (1) L15 + L19: corpul AMPRENTA_L15 v1 din scripts/tichete_lot2_amprente.sql, copiat octet cu octet (fără CR) în scriptul coordonatorului și
//     în migrare; închiderea (INCHIDERE_L15) o singură dată, identică în script și migrare; BASELINE într-un singur bloc marcat (citirea din
//     producție, 13.11.2026).
// (2) Obiectele noi: tabelul de evidență (RLS, o politică SELECT, doar SELECT pentru authenticated) + 8 funcții (3 DEFINER); niciun alt
//     GRANT; REVOKE de la PUBLIC / anon / authenticated / service_role pe fiecare funcție; verificarea apelantului în cod.
// (3) Lock-ul rândului (L01 / L06), deduplicarea ÎNAINTEA contextului, contextul înaintea scrierii, limita de runde, instantaneul,
//     tichetul neatins, metadata necitită, textul fix (semnătura „Echipa ERP”, fără numele asistentului).
// (4) Revenirea poartă detaliul EXACT (cu md5 pe corp) al fiecărei funcții create și refuză după folosire.
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
  'fn_tichet_clarificare_context', 'fn_tichet_clarificare_stare_tichet', 'fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie',
  'fn_tichet_clarificare_stare']
const DEFINER = ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie', 'fn_tichet_clarificare_stare']
const faraComentarii = (t) => t.replace(/--[^\n]*/g, '')

describe('20261223a — AMPRENTA_L15: o singură definiție', () => {
  const canonic = blocuri(SURSA, A, B)[0]
  it('corpul canonic, o dată în script și o dată în migrare, identic', () => {
    expect(canonic).toBeTruthy()
    expect(blocuri(SCRIPT, A, B)).toEqual([canonic])
    expect(blocuri(MIG, A, B)).toEqual([canonic])
  })
  const IA = `-- >>> INCHIDERE_L15 ${X}`, IB = `-- <<< INCHIDERE_L15 ${X}`
  it('închiderea: un singur bloc, identic în script și în migrare, înaintea corpului v1; pornirea = triggerele scrierilor (+ UPDATE pe tichete, conservator)', () => {
    const inch = blocuri(SCRIPT, IA, IB)
    expect(inch.length).toBe(1)
    expect(blocuri(MIG, IA, IB)).toEqual(inch)
    for (const t of [SCRIPT, MIG]) expect(t.indexOf(IB)).toBeLessThan(t.indexOf(A))
    expect(inch[0]).toContain("(tg.tgrelid = 'public.tichete'::regclass AND (tg.tgtype & 16) <> 0)")
    expect(inch[0]).toContain("(tg.tgrelid IN ('public.tichete_comentarii'::regclass, 'public.notifications'::regclass) AND (tg.tgtype & 4) <> 0)")
    expect(inch[0]).not.toMatch(/adancime|regnamespace IN \(|'public'::regnamespace/)
    expect(inch[0]).toContain("WHERE d.classid = 'pg_proc'::regclass AND d.objid = l.oid")
    expect(inch[0]).toContain('(insert[[:space:]]+into|update|delete[[:space:]]+from)')
    expect(inch[0]).toContain('amp_functii_explicite(oid) AS (SELECT DISTINCT l.oid FROM amp_lant l),')
  })
  it('intrarea: cele trei tabele existente atinse; aceeași în migrare; scriptul e doar citire', () => {
    const intrare = SCRIPT.slice(SCRIPT.indexOf(`-- >>> INTRARE ${X}`), SCRIPT.indexOf(`-- <<< INTRARE ${X}`))
    const tab = intrare.split('\n').find(l => l.startsWith('amp_tabele('))
    expect(tab).toBe("amp_tabele(oid) AS (VALUES ('public.notifications'::regclass::oid), ('public.tichete'::regclass::oid), ('public.tichete_comentarii'::regclass::oid)),")
    expect(MIG.split('\n').filter(l => l.startsWith('amp_tabele('))).toEqual([tab])
    expect(SCRIPT).toMatch(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/)
    expect(SCRIPT.trim().endsWith('ROLLBACK;')).toBe(true)
    expect(SCRIPT.replace(/--[^\n]*/g, '').replace(/^\\echo[^\n]*/gm, '')).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/)
    expect(SCRIPT).not.toContain('clarificari_erp')
  })
  it('BASELINE într-un singur loc marcat: citirea din producție (30 de etichete: 12 funcții + 3 tabele x 6), toate md5; verificat înainte ȘI după', () => {
    expect(nr(MIG, `-- >>> BASELINE ${X}`)).toBe(1)
    expect(nr(MIG, `-- <<< BASELINE ${X}`)).toBe(1)
    const bloc = MIG.slice(MIG.indexOf(`-- >>> BASELINE ${X}`), MIG.indexOf(`-- <<< BASELINE ${X}`))
    expect(bloc).toContain(`CREATE FUNCTION pg_temp.amp_baseline_${X}()`)
    const linii = bloc.split('\n').map(l => l.trim()).filter(l => /^(, )?\('/.test(l))
    expect(linii.length).toBe(30)
    expect(linii.every(l => /^(, )?\('(tabel [^']+|functie [^']+)', '[0-9a-f]{32}'\)$/.test(l))).toBe(true)
    expect(linii.filter(l => l.includes("'functie ")).length).toBe(12)
    for (const t of ['notifications', 'tichete', 'tichete_comentarii']) {
      for (const k of ['acl', 'acl coloane', 'politici', 'rls', 'secvente', 'triggere']) expect(linii.some(l => l.includes(`'tabel ${t} | ${k}'`)), `${t} ${k}`).toBe(true)
    }
    expect(bloc).not.toContain('DE_COMPLETAT')
    expect(MIG).toContain(`DO $l15_inainte$ BEGIN PERFORM pg_temp.amp_verifica_${X}('inainte'); END $l15_inainte$;`)
    expect(MIG).toContain(`PERFORM pg_temp.amp_verifica_${X}('dupa');`)
    expect(MIG).toContain("b.amprenta !~ '^[0-9a-f]{32}$'")
  })
  it('pe lanț: EXECUTE dinamic / limbaj neanalizabil / DEFINER fără search_path = REFUZ; funcțiile noi cheamă doar una pe alta (8)', () => {
    expect(MIG).toContain("RAISE EXCEPTION '20261223a: lantul scrierilor are EXECUTE dinamic / limbaj neanalizabil (amprenta statica imposibila): %', v_exec;")
    expect(MIG).toContain("RAISE EXCEPTION '20261223a: o functie SECURITY DEFINER din lantul scrierilor nu are search_path propriu';")
    expect(MIG).toContain("RAISE EXCEPTION '20261223a post: functiile noi cheama in afara lor: %'")
    expect(MIG).toContain("AND p.proname LIKE 'fn\\_tichet\\_clarificare\\_%') <> 8 THEN")
    expect(SCRIPT).toContain("'EXECUTE pe lant (migrarea refuza)'")
    for (const f of FUNCTII) expect(corp(f), f).not.toMatch(/\bexecute\b/i)
  })
})

describe('20261223a — migrarea: garda, plafonul, obiectele noi, drepturile, apelantul', () => {
  it('antet de versiune, gardă de start / final, plafon 2000 cerut, READ COMMITTED, lock NOWAIT cu buget, fără BEGIN / COMMIT', () => {
    expect(MIG.startsWith('-- Version 20261223120000. NEAPLICAT.')).toBe(true)
    expect(nr(MIG, `'${X}_tichete_clarificari:' || txid_current()`)).toBe(2)
    expect(MIG).toContain("IS DISTINCT FROM '2000/session'")
    expect(MIG).toContain('LOCK TABLE public.notifications, public.tichete, public.tichete_comentarii IN SHARE UPDATE EXCLUSIVE MODE NOWAIT;')
    expect(MIG).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m)
  })
  it('obiectele noi: UN tabel (tichete_clarificari), un index unic, RLS, O politică SELECT; nimic pe tabelele existente', () => {
    const cod = faraComentarii(MIG)
    expect(cod.match(/CREATE TABLE [^\s(]+/g)).toEqual(['CREATE TABLE public.tichete_clarificari'])
    expect(cod.match(/CREATE UNIQUE INDEX \S+ ON \S+/g)).toEqual(['CREATE UNIQUE INDEX tichete_clarificari_o_incheiere ON public.tichete_clarificari'])
    expect(cod.match(/ALTER TABLE [^\n;]+/g)).toEqual(['ALTER TABLE public.tichete_clarificari ENABLE ROW LEVEL SECURITY'])
    expect(cod.match(/CREATE POLICY [^\n;]+/g)).toEqual(['CREATE POLICY tichete_clarificari_select ON public.tichete_clarificari FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)'])
    // fără triggere / vederi / înlocuiri și fără cheie străină (migrarea nu ia lock de scriere pe tichete)
    expect(cod).not.toMatch(/CREATE (TRIGGER|VIEW|OR REPLACE)|FORCE ROW LEVEL|\bREFERENCES\s+\w+\.\w+\s*\(/)
    // cheia de deduplicare (L16) și o singură încheiere pe tichet
    expect(MIG).toContain('CONSTRAINT tichete_clarificari_cheie PRIMARY KEY (tichet_id, fel, runda),')
    expect(MIG).toContain("CREATE UNIQUE INDEX tichete_clarificari_o_incheiere ON public.tichete_clarificari (tichet_id) WHERE fel IN ('incheiere', 'clarificat');")
    // fără textul întrebărilor în evidență
    const tabel = MIG.slice(MIG.indexOf('CREATE TABLE public.tichete_clarificari ('), MIG.indexOf(');', MIG.indexOf('CREATE TABLE public.tichete_clarificari (')))
    expect(tabel).not.toMatch(/intrebari\s+text|text\[\]/)
  })
  it('drepturi: un SINGUR GRANT (SELECT pe evidență pentru authenticated); REVOKE de la toate rolurile API pe tabel și pe fiecare funcție; postcondiții pe fiecare rol și drept', () => {
    expect(MIG.split('\n').filter(l => /^\s*GRANT /.test(l))).toEqual(['GRANT SELECT ON TABLE public.tichete_clarificari TO authenticated;'])
    expect(MIG).toContain('REVOKE ALL ON TABLE public.tichete_clarificari FROM PUBLIC, anon, authenticated, service_role;')
    for (const f of FUNCTII) expect(MIG).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`))
    expect(MIG).toContain("FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP")
    expect(MIG).toContain("FOREACH v_drept IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP")
    expect(MIG).toContain("a.privilege_type, ', ')\n                             FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) = 'postgres:EXECUTE') THEN")
  })
  it('exact 3 funcții SECURITY DEFINER (cele apelate de rutină); restul INVOKER', () => {
    for (const f of FUNCTII) {
      const i = MIG.indexOf(`CREATE FUNCTION public.${f}(`)
      const antet = MIG.slice(i, MIG.indexOf('AS $f$', i))
      expect(antet.includes('SECURITY DEFINER'), f).toBe(DEFINER.includes(f))
      expect(antet, f).toContain('SET search_path = public, pg_temp')
    }
    expect(MIG).toContain('8 funcții, dintre care 3 SECURITY DEFINER')
  })
  it('verificarea apelantului ÎN COD, la începutul fiecărei funcții DEFINER; identitatea nu vine din parametri / auth.uid(); limita scrisă în antet', () => {
    expect(corp('fn_tichet_clarificare_apelant_ok').trim()).toBe("SELECT session_user = 'postgres' AND current_setting('role') = 'none'")
    for (const f of DEFINER) {
      const c = corp(f)
      const i = c.indexOf('BEGIN\n')
      expect(c.slice(i, i + 80), f).toContain('IF public.fn_tichet_clarificare_apelant_ok() IS NOT TRUE THEN')
    }
    for (const f of FUNCTII) expect(corp(f), f).not.toMatch(/auth\.uid\(\)|request\.jwt|set_config/)
    expect(MIG).toContain('LIMITA EXACTĂ: verificarea')
    expect(MIG).toMatch(/identifică SESIUNILE postgres de pe server \(conectorul rutinei, psql-ul coordonatorului, joburile pg_cron/)
    expect(MIG).toContain('NU rutina anume')
  })
  it('lock pe rândul tichetului ÎNAINTE de verificări; deduplicarea înaintea contextului; contextul înaintea oricărei scrieri', () => {
    for (const f of ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie']) {
      const c = corp(f)
      const iLock = c.indexOf('FROM public.tichete x WHERE x.id = p_tichet_id FOR NO KEY UPDATE;')
      const iStare = c.indexOf('s := public.fn_tichet_clarificare_stare_tichet(p_tichet_id);')
      const iCtx = c.indexOf("IF (s ->> 'versiune_context') IS DISTINCT FROM p_versiune_context THEN")
      const iDedup = f.endsWith('trimite') ? c.indexOf("IF p_runda <= (s ->> 'runda')::integer THEN") : c.indexOf("IF s ->> 'faza' IN ('incheiat', 'clarificat') THEN")
      const iScriere = Math.min(...['INSERT INTO public.tichete_comentarii', 'INSERT INTO public.tichete_clarificari'].map(s => c.indexOf(s)).filter(x => x >= 0))
      expect(iLock, f).toBeGreaterThan(0)
      expect(iStare, f).toBeGreaterThan(iLock)
      expect(iDedup, f).toBeGreaterThan(iStare)
      expect(iCtx, f).toBeGreaterThan(iDedup)
      expect(iScriere, f).toBeGreaterThan(iCtx)
      expect(nr(c, "'motiv', 'context_schimbat'"), f).toBe(1)
      expect(c, f).toContain("IF p_versiune_context IS NULL OR p_versiune_context !~ '^[0-9a-f]{32}$' THEN")
    }
    const t = corp('fn_tichet_clarificare_trimite')
    expect(t).toContain('IF p_runda IS NULL OR p_runda NOT IN (1, 2) THEN')
    expect(t).toContain("IF p_runda = 2 AND (s ->> 'raspuns_autor')::boolean IS NOT TRUE THEN")
  })
  it('tichetul NU se modifică și metadata nu se citește pentru protocol; răspunsul = instantaneul, nu data / ordinea id-urilor', () => {
    for (const f of FUNCTII) expect(faraComentarii(corp(f)), f).not.toMatch(/UPDATE\s+public\.tichete\b|clarificari_erp/)
    expect(MIG).not.toContain('clarificari_erp')
    const s = corp('fn_tichet_clarificare_stare_tichet')
    expect(s).toContain('WHERE c.tichet_id = t.id AND c.autor = t.deschis_de AND NOT (c.id = ANY (ru.instantaneu_autor));')
    expect(s).toContain('AND NOT (c.id = ANY (rf.instantaneu_autor))')
    expect(faraComentarii(s)).not.toMatch(/c\.created_at\s*[<>]|c\.id\s*[<>]/)
    expect(s).toContain('v_zile := public.fn_tichet_clarificare_zile_lucratoare(ru.creat_la, now());')
    for (const f of ['fn_tichet_clarificare_trimite', 'fn_tichet_clarificare_incheie']) {
      expect(corp(f), f).toContain("SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}') INTO v_inst FROM public.tichete_comentarii c WHERE c.tichet_id = t.id AND c.autor = t.deschis_de;")
    }
    // contextul: titlu, descriere și TOATE comentariile (id, autor, text) ordonate după id
    const ctx = corp('fn_tichet_clarificare_context')
    expect(ctx).toContain("'titlu', x.titlu, 'descriere', x.descriere,")
    expect(ctx).toContain('jsonb_agg(jsonb_build_array(c.id, c.autor, c.text) ORDER BY c.id)')
  })
  it('filtrul întrebărilor: „@”, domenii fără schemă, regula „litere.litere/”, cifre cu paranteze / plus și cifre late', () => {
    const q = corp('fn_tichet_clarificare_intrebari_motiv')
    expect(q).toContain("strpos(q.t, '@') > 0")
    expect(q).toMatch(/\[\[:alnum:\]_-\]\\\.\(ro\|com\|net\|org\|eu\|/)
    expect(q).toContain("q.t ~ '[[:alpha:]]\\.[[:alpha:]]+/'")
    expect(q).toContain("~ '[0-9]([^[:alnum:],;:]{0,2}[0-9]){8,}'")
    expect(q).toContain("chr(65296) || '-' || chr(65305)")
    // ordinea motivelor: „@” înaintea adreselor web (o adresă de e-mail are și un domeniu)
    expect(q.indexOf("'adresa_email'")).toBeLessThan(q.indexOf("'url'"))
  })
  it('textul fix: șablonul din cerere, semnătura „Echipa ERP”, comentariul fără autor; fără numele asistentului', () => {
    const t = corp('fn_tichet_clarificare_trimite'), i = corp('fn_tichet_clarificare_incheie')
    expect(t).toContain("'Mesaj automat pentru clarificare. Nu reprezintă o aprobare de acces, modificare sau termen de realizare.'")
    expect(t).toContain("'Răspunde aici, pe tichet, fără parole sau date personale.' || chr(10) || 'Echipa ERP'")
    expect(i).toContain("'Clarificările automate s-au încheiat. Tichetul rămâne deschis și ajunge la conducere împreună cu discuția. '")
    expect(i).toContain("'Acest mesaj nu confirmă implementarea sau un termen.' || chr(10) || 'Echipa ERP'")
    for (const c of [t, i]) expect(c).toContain('INSERT INTO public.tichete_comentarii (tichet_id, autor, text) VALUES (t.id, NULL, v_txt)')
    // (lista terminațiilor de domeniu din filtru conține „ai”, ca domeniu; scoasă înainte de căutare)
    expect(MIG.replace(/\(ro\|com\|[^)]*\)/, '(TLD)') + DOC).not.toMatch(/Rocky|Claude|Anthropic|\bAI\b|asistent(ul)? automat/i)
  })
  it('pragul de tăcere într-un singur loc (3 zile lucrătoare), ziua la București', () => {
    expect(nr(MIG, 'c_prag_tacere constant integer := 3;')).toBe(1)
    expect(corp('fn_tichet_clarificare_zile_lucratoare')).toContain("AT TIME ZONE 'Europe/Bucharest'")
  })
})

describe('20261223a — regulile validatorului runnerului cu plafon (scripts/livrare_validator.py)', () => {
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
  it('detaliul EXACT al fiecărei funcții create: md5 pe corp + proprietățile din migrare', () => {
    for (const [et, fn, definer, volatil] of [['zile', 'fn_tichet_clarificare_zile_lucratoare', false, 's'], ['intrebari', 'fn_tichet_clarificare_intrebari_motiv', false, 'i'],
      ['apelant', 'fn_tichet_clarificare_apelant_ok', false, 's'], ['context', 'fn_tichet_clarificare_context', false, 's'],
      ['stare_tichet', 'fn_tichet_clarificare_stare_tichet', false, 's'], ['trimite', 'fn_tichet_clarificare_trimite', true, 'v'],
      ['incheie', 'fn_tichet_clarificare_incheie', true, 'v'], ['stare', 'fn_tichet_clarificare_stare', true, 's']]) {
      const m = REV.match(new RegExp(`-- DETALIU-START ${et}\\n\\s*'([^\\n]*)'\\n\\s*-- DETALIU-END ${et}`))
      expect(m, et).toBeTruthy()
      const det = m[1]
      expect(det, et).toMatch(new RegExp(`^tip=f, limbaj=(sql|plpgsql), definer=${definer}, volatil=${volatil}, proprietar=postgres, config=search_path=public, pg_temp, intoarce=.+, acl=postgres:EXECUTE, corp_md5=[0-9a-f]{32}$`))
      expect(det.slice(-32), et).toBe(md5(corp(fn)))
    }
  })
  it('refuză după folosire (rânduri în evidență / comentarii automate), sub lock luat ÎNAINTE; gardă + plafon; scoate funcțiile și tabelul, fără ștergeri de date', () => {
    const iLock = REV.indexOf('LOCK TABLE public.tichete_clarificari IN ACCESS EXCLUSIVE MODE NOWAIT;')
    const iDate = REV.indexOf('IF EXISTS (SELECT 1 FROM public.tichete_clarificari) THEN')
    expect(iLock).toBeGreaterThan(0)
    expect(REV.indexOf('LOCK TABLE public.tichete_comentarii IN SHARE MODE NOWAIT;')).toBeGreaterThan(iLock)
    expect(iDate).toBeGreaterThan(iLock)
    expect(REV.indexOf('DROP TABLE public.tichete_clarificari;')).toBeGreaterThan(iDate)
    expect(REV).toContain(`'${X}_tichete_clarificari_ROLLBACK:' || txid_current()`)
    expect(REV).toContain("IS DISTINCT FROM '2000/session'")
    for (const f of FUNCTII) expect(REV).toMatch(new RegExp(`DROP FUNCTION public\\.${f}\\(`))
    expect(faraComentarii(REV)).not.toMatch(/DELETE FROM|TRUNCATE|CASCADE|UPDATE public/)
    expect(REV).not.toContain('clarificari_erp')
  })
})

describe('docs/TICHETE_CLARIFICARI.md — textul pentru promptul rutinei', () => {
  const bloc = DOC.slice(DOC.indexOf('```text\n') + 8, DOC.indexOf('```', DOC.indexOf('```text\n') + 8)).trim().split('\n')
  const t = bloc.join('\n')
  it('blocul de lipit are 12–20 de rânduri și folosește EXCLUSIV funcțiile din migrare, cu versiune_context', () => {
    expect(bloc.length).toBeGreaterThanOrEqual(12)
    expect(bloc.length).toBeLessThanOrEqual(20)
    for (const f of ['fn_tichet_clarificare_stare()', 'fn_tichet_clarificare_trimite(', 'fn_tichet_clarificare_incheie(']) expect(t).toContain(f)
    expect(t).toContain('versiune_context')
    expect(t).toContain('context_schimbat')
  })
  it('citirea completă a firului: descrierea + TOATE comentariile (după id), numărate față de count(*), lungimea față de length(text); incomplet = nimic trimis; incert = la owner', () => {
    expect(t).toMatch(/TOATE comentariile/)
    expect(t).toContain('ORDER BY id')
    expect(t).toContain('count(*)')
    expect(t).toContain('length(text)')
    expect(t).toMatch(/nu trimiți nimic/)
    expect(t).toMatch(/incert[^\n]*owner/i)
  })
})
