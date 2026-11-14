// L15 v2 (docs/LIVRARE_L15_V2.md): verificari statice ale blocului AMPRENTA_GLOBALA v2, ale pasilor runnerului, ale citirii
// coordonatorului, ale comparatorului de liste si ale regulii L15.
// Comportamentul (familii, mutanti, manifest, contraexemplele, regula DEFINER): scripts/pglite/test_amprenta_globala_local.mjs;
// forma runnerului: scripts/test_livrare_l15_forma.sh; paritatea cu main: scripts/test_livrare_l15_paritate.sh;
// PostgreSQL 17 real: scripts/test_livrare_l15_v2.sh. Comparatorul de liste (doar bash): rulat aici, daca exista bash.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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
    for (const f of ['sistem_initdb', 'acl_sistem']) expect(FAMILII).toContain(f)
    expect(FAMILII).not.toContain('sistem_adaugat')
    const tabel = DOC.slice(DOC.indexOf('| Familie | Catalog'), DOC.indexOf('**NU intră:**'))
    for (const f of FAMILII) expect(tabel.includes(f), `familia ${f} lipseste din tabelul documentului`).toBe(true)
  })
  it('grantorul: fiecare aclexplode( are serializarea cu grantor; nicio serializare ACL fara el (P1)', () => {
    const acl = (CAT.match(/aclexplode\(/g) || []).length
    const cuGrantor = (CAT.match(/jsonb_build_array\(CASE WHEN (\w)\.grantee = 0 THEN NULL ELSE \1\.grantee::regrole::text END, \1\.privilege_type, \1\.is_grantable, \1\.grantor::regrole::text\)/g) || []).length
    // r3: 18 (cele 2 ale familiei sumare sistem_adaugat au iesit; obiectele create in schemele de sistem au ACL-ul in familiile lor)
    expect(acl).toBeGreaterThanOrEqual(18)
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
  it('perimetrul (r3): O definitie (ag_per) + CTE-urile de perimetru; obiectele de sistem create dupa initdb prin familiile obisnuite', () => {
    const per = CAT.slice(CAT.indexOf('ag_per AS ('), CAT.indexOf('ag_ns AS ('))
    expect(per).toContain("CAST(CASE WHEN n.nspname IN ('pg_catalog', 'information_schema') THEN 16384 ELSE 0 END AS oid) AS prag")
    expect(per).toContain("n.nspname <> 'pg_toast' AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$'")
    for (const s of ['auth', 'storage', 'realtime', 'extensions', 'vault', 'cron', 'net', 'graphql']) expect(per.includes(`'${s}'`), s).toBe(false)
    expect((CAT.match(/ag_per AS \(/g) || []).length).toBe(1)
    expect(CAT).toContain('ag_ns AS (SELECT s.oid, s.q FROM ag_per s WHERE s.prag = 0)')
    // CTE-urile de perimetru: aceeasi forma pe fiecare catalog cu schema
    const PER = { ag_rel: ['pg_class', 'relnamespace'], ag_typ: ['pg_type', 'typnamespace'], ag_fn: ['pg_proc', 'pronamespace'],
      ag_opr: ['pg_operator', 'oprnamespace'], ag_opf_p: ['pg_opfamily', 'opfnamespace'], ag_opc_p: ['pg_opclass', 'opcnamespace'],
      ag_col: ['pg_collation', 'collnamespace'], ag_conv: ['pg_conversion', 'connamespace'], ag_tsp: ['pg_ts_parser', 'prsnamespace'],
      ag_tst: ['pg_ts_template', 'tmplnamespace'], ag_tsd: ['pg_ts_dict', 'dictnamespace'], ag_tsc: ['pg_ts_config', 'cfgnamespace'] }
    for (const [cte, [cat, col]] of Object.entries(PER)) {
      const linie = CAT.split('\n').find(l => l.startsWith(`${cte} AS (`))
      expect(linie, cte).toBeTruthy()
      expect(new RegExp(`FROM ${cat} (\\w+) JOIN ag_per s ON s\\.oid = \\1\\.${col} WHERE \\1\\.oid >= s\\.prag`).test(linie), cte).toBe(true)
    }
    // familiile folosesc CTE-urile de perimetru (nu predicate proprii)
    for (const [fam, cte] of [['functie', 'ag_fn'], ['operator', 'ag_opr'], ['familie_operatori', 'ag_opf_p'], ['clasa_operatori', 'ag_opc_p'],
      ['colatie', 'ag_col'], ['conversie', 'ag_conv'], ['ts_parser', 'ag_tsp'], ['ts_sablon', 'ag_tst'], ['ts_dictionar', 'ag_tsd'],
      ['ts_config', 'ag_tsc'], ['relatie', 'ag_rel'], ['tip', 'ag_typ']]) expect(ramura(fam).includes(`${cte} `), fam).toBe(true)
    // ag_per e folosit DOAR de CTE-urile de perimetru, ag_ns, ag_par (parintii randurilor atasate: relatii, domenii, familii
    // de operatori), plasa sistem_initdb (complementul: functii, relatii) si eticheta_securitate
    const COD = CAT.replace(/--.*$/gm, '')
    expect((COD.match(/ag_per s\b/g) || []).length).toBe(Object.keys(PER).length + 7)
    expect(ramura('eticheta_securitate')).toContain('LEFT JOIN ag_per s ON s.oid = sl.objnamespace')
    // nicio lista de campuri separata pentru obiectele din schemele de sistem: nici sistem_adaugat, nici alt prag in familii
    expect(BLOC).not.toContain('sistem_adaugat')
    expect(/\bag_sis\b/.test(CAT)).toBe(false)
    expect((COD.match(/16384/g) || []).length).toBe(1)   // doar ag_per (r4: amop / amproc trec prin ag_par)
    expect(CAT).toContain("n.nspname IN ('pg_catalog', 'information_schema', 'pg_toast')")
    for (const et of ['schema', 'relatie', 'coloana', 'functie', 'tip']) expect(ramura('acl_sistem', `acl_sistem ${et}`), et).not.toBeNull()
    for (const c of ['c.relacl IS NOT NULL', 'at.attacl IS NOT NULL', 'p.proacl IS NOT NULL', 't.typacl IS NOT NULL']) expect(CAT).toContain(c)
    expect(CAT).toContain("THEN 'toast ' || coalesce(p.oid::regclass::text, '-')")
    for (const x of ['reltuples', 'relpages', 'relallvisible', 'relfilenode', 'relfrozenxid', 'relminmxid', 'last_value', 'attstattarget',
      'attmissingval', 'collversion', 'relhasindex', 'relhassubclass', 'relhastriggers', 'relhasrules']) expect(CAT.includes(x), x).toBe(false)
    // statisticile (pg_statistic) nu intra; r4: plasa relatiilor NUMARA statisticile extinse (pg_statistic_ext) atasate
    expect(/pg_statistic(?!_ext\b)/.test(CAT)).toBe(false)
    expect(CAT).toContain("c.relpersistence <> 't'")
  })
  it('r4 (P1): randurile ATASATE - regula definita O DATA (ag_par), folosita de toate familiile legate de un parinte', () => {
    const COD = CAT.replace(/--.*$/gm, '')
    const DEF = 'CAST(CASE WHEN x.oid >= x.prag_schema THEN 0 ELSE x.prag_schema END AS oid) AS prag'
    expect(COD.split(DEF).length).toBe(2)
    expect((COD.match(/ag_par AS \(/g) || []).length).toBe(1)
    expect((COD.match(/prag_schema/g) || []).length).toBe(3)   // doar in ag_par
    const par = CAT.slice(CAT.indexOf('ag_par AS ('), CAT.indexOf('ag_opf AS ('))
    for (const s of ["FROM pg_class c JOIN ag_per s ON s.oid = c.relnamespace WHERE c.relpersistence <> 't'",
      "FROM pg_type t JOIN ag_per s ON s.oid = t.typnamespace WHERE t.typtype = 'd'", 'FROM pg_opfamily f JOIN ag_per s ON s.oid = f.opfnamespace'])
      expect(par, s).toContain(s)
    // familiile atasate: parintele prin ag_par, randul prin „<rand>.oid >= pa.prag”; niciuna prin ag_rel / ag_typ / ag_opf_p
    for (const [fam, parinte, rand] of [['constrangere', 'JOIN ag_par pa ON coalesce(pa.rel, pa.dom) = ', 'co.oid >= pa.prag'],
      ['trigger', 'JOIN ag_par pa ON pa.rel = t.tgrelid', 't.oid >= pa.prag'], ['regula', 'JOIN ag_par pa ON pa.rel = rw.ev_class', 'rw.oid >= pa.prag'],
      ['politica', 'JOIN ag_par pa ON pa.rel = p.polrelid', 'p.oid >= pa.prag'], ['amop', 'JOIN ag_par pa ON pa.opf = ao.amopfamily', 'ao.oid >= pa.prag'],
      ['amproc', 'JOIN ag_par pa ON pa.opf = ap.amprocfamily', 'ap.oid >= pa.prag'],
      ['coloana', 'FROM ag_par pa', 'coalesce(a.ad_oid, 0) >= a.prag']]) {
      const r = ramura(fam)
      expect(r.includes(parinte) && r.includes(rand), fam).toBe(true)
      expect(/\bag_(rel|typ|opf_p)\b/.test(r.replace(/--.*$/gm, '')), fam).toBe(false)
    }
    expect((COD.match(/ag_par pa\b/g) || []).length).toBe(7)   // exact cele 7 familii atasate
    expect(ramura('coloana')).toContain('d.adrelid = pa.rel AND d.oid >= pa.prag')
    // mostenirea (fara OID): perechea, oricare capat in perimetru
    expect(ramura('mostenire')).toContain('WHERE ih.inhrelid IN (SELECT r.oid FROM ag_rel r) OR ih.inhparent IN (SELECT r.oid FROM ag_rel r)')
  })
  it('r4: plasa sistem_initdb = functii (+ agregate) si relatii de la initdb, independenta de build; blocul AG_PLASA e inceputul catalogului', () => {
    const PL = sectiune(BLOC, 'AG_PLASA v2')
    expect(PL).not.toBeNull()
    expect(CAT.startsWith(`-- >>> AG_PLASA v2\n${PL}\n-- <<< AG_PLASA v2\n, ag_rand(familie, eticheta, d) AS (`)).toBe(true)
    const pl = PL.slice(PL.indexOf('ag_plasa(plasa, identitate, campuri) AS ('))
    expect(pl.length > 0 && PL.trimEnd().endsWith(')')).toBe(true)
    for (const c of ['ROW(s.q, p.proname, p.proargtypes', 'p.prokind', 'p.prolang', 'p.proowner', 'p.prosecdef', 'p.proisstrict', 'p.provolatile',
      'p.proleakproof', 'p.proparallel', 'p.proretset', 'p.prorettype', 'p.provariadic', 'p.proallargtypes', 'p.proargmodes', 'p.proargnames',
      'p.proconfig', 'p.pronargdefaults', 'CASE WHEN p.proargdefaults IS NOT NULL THEN pg_get_expr(p.proargdefaults, 0) END', 'md5(p.prosrc)',
      'p.probin', 'CASE WHEN p.prosqlbody IS NOT NULL THEN md5(pg_get_function_sqlbody(p.oid)) END', 'p.prosupport::oid',
      "CASE WHEN p.prokind = 'a' THEN (", 'g.aggtransfn::oid', 'g.aggfinalfn::oid', 'g.aggcombinefn::oid', 'g.aggsortop', 'g.agginitval',
      'g.aggminitval', 'g.aggfinalmodify', 'g.aggtranstype', 'WHERE p.oid < s.prag'])
      expect(pl.includes(c), c).toBe(true)
    // independenta de build: schema dupa nume (nu pronamespace), arborii bruti nu intra
    expect(/p\.pronamespace,|p\.prosqlbody::text|, p\.proargdefaults,/.test(pl)).toBe(false)
    for (const c of ["SELECT 'relatii', s.q || '.' || c.relname", 'c.relkind', 'c.relowner::regrole::text', 'c.relpersistence', 'c.relnatts',
      'c.relchecks', 'c.relrowsecurity', 'c.relforcerowsecurity', 'c.relreplident', 'c.relispartition', 'c.reloptions',
      'FROM pg_trigger t WHERE t.tgrelid = c.oid', 'FROM pg_rewrite rw WHERE rw.ev_class = c.oid', 'FROM pg_policy po WHERE po.polrelid = c.oid',
      'FROM pg_constraint co WHERE co.conrelid = c.oid', 'FROM pg_attrdef ad WHERE ad.adrelid = c.oid', 'FROM pg_index i WHERE i.indrelid = c.oid',
      'FROM pg_inherits ih WHERE ih.inhrelid = c.oid', 'FROM pg_inherits ih WHERE ih.inhparent = c.oid',
      'FROM pg_statistic_ext st WHERE st.stxrelid = c.oid', 'FROM pg_publication_rel pr WHERE pr.prrelid = c.oid', 'WHERE c.oid < s.prag'])
      expect(pl.includes(c), c).toBe(true)
    // randurile familiei: DIN ag_plasa (o singura definitie; recalculabile din detaliul citirii)
    expect(ramura('sistem_initdb')).toContain(`jsonb_build_array(count(*), md5(string_agg(x.campuri, chr(10) ORDER BY x.identitate COLLATE "C")))`)
    expect(ramura('sistem_initdb')).toContain('FROM ag_plasa x')
    expect((CAT.match(/FROM ag_plasa x/g) || []).length).toBe(1)
  })
  it('r5 (P1): limita partitiei in plasa relatiilor (forma canonica); lista inchisa a coloanelor pg_class / pg_proc / pg_aggregate', () => {
    const PL = sectiune(BLOC, 'AG_PLASA v2')
    const sel = (de, pana) => { const i = PL.indexOf(de), j = PL.indexOf(pana, i); expect(i >= 0 && j > i, de).toBe(true); return PL.slice(i, j) }
    // R = lista de valori a ramurii (pana la FROM); B = ramura intreaga (cu FROM-ul: metoda de acces / tablespace prin LEFT JOIN)
    const R = { pg_class: sel("SELECT 'relatii'", 'FROM pg_class c JOIN ag_per s'), pg_proc: sel("SELECT 'functii'", 'FROM pg_proc p JOIN ag_per s') }
    R.pg_aggregate = R.pg_proc.slice(R.pg_proc.indexOf("CASE WHEN p.prokind = 'a'"))
    const B = { ...R, pg_class: sel("SELECT 'relatii'", '     WHERE c.oid < s.prag\n)') }
    expect(R.pg_class).toContain('pg_get_expr(c.relpartbound, c.oid)')
    expect(R.pg_class).not.toMatch(/c\.relpartbound(?!, c\.oid\))/)   // arborele brut nu intra (contine pozitii)
    for (const c of ['c.relisshared, c.relispopulated', 'CASE WHEN c.reloftype <> 0 THEN c.reloftype::regtype::text END', 'am.amname, ts.spcname,'])
      expect(R.pg_class, c).toContain(c)
    expect(B.pg_class).toContain('LEFT JOIN pg_am am ON am.oid = c.relam LEFT JOIN pg_tablespace ts ON ts.oid = c.reltablespace')
    expect(R.pg_proc).toContain('p.procost, p.prorows, p.pronargs, p.protrftypes,')
    // lista (o singura definitie, in afara blocurilor executate): o linie pe coloana, fara dubluri
    const LC = sectiune(BLOC, 'AG_PLASA_COLOANE v2')
    expect(LC).not.toBeNull()
    expect(CAT.includes('-- >>> AG_PLASA_COLOANE') || /^-- pg_(class|proc|aggregate) /m.test(CAT)).toBe(false)   // lista e in afara blocului rulat
    const ln = LC.split('\n').filter(l => /^-- pg_(class|proc|aggregate) /.test(l))
    const cl = ln.map(l => l.match(/^-- (pg_class|pg_proc|pg_aggregate) ([a-z]+) (plasa|exclus [^ ].*)$/))
    expect(cl.every(Boolean)).toBe(true)
    const chei = cl.map(m => m[1] + '.' + m[2])
    expect(new Set(chei).size).toBe(chei.length)
    const AL = { pg_class: 'c', pg_proc: 'p', pg_aggregate: 'g' }
    const CHEI = ['pg_class.oid', 'pg_proc.oid', 'pg_aggregate.aggfnoid']   // folosite doar la cautari (legaturi), nu ca valori
    const refera = (X, cat, col) => new RegExp(`\\b${AL[cat]}\\.${col}\\b`).test(X[cat].replace(/--.*$/gm, ''))
    for (const [, cat, col, k] of cl) {
      if (k === 'plasa') expect(refera(B, cat, col), `${cat}.${col} plasa`).toBe(true)
      else if (!CHEI.includes(`${cat}.${col}`)) expect(refera(R, cat, col), `${cat}.${col} exclus`).toBe(false)
    }
    // in ramura relatii nu apare nicio coloana c.rel* neclasificata ca plasa (si invers, mai sus)
    const folosite = [...new Set((R.pg_class.replace(/--.*$/gm, '').match(/\bc\.rel[a-z]+/g) || []).map(x => x.slice(2)))]
    expect(folosite.filter(x => !cl.some(m => m[1] === 'pg_class' && m[2] === x && m[3] === 'plasa'))).toEqual([])
    // documentul, sectiunea 2 (ii): fiecare coloana exclusa, numita
    const D2 = DOC.slice(DOC.indexOf('**(ii) din obiectele de la initdb**'), DOC.indexOf('- **(iii)'))
    for (const m of cl.filter(m => m[3] !== 'plasa')) expect(D2.includes('`' + m[2] + '`'), `document: ${m[1]}.${m[2]}`).toBe(true)
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
  it('r3 (P2): MOMENT tiparit o data, inainte de sectiunea migrarii; sectiunea nealiniata; inlocuirea exacta, cu marcaj de mutant', () => {
    expect(sectiune(CIT, 'AG_CITIRE moment')).toBe("SELECT 'MOMENT', '-', '-', pg_catalog.now()::pg_catalog.text, '-'")
    expect(CIT.indexOf('-- >>> AG_CITIRE moment')).toBeLessThan(CIT.indexOf("'\\ir mig_amprente.sql'"))
    expect(CIT).toContain(`printf '%s\\n' '\\pset format unaligned' "\\\\pset fieldsep ' | '" '\\pset tuples_only off'`)
    expect(CIT).not.toContain("'\\pset format aligned'")
    expect((CIT.match(/# M_CIT_MOMENT$/gm) || []).length).toBe(1)
    expect(CIT).toContain('mk = "<momentul fotografiei>"')
  })
  it('r4 (P2): momentul se inlocuieste DOAR in campul antetului standard (citire si comparator: acelasi antet)', () => {
    const ANT = 'ant = "baza | sistem | versiune | la"'
    expect(CIT).toContain(ANT)
    expect(CMP).toContain(ANT)
    const linie = CIT.split('\n').find(l => l.endsWith('# M_CIT_MOMENT'))
    expect(linie).toContain('mig && dupa && length($0) > ls && substr($0, length($0) - ls + 1) == suf')
    expect(CIT).toContain('suf = " | " m')
    // r5: antetul = DOAR prima aparitie a liniei exacte din sectiune (citire si comparator), cu marcaj de mutant pe fiecare
    expect(CIT.split('\n').find(l => l.endsWith('# M_CIT_ANTET_UNIC'))).toContain('mig { dupa = (!va && $0 == ant); if (dupa) va = 1 }')
    expect(CIT).not.toContain('mig { dupa = ($0 == ant) }')
    expect((CIT.match(/# M_CIT_ANTET_UNIC$/gm) || []).length).toBe(1)
    expect(CIT).toContain('{ mig = 1; dupa = 0; va = 0; print; next }')
    expect(CIT).not.toContain('while ((i = index(s, m)) > 0)')   // inlocuirea globala din r3 a iesit
    expect(CMP.split('\n').find(l => l.endsWith('# M_CMP_ANTET_UNIC'))).toContain('if (dupa) ml[++nl] = $0; dupa = (!va && $0 == ant); if (dupa) va = 1; next }')
    expect((CMP.match(/# M_CMP_ANTET_UNIC$/gm) || []).length).toBe(1)
    expect(CMP).toContain('mig = 1; nb++; dupa = 0; va = 0;')
    // scripturile de amprente existente: TOATE au antetul standard (normalizat), in afara celor doua vechi, numite mai jos, cu
    // to_char(statement_timestamp()) (nu). Fara numar fix: scriptul unei migrari noi intra singur in verificare (si trebuie sa fie standard).
    const STD = 'SELECT current_database() AS baza, (SELECT system_identifier FROM pg_control_system()) AS sistem, version() AS versiune, now() AS la;'
    const dir = fileURLToPath(new URL('../scripts/', import.meta.url))
    const toate = readdirSync(dir).filter(f => f.endsWith('_amprente.sql')).sort()
    const std = toate.filter(f => citeste('scripts/' + f).split('\n').includes(STD))
    const vechi = toate.filter(f => !std.includes(f))
    expect(std.length).toBeGreaterThanOrEqual(5)
    expect(std.length).toBe(toate.length - 2)
    // r5: in cele standard, antetul e PRIMA iesire de date (inaintea lui doar comentarii, \set, BEGIN, SET LOCAL) si apare o data
    const INAINTE = ['\\set ON_ERROR_STOP 1', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;', 'SET LOCAL search_path = public, pg_temp;']
    for (const f of std) {
      const ls = citeste('scripts/' + f).split('\n').map(l => l.replace(/\r$/, ''))
      const i = ls.indexOf(STD)
      expect(ls.filter(l => l === STD).length, f).toBe(1)
      expect(ls.slice(0, i).filter(l => l.trim() !== '' && !l.startsWith('--')).every(l => INAINTE.includes(l)), f).toBe(true)
    }
    expect(vechi).toEqual(['intrebari_cercetare_amprente.sql', 'ofertare_inchidere_garda_amprente.sql'])
    for (const f of vechi) {
      expect(citeste('scripts/' + f)).toContain('to_char(statement_timestamp()')
      expect(DOC, f).toContain(f)
    }
  })
  it('r4: --detalii-plasa (cere --lista) = blocul AG_PLASA + SELECT pe ag_plasa, in aceeasi tranzactie; verificat fata de RAND', () => {
    expect(CIT).toContain('--detalii-plasa) DPL="$2"')
    expect(CIT).toContain(`PLA="$(ag_bloc 'AG_PLASA v2')"`)
    expect(CIT).toContain('[ "$LISTA" = 1 ] || refuz 2 "--detalii-plasa cere --lista')
    expect(sectiune(CIT, 'AG_CITIRE plasa')).toBe('$PLA\nSELECT x.plasa, x.identitate, md5(x.campuri) AS h, x.campuri FROM ag_plasa x ORDER BY x.plasa COLLATE "C", x.identitate COLLATE "C"')
    expect(CIT.indexOf('-- >>> AG_CITIRE plasa')).toBeGreaterThan(CIT.indexOf('-- >>> AG_CITIRE context'))
    expect(CIT.indexOf('-- >>> AG_CITIRE plasa')).toBeLessThan(CIT.indexOf('-- >>> AG_CITIRE fotografie'))
    expect((CIT.match(/# M_CIT_PLASA$/gm) || []).length).toBe(1)
    expect(CIT).toContain(`A_PL="$(printf '[%s, "%s"]' "$N_PL" "$M_PL" | md5sum | cut -d' ' -f1)"`)
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
    for (const m of ['DOAR_A', 'DOAR_B', 'DIFERA', 'R_CONTEXT', 'R_FAM', 'R_EXIST', 'R_CREAT', 'R_MIG', 'R_REV', 'MOMENT'])
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
