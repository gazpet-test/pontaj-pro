// Proba LOCALĂ a migrării 20261209a (acces pe proiect în Execuție) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_acces_proiect.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261209a_executie_acces_proiect_schelet.sql
// + 20261201a întreagă + funcțiile de drept din 20261203a / 20261204a / 20261208a, extrase EXACT din migrările lor.
// Apoi mutanți (migrare / revenire / schemă stricate intenționat): fiecare TREBUIE să pice, altfel testul nu dovedește nimic.
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

// funcția de drept + REVOKE / GRANT-ul ei, exact ca în migrarea care a creat-o
function extrageDrept(fisier, nume) {
  const t = citeste(join(ROOT, 'supabase/migrations', fisier))
  const i = t.indexOf('CREATE FUNCTION public.' + nume + '(')
  const g = t.indexOf('GRANT EXECUTE ON FUNCTION public.' + nume + '(', i)
  if (i < 0 || g < 0) throw new Error('nu găsesc ' + nume + ' în ' + fisier)
  return t.slice(i, t.indexOf('\n', g) + 1)
}

// înlocuire obligatorie (un mutant care nu schimbă nimic nu dovedește nimic)
function inlocuieste(text, vechi, nou) {
  const n = text.replace(/\r\n/g, '\n')
  if (!n.includes(vechi)) throw new Error('mutant fără efect: nu găsesc «' + vechi.slice(0, 80) + '»')
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
      await executa()
      const [cmd, ...rest] = l.slice(1).trim().split(/\s+/)
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

async function scenariu(nume, { mutMig, mutRev, mutHarness, mutSchelet, mutDrept, inainte, doarMigrarea } = {}) {
  const db = new PGlite()
  const st = { vars: { ON_ERROR_STOP: '1' }, notite: [] }
  const mut = {}
  if (mutMig) mut[MIG] = t => mutMig(t)
  if (mutRev) mut[REV] = t => mutRev(t)
  if (mutHarness) mut[HARNESS] = t => mutHarness(t)
  try {
    let schelet = citeste(join(ROOT, 'supabase/tests/20261209a_executie_acces_proiect_schelet.sql'))
    if (mutSchelet) schelet = mutSchelet(schelet)
    await db.exec(schelet)
    // 20261201a întreagă (sudurile pe nod + fn_executie_nod_drept + Storage), cu marcajul ei de livrare
    await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261201a_executie_noduri_suduri:' || txid_current(), true);`
      + citeste(join(ROOT, 'supabase/migrations/20261201a_executie_noduri_suduri.sql')) + '\nCOMMIT;')
    let drept = extrageDrept('20261203a_executie_contract_repere.sql', 'fn_executie_contract_drept')
      + extrageDrept('20261204a_executie_grafic.sql', 'fn_executie_grafic_drept')
      + extrageDrept('20261208a_executie_devize_tinte.sql', 'fn_executie_tinte_drept')
    if (mutDrept) drept = mutDrept(drept)
    await db.exec(drept)
    if (inainte) await db.exec(inainte)
    if (doarMigrarea) {
      // preflight-ul singur (fără harness: TB ar număra înainte pe schema stricată)
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + citeste(MIG) + '\nROLLBACK;', { onNotice: n => st.notite.push(n.message) })
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
  console.log(`${bine ? 'OK  ' : 'FAIL'} ${eticheta}: ${r.ok ? 'harness trecut' : 'oprit: ' + (r.eroare || 'fără mesaj final')}`)
  if (!bine || process.env.DETALII) for (const n of r.notite.filter(n => /^T|FAIL|20261209a|t_garda|t_trece/.test(n))) console.log('      · ' + n)
}

// 1) harness-ul real: trei proiecte pe „clonă”, apoi doar două (al treilea se creează în tranzacție)
raport('baza (3 proiecte)', await scenariu('baza'), true)
raport('doar 2 proiecte pe clonă', await scenariu('doua', {
  inainte: `DELETE FROM public.executie_bonuri_consum_linii WHERE bon_id IN (SELECT id FROM public.executie_bonuri_consum WHERE proiect_id = 3);
            DELETE FROM public.executie_sl_ajustari WHERE sl_id IN (SELECT id FROM public.executie_situatii_plata WHERE proiect_id = 3);
            DELETE FROM public.executie_situatii_plata_linii WHERE sl_id IN (SELECT id FROM public.executie_situatii_plata WHERE proiect_id = 3);
            DELETE FROM public.executie_bonuri_consum WHERE proiect_id = 3; DELETE FROM public.executie_situatii_plata WHERE proiect_id = 3;
            DELETE FROM public.executie_tronsoane WHERE proiect_id = 3; DELETE FROM public.executie_alocari_personal WHERE proiect_id = 3;
            DELETE FROM public.executie_ture WHERE proiect_id = 3; DELETE FROM public.executie_acte_aditionale WHERE proiect_id = 3;
            DELETE FROM public.proiect_articole WHERE proiect_id = 3; DELETE FROM public.proiect_activitati WHERE proiect_id = 3;
            DELETE FROM public.executie_ordine_detectate WHERE proiect_id = 3; DELETE FROM public.sites WHERE proiect_id = 3;
            DELETE FROM public.executie_proiecte WHERE id = 3;`,
}), true)

// 2) mutanți pe migrare: harness-ul trebuie să-i prindă
raport('M1 garda de scriere dezactivată', await scenariu('m1', {
  mutMig: t => inlocuieste(t, 'IF NOT public.fn_executie_proiect_permis(v_nou, true) THEN', 'IF false THEN'),
}), false, /T3 FAIL: garda de scriere/)
raport('M2 toată lumea „nerestrânsă”', await scenariu('m2', {
  mutMig: t => inlocuieste(t, `  SELECT auth.uid() IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_owner IS TRUE)
         OR NOT EXISTS`, `  SELECT auth.uid() IS NOT NULL
    AND (true
         OR NOT EXISTS`),
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
raport('M6 politica de citire lipsă (doar trigger-ul)', await scenariu('m6', {
  mutMig: t => inlocuieste(t, `    EXECUTE format('CREATE POLICY executie_acces_citire ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (%s)', r.tabel, v_cit);\n    EXECUTE format('CREATE POLICY executie_acces_adauga ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.tabel, v_scr);\n    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabel, v_scr, v_scr);\n    EXECUTE format('CREATE POLICY executie_acces_sterge ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.tabel, v_scr);\n    EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda(%L)',`,
    `    EXECUTE format('CREATE POLICY executie_acces_citire ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (true)', r.tabel);\n    EXECUTE format('CREATE POLICY executie_acces_adauga ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.tabel, v_scr);\n    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabel, v_scr, v_scr);\n    EXECUTE format('CREATE POLICY executie_acces_sterge ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.tabel, v_scr);\n    EXECUTE format('CREATE TRIGGER trg_executie_acces_garda BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_executie_acces_garda(%L)',`)
    // postcondiția caută (false) în qual: o păcălim, ca să vedem dacă harness-ul prinde citirea
    .replace(`AND qual LIKE '%fn_executie_acces_nerestrans()%' AND qual LIKE '%false)%' AND with_check IS NULL)`, `AND with_check IS NULL)`),
}), false, /T3 FAIL: citire pe/)
raport('M7 revenirea nu verifică conturile restrânse', await scenariu('m7', {
  mutRev: t => inlocuieste(t, `  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;`, ''),
}), false, /T7b FAIL/)
raport('M8 copiii (liniile SL) fără politica de citire', await scenariu('m8', {
  mutMig: t => inlocuieste(t, `    v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_%s_permis(%I, false)', r.parinte, r.coloana);`,
    `    v_cit := 'true';`).replace(`AND qual LIKE '%fn_executie_acces_nerestrans()%' AND qual LIKE '%false)%' AND with_check IS NULL)`, `AND with_check IS NULL)`),
}), false, /T3 FAIL: citire pe executie_(situatii_plata_linii|sl_ajustari)/)

// 3) preflight-ul refuză o schemă care ar face restricția falsă
raport('P1 vedere „definer” peste proiecte', await scenariu('p1', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE VIEW public.v_executie_dashboard WITH (security_invoker = on) AS', 'CREATE VIEW public.v_executie_dashboard AS'),
}), false, /nu e security_invoker/)
raport('P2 tabel vechi fără RLS', await scenariu('p2', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.executie_ture DISABLE ROW LEVEL SECURITY;',
}), false, /nu are RLS pornit/)
raport('P3 funcția de drept diferă de amprenta revizuită', await scenariu('p3', { doarMigrarea: true,
  mutDrept: t => inlocuieste(t, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin')`, `u.module = 'executie' AND u.access_level IN ('viewer', 'editor', 'admin', 'x')`),
}), false, /amprenta revizuita/)
raport('P4 coloana de proiect lipsă', await scenariu('p4', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect_id bigint', 'CREATE TABLE public.executie_tura_naveta (id bigserial PRIMARY KEY, proiect bigint'),
}), false, /executie_tura_naveta.proiect_id lipseste/)

console.log(esecuri ? `\n${esecuri} scenarii NU s-au comportat cum trebuie` : '\nToate scenariile s-au comportat cum trebuie')
process.exit(esecuri ? 1 : 0)
