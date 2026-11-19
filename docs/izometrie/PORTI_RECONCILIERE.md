# Porțile Izometrie: reconcilierea din 19.11.2026 și regula pentru migrările viitoare

Porțile Izometrie (`fn_izo_porti_lipsa()` = E2a, care cheamă și E3 / E3b / E4 / E4b) verifică, la fiecare salvare / activare, că
schema pe care se sprijină registrul e cea revizuită. Fiecare poartă își compară **definițiile** de acum (`fn_izo_porti_*_definitii()`, un
md5 peste corpuri de funcții, drepturi, trigger-e, politici, coloane, secvențe, roluri) cu **ștampila** pusă la migrare
(`COMMENT ON FUNCTION … IS 'porti*=<md5>'`). Orice diferență = poarta roșie = salvarea refuzată (fail-closed, intenționat).

## Reconcilierea din 19.11.2026 (TKT-2026-0393, migrarea `20261230a_izometrie_porti_reconciliere`)

**Simptomul:** salvarea în Izometrie refuzată pe producție; porțile E2 / E3 / E3b / E4 / E4b roșii.

**Cauza** (analiza coordonatorului pe producție, doar citire): ștampilele au fost puse ultima dată de `20261120a`. După ea s-au aplicat
trei migrări legitime din repo, din alte module, care au schimbat obiecte amprentate de porți fără să refacă ștampilele:

| Migrarea | Ce a schimbat | Porțile atinse |
|---|---|---|
| `20261209a_executie_acces_proiect` | trigger-ul `trg_executie_acces_garda` pe `executie_tevi` / `executie_pachete_lansare` / `executie_pachete_documente` / `executie_tronsoane`; 4 politici RESTRICTIVE `executie_acces_*` pe `executie_proiecte` și `executie_tronsoane` | E4, E4b |
| `20261211a_executie_fibra_optica` | trigger-ul `trg_executie_fibra_garda_tronson` pe `executie_tronsoane` | E4 |
| `20261218a_securitate_anon_drepturi` | drepturile `anon` retrase de pe secvențe (între ele `magazie_bucati_id_seq` și secvențele documentelor izo) | E2a, E3, E3b, E4b |

Fiecare ștampilă se reconstruiește **exact** din starea de azi cu aceste schimbări scoase: nicio diferență neexplicată, deci nicio
schimbare manuală. Plus două semnale ale porții E2 care nu sunt ștampile, ambele fals-pozitive cunoscute ale euristicii închiderii:

1. excepția revizuită a trigger-ului `on_auth_user_created` (auth.users → `handle_new_user()`) poartă amprenta corpului; `20261119a`
   (Portal E1-1b) a rescris corpul ⇒ excepția a căzut. Amprenta nouă `b1858fddd590635b445127fd6c680d97` (refăcută și din corpul din repo).
2. porțile portalului `fn_portal_porti_lipsa()` / `fn_portal_porti_lipsa_1b()` intră ca „SQL dinamic” din cauza literalului
   `'EXECUTE'` din `has_function_privilege`. Ca `fn_conturi_inchideri_sweep`, trec pe lista revizuită `c_dinamice_revizuite`, cu amprenta
   `md5(prosrc | proconfig | owner | proacl | prosecdef)`; `fn_portal_1b_snapshot()` iese apoi singură din închidere.

**Ce face `20261230a`** (o tranzacție, prin runner, plafon 5000 + amprenta globală L15 v2):

1. gărzi PRE: cele 5 ștampile stocate, cele 5 definiții de acum, corpul + proprietățile + ACL-ul porții E2, corpurile
   `fn_izo_porti_definitii` / `fn_izo_porti_e3_lipsa` / `fn_izo_porti_e4_lipsa`, amprenta trigger-ului și a porților portalului = valorile
   analizate (altfel refuz, nimic schimbat);
2. `CREATE OR REPLACE fn_izo_porti_lipsa()` = corpul de pe producție (`20261109b`) cu **exact** cele două schimbări de listă (generat de
   `scripts/izometrie/reconciliere/gen_20261230a.mjs`; testul refăce diff-ul pe linii);
3. cele 5 ștampile refăcute, **după** corp (E2a și E4b includ corpurile `fn_izo_*`);
4. gărzi POST: corpul nou cu aceleași proprietăți și același ACL, fiecare ștampilă = definiția ei, E3 / E3b / E4 = exact definițiile de
   dinainte, restul funcțiilor și toate celelalte comentarii neschimbate, `fn_izo_porti_lipsa() = '{}'`.

De ce doar cu amprenta globală: refacerea ștampilelor acceptă catalogul din momentul ei. Pasul „după” al runnerului (diferența = exact
manifestul, o singură linie: `functie public.fn_izo_porti_lipsa()` „schimbat”) refuză orice altă schimbare apărută în aceeași tranzacție.
Comentariile (ștampilele) nu sunt în amprenta globală; le acoperă POST-ul migrării (instantaneul tuturor funcțiilor și comentariilor).

**Revenirea** (`supabase/revenire/20261230a_…_ROLLBACK.sql`, plafon 2000) pune la loc corpul vechi și ștampilele vechi exact; porțile
redevin roșii (starea de dinainte), deci e doar pentru o problemă a migrării. O revenire mai veche care fixează corpul porții
(ex. `20261120a`) se rulează doar după ea.

**Probe:** `scripts/pglite/test_izometrie_porti_reconciliere_local.mjs` (poarta E2 reală pe o schemă falsă; istoria de pe producție
refăcută — aceleași semnale; aplicare, refuzuri PRE, mutanți, revenire, validatorul runnerului) și `src/izoPortiReconciliere.test.js`.

## Livrarea pe producție (procedura înlocuitoare a probei pe clonă) — de judecat în review

**Faptul:** proba pe clonă în forma cerută (manifest, ROLLBACK ×3, aplicare → revenire → reaplicare) **nu se poate face**. Definițiile
porților pun în amprentă oid-uri de rol (`relowner` / `proowner` brute, `polroles`), care diferă pe orice clonă; garda PRE 2 refuză deci
pe orice clonă (proba coordonatorului pe clona 176, 19.11.2026: definițiile clonei f13743e0… / c8e54134… / 7bdcbc9b… / e46e8a12… /
e99a4c45… față de cele de producție; plus stub-urile clonei: fără trigger-ul `on_auth_user_created`, fără RLS / politicile izo pe
`storage.buckets`). Simularea cu ROLLBACK pe clonă a confirmat logica: corpul nou are md5 `23da4c3c9e4639f3600197f3d7b88977`, iar
semnalele DEFINER / E2a / E3 / E3b / E4 / E4b dispar (rămâne doar semnalul stub-ului Storage, artefact al clonei).

**Procedura propusă** (pe PRODUCȚIE, prin runner; fiecare pas care atinge producția cere „da”-ul lui Răzvan; pașii a–b nu comit nimic):

0. *(doar citire)* `fn_izo_porti_lipsa()` = semnalele analizate (DEFINER + trigger-ul `on_auth_user_created` + cele 5 ștampile) și
   amprenta globală curentă (`scripts/amprenta_globala_citire.sh`) = GLOBAL.
1. **(a) manifestul L15, generat pe producție, în tranzacție cu ROLLBACK** (modul `--iesire` al generatorului aplică migrarea în forma
   livrării și dă ROLLBACK în locul COMMIT-ului; mesajul are alt alias, deci nu poate fi confundat cu o livrare):

   ```bash
   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --versiune 20261230120000 \
     --tinta-host <H> --tinta-port <P> --tinta-db postgres --tinta-sistem <SIS producție> --user <U> --plafon-tranzactie-ms 5000 \
     --iesire supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv --detalii <în afara repo-ului>/20261230a.l15.detalii.txt
   diff <(grep -v '^#' supabase/tests/20261230a_izometrie_porti_reconciliere.l15.obiecte.tsv | sort) \
        <(grep -v '^#' supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv | cut -f1-3 | sort)   # gol
   ```

   Lista revizuită (`supabase/tests/20261230a_izometrie_porti_reconciliere.l15.obiecte.tsv`) = **exact un rând**: `functie
   public.fn_izo_porti_lipsa()` „schimbat”. În detalii, rândul are `md5(prosrc)` = `23da4c3c9e4639f3600197f3d7b88977` și aceleași
   owner / DEFINER / search_path / ACL ca înainte. Cele 5 ștampile nu apar (familia comentariilor nu e în amprenta globală) — le
   verifică POST-ul. **Abatere declarată:** antetul generatorului spune „generarea DOAR pe clonă”; aici e pe producție pentru că PRE-ul
   nu poate trece pe nicio clonă. Generarea nu comite nimic; ține lock-ul consultativ al runnerului cât durează (salvările Izometrie
   așteaptă, apoi continuă). Manifestul generat intră în PR (commit nou), înainte de aplicare.
2. **(b) proba `--compara-cu`, de 3 ori, cu ROLLBACK**, pe același GLOBAL:

   ```bash
   bash scripts/livrare_l15_manifest.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --versiune 20261230120000 \
     --tinta-host <H> … --plafon-tranzactie-ms 5000 --compara-cu supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv \
     --amprenta-globala <GLOBAL>
   ```

   De fiecare dată IDENTIC (cod 0); timpii din lista de la final (lock / sfârșit / LOCK_TINUT) sub plafonul de 5000 ms, notați.
3. **(c) aplicarea**, cu plafonul 5000 și amprenta globală:

   ```bash
   bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261230a_izometrie_porti_reconciliere.sql --aprobare aprobare_20261230a.txt \
     --versiune 20261230120000 --tinta-db postgres --tinta-sistem <SIS> --tinta-host <H> --tinta-port <P> --user <U> \
     --plafon-tranzactie-ms 5000 --amprenta-globala <GLOBAL din pasul b> \
     --diferente-globale supabase/migrations/20261230a_izometrie_porti_reconciliere.l15.tsv
   ```

4. **(d) POST** *(doar citire)*: `fn_izo_porti_lipsa() = '{}'`; md5 corp = `23da4c3c…`; fiecare ștampilă = definiția ei; apoi **o
   salvare Izometrie reală, făcută de un utilizator** (poarta nu mai refuză), Ctrl+Shift+R înainte.
5. **(e) revenirea pregătită, NU rulată**: comanda exactă din antetul `supabase/revenire/20261230a_…_ROLLBACK.sql` (`--sha256 <sha>
   --versiune 20261230120001 … --plafon-tranzactie-ms 2000`). Se rulează doar la o problemă a migrării; porțile redevin roșii.

**Ce NU dovedește procedura (riscuri reziduale, declarate):** aplicare → revenire → reaplicare pe un catalog Supabase real (revenirea e
probată doar în PGlite, cu substituenți pentru E3 / E3b / E4); serializarea concurentă cu salvările reale (lock-ul consultativ exclusiv al
runnerului față de cel partajat al API-ului Izometrie — mecanismul e al runnerului, neprobat aici); probele cu rolurile API pe catalogul
real (le acoperă, parțial, salvarea reală de la pasul d). O variantă „doar pentru clonă” a migrării NU e livrată: valorile clonei se
schimbă la alinierea stub-urilor (RLS / politicile `storage.buckets`, trigger-ul de pe `auth.users`), POST-ul `'{}'` cere oricum
alinierea, iar postcondițiile revenirii sunt valorile literale de producție — n-ar fi „același fișier cu alt BASELINE”, ci o a doua
migrare, cu sha256 diferit de cel aprobat. Se poate face, la cerere, după ce clona e aliniată (generatorul primește valorile clonei).

## REGULA pentru migrările viitoare (de la 20261230a)

**Orice migrare sau revenire care atinge un obiect amprentat de porțile Izometrie** rulează porțile și reface ștampilele **în aceeași
tranzacție**, în forma de mai jos. Excepție: o reconciliere (ca `20261230a`), care fixează starea roșie analizată în locul PRE-ului verde
— intră pe lista veche cu motivul `reconciliere` și are testele ei.

Forma cerută (în blocuri `DO`, fără `EXCEPTION WHEN` în ele, fără `COMMIT` / `ROLLBACK` înainte de POST):

1. **PRE**, înaintea primei schimbări: `IF public.fn_izo_porti_lipsa() IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …` (sau
   `v := public.fn_izo_porti_lipsa(); IF v IS DISTINCT FROM '{}'::text[] THEN RAISE EXCEPTION …`) — porțile trebuie să fie verzi înainte,
   altfel migrarea ar „binecuvânta” o derivă neanalizată;
2. schimbarea;
3. **ștampilele CALCULATE**, după ultima schimbare, toate cinci, exact:
   `EXECUTE format('COMMENT ON FUNCTION public.fn_izo_porti_definitii() IS %L', 'porti=' || public.fn_izo_porti_definitii());` (la fel
   `porti_e3`, `porti_e3b`, `porti_e4`, `porti_e4b`); orice alt `COMMENT ON FUNCTION` pe cele 5 funcții (literal, concatenat) = refuz;
4. **POST**, după ștampile: aceeași gardă;
5. livrarea cu amprenta globală L15 v2; revenirea urmează aceeași formă (PRE verde = starea lăsată de migrare, schimbarea inversă,
   ștampilele calculate, POST).

Dacă o schimbare face poarta roșie din alt motiv decât ștampila (un semnal al închiderii citirilor, o listă revizuită), corecția porții
intră în aceeași migrare, cu review (ca `20261230a`), nu se ocolește.

**Ce înseamnă „atinge”** (detectorul `scripts/izometrie/porti_regula.mjs`, derivat din corpurile `fn_izo_porti_*_definitii()` și din
poarta E2):

* **sigur** (schimbă o amprentă sau poarta): CREATE / ALTER / DROP / GRANT / REVOKE / OWNER / RENAME pe obiectele `izo_*`, `fn_izo_*`,
  `magazie_bucati*`, rolurile `izo_*`, politicile `izo_*` / `magbuc_izo_*` / `*_corectie_*` / `*_coreditor_*`, trigger-ele `*_izo_*`;
  pe `executie_proiecte` / `executie_tronsoane` / `logistica_depozite` (E4b: ACL, coloane, politici); orice trigger de pe
  `executie_tevi` / `executie_pachete_lansare` / `executie_pachete_documente` / `executie_tronsoane` / `izo_tronson_config` (E4) și
  **funcțiile acestor trigger-e** (derivate din toate migrările: `fn_executie_acces_garda`, `fn_executie_fibra_garda_tronson` …);
  funcțiile și trigger-ele de pe listele revizuite ale porții E2 (`c_dinamice_revizuite`, `c_implicite_revizuite`, plus
  `handle_new_user`); indexurile de pe `profiles`; ACL / RLS pe `storage.objects` / `storage.buckets` și rândul bucket-ului `izo-*`;
  drepturile pe secvențele `izo_*` / `magazie_bucati_*` și `ON ALL … IN SCHEMA`, drepturile pe schema `public`; funcțiile SECURITY
  DEFINER cu SQL dinamic (intră în închiderea porții E2) sau care numesc registrul; vederile / regulile peste registru; orice instrucțiune
  care cheamă `fn_izo_*` (CHECK, DEFAULT, politică …); **SQL dinamic cu ținta necunoscută** (`%I`, concatenare); scrierile directe în
  catalog; `REASSIGN` / `DROP OWNED`;
* **posibil**: coloane / drepturi pe `profiles`, `executie_tevi`, `executie_pachete_*`, `executie_bonuri_consum_linii`, `auth.users`;
  trigger-e pe `profiles` / `auth.users`; funcții INVOKER care numesc registrul; `ALTER DEFAULT PRIVILEGES`; trigger-e de eveniment;
  `DROP … CASCADE`; `UPDATE` / `DELETE` pe `storage.buckets`.

La o atingere **posibilă**, migrarea poate declara în loc de ritual un rând `-- IZO_PORTI: neatins — <motiv de cel puțin 10 caractere>`
(la început de rând, nu într-un `/* */`), care intră în review. La o atingere **sigură** declarația nu se acceptă: se face ritualul (e
ieftin și, dacă amprentele nu s-au schimbat, ștampilele recalculate ies identice).

**Literalii: date sau SQL executat (runda 3, review r2 P2).** Un text folosit ca DATĂ nu e DDL: `SELECT 'DROP TABLE
public.izo_importuri;'::text`, un `COMMENT ON … IS '…'`, un `INSERT … VALUES ('…')`, un `DEFAULT` / `CHECK` cu un șir, un `RAISE NOTICE '…'`,
un `format('…')` / `jsonb_build_object('…')` care doar întoarce text nu cer ritualul. Detectorul golește conținutul acestor literali
înainte să caute atingerile. Un literal (`'…'`, `E'…'` sau `$q$…$q$` care nu e corp) **rămâne citit ca SQL** dacă:
(a) e corp de cod (`AS '…'` într-un `CREATE FUNCTION` / `PROCEDURE`, `DO '…'`); (b) e un nume de obiect (`'…'::regclass` și celelalte
`reg*`: constanta intră în `pg_depend`); (c) contextul lui execută text: corpul `DO` / funcție care îl conține are `EXECUTE`, `dblink`,
`*_to_xml`, `cron.schedule` … (un literal poate ajunge în `EXECUTE` printr-o variabilă), iar la nivelul de sus instrucțiunea lui are aceste
cuvinte sau fișierul are meta-comenzi psql (`\gexec`, `\gset`, `:variabila`); (d) e argument al unei funcții care nu e pe lista albă a
funcțiilor pure de text (`FUNCTII_PURE` în detector): `SELECT public.ruleaza('DROP …')` contează. La orice dubiu literalul rămâne
(fail-closed). Două locuri citesc în continuare literalii, ca poarta: **corpul funcțiilor** (poarta caută în `prosrc` textual; un corp care
numește `fn_izo_*` și doar într-un șir e „sigur”, pentru că poarta îl tratează ca wrapper al registrului) și **`fn_izo_*` dintr-un view /
o regulă** (`pg_get_ruledef` e citit textual). Pe cele 495 de fișiere SQL din depozit, față de runda 2, distincția scoate exact 3 atingeri
(un regex pe o cheie `'^izo_e3_ocr:…'` într-un view, un mesaj de eroare `'… GRANT rol TO …'`, o listă de amprente într-o funcție
temporară) și nu adaugă niciuna.

**Verificarea automată (CI):** `.github/workflows/izometrie-porti-regula.yml` rulează la **orice** PR care atinge `supabase/migrations/**`,
`supabase/revenire/**`, detectorul, testul lui sau lista veche — inclusiv pe draft-uri: (1) `node scripts/izometrie/porti_regula.mjs`
(fără dependențe; cod 1 la abatere, cu fișierul și ce lipsește), (2) `npx vitest run src/izoPortiRegula` (regresiile: exemplele din
review, structura, perimetrul, CLI-ul, workflow-ul, mutanții detectorului). Fișierele existente la introducerea regulii stau în
`supabase/tests/izo_porti_regula_vechi.tsv` (cale + sha256 pe textul fără CR): neschimbate = sărite; **schimbate = verificate după
regulă**. Lista e fixată de test (număr + amprentă) — nu se adaugă rânduri. Regula se aplică după nume de fișier, nu după un prag de dată
(numerotarea migrărilor nu e cronologică: `20261131j`, PR #1141, e mai nouă decât `20261226a`). Ca verificarea să blocheze merge-ul, check-ul trebuie
marcat „required” în setările GitHub ale depozitului (setare de owner).

**Limita (declarată, nu ascunsă):** e o verificare **textuală**, cu un lexer SQL (comentarii `--` și `/* */` imbricate, literali
`'…'` / `E'…'` / `"…"`, corpuri `$tag$`, lexate recursiv ca la PostgreSQL). Prinde omisiunile și formele naive; **nu dovedește**:
* nu vede DDL construit din bucăți de text pe care nu le poate citi (verbul însuși concatenat), cod mort (`RETURN;` înaintea gărzii),
  obiecte create manual pe producție, schimbări venite din upgrade-uri Supabase;
* nu urmărește textul prin tabele: un șir inserat azi ca dată și executat mâine de o funcție (`EXECUTE (SELECT sql FROM t)`) se vede doar
  la funcția care execută (DEFINER cu SQL dinamic = sigur), nu la `INSERT`;
* lista perimetrului e derivată din definițiile de azi: o poartă nouă / o definiție extinsă cere actualizarea detectorului (testul
  citește listele revizuite din poarta E2, dar tiparele de nume sunt scrise de mână);
* fals-pozitivele sunt acceptate (fail-closed): din cele 154 de migrări / reveniri de la `20261120a` încolo, 33 ar fi cerut ritualul sau
  declarația, majoritatea pentru SQL dinamic (`format('… %I …')`), unde ținta nu se poate citi.
Adevărul rămâne poarta (`fn_izo_porti_lipsa()`) și manifestul L15 la livrare.
