# _LECTII_REVIEW.md - reguli pentru Codex din review-uri reale (L01-L25, 27.10.2026)

Inainte sa scrii cod, verifica-ti munca fata de aceste reguli. In raportul final spui, pentru fiecare regula aplicabila (Lxx),
cum ai respectat-o (fisier/linie sau test); pentru restul scrii "Lxx n/a". Regulile vin din greseli P0/P1 gasite repetat in review.
Ele NU dau voie la schema, RPC-uri, date sau drepturi noi: daca o regula cere migrare/RPC nou, il propui si marchezi "necesita aprobare Razvan".

## A. Concurenta si idempotenta
L01 Lock inainte de verificare: in RPC ia intai FOR UPDATE pe tinta/parinte sau pg_advisory_xact_lock(cheie parinte) pt cote/contoare/multimi (UNIQUE daca se poate),
    apoi verifica drept/stare/contor; fara FOR SHARE pe multimi, fara insert-apoi-count. Client: UPDATE = CAS (.eq pe campurile deciziei + .select('id'); 0 randuri = conflict, reincarci).
L02 Atomic: pasii legati (antet+linii, DELETE+INSERT, stoc+status, decontare+jurnal) intr-un SINGUR RPC plpgsql, nu requesturi separate client/edge; jurnal usage/eroare in BEGIN..EXCEPTION.
    storage.remove()/mail doar dupa scriere confirmata (rowcount > 0 / RETURNING). Daca lipseste RPC-ul -> propui migrarea, nu inlantui apeluri.
L03 Rezultat vechi: lease confirmat/eliberat doar cu CAS pe tokenul propriu; derivatul se scrie doar daca sursa are inca sha/versiunea citita (0 randuri = abandon, nu suprascrie).
    Cheia de cache include tot ce schimba rezultatul: sha sursa, versiune extractor/prompt, model, praguri (nu doar document_id).
L04 Idempotenta: cantitati/bani/mail cer cheie UUID per intentie (refolosita la retry, nu count+1/timestamp), UNIQUE + hash payload; aceeasi cheie + alt hash = eroare.
    Claim: INSERT .. ON CONFLICT DO NOTHING RETURNING + SELECT pe cheie (nu SELECT-apoi-INSERT); trimiteri: pending inainte, sent dupa, re-claim doar dupa expirare.
L05 Ambiguu: 5xx/timeout/retea/crash dupa scriere = NECUNOSCUT: nu stergi fisierul, nu eliberezi claim-ul, nu pornesti fallback platit, nu regenerezi cheia (doar 4xx determinist = esec).
    Recitesti starea din BD sau reapelezi RPC-ul idempotent cu ACEEASI cheie; la reluare reconciliezi cu serverul, nu cu markerul local.
L06 Deadlock: aceeasi ordine de lock pe toate caile: advisory -> parinte FOR UPDATE -> copii ORDER BY id; numara si lock-urile implicite (CASCADE, FK la INSERT, triggere).
    Scrie ordinea intr-un comentariu in fiecare RPC/trigger care blocheaza randuri din mai multe tabele.
## B. Drepturi, identitate, secrete
L07 Toate caile: regula de acces/integritate se impune in BD (RPC SECURITY DEFINER sau trigger BEFORE INSERT/UPDATE/DELETE pe OLD/NEW), ca PATCH/DELETE direct PostgREST,
    CASCADE sau reparentarea pe FK sa n-o ocoleasca; datele restranse nu raman citibile printr-un tabel-sursa/view cu SELECT USING(true).
L08 Identitate: apelantul = auth.uid(), NULL = refuz (exceptie: cale server cu rol verificat explicit); niciodata p_user, set_config/request.jwt.claim.*, GUC custom, current_user in DEFINER.
    Coloanele de provenienta (sursa_*, hash, origine, autor) le seteaza serverul (trigger BEFORE) si sunt imuabile pentru user la INSERT si UPDATE.
L09 Entitatea tinta: in DEFINER/edge service_role verifici accesul (is_owner sau user_module_access pe cheia EXACTA a modulului) pe proiectul FIECARUI id atins, inclusiv tinte
    referite (inlocuire, sursa_*, refs polimorfe, cai Storage); FK dovedeste doar existenta. Refuz cu mesaj generic + test cu user non-owner.
L10 Secrete: niciodata CNP/data nasterii/telefon ca parola (token aleator ca hash + lockout); secret propriu per integrare, fara fallback pe alt modul sau *_VECHI in afara rotatiei limitate.
    Fara erori brute, connection string sau hash de CNP in mesaje/loguri/coloane citibile; test negativ: secretul gresit/vechi e respins.
## C. Extragere, parsare, completitudine
L11 Dovada: valoare "dovedita" doar la aparitie unica pe acelasi rand/celula, coloana confirmata din antet, token complet (semn, %, zecimale, UM); nu subsir, prima aparitie,
    egalitate de valoare sau verificare de acelasi AI. Normalizarea pastreaza semne/operatori/granite de rand; restul = incert/needs_human ('100' nu e dovedit de '1000 m').
L12 Completitudine: nimic nu dispare tacit: forme nerecunoscute, randuri slabe, UM necunoscute = "incert" + complet=false (si la EOF); trunchiere marcata (pagini_necitite, partial).
    Compara cu un numitor determinist (ancore, nr. crt., total tiparit); lipsa datelor nu e concordanta (ancore=0, incerte=5 -> deficit necunoscut, nu false).
L13 Regex/parsere: ancorat ^...$, metacaractere escapate, alternativa lunga intai, [ \t] nu \s intre randuri, in PostgreSQL \y \m \M (\b = backspace); test pozitiv + negativ.
    Parser extern: verifica -1, taguri, valori invalide si esueaza explicit (in edge: eroare scrisa in DB + return, nu throw); niciodata continuare tacita.
## D. SQL si migrari
L14 Migrari: o tranzactie (BEGIN/COMMIT sau psql --single-transaction) + postconditii; preflight pe date live inainte de CHECK/FK/UNIQUE; backfill pt markerii legacy inlocuiti.
    ROLLBACK: LOCK inainte de verificarea "fara date", refuza daca exista randuri/istoric/config noi, DROP la tot ce s-a creat; testat apply -> rollback -> re-apply.
L15 Porti de schema: amprenta pe allow-list vs baseline revizuit in PR: corp + callee tranzitive, prosecdef, proowner, proconfig, ACL (si coloane/secvente), RLS+FORCE, toate politicile
    (qual NULL = true), triggere (tgfoid, tgenabled, WHEN). Fara regex pe text SQL; EXECUTE dinamic/search_path mostenit = refuz; testat pe lanturi de 2-3 niveluri.
L16 Unicitate: UNIQUE in BD pe cheia canonica completa + scope, coloane NOT NULL sau NULLS NOT DISTINCT, partial pe randurile vii (stare <> 'anulat'); aceeasi cheie in validare/dedup/UI.
    Hash-ul de dedup include toate campurile semantice; identitatea documentului = sha256 pe continut, nu nume/marime.
## E. Garzi, valori, reguli comune
L17 Numere/timp: fara String() + reparsare; separatori RO/EN cu un helper EXISTENT (nu unul nou) care marcheaza ambiguitatea; la mutari UM sursa = destinatie = articol.
    Timp in Europe/Bucharest (nu offset fix, CURRENT_DATE UTC, new Date('YYYY-MM-DD')); "a expirat" pe timestamp exact; ferestre peste miezul noptii tratate.
L18 Fail-open: eroare != gol != NULL/NaN: RPC esuat = eroare afisata (nu lista goala/"nu ai drept"); lista goala = zero rezultate (siteIds [] = nu vede nimic); necunoscut != 0.
    SQL: IS NOT TRUE / IS DISTINCT FROM, text ~ '[^[:space:]]'; JS: if (error) inainte de "gol", Number.isFinite(total) && total > 0 inainte de gata >= total; statusuri pe lista alba.
L19 O singura definitie: predicatele de business (activ, necitit, relevant, forma canonica, cale de rezerva) = o functie SQL/helper comun, apelat identic din cron, edge, RLS, UI;
    clientul primeste flag-ul calculat. Dublare inevitabila (SQL vs Python, worker vs fallback) = test de paritate pe acelasi tabel de cazuri.
L20 Garda noua: testeaza si caile legitime + exceptiile (respins, anulare, entitati inghetate); CHECK de stari derivat din tabelul tranzitiilor, validarile de succes nu pe calea de esec.
    Operatiile de siguranta (OFF, stop) ocolesc cota/bugetul/deadline-ul comun; refuzul local (cota, buget) raportat distinct de esecul extern.
## F. Edge functions si apeluri AI
L21 Raspuns AI: inainte de scriere res.ok + stop_reason (refuza max_tokens/refusal) + schema din contract: obligatoriu = trim() nevid, optional = lipsa/null, peste limita = refuz (nu slice()),
    element invalid aruncat fara sa pice lotul. Gol/{}/partial: fara UPDATE/DELETE/cache/cursor/succes; vechiul se inlocuieste atomic doar cu set nou valid si nevid.
L22 Cost AI: inainte de apelul platit, pas atomic durabil (RPC/jurnal): valideaza legatura cu entitatea, consuma drept unic de apel (si pt fallback), rezerva input+schema+max_tokens
    la tariful corect; consum scris pe parcurs. Usage lipsa/timeout/5xx/crash = cost necunoscut: tombstone, fara retry automat; decontare o data, fara Math.min.
## G. React/UI
L23 Paginare: citirile ce pot depasi 1000/max-rows = keyset pe (ordine, id) pana la pagina goala (nu length < pageSize); trunchiere neasteptata = eroare vizibila.
    Filtrele (stari finale, placeholder-e) pe server inainte de limit; garda anti-duplicat = query exact pe cheia completa, nu .limit(50) + filtru JS.
L24 Async: orice load/actiune async capteaza token de generatie (useRef/AbortController) + id-ul entitatii si aplica rezultatul doar daca ambele sunt curente; reset la schimbarea entitatii,
    oprire bucle la unmount (mai ales cele platite), updatere tolerante la null, reloadKey explicit dupa actiune (nu doar [id]).
## H. Teste
L25 Teste reale: expected din sursa independenta (nu din codul testat), headere/input ca apelantul real, fixture-uri cu FK/CHECK reale; RLS/GRANT ca non-owner (SET LOCAL ROLE authenticated,
    harness NOSUPERUSER, PG ca in productie). Concurenta: 2 sesiuni reale + bariera, wait $PID, motivul exact al erorii; regresiile vechi rulate si dupa migrare.
