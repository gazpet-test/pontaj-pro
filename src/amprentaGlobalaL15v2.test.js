// L15 v2 (docs/LIVRARE_L15_V2.md): verificari statice ale blocului AMPRENTA_GLOBALA v1, ale pasilor runnerului si ale regulii L15.
// Comportamentul (familii, mutanti, manifest, contraexemplul vederii): scripts/pglite/test_amprenta_globala_local.mjs;
// forma runnerului: scripts/test_livrare_l15_forma.sh; PostgreSQL 17 real: scripts/test_livrare_l15_v2.sh.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const citeste = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r/g, '')
const BLOC = citeste('scripts/amprenta_globala_v1.sql')
const LIB = citeste('scripts/livrare_amprenta.sh')
const RUN = citeste('scripts/livrare_migrare.sh')
const DOC = citeste('docs/LIVRARE_L15_V2.md')
const LECTII = citeste('docs/paw/LECTII_REVIEW.md')
const VERIF = citeste('scripts/test_livrare_mesaj_unic.py')
const DRY = citeste('scripts/portal/dry_prod_e1.sh')
const sectiune = (t, m) => {
  const linii = t.split('\n'), a = linii.indexOf(`-- >>> ${m}`), b = linii.indexOf(`-- <<< ${m}`)
  return a >= 0 && b > a && linii.lastIndexOf(`-- >>> ${m}`) === a && linii.lastIndexOf(`-- <<< ${m}`) === b ? linii.slice(a + 1, b).join('\n') : null
}
const CAT = sectiune(BLOC, 'AG_CATALOG v1')
const SES = sectiune(BLOC, 'AG_SESIUNE v1')
// familiile = primul literal al fiecarei ramuri din ag_rand (+ sesiune din AG_SESIUNE)
const FAMILII = [...new Set([...CAT.matchAll(/SELECT '([a-z_]+)', '\1 /g)].map(m => m[1]))].concat(['sesiune'])

describe('AMPRENTA_GLOBALA v1 — blocul unic (L19)', () => {
  it('marcajele exista exact o data; fisierul e ASCII si fara backslash (textul ajunge in mesajul verificat)', () => {
    expect(CAT).not.toBeNull()
    expect(SES).not.toBeNull()
    expect(/[^\x09\x0a\x20-\x7e]/.test(BLOC)).toBe(false)
    expect(BLOC.includes(String.fromCharCode(92))).toBe(false)
    expect(LIB.match(/AG_CATALOG v1/g).length).toBeGreaterThan(0)
  })
  it('lista de familii din antet = ramurile blocului = tabelul din document', () => {
    const antet = BLOC.slice(BLOC.indexOf('-- Familii (v1):'), BLOC.indexOf('-- Orice schimbare'))
      .replace(/-- ?/g, ' ').replace('Familii (v1):', '').split(/\s+/).filter(Boolean)
    expect([...antet].sort()).toEqual([...FAMILII].sort())
    expect(FAMILII.length).toBe(43)
    const tabel = DOC.slice(DOC.indexOf('| Familie | Catalog'), DOC.indexOf('**NU intră:**'))
    for (const f of FAMILII) expect(tabel.includes(f), `familia ${f} lipseste din tabelul documentului`).toBe(true)
  })
  it('garda contextului canonic verifica toate GUC-urile puse de runner si de citire', () => {
    for (const g of ['search_path', 'TimeZone', 'DateStyle', 'IntervalStyle', 'extra_float_digits', 'bytea_output',
      'quote_all_identifiers', 'standard_conforming_strings', 'lc_monetary']) {
      expect(CAT.includes(`current_setting('${g}')`), g).toBe(true)
      expect(LIB.includes(`SET ${g} =`) && LIB.includes(`SET LOCAL ${g} =`), g).toBe(true)
    }
    expect(CAT.includes('AG_V1_CONTEXT_NECANONIC')).toBe(true)
  })
  it('perimetrul: exclude DOAR schemele de sistem si temporare; nimic statistic / volatil', () => {
    const ns = CAT.slice(CAT.indexOf('ag_ns AS ('), CAT.indexOf('ag_rel AS ('))
    expect(ns).toContain("NOT IN ('pg_catalog', 'information_schema', 'pg_toast')")
    expect(ns).toContain("!~ '^pg_(toast_)?temp_[0-9]+$'")
    for (const s of ['auth', 'storage', 'realtime', 'extensions', 'vault', 'cron', 'net', 'graphql']) expect(ns.includes(`'${s}'`), s).toBe(false)
    for (const x of ['reltuples', 'relpages', 'relallvisible', 'relfilenode', 'relfrozenxid', 'last_value', 'pg_statistic', 'attstattarget',
      'attmissingval', 'collversion', 'relhasindex', 'relhassubclass']) expect(CAT.includes(x), x).toBe(false)
    expect(CAT).toContain("c.relpersistence <> 't'")
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
  it('verificatorul mesajului si proba pe productie stiu forma noua', () => {
    expect(VERIF).toContain('def verifica_l15(')
    expect(VERIF).toContain('a[-3] == "--l15"')
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
