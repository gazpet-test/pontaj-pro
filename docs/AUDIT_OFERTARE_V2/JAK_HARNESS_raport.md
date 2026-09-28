# Audit V2 — raport Jakarinos

28.09.2026. Livrare locală pentru `JAK_AUDIT_V2_HARNESS.md`, după citirea contractului `00_PLAN_SI_FIXTURE.md`. Fără Git, producție, chei, mailuri, migrări aplicate sau dependențe noi. Codul aplicației nu a fost modificat.

## Ce am scris

- **A — CDP:** `scripts/audit-v2/cdp.mjs`, Node fetch/WebSocket native; API-urile cerute, două conexiuni independente, texte exacte/selectori existenți, scriere în inputuri React, upload inclusiv prin input ascuns, confirm/prompt și observații disabled. Jurnalul păstrează metodă/URL sanitizat/status/durată, fără corp HTTP sau header brut. Sesiune deja autentificată; nu am implementat autentificarea opțională cu parolă.
- **B — scenarii:** 12 entrypoint-uri P2 + 3 concurență + restart worker. `contracte.js`, `scenariu.mjs`, `retete.js`, fixture cu ID-uri/parametri null și `RETETE_UI.md`. Generatorul produce acțiuni și aserțiuni concrete pentru traseele identificate în surse; configurația manuală are prioritate. Preview implicit fără conexiuni; `--apply` verifică întâi clona în BD, apoi ID-ul selectat/antetul clonei în UI. Restartul păstrează înainte/după pornire și cere reluare explicită după restartul făcut de Claude. Dovezi per fază, toate pachetele și fișierele, copii paginate, fragmente ≤2 MiB pentru JSON mare; PNG redus la nevoie.
- **C — lanț:** `verifica_lant.mjs` + `lant.js` compun cele nouă verigi, refolosind `compuneLant`/`incarcaLantProbator` R17. Numai SELECT, JWT authenticated, paginare și loturi de ID-uri. Erorile sunt `nedeterminat`, nu absență; AI neaprobat = `propusa`, versiuni depășite = `veche`. Manifestul de origine se citește integral, inclusiv rândurile vechi actualizate. JSON + tabel text la CLI.
- **D — sandbox:** `90_SANDBOX_CLONA.sql`, `91_SANDBOX_ROLLBACK.sql`, copiere Storage cu dry-run implicit, hash sursă și hash după read-back, fără overwrite. SQL folosește mapări temporare, RETURNING, remapare FK/JSON, read-back al clonei, COUNT și MD5 pe toate rândurile sursei. Nu creează tabel persistent și nu dezactivează triggere. Harness local `test_sql_local.mjs`, exclusiv loopback și BEGIN/ROLLBACK.
- **E — white-box:** `JAK_WHITEBOX_S09_S10_S12.md`, 12 fișe în formatul §5, inventarul a 29 Edge Functions și al rutelor API, relația cu R01–R17, scenarii și fixuri minime. Numai audit; constatările nu au fost reparate.
- **P4:** `comparatie.js` produce matrice din lanț și ground truth local; identitatea hashului dă cel mult PARTIAL, fără a pretinde satisfacerea semantică a cerinței sau pagina din versiunea finală.

Instrucțiunile de utilizare sunt în `scripts/audit-v2/README.md`; rețetele au repere fișier:linie în `RETETE_UI.md`.

## Rezultate de validare

| Verificare | Rezultat |
|---|---|
| `node --check` pe toate cele 24 `.mjs` | PASS |
| Vitest: lanț nou, siguranță, cititor/P4 și regresii R17 | **85/85 PASS** (58 noi + 27 R17), prin API alternativ |
| `node scripts/audit-v2/test-retete.mjs` | **12 aserțiuni PASS**, fără browser/BD |
| `node scripts/audit-v2/test_sql_local.test.mjs` | **3/3 PASS**, verifică gardele și compunerea tranzacției, NU SQL executat |
| CLI scenariu 01 fără flag | Preview executat; nicio conexiune |
| `npx vitest run scripts/audit-v2/lant.test.js scripts/audit-v2/siguranta.test.js` | Blocat la pornirea esbuild: `spawn EPERM` |
| `node scripts/audit-v2/test_sql_local.mjs` | Oprit: `PGURI absent`; `psql` indisponibil local |
| PostgreSQL BEGIN/ROLLBACK, PostgREST real, browser real, Storage real | **NERULATE** |

Testul anti-producție execută runnerul în modul apply cu dublu SELECT care întoarce licitația 5 și demonstrează **zero conexiuni CDP**. Test separat demonstrează zero accesări Storage înaintea refuzului. Alte probe: paginare 1.101 rânduri, RLS/eroare distinctă, scan neverificat, valabilitate necunoscută, supersession rupt/ciclic, versiune veche, depunere fără dovadă, hash source/read-back diferit și reconstituirea exactă a dovezilor >2 MiB.

Reproducere Vitest alternativ, fără modificarea configurației proiectului:

```powershell
@'
import { startVitest } from 'vitest/node';
const ctx = await startVitest('test', [
 'scripts/audit-v2/lant.test.js', 'scripts/audit-v2/siguranta.test.js',
 'scripts/audit-v2/verifica_lant.test.js', 'src/ofertareLantProbator.test.js'
], {config:false,watch:false,pool:'threads',maxWorkers:1,minWorkers:1},
   {configFile:false,esbuild:false,resolve:{preserveSymlinks:true}});
if(ctx){
 process.exitCode=ctx.state.getUnhandledErrors().length || ctx.state.getFiles().some(f=>f.result?.state==='fail') ? 1 : process.exitCode;
 await ctx.close();
}
'@ | node --input-type=module
```

## Ce nu este demonstrat / ce rămâne la rulare

1. **Nu există aici un rezultat E2E.** Nu am clonă creată, sesiune browser, ID-uri remapate sau ground truth. Fixture-ul trebuie completat după clonare; nu este executabil integral doar prin înlocuirea celor patru ID-uri. Sunt necesari și selectori de rând, valori concrete, precondiții și finaluri ale operațiilor. Nu am inventat acești parametri.
2. **Unele tentative nu au cale UI identificată:** înlocuire directă a obiectului existent, dispariție Storage cu manifest păstrat, modificare fișier după aprobare și derogare non-owner. Sunt explicit indisponibile/UNDETERMINED, cu dovada în rețete. Butonul Aprobă combină generare+upload+aprobare; nu există trei acțiuni UI independente pentru fazele declarate separat în plan. Runnerul nu înlocuiește aceste tentative cu scrieri SQL/API mascate drept black-box. Concurența are barieră și două sesiuni, dar necesită configurarea obiectelor/selectoarelor și a probei istoricului real.
3. **Schema nu susține toate cele nouă legături:** anexele așteptate nu au FK direct către cerință; pagina globală nu are identitate de fișier/versiune. SHA declarat în BD nu dovedește verificare server. Aceste verigi rămân explicit lipsă/nedeterminate, chiar dacă UI afișează verde. `ofertare_r5_blocaj_sursa` este funcție, nu tabel; SELECT-only nu o apelează.
4. **SQL nevalidat pe PostgreSQL real, inclusiv sintaxa PL/pgSQL.** Migrațiile omit definițiile de bază ale unor tabele (istoric acoperire/grafic etc.). Introspecția refuză FK/ID JSON ambigue, PK compuse, cicluri neacceptate și copii alterate de triggere. Nu declar compatibilitate live. Nu am identificat prin execuție un trigger care cere dezactivare; scriptul oprește atomic, fără DISABLE global. COUNT final este SELECT în DO și NOTICE SANITY; într-un BEGIN exterior se poate citi tabela temporară `map_audit_v2_sanity`.
5. **Rollback Storage separat:** UI produce și `<cloneId>/atribuire/...`, `pt/<cloneId>/...`. Prefixul `sandbox-v2/5/` acoperă doar copia inițială. Inventarul exact se păstrează înainte de rollback; SQL nu șterge Storage.
6. **Acces și rutare:** SELECT gol sub RLS nu demonstrează absență globală. URL-ul aplicației nu garantează un backend local; verificarea finală are un URL Edge live hardcodat, semnalat în rețete. Nu am apelat acel endpoint.

## Constatările importante

- Combinația politicilor permisive permite, în schema analizată, `aprobat → propus`; aceasta poate elimina protecția Storage. Necesită reproducere locală/pe clonă cu JWT real înainte de verdict live.
- SHA read-back este calculat în browser; triggerul depunerii verifică existența rolurilor, nu octeții/hashing server.
- Gate-ul licitației nu cere pachet `depus`; există și endpointuri care verifică doar sesiunea înainte de scrieri service_role.

Sunt constatări statice cu limite explicite, nu exploatări efectuate în producție.

## Inventar în loc de `git diff --stat`

**Git nu a fost rulat**, conform AGENTS.md și primei reguli din specificație. Cerința finală `git diff --stat` contrazice interdicția; nu am fabricat ieșirea. Inventarul local: **40 fișiere adăugate** — 36 în `scripts/audit-v2/` (inclusiv 16 entrypoint-uri), două SQL-uri și două rapoarte în `docs/AUDIT_OFERTARE_V2/`. Fără modificări în `src/`, `supabase/migrations/`, Edge Functions sau configurația proiectului. Diff-ul real și integrarea rămân la Claude.
