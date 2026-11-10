// Proba LOCALĂ a migrării 20261209a (acces pe proiect în Execuție) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_acces_proiect.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, \gset, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261209a_executie_acces_proiect_schelet.sql
// + 20261201a și 20261028a întregi + funcțiile din 20261203a / 20261204a / 20261208a, extrase EXACT din migrările lor (amprentele se verifică).
// Apoi mutanți (migrare / revenire / schemă stricate intenționat): fiecare TREBUIE să pice exact unde trebuie, altfel testul nu dovedește nimic.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_acces_proiect_local.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG = join(ROOT, 'supabase/migrations/20261209a_executie_acces_proiect.sql')
const REV = join(ROOT, 'supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql')
const HARNESS = join(ROOT, 'scripts/test_executie_acces_proiect.sql')
const citeste = p => readFileSync(p, 'utf8')

// o funcție EXACT ca în migrarea ei (de la CREATE FUNCTION la sfârșitul corpului) + toate REVOKE / GRANT-urile ei
function extrageFunctie(fisier, nume) {
  const t = citeste(join(ROOT, 'supabase/migrations', fisier))
  const i = t.indexOf('CREATE FUNCTION public.' + nume + '(')
  if (i < 0) throw new Error('nu găsesc ' + nume + ' în ' + fisier)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const startCorp = i + a.index + a[0].length
  const sfarsit = t.indexOf(';', t.indexOf(a[1], startCorp) + a[1].length) + 1
  const acl = t.split(/\r?\n/).filter(l => /^(REVOKE|GRANT) /.test(l) && l.includes('ON FUNCTION public.' + nume + '(')).join('\n')
  return t.slice(i, sfarsit) + '\n' + acl + '\n'
}

// înlocuire obligatorie (un mutant care nu schimbă nimic nu dovedește nimic)
function inlocuieste(text, vechi, nou) {
  const n = text.replace(/\r\n/g, '\n')
  if (!n.includes(vechi)) throw new Error('mutant fără efect: nu găsesc «' + vechi.slice(0, 90) + '»')
  return n.split(vechi).join(nou)
}

// mini-psql: doar ce folosește harness-ul
async function ruleazaFisier(db, fisier, st, mut) {
  const text = mut[fisier] ? mut[fisier](citeste(fisier)) : citeste(fisier)
  let buf = []
  const executa = async () => {
    const sql = buf.join('\n'); buf = []
    if (!sql.trim()) return
    try {
      await db.exec(sql, { onNotice: n => st.notite.push(n.message) })
      st.vars.ERROR = 'false'
    } catch (e) {
      if (st.vars.ON_ERROR_STOP === '0') {
        st.vars.ERROR = 'true'; st.vars.SQLSTATE = e.code || ''; st.vars.LAST_ERROR_MESSAGE = e.message
      } else {
        const er = new Error(e.message); er.code = e.code; throw er
      }
    }
  }
  for (const brut of text.split('\n')) {
    const l = brut.replace(/\r$/, '')
    if (l.startsWith('\\')) {
      const [cmd, ...rest] = l.slice(1).trim().split(/\s+/)
      if (cmd === 'gset') {
        // interogarea din buffer, un singur rând: coloanele devin variabile (ca psql)
        const sql = buf.join('\n'); buf = []
        const r = await db.query(sql)
        if (r.rows.length !== 1) throw new Error('\\gset: ' + r.rows.length + ' rânduri')
        for (const [k, v] of Object.entries(r.rows[0])) st.vars[k] = v == null ? '' : String(v)
        continue
      }
      await executa()
      if (cmd === 'set') {
        const [nume, val = ''] = rest
        st.vars[nume] = val.startsWith(':') ? (st.vars[val.slice(1)] ?? '') : val
      } else if (cmd === 'ir') {
        await ruleazaFisier(db, resolve(dirname(fisier), rest.join(' ')), st, mut)
      } else throw new Error('meta-comandă necunoscută: ' + l)
    } else {
      // :'var' -> literal SQL (doar pentru variabilele definite, ca psql)
      buf.push(l.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (m, v) => (v in st.vars ? "'" + String(st.vars[v]).replace(/'/g, "''") + "'" : m)))
    }
  }
  await executa()
}

async function scenariu(nume, { mutMig, mutRev, mutSchelet, mutDrept, mutDoc, inainte, doarMigrarea } = {}) {
  const db = new PGlite()
  const st = { vars: { ON_ERROR_STOP: '1' }, notite: [] }
  const mut = {}
  if (mutMig) mut[MIG] = t => mutMig(t)
  if (mutRev) mut[REV] = t => mutRev(t)
  try {
    let schelet = citeste(join(ROOT, 'supabase/tests/20261209a_executie_acces_proiect_schelet.sql'))
    if (mutSchelet) schelet = mutSchelet(schelet)
    await db.exec(schelet)
    // 20261201a întreagă (sudurile pe nod + fn_executie_nod_drept + Storage), cu marcajul ei de livrare
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);`
      + citeste(join(ROOT, 'supabase/migrations/20261201a_executie_noduri_suduri.sql')) + '\nCOMMIT;')
    // 20261028a întreagă (coada de repartizat + fn_doc_*)
    let doc = citeste(join(ROOT, 'supabase/migrations/20261028a_documente_de_repartizat.sql'))
    if (mutDoc) doc = mutDoc(doc)
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261028a_documente_de_repartizat:' || txid_current(), true);` + doc + '\nCOMMIT;')
    // funcțiile de drept + raportul zilnic, exact ca în migrările lor
    let drept = extrageFunctie('20261203a_executie_contract_repere.sql', 'fn_executie_contract_drept')
      + extrageFunctie('20261204a_executie_grafic.sql', 'fn_executie_grafic_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_executie_tinte_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_santier_drept')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_lucrari_amprenta_linii')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_lucrari_json')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_versiune')
      + 'CREATE TRIGGER trg_raport_zilnic_versiune BEFORE INSERT OR UPDATE ON public.rapoarte_zilnice FOR EACH ROW EXECUTE FUNCTION public.fn_raport_zilnic_versiune();\n'
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_citeste')
      + extrageFunctie('20261208a_executie_devize_tinte.sql', 'fn_raport_zilnic_salveaza')
    if (mutDrept) drept = mutDrept(drept)
    await db.exec(drept)
    if (inainte) await db.exec(inainte)
    if (doarMigrarea) {
      // preflight-ul singur (fără harness: T0 ar număra înainte pe schema stricată)
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + (mutMig ? mutMig(citeste(MIG)) : citeste(MIG)) + '\nROLLBACK;', { onNotice: n => st.notite.push(n.message) })
      return { ok: true, notite: st.notite }
    }
    await ruleazaFisier(db, HARNESS, st, mut)
    const ultima = st.notite.filter(n => /^T\d|^TB/.test(n)).pop() || ''
    return { ok: /toate testele 20261209a au trecut/.test(ultima), notite: st.notite }
  } catch (e) {
    return { ok: false, eroare: (e.code ? e.code + ' ' : '') + e.message, notite: st.notite }
  } finally {
    await db.close()
  }
}

let esecuri = 0
const raport = (eticheta, r, asteptat, motiv) => {
  // un mutant trebuie să pice EXACT unde trebuie (motiv = fragmentul erorii), nu oriunde
  const bine = r.ok === asteptat && (!motiv || motiv.test(r.eroare || ''))
  if (!bine) esecuri++
  console.log(`${bine ? 'OK  ' : 'FAIL'} ${eticheta}: ${r.ok ? 'harness trecut' : 'oprit: ' + (r.eroare || 'fără mesaj final').slice(0, 300)}`)
  if (!bine || process.env.DETALII) for (const n of r.notite.filter(n => /^T|FAIL|NEPROBAT|20261209a/.test(n))) console.log('      · ' + n.slice(0, 400))
}

// 1) harness-ul real: trei proiecte pe „clonă”, apoi doar două (al treilea se creează în tranzacție)
raport('baza (3 proiecte)', await scenariu('baza'), true)
raport('doar 2 proiecte pe clonă', await scenariu('doua', {
  inainte: `DELETE FROM public.executie_situatii_plata_linii WHERE sl_id IN (SELECT id FROM public.executie_situatii_plata WHERE proiect_id = 2);
            DELETE FROM public.executie_situatii_plata WHERE proiect_id = 2; DELETE FROM public.executie_bonuri_consum WHERE proiect_id = 2;
            DELETE FROM public.executie_tronsoane WHERE proiect_id = 2; DELETE FROM public.proiect_articole WHERE proiect_id = 2;
            DELETE FROM public.executie_proiecte WHERE id = 2;`,
}), true)

// 2) mutanți pe migrare / revenire: harness-ul trebuie să-i prindă
const POL_P_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(false))::bigint[])', r.cheie);`
const POL_P_SCR = `v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I = ANY ((SELECT public.fn_executie_acces_lista(true))::bigint[])', r.cheie);`
const POL_C_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR %I IN (SELECT public.fn_executie_acces_parinti(%L, false))', r.cheie, r.parinte);`
raport('M1 garda de scriere dezactivată pe rândul nou', await scenariu('m1', {
  mutMig: t => inlocuieste(t, 'IF NOT public.fn_executie_proiect_permis(v_nou, true) THEN', 'IF false THEN'),
}), false, /T3 FAIL/)
raport('M2 toată lumea „nerestrânsă”', await scenariu('m2', {
  mutMig: t => inlocuieste(t, `  SELECT auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a`, `  SELECT auth.uid() IS NOT NULL
    AND (true
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a`),
}), false, /T3 FAIL/)
raport('M3 nivelul viewer ignorat la scriere', await scenariu('m3', {
  mutMig: t => inlocuieste(t, `     AND (p_scriere IS FALSE OR a.nivel = 'editor')\n$f$;`, `\n$f$;`),
}), false, /T3 FAIL: regula/)
raport('M4 RPC-ul de setare fără CAS', await scenariu('m4', {
  mutMig: t => inlocuieste(t, `  IF v_curent IS DISTINCT FROM v_veche THEN
    RETURN jsonb_build_object('ok', false, 'motiv', 'conflict', 'lista', v_curent);
  END IF;`, ''),
}), false, /T5 FAIL: CAS/)
raport('M5 RPC-ul acceptă lista goală (= vede tot)', await scenariu('m5', {
  mutMig: t => inlocuieste(t, `  IF p_restrans AND jsonb_array_length(v_tinta) = 0 THEN`, `  IF false THEN`),
}), false, /T5 FAIL: lista goal/)
raport('M6 politica de citire a tabelelor „proiect” lasă tot (dependențele păstrate)', await scenariu('m6', {
  mutMig: t => inlocuieste(t, POL_P_CIT, POL_P_CIT.replace(`) OR %I = ANY`, `) OR true OR %I = ANY`)),
}), false, /T3 FAIL: citire pe/)
raport('M7 revenirea nu verifică conturile restrânse', await scenariu('m7', {
  mutRev: t => inlocuieste(t, `  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;`, ''),
}), false, /T7b FAIL/)
raport('M8 copiii fără politica de citire', await scenariu('m8', {
  mutMig: t => inlocuieste(t, POL_C_CIT, POL_C_CIT.replace(`) OR %I IN`, `) OR true OR %I IN`)),
}), false, /T3 FAIL: citire pe (executie_|raport_)/)
raport('M9 setul părinților „pachet” = toate pachetele', await scenariu('m9', {
  mutMig: t => inlocuieste(t, `WHERE p_tip = 'pachet' AND k.proiect_id::bigint = ANY (l.ids)`, `WHERE p_tip = 'pachet'`),
}), false, /T3 FAIL: citire pe executie_(pachete_documente|tevi)/)
raport('M10 raportul zilnic fără condiția de proiect', await scenariu('m10', {
  mutMig: t => inlocuieste(inlocuieste(t, `    AND (public.fn_executie_acces_nerestrans()
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`, `    AND (true
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`),
    `,\n               ('public.fn_raport_santier_drept(bigint)', '640bdc86e81468fc7c5025f6eb54a23f', false, false)) a(semnatura, amprenta, cu_service, cu_auth)`,
    `) a(semnatura, amprenta, cu_service, cu_auth)`),
}), false, /T3r FAIL/)
raport('M11 Storage: citirea obiectelor lasă tot', await scenariu('m11', {
  mutMig: t => inlocuieste(t, `'OR public.fn_executie_acces_obiect_proiecte(bucket_id, name) && (SELECT public.fn_executie_acces_lista(false))'`,
    `'OR true OR public.fn_executie_acces_obiect_proiecte(bucket_id, name) && (SELECT public.fn_executie_acces_lista(false))'`),
}), false, /T3s FAIL/)
raport('M12 garda sare peste documente_proiect', await scenariu('m12', {
  mutMig: t => inlocuieste(t, `  IF TG_NARGS <> 1 THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;`,
    `  IF TG_TABLE_NAME = 'documente_proiect' THEN RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END; END IF;\n  IF TG_NARGS <> 1 THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;`),
}), false, /T3 FAIL: (INSERT|calea DEFINER)[^\n]*documente_proiect/)
raport('M13 scrierea legitimă oprită de politică (regula neatinsă)', await scenariu('m13', {
  mutMig: t => inlocuieste(t, POL_P_SCR, POL_P_SCR.replace(`OR %I = ANY ((SELECT public.fn_executie_acces_lista(true))::bigint[])'`, `OR (%I = ANY ((SELECT public.fn_executie_acces_lista(true))::bigint[]) AND false)'`)),
}), false, /T3 FAIL: (scrierea legitimă|INSERT-ul legitim|UPDATE \/ DELETE)/)

// 3) preflight-ul refuză o schemă care ar face restricția falsă sau un inventar incomplet
raport('P1 vedere cunoscută „definer” peste proiecte', await scenariu('p1', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE VIEW public.v_executie_dashboard WITH (security_invoker = on) AS', 'CREATE VIEW public.v_executie_dashboard AS'),
}), false, /vederi fara security_invoker.*v_executie_dashboard/)
raport('P2 tabel acoperit fără RLS', await scenariu('p2', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.executie_ture DISABLE ROW LEVEL SECURITY;',
}), false, /nu are RLS pornit/)
raport('P3 funcția de drept diferă de amprenta revizuită', await scenariu('p3', { doarMigrarea: true,
  mutDrept: t => inlocuieste(t, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')`, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin', 'x')`),
}), false, /amprenta revizuita/)
raport('P4 coloana de proiect lipsă', await scenariu('p4', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect_id bigint', 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect bigint'),
}), false, /executie_tura_naveta.proiect_id lipseste/)
raport('P5 vedere nouă „definer” peste un tabel acoperit', await scenariu('p5', { doarMigrarea: true,
  inainte: 'CREATE VIEW public.v_ture_vechi AS SELECT t.id, t.proiect_id FROM public.executie_ture t;',
}), false, /vederi fara security_invoker.*v_ture_vechi/)
raport('P6 vedere „definer” peste o vedere invoker peste un tabel acoperit', await scenariu('p6', { doarMigrarea: true,
  inainte: `CREATE VIEW public.v_ture_inv WITH (security_invoker = on) AS SELECT t.id, t.proiect_id FROM public.executie_ture t;
            CREATE VIEW public.v_peste_vedere AS SELECT * FROM public.v_ture_inv;`,
}), false, /vederi fara security_invoker.*v_peste_vedere/)
raport('P7 tabel nou legat de proiect, neclasificat', await scenariu('p7', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.executie_noua (id bigserial PRIMARY KEY, proiect_id bigint REFERENCES public.executie_proiecte(id));',
}), false, /neclasificate in inventar.*executie_noua/)
raport('P8 tabel nou legat prin alt tabel (copil al situațiilor de plată), neclasificat', await scenariu('p8', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.sl_note (id bigserial PRIMARY KEY, sl_id bigint REFERENCES public.executie_situatii_plata(id), nota text);',
}), false, /neclasificate in inventar.*sl_note/)
raport('P9 funcție SECURITY DEFINER nouă care citește un tabel acoperit', await scenariu('p9', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_scurgere(p bigint) RETURNS SETOF public.executie_ture LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.executie_ture WHERE proiect_id = p $f$;
            GRANT EXECUTE ON FUNCTION public.fn_scurgere(bigint) TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_scurgere/)
raport('P10 funcție clasificată cu alt corp decât cel revizuit', await scenariu('p10', { doarMigrarea: true,
  mutDoc: t => inlocuieste(t, `nu există sau nu e activ', p_proiect_id; END IF;`, `nu există', p_proiect_id; END IF;`),
}), false, /functii SECURITY DEFINER.*fn_doc_repartizeaza/)
raport('P11 vedere materializată peste un tabel acoperit', await scenariu('p11', { doarMigrarea: true,
  inainte: 'CREATE MATERIALIZED VIEW public.mv_ture AS SELECT t.id, t.proiect_id FROM public.executie_ture t;',
}), false, /mv_ture \(materializata\)/)
raport('P12 inventar fără documente_proiect (omisiunea din r1 e prinsă din catalog)', await scenariu('p12', { doarMigrarea: true,
  mutMig: t => inlocuieste(t, `  ('tabel', 'documente_proiect', 'proiect', 'proiect_id', NULL, 'corespondența proiectului (tab Documente)'),\n`, ''),
}), false, /neclasificate in inventar.*documente_proiect/)
raport('P13 o vedere „definer” peste un tabel EXCLUS nu oprește migrarea', await scenariu('p13', { doarMigrarea: true }), true)

console.log(esecuri ? `\n${esecuri} scenarii NU s-au comportat cum trebuie` : '\nToate scenariile s-au comportat cum trebuie')
process.exit(esecuri ? 1 : 0)
