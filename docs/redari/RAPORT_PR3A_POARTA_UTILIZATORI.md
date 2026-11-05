# PR3a — poarta convocării utilizatorilor / arendașilor (juridic#040)

Branch: `codex/redari-pr3a-poarta-utilizatori`, bază `main` cu #996. PR draft, fără merge. Fișiere SQL neaplicate; fără acces Supabase și fără date reale. `IMPORT_UTILIZATORI_ACTIV=false` rămâne neschimbat.

## Fișiere și regula implementată

| Fișier | Conținut |
|---|---|
| `supabase/migrations/20261131c_redari_poarta_utilizatori.sql` | Flag NOT NULL DEFAULT false + cine/când a aprobat; trigger owner prin `auth.uid()` / `fn_sms_e_owner()` (`profiles.is_owner`); RPC recreat INVOKER cu RD006 sub advisory existent, înainte de număr. Trigger fără bypass de mentenanță: INSERT / număr / fișier / hash / reactivare / schimbare țintă / plicuire / expediere, toate canalele. Inclusiv propagarea DEFINER din plic. |
| `supabase/revenire/20261131c_redari_poarta_utilizatori_ROLLBACK.sql` | Garda + txid, lock înainte de verificare, amprente RPC/trigger, refuz după orice aprobare/istoric/convocare utilizator; restaurează exact corpul RPC 30l și elimină toate obiectele noi. |
| `supabase/tests/20261131c_redari_poarta_utilizatori_dryrun.sql` | BEGIN/ROLLBACK; identități, adresă și proiect fictive; auth.users + profiles pentru FK reale, JWT + SET LOCAL ROLE authenticated; cere postgres NOSUPERUSER. |
| `src/redari/convocareUtilizatori.js` | Predicat comun lot/document; false/NULL/lipsă = refuz. CAS pentru comutator, scrie numai flagul. |
| `src/redari/convocatoareMasa.js` | Excludere explicită cu `utilizator - convocare neaprobata`, inclusiv document arhivat; reverificare la execuție; RD006 raportat distinct ca schimbare, fără număr/upload/fallback. Excluderile intră în opisul existent. |
| `src/redari/docx.js:622` | Refuz înainte de citirea șablonului, inclusiv previzualizare. |
| `src/redari/ui/PoartaUtilizatori.jsx` + `SetariProiect.jsx` | Comutator doar owner, confirmare explicită ON/OFF, CAS, protecție dublu click, generație + identitate, reîncărcare după conflict sau rezultat necunoscut. |
| `src/redari/convocareUtilizatori.test.js`, `convocatoareMasa.test.js:513` | Matrice calitate × flag, generator/previzualizare, UI owner, CAS/refuz server, UAT mixt, plan vechi, RD006 după planificare, lipsă șablon PR3b. |
| `docs/redari/PLAN_UTILIZATORI.md` | Separă PR3a livrat în cod / PR3b deschis; corectează deciziile închise #1920. |

ACL/RLS existente rămân neschimbate. Cele două funcții trigger noi nu au EXECUTE pentru PUBLIC/anon/authenticated/service_role. Identitatea și momentul aprobării sunt puse de server și păstrate la OFF, astfel încât revenirea nu pierde istoricul unei aprobări revocate. Anularea simplă, scoaterea din plic după anulare, AR/tracking nu cer aprobarea; combinarea anulării cu fișier nou sau expediere nu ocolește poarta.

## Cazurile DRY pregătite — neexecutate

1. SQL fără `auth.uid()` și admin Redări non-owner: aprobare refuzată; non-owner nu poate nici opri flagul activ, nici falsifica proveniența, nici insera proiect deja aprobat.
2. `utilizator` și `arendas` cu false: RD006 exact, pe posta/email/sms/afisare, inclusiv confirmarea de număr nou; fără numere consumate sau convocări inserate.
3. Proprietar cu false: rezervare permisă; lot UAT mixt: 1 proprietar rezervat, 2 utilizatori raportați ca săriți.
4. Owner cu true: proveniență server, rezervări pentru utilizator și arendaș și fișier/hash permise; proveniența trimisă manual este refuzată.
5. Plic creat prin RPC cu flag true, apoi OFF: expedierea prin UPDATE pe plic → `fn_red_plic_propaga` → convocări este refuzată RD006, iar scrierea plicului se anulează.
6. După OFF: regenerarea/hash, expedierea directă, anularea combinată cu expediere, reactivarea și reparentarea proprietar → utilizator sunt refuzate; anularea simplă rămâne permisă. Auditul se păstrează.

Fișierul DRY nu încarcă migrarea. Se rulează separat după aplicarea fișierului în baza izolată cu schema completă 30l/30m/31c; se încheie cu ROLLBACK. Nu s-a executat niciun SQL pe Supabase.

## Verificări executate

- `npx vitest run`: **163 fișiere trecute, 3 sărite; 3.914 teste trecute, 22 sărite**.
- `npx vite build`: **verde**, cu avertismentele Vite despre importuri mixte și dimensiunea chunk-urilor.
- Parser PostgreSQL `pglast`: sintaxă SQL + PL/pgSQL validă pentru migrare, rollback și DRY. Aceasta este verificare de sintaxă, nu execuție în BD.
- `git diff --check`: verde.
- Niciun fișier exclus din task nu a fost modificat. Fără șablon DOCX nou, fără activarea importului, fără dependențe de aplicație adăugate.

## Ce rămâne deschis

- **SQL pe PostgreSQL real:** DRY, regresiile 30l/30m, concurență în două sesiuni, mutanții L15 și apply → rollback → re-apply sunt **neexecutate**. Sunt obligatorii înainte de aplicare. Nu există acces Supabase în această sesiune, iar cererea autorizează numai fișierele.
- **Baseline L15:** preflight-ul preia baseline-urile revizuite și versionate 30l/30m și corpurile din repo; nu a fost recitit live acum. Orice diferență de corp/callee, setări, ACL/RLS/politici/triggere oprește aplicarea și cere review, fără relaxarea porții.
- **PR3b:** textul juridic, `convocator_utilizator.docx`, alegerea șablonului și teste de conținut. Până atunci clientul refuză generarea utilizatorului și cu flag true; serverul permite rezervarea cu true conform contractului porții.
- Convocatorul utilizatorului **nu cere avizul avocatului**. Aceeași persoană proprietar pe o parcelă și utilizator pe alta în același UAT: **un plic cu două convocatoare**, decizie acceptată; gruparea existentă nu se schimbă.

## L01–L25

Referințele de mai jos sunt la fișierele din acest PR. Unde verificarea BD nu a putut fi executată, limita este explicită.

| Regulă | Respectare / dovadă |
|---|---|
| L01 | Migrare: RPC `fn_red_convocare_rezerva` păstrează advisory înainte de recitire și refuză la linia 300, înainte de numerotare. Triggerul convocărilor blochează deținător/parcela și proiectul înainte de decizie. `convocareUtilizatori.js:12`: CAS id + versiune + flag, 0 rânduri = conflict; test CAS. |
| L02 | Aprobarea și proveniența sunt atomice în același UPDATE/trigger (`...sql:194`); număr + convocare rămân în RPC-ul atomic (`...sql:264`). DRY pregătește refuz fără consum; neexecutat. |
| L03 | `convocatoareMasa.js:232`: recitire și gardă pe datele curente înainte de generare. Test „plan vechi: schimbarea calității”; CAS pe versiune la comutator. |
| L04 | n/a — nu adaugă trimitere sau operație cu cheie de retry; protocolul numerotării existente rămâne. |
| L05 | `PoartaUtilizatori.jsx:30`: eroarea se afișează și proiectul se recitește, fără retry automat sau presupunere de eșec; fără ștergere fișiere/fallback. Test RD006 după planificare. |
| L06 | Ordinea lock-urilor este documentată în migrare: advisory → deținător/parcela → proiect; triggerul `h_utilizatori` rulează înainte de informare/posta. DDL/rollback: convocări → proiecte. Concurența în două sesiuni rămâne neexecutată. |
| L07 | `...sql:194,226`: BEFORE INSERT/UPDATE pentru proiect și convocări, inclusiv PATCH direct, plicuire și propagarea expedierii; fără bypass postgres la poarta nouă. DRY non-owner/reparentare/plic pregătit. |
| L08 | `...sql:194`: auth.uid() nenul + owner în BD; proveniența este numai server și imuabilă la scriere manuală. DRY falsificare proveniență și identitate nulă pregătit; clientul trimite numai flagul. |
| L09 | RPC rămâne INVOKER cu RLS existente; ținta triggerului se derivă din NEW.detinator_id → parcelă → proiect și verifică fn_red_nivel() pentru modulul exact redari. DRY admin non-owner pregătit. |
| L10 | n/a — fără secrete/parole/integrare nouă; fixture-uri exclusiv fictive. |
| L11 | n/a — fără extragere de dovezi. |
| L12 | `convocatoareMasa.js:76,232`: utilizatorii excluși au motiv separat, intră în exclusi/opis sau raportul execuției; test UAT mixt verifică 2 proprietari generați și utilizator exclus. |
| L13 | n/a — fără parser/regex nou de business. |
| L14 | Runner cu tranzacție și gardă txid, postcondiții (`...sql:338`); rollback cu lock înainte de verificare, refuz pe audit/config/convocări și DROP obiecte noi. Apply/rollback/re-apply neexecutat. |
| L15 | Preflight migrare: corp RPC/callee tranzitive, owner, DEFINER/config/ACL, coloane, RLS/FORCE/politici și triggere cu WHEN din baseline 30l/30m; valori explicite pentru funcțiile adăugate ulterior (`...sql:138`). Rollback verifică amprentele înainte de restaurare. Fără regex de descoperire SQL. Baseline live și mutanții pe 2–3 niveluri rămân de verificat în BD. |
| L16 | n/a — fără cheie canonică/UNIQUE nouă; numerotarea existentă rămâne. |
| L17 | Proveniența folosește `clock_timestamp()` (timestamptz); fără CURRENT_DATE UTC sau offset fix introdus. Nu se adaugă parsare de numere/date civile. |
| L18 | SQL IS NOT TRUE / IS DISTINCT FROM; JS cere exact true. Erorile server/CAS se propagă; lipsa coloanei dezactivează comutatorul. Teste false/NULL/undefined, conflict și 42501/RD006. |
| L19 | Helper comun lot/document în `convocareUtilizatori.js:1`; matricea explicită calitate × flag în Vitest, aceleași două calități în DRY pentru RPC și trigger. Paritatea în BD rămâne neexecutată. |
| L20 | Vitest pentru proprietari neafectați, ambele calități noi, plan vechi, refuz server, șablon lipsă. DRY true/false, anulare simplă vs combinată, reactivare și expediere prin plic; neexecutat. OFF nu cere șablon sau alte aprobări. |
| L21 | n/a — fără apel AI. |
| L22 | n/a — fără cost AI. |
| L23 | Lotul păstrează paginarea keyset existentă până la pagina goală și raportarea completă; nu introduce .limit + filtrare incompletă. Regresiile Vitest ale lotului cu plafon de pagină au trecut. |
| L24 | `PoartaUtilizatori.jsx:8`: generație + id/versiune/owner, invalidare la unmount/schimbare, protecție dublu click și onSchimbat după salvare/conflict. Lotul păstrează esteCurent la recitire. |
| L25 | Vitest cu client fals: filtrare/refuz și efecte absente, expected explicite. DRY cu FK/CHECK reale din schema versionată, JWT și SET LOCAL ROLE, conturi fictive și cerință NOSUPERUSER. Execuția reală SQL/concurența și regresiile 30l/30m sunt neexecutate, nu declarate trecute. |
