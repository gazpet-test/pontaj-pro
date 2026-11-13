// L15 v2 (docs/LIVRARE_L15_V2.md): verificari statice ale blocului AMPRENTA_GLOBALA v2, ale pasilor runnerului, ale citirii
// coordonatorului, ale comparatorului de liste si ale regulii L15.
// Comportamentul (familii, mutanti, manifest, contraexemplele, regula DEFINER): scripts/pglite/test_amprenta_globala_local.mjs;
// forma runnerului: scripts/test_livrare_l15_forma.sh; paritatea cu main: scripts/test_livrare_l15_paritate.sh;
// PostgreSQL 17 real: scripts/test_livrare_l15_v2.sh. Comparatorul de liste (doar bash): rulat aici, daca exista bash.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const BLOC = citeste('scripts/amprenta_globala_v2.sql')
const LIB = citeste('scripts/livrare_amprenta.sh')
const RUN = citeste('scripts/livrare_migrare.sh')
const CIT = citeste('scripts/amprenta_globala_citire.sh')
const MAN = citeste('scripts/livrare_l15_manifest.sh')
const CMP = citeste('scripts/l15_compara_liste.sh')
const DOC = citeste('docs/LIVRARE_L15_V2.md')
const LECTII = citeste('docs/paw/LECTII_REVIEW.md')
const VERIF = citeste('scripts/test_livrare_mesaj_unic.py')
const DRY = citeste('scripts/portal/dry_prod_e1.sh')
const IGN = citeste('.gitignore')
const sectiune = (t, m) => {
  const linii = t.split('\n'), a = linii.indexOf(`-- >>> ${m}`), b = linii.indexOf(`-- <<< ${m}`)
  return a >= 0 && b > a && linii.lastIndexOf(`-- >>> ${m}`) === a && linii.lastIndexOf(`-- <<< ${m}`) === b ? linii.slice(a + 1, b).join('\n') : null
}
const CAT = sectiune(BLOC, 'AG_CATALOG v2')
const SES = sectiune(BLOC, 'AG_SESIUNE v2')
// familiile = primul literal al fiecarei ramuri din ag_rand (+ sesiune din AG_SESIUNE)
const FAMILII = [...new Set([...CAT.matchAll(/SELECT '([a-z_]+)', '\1 /g)].map(m => m[1]))].concat(['sesiune'])
// ramura unei familii / etichete: de la „SELECT 'fam', 'eticheta” pana la urmatorul UNION ALL
const ramura = (fam, et = fam) => { const i = CAT.indexOf(`SELECT '${fam}', '${et} `); return i < 0 ? null : CAT.slice(i, CAT.indexOf('UNION ALL', i) < 0 ? undefined : CAT.indexOf('UNION ALL', i)) }

describe('AMPRENTA_GLOBALA v2 — blocul unic (L19)', () => {
  it('marcajele v2 exista exact o data; v1 nu mai exista; fisierul e ASCII si fara backslash', () => {
    expect(CAT).not.toBeNull()
    expect(SES).not.toBeNull()
    expect(existsSync(fileURLToPath(new URL('../scripts/amprenta_globala_v1.sql', import.meta.url)))).toBe(false)
    expect(/AG_(CATALOG|SESIUNE) v1|AG_V1_/.test(BLOC + LIB + CIT + MAN + VERIF)).toBe(false)
    expect(/[^\x09\x0a\x20-\x7e]/.test(BLOC)).toBe(false)
    expect(BLOC.includes(String.fromCharCode(92))).toBe(false)
    expect(LIB).toContain("ag_bloc 'AG_CATALOG v2'")
  })
  it('lista de familii din antet = ramurile blocului = tabelul din document', () => {
    const antet = BLOC.slice(BLOC.indexOf('-- Familii (v2):'), BLOC.indexOf('-- Orice schimbare'))
      .replace(/-- ?/g, ' ').replace('Familii (v2):', '').split(/\s+/).filter(Boolean)
    expect([...antet].sort()).toEqual([...FAMILII].sort())
    expect(FAMILII.length).toBe(45)
    for (const f of ['sistem_adaugat', 'acl_sistem']) expect(FAMILII).toContain(f)
    const tabel = DOC.slice(DOC.indexOf('| Familie | Catalog'), DOC.indexOf('**NU intră:**'))
    for (const f of FAMILII) expect(tabel.includes(f), `familia ${f} lipseste din tabelul documentului`).toBe(true)
  })
  it('grantorul: fiecare aclexplode( are serializarea cu grantor; nicio serializare ACL fara el (P1)', () => {
    const acl = (CAT.match(/aclexplode\(/g) || []).length
    const cuGrantor = (CAT.match(/jsonb_build_array\(CASE WHEN (\w)\.grantee = 0 THEN NULL ELSE \1\.grantee::regrole::text END, \1\.privilege_type, \1\.is_grantable, \1\.grantor::regrole::text\)/g) || []).length
    expect(acl).toBeGreaterThanOrEqual(20)
    expect(cuGrantor).toBe(acl)
    expect(/is_grantable\)/.test(CAT)).toBe(false)
    expect((CAT.match(/privilege_type/g) || []).length).toBe(acl)
  })
  it('garda contextului canonic verifica toate GUC-urile puse de runner si de citire', () => {
    for (const g of ['search_path', 'TimeZone', 'DateStyle', 'IntervalStyle', 'extra_float_digits', 'bytea_output',
      'quote_all_identifiers', 'standard_conforming_strings', 'lc_monetary']) {
      expect(CAT.includes(`current_setting('${g}')`), g).toBe(true)
      expect(LIB.includes(`SET ${g} =`) && LIB.includes(`SET LOCAL ${g} =`), g).toBe(true)
    }
    expect(CAT.includes('AG_V2_CONTEXT_NECANONIC')).toBe(true)
  })
  it('perimetrul: aplicatia = tot in afara schemelor de sistem; din sistem: adaugatele dupa initdb + ACL-urile explicite', () => {
    const ns = CAT.slice(CAT.indexOf('ag_ns AS ('), CAT.indexOf('ag_sis3 AS ('))
    expect(ns).toContain("NOT IN ('pg_catalog', 'information_schema', 'pg_toast')")
    expect(ns).toContain("!~ '^pg_(toast_)?temp_[0-9]+$'")
    for (const s of ['auth', 'storage', 'realtime', 'extensions', 'vault', 'cron', 'net', 'graphql']) expect(ns.includes(`'${s}'`), s).toBe(false)
    expect(CAT).toContain("n.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')")
    for (const et of ['functie', 'relatie', 'tip', 'operator', 'familie_operatori', 'clasa_operatori', 'colatie', 'conversie',
      'ts_parser', 'ts_sablon', 'ts_dictionar', 'ts_config']) {
      const r = ramura('sistem_adaugat', `sistem_adaugat ${et}`)
      expect(r, et).not.toBeNull()
      expect(r.includes('>= 16384') && r.includes('JOIN ag_sis '), et).toBe(true)
    }
    for (const et of ['schema', 'relatie', 'coloana', 'functie', 'tip']) expect(ramura('acl_sistem', `acl_sistem ${et}`), et).not.toBeNull()
    for (const c of ['c.relacl IS NOT NULL', 'at.attacl IS NOT NULL', 'p.proacl IS NOT NULL', 't.typacl IS NOT NULL']) expect(CAT).toContain(c)
    expect(CAT).toContain("THEN 'toast ' || coalesce(p.oid::regclass::text, '-')")
    for (const x of ['reltuples', 'relpages', 'relallvisible', 'relfilenode', 'relfrozenxid', 'last_value', 'pg_statistic', 'attstattarget',
      'attmissingval', 'collversion', 'relhasindex', 'relhassubclass']) expect(CAT.includes(x), x).toBe(false)
    expect(CAT).toContain("c.relpersistence <> 't'")
  })
  it('v2: secventele cu legatura OWNED BY / identity, baza cu server_version_num, obiectele mari cate unul', () => {
    expect(CAT).toContain("d.deptype IN ('a', 'i')")
    expect(ramura('baza')).toContain("current_setting('server_version_num')")
    expect(ramura('obiect_mare')).toContain("'obiect_mare ' || lo.oid::text")
    expect(CAT).not.toContain('obiect_mare (toate)')
  })
  it('optiunile cu posibile secrete intra doar ca md5', () => {
    for (const o of ['ft.ftoptions', 'a.attfdwoptions', 'w.fdwoptions', 'sv.srvoptions', 'um.umoptions'])
      expect(new RegExp(`md5\\(jsonb_agg\\(o ORDER BY o COLLATE "C"\\)::text\\) FROM unnest\\(${o.replace('.', '\\.')}\\)`).test(CAT), o).toBe(true)
    expect((CAT.match(/md5\(substr\(x, strpos\(x, '='\) \+ 1\)\)/g) || []).length).toBe(2)   // rolconfig + setconfig
  })
  it('profilul sesiunii: fara operatori si cu nume calificate (se evalueaza in contextul apelantului)', () => {
    expect(/\|\||[^:]::text|[=<>]/.test(SES.replace(/::pg_catalog\.text(\[\])?/g, ''))).toBe(false)
    for (const g of ['DateStyle', 'TimeZone', 'row_security', 'search_path', 'session_replication_role']) expect(SES).toContain(`'${g}'`)
  })
})

describe('citirea coordonatorului — regula DEFINER si CONTEXT', () => {
  it('„are search_path” nu mai e criteriul: cele 5 reguli, increderea si acceptarea legata de md5', () => {
    for (const m of ["'fara search_path propriu'", "'element neanalizabil'", `'contine "\\$user"'`, "'pg_temp lipseste sau nu e ultimul'",
      "'schema inexistenta '", "'CREATE pe '", "has_schema_privilege(r.oid, s.nsp, 'CREATE')", 'FROM ag_sch s CROSS JOIN pg_roles r',
      "WHEN r.rolsuper THEN 'super' WHEN r.oid = s.nspowner THEN 'proprietar' WHEN r.rolname = current_user THEN 'rolul citirii'",
      'md5(jsonb_build_array(p.prosrc, to_jsonb(p.proconfig))::text) AS md5_corp', 'AND a.md5 = d.md5_corp',
      "'ACCEPTARE_INVALIDA'", "'ROL_INCREDERE_LIPSA'", "'INCREDERE'"]) expect(CIT, m).toContain(m)
    expect(CIT).toContain('--rol-de-incredere) INCR+=("$2")')
    expect(CIT).toContain('--definer-verificat) ACC+=("$2")')
    expect(CIT).toContain('IFS=$\'\\t\' read -r _ S_EX S_VED S_LIMB S_NES S_ACC <<<"$S"')
    expect(CIT).not.toMatch(/d\.definer AND NOT d\.are_search_path\)::text/)
  })
  it('CONTEXT in aceeasi fotografie; sectiunea scriptului migrarii delimitata', () => {
    expect(sectiune(CIT, 'AG_CITIRE context')).toContain("'server_version_num', current_setting('server_version_num')")
    expect(CIT).toContain("=== sfarsit scriptul de amprente al migrarii ===")
    expect(CIT.indexOf('-- >>> AG_CITIRE context')).toBeLessThan(CIT.indexOf('-- >>> AG_CITIRE fotografie'))
  })
})

describe('manifestul si comparatorul de liste', () => {
  it('--detalii (neversionat) si --compara-cu (proba cu ROLLBACK pe tinta); antetul cu v2 + server_version_num + rolul', () => {
    expect(MAN).toContain('--detalii) DET="$2"')
    expect(MAN).toContain('--compara-cu) CMP="$2"')
    expect(MAN).toContain('*/supabase/migrations/*) refuz 2')
    expect(MAN).toContain('(AMPRENTA_GLOBALA v2)')
    expect(MAN).toContain("printf '# clona: server_version_num %s, rol %s\\n'")
    expect(MAN).toContain('AS manifest_l15_nu_e_livrare')
    expect(MAN).toContain('FILENAME == ARGV[1]')
    expect(MAN).not.toContain('FNR == NR')
    expect(IGN).toContain('*.l15.detalii.txt')
    expect(LIB).toContain("RAISE NOTICE 'L15_DET %'")
  })
  it('comparatorul: doar bash / awk, fiecare regula cu marcajul ei de mutant', () => {
    for (const m of ['DOAR_A', 'DOAR_B', 'DIFERA', 'R_CONTEXT', 'R_FAM', 'R_EXIST', 'R_CREAT', 'R_MIG', 'R_REV'])
      expect((CMP.match(new RegExp(`# M_${m}$`, 'gm')) || []).length, m).toBe(1)
    expect(/python|psql/.test(CMP.replace(/^#.*$/gm, ''))).toBe(false)
    expect(CMP).not.toContain('FNR == NR')
  })
  const bash = spawnSync('bash', ['--version'], { encoding: 'utf8' })
  it.skipIf(bash.status !== 0)('scripts/test_l15_compara_liste.sh trece (liste-fixture + mutantii fiecarei reguli)', () => {
    const r = spawnSync('bash', [fileURLToPath(new URL('../scripts/test_l15_compara_liste.sh', import.meta.url))], { encoding: 'utf8' })
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toContain('PASS test_l15_compara_liste')
  }, 120000)
})

describe('runnerul — runda 15', () => {
  it('fara optiunile noi: linia psql veche neschimbata, biblioteca incarcata doar cu optiunile', () => {
    expect(RUN).toContain('"$PSQL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$DIR/0_prolog.sql" -f "$DIR/1_pre.sql" -f "$COPIE" -f "$DIR/3_inreg.sql" "${CONN[@]}"')
    const i = RUN.indexOf('. "$LIB_AG"'), garda = RUN.lastIndexOf('if [ -n "$AG_MD5" ]; then', i)
    expect(i > 0 && garda > 0 && RUN.slice(garda, i).split('\nfi').length === 1).toBe(true)
  })
  it('ordinea in mesajul unic: 1_pre, 2_ag_inainte, [pozitia copiei], copia, 3_inreg, 4_ag_dupa, timpul, garda', () => {
    const a = RUN.indexOf('cp -- "$DIR/1_pre.sql" "$DIR/m_rest.sql"'), b = RUN.indexOf('cat "$DIR/2_ag_inainte.sql" >> "$DIR/m_rest.sql"'),
      c = RUN.indexOf('POZ_COPIE="$(lm_octeti "$DIR/m_rest.sql")"')
    expect(a > 0 && b > a && c > b).toBe(true)
    expect(RUN).toContain('{ cat "$COPIE"; lm_sep; cat "$DIR/3_inreg.sql"; [ -z "$AG_MD5" ] || cat "$DIR/4_ag_dupa.sql"; lm_timp "$NUME"; lm_fin')
  })
  it('optiunile doar impreuna; manifestul cu numele migrarii; PGTZ / PGDATESTYLE refuzate', () => {
    expect(RUN).toContain('[ -n "$AG_MD5" ] && [ -n "$AG_MAN" ] || refuz 2')
    expect(RUN).toContain('[ "$(basename "$AG_MAN")" = "$NUME.l15.tsv" ] || refuz 2')
    expect(RUN).toContain('for v in PGTZ PGDATESTYLE; do')
  })
  it('verificatorul mesajului si proba pe productie stiu forma noua (blocul v2)', () => {
    expect(VERIF).toContain('def verifica_l15(')
    expect(VERIF).toContain('a[-3] == "--l15"')
    expect(VERIF).toContain('amprenta_globala_v2.sql')
    expect(DRY).toContain('--amprenta-globala-18a')
    expect(DRY).toContain('[ ! -f "$1/2_ag_inainte.sql" ] || cat "$1/2_ag_inainte.sql" >>"$REST"')
  })
})

describe('regula L15 (LECTII_REVIEW)', () => {
  it('textul nou, 4 randuri ASCII, fara renumerotare', () => {
    const i = LECTII.indexOf('\nL15 '), linii = LECTII.slice(i + 1).split('\n')
    expect(linii[0].startsWith('L15 Porti noi: GLOBAL versionat')).toBe(true)
    expect(linii.slice(1, 4).every(l => l.startsWith('    '))).toBe(true)
    expect(linii[4].startsWith('L16 ')).toBe(true)
    expect(/[^\x0a\x20-\x7e]/.test(LECTII)).toBe(false)
    for (let n = 1; n <= 25; n++) expect(LECTII.includes(`\nL${String(n).padStart(2, '0')} `), `L${n}`).toBe(true)
  })
})
