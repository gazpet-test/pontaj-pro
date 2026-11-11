// Proba LOCALĂ a migrării 20261209a (acces pe proiect în Execuție) pe PGlite (Postgres în WASM, în memorie) — NU atinge nicio bază reală.
// Rulează harness-ul REAL scripts/test_executie_acces_proiect.sql (cel pe care chat-ul îl rulează pe clonă) printr-un mini-psql
// (\ir, \set, \gset, :ERROR / :SQLSTATE / :'LAST_ERROR_MESSAGE', ON_ERROR_STOP), peste schema falsă supabase/tests/20261209a_executie_acces_proiect_schelet.sql
// + 20261201a și 20261028a întregi + funcțiile din 20261203a / 20261204a / 20261208a, extrase EXACT din migrările lor (amprentele se verifică).
// Apoi mutanți (migrare / revenire / schemă stricate intenționat): fiecare TREBUIE să pice exact unde trebuie, altfel testul nu dovedește nimic.
// Rulare (din rădăcina repo-ului): npm install --no-save @electric-sql/pglite && node scripts/pglite/test_executie_acces_proiect_local.mjs
// r3: fn_executie_swap_tevi_pozitie e creată direct în BD și nu se copiază în repo: schema falsă are un ÎNLOCUITOR cu același contract, iar
// amprenta lui ia locul amprentei reale în textul migrării (doar aici, în test). Fibra optică (20261211a) intră în forma minimă: funcția ei de
// drept delegată, exact ca în migrarea ei (amprenta se verifică), și un tabel 'drept' cu politica ei.
// r6: mutanții M26–M31 pe candidații clasificatorului (fn_executie_acces_candidati): lista contului ignorată, lista de scriere în loc de
// citire, proiectele inactive incluse, EXECUTE pentru authenticated, rândul fără cont fără candidați, revenirea care uită funcția.
// r7: M32 (UUID fără profil primește iar „toate”), M33 (refuzul prinde și rândul fără cont, NULL).
// r9: M40–M44 (predicatele citite iar ca proprietar = oracolele din r8, poarta swap fără modul, folderul propriu deschis spre alte foldere,
// scrierea în documente-proiect), P26–P27 (dreptul de citire al predicatelor INVOKER, bucla politicilor); schema falsă are RLS pe modul
// pentru pachete și șantiere (rânduri existente, dar invizibile unui cont fără modul).
// r10: M43 rescris (folderul propriu deschis spre alte foldere, fără funcția din r9) și M45 (funcția din r9 pusă la loc = oracolul din
// verdictul Jakarinos r9: fișierul propriu cu rând pe un proiect nepermis = fals, cale inexistentă = adevărat).
// r11: M46 (modificarea / ștergerea în folderul propriu permise iar, ca în r10), M47 (politicile UPDATE / DELETE fără al 4-lea argument),
// M48 (prefixul nestrict), M49 (ștergerea urmează rândul vizibil = oracol).
// r12: M50 (încărcarea fără garda căii libere = re-ocuparea din verdictul r11), M51 (garda citește ca apelantul), M52 (altă potrivire
// decât garda 4d), M53 (fără EXECUTE), M54 (garda răspunde în afara folderului propriu), M55 (revenirea o uită), P28–P29 (colația / indexul).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIG = join(ROOT, 'supabase/migrations/20261209a_executie_acces_proiect.sql')
const REV = join(ROOT, 'supabase/revenire/20261209a_executie_acces_proiect_ROLLBACK.sql')
const HARNESS = join(ROOT, 'scripts/test_executie_acces_proiect.sql')
const SCHELET = join(ROOT, 'supabase/tests/20261209a_executie_acces_proiect_schelet.sql')
const citeste = p => readFileSync(p, 'utf8')
const md5 = s => createHash('md5').update(s, 'utf8').digest('hex')

// corpul (între delimitatorii $…$) al primei funcții care începe cu `cap`, fără CR — ca md5(replace(prosrc, chr(13), '')) din BD
function corp(text, cap) {
  const t = text.replace(/\r/g, '')
  const i = t.indexOf(cap)
  if (i < 0) throw new Error('nu găsesc ' + cap)
  const a = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(t.slice(i))
  const st = i + a.index + a[0].length
  return t.slice(st, t.indexOf(a[1], st))
}
const SWAP_REAL = '551affa41371b0ff3367b0ddebe9b603'
const SWAP_INLOCUITOR = md5(corp(citeste(SCHELET), 'CREATE FUNCTION public.fn_executie_swap_tevi_pozitie('))
const POARTA_CAP = 'CREATE FUNCTION public.fn_executie_swap_tevi_pozitie('
const POARTA_MD5 = md5(corp(citeste(MIG), POARTA_CAP))
const cuInlocuitor = t => {
  if (!t.includes(SWAP_REAL)) throw new Error('migrarea nu mai are amprenta reală a lui fn_executie_swap_tevi_pozitie')
  return t.split(SWAP_REAL).join(SWAP_INLOCUITOR)
}

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
        // DEPANARE=1: textul din jurul poziției erorii (doar local)
        if (process.env.DEPANARE) console.error('--- eroare la poziția ' + e.position + ':\n' + sql.slice(Math.max(0, (e.position | 0) - 400), (e.position | 0) + 100))
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

// opțional: node scripts/pglite/test_executie_acces_proiect_local.mjs '<regex pe numele scenariului>' (ex. '^(baza|m15)$')
const DOAR = process.argv[2] ? new RegExp(process.argv[2]) : null
async function scenariu(nume, { mutMig, mutRev, mutSchelet, mutDrept, mutDoc, inainte, doarMigrarea } = {}) {
  if (DOAR && !DOAR.test(nume)) return { sarit: true }
  const db = new PGlite()
  const st = { vars: { ON_ERROR_STOP: '1' }, notite: [] }
  const mut = {}
  mut[MIG] = t => cuInlocuitor(mutMig ? mutMig(t) : t)
  if (mutRev) mut[REV] = t => mutRev(t)
  try {
    let schelet = citeste(SCHELET)
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
      // fibra optică (20261211a), forma minimă: funcția de drept delegată (corpul EXACT ca în 20261211a) + un tabel 'drept' cu politica ei
      + `CREATE FUNCTION public.fn_executie_fibra_drept(p_proiect bigint, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT coalesce(public.fn_executie_nod_drept(p_proiect, p_scriere), false)
$f$;
REVOKE ALL ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_executie_fibra_drept(bigint, boolean) TO authenticated, service_role;
CREATE TABLE public.executie_fibra_intervale (id bigserial PRIMARY KEY, proiect_id bigint NOT NULL REFERENCES public.executie_proiecte(id), etapa text NOT NULL);
ALTER TABLE public.executie_fibra_intervale ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.executie_fibra_intervale FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.executie_fibra_intervale TO authenticated, service_role;
CREATE POLICY executie_fibra_intervale_citire ON public.executie_fibra_intervale FOR SELECT TO authenticated
  USING (public.fn_executie_fibra_drept(proiect_id, false));
INSERT INTO public.executie_fibra_intervale (proiect_id, etapa) VALUES (1, 'monotub'), (3, 'monotub');
`
    if (mutDrept) drept = mutDrept(drept)
    await db.exec(drept)
    if (inainte) await db.exec(inainte)
    if (doarMigrarea) {
      // preflight-ul singur (fără harness: T0 ar număra înainte pe schema stricată)
      await db.exec(`BEGIN; SELECT set_config('gazpet.livrare_migrare', '20261209a_executie_acces_proiect:' || txid_current(), true);`
        + mut[MIG](citeste(MIG)) + '\nROLLBACK;', { onNotice: n => st.notite.push(n.message) })
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
  if (r.sarit) return
  // un mutant trebuie să pice EXACT unde trebuie (motiv = fragmentul erorii), nu oriunde
  const bine = r.ok === asteptat && (!motiv || motiv.test(r.eroare || ''))
  if (!bine) esecuri++
  console.log(`${bine ? 'OK  ' : 'FAIL'} ${eticheta}: ${r.ok ? 'harness trecut' : 'oprit: ' + (r.eroare || 'fără mesaj final').slice(0, 300)}`)
  if (!bine || process.env.DETALII || DOAR) for (const n of r.notite.filter(n => /^T|FAIL|NEPROBAT|20261209a/.test(n))) console.log('      · ' + n.slice(0, 1200))
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
// r8: politicile cheamă predicatele publice pe rând (boolean), nu lista / setul părinților
const POL_P_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, false)', r.cheie);`
const POL_P_SCR = `v_scr := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_proiect_permis(%I::bigint, true)', r.cheie);`
const POL_C_CIT = `v_cit := format('(SELECT public.fn_executie_acces_nerestrans()) OR public.fn_executie_acces_parinte_permis(%L, %I::bigint, false)', r.parinte, r.cheie);`
raport('M1 garda de scriere dezactivată pe rândul nou', await scenariu('m1', {
  mutMig: t => inlocuieste(t, 'IF NOT (v_nul AND v_nou IS NULL) AND NOT public.fn_executie_proiect_permis(v_nou, true) THEN', 'IF false THEN'),
}), false, /T3 FAIL/)
raport('M2 toată lumea „nerestrânsă”', await scenariu('m2', {
  // r6: regula stă în fn_executie_acces_nerestrans_cont (cont dat); varianta pe apelant o cheamă
  mutMig: t => inlocuieste(t, `  SELECT p_profile IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile AND p.is_owner IS TRUE)
         OR NOT EXISTS (SELECT 1 FROM public.executie_acces_proiect a`, `  SELECT p_profile IS NOT NULL
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
  mutMig: t => inlocuieste(t, POL_P_CIT, POL_P_CIT.replace(`) OR public.fn_executie_proiect_permis`, `) OR true OR public.fn_executie_proiect_permis`)),
}), false, /T3 FAIL: citire pe/)
raport('M7 revenirea nu verifică conturile restrânse', await scenariu('m7', {
  mutRev: t => inlocuieste(t, `  IF EXISTS (SELECT 1 FROM public.executie_acces_proiect) THEN
    RAISE EXCEPTION '20261209a revenire: exista conturi restranse pe proiect (ar vedea din nou toate proiectele); scoate intai restrictiile';
  END IF;`, ''),
}), false, /T7b FAIL/)
raport('M8 copiii fără politica de citire', await scenariu('m8', {
  mutMig: t => inlocuieste(t, POL_C_CIT, POL_C_CIT.replace(`) OR public.fn_executie_acces_parinte_permis`, `) OR true OR public.fn_executie_acces_parinte_permis`)),
}), false, /T3 FAIL: citire pe (executie_|raport_)/)
// r9: căutarea părintelui e sub RLS-ul apelantului, deci la CITIRE un pachet nepermis e deja invizibil (restricția lui); mutantul care
// contează e nivelul: scrierea pe copiii pachetului cu lista de CITIRE (B, viewer pe p2, ar scrie țevile lui p2)
raport('M9 părintele „pachet”: scrierea cere doar lista de citire', await scenariu('m9', {
  mutMig: t => inlocuieste(t, `    WHEN 'pachet' THEN EXISTS (SELECT 1 FROM public.executie_pachete_lansare k WHERE k.id = p_id AND public.fn_executie_proiect_permis(k.proiect_id::bigint, p_scriere))`,
    `    WHEN 'pachet' THEN EXISTS (SELECT 1 FROM public.executie_pachete_lansare k WHERE k.id = p_id AND public.fn_executie_proiect_permis(k.proiect_id::bigint, false))`),
}), false, /T3 FAIL[^\n]*executie_(pachete_documente|tevi)/)
raport('M10 raportul zilnic fără condiția de proiect', await scenariu('m10', {
  mutMig: t => inlocuieste(inlocuieste(t, `    AND (public.fn_executie_acces_nerestrans()
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`, `    AND (true
         OR EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site`),
    `,\n               ('public.fn_raport_santier_drept(bigint)', '640bdc86e81468fc7c5025f6eb54a23f', false, false)) a(semnatura, amprenta, cu_service, cu_auth)`,
    `) a(semnatura, amprenta, cu_service, cu_auth)`),
}), false, /T3r FAIL/)
raport('M11 Storage: citirea obiectelor lasă tot', await scenariu('m11', {
  mutMig: t => inlocuieste(t, `'OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`,
    `'OR true OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`),
}), false, /T3 FAIL|T3s FAIL/)
raport('M12 garda sare peste documente_proiect', await scenariu('m12', {
  mutMig: t => inlocuieste(t, `  v_nul := TG_NARGS = 2;`,
    `  IF TG_TABLE_NAME = 'documente_proiect' THEN RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END; END IF;\n  v_nul := TG_NARGS = 2;`),
}), false, /T3 FAIL: (INSERT|calea DEFINER)[^\n]*documente_proiect/)
raport('M13 scrierea legitimă oprită de politică (regula neatinsă)', await scenariu('m13', {
  mutMig: t => inlocuieste(t, POL_P_SCR, POL_P_SCR.replace(`OR public.fn_executie_proiect_permis(%I::bigint, true)'`, `OR (public.fn_executie_proiect_permis(%I::bigint, true) AND false)'`)),
}), false, /T3 FAIL: (scrierea legitimă|INSERT-ul legitim|UPDATE \/ DELETE)/)

// r3: poarta swap dezactivată (amprenta porții recalculată, ca postcondiția / revenirea să nu fie ele cele care pică)
const POARTA_COND = `  IF auth.uid() IS NOT NULL\n     AND EXISTS`
raport('M14 poarta swap nu mai verifică proiectul', await scenariu('m14', {
  mutMig: t => {
    const m = inlocuieste(t, POARTA_COND, `  IF false\n     AND EXISTS`)
    return inlocuieste(m, POARTA_MD5, md5(corp(m, POARTA_CAP)))
  },
  mutRev: t => inlocuieste(t, POARTA_MD5, md5(corp(inlocuieste(citeste(MIG), POARTA_COND, `  IF false\n     AND EXISTS`), POARTA_CAP))),
}), false, /T3 FAIL: poarta swap/)

// r4: review r3 — „doar citire” scrie antetul raportului; graficul intern și Inboxul AI fără listă
raport('M15 antetul raportului: scrierea cere doar nivelul de citire (părintele „site”)', await scenariu('m15', {
  mutMig: t => inlocuieste(t, `WHERE si.id = p_id AND (si.proiect_id IS NULL OR public.fn_executie_proiect_permis(si.proiect_id::bigint, p_scriere)))`,
    `WHERE si.id = p_id AND (si.proiect_id IS NULL OR public.fn_executie_proiect_permis(si.proiect_id::bigint, false)))`),
}), false, /T3 FAIL[^\n]*rapoarte_zilnice|T3r FAIL[^\n]*viewer/)
raport('M16 antetul raportului rămâne exclus (ca în r3)', await scenariu('m16', {
  mutMig: t => inlocuieste(t, `  ('tabel', 'rapoarte_zilnice', 'copil', 'site_id', 'site',`, `  ('tabel', 'rapoarte_zilnice', 'exclus', NULL, NULL,`),
}), false, /T3r FAIL[^\n]*viewer/)
raport('M17 graficul intern: citirea lasă toate proiectele', await scenariu('m17', {
  mutMig: t => inlocuieste(t, `%I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`,
    `true OR %I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`),
}), false, /T3 FAIL: citire pe grafic_activitati/)
raport('M18 graficul intern: rândurile fără proiect ascunse (regula prea strictă)', await scenariu('m18', {
  mutMig: t => inlocuieste(t, `%I IS NULL OR public.fn_executie_proiect_permis(%I::bigint, false)'`,
    `(%I IS NULL AND false) OR public.fn_executie_proiect_permis(%I::bigint, false)'`),
}), false, /T3 FAIL: citire pe grafic_activitati/)
raport('M19 Inbox AI: citirea rândului ignoră lista', await scenariu('m19', {
  mutMig: t => inlocuieste(t, `         OR public.fn_executie_proiect_permis(p_entitate, p_scriere)\n`,
    `         OR p_scriere IS FALSE OR public.fn_executie_proiect_permis(p_entitate, p_scriere)\n`),
}), false, /T3i FAIL/)
raport('M20 Inbox AI: garda pe rând dezactivată (calea DEFINER scrie pe p3)', await scenariu('m20', {
  mutMig: t => inlocuieste(t, `  IF TG_NARGS <> 0 THEN RAISE EXCEPTION 'acces proiect: trigger configurat greșit pe %', TG_TABLE_NAME; END IF;`,
    `  IF TG_NARGS = 0 THEN RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END; END IF;`),
}), false, /T3i FAIL[^\n]*DEFINER/)
// (citirea fișierelor Inboxului e oprită deja de politica de azi, prin rândul ascuns de politica cozii: ramura de citire din Storage e o
// a doua barieră și nu se poate pica izolat; ramura care schimbă ceva e scrierea / ștergerea)
const INBOX_STRAIN = `              WHEN p_bucket = 'ai-documente-inbox' THEN
                EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                         WHERE i.fisier_path = p_name
                           AND public.fn_executie_acces_inbox_rand(i.modul_tinta, i.entitate_id::bigint, i.uploadat_de, p_scriere))`
raport('M21 Storage Inbox: ștergerea fișierelor din afara folderului propriu lasă tot (dependența păstrată)', await scenariu('m21', {
  mutMig: t => inlocuieste(t, INBOX_STRAIN, INBOX_STRAIN.replace(`THEN\n                EXISTS`, `THEN\n                p_scriere OR EXISTS`)),
}), false, /T3i FAIL[^\n]*șterge fișierul/)
raport('M22 garda „proiect” lasă rândurile fără proiect și pe tabelele stricte', await scenariu('m22', {
  mutMig: t => inlocuieste(t, `  v_nul := TG_NARGS = 2;`, `  v_nul := true;`),
}), false, /T3 FAIL|T3d FAIL/)

// r5: review r4 P1 — documentul propriu potrivit de clasificator pe un proiect din afara listei
const INBOX_EXCEPTIE = `OR (p_scriere IS FALSE AND p_entitate IS NULL AND auth.uid() IS NOT NULL AND p_uploadat_de = auth.uid()))`
raport('M23 Inbox AI: excepția celui care a urcat și după potrivire (regula din r4)', await scenariu('m23', {
  mutMig: t => inlocuieste(t, INBOX_EXCEPTIE, `OR (p_scriere IS FALSE AND auth.uid() IS NOT NULL AND p_uploadat_de = auth.uid()))`),
}), false, /T3i FAIL[^\n]*p3_al_lui_b|T3c FAIL/)
raport('M24 Inbox AI: excepția scoasă de tot (documentul propriu fără proiect ascuns)', await scenariu('m24', {
  mutMig: t => inlocuieste(t, INBOX_EXCEPTIE, `OR (false AND p_entitate IS NULL AND auth.uid() IS NOT NULL AND p_uploadat_de = auth.uid()))`),
}), false, /T3i FAIL[^\n]*nul_al_lui_b|T3c FAIL/)
// politica de modificare nu mai filtrează rândurile (USING lasă tot, dependențele rămân): UPDATE-ul direct al lui B pe p2 nu mai dă
// „OK 0”, ci refuzul WITH CHECK — exact „altă eroare” pe care r4 o accepta în T3r
raport('M25 antetul raportului: UPDATE direct pe p2 nefiltrat pe REST (altă eroare în loc de 0 rânduri)', await scenariu('m25', {
  mutMig: t => inlocuieste(t, `    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.obiect, v_scr, v_scr);`,
    `    EXECUTE format('CREATE POLICY executie_acces_modifica ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.obiect,
                   CASE WHEN r.obiect = 'rapoarte_zilnice' THEN v_scr || ' OR true' ELSE v_scr END, v_scr);`),
}), false, /T3 FAIL[^\n]*rapoarte_zilnice|T3r FAIL[^\n]*REST/)

// r6: review r5 P1 — clasificatorul caută doar în proiectele permise celui care a urcat (fn_executie_acces_candidati)
const CAND_FILTRU = `     AND (p_profile IS NULL OR c.tot OR e.id = ANY (c.ids)));\nEND $f$;`
raport('M26 candidații ignoră lista contului (clasificatorul ar căuta iar în toate proiectele)', await scenariu('m26', {
  mutMig: t => inlocuieste(t, CAND_FILTRU, `);\nEND $f$;`),
}), false, /T3c FAIL: candidații lui B/)
raport('M27 candidații pe lista de SCRIERE (proiectul „viewer” n-ar mai fi candidat)', await scenariu('m27', {
  mutMig: t => inlocuieste(t, `public.fn_executie_acces_lista_cont(p_profile, false) AS ids)`, `public.fn_executie_acces_lista_cont(p_profile, true) AS ids)`),
}), false, /T3c FAIL: candidații lui B/)
raport('M28 candidații și pentru proiectele inactive', await scenariu('m28', {
  mutMig: t => inlocuieste(t, `   WHERE e.activ IS TRUE\n     AND (p_profile IS NULL`, `   WHERE true\n     AND (p_profile IS NULL`),
}), false, /T3c FAIL: candidații contului/)
raport('M29 candidații apelabili de un client logat (contul e parametru)', await scenariu('m29', {
  mutMig: t => inlocuieste(t, `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_candidati(uuid) TO service_role;`,
    `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_candidati(uuid) TO service_role, authenticated;`),
}), false, /functii noi \(definer/)
raport('M30 candidații: contul fără rând ia „nimic” în loc de „toate” (rândurile fără cont n-ar mai fi potrivite)', await scenariu('m30', {
  mutMig: t => inlocuieste(t, CAND_FILTRU, `     AND (c.tot OR e.id = ANY (c.ids)));\nEND $f$;`),
}), false, /T3c FAIL: candidații contului nul/)
// r7: review r6 P2 — un UUID fără profil primea „toate proiectele active”
raport('M32 candidații: contul inexistent (UUID fără profil) ia iar „toate” în loc de refuz', await scenariu('m32', {
  mutMig: t => inlocuieste(t, `  IF p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`,
    `  IF false AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`),
}), false, /T3c FAIL: cont inexistent/)
// r7: refuzul se aplică și pe NULL (rândul fără cont n-ar mai fi potrivit) — NULL trebuie să rămână „toate”
raport('M33 candidații: refuzul prinde și rândul fără cont (NULL)', await scenariu('m33', {
  mutMig: t => inlocuieste(t, `  IF p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`,
    `  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile) THEN`),
}), false, /22023 acces proiect: candidații cer un cont existent/)
raport('M31 revenirea uită funcția candidaților', await scenariu('m31', {
  mutRev: t => inlocuieste(t, `  DROP FUNCTION public.fn_executie_acces_candidati(uuid);`, ''),
}), false, /revenire post: au ramas obiecte|starea nu e cea/)

// r8: review SQL P1-01 / P1-02 — funcțiile apelabile direct întorc doar boolean, fără oracol de existență
const GRANT_PUBLIC_ULTIM = `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_obiect_permis(text, text, boolean, boolean) TO authenticated;`
raport('M34 lista (id-uri) iar apelabilă de authenticated', await scenariu('m34', {
  mutMig: t => inlocuieste(t, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;`),
}), false, /functii noi \(definer/)
// regula GENERALĂ trebuie să prindă singură (lista exactă e „păcălită” în același mutant); r9: lista (bigint[]) în locul rezolvării scoase
const LISTA_EXACTA = `'fn_executie_acces_parinte_permis', 'fn_executie_acces_inbox_rand',\n                                          'fn_executie_acces_obiect_permis', 'fn_executie_acces_inbox_propriu_liber',\n                                          'fn_executie_acces_proiect_seteaza')))) THEN`
raport('M35 lista (id-uri) apelabilă + trecută pe lista exactă (prinde regula generală)', await scenariu('m35', {
  mutMig: t => inlocuieste(inlocuieste(t, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_lista(boolean) TO authenticated;`),
    LISTA_EXACTA, LISTA_EXACTA.replace(`'fn_executie_acces_proiect_seteaza'`, `'fn_executie_acces_proiect_seteaza', 'fn_executie_acces_lista'`)),
}), false, /intorc altceva decat boolean.*fn_executie_acces_lista/)
// r9: în afara folderului propriu, „fără rând vizibil” = adevărat (oracolul din r7, sub altă formă)
raport('M36 Inbox: în afara folderului propriu, fără rând vizibil = adevărat', await scenariu('m36', {
  mutMig: t => inlocuieste(t, INBOX_STRAIN, `              WHEN p_bucket = 'ai-documente-inbox' THEN
                NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                         WHERE i.fisier_path = p_name
                           AND public.fn_executie_acces_inbox_rand(i.modul_tinta, i.entitate_id::bigint, i.uploadat_de, p_scriere) IS NOT TRUE)`),
}), false, /T3i FAIL|T3e FAIL[^\n]*inbox/)
// r9: părintele „sl” inexistent = adevărat la citire (sub RLS-ul apelantului, rândul ascuns e tot „inexistent” → adevărat și el: îl prinde
// specificația, iar citirea copiilor lui p3 de către B)
raport('M37 părintele „sl” inexistent / invizibil = adevărat la citire', await scenariu('m37', {
  mutMig: t => inlocuieste(t, `    WHEN 'sl' THEN EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id AND public.fn_executie_proiect_permis(s.proiect_id::bigint, p_scriere))`,
    `    WHEN 'sl' THEN (p_scriere IS FALSE AND NOT EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id))
      OR EXISTS (SELECT 1 FROM public.executie_situatii_plata s WHERE s.id = p_id AND public.fn_executie_proiect_permis(s.proiect_id::bigint, p_scriere))`),
}), false, /T3 FAIL: citire pe executie_(situatii_plata_linii|sl_ajustari)|T3e FAIL[^\n]*parinte_sl/)
raport('M38 o politică Storage cheamă din nou o funcție internă', await scenariu('m38', {
  mutMig: t => inlocuieste(t, `'OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`,
    `'OR (cardinality(public.fn_executie_acces_lista(false)) < 0) OR public.fn_executie_acces_obiect_permis(bucket_id, name, false)'`),
}), false, /politici care cheama functii interne/)
// r9: la citire, pachetul nepermis e invizibil (restricția lui); nivelul de scriere e cel care se poate pierde
raport('M39 Storage pachete: scrierea cere doar lista de citire', await scenariu('m39', {
  mutMig: t => inlocuieste(t, `                         WHERE k.id = substring(p_name FROM '^([1-9][0-9]{0,17})/')::bigint
                           AND public.fn_executie_proiect_permis(k.proiect_id::bigint, p_scriere))`,
    `                         WHERE k.id = substring(p_name FROM '^([1-9][0-9]{0,17})/')::bigint
                           AND public.fn_executie_proiect_permis(k.proiect_id::bigint, false))`),
}), false, /T3e FAIL[^\n]*pachete_s/)

// r9: review r8 (ambii recenzenți P1) — predicatele răspund după ce VEDE apelantul; mutanții întorc comportamentul din r8
const LISTA_DEFINER = `'fn_executie_proiect_permis', 'fn_executie_acces_proiect_seteaza',`
const caDefiner = (t, cap, nume) => inlocuieste(inlocuieste(t, cap + `\nLANGUAGE sql STABLE SECURITY INVOKER`, cap + `\nLANGUAGE sql STABLE SECURITY DEFINER`),
  LISTA_DEFINER, LISTA_DEFINER + ` '${nume}',`)
raport('M40 părintele citit ca proprietar (r8: oracolul „șantier fără proiect” / „pachet” pentru B0)', await scenariu('m40', {
  mutMig: t => caDefiner(t, 'CREATE FUNCTION public.fn_executie_acces_parinte_permis(p_tip text, p_id bigint, p_scriere boolean) RETURNS boolean', 'fn_executie_acces_parinte_permis'),
}), false, /T3e FAIL: (oracol de existență pentru b0|cazul literal r8 \(B0)/)
raport('M41 obiectul Storage căutat ca proprietar (r8: oracolul Inboxului — rând ascuns al altui modul)', await scenariu('m41', {
  mutMig: t => caDefiner(t, 'CREATE FUNCTION public.fn_executie_acces_obiect_permis(p_bucket text, p_name text, p_scriere boolean, p_inlocuire boolean DEFAULT false) RETURNS boolean', 'fn_executie_acces_obiect_permis'),
}), false, /T3e FAIL: (oracol de existență pentru b|cazul literal r8 \(B, Inbox)/)
// P2: poarta din r8 (fără dreptul pe modul): A0 ar ajunge iar la original (amprenta porții recalculată, ca postcondiția / revenirea să nu pice)
const POARTA_R8 = t => t.replace(`                  WHERE public.fn_executie_nod_drept(\n`, `                  WHERE public.fn_executie_proiect_permis(\n`)
raport('M42 poarta swap fără dreptul pe modul (ca în r8)', await scenariu('m42', {
  mutMig: t => {
    const m = inlocuieste(t, `                  WHERE public.fn_executie_nod_drept(\n`, `                  WHERE public.fn_executie_proiect_permis(\n`)
    return inlocuieste(m, POARTA_MD5, md5(corp(m, POARTA_CAP)))
  },
  mutRev: t => inlocuieste(t, POARTA_MD5, md5(corp(POARTA_R8(citeste(MIG).replace(/\r\n/g, '\n')), POARTA_CAP))),
}), false, /T3e FAIL[^\n]*(swap|schimbul)/)
// r10: ramura folderului propriu (adevărat fără nicio citire) deschisă spre ORICE folder
// r11: ramura are forma strictă a prefixului și „NOT p_inlocuire” (modificarea / ștergerea refuzate)
const PREFIX_PROPRIU = `p_name LIKE auth.uid()::text || '/_%'`
// r12: încărcarea cere în plus calea fără niciun rând în coadă (fn_executie_acces_inbox_propriu_liber)
const CORP_PROPRIU = `NOT p_inlocuire AND (NOT p_scriere OR public.fn_executie_acces_inbox_propriu_liber(p_name))`
const RAMURA_PROPRIU = `              WHEN p_bucket = 'ai-documente-inbox' AND ${PREFIX_PROPRIU} THEN\n                ${CORP_PROPRIU}\n`
raport('M43 folderul propriu al Inboxului: ramura „adevărat” răspunde și pentru alte foldere', await scenariu('m43', {
  mutMig: t => inlocuieste(t, RAMURA_PROPRIU, RAMURA_PROPRIU.replace(PREFIX_PROPRIU, `split_part(p_name, '/', 1) <> ''`)),
}), false, /T3i FAIL|T3e FAIL/)
raport('M44 documente-proiect: contul restrâns scrie după rândul vizibil (fișier comun cu un proiect ascuns)', await scenariu('m44', {
  mutMig: t => inlocuieste(t, `              WHEN p_bucket = 'documente-proiect' AND p_scriere THEN false\n`, ''),
}), false, /T3e FAIL[^\n]*documente_s/)
// r10: funcția din r9 (rândul citit ca proprietar în folderul propriu) pusă la loc, cu postcondițiile ajustate ca să ajungă la harness:
// T3i / T3f / T3e trebuie să prindă oracolul din verdictul r9 (fișierul propriu cu rând pe p3 ascuns, cale inexistentă vizibilă)
const FN_R9 = `CREATE FUNCTION public.fn_executie_acces_inbox_propriu(p_name text, p_scriere boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT p_scriere IS NOT NULL AND p_name IS NOT NULL AND auth.uid() IS NOT NULL
    AND split_part(p_name, '/', 1) = auth.uid()::text AND position('..' IN p_name) = 0
    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i
                     WHERE i.fisier_path = p_name
                       AND public.fn_executie_acces_inbox_rand(i.modul_tinta, i.entitate_id::bigint, i.uploadat_de, p_scriere) IS NOT TRUE)
$f$;
`
raport('M45 folderul propriu citește iar rândul ca proprietar (funcția din r9 = oracolul din verdictul r9)', await scenariu('m45', {
  mutMig: t => {
    let m = inlocuieste(t, RAMURA_PROPRIU, `              WHEN p_bucket = 'ai-documente-inbox' AND split_part(p_name, '/', 1) = auth.uid()::text THEN\n                NOT p_inlocuire AND public.fn_executie_acces_inbox_propriu(p_name, p_scriere)\n`)
    m = inlocuieste(m, 'CREATE FUNCTION public.fn_executie_acces_candidati(', FN_R9 + 'CREATE FUNCTION public.fn_executie_acces_candidati(')
    m = inlocuieste(m, GRANT_PUBLIC_ULTIM, GRANT_PUBLIC_ULTIM + `\nREVOKE ALL ON FUNCTION public.fn_executie_acces_inbox_propriu(text, boolean) FROM PUBLIC, anon, authenticated, service_role;`
      + `\nGRANT EXECUTE ON FUNCTION public.fn_executie_acces_inbox_propriu(text, boolean) TO authenticated;`)
    m = inlocuieste(m, `p.proname = 'fn_executie_proiect_permis')) <> 18\n`, `p.proname = 'fn_executie_proiect_permis')) <> 19\n`)
    m = inlocuieste(m, `     OR to_regprocedure('public.fn_executie_acces_inbox_propriu(text, boolean)') IS NOT NULL\n`, '')
    m = inlocuieste(m, `'fn_executie_acces_inbox_rand', 'fn_executie_acces_candidati',`, `'fn_executie_acces_inbox_rand', 'fn_executie_acces_inbox_propriu', 'fn_executie_acces_candidati',`)
    return inlocuieste(m, LISTA_EXACTA, LISTA_EXACTA.replace(`'fn_executie_acces_inbox_rand',`, `'fn_executie_acces_inbox_rand', 'fn_executie_acces_inbox_propriu',`))
  },
}), false, /T3i FAIL[^\n]*fișierul propriu|T3f FAIL|T3e FAIL/)
// r11 (review r10 P1, ambii recenzenți): ramura din r10 (adevărat și la modificare / ștergere) = ștergere + re-urcare sub rândul ascuns
raport('M46 folderul propriu: modificarea / ștergerea permise iar (ramura din r10)', await scenariu('m46', {
  mutMig: t => inlocuieste(t, RAMURA_PROPRIU, RAMURA_PROPRIU.replace(CORP_PROPRIU, 'true')),
}), false, /T3i FAIL[^\n]*fișierul propriu|T3f FAIL|T3e FAIL[^\n]*inbox_m/)
// predicatul corect, dar politicile UPDATE / DELETE nu-i mai cer înlocuirea (îl cheamă ca pe INSERT)
raport('M47 politicile UPDATE / DELETE fără al 4-lea argument', await scenariu('m47', {
  mutMig: t => inlocuieste(inlocuieste(t, `USING (%s) WITH CHECK (%s)', v_inl, v_inl);`, `USING (%s) WITH CHECK (%s)', v_scr, v_scr);`),
    `FOR DELETE TO authenticated USING (%s)', v_inl);`, `FOR DELETE TO authenticated USING (%s)', v_scr);`),
}), false, /T3i FAIL[^\n]*fișierul propriu|T3f FAIL/)
// P2: prefixul din r10 (split_part) acceptă calea egală exact cu uuid-ul
raport('M48 folderul propriu: prefixul nestrict (calea = uuid-ul, fără `/`)', await scenariu('m48', {
  mutMig: t => inlocuieste(t, RAMURA_PROPRIU, RAMURA_PROPRIU.replace(PREFIX_PROPRIU, `split_part(p_name, '/', 1) = auth.uid()::text`)),
}), false, /T3e FAIL: r11 folderul propriu/)
// ștergerea permisă doar când rândul e VIZIBIL și permis = răspunsul depinde iar de rândul din coadă (oracol)
raport('M49 folderul propriu: ștergerea urmează rândul vizibil (oracol)', await scenariu('m49', {
  mutMig: t => inlocuieste(t, RAMURA_PROPRIU, RAMURA_PROPRIU.replace(CORP_PROPRIU,
    `(${CORP_PROPRIU}) OR EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = p_name\n                  AND public.fn_executie_acces_inbox_rand(i.modul_tinta, i.entitate_id::bigint, i.uploadat_de, true))`)),
}), false, /T3f FAIL|T3e FAIL[^\n]*inbox_m|T3i FAIL/)

// r12 (review r11, Jakarinos P1): obiectul șters de altcineva, rândul rămas ascuns — încărcarea pe aceeași cale
const FN_LIBER_CAP = 'CREATE FUNCTION public.fn_executie_acces_inbox_propriu_liber(p_name text) RETURNS boolean'
const FN_LIBER_CAUTA = `    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = p_name)\n$f$;`
raport('M50 folderul propriu: încărcarea nu mai cere calea fără rând (ramura din r11 = re-ocuparea din verdictul r11)', await scenariu('m50', {
  mutMig: t => inlocuieste(t, RAMURA_PROPRIU, RAMURA_PROPRIU.replace(CORP_PROPRIU, 'NOT p_inlocuire')),
}), false, /T3f FAIL/)
// funcția citește rândurile sub RLS-ul apelantului (lista DEFINER din postcondiție ajustată, ca mutantul să ajungă la harness)
raport('M51 garda r12 citește rândul ca apelantul (rândul ascuns = cale liberă)', await scenariu('m51', {
  mutMig: t => inlocuieste(inlocuieste(t, FN_LIBER_CAP + `\nLANGUAGE sql STABLE SECURITY DEFINER`, FN_LIBER_CAP + `\nLANGUAGE sql STABLE SECURITY INVOKER`),
    `'fn_executie_acces_inbox_rand', 'fn_executie_acces_candidati',\n                                                                       'fn_executie_acces_inbox_propriu_liber'))`,
    `'fn_executie_acces_inbox_rand', 'fn_executie_acces_candidati'))`),
}), false, /T3f FAIL/)
// potrivire diferită de garda 4d (fără diferența de litere): calea „aproape identică” ar fi refuzată
raport('M52 garda r12 potrivește calea altfel decât garda 4d (lower)', await scenariu('m52', {
  mutMig: t => inlocuieste(t, FN_LIBER_CAUTA, FN_LIBER_CAUTA.replace('WHERE i.fisier_path = p_name', 'WHERE lower(i.fisier_path) = lower(p_name)')),
}), false, /T3f FAIL[^\n]*(încărcarea pe o cale liberă|pe i)/)
raport('M53 garda r12 fără EXECUTE pentru authenticated (orice încărcare a contului restrâns ar pica)', await scenariu('m53', {
  mutMig: t => inlocuieste(t, `GRANT EXECUTE ON FUNCTION public.fn_executie_acces_inbox_propriu_liber(text) TO authenticated;\n`, ''),
}), false, /functii noi \(definer/)
// apelată direct, garda ar răspunde și pentru folderele altora = oracol de existență pe rândurile ascunse
raport('M54 garda r12 răspunde și în afara folderului propriu (oracol prin RPC)', await scenariu('m54', {
  mutMig: t => inlocuieste(t, `    AND p_name LIKE auth.uid()::text || '/_%' AND position('..' IN p_name) = 0\n    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = p_name)`,
    `    AND position('..' IN p_name) = 0\n    AND NOT EXISTS (SELECT 1 FROM public.ai_documente_inbox i WHERE i.fisier_path = p_name)`),
}), false, /T3e FAIL[^\n]*inbox_liber/)
raport('M55 revenirea uită garda r12', await scenariu('m55', {
  mutRev: t => inlocuieste(t, `  DROP FUNCTION public.fn_executie_acces_inbox_propriu_liber(text);`, ''),
}), false, /revenire post: au ramas obiecte|starea nu e cea/)

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
// r3
raport('P14 tabel „comun” care ajunge totuși la un tabel acoperit', await scenariu('p14', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.employees ADD COLUMN tura_id bigint REFERENCES public.executie_ture(id);',
}), false, /clasificate „comun” care ajung.*employees/)
raport('P15 fn_executie_swap_tevi_pozitie cu alt corp decât cel revizuit', await scenariu('p15', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, `RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet'`, `RAISE EXCEPTION 'Tevile nu sunt in acelasi pachet (alt corp)'`),
}), false, /fn_executie_swap_tevi_pozitie lipseste, are alt corp/)
raport('P16 funcția de drept delegată (fibra) cu alt corp', await scenariu('p16', { doarMigrarea: true,
  mutDrept: t => inlocuieste(t, `SELECT coalesce(public.fn_executie_nod_drept(p_proiect, p_scriere), false)`, `SELECT coalesce(public.fn_executie_nod_drept(p_proiect, false), false)`),
}), false, /functii de drept delegate.*fn_executie_fibra_drept/)
raport('P17 tabel „drept” fără funcția lui', await scenariu('p17', { doarMigrarea: true,
  inainte: 'DROP POLICY executie_fibra_intervale_citire ON public.executie_fibra_intervale; DROP FUNCTION public.fn_executie_fibra_drept(bigint, boolean);',
}), false, /functie de drept lipsa sau necunoscuta.*executie_fibra_intervale/)
raport('P18 tabel nou al cumulatului (copil al unui tabel acoperit r3), neclasificat', await scenariu('p18', { doarMigrarea: true,
  inainte: 'CREATE TABLE public.cumulat_note (id bigserial PRIMARY KEY, cumulat_id bigint REFERENCES public.executie_pachete_cumulat_final(id), nota text);',
}), false, /neclasificate in inventar.*cumulat_note/)
raport('P19 funcție SECURITY DEFINER nouă cu nume „de alt modul” care citește un tabel acoperit (fără excluderi pe prefix)', await scenariu('p19', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_izo_scurgere(p bigint) RETURNS SETOF public.executie_tevi LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.executie_tevi WHERE pachet_id = p $f$;
            GRANT EXECUTE ON FUNCTION public.fn_izo_scurgere(bigint) TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_izo_scurgere/)

// r4
raport('P20 coada Inboxului AI fără RLS', await scenariu('p20', { doarMigrarea: true,
  inainte: 'ALTER TABLE public.ai_documente_inbox DISABLE ROW LEVEL SECURITY;',
}), false, /ai_documente_inbox nu are RLS pornit/)
raport('P21 predicatul Inboxului AI cu alt corp decât cel revizuit', await scenariu('p21', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, `IF p_modul = 'logistica'  THEN RETURN v_rec.role = 'admin_logistica'; END IF;`, `IF p_modul = 'logistica'  THEN RETURN true; END IF;`),
}), false, /functii SECURITY DEFINER.*fn_ai_inbox_poate_confirma/)
raport('P22 funcție SECURITY DEFINER nouă care citește antetul raportului zilnic', await scenariu('p22', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_rapoarte_toate() RETURNS SETOF public.rapoarte_zilnice LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
              AS $f$ SELECT * FROM public.rapoarte_zilnice $f$;
            GRANT EXECUTE ON FUNCTION public.fn_rapoarte_toate() TO authenticated;`,
}), false, /functii SECURITY DEFINER.*fn_rapoarte_toate/)

// r8: review SQL P2-01 — nimic nu ține originalul swap după OID; niciun corp nu-l numește; bucket-urile predicatului = inventarul
raport('P23 funcție cu corp SQL standard legată de originalul swap (pg_depend)', await scenariu('p23', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_dep_swap() RETURNS void LANGUAGE sql BEGIN ATOMIC SELECT public.fn_executie_swap_tevi_pozitie(1, 2); END;`,
}), false, /legate de fn_executie_swap_tevi_pozitie dupa OID/)
raport('P24 funcție care numește originalul swap în corp', await scenariu('p24', { doarMigrarea: true,
  inainte: `CREATE FUNCTION public.fn_cheama_swap() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.fn_executie_swap_tevi_pozitie(1, 2); END $f$;`,
}), false, /functii care numesc fn_executie_swap_tevi_pozitie.*fn_cheama_swap/)
raport('P25 inventarul nu mai acoperă un bucket numit de predicatul Storage', await scenariu('p25', { doarMigrarea: true,
  mutMig: t => inlocuieste(t, `  ('bucket', 'documente-proiect', 'tabel', NULL, NULL,`, `  ('bucket', 'documente-proiect', 'exclus', NULL, NULL,`),
}), false, /bucket-urile acoperite din inventar difera/)
// r9: predicatele INVOKER au nevoie de dreptul de citire pe coloanele căutate și de politici ale părinților care nu citesc copilul (buclă)
raport('P26 authenticated nu poate citi proiectul șantierului (predicatul INVOKER ar da 42501)', await scenariu('p26', { doarMigrarea: true,
  inainte: 'REVOKE SELECT ON public.sites FROM authenticated; GRANT SELECT (id, name) ON public.sites TO authenticated;',
}), false, /nu poate citi coloanele cautate.*sites\.proiect_id/)
raport('P27 politica unui părinte citește copilul (buclă la evaluare)', await scenariu('p27', { doarMigrarea: true,
  inainte: `CREATE POLICY bucla ON public.executie_pachete_lansare AS RESTRICTIVE FOR SELECT TO authenticated
              USING (EXISTS (SELECT 1 FROM public.executie_tevi t WHERE t.pachet_id = executie_pachete_lansare.id) OR true);`,
}), false, /bucla[^\n]*executie_pachete_lansare\.bucla -> executie_tevi/)
// r12: garda încărcării potrivește calea exact ca garda 4d — aceeași colație și indexul unic al căii
raport('P28 calea din coadă cu altă colație decât numele obiectului', await scenariu('p28', { doarMigrarea: true,
  mutSchelet: t => inlocuieste(t, `id bigserial PRIMARY KEY, fisier_path text NOT NULL,`, `id bigserial PRIMARY KEY, fisier_path text COLLATE "POSIX" NOT NULL,`),
}), false, /calea Inboxului[^\n]*alta colatie/)
raport('P29 fără indexul unic al căii din coadă', await scenariu('p29', { doarMigrarea: true,
  inainte: 'DROP INDEX public.idx_ai_inbox_fisier_path;',
}), false, /calea Inboxului[^\n]*indexul unic/)

console.log(esecuri ? `\n${esecuri} scenarii NU s-au comportat cum trebuie` : '\nToate scenariile s-au comportat cum trebuie')
process.exit(esecuri ? 1 : 0)
