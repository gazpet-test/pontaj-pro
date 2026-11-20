# Porțile Izometrie: regula pentru migrările viitoare (de la 20261230a)

Contextul (de ce există porțile, reconcilierea din 19.11.2026 și livrarea ei): `docs/izometrie/PORTI_RECONCILIERE.md`.

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

**Corpurile scrise ca literal și constantele `reg*` (runda 4, review r3).** (1) Un corp `AS '…'` / `DO '…'` / `AS E'…'` e rescris, înainte
de orice analiză, ca `$corpN$ … $corpN$` cu ghilimelele decodate (`''` → `'`, în `E'…'` și `\'`, `\\`): PostgreSQL pune în `prosrc` și
execută exact textul decodat, deci `AS 'SELECT ''DROP …''::text'` se judecă identic cu `AS $$ SELECT 'DROP …'::text $$` (testul de paritate
rescrie toate cazurile cu corp `$…$` în forma `'…'` și cere aceleași atingeri și același verdict). Un corp `E'…'` cu alte escape-uri (`\n`,
`\x27` …) nu se rescrie: rămâne literal citit integral ca SQL (fail-closed; un literal-dată din el dă un fals pozitiv, acceptat).
(2) Regula (b) nu mai caută castul imediat după literal: dacă instrucțiunea numește un tip `reg*` **oriunde** (`('…')::regclass`,
`CAST(('…') AS regclass)`, `'…'::text::regclass`, `regclass '…'`), toți literalii ei rămân citiți. Pe cele 495 de fișiere SQL din
depozit, față de runda 3: zero diferențe.

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
