# Registru DCC + corespondența cu DCC din ERP — specificație v2 (PR0)

Data: 23.11.2026 · Stare: PROPUNERE v2.1 (review v2: Jakarinos + Copilot „GO cu condiții”, condițiile integrate aici) · Modul: Execuție.
Sursele de lucru (în afara repo-ului, private): propunerea v1, analiza corespondenței trimise (~700 de fire) și a răspunsurilor DCC
(~180), registrul Excel ținut azi de mână (267 de rânduri, Lot 1), ghidurile de codificare ale beneficiarului (Lot 1 execuție, Lot 2
execuție, Lot 1 proiectare/DDE) și verdictele de review pe v1 (Jakarinos, Copilot, Rocky — toate „GO cu condiții”). Repo-ul este public:
aici nu apar nume de persoane, adrese de e-mail reale, prețuri sau conținutul documentelor.

## 1. Intenția
Corespondența oficială cu DCC-ul beneficiarului (Document Control Center) se face azi din Gmail, iar codul fiecărui document se alege de
mână dintr-un Excel. Rezultatul: numere dublate, revizii scrise în ~7 forme, separatori amestecați, discipline greșite, documente
respinse de DCC pentru cod („reveniți cu altă codificare”). Proprietarul vrea ca ERP-ul să dea codul, data, subiectul, corpul,
destinatarii și numele fișierelor, să țină registrul și, la final, să trimită mailul. Ulterior (etapa B), răspunsurile DCC să fie legate
de documentul și revizia lor, pe firul corect.

**Decizii ale proprietarului (23.11.2026):** v1 = doar ce trimitem noi (A), cu structura pregătită pentru B; adresa de trimitere rămâne
**necompletată** (setare pe proiect) până la o decizie separată; înainte de cod: review de proiectare (făcut pe v1) și apoi pe acest v2.

## 2. Regulile de codificare (din ghidurile beneficiarului; citate scurte în sursa privată)
- **Structura:** `<contract>-<emitent>-<tematică>-<tip>-<secvență>[-<filă>]-<revizie>[-<limbă>]`, separator `-`.
  - `contract` = 2 cifre (Lot 1 = 30, Lot 2 = 43, Lot 4 = 29); `emitent` = 3 litere (al nostru, ale subcontractorilor, al beneficiarului);
    `tematică` = 2–4 caractere din lista ghidului; `tip` = 2–4 litere din lista ghidului; `secvență` = exact 5 cifre; `filă` opțional,
    doar la un desen împărțit în mai multe planșe; `revizie` = **obligatorie de la Rev0**; `limbă` ∈ {RO, EN, BI} la Lot 1 (execuție și
    DDE). La Lot 2 limba **lipsește din structura codului**, dar ghidul cere limba în **numele fișierelor** → formatul codului și formatul
    numelui de fișier se configurează separat, până la clarificarea DCC.
  - Documentele se transmit „în format PDF și nativ”.
  - Forma folosită de DCC în corespondență: `30-GAZ-CTG1-COR-00045.Rev0.RO` (revizia și limba legate cu punct). Ghidul DDE are un exemplu
    cu altă ordine (limba înaintea reviziei). → **forma de afișare se configurează pe ghid** (§4.2), nu se codează fix.
  - Anexe: codul documentului de bază + numărul anexei, cu revizie proprie.
  - Minute de ședință: serie proprie, fără tematică (`<contract>-<emitent>-MOM-<secvență>-RevX[-RO]`).
- **Secvența:** „pentru fiecare emitent și fiecare tip de document de la fiecare tematică”, deci contorul e pe
  **(contract, emitent, tematică, tip)**. La DDE există intervale rezervate pe stație de robinete (SR1 = 00100–00199 …). Regula generală:
  „nu se alocă același cod unor documente diferite”.
- **Revizia:** Rev0 = emis spre aprobare; Rev1, Rev2 … = re-emis după comentarii; reviziile interne (revA, revB) nu sunt Rev0 și nu pleacă
  la DCC. Un document nu se retrimite de mai multe ori cu aceeași revizie.
- **Cine alocă:** emitentul își alocă singur numerele; DCC-ul beneficiarului doar verifică și înregistrează. Subcontractorii au cod de
  emitent propriu și comunică prin DCC-ul nostru.
- **Comunicarea:** trimiterea se face „de pe adresa de e-mail a DCC Contractor, dedicată acestui proiect, comunicată în prealabil”
  beneficiarului → argument pentru o **căsuță dedicată** (decizia rămâne la proprietar, §8). Codul fiecărui document trimis se menționează
  în mail; răspunsul poate veni și pe mail nou, dacă identifică clar codurile. La DDE: documentele pleacă însoțite de Transmittal (maxim
  50 de documente). Revizie nouă după modificări / comentarii.
- **Reguli operaționale din comunicările DCC (nu din ghiduri; sursă privată, mailul DCC de la începutul contractului):** limita unui mail
  25 MB, peste → link de transfer; istoricul pe același subiect (aceeași codificare); fără „Reply all” către DCC; documentul nu se
  retransmite de mai multe ori cu aceeași revizie. ERP-ul le aplică drept reguli propuse, configurabile pe proiect.
- **Diferențe și neclarități de confirmat cu DCC (nu le rezolvă ERP-ul singur):** ghidul Lot 2 a rămas cu tematica „CTG1 – Lot1”, dar
  registrul DCC al Lot 2 folosește CTG2; codul Roconsult diferă între ghiduri (RCS / RCT); ordinea câmpurilor la minute diferă între ghid și
  registrul DCC Lot 2; ghidul nu prescrie formatul subiectului.

## 3. Ce schimbă față de practica de azi (de confirmat de proprietar și de responsabilul de corespondență)
1. **Revizia apare mereu, de la Rev0**, în forma ghidului (`.Rev0`, `.Rev1`), în cod, în subiect și în numele fișierelor. Azi Rev0 lipsește
   de obicei, iar reviziile apar ca `_rev.N` în ~7 forme. Ghidul o face obligatorie: omiterea Rev0 nu e o variantă conformă; o eventuală
   derogare ar trebui documentată separat, cu acordul DCC. Configurabili sunt doar separatorii și ordinea câmpurilor afișate.
2. **Limba** (`.RO`) la Lot 1, cum cere ghidul; la Lot 2 doar dacă DCC confirmă.
3. **Subiectul**: `<COD complet> <Titlu>`; „Lot N” devine opțional (prefixul contractului identifică lotul). La situațiile de plată și
   facturi, codul intră și în subiect (azi e doar în corp și în PDF), după antetul financiar folosit acum.
4. **Numele fișierului**: `<COD complet>_<titlu scurt>.<ext>` (ghidul: „codul documentului, revizia și limba”).

## 4. Modelul de date (v1, cu structura pentru B)
Toate tabelele noi au RLS, acces prin sub-modulul nou `executie_dcc` **și** prin `fn_executie_proiect_permis(proiect, scriere)`; scrierea
doar prin RPC-uri `SECURITY DEFINER` (fără INSERT/UPDATE direct). `executie_proiecte.id` este `bigint`.

### 4.1 Configurare
- `dcc_ghiduri` (versionat): cod, versiune, sursa, regula de formatare (ordinea câmpurilor, separatori, prezența limbii), intervale
  speciale (ex. pe SR). Ghidurile nu se modifică după folosire; o schimbare = versiune nouă.
- `dcc_ghid_valori`: (ghid, categorie ∈ {emitent, tematica, tip, limba}, cod, descriere, activ). Listele din §2.
- `dcc_proiecte` (unul pe proiect Execuție + contract): ghidul aplicat, codul contractului (30/43/29), emitentul nostru, **mod_alocare** ∈
  {`automat`, `manual`} (Lot 4, unde emitentul e liderul asocierii, pornește `manual`: omul scrie secvența primită; BD verifică doar
  unicitatea la noi), adresa DCC (To), lista albă de CC (+ CC implicit pe tematică/tip), antetul financiar, **căsuța de trimitere = NULL**,
  comutatorul `trimitere_permisa` (fals).

### 4.2 Registrul (trei niveluri)
- `dcc_serii`: (proiect_dcc, emitent, tematică **nullable**, tip, interval) → `ultimul_ocupat` (contor), `prag_initial` = **ultimul număr
  ocupat** confirmat de om (prima alocare = prag + 1), `limita_sup` (00099 la intervalele SR, 99999 altfel), `initializata_de/la`.
  **O serie neinițializată refuză alocarea** (nu pornește singură de la 00001: numărul poate exista deja în corespondență); inițializarea e
  o operație separată, atomică, auditată. Epuizarea intervalului = refuz explicit, nu trecere în intervalul următor.
  - **Minutele (MOM)**: serie cu tematica NULL (serie proprie, nu excepție în formatter).
  - **DDE, intervale pe stație de robinete**: `interval` = `general` sau `SR1`, `SR2`… cu limitele ghidului (intervale disjuncte, verificate
    de constrângere); omul alege intervalul la alocare.
- `dcc_documente`: identitatea stabilă = (proiect_dcc, emitent, tematică, tip, secvență) UNIC **în domeniul contractului** (două proiecte
  ERP pe același contract nu pot aloca același cod); titlu, creat de/la, stare ∈ {`activ`, `anulat`} (anularea nu eliberează numărul).
  - **Planșe (filă)**: `dcc_file` (document, filă) — subentitate a documentului, fiecare cu revizia ei, ca la desenele împărțite.
  - **Anexe**: `dcc_anexe` (document de bază, număr anexă, titlu) cu revizii proprii (codul = codul de bază + numărul anexei).
- `dcc_revizii`: (document / filă / anexă, revizie int ≥ 0) UNIC; limba; titlul/descrierea reviziei; versiunea ghidului folosită la
  formatare; **codul complet înghețat** (textul expediat nu se reformatează dacă ghidul se schimbă); variantele lingvistice ale aceleiași
  revizii = rânduri cu limba diferită, dacă DCC le cere separat.
  - **Stare de transport** ∈ {`rezervata`, `pregatita`, `copiata_pentru_gmail`, `trimisa_manual_neverificata`, `trimisa_manual_confirmata`,
    `trimisa_erp`, `necunoscut`, `anulata`}. **Copierea nu dovedește expedierea**: „Copiază pentru Gmail” → `copiata_pentru_gmail`;
    „Confirm că am trimis” (separat) → `trimisa_manual_neverificata` cu data, căsuța declarată și dovada disponibilă (subiectul lipit,
    opțional); devine `_confirmata` doar cu o dovadă (în B: mesajul găsit în căsuță). Fără ID-uri inventate.
  - nr. adresă internă (opțional).
- **RPC-uri** (contracte complete în planul PR1: parametri, tranziții, audit):
  - `fn_dcc_initializeaza_serie(...)` — owner / admin DCC, prag confirmat, o singură dată pe serie;
  - `fn_dcc_aloca(proiect_dcc, emitent, tematica, tip, interval, titlu, cheie_intentie uuid)` — contor sub advisory lock pe serie, document +
    Rev0 în aceeași tranzacție;
  - `fn_dcc_aloca_manual(..., secventa)` — doar pe proiectele cu `mod_alocare = manual` (Lot 4), verifică unicitatea;
  - `fn_dcc_revizie_noua(document|fila|anexa, cheie_intentie)` — lock pe document, revizia = max+1;
  - `fn_dcc_anuleaza`, `fn_dcc_marcheaza_copiat`, `fn_dcc_confirma_trimis_manual`;
  - `fn_dcc_cod_text` / `fn_dcc_nume_fisier` (SQL) cu paritate exactă JS.
  - **Idempotență legată de conținut**: fiecare cheie de intenție se salvează cu hash-ul parametrilor cererii; aceeași cheie + aceiași
    parametri = același rezultat; aceeași cheie + alți parametri = **eroare**, nu codul altui document.
  - **`SECURITY DEFINER` nu se bazează pe RLS**: fiecare RPC verifică explicit apelantul (`auth.uid()`), sub-modulul `executie_dcc` și
    nivelul cerut, accesul la proiect (`fn_executie_proiect_permis`) și operația; `SET search_path = public, pg_temp`; `REVOKE EXECUTE FROM
    PUBLIC, anon`, `GRANT` doar `authenticated`. Fără INSERT / UPDATE / **DELETE** direct pe nicio tabelă `dcc_*` (inclusiv configurația
    comună: ghiduri, valori — doar owner).
- Codul se alocă **înaintea** documentului fizic: apare în cartuș și în numele fișierului.

### 4.3 Istoricul (două straturi, fără să ocolim unicitatea)
- `dcc_istoric_aparitii`: rânduri brute, imuabile, din Excel și din metadatele mailurilor trimise (sursa, identificatorul sursei, valorile
  originale, codul așa cum a fost scris, problema găsită: dublură / formă nestandard / revizie necunoscută / tematică greșită). Importul
  e idempotent pe identitatea sursei. **Revizia absentă = „necunoscută”**, nu 0.
- Legarea unei apariții de un document canonic se face doar când identitatea e clară; două documente diferite cu același număr rămân două
  apariții conflictuale vizibile (nu se inventează revizii). Pragul fiecărei serii = peste maximul credibil găsit (inclusiv numerele
  conflictuale), confirmat de om. Excelul și mailurile se reconciliază între ele (267 de rânduri + ~700 de fire nu înseamnă 967 de documente).
- Seriile financiare (situații de plată, facturi) au codul doar în corp/PDF în istoric: pragul lor se confirmă de om.

### 4.4 Mesaje și legături (pregătit pentru B; în v1 se folosesc doar pentru „trimis”)
- `dcc_casute`: adresa, tipul (dedicată / personală), proprietarul (la personală), starea conectării. Gol în v1.
- `dcc_mesaje`: direcția (trimis / primit), căsuța, RFC `Message-ID` (generat și salvat **înainte** de trimitere), Gmail message id,
  `threadId` (valabil **doar** împreună cu căsuța), `In-Reply-To`, `References`, subiectul original + forma normalizată, From/Sender/
  Reply-To separat, To/CC, data, manifestul atașamentelor (nume, mărime, sha256). La trimiterile manuale (v1) mesajul poate exista cu
  dovezi incomplete (fără Message-ID / threadId), marcat ca atare.
- `dcc_snapshoturi`: **copia imuabilă** a ce a aprobat omul — From, To, CC (fără BCC), subiect, corpul integral, linkurile, manifestul
  atașamentelor cu sha256 per fișier, utilizatorul și momentul aprobării; hash-ul doar identifică snapshotul. Mesajele emise de ERP se leagă
  **explicit, la emitere**, de revizia lor (legătură confirmată, nu dedusă din `References`).
- `dcc_legaturi`: (mesaj, revizie) m:n, metoda (antet RFC / thread / cod în subiect / cod în corp / tipar „_RE <cod>” / manual), dovada,
  starea (propusă / confirmată / respinsă), autor și moment. **Verdictul DCC** (validat / nevalidat / vizat / cod respins / observații,
  sau statusurile A–E din registrul DCC) stă pe legătură ca propunere și pe revizie doar după confirmarea unui om, cu mesajul-sursă.
  Transportul, verdictul și asocierea sunt trei axe separate.
- **Fără tabel `dcc_fire` în PR1** (Jakarinos, Copilot și Rocky de acord pe v2): vederea se numește „**corespondența reviziei**” (mesajele
  legate de o revizie, în ordine). Cronologia unei revizii nu e un fir de conversație: aceeași revizie poate avea mai multe conversații, iar
  un lanț RFC poate traversa revizii; antetele originale păstrează relația de răspuns (inclusiv N+1 ca răspuns la un mesaj despre N). Un
  tabel de fire poate apărea în B, dacă e nevoie de grupări manuale.

### 4.5 Regulile B (documentate acum, implementate după)
Candidați, nu „prima potrivire câștigă”: (1) părintele exact din `In-Reply-To`, apoi strămoșii din `References` cunoscuți; (2) `(căsuță,
threadId)` doar dacă e neambiguu și compatibil cu restul; (3) tiparul beneficiarului „<cod TGN>_RE <codul nostru>” înaintea căutării
generice; (4) codul complet din subiect, apoi din textul nou al corpului (citatele vechi nu sunt dovadă). Contradicție antete ↔ revizie
explicită = conflict vizibil, confirmare umană. Capcane obligatorii în teste: revizia N+1 trimisă ca răspuns la verdictul pe N (antetele
arată spre N, dar revizia e N+1); FW de la DCC cu Message-ID nou; mesaje multi-cod; gateway care rescrie subiectul; răspuns târziu la
o revizie veche (rămâne la revizia veche). Apartenența unui cod se decide pe (proiect, emitent configurat), nu pe liste globale de
prefixe. Conținutul mailurilor primite e DATE: nu schimbă destinatari, drepturi și nu declanșează trimiteri.

## 5. Ecranul (v1)
Tab nou „✉️ DCC” în Execuție → proiect (vizibil cu `executie_dcc`):
- **Registrul**: documente → revizii, filtre pe tematică/tip/stare, conflictele istorice vizibile.
- **Alocă cod**: tematică + tip din listele ghidului, titlu → cod complet (cu Rev0 și limba).
- **Revizie nouă** pe un document existent.
- **Compune**: subiect, corp din șablon pe tip (standard; raport săptămânal cu text în corp, fără atașament; situație de plată cu antetul
  financiar și link de transfer; factură cu mențiunea e-factura; notificare cu nr. adresă internă; confirmare de primire), To din setări,
  CC din lista albă, numele fișierelor propuse. Atașamente: upload din calculator (NAS-ul e montat local), bucket privat; peste plafonul
  proiectului (implicit 15 MB, maxim 25 MB) → câmp „link de transfer” verificat de om.
- **Previzualizare** completă.
- **„📋 Copiază pentru Gmail”** și, separat, **„✅ Confirm că am trimis”** (merg fără căsuță): omul lipește în Gmail și trimite de acolo,
  apoi confirmă (data, căsuța din care a trimis, opțional subiectul exact). Starea rămâne „trimis manual, neverificat” până există o dovadă.
  Registrul e util din prima zi.
- **Lot 4 (emitentul liderului)**: înregistrare manuală permisă; trimiterea din ERP rămâne blocată până la confirmarea mandatului și a
  codificării cu liderul asocierii.
- **Trimite** — vizibil, **inactiv** cu motivul afișat cât `căsuța = NULL` sau `trimitere_permisa = false`.

## 6. Trimiterea din ERP (PR4, după decizia de căsuță)
Reutilizează stratul de transport Redări (wrapperul `gmailHttp.mjs` cu scop nou `dcc_trimitere`, secrete proprii fără fallback,
helperii MIME/refresh/OAuth), nu tabelele Redări. Compunător nou (To + CC, N atașamente cu verificare pe octeți, In-Reply-To/References,
fără List-Unsubscribe). Apăsarea aprobă **snapshotul exact** văzut (hash); orice schimbare cere previzualizare nouă. Cheie de intenție +
CAS împotriva dublului clic. Rezultat ambiguu = `necunoscut`, fără retrimitere automată; reconciliere manuală („a plecat / n-a plecat”,
cu audit). Conectarea unei căsuțe nu trimite nimic din ce e pregătit; schimbarea căsuței invalidează aprobările. Garda „doar proiect de
TEST” la prima trimitere reală; probă: Message-ID păstrat, CC, atașament mare, DKIM/DMARC. Căsuță personală ⇒ doar proprietarul ei poate
apăsa Trimite.

## 7. Securitate (fișa a–e pentru registrul automatizărilor; se completează la PR4)
(a) conținut extern: metadatele importate și atașamentele urcate (date; nu schimbă destinatari/drepturi, nu declanșează nimic); în B,
mailurile primite. (b) scrie doar `dcc_*`; trimite mail extern doar la apăsarea unui om pe snapshotul aprobat. (c) JWT-ul omului; `service_role`
doar pentru citirea secretului OAuth, după toate gărzile; separat, în PR4: scrierile în Storage (bucket privat de atașamente, cu politici
pe proiect) și operațiile OAuth / Vault (conectare, scriere și revocare de secret — doar owner, state consumat atomic, identitatea căsuței
verificată), fiecare cu fișa ei. (d) poartă de rol în cod (`executie_dcc` + acces pe proiect + proprietarul căsuței
la căsuță personală). (e) confirmare umană: fiecare trimitere, importul istoric, inițializarea seriilor, conectarea căsuței (owner),
drepturile (doar cu „da”-ul proprietarului).

## 8. Decizii care rămân la proprietar
1. **Trecerea la forma reviziei din ghid** (`.Rev0` mereu) pentru emisiunile noi și anunțarea responsabilului de corespondență (practica
   de azi `_rev.N` doar de la 1 nu e conformă ghidului; o derogare = numai cu acordul scris al DCC).
2. **Căsuța de trimitere** (PR4): dedicată (cerută de ghid §1.4, recomandată de review) sau a responsabilului de corespondență până la
   finalul loturilor. Pentru B, o căsuță personală ar însemna citirea întregii căsuțe — disproporționat.
3. **Lot 4**: `manual` până există un interval rezervat convenit cu liderul asocierii.
4. Confirmări cerute DCC-ului (prin responsabilul de corespondență): CTG1/CTG2 la Lot 2, limba la Lot 2, codul Roconsult, forma minutelor.
5. Proiectul de TEST din Execuție pentru garda de trimitere.

## 9. Livrare (PR-uri mici, fiecare cu GO Jakarinos pe head + CI)
- **PR0** (acest document) → review.
- **PR1 BD**: configurare + registru + istoric (structura) + mesaje/legături (structura) + RPC-uri + RLS; migrare L15 v2 NEAPLICATĂ; probe
  pe clona 176 și concurență pe cluster dispensabil: prima alocare simultană pe serie nouă, retry după timeout (aceeași cheie = același
  cod), două revizii simultane, anulare, acces între proiecte.
- **PR2 UI**: tab-ul „✉️ DCC” (registru, alocare, revizie nouă, șabloane, previzualizare, Copiază + Marchează trimis; Trimite inactiv).
- **PR3 import**: script + raport de completitudine (dubluri, forme nestandard, maxime pe serie, serii financiare) + lista pentru
  responsabilul de corespondență → inițializarea seriilor cu pragul confirmat. Date reale → preview + „da”.
- **PR4 trimitere**: după decizia de căsuță, cu proba pe TEST și „da” separat la activare.
- **B**: după PR4, cu identitate de citire separată și fișă a–e proprie.

## 10. Review Focus (probe de acceptare obligatorii în PR1)
1. Serie **absentă** → refuz; serie **inițializată fără alocări** + două alocări simultane → două numere diferite, consecutive după prag.
2. Aceeași cheie de intenție cu **aceiași** parametri → același cod; cu parametri **diferiți** → eroare (la alocare și la revizie nouă).
3. Revizie nouă cerută de două ori în paralel → o singură Rev1 (cu chei diferite: Rev1 și Rev2, niciodată două Rev1).
4. Anulare → numărul nu se refolosește; limita intervalului (00099 la SR, 99999 altfel) → refuz explicit.
5. Import rulat de două ori → nicio dublură în `dcc_istoric_aparitii`.
6. „Confirm că am trimis” fără căsuță și fără Message-ID → stare „neverificat”, nicio valoare inventată.
7. Utilizator cu acces doar pe Lot 1 → nu vede și nu scrie registrul Lot 2, nici prin RPC, nici direct (SELECT / INSERT / UPDATE / DELETE).
8. Două proiecte ERP pe același contract → nu pot aloca același cod.
