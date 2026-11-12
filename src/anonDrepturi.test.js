// Drepturile rolului anon în public (20261218a / b / c): verificări statice ale livrării. Comportamentul (aplicare, reveniri, refuzuri,
// mutanți): scripts/pglite/test_anon_drepturi_local.mjs.
// (1) L19: regula (REGULA_ANON v1), agregatul (AGREGAT_ANON v1) și amprenta celorlalte roluri (ALTE_ROLURI v1) au O SINGURĂ definiție,
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
  const canonic = blocuri(citeste(CIT), 'REGULA_ANON v1')
  it('REGULA_ANON v1: o dată în citire și o dată în fiecare migrare, identic', () => {
    expect(canonic).toHaveLength(1)
    for (const k of 'abc') expect(blocuri(citeste(MIG[k]), 'REGULA_ANON v1'), MIG[k]).toEqual(canonic)
  })
  it('AGREGAT_ANON v1: o dată în citire și o dată în fiecare migrare, identic', () => {
    const ag = blocuri(citeste(CIT), 'AGREGAT_ANON v1')
    expect(ag).toHaveLength(1)
    for (const k of 'abc') expect(blocuri(citeste(MIG[k]), 'AGREGAT_ANON v1'), MIG[k]).toEqual(ag)
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
      expect(t).not.toMatch(/\|\|\s*[a-z_]+\.(relkind|defaclobjtype|polcmd)(?!::)/)
      expect(t).not.toMatch(/(relkind|defaclobjtype|polcmd)\s*\|\|/)
    }
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
  it('fără căi de pe server sau din rețea', () => {
    expect(d).not.toMatch(/[A-Za-z]:\\|\\\\|paw-data|Users\\|Users\//)
  })
})
