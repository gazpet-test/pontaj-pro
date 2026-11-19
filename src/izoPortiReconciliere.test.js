// Izometrie, reconcilierea porților (20261230a, TKT-2026-0393): verificări statice ale livrării, cu valorile așteptate scrise de mână din
// analiza de pe producție (19.11.2026) și refăcute independent din corpurile din repo (L25), nu din generator:
// (1) corpul nou al porții E2 = corpul de pe producție (20261109b, md5 3c136ab4…) + EXACT cele două schimbări de listă (diff pe linii);
//     revenirea pune corpul vechi octet cu octet; md5-urile din gărzi = md5-urile corpurilor;
// (2) amprentele noi din liste se refac din corpurile din repo (handle_new_user din 20261119a; porțile portalului din 20261118a / 19a), iar
//     cele vechi (20260929c) dau valoarea de dinainte — formula e cea a porții;
// (3) gărzile PRE fixează valorile analizate (ștampile, definiții, corpuri), ordinea e PRE → corp → ștampile → POST, revenirea scrie
//     ștampilele vechi exact; livrarea cere plafonul 5000 + amprenta globală (revenirea: 2000);
// (4) fișierele = ieșirea generatorului.
// Comportamentul (poarta reală pe o schemă falsă, mutanți, revenire): scripts/pglite/test_izometrie_porti_reconciliere_local.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { genereaza } from '../scripts/izometrie/reconciliere/gen_20261230a.mjs'

const brut = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const citeste = p => brut(p).replace(/\r/g, '')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')
const nr = (t, s) => t.split(s).length - 1
const MIG_REL = 'supabase/migrations/20261230a_izometrie_porti_reconciliere.sql'
const REV_REL = 'supabase/revenire/20261230a_izometrie_porti_reconciliere_ROLLBACK.sql'
const MIG = citeste(MIG_REL)
const REV = citeste(REV_REL)
const E4B = citeste('supabase/migrations/20261109b_izometrie_e4b_teren.sql')

// corpul (prosrc) unei funcții: de la marcaj, primul „AS $tag$” până la același tag
const corpDin = (t, marcaj) => {
  expect(nr(t, marcaj)).toBe(1)
  const i = t.indexOf(marcaj)
  const m = /AS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const a = i + m.index + m[0].length
  return t.slice(a, t.indexOf(m[1], a))
}
const CREATE = 'CREATE OR REPLACE FUNCTION public.fn_izo_porti_lipsa() RETURNS text[]'
const VECHI = corpDin(E4B, CREATE)
const NOU = corpDin(MIG, CREATE)
const IN_REVENIRE = corpDin(REV, CREATE)

// diff pe linii (LCS), suficient pentru ~400 de linii
function diff(a, b) {
  const n = a.length, m = b.length
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) { out.push(['-', i, a[i++]]) } else { out.push(['+', i, b[j++]]) }
  }
  while (i < n) out.push(['-', i, a[i++]])
  while (j < m) out.push(['+', i, b[j++]])
  return out
}

describe('20261230a: corpul porții E2', () => {
  it('corpul de pornire = cel de pe producție (md5 din analiză), fără CR', () => {
    expect(md5(VECHI)).toBe('3c136ab43387e8d7807efcadb0768dda')
    expect(VECHI.includes('\r')).toBe(false)
  })
  it('corpul nou = vechiul + EXACT cele două schimbări de listă (nimic altceva)', () => {
    const d = diff(VECHI.split('\n'), NOU.split('\n'))
    const sweep = VECHI.split('\n').indexOf("        'fn_conturi_inchideri_sweep()=402874ea5081b41801313e0def9e3226',")
    const trig = VECHI.split('\n').indexOf("        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',")
    expect(sweep).toBeGreaterThan(0)
    expect(trig).toBeGreaterThan(sweep)
    expect(d).toEqual([
      ['+', sweep + 1, "        'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36',"],
      ['+', sweep + 1, "        'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340',"],
      ['-', trig, "        'trigger on_auth_user_created on auth.users=5f3f59717d56d1148ac3f4b7d3a2b199',"],
      ['+', trig + 1, "        'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97',"],
    ])
  })
  it('intrările noi stau în listele potrivite (c_dinamice_revizuite / c_implicite_revizuite), în ordine alfabetică', () => {
    const lista = (nume) => { expect(nr(NOU, nume)).toBe(1); const i = NOU.indexOf(nume); return NOU.slice(i, NOU.indexOf('];', i)) }
    const din = lista('c_dinamice_revizuite text[] := ARRAY[')
    expect(din).toContain("'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36'")
    expect(din).toContain("'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340'")
    const elem = [...din.matchAll(/'([^']+)='/g)].map((x) => x[1])
    expect(elem).toEqual([...elem].sort())
    const impl = lista('c_implicite_revizuite constant text[] := ARRAY[')
    expect(impl).toContain("'trigger on_auth_user_created on auth.users=b1858fddd590635b445127fd6c680d97'")
    expect(impl).not.toContain('5f3f59717d56d1148ac3f4b7d3a2b199')
  })
  it('revenirea pune corpul vechi octet cu octet; gărzile poartă md5-urile corpurilor', () => {
    expect(IN_REVENIRE).toBe(VECHI)
    const mN = md5(NOU), mV = md5(VECHI)
    // migrarea: PRE cere vechiul, POST noul; revenirea: PRE cere noul, POST vechiul (în textul proprietăților)
    const pre = MIG.slice(0, MIG.indexOf(CREATE)), post = MIG.slice(MIG.indexOf('DO $post$'))
    expect(pre).toContain(`'${mV}|postgres|true|{"search_path=public, pg_temp"}|s|plpgsql|text[]|`)
    expect(post).toContain(`'${mN}|postgres|true|{"search_path=public, pg_temp"}|s|plpgsql|text[]|`)
    expect(REV.slice(0, REV.indexOf(CREATE))).toContain(`'${mN}|postgres|`)
    expect(REV.slice(REV.indexOf('DO $revenire_post$'))).toContain(`'${mV}|postgres|`)
    expect(nr(MIG, '{postgres=X/postgres,izo_registru_writer=X/postgres,izo_doc_editor=X/postgres,izo_receptie_writer=X/postgres,izo_cor_editor=X/postgres,izo_corectie_writer=X/postgres}')).toBe(2)
  })
  it('antetul funcției e cel de pe producție (owner / DEFINER / search_path neschimbate)', () => {
    for (const t of [MIG, REV]) {
      expect(t).toContain(CREATE + '\n    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$')
      expect(nr(t, 'CREATE OR REPLACE FUNCTION')).toBe(1)
      expect(nr(t, 'CREATE FUNCTION')).toBe(0)
      // nicio instrucțiune de drepturi / owner / ștergere (în afara corpului porții, ale cărui comentarii pot conține cuvintele)
      const fara = t.split(corpDin(t, CREATE)).join('')
      expect(/^[ \t]*(GRANT|REVOKE|ALTER|DROP|SET[ \t]+ROLE|RESET)\b/im.test(fara)).toBe(false)
    }
  })
})

describe('20261230a: amprentele din liste, refăcute din corpurile din repo', () => {
  const cfg = '{"search_path=public, pg_temp"}'
  // c_implicite_revizuite: md5(tip | identitate | funcția | owner | DEFINER | proconfig | limbaj | md5(prosrc || '|' || prosqlbody))
  const impl = (b) => md5(['trigger', 'on_auth_user_created on auth.users', 'public.handle_new_user()', 'postgres', 'true', cfg, 'plpgsql', md5(b + '|')].join('|'))
  // c_dinamice_revizuite: md5(prosrc | proconfig | owner | proacl | prosecdef)
  const dinamic = (b) => md5(b + '|' + cfg + '|postgres|{postgres=X/postgres}|true')
  const HNU = 'CREATE OR REPLACE FUNCTION public.handle_new_user()'
  it('handle_new_user: corpul din 20260929c → amprenta veche, cel din 20261119a → cea nouă', () => {
    const vechi = corpDin(citeste('supabase/migrations/20260929c_conturi_legare_automata.sql'), HNU)
    const nou = corpDin(citeste('supabase/migrations/20261119a_portal_teren_provisioning.sql'), HNU)
    expect(impl(vechi)).toBe('5f3f59717d56d1148ac3f4b7d3a2b199')
    expect(impl(nou)).toBe('b1858fddd590635b445127fd6c680d97')
    expect(md5(nou)).toBe('6d4787644eba78dcab1480c8689bb905')
    // antetul de pe producție (proconfig-ul din amprentă)
    expect(citeste('supabase/migrations/20261119a_portal_teren_provisioning.sql')).toContain(HNU + "\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'")
  })
  it('porțile portalului: amprentele de pe lista revizuită', () => {
    expect(dinamic(corpDin(citeste('supabase/migrations/20261118a_portal_teren_identitate.sql'), 'CREATE FUNCTION public.fn_portal_porti_lipsa() RETURNS text[]')))
      .toBe('38488af5684b583108b6ca7fc00fcb36')
    expect(dinamic(corpDin(citeste('supabase/migrations/20261119a_portal_teren_provisioning.sql'), 'CREATE FUNCTION public.fn_portal_porti_lipsa_1b() RETURNS text[]')))
      .toBe('4e5234fb19aab2a8cdf167c4621e6340')
  })
  it('corpurile fixate în PRE = ultimele lor definiții din repo', () => {
    const cazuri = [
      ['supabase/migrations/20261102a_izometrie_e2a_registru.sql', 'CREATE FUNCTION public.fn_izo_porti_definitii() RETURNS text', 'fn_izo_porti_definitii', 'ad3b94b0eb39955db07e6ec1bd5b5e8f'],
      ['supabase/migrations/20261103b_izometrie_e3_documente.sql', 'CREATE FUNCTION public.fn_izo_porti_e3_lipsa() RETURNS text[]', 'fn_izo_porti_e3_lipsa', 'f8510ff654386d504539ca4bbf2427c7'],
      ['supabase/migrations/20261111a_izometrie_gps_curatare.sql', 'CREATE OR REPLACE FUNCTION public.fn_izo_porti_e4_lipsa() RETURNS text[]', 'fn_izo_porti_e4_lipsa', '6905733e1c2ccddce2a5757757f24b6b'],
    ]
    for (const [rel, marcaj, f, m] of cazuri) {
      expect(md5(corpDin(citeste(rel), marcaj))).toBe(m)
      expect(MIG).toContain(`('${f}', '${m}')`)
    }
  })
})

describe('20261230a: gărzi, ordine, ștampile, livrare', () => {
  const STAMPILE = [['fn_izo_porti_definitii', 'porti=a79c07584550c02aa32f30b7b4b56646'], ['fn_izo_porti_e3_definitii', 'porti_e3=785fed7197be69709988bada9e598bd4'],
    ['fn_izo_porti_e3b_definitii', 'porti_e3b=869a529d41f6891a545a7541696f9df7'], ['fn_izo_porti_e4_definitii', 'porti_e4=be112fb7cdbb55aa8f2b530430a4d9fd'],
    ['fn_izo_porti_e4b_definitii', 'porti_e4b=696f226046c3ae662ac889562edac863']]
  const ACUM = [['fn_izo_porti_definitii', '0839b958877f2c4b82d50905296c7b10'], ['fn_izo_porti_e3_definitii', 'ee2e2689d3e35e820f221e93613e5a58'],
    ['fn_izo_porti_e3b_definitii', '54d2b5e3f17bc8778589f7e18cc057cd'], ['fn_izo_porti_e4_definitii', 'e9b5542202e21594b62997fbfd9ebd12'],
    ['fn_izo_porti_e4b_definitii', '1aaa23cc057b6d698c74a29c38887cb9']]
  it('PRE fixează ștampilele stocate și definițiile de acum; revenirea le pune / cere exact', () => {
    const pre = MIG.slice(0, MIG.indexOf(CREATE))
    for (const [f, s] of STAMPILE) {
      expect(pre).toContain(`('${f}', '${s}')`)
      expect(REV).toContain(`COMMENT ON FUNCTION public.${f}() IS '${s}';`)
    }
    for (const [f, v] of ACUM) {
      expect(pre).toContain(`v_x := public.${f}();\n  IF v_x IS DISTINCT FROM '${v}' THEN`)
      expect(REV.slice(REV.indexOf('DO $revenire_post$'))).toContain(`v_x := public.${f}();\n  IF v_x IS DISTINCT FROM '${v}' THEN`)
    }
    expect(pre).toContain("IF v_n IS DISTINCT FROM 1 OR v_x IS DISTINCT FROM 'b1858fddd590635b445127fd6c680d97' THEN")
    expect(pre).toContain("('fn_portal_porti_lipsa()', 'fn_portal_porti_lipsa()=38488af5684b583108b6ca7fc00fcb36')")
    expect(pre).toContain("('fn_portal_porti_lipsa_1b()', 'fn_portal_porti_lipsa_1b()=4e5234fb19aab2a8cdf167c4621e6340')")
  })
  it('ordinea: PRE → corpul nou → ștampilele (după corp) → POST; POST cere porțile verzi', () => {
    const p = [MIG.indexOf('DO $pre$'), MIG.indexOf(CREATE), MIG.indexOf('DO $stampile$'), MIG.indexOf('DO $post$')]
    expect(p.every((x) => x >= 0)).toBe(true)
    expect([...p].sort((a, b) => a - b)).toEqual(p)
    for (const [f, s] of STAMPILE) {
      const pref = s.split('=')[0]
      expect(nr(MIG, `EXECUTE format('COMMENT ON FUNCTION public.${f}() IS %L', '${pref}=' || public.${f}());`)).toBe(1)
    }
    expect(MIG.slice(p[3])).toContain("v_lipsa := public.fn_izo_porti_lipsa();\n  IF v_lipsa IS DISTINCT FROM '{}'::text[] THEN")
    // E3 / E3b / E4 egale cu valorile de dinainte, E2a / E4b schimbate
    expect(MIG.slice(p[3])).toContain("('fn_izo_porti_e3_definitii', 'porti_e3', 'ee2e2689d3e35e820f221e93613e5a58', true)")
    expect(MIG.slice(p[3])).toContain("('fn_izo_porti_definitii', 'porti', '0839b958877f2c4b82d50905296c7b10', false)")
    expect(MIG.slice(p[3])).toContain("('fn_izo_porti_e4b_definitii', 'porti_e4b', '1aaa23cc057b6d698c74a29c38887cb9', false)")
  })
  it('livrarea: runner cu plafon 5000 + amprenta globală (migrarea), 2000 (revenirea)', () => {
    expect(MIG.split('\n')[0]).toContain('Version 20261230120000. NEAPLICAT. Runner: scripts/livrare_migrare.sh --plafon-tranzactie-ms 5000')
    expect(MIG).toContain("current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261230a_izometrie_porti_reconciliere:' || txid_current()")
    expect(MIG).toContain("IF v_plafon IS DISTINCT FROM '5000/session'")
    // garda amprentei globale: aceeași formă ca 20261131j (tabelul pasului „înainte”, creat și ținut în ACEASTĂ tranzacție)
    const ag = (t) => { const i = t.indexOf("IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = pg_my_temp_schema()"); return t.slice(i, t.indexOf('THEN', i)) }
    expect(ag(MIG)).toContain("c.xmin::text = (txid_current() % 4294967296)::text")
    expect(ag(MIG)).toBe(ag(citeste('supabase/migrations/20261131j_redari_import_verificare_ai.sql')))
    expect(MIG).toContain('AMPRENTA_GLOBALA_LIPSA')
    expect(REV).toContain("current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261230a_izometrie_porti_reconciliere_ROLLBACK:' || txid_current()")
    expect(REV).toContain("IF v_plafon IS DISTINCT FROM '2000/session'")
    expect(REV).toContain('--versiune 20261230120001')
    for (const rel of [MIG_REL, REV_REL]) expect(brut(rel).charCodeAt(0)).not.toBe(0xfeff)
  })
  it('fișierele = ieșirea generatorului', () => {
    const g = genereaza(fileURLToPath(new URL('..', import.meta.url)))
    expect(g.migrare).toBe(MIG)
    expect(g.revenire).toBe(REV)
    expect(g.nou).toBe(NOU)
  })
})
