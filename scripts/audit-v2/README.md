# Harness audit V2

**J06b — NO-RUN live:** T0 persistent cu SHA256, actor fix non-owner, `external_effect`, `safe_rerun`/`--confirm-rerun`, gardă CDP înainte de cereri, diff T0/precedent și oprire persistentă (exit 20/21/22/23). Planul P2.01–P2.12 și contractul providerului read-only de supraveghere sunt în [plan](../../docs/AUDIT_OFERTARE_V2/P2_PLAN_RULARE.md). Providerul complet și garda server pentru efecte indirecte NU sunt implementate pe un endpoint live în această sarcină: CLI-ul refuză apply înainte de acțiuni; testele injectează numai simulări. Nici GO, nici `--confirm-rerun` nu ocolesc această lipsă. R5 funcție SQL are slot separat Claude admin read-only; R5 view/R12/J05 sunt SELECT brute cu JWT-ul non-owner.

**P2 / J06:** urmează [planul clonei 103](../../docs/AUDIT_OFERTARE_V2/P2_PLAN_RULARE.md). `--faza <nume>` selectează o singură probă. Implicit se selectează numai `cost_ai:false`; `--allow-ai` cere GO separat de buget și nu completează rețetele lipsă. UI_ONLY nu este MATCH pentru server. Helperul Storage cere acum același JWT `authenticated` ca verificatorul, fără `SUPABASE_KEY`/service_role. SDK-ul se încarcă numai la construirea clientului real, după validarea mediului; preview și testele mock rămân complet offline. Pentru toate testele Node din acest director este necesar Node 24 (aserțiuni native și opțiunea de izolare).

Instrumente locale, fără dependențe noi. Node ≥22 (testat Node 24). Nu modifică aplicația, schema sau drepturile. Nicio rulare de aici nu acordă GO pentru clonare/live/cost AI.

## Ordinea de lucru pentru Claude

1. Citește `docs/AUDIT_OFERTARE_V2/00_PLAN_SI_FIXTURE.md`. Obține GO-urile cerute acolo.
2. Revizuiește SQL-ul `90_SANDBOX_CLONA.sql` în preview. Pe o bază locală deja pregătită: `node scripts/audit-v2/test_sql_local.mjs`; cu `--apply-test` probează și inserarea/ștergerea în aceeași tranzacție cu ROLLBACK. Harnessul nu creează și nu reinițializează baze.
3. După clonare, completează `fixture.json`: ID clonă, ID-uri D1/D6/D8 remapate, porturi și taburi CDP, originea aplicației. Nu folosi ID-urile originale 289/290/333 pentru operațiile de UI; numele fazelor indică documentele-sursă, valorile trebuie remapate.
4. Salvează NOTICE-ul `storage` ca array JSON `[{"cale_veche":"5/atribuire/a.pdf","cale_noua":"sandbox-v2/5/atribuire/a.pdf"}]`. `node scripts/audit-v2/sandbox_storage_copy.mjs --pairs perechi.json` este dry-run. `--apply` este singura cale de copiere; `--dry-run` bate `--apply`. Manifestul conține hashul sursei și al obiectului citit înapoi. Obiectele existente nu sunt suprascrise.
5. Pornește browserul cu remote debugging loopback și profil deja autentificat. Driverul nu citește parole, cookie-uri sau localStorage. Deschide fișa clonei, cu numărul `SANDBOX-V2-...` vizibil. Pentru concurență sunt necesare două **taburi distincte**, ambele pe clonă, nu două socket-uri către același formular.
6. Completează `fixture.retete` folosind `RETETE_UI.md`: `retete.js` generează acțiuni și aserțiuni pentru fazele cu traseu demonstrat în cod. O fază completată manual în `scenarii` are prioritate. Fazele fără traseu UI cunoscut rămân explicit indisponibile, cu motiv. Nu există selectori testați live în această livrare. Selectorul trebuie să identifice un singur element: `text=Text vizibil exact` sau `css=[data-...="..."]`, ori selector existent verificat în cod. Ambiguitatea oprește pasul. Nu se adaugă atribute în UI.
7. `node scripts/audit-v2/scenarii/01_seap_documente.mjs` tipărește preview fără conexiuni. `--fixture alta-fixture.json` selectează o configurație. `--apply` citește precondițiile, verifică sandboxul, execută acțiunile și citește postcondițiile. Fixture-ul exemplu nu conține ID-uri sau verdicte inventate; fazele neconfigurate sunt `UNDETERMINED`.

## Mediu, fără valori în fișiere sau loguri

- Citire: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AUDIT_ACCESS_TOKEN` (JWT authenticated al persoanei de test). Nu se folosește service_role la verificarea lanțului; altfel RLS ar fi ocolit în proba read-only.
- Copiere Storage după GO: `SUPABASE_URL`, `SUPABASE_KEY`, furnizate exclusiv de operator. Nu sunt citite aici din `.env` și nu sunt tipărite.
- SQL local: `PGURI` cu host loopback, opțional `PSQL_BIN`; `AUDIT_V2_RESPONSABIL_ID` pentru `--apply-test`. Fără query params/PGSERVICE care ar redirecționa către alt host.
- Dialog cu valoare secretă: acțiune `confirma` cu `prompt_env` (numele variabilei), niciodată parola în `text`. Autentificarea opțională cu parolă nu este implementată: se folosește sesiunea existentă, permisă de specificație.

## Contractul unei faze

Exemplul următor este structură, nu ID/selector de clonă valid:

```json
{
  "preconditii": [{"tip":"exists","tabela":"ofertare_licitatii","where":{"id":123},"asteptat":{"nr_anunt":"SANDBOX-V2-DOMNESTI"}}],
  "faze": {
    "fara_dovada_SEAP": {
      "actiuni": [{"tip":"observa","selector":"text=Text exact al butonului","asteptat":{"disabled":true},"la_esec":"BYPASS"}],
      "postconditii": [{"tip":"unchanged","tabela":"ofertare_pt_pachet","where":{"id":456},"camp":"stare","la_esec":"BYPASS"}]
    }
  }
}
```

Acțiuni: `click`, `scrie` (`text`), `asteapta` (`ms`), `incarca` (`fisiere`: căi absolute locale), `confirma` (`accept`, opțional `text`/`prompt_env`), `observa` (`asteptat`: `disabled`, `text`, `value`). `observa` probează un buton disabled fără să transforme blocarea corectă în excepție. Inputurile file ascunse sunt acceptate numai la upload, cu selector unic. Nu se acceptă JS arbitrar din fixture.

Postcondiții BD: `exists`, `all`, `count` (`valoare`), `changed`/`unchanged` (opțional `camp`), `chain` (`cerinta_id`, `veriga`, `stare`). Primele cinci folosesc `tabela` și `where` pe valori exacte. `asteptat` pentru exists/all nu poate fi gol; all pe zero rânduri nu trece. `la_esec` este unul dintre verdictele planului, în afară de MATCH. Citirea eșuată nu devine count=0. Nu folosi doar „rândul există” ca probă de conformitate; testează starea, actorul, versiunea și rândul afectat concret.

Runnerul citește toate pachetele/fișierele clonei, toate acoperirile/legăturile/dovezile cerințelor clonei și istoricul capitolelor, plus tabelele specifice pasului. Cele nouă verigi sunt evaluate pentru D1/D6/D8. Toate SELECT-urile sunt paginate; rândurile vechi actualizate rămân în probe.

`ofertare_r5_blocaj_sursa` este **funcție SQL**, nu tabel. Nu o apelăm din verificatorul SELECT-only. P2.06 observă refuzul în UI și absența tranziției la aprobat în BD; existența porții server se probează separat de Claude.

## Concurență și restart

P3.13–15: `obiect={tabela,id}` trebuie să aparțină clonei. Faza are `pregatire`/`pregatire_2` și `actiuni`/`actiuni_2`. Ambele pregătiri termină înainte de lansarea simultană a salvărilor. Postcondițiile trebuie să vizeze **același ID** și să demonstreze conflict explicit/istoric, nu doar una dintre valorile finale. Jurnalele și capturile ambelor taburi sunt separate.

P3.16: prima rulare salvează snapshot înainte/după pornire și `checkpoint.json`, apoi tipărește `PAUZĂ — Claude repornește workerul`. Nu repornește singur serviciul. Reluare:

```text
node scripts/audit-v2/scenarii/16_restart_worker.mjs --apply --resume <cale-checkpoint.json>
```

Completează `preconditii_reluare` separat (coada nu mai este obligatoriu inactivă). Fixture-ul și clona trebuie să coincidă cu checkpointul. Prima postcondiție după reluare compară cu starea **anterioară pornirii**, pentru a detecta duplicarea. Nu relansa prima fază cu --apply simplu.

## Dovezi și P4

Rezultatele sunt în `docs/AUDIT_OFERTARE_V2/dovezi/<pas>/<data>/`: snapshot înainte/după fiecare fază, capturi PNG de viewport, jurnale fetch/XHR Supabase fără corp/header brut și verdict. Un fișier mare este împărțit în fragmente ≤2 MiB cu index/hash; `incarcaJson` le reconstituie și verifică hashul. Capturile sunt reduse până încap, fără eliminarea capturii în tăcere. Dovezile pot conține date de business/personale și se revizuiesc înainte de distribuire.

P2.12 acceptă `ground_truth_json` ca fișier local cu array `{cerinta_id, artefacte:[{nume,sha256,pagina_globala}], ...}` și produce `matrice-P4`. Hash egal în manifest dă cel mult PARTIAL: pagina și satisfacerea cerinței cer lectura artefactului final. Hash diferit nu înseamnă conflict semantic. Numai `identitate_binara_obligatorie:true` poate produce CONFLICT de identitate; fără date = UNDETERMINED. Citirea paginii/pasajului și judecata umană se păstrează în înregistrarea ground truth.

MATCH în raportul unui scenariu certifică strict aserțiunile enumerate, nu întregul modul. Blocarea în UI nu demonstrează blocarea API-ului. Testele de atac direct API din white-box se rulează separat după GO, cu JWT real și read-back; runnerul P2 păstrează traseul UI.

Contextul UI implicit este antetul exact `🏛 SANDBOX-V2-DOMNESTI` al fișei. Pentru PT/Cantități/Clarificări, care folosesc selector de licitație, completează `context_ui={"tip":"select","selector":"css=select[title=\"Licitația de lucru\"]"}` la scenariu/fază; PT nu are title pe select, deci folosește selectorul unic observat în DOM. Runnerul compară VALUE cu ID-ul clonei citit din BD. Un titlu de licitație copiat sau numărul sandbox din lista de fundal nu sunt suficiente.

## Validare locală

`npx vitest run scripts/audit-v2/*.test.js` și `node scripts/audit-v2/test_sql_local.test.mjs`. Dacă esbuild e refuzat cu EPERM, folosește API-ul Vitest din raport, fără să modifici configurația proiectului. `node --check` pentru toate fișierele `.mjs`.

Rollbackul SQL nu șterge Storage. După UI există și obiecte `<cloneId>/atribuire/...` și `pt/<cloneId>/...`, nu numai `sandbox-v2/5/...`. Inventariază căile exacte înainte de rollback și șterge doar după GO; acest livrabil nu execută ștergeri Storage.
