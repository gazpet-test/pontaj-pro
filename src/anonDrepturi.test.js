// Drepturile rolului anon în public (20261218a / b / c): verificări statice ale livrării. Comportamentul (aplicare, reveniri, refuzuri,
// mutanți): scripts/pglite/test_anon_drepturi_local.mjs.
// (1) L19: regula (REGULA_ANON v2), agregatul (AGREGAT_ANON v2) și amprenta celorlalte roluri (ALTE_ROLURI v1) au O SINGURĂ definiție,
//     copiată octet cu octet în scriptul coordonatorului, în migrări și în reveniri. (2) L15: BASELINE într-un singur bloc marcat, necompletat
//     în repo (= refuz). (3) Artefactele trec regulile validatorului runnerului cu plafon (scripts/livrare_validator.py; rulat și direct dacă
//     există Python). (4) Scriptul coordonatorului e doar citire. (5) Documentul pentru owner există și nu conține căi de pe server.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const CIT = 'scripts/anon_drepturi_citire.sql'
const MIG = { a: 'supabase/migrations/20261218a_securitate_anon_drepturi.sql', b: 'supabase/migrations/20261218b_securitate_anon_drepturi_tabele.sql',
  c: 'supabase/migrations/20261218c_securitate_anon_drepturi_implicite.sql' }
const REV = { a: 'supabase/revenire/20261218a_securitate_anon_drepturi_ROLLBACK.sql', b: 'supabase/revenire/20261218b_securitate_anon_drepturi_tabele_ROLLBACK.sql',
  c: 'supabase/revenire/20261218c_securitate_anon_drepturi_implicite_ROLLBACK.sql' }
const T = { a: 'T1', b: 'T2', c: 'T3' }
const blocuri = (t, nume) => {
  const a = `-- >>> ${nume}`, b = `-- <<< ${nume}`, out = []
  for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + 1)) out.push(t.slice(i, t.indexOf(b, i) + b.length))
  return out
}
// ce vede validatorul la nivel superior: fără comentarii, literali și corpuri $tag$…$tag$
const nivelSuperior = t => {
  let s = '', i = 0
  while (i < t.length) {
    if (t.startsWith('--', i)) { const j = t.indexOf('\n', i); i = j < 0 ? t.length : j; continue }
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(t.slice(i))
    if (m) { const j = t.indexOf(m[0], i + m[0].length); i = j + m[0].length; s += ' $corp$ '; continue }
    if (t[i] === "'") { const j = t.indexOf("'", i + 1); i = j + 1; s += " 'lit' "; continue }
    s += t[i++]
  }
  return s
}

describe('L19 — o singură definiție a regulii, a agregatului și a amprentei celorlalte roluri', () => {
  const canonic = blocuri(citeste(CIT), 'REGULA_ANON v2')
  it('REGULA_ANON v2: o dată în citire și o dată în fiecare migrare, identic', () => {
    expect(canonic).toHaveLength(1)
    for (const k of 'abc') expect(blocuri(citeste(MIG[k]), 'REGULA_ANON v2'), MIG[k]).toEqual(canonic)
  })
  it('AGREGAT_ANON v2: o dată în citire și o dată în fiecare migrare, identic', () => {
    const ag = blocuri(citeste(CIT), 'AGREGAT_ANON v2')
    expect(ag).toHaveLength(1)
    for (const k of 'abc') expect(blocuri(citeste(MIG[k]), 'AGREGAT_ANON v2'), MIG[k]).toEqual(ag)
  })
  it('ALTE_ROLURI v1: o dată în fiecare migrare, de două ori în fiecare revenire (înainte / după), identic', () => {
    const al = blocuri(citeste(MIG.a), 'ALTE_ROLURI v1')
    expect(al).toHaveLength(1)
    for (const k of 'bc') expect(blocuri(citeste(MIG[k]), 'ALTE_ROLURI v1')).toEqual(al)
    for (const k of 'abc') expect(blocuri(citeste(REV[k]), 'ALTE_ROLURI v1')).toEqual([al[0], al[0]])
  })
  it('pct. 1: lista obiectelor folosite de pagini publice e GOALĂ azi (orice rând nou = review nou)', () => {
    expect(canonic[0]).toContain("SELECT x.obiect, x.motiv FROM (VALUES (NULL::text, NULL::text)) x(obiect, motiv) WHERE x.obiect IS NOT NULL")
  })
  it('regula: T2 exclude tabelele cu politici pentru anon / PUBLIC; T1 păstrează secvențele tabelelor în care anon poate insera', () => {
    expect(canonic[0]).toContain("WHEN r.politici_anon > 0 THEN 'RAMANE'")
    expect(canonic[0]).toContain("pol.polpermissive AND pol.polcmd IN ('a', '*')")
    expect(canonic[0]).toContain("WHEN r.proprietar <> 'postgres' OR r.alt_acordant OR r.are_public THEN 'RAMANE'")
  })
  it('coloanele „char” sunt convertite explicit înainte de || (ambiguu pe producție, #1078)', () => {
    for (const t of [canonic[0], blocuri(citeste(MIG.a), 'ALTE_ROLURI v1')[0]]) {
      expect(t).not.toMatch(/\|\|\s*[a-z_]+\.(relkind|defaclobjtype|polcmd|ev_type|ev_enabled|polpermissive|is_instead|relrowsecurity|relforcerowsecurity)(?!::)/)
      expect(t).not.toMatch(/(relkind|defaclobjtype|polcmd|ev_type|ev_enabled|polpermissive|is_instead|relrowsecurity|relforcerowsecurity)\s*\|\|/)
    }
  })
  it('v2 (review #1081): amprenta cuprinde oid, RLS / FORCE, părinții, opțiunile, regulile, toate politicile, DEFAULT-urile; coloanele cu attnum:tip:typmod', () => {
    for (const s of ["'; oid=' || x.oid::text", "'; rls=' || x.rls", "'; parinti=' || x.parinti", "'; optiuni=' || x.optiuni", "'; reguli=' || x.reguli",
      "'; politici=' || x.politici", "'; implicite=' || x.implicite", 'rw.ev_action::text', 'pol.polqual::text', 'pol.polwithcheck::text', 'ad.adbin::text',
      "att.attnum::text || ':' || att.atttypid::text || ':' || att.atttypmod::text || ' ' || quote_ident(att.attname)"]) expect(canonic[0], s).toContain(s)
    // fără deparsare (ia lock-uri pe obiectele referite)
    expect(canonic[0].replace(/--[^\n]*/g, '')).not.toMatch(/pg_get_viewdef|pg_get_expr|pg_get_ruledef/)
  })
})

describe('r2 — cursa dintre calculul listei și REVOKE (review #1081 P1)', () => {
  const ordine = (t, ...frag) => { let i = -1; for (const f of frag) { const j = t.indexOf(f, i + 1); expect(j, f).toBeGreaterThan(i); i = j } }
  for (const [k, seq] of [['a', 'SEQUENCE'], ['b', 'TABLE']]) {
    it(`${MIG[k]}: jurnal -> blocare (santinelă, r4) -> dovada pe xmin -> recitire = jurnal -> ACL complet = instantaneu -> REVOKE FROM anon -> DROP ROLE`, () => {
      const t = citeste(MIG[k])
      ordine(t, `THEN pg_temp.anon_acl_20261218${k}(g.r_oid, false) END AS r_acl`, 'INSERT INTO securitate_intern.anon_revocari',
        `CREATE ROLE gazpet_santinela_20261218${k} NOLOGIN NOINHERIT;`, `EXECUTE 'REVOKE ALL ON ${seq} ' || v_lista || ' FROM gazpet_santinela_20261218${k}';`,
        "c.xmin::text IS DISTINCT FROM v_xid", 'blocarea randurilor din catalog nu s-a facut', `FROM pg_temp.anon_regula_20261218${k}() WHERE r_treapta = '${T[k]}') b`,
        'schimbare concurenta intre calculul listei si blocare', `pg_temp.anon_acl_20261218${k}(j.obiect_oid, false) IS DISTINCT FROM c.r_acl`,
        'ACL complet schimbat concurent', `EXECUTE 'REVOKE ALL ON ${seq} ' || v_lista || ' FROM anon';`, `DROP ROLE gazpet_santinela_20261218${k};`,
        `IS DISTINCT FROM c.r_acl_fara_anon`, 'ACL-ul complet nu difera EXACT prin intrarile lui anon din jurnal', `IF to_regrole('gazpet_santinela_20261218${k}') IS NOT NULL THEN RAISE EXCEPTION`)
    })
  }
  it('r4 (review r3 P1): blocarea NU mai e o retragere de la PUBLIC (ar consuma un drept dat concurent lui PUBLIC)', () => {
    for (const k of 'ab') expect(citeste(MIG[k])).not.toContain("|| v_lista || ' FROM PUBLIC'")
    expect(citeste(MIG.c)).not.toMatch(/REVOKE ALL ON (TABLES|SEQUENCES) FROM PUBLIC;/)
    // santinela: nume liber + CREATEROLE verificate în gărzile de start, înainte de orice scriere
    for (const k of 'abc') ordine(citeste(MIG[k]), `IF to_regrole('gazpet_santinela_20261218${k}') IS NOT NULL THEN`, 'CREATEROLE lipsa', 'END $pre$;')
  })
  it('ACL_COMPLET v1: o singură definiție, identică în a și b (L19)', () => {
    const x = blocuri(citeste(MIG.a), 'ACL_COMPLET v1')
    expect(x).toHaveLength(1)
    expect(blocuri(citeste(MIG.b), 'ACL_COMPLET v1')).toEqual(x)
    expect(x[0]).toContain("'obiect ' || x.it::text"); expect(x[0]).toContain("'coloana ' || a.attnum::text || ' ' || x.it::text")
  })
  it('r4 (review r3 P1, T2): ACCESS SHARE pe ținte ÎNAINTEA blocării; postcondiția „nicio politică pentru anon / PUBLIC pe obiectele din jurnal”', () => {
    const t = citeste(MIG.b)
    ordine(t, "SELECT string_agg('ONLY ' || format('%I.%I', n.nspname, c.relname)", "c.relkind IN ('r', 'p', 'v')",
      "EXECUTE 'LOCK TABLE ' || v_lock || ' IN ACCESS SHARE MODE';", 'CREATE ROLE gazpet_santinela_20261218b', "EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';",
      'JOIN pg_policy pol ON pol.polrelid = j.obiect_oid', "(0::oid = ANY (pol.polroles) OR 'anon'::regrole::oid = ANY (pol.polroles))",
      'cu politica pentru anon / PUBLIC (aparuta concurent sau regula gresita)')
    expect(t).toContain('Blocarea NU e „fără urme”')
  })
  it('b: după REVOKE, rândurile de coloane rescrise = exact cele cu drepturi la recitire (coloana neblocată)', () => {
    ordine(citeste(MIG.b), 'v_col := ARRAY(', "EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';", 'v_col_dupa := ARRAY(', 'a.xmin::text = v_xid',
      'IF v_col_dupa IS DISTINCT FROM v_col THEN', 'drepturi pe coloane schimbate concurent')
  })
  it('c: blocarea celor două rânduri din pg_default_acl (santinelă) + recitire + ACL complet, înaintea retragerii; postcondiția pe ACL complet', () => {
    ordine(citeste(MIG.c), "THEN pg_temp.anon_acl_implicit_20261218c(split_part(g.r_eticheta, ' ', 4), false) END AS r_acl",
      'CREATE ROLE gazpet_santinela_20261218c NOLOGIN NOINHERIT;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM gazpet_santinela_20261218c;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM gazpet_santinela_20261218c;', 'd.xmin::text = v_xid',
      'schimbare concurenta intre calculul listei si blocare', 'ACL complet schimbat concurent',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;', 'DROP ROLE gazpet_santinela_20261218c;',
      'drepturile implicite complete nu difera EXACT prin intrarile lui anon din jurnal')
  })
  it('comentariile nu mai promit „ACCESS SHARE pe fiecare țintă” și spun ce se detectează exact', () => {
    for (const k of 'abc') expect(citeste(MIG[k])).not.toMatch(/ia ACCESS SHARE pe fiecare/)
    for (const k of 'ab') expect(citeste(REV[k])).not.toMatch(/ia ACCESS SHARE pe fiecare/)
    for (const k of 'ab') expect(citeste(MIG[k])).toContain('NoLock')
    expect(citeste(MIG.a)).toContain('Ce se detectează EXACT')
    expect(citeste(MIG.b)).toContain('Ce se detectează EXACT')
  })
  it('proba cu două sesiuni pe clonă: gărzi de țintă (system_identifier, PG17, nu Supabase), scenariile și mutanții', () => {
    const p = citeste('scripts/anon_drepturi_concurenta.mjs')
    for (const s of ['pg_control_system()', 'process.exit(22)', "supabase\\.(co|com)", 'pg_blocking_pids', "wait_event = 'PgSleep'", 'SET transaction_timeout = 2000',
      'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7a', 'R7b', 'R7c', 'R8', 'R9', 'fara_recitire', 'fara_coloane', 'blocare_public', 'fara_lock', '1500',
      "rolname LIKE 'gazpet", 'iesire = 26']) expect(p, s).toContain(s)
    expect(p.startsWith('#!')).toBe(false)
  })
  it('proba cu două sesiuni: fiecare ancoră de instrumentare / mutant există EXACT o dată în migrarea ei', () => {
    const p = citeste('scripts/anon_drepturi_concurenta.mjs')
    const n = (k, s) => citeste(MIG[k]).split(s).length - 1
    for (const [k, s] of [['a', '-- ── jurnalul comun al treptelor (neexpus în API, doar postgres) ──'],
      ['b', '-- ── jurnal, blocarea rândurilor + recitirea, apoi UN SINGUR REVOKE pe lista din jurnal + verificarea coloanelor ──'],
      ['c', 'CREATE ROLE gazpet_santinela_20261218c NOLOGIN NOINHERIT;'], ['b', 'DROP FUNCTION pg_temp.anon_agregat_20261218b(), pg_temp.anon_regula_20261218b()'],
      ['c', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;'],
      ['a', "  EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM gazpet_santinela_20261218a';"],
      ['b', "  EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM gazpet_santinela_20261218b';"],
      ['c', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM gazpet_santinela_20261218c;'],
      ['b', "    EXECUTE 'LOCK TABLE ' || v_lock || ' IN ACCESS SHARE MODE';"],
      ['a', "  IF v_dif IS NOT NULL THEN\n    RAISE EXCEPTION '20261218a: ACL complet schimbat concurent"]]) {
      expect(n(k, s), `${k}: ${s.slice(0, 60)}`).toBe(1)
      expect(p, s.slice(0, 60)).toContain(s.replace(/\n/g, '\\n'))
    }
  })
})

describe('r2 — revenirea pe coloane (review #1081 P1)', () => {
  it('revenirea b verifică attnum + tip + typmod + nume ÎNAINTE de GRANT și dă dreptul pe coloana cu același attnum', () => {
    const t = citeste(REV.b)
    const i = t.indexOf('coloane schimbate dupa livrare'), g = t.indexOf("EXECUTE format('GRANT %s (%s) ON TABLE %s TO anon'")
    expect(i).toBeGreaterThan(0); expect(g).toBeGreaterThan(i)
    expect(t).toContain("regexp_match(col, '^(-?[0-9]+):([0-9]+):(-?[0-9]+) (.+) ([^ ]+)$')")
    expect(t).toContain('a.attnum = p.m[1]::smallint')
    expect(t).not.toContain("substring(col FROM '^(.*) [^ ]+$')")
  })
  it('revenirea a refuză un jurnal T1 cu coloane (secvențele nu au)', () => {
    expect(citeste(REV.a)).toContain('jurnalul T1 are drepturi pe coloane')
  })
})

describe('r2 — citirea: SIMULARE pe valori, CONTROL pentru RAMANE', () => {
  const t = citeste(CIT)
  it('SIMULARE citește valorile (nu EXISTS) și separă cele patru clase; așteptarea = 0 cu date citibile', () => {
    expect(t).not.toContain('SELECT EXISTS (SELECT 1 FROM')
    for (const s of ['GOL', 'AGREGAT_FARA_DATE', 'DATE_CITIBILE', 'EROARE', 'to_jsonb(anon_sim_q.*)', 'has_column_privilege(r.oid, a.attnum, \'SELECT\')',
      'relatii cu date citibile', 'Concluzia „zero date citibile” cere 0 DATE_CITIBILE, 0 AMBIGUU neconfirmate și 0 erori necunoscute']) expect(t, s).toContain(s)
  })
  it('r4 (review r3 P2): „un rând, doar zero / NULL” = AMBIGUU, confirmat din definiția vederii; concluzia cere 0 date + 0 ambigue', () => {
    const i = t.indexOf("v_clasa := 'DATE_CITIBILE';")
    expect(i).toBeGreaterThan(0)
    for (const s of ["IF r.tip = 'v' THEN", "rw.rulename = '_RETURN'", "v_clasa := 'AMBIGUU';", "v_clasa := 'AGREGAT_FARA_DATE';", "position(' :hasAggs true ' IN v_sus) > 0",
      "position(' :groupClause <> ' IN v_sus) > 0", "position(' :groupingSets <> ' IN v_sus) > 0", "position(' :havingQual <> ' IN v_sus) > 0",
      "position(' :setOperations <> ' IN v_sus) > 0", "position(' :hasTargetSRFs false ' IN v_sus) > 0", 'chr(92)'])
      expect(t.indexOf(s, i), s).toBeGreaterThan(i)
    expect(t).toContain("WHEN v_date = 0 AND v_ambiguu = 0 AND v_err_necunoscut = 0 THEN 'ZERO date citibile")
    // fără deparsare și fără backslash literal în citire
    expect(t.slice(i, t.indexOf('END $simulare$;'))).not.toMatch(/pg_get_viewdef|pg_get_ruledef/)
    expect(t).not.toContain('\\')
  })
  it('r4: STATISTICI sărită = LIPSĂ DE DOVADĂ, nu zero apeluri', () => {
    expect(t.split('LIPSA DE DOVADA (nu inseamna zero apeluri ca anon)').length - 1).toBe(2)
  })
  it('CONTROL = amprenta RAMANE; BASELINE doar T1 / T2 / T3', () => {
    expect(t).toContain("SELECT 'CONTROL', 2, 4, a.treapta")
    expect(t).toContain("FROM anon_agregat a WHERE a.treapta IN ('T1', 'T2', 'T3')")
    expect(blocuri(t, 'AGREGAT_ANON v2')[0]).toContain("(VALUES ('T1'), ('T2'), ('T3'), ('RAMANE'))")
  })
})

describe('L15 — BASELINE: un singur bloc marcat pe migrare, necompletat în repo', () => {
  for (const k of 'abc') {
    it(`${MIG[k]}: exact un rând ${T[k]} DE_COMPLETAT, comparat cu lista calculată`, () => {
      const t = citeste(MIG[k]), x = MIG[k].slice(20, 29)
      const bl = blocuri(t, `BASELINE ${x}`)
      expect(bl).toHaveLength(1)
      expect(bl[0]).toContain(`    ('${T[k]}', NULL::integer, 'DE_COMPLETAT')\n  ) v(treapta, obiecte, amprenta)`)
      expect(t.split('DE_COMPLETAT').length - 1).toBe(1)
      expect(t).toContain(`BASELINE necompletat sau invalid (randul ${T[k]}`)
      expect(t).toContain(`difera de BASELINE-ul revizuit`)
    })
  }
  it('citirea produce rândul de lipit exact în forma blocului', () => {
    expect(citeste(CIT)).toContain("format('    (%L, %s, %L)', a.treapta, a.obiecte, a.amprenta)")
  })
})

describe('validatorul runnerului cu plafon (scripts/livrare_validator.py)', () => {
  const CITIRE = "FROM pg_catalog.pg_settings WHERE name = 'transaction_timeout'"
  for (const f of [...Object.values(MIG), ...Object.values(REV)]) {
    it(`${f}: ceasul tranzacției doar citit, fără backslash / control de tranzacție / meta-comenzi, cu garda de livrare`, () => {
      const t = citeste(f), mic = t.toLowerCase(), comprimat = mic.replace(/[^a-z0-9_]/g, '')
      expect(t.split(CITIRE).length - 1).toBe(1)
      for (const n of ['transaction_timeout', 'pg_settings']) {
        expect(mic.split(n).length - 1, n).toBe(1)
        expect(comprimat.split(n).length - 1, n + ' (comprimat)').toBe(1)
      }
      expect(mic).not.toMatch(/(?<![a-z0-9_$])reset[ \t\n\r\f\v]+all(?![a-z0-9_$])/)
      expect(t).not.toContain('\\')
      for (const p of ['standard_conforming_strings', 'client_encoding', 'escape_string_warning', 'backslash_quote']) expect(mic).not.toContain(p)
      const sus = nivelSuperior(t)
      expect(sus).not.toMatch(/(^|;)\s*(BEGIN|START|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|COPY|RESET)\b/i)
      expect(sus).not.toMatch(/(^|;)\s*SET\b/i)
      expect(sus).not.toMatch(/:['"A-Za-z_{]/)
      expect(t).toContain("current_setting('gazpet.livrare_migrare', true)")
      expect(t).toMatch(/IS DISTINCT FROM '2000\/session'/)
    })
  }
  it('revenirile = un singur bloc DO (un refuz e singura instrucțiune care eșuează)', () => {
    for (const k of 'abc') expect(nivelSuperior(citeste(REV[k])).replace(/DO\s+\$corp\$\s*;/, '').trim(), REV[k]).toBe('')
  })
  it('validatorul real (dacă există Python pe mașină)', () => {
    const v = fileURLToPath(new URL('../scripts/livrare_validator.py', import.meta.url))
    for (const f of [...Object.values(MIG), ...Object.values(REV)]) {
      const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [v, fileURLToPath(new URL('../' + f, import.meta.url)), '--plafon-tranzactie'], { encoding: 'utf8' })
      if (r.error || /not found|was not found|nu a fost/i.test(r.stderr || '')) { console.log('validator Python: indisponibil, sărit'); return }
      expect(r.status, f + ': ' + r.stderr).toBe(0)
      expect(r.stdout).toMatch(/^OK \d+ instruc/)
    }
    console.log('validator Python: OK pe toate cele 6 artefacte')
  })
})

describe('ordinea și refuzurile cerute', () => {
  it('b și c cer jurnalul lui a; revenirea a refuză cât b / c au rânduri; reaplicarea = refuz', () => {
    expect(citeste(MIG.b)).toContain('(se aplica intai 20261218a)')
    expect(citeste(MIG.c)).toContain('(se aplica intai 20261218a)')
    expect(citeste(REV.a)).toContain('jurnalul are inca randuri 20261218b / 20261218c')
    expect(citeste(MIG.a)).toContain('schema securitate_intern exista deja (reaplicare')
    expect(citeste(MIG.b)).toContain("jurnalul are deja randuri 20261218b (reaplicare)")
  })
  it('un singur REVOKE pe lista din jurnal (a, b); T3 static pe ambele tipuri; nimic pentru alte roluri', () => {
    expect(citeste(MIG.a)).toContain("EXECUTE 'REVOKE ALL ON SEQUENCE ' || v_lista || ' FROM anon';")
    expect(citeste(MIG.b)).toContain("EXECUTE 'REVOKE ALL ON TABLE ' || v_lista || ' FROM anon';")
    expect(citeste(MIG.c)).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;')
    expect(citeste(MIG.c)).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;')
    // la nivel superior, alte roluri apar DOAR în retragerea de pe jurnal (a); restul instrucțiunilor numesc doar anon
    for (const k of 'abc') {
      const sus = nivelSuperior(citeste(MIG[k])).replace('REVOKE ALL ON TABLE securitate_intern.anon_revocari FROM PUBLIC, anon, authenticated, service_role;', '')
      expect(sus, MIG[k]).not.toMatch(/\b(authenticated|service_role)\b/)
    }
    for (const k of 'abc') expect(citeste(MIG[k])).toContain('drepturile altor roluri s-au schimbat')
  })
})

describe('scriptul coordonatorului: doar citire', () => {
  const t = citeste(CIT)
  it('tranzacție READ ONLY anulată, fără nicio scriere', () => {
    expect(t).toMatch(/\nBEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/)
    expect(t.trimEnd().endsWith('ROLLBACK;')).toBe(true)
    const sus = nivelSuperior(t)
    expect(sus).not.toMatch(/\b(INSERT|UPDATE|DELETE|GRANT|REVOKE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i)
  })
  it('are secțiunile cerute', () => {
    for (const s of ['CONTEXT', 'INVENTAR', 'OBIECT', 'BASELINE', 'RAMANE', 'RPC_PUBLIC', 'FUNCTII_ANON', 'POLITICI_ANON', 'SIMULARE', 'STATISTICI'])
      expect(t, s).toContain(s)
  })
})

describe('documentul pentru owner', () => {
  const d = citeste('docs/SECURITATE_ANON_DREPTURI.md')
  it('are treptele, riscul fiecăreia, recomandarea și pașii coordonatorului', () => {
    for (const s of ['T1', 'T2', 'T3', 'Recomandare', 'Ce se strică', 'Cum revenim', 'pct. 1']) expect(d, s).toContain(s)
  })
  it('r2: corectura „există acces direct” + condiția explicită pentru T2 (clientul fără interogări fără sesiune) + proba pe clonă PG17', () => {
    expect(d).toContain('EXISTĂ acces direct')
    expect(d).toContain('**Condiția pentru T2 (obligatorie):**')
    expect(d).toMatch(/T2 e câștigul principal, dar \*\*NU se aplică\*\*/)
    expect(d).not.toMatch(/Rezultat: niciun tabel, nicio vedere și nicio secvență nu e folosit direct de `anon`/)
    expect(d).not.toMatch(/iau doar ACCESS SHARE/)
    for (const s of ['scripts/anon_drepturi_concurenta.mjs', '1500 ms', 'PostgreSQL 17', '0 relații cu date citibile', 'CONTROL']) expect(d, s).toContain(s)
    expect(citeste(MIG.b)).toContain('T2 NU se aplică înainte ca PR-ul „client fără interogări fără sesiune” să fie pe producție')
  })
  it('fără căi de pe server sau din rețea', () => {
    expect(d).not.toMatch(/[A-Za-z]:\\|\\\\|paw-data|Users\\|Users\//)
  })
})
