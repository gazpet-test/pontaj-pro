# PR #1002 — PR3a, runda 3

Același branch `codex/redari-pr3a-poarta-utilizatori`, commit nou, fără merge. Migrarea 31c rămâne neaplicată; se livrează numai fișierele. Fără Supabase/date reale, fără șablon PR3b și fără activarea importului.

| Remediere | Fișier:linie / dovadă |
|---|---|
| Rezervarea validează calitatea așteptată sub advisory + lock pe deținător/parcela, înainte de număr | `supabase/migrations/20261131c_redari_poarta_utilizatori.sql:392,418,463`: overload cu 4 argumente, p_calitate_asteptata obligatorie. Calitatea validată se scrie în red_convocari.calitate_document. Overload-ul vechi de 3 argumente (`:383`) refuză RD008; doar proba cu id NULL rămâne 22023, fără efecte. |
| Legarea și expedierea nu pot folosi un document de altă calitate | Migrare `:316`: comparație strictă cu deținătorul curent sub același advisory/lock; NULL sau diferență = **RD008, «calitatea s-a schimbat - regenereaza»**. Plicuirea/reactivarea și expedierea propagată din plic trec prin aceeași gardă. Corectarea calității deținătorului nu rescrie proveniența documentului. |
| Calitatea nu poate fi moștenită implicit din OLD de către un PATCH vechi | `fn_red_convocare_leaga` (`...sql:474`), INVOKER + auth.uid()/fn_red_nivel()/RLS, cere explicit calitatea folosită în DOCX. Garda refuză scrierea directă path/hash. Marcajul tranzacțional de protocol este pus numai de SET LOCAL static al RPC-ului (tiparul 30l), anulat imediat după UPDATE și la rollback; nu este identitate sau drept. Chiar un replay fără modificări trece din nou prin verificare. ACL-urile tabelului nu se schimbă. |
| Clientul transmite instantaneul, fără să-l înlocuiască prin recitire | `src/redari/convocatorNeexpediat.js:183` trimite p_calitate_asteptata; `src/redari/docx.js:622,644,682` capturează și întoarce calitateDocument; `docx.js:716` îl trimite la RPC-ul de legare. `Redari.jsx:586,595,632`, `FisaParcela.jsx:235`, `convocatoareMasa.js:261,276` îl propagă pe toate căile. |
| Convocări existente | Coloana nouă (`...sql:226`) este nullable, **fără default/backfill**. NULL înseamnă că textul vechi nu are calitate dovedită: regenerare obligatorie înainte de plicuire/expediere. Nu presupunem că un deținător astăzi proprietar a fost proprietar la generarea fișierului. Lotul (`convocatoareMasa.js:82`) regenerează același număr dacă stampila lipsește/diferă; nu reia fișierul vechi în ZIP. Regenerarea poate schimba stampila numai împreună cu un fișier nou. |
| Rollback și L15 | `..._ROLLBACK.sql:41`: refuz dacă există valoare/istoric pentru calitate_document; amprente actualizate pentru garda modificată și cele două contracte RPC; elimină overload-ul nou, RPC-ul de legare și coloana, restaurează RPC-ul original 30l. Preflight-ul extins r2 pentru plicuri/triggere rămâne. Postcondițiile fixează corp/config/ACL ale noilor RPC-uri. |

DRY pregătit (`supabase/tests/20261131c_redari_poarta_utilizatori_dryrun.sql:263`), BEGIN/ROLLBACK, date fictive, JWT + SET LOCAL ROLE:

- Legacy NULL: expedierea și simpla re-stampilare sunt refuzate; regenerare prin RPC + expediere permisă.
- **(a)** Cu flag true, după citirea proprietarului acesta devine utilizator; rezervarea cu așteptarea «proprietar» refuză RD008, contorul rămâne neschimbat. Apelul vechi de 3 argumente refuză și el.
- **(b)** După legarea unui DOCX pentru proprietar, deținătorul devine utilizator; legarea versiunii vechi, replay-ul și expedierea sunt refuzate. Calea/hash-ul/stampila vechi rămân, expedierea rămâne NULL. Simpla schimbare a stampilei fără DOCX nou este refuzată.
- Flux normal: rezervare cu așteptare egală, stampilă server, legare cu aceeași calitate; după schimbare, un document regenerat pentru noua calitate poate fi legat și expediat. Pentru utilizator se simulează numai fișierul fictiv, șablonul real rămâne PR3b.
- PATCH vechi pe fișier, fără contractul RPC explicit, este refuzat și când calitatea curentă încă este proprietar.

Verificări executate: **npx vitest run — 165 fișiere trecute, 3 sărite; 3.935 teste trecute, 22 sărite**. **npx vite build — verde** (avertismente bundle/importuri mixte). **git diff --check — verde**. Parser PostgreSQL pglast: sintaxă SQL și PL/pgSQL validă pentru migrare/rollback/DRY.

Teste JS noi: `convocatorNeexpediat.test.js` verifică exact payload-ul așteptării și lipsa fallback-ului; `convocatoareMasa.test.js` injectează schimbarea calității la rezervare și verifică zero numere/upload, plus regenerare legacy pe același număr; `docx.test.js` injectează schimbarea în upload și verifică RPC-ul de legare cu calitatea originală, RD008 și lipsa unui retry.

**Neexecutate:** DRY SQL (intercalări deterministe, legacy, mutantul r2), concurența în două sesiuni, regresiile SQL, apply → rollback → re-apply și PostgREST real. Baseline-ul rămâne din sursele versionate, fără recitire live. La cursa din timpul uploadului poate rămâne un fișier orfan în Storage, dar RPC-ul refuză legarea/expedierea; fără ștergere sau retry automat după rezultat necunoscut.

## L01–L25, runda 3

| Regulă | Respectare / dovadă |
|---|---|
| L01 | `...sql:418`: compară așteptarea după advisory/lock, înainte de număr; `:316` revalidează stampila la legare/expediere sub aceleași lock-uri. |
| L02 | Rezervare număr+rând+stampila și legare path+hash+stampila sunt fiecare atomice în RPC. Storage este separat; refuzul legării nu publică documentul. |
| L03 | Snapshot explicit de la verificare/generare până la server: `convocatorNeexpediat.js:183`, `docx.js:622,716`; RD008 pentru rezultat pe calitate veche. Testele (a)/(b). |
| L04 | n/a — fără trimitere sau cheie de idempotentă nouă; fără retry automat. |
| L05 | Fișierul încărcat nu se șterge la eroare de legare; mesajul include starea și RD008, fără fallback/retry. Test upload cu rol schimbat. |
| L06 | Protocolul r2 păstrat: advisory comun; după UPDATE implicit, TRY/NOWAIT în gardă. RPC-ul de legare documentează ordinea. Două sesiuni neexecutate. |
| L07 | Trigger BEFORE INSERT/UPDATE, inclusiv metadata/PATCH, plicuire/reactivare/expediere; PATCH direct path/hash și overload-ul vechi nu pot ocoli contractul. |
| L08 | auth.uid()/fn_red_nivel() + RLS; stampila este validată/scrisă de server, imuabilă fără DOCX nou. Marcajul este numai protocolul static al legării, fără identitate din GUC. |
| L09 | RPC-uri INVOKER cu RLS; ținta derivă din convocare/deținător/parcela; verificarea proaspătă a proiectului înainte de upload rămâne (`docx.js:796`). |
| L10 | n/a — fără secrete sau parole. |
| L11 | n/a — fără extragere de dovezi. |
| L12 | Legacy este tratat explicit prin regenerare pe același număr; RD008 apare în raport, fără succes fals/număr nou de rezervă. |
| L13 | n/a — fără parser/regex nou de business. |
| L14 | O tranzacție/gardă txid/postcondiții; coloană NULL fără backfill presupus; rollback refuză date/istoric nou înainte să elimine proveniența. Ciclul apply/rollback neexecutat. |
| L15 | Baseline r2 păstrat; postcondiții corp/config/ACL pentru overload-ul strict și legare; rollback verifică amprentele actualizate. Verificarea live/mutantul SQL neexecutate. |
| L16 | n/a — fără cheie de unicitate nouă. |
| L17 | n/a — fără calcul numeric/temporal nou. |
| L18 | NULL/lipsa așteptării refuză; comparații IS DISTINCT FROM, erori RPC înaintea rezultatului; zero rezultate la legare = eroare. Teste lipsă calitate și refuz server. |
| L19 | Snapshot calitateDocument comun generatorului și tuturor apelanților; o singură gardă SQL pentru calitatea fișierului, reutilizată la legare și expediere. |
| L20 | Teste proprietar normal, rol schimbat, NULL legacy și regenerare; DRY flux complet și excepții pregătit. Anularea simplă/AR/tracking rămân posibile. |
| L21 | n/a — fără AI. |
| L22 | n/a — fără cost AI. |
| L23 | n/a — nicio colecție nouă; keyset-ul lotului rămâne. |
| L24 | Snapshot-ul este string captat înainte de await; tokenurile/generațiile existente ale modalului/lotului rămân. |
| L25 | Expected explicite pentru payload-uri și role; intercalări injectate în client fals cu efecte verificate. DRY JWT/SET ROLE și fixture-uri reale ca formă; SQL/2 sesiuni neexecutate, nu declarate trecute. |
