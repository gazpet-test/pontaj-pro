# Plan — convocatoarele în masă pe UAT (L1, BRIEF §4.1)

04.11.2026 · branch `redari/convocatoare-masa` · PR #989 · r3 după Jakarinos NO-GO r1 + r2 (direcția coordonatorului: INVOKER, fără fallback).

## Ce face
Pe tab-ul **🏛️ UAT-uri**, un panou nou (admin / editor): alegi UAT-ul → **Verifică** (citește, nu scrie nimic) → **📦 Generează
convocatoarele UAT-ului** → un singur zip:
`convocatoare_{proiect}_{UAT3}_{data}.zip` = DOCX-urile (`{nr_document}_{id_parcela}.docx`, același nume ca la generarea pe rând)
+ `borderou.csv` (formatul existent `borderouCsv`, contract §8) + `opis.xlsx` (foi: „Opis” = toate rândurile cu stare și motiv,
„Borderou” = doar convocările din zip).

Locul: tab-ul UAT-uri (două linii în `Redari.jsx`: importul și randarea tab-ului), ca să nu ating zona convocatorului din Registru
(~390–420), `docx.js` sau `PlicuriEcran.jsx`. Logica pură: `src/redari/convocatoareMasa.js`; UI: `src/redari/ui/ConvocatoareMasa.jsx`.

## Pași
1. **Pregătire (read-only)**: rândurile UAT-ului din `red_v_stare_parcela`, apoi în loturi de 100 de id-uri: `red_detinatori`, `red_parcele`,
   `red_detinatori_contact`, `red_detinatori_token`, `red_convocari` poștale active **neșterse logic** (`sters_la IS NULL`). Paginare keyset
   pe o cheie unică (până la pagina goală, cu verificarea avansării — L23); generația UI ajunge în fiecare buclă (L24).
2. **Gărzi, aceleași ca la generarea pe rând** (funcțiile existente, importate):
   - pe UAT / proiect: `motivBlocareConvocator(proiect, uat, null)` → **tot lotul blocat**, cu motivul, nimic consumat (azi LOT1: fără împuternicire);
   - pe rând: `motivBlocareConvocator(proiect, uat, rand)` + `verificaDateConvocator(...)` → **exclus cu motiv**, fără număr.
3. **Idempotență** (convocări poștale active, neșterse):
   - neexpediată **cu fișier** → nu primește număr nou („deja generat”); intră în zip doar cu bifa **„include și cele deja generate”**;
   - neexpediată **fără fișier** → același număr, regenerată cu data convocării, încărcată prin `reincarcaConvocator` („reîncărcat”);
   - mai multe neexpediate → exclus („rezolvă în Fișa parcelei”); deja **expediată** → exclus;
   - altfel → **nou**.
4. **Limita (r2, P1-2)**: implicit și maxim **200 de convocatoare NOI** pe rulare. Cele deja generate și cele reîncărcate nu consumă loc,
   deci rulările succesive avansează (201 rânduri → două rulări → toate generate).
5. **Recitire înainte de acțiune (r2, P1-3)**: pentru fiecare rând nou / reîncărcat se recitesc din BD deținătorul (sters_la, calitate, nume),
   parcela, contactul, tokenul și convocările lui active; dacă amprenta diferă de cea din „Verifică” sau gărzile pică pe datele proaspete →
   „schimbat între timp”, fără număr. Documentul se generează din datele recitite.
6. **Rezervarea (r3)**: `rpc('fn_red_convocare_rezerva', { p_detinator_id })` — migrarea **20261130l** (NEAPLICATĂ), **SECURITY INVOKER**
   (RLS + toate triggerele utilizatorului, inclusiv garda de plic din `trg_red_convocari_posta_garda`; nimic acordat — drepturile existente
   verificate read-only pe live și în preflight). Într-o tranzacție: poarta admin/editor → `pg_advisory_xact_lock` pe (proiect, deținător) →
   recitire SUB lock a deținătorului + parcelei active (`FOR SHARE`: o ștergere concurentă e așteptată / recitită → `P0002`) și a proiectului /
   UAT-ului (gărzile lui `motivBlocareConvocator` → `RD002`) → `EXISTS` convocare poștală activă neexpediată (inclusiv fără număr) → `RD001`
   (excepția explicită: `p_numar_nou_confirmat`) → `fn_red_numar_document('C')` + INSERT. Orice eroare anulează împreună numărul și rândul.
   Clientul încarcă fișierul prin `reincarcaConvocator`. **Fără fallback**: dacă RPC-ul lipsește (`PGRST202` / 404, proba fără efecte
   `p_detinator_id = null` → `22023`), „Verifică” blochează lotul cu „protecția la concurență nu e activă — aplicați migrarea 20261130l”, iar o
   dispariție în timpul rulării oprește restul lotului. `55P03` (UAT ocupat de o plicuire) = eroare pe rând, reîncercabilă.
   **Calea individuală** (ModalConvocator) NU se schimbă aici: punctul de integrare e `rezervaNumarConvocare` din #991 (nu e încă pe main;
   integrarea în acest PR ar aduce tot #991 și ar intra în conflict pe `Redari.jsx`). Se integrează după merge-ul ambelor; până atunci calea
   individuală nu ia lock-ul.
   Proiectul și UAT-ul se recitesc și în client înaintea fiecărui rând (amprentă față de „Verifică”), iar documentul se face din datele recitite.
7. **Progres + oprire**: contor `i / n`; **Oprește** se verifică înainte de fiecare rând (restul → „oprit”).
8. **Erori per rând**: notate (cu numărul rezervat, dacă e cazul), lotul continuă. Planul se invalidează din clipa în care pornește execuția
   (nu se mai poate reexecuta), rezultatele rămân pentru **„Descarcă din nou zip-ul”** dacă arhiva eșuează.

## Ce NU face
- nu marchează nimic expediat, nu trimite nimic (poștă, SMS, e-mail);
- nu schimbă calea individuală (ModalConvocator), RLS-ul sau numerotarea; migrarea 20261130l doar adaugă funcția (revenire = DROP FUNCTION);
- nu generează pentru alt canal decât poșta.

## Teste
- vitest (client fals, fără BD): gărzi, idempotență, 201 rânduri / două rulări, limita doar pe „nou”, fără fallback (blocat la „Verifică”,
  refuz în executaLot, oprire la PGRST202 în timpul rulării), RD001 / RD002 / P0002 / 55P03, proiect / UAT schimbate în BD după „Verifică”,
  recitire (adresă / calitate / ștergere / token / convocare nouă), recitirea completă a convocărilor (61 de rânduri, pagină de 7), paginare,
  oprire și generație depășită, erori per rând, zip; randare + StrictMode, răspuns întârziat după demontare, schimbarea proiectului în timpul
  generării (fără raport / onSchimbat / zip — mutant roșu) și cazul normal (zip o dată).
- DRY local PG17 (`scripts/redari_30l_dry_local.sh`): schelet cu textul și ACL-ul EXACT al tuturor funcțiilor din lanț (inclusiv lock-ul real de
  plic pe UAT), migrarea (preflight cu amprenta completă) + reaplicare refuzată, refuzuri (anon, fără sub, viewer, fără nivel, service_role,
  NULL, șters, REPEATABLE READ), INVOKER, rezervare, RD001 (și fără număr), `p_numar_nou_confirmat`, garda de plic din trigger, RD002 (împuternicire
  / sesiune / neidentificat), **concurență prin dblink**: același deținător → o convocare / un număr; ROLLBACK → al doilea rezervă; deținători
  diferiți → al doilea așteaptă contorul și reușește; UAT ocupat de plicuire → 55P03 fără consum; ștergere concurentă → P0002; rezervare deschisă
  → ștergerea așteaptă. ACL, revenire, apoi DRY-ul de producție pe clusterul local. Mutanți: fără advisory lock → roșu; fără `FOR SHARE` → roșu.
  Clusterul se oprește și se șterge la final.
- DRY producție (`supabase/tests/20261130l_..._dryrun.sql`): doar refuzuri și RD001, fără nicio rezervare reușită; preflight-ul migrării a trecut
  pe live într-o tranzacție READ ONLY (04.11.2026). Nu s-a consumat niciun număr C (contorul `C` e global, comun cu LOT1).
