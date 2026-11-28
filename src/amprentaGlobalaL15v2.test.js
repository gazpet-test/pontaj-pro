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
    // r3: 18 (cele 2 ale familiei sumare sistem_adaugat au iesit; obiectele create in schemele de sistem au ACL-ul in familiile lor).
    // 17.11.2026 (calcul o data pe valoare): relatie, functie, tip si acl_sistem relatie folosesc O serializare, in ag_acl => 15
    expect(acl).toBe(15)
    expect(cuGrantor).toBe(acl)
    expect(/is_grantable\)/.test(CAT)).toBe(false)
    expect((CAT.match(/privilege_type/g) || []).length).toBe(acl)
  })
  it('17.11.2026: ACL-ul o data pe valoare distincta (ag_acl) - intrarea fiecarui obiect definita O DATA, cheia = aclitem[] (nu text)', () => {
    const COD = CAT.replace(/--.*$/gm, '')
    const acl = CAT.slice(CAT.indexOf('ag_acl AS MATERIALIZED ('), CAT.indexOf('ag_enum AS ('))
    expect(acl).toContain('FROM aclexplode(k.acl) a) z) AS j')
    expect(acl).toContain('FROM (SELECT x.acl FROM ag_acl_rel x UNION SELECT x.acl FROM ag_acl_fn x UNION SELECT x.acl FROM ag_acl_typ x')
    expect(acl).toContain('UNION SELECT x.acl FROM ag_acl_sis x) k')
    // intrarea ACL a fiecarui tip de obiect: exact o data in tot blocul (in CTE-ul ei), cu aceeasi forma ca inainte
    for (const [cte, intrare] of [
      ['ag_acl_rel', `coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END::"char", c.relowner))`],
      ['ag_acl_fn', "coalesce(p.proacl, acldefault('f', p.proowner))"], ['ag_acl_typ', "coalesce(t.typacl, acldefault('T', t.typowner))"]]) {
      const k = COD.indexOf(`${cte} AS (`), u = COD.indexOf(intrare)
      expect(COD.split(intrare).length, cte).toBe(2)
      expect(k >= 0 && u > k && u - k < 120, cte).toBe(true)
    }
    expect(COD).toContain('ag_acl_sis AS (SELECT c.oid, c.relacl AS acl FROM ag_rel_sis r JOIN pg_class c ON c.oid = r.oid WHERE c.relacl IS NOT NULL)')
    // fiecare familie isi ia serializarea prin cheia obiectului ei (JOIN pe oid + LEFT JOIN pe valoarea aclitem[]); fara ::text pe cheie
    for (const [fam, et, cte] of [['relatie', 'relatie', 'ag_acl_rel'], ['functie', 'functie', 'ag_acl_fn'], ['tip', 'tip', 'ag_acl_typ'],
      ['acl_sistem', 'acl_sistem relatie', 'ag_acl_sis']]) {
      const r = ramura(fam, et)
      expect(r, et).toContain(`JOIN ${cte} ar ON ar.oid = `)
      expect(r, et).toContain('LEFT JOIN ag_acl ka ON ka.acl = ar.acl')
      expect(r, et).toContain('ka.j')
      expect(/aclexplode\(/.test(r), et).toBe(false)
    }
    expect((COD.match(/LEFT JOIN ag_acl ka ON ka\.acl = ar\.acl/g) || []).length).toBe(4)
    expect(/ka\.acl\s*=\s*[^\n]*::text|acl::text/.test(COD)).toBe(false)
    // tablourile de obicei nule: subinterogarea doar pe tabloul nenul; enum o data pe tip; detaliul serializat o data
    for (const c of ['CASE WHEN a.attacl IS NOT NULL THEN (SELECT jsonb_agg', 'CASE WHEN a.attfdwoptions IS NOT NULL THEN (SELECT md5(',
      'CASE WHEN c.reloptions IS NOT NULL THEN (SELECT jsonb_agg', 'CASE WHEN p.protrftypes IS NOT NULL THEN (SELECT jsonb_agg']) expect(COD, c).toContain(c)
    expect(COD).toContain('ag_enum AS (SELECT e.enumtypid, jsonb_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS j FROM pg_enum e GROUP BY e.enumtypid)')
    expect(ramura('tip')).toContain('LEFT JOIN ag_enum en ON en.enumtypid = t.oid')
    expect(CAT.trimEnd().endsWith('SELECT q.familie, q.eticheta, md5(q.detaliu) AS amprenta, q.detaliu\n  FROM (SELECT r.familie, r.eticheta, r.d::text AS detaliu FROM ag_rand r CROSS JOIN ag_garda g WHERE g.ok = 1 OFFSET 0) q')).toBe(true)
    expect((COD.match(/\bd::text\b/g) || []).length).toBe(1)
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
    // 17.11.2026: intre AG_PLASA si ag_rand stau doar CTE-urile de calcul (ag_acl_*, ag_acl, ag_enum), fara randuri proprii
    expect(CAT.startsWith(`-- >>> AG_PLASA v2\n${PL}\n-- <<< AG_PLASA v2\n`)).toBe(true)
    const intre = CAT.slice(`-- >>> AG_PLASA v2\n${PL}\n-- <<< AG_PLASA v2\n`.length, CAT.indexOf(', ag_rand(familie, eticheta, d) AS ('))
    expect([...intre.replace(/--.*$/gm, '').matchAll(/(?:^|,\s*|\n)(ag_[a-z_]+) AS (?:MATERIALIZED )?\(/g)].map(m => m[1]))
      .toEqual(['ag_acl_rel', 'ag_acl_fn', 'ag_acl_typ', 'ag_acl_sis', 'ag_acl', 'ag_enum'])
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
    // runda 18: biblioteca se incarca si cu --plafon-extins (fara optiunile L15 doar la --genereaza-in, pentru generatorul de manifest)
    const i = RUN.indexOf('. "$LIB_AG"'), garda = RUN.lastIndexOf('if [ -n "$AG_MD5" ] || [ "$EXTINS" = 1 ]; then', i)
    expect(i > 0 && garda > 0 && RUN.slice(garda, i).split('\nfi').length === 1).toBe(true)
  })
  it('ordinea in mesajul unic: [1a_fereastra doar cu --plafon-extins], 1_pre, 2_ag_inainte, [pozitia copiei], copia, 3_inreg, 4_ag_dupa, timpul, garda', () => {
    const a = RUN.indexOf('{ [ "$EXTINS" = 0 ] || cat "$DIR/1a_fereastra.sql"; cat "$DIR/1_pre.sql"; } > "$DIR/m_rest.sql"'), b = RUN.indexOf('cat "$DIR/2_ag_inainte.sql" >> "$DIR/m_rest.sql"'),
      c = RUN.indexOf('POZ_COPIE="$(lm_octeti "$DIR/m_rest.sql")"')
    expect(a > 0 && b > a && c > b).toBe(true)
    expect(RUN).toContain('{ cat "$COPIE"; lm_sep; cat "$DIR/3_inreg.sql"; [ -z "$AG_MD5" ] || cat "$DIR/4_ag_dupa.sql"; lm_timp "$NUME"; lm_fin')
  })
  it('17.11.2026: validarile runnerului NESCHIMBATE (trecerea comuna retrasa la review r1-r2); md5-ul pe familii doar unde se tipareste', () => {
    const V = LIB.slice(LIB.indexOf('ag_sql_valid() {'), LIB.indexOf('# ag_tag'))
    // textul de dinainte, in ordinea de dinainte: invalid (EXISTS), dublura (GROUP BY), apoi GLOBAL la apelant; fara sortare comuna
    const VECHI = [`  IF EXISTS (SELECT 1 FROM $t a WHERE a.familie IS NULL OR a.eticheta IS NULL OR a.amprenta IS NULL
               OR a.familie !~ '^[a-z_]+\\$' OR a.amprenta !~ '^[0-9a-f]{32}\\$') THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_INVALIDA ($mo): rand fara familie / eticheta / amprenta valida - refuz, nimic comis'; END IF;
  SELECT string_agg(z.k, '; ' ORDER BY z.k COLLATE "C") INTO v_f FROM (
    SELECT a.familie || ' / ' || a.eticheta AS k FROM $t a GROUP BY a.familie, a.eticheta HAVING count(*) > 1) z;
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION 'AMPRENTA_GLOBALA_DUBLURA ($mo): etichete duble (%) - refuz, nimic comis', v_f; END IF;
SQL`]
    for (const s of VECHI) expect(V, 'textul validarilor').toContain(s)
    expect(/WINDOW|lag\(|ag_expr_global|v_dub|v_inv/.test(LIB.replace(/^#.*$/gm, ''))).toBe(false)
    for (const m of ['ina', 'dup']) expect(LIB).toContain(`$(ag_sql_valid "pg_temp.ag_${m}_$T" ${m === 'ina' ? 'inainte' : 'dupa'})\n  SELECT g.global_md5, g.randuri INTO v_g, v_n FROM ($(ag_sql_global "pg_temp.ag_${m}_$T")) g;`)
    // md5-ul pe familii (doar text de diagnostic): in citirea "-" si pe refuzul „inainte”, NU pe drumul aprobat care trece
    expect((LIB.match(/\$fam\b/g) || []).length).toBe(2)
    expect(LIB.indexOf('$fam\n    RAISE EXCEPTION \'AMPRENTA_GLOBALA_INAINTE')).toBeGreaterThan(LIB.indexOf("IF v_g IS DISTINCT FROM '$A' THEN"))
    expect(LIB).toContain('cmp="$fam\n  RAISE NOTICE \'AMPRENTA_GLOBALA_CITITA inainte:')
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

describe('runnerul — runda 18 (22.11.2026): plafonul EXTINS, doar cu --plafon-extins, in fereastra orara', () => {
  const VAL = citeste('scripts/livrare_validator.py')
  const TF = citeste('scripts/test_livrare_l15_forma.sh')
  const TPX = citeste('scripts/test_livrare_plafon_extins.sh')
  const PGX = citeste('scripts/pglite/test_plafon_extins_local.mjs')
  const TOATE = citeste('scripts/test_livrare_l15_local_toate.sh')
  it('o singura definitie: AG_PLAFON_MS = 5000 (neschimbat), AG_PLAFON_EXTINS_MS = 15000, fereastra 21:00:00-06:00:00 Europe/Bucharest', () => {
    expect(LIB.match(/^AG_PLAFON_MS=(\d+)$/m)[1]).toBe('5000')
    expect(LIB.match(/^AG_PLAFON_EXTINS_MS=(\d+)$/m)[1]).toBe('15000')
    expect(LIB.match(/^AG_FEREASTRA_DE=(\S+)/m)[1]).toBe('21:00:00')
    expect(LIB.match(/^AG_FEREASTRA_PANA=(\S+)/m)[1]).toBe('06:00:00')
    expect(LIB.match(/^AG_FEREASTRA_FUS=(\S+)$/m)[1]).toBe('Europe/Bucharest')
    // nicio alta definitie a valorilor in runner / generator / validator / verificator (valoarea vine din biblioteca)
    for (const [t, n] of [[RUN, 'runner'], [MAN, 'generator'], [VAL, 'validator']]) expect(/\b15000\b/.test(t.replace(/^\s*#.*$/gm, '')), n + ' fara constanta 15000 in cod').toBe(false)
    // documentul spune aceleasi valori
    expect(DOC).toContain('AG_PLAFON_EXTINS_MS')
    expect(DOC).toMatch(/15\.?000 ms/)
    expect(DOC).toContain('21:00')
    expect(DOC).toContain('06:00')
    expect(DOC).toContain('Europe/Bucharest')
  })
  it('biblioteca: ag_plafon_ok cu „extins” (doar 15000), ora din regula UE (fara baza de fusuri), fereastra peste miezul noptii, textul serverului', () => {
    expect(LIB).toContain('ag_plafon_ok() {')
    expect(LIB).toContain('if [ "${2:-}" = extins ]; then')
    expect(LIB).toContain('[ "$1" = "$AG_PLAFON_EXTINS_MS" ] || {')
    expect(LIB).toContain('ag_ora_bucuresti() {')
    expect(LIB).toContain('lu_m=$((31 - $(date -u -d "$an-03-31" +%u) % 7))')
    expect(LIB).toContain('lu_o=$((31 - $(date -u -d "$an-10-31" +%u) % 7))')
    expect(LIB).toContain('of=2; if [ "$e" -ge "$dst0" ] && [ "$e" -lt "$dst1" ]; then of=3; fi')
    expect(LIB).toContain('*" EET"|*" EEST") [ "${z% *}" = "$h" ] ||')   // verificarea incrucisata cu tzdata, fail-closed
    expect(LIB).toContain('ag_fereastra_in() {')
    expect(LIB).toContain('|| [[ "$1" < "$AG_FEREASTRA_PANA" ]]')
    expect(LIB).toContain('ag_fereastra_ok() {')
    expect(LIB).toContain('PLAFON_EXTINS_FEREASTRA')
    expect(LIB).toContain('ag_fereastra_sql() {')
    const sql = LIB.slice(LIB.indexOf('ag_fereastra_sql() {'))
    expect(sql).toContain("DO \\$plafon_fereastra\\$ DECLARE v_ora pg_catalog.time := (pg_catalog.transaction_timestamp() AT TIME ZONE '$AG_FEREASTRA_FUS')::pg_catalog.time; BEGIN")
    expect(sql).toContain("IF NOT (v_ora OPERATOR(pg_catalog.>=) '$AG_FEREASTRA_DE'::pg_catalog.time OR v_ora OPERATOR(pg_catalog.<) '$AG_FEREASTRA_PANA'::pg_catalog.time) THEN")
    expect(sql).toContain("RAISE EXCEPTION 'Livrare $NUME: PLAFON_EXTINS_FEREASTRA:")
    // marcajele de mutant ale testului bash
    for (const m of ['# M_PLX_OK', '# M_ORA_DST', '# M_FER_IN']) expect(LIB).toContain(m)
  })
  it('runnerul: flag fara valoare, DOAR cu L15, plafonul exact, fereastra locala (sarita doar la --genereaza-in), 1a_fereastra primul in rest, validatorul cu flag', () => {
    expect(RUN).toContain('if [ "$1" = --plafon-extins ]; then [ "$EXTINS" = 0 ] || refuz 2')
    expect(RUN).toContain('[ "$EXTINS" = 0 ] || [ -n "$AG_MD5" ] || [ -n "$GENEREAZA" ] || refuz 2 "--plafon-extins se folosește DOAR la livrările cu amprentă globală')
    // runda 19: valoarea + fereastra prin garda UNICA a bibliotecii (vezi blocul „runda 19” de mai jos)
    expect(RUN).toContain('CONECTAT=1; [ -z "$GENEREAZA" ] || CONECTAT=0\n  AG_PL_MSG="$(ag_plafon_garda "$PLAFON_MS" "$EXTINS" "$CONECTAT" 2>&1)" || refuz 2 "$AG_PL_MSG"')
    expect(RUN).toContain('[ "$EXTINS" = 0 ] || VAL_PLAFON+=(--plafon-extins)')
    expect(RUN).toContain('[ "$EXTINS" = 0 ] || ag_fereastra_sql "$NUME" > "$DIR/1a_fereastra.sql"')
    expect(RUN).toContain('{ [ "$EXTINS" = 0 ] || cat "$DIR/1a_fereastra.sql"; cat "$DIR/1_pre.sql"; } > "$DIR/m_rest.sql"')
    expect(RUN).toContain('[ "$EXTINS" = 0 ] || chmod 400 "$DIR/1a_fereastra.sql"')
    // fereastra verificata INAINTE de copie / validator / conexiune: in blocul argumentelor, inaintea lui mktemp
    expect(RUN.indexOf('ag_plafon_garda')).toBeLessThan(RUN.indexOf('DIR="$(mktemp -d)"'))
  })
  it('generatorul de manifest (runda 19): flag, garda UNICA in AMBELE moduri (--iesire si --compara-cu), 1a_fereastra in ambele', () => {
    expect(MAN).toContain('if [ "$1" = --plafon-extins ]; then [ "$EXTINS" = 0 ] || refuz 2')
    expect(MAN).toContain('CONECTAT=1; [ -z "$GEN" ] || CONECTAT=0\nAG_PL_MSG="$(ag_plafon_garda "$PLAFON_MS" "$EXTINS" "$CONECTAT" 2>&1)" || refuz 2 "$AG_PL_MSG"')
    // garda INAINTEA ramificarii pe mod (nu mai sta in blocul --compara-cu) si inaintea apelului psql
    const g = MAN.indexOf('AG_PL_MSG="$(ag_plafon_garda')
    expect(g).toBeLessThan(MAN.indexOf('if [ -n "$CMP" ]; then\n  ag_manifest_valid'))
    expect(g).toBeLessThan(MAN.indexOf('"${PSQL_BIN:-psql}"'))
    expect(MAN).toContain('[ "$EXTINS" = 0 ] || PL+=(--plafon-extins)')
    expect(MAN).toContain('{ [ "$EXTINS" = 0 ] || cat "$W/g/1a_fereastra.sql"; cat "$W/g/1_pre.sql"; cat "$W/2_ag_inainte.sql"; } >"$REST"')
    expect(MAN).not.toContain('[ -n "$CMP" ]; then cat "$W/g/1a_fereastra.sql"')
  })
  it('runda 19 (verdictul Jakarinos pe PR #1169, r2): O SINGURA garda - definita o data in biblioteca, apelata identic de runner si generator', () => {
    const cod = t => t.replace(/^\s*#.*$/gm, '')
    expect(LIB).toContain('ag_plafon_garda() {')
    expect(LIB).toContain('[ "$2" = 1 ] && [ "$3" = 1 ] || return 0   # M_GARDA_CONECTAT')
    expect(LIB).toContain('case "${2:-}:${3:-}" in 0:0|0:1|1:0|1:1) ;; *)')
    // runner si generator: un singur apel al garzii, niciun apel direct la ag_plafon_ok / ag_fereastra_ok (ar ocoli garda comuna)
    for (const [t, n] of [[RUN, 'runner'], [MAN, 'generator']]) {
      expect((cod(t).match(/ag_plafon_garda /g) || []).length, n + ': un apel al garzii').toBe(1)
      expect(/ag_plafon_ok|ag_fereastra_ok/.test(cod(t)), n + ': fara apel direct').toBe(false)
    }
    const TG = citeste('scripts/test_livrare_plafon_garda.sh')
    expect(TG).toContain('PASS test_livrare_plafon_garda')
    for (const m of ['--iesire', '--detalii', '--compara-cu', '--amprenta-globala', '--doar-genereaza', '--genereaza-in', '--aprobare']) expect(TG, m).toContain(m)
    expect(TG).toContain('PLX_GARDA_MUTANTI')
    expect(citeste('scripts/test_livrare_l15_local_toate.sh')).toContain('scripts/test_livrare_plafon_garda.sh')
    expect(DOC).toContain('ag_plafon_garda')
    expect(DOC).toContain('observator')
  })
  it('validatorul: --plafon-extins doar cu --plafon-tranzactie-ms, acordul declaratiei (PLAFON_EXTINS_DIFERIT) dupa acordul valorii, declaratia = cerere la --fara-plafon', () => {
    expect(VAL).toContain('PLAFON_EXTINS_OPT = "--plafon-extins"')
    expect(VAL).toContain('def verifica_declaratie_extins(text, extins):')
    expect(VAL).toContain('verifica_acord_plafon(text, plafon_ms)\n        verifica_declaratie_extins(text, plafon_extins)')
    expect(VAL).toContain('if plafon_extins and plafon_ms is None:')
    expect(VAL).toContain('motive.append(f"antetul declară plafonul extins ({PLAFON_EXTINS_OPT})")')
    expect((VAL.replace(/^#.*$/gm, '').match(/PLAFON_EXTINS_DIFERIT/g) || []).length, 'exact doua refuzuri in cod (declarat fara optiune / optiune fara declaratie)').toBe(2)
  })
  it('verificatorul mesajului: --fereastra cere pasul imediat dupa verificarea un mesaj; fara el pasul e refuzat', () => {
    expect(VERIF).toContain('def verifica_fereastra(txt, poz_mu, fereastra):')
    expect(VERIF).toContain('if len(k) != 1 or k[0] != poz_mu + 1:')
    expect(VERIF).toContain('esec("--fereastra lipsa, dar mesajul are pasul DO $plafon_fereastra$')
    expect(VERIF).toContain("pg_catalog.transaction_timestamp() AT TIME ZONE 'Europe/Bucharest'")
  })
  it('migrarile NEAPLICATE cu plafonul extins (cele trei din runda 18 + 20261224a, PR #1106 r3) cer 15000 + declara --plafon-extins pe prima linie; revenirile raman la 2000 fara declaratie', () => {
    // + 20270108a (registrul DCC, PR1): planul cere plafonul extins, ca 20270106a
    // + 20270114a (buletine NDT, decizia proprietarului 27.11.2026: proba pe producție a depășit 5000 ms) și 20270115b (citirile NDT,
    //   aceeași amprentă globală; PR izometrie/ndt-citiri) — 20270114a lipsea din listă pe main (testul era roșu)
    for (const m of ['20270105a_executie_rest_decontat', '20270105b_executie_proiect_configurare', '20270106a_executie_semnale', '20261224a_executie_revendicari',
      '20270108a_executie_dcc_registru', '20270114a_izometrie_buletine_ndt', '20270115b_izometrie_ndt_citiri',
      '20270116a_izometrie_coordonate_clase_subcontr']) {   // + 20270114a (buletine NDT, aplicată 27.11 cu plafonul extins); + 20270116a (PR1b, aceeași amprentă globală)
      const t = citeste(`supabase/migrations/${m}.sql`)
      expect(t.split('\n')[0], m).toContain('--plafon-tranzactie-ms 15000 --plafon-extins --amprenta-globala')
      expect((t.match(/'15000\/session'/g) || []).length, m).toBe(1)
      expect((t.match(/'15000:' \|\| txid_current\(\)/g) || []).length, m).toBe(1)
      expect(t, m).not.toContain("'5000/session'")
      expect(t, m).not.toContain("'5000:'")
      const r = citeste(`supabase/revenire/${m}_ROLLBACK.sql`)
      expect(r, m + ' revenire').toContain("'2000/session'")
      expect(r, m + ' revenire').not.toContain('--plafon-extins')
    }
    // nicio alta migrare / revenire nu declara optiunea
    const toate = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter(f => f.endsWith('.sql') && !/^(2027010(5a|5b|6a|8a)|20261224a|20270114a|20270115b|20270116a)_/.test(f))
    for (const f of toate) expect(citeste('supabase/migrations/' + f), f).not.toContain('--plafon-extins')
  })
  it('testele: forma (runda 18), biblioteca cu mutanti, PGlite pe textul serverului, in lista locala; documentul descrie decizia si limitele', () => {
    expect(TF).toContain('L15_FORMA_PLX_ARG')
    expect(TF).toContain('--fereastra --l15')
    expect(TF).toContain('PLAFON_EXTINS_DIFERIT')
    expect(TPX).toContain('PLX_MUTANTI')
    expect(PGX).toContain("'2026-03-29 01:00:00+00', '04:00:00', true")
    expect(TOATE).toContain('scripts/test_livrare_plafon_extins.sh')
    expect(TOATE).toContain('scripts/pglite/test_plafon_extins_local.mjs')
    expect(DOC).toContain('--plafon-extins')
    expect(DOC).toContain('PLAFON_EXTINS_FEREASTRA')
    expect(DOC).toContain('PLAFON_EXTINS_DIFERIT')
    expect(DOC).toContain('bugetul de lock (1 s de la prima încercare, `BUGET_LOCK`) și `LOCK_TINUT` (diagnostic, nu gardă) rămân exact ca în runda')
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
