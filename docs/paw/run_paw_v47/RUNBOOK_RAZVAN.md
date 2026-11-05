# Paw v4.7 — cxw; instalare numai de Răzvan după review

Agentul nu instalează, nu schimbă ACL/WFP pe server și nu face login.
Pachetul copiază v461; modifică lansatorul/wrapperul/installerul și adaugă
`codexweb_pw.py`. Restul runtime-ului rămâne identic. Modificarea lansatorului
invalidează certificarea cdx: este necesar Install + Run/Seal din procedura r6.

**Limită de validare:** nu a fost disponibil Edge-ul Windows autentificat.
Selectorii de mai jos sunt un contract conservator, încă neverificat pe UI-ul
real Codex. Nu declara canalul utilizabil înainte de probele de acceptanță.
Dacă un selector nu corespunde, canalul refuză sau ajunge la timeout; corectează
pachetul în repo și reia review/hash-urile. Nu relaxa aprobările/finalizarea în bin.

## 1. Pachet revizuit și teste înainte de instalare

A = PowerShell 5.1 admin; N = același cont Gazpet-Ai fără elevare. Orice eroare = STOP.
Extrage commit-ul aprobat într-un director nou. În A și N:

```powershell
$ErrorActionPreference = 'Stop'
$Source = 'C:\Users\Public\livrare\run_paw_v47\docs\paw\run_paw_v47'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$CdxHome = Join-Path $PawRoot 'state\codex-home'
$Stage = 'C:\Users\Public\paw-data\stage-v47'
$Audit = Join-Path $PawRoot 'operator-v47'
$ManifestHash = 'INLOCUIESTE_CU_HASH_SHA256_JSON_DIN_RAPORTUL_APROBAT'
$LegacyHash = 'INLOCUIESTE_CU_HASH_CGPT_PW_REVIZUIT_AL_INSTALARII_CURENTE'
$Operator = "$env:COMPUTERNAME\Gazpet-Ai"
$ReaderSid = (New-Object Security.Principal.NTAccount($Operator)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($ManifestHash -notmatch '^[A-Fa-f0-9]{64}$' -or $LegacyHash -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Lipsesc hash-urile aprobate' }
if ((Get-FileHash -LiteralPath "$Source\SHA256.json").Hash -ine $ManifestHash) { throw 'Alt manifest' }
$manifest = Get-Content -LiteralPath "$Source\SHA256.json" -Raw | ConvertFrom-Json
foreach ($e in $manifest.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath (Join-Path $Source $e.Name)).Hash -ine $e.Value) { throw "Hash diferit: $($e.Name)" }
}
if ((Get-FileHash -LiteralPath "$Bin\cgpt_pw.py").Hash -ine $LegacyHash) { throw 'Helper cop nerevizuit' }
# Testele DOM offline folosesc si Node existent (fara browser sau pachete npm noi).
& 'C:\Program Files\nodejs\node.exe' --version
& 'C:\Program Files\Python313\python.exe' -B "$Source\teste\test_codexweb_pw.py"
if ($LASTEXITCODE -ne 0) { throw 'Teste Python eșuate' }
& powershell.exe -NoProfile -File "$Source\teste\test_contract.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Contract PowerShell eșuat' }
& 'C:\Program Files\Python313\python.exe' -c "import importlib.metadata; print(importlib.metadata.version('playwright'))"
```

Playwright trebuie să suporte `Locator.and_`/`or_` (>= 1.34). Nu se instalează
browser nou: se folosește numai Edge existent, port 9333, ascultare exclusiv pe
127.0.0.1/::1. Operatorul verifică login-ul Codex și existența mediului EXACT
`pontaj-pro`. Brief-urile de probă sunt sintetice, fără secrete/date personale.

## 2. Mentenanță, Prepare, Install și recertificare

Folosește [runbook v46](../run_paw_v46/RUNBOOK_RAZVAN.md), cu variabilele v47 de
mai sus. Nu folosi verificarea „doar lista cop” din v461: nu se aplică acestui pachet.

1. v46 secțiunea 1: inventar procese/taskuri/servicii, oprire porniri vechi;
   taburile Edge existente se păstrează. Nu continua cu rulări Paw active.
2. v46 secțiunea 2: retragere certificat sub `install.lock`, arhivă bin și
   `old_bin_hashes.json`, Prepare, eliminarea exclusiv a GUID-urilor WFP Paw.
   Prepare v47 verifică/copiază **13 fișiere runtime + SHA256.json**, inclusiv
   `codexweb_pw.py`; installerul include noul helper în inventarul proceselor.
3. v46 secțiunea 3: Install cu `-LegacyStartsStopped -LegacyHelperSha256 $LegacyHash`,
   verificare hash-uri/ACL/runtime/WFP. Fără `-UseExistingGitCredentialManager`.
   Verifică explicit prezența și hash-ul `bin\codexweb_pw.py`.
4. v46 secțiunile 4–6: login separat numai dacă lipsește, smoke jak și Gemini,
   test de canal Gemini. `gemini_pw.py` este identic cu v461; markerul existent
   legat de același hash nu trebuie inventat/refăcut artificial.
5. Probele cxw din secțiunea 3 și certificarea OBLIGATORIE din 3a de mai jos; apoi v46 secțiunea 7: Run și Seal r6
   pentru noul hash `run_paw.ps1`. Nu copia certificatul vechi peste noul bin.
6. Restabilește numai pornirile oprite în pasul 1, după toate verificările.

## 3. Contract UI și probe de acceptanță (N, supravegheate)

Canalul presupune: `/codex` fără mesaje pentru chat nou, buton exact
`Choose environment`, opțiune cu numele exact `pontaj-pro`, apoi butonul mediului
selectat cu același nume. Composer unic vizibil: textarea sau contenteditable
cu role textbox. Controlul `Approve for me` trebuie să fie vizibil, cu role
switch/checkbox/menuitemcheckbox și `aria-checked="false"`. Lipsă/ON/ambiguu = refuz;
scriptul nu deschide meniuri de aprobare și nu schimbă setarea.

Send are numele exact `Send` sau `Send message`. URL-ul rezultat trebuie să fie
`https://chatgpt.com/codex/tasks/task_<16..64 hex lowercase>`. Alte forme se refuză,
inclusiv URL de chat ChatGPT obișnuit, query, fragment, port, userinfo sau redirect.
Mesajele au `data-message-author-role=user/assistant`, identitate stabilă
`data-message-id` (pe mesaj sau strămoș), ori `id` pe mesaj. După Send, AMBELE
moduri cer exact +1 mesaje user și ultimul text identic cu brief-ul normalizat.
Numai după această dovadă apare `trimis`, se oprește driverul de trimitere și se
eliberează lock-ul. URL-ul neschimbat la continuare nu este dovadă de trimitere.

Răspunsul trebuie să fie DUPĂ acel mesaj user în DOM. Containerul lui propriu este
`article[data-testid^="conversation-turn-"]`, sau `[data-message-id]`, sau chiar
elementul assistant; trebuie să conțină exact acel assistant și niciun user.
Statusul `data-task-status` și Stop sunt citite numai din acest container, niciodată
global. Finalizarea cere aceeași identitate de răspuns, BUSY/running/queued observat
pe el → completed unic vizibil fără busy, text nevid identic la 3 citiri consecutive
(2 secunde între citiri în watch). Lipsa identității/scope-ului refuză, iar lipsa
tranziției/stabilității expiră. Verifică atributele pe UI-ul real înaintea probei.

Confirmarea detectată în draft înainte de Send produce tot exit 0 și
`PAW_GATA <id> stare=asteapta_confirmare`, cu `submitted=false` și URL-ul actual,
fără `trimis` sau Send. Pentru chat nou, URL-ul poate fi `/codex`: încă nu există
un task. Această excepție nu este acceptată pentru un task trimis/complet sau
pentru cxw-continua. OFF rămâne obligatoriu pentru trimitere.

```cmd
run_paw.cmd cxw C:\Users\Public\paw-data\brief\cxw-proba.txt C:\Users\Public\paw-data\out\cxw-proba.log pontaj-pro
run_paw.cmd cxw-continua C:\Users\Public\paw-data\brief\cxw-urmator.txt C:\Users\Public\paw-data\out\cxw-urmator.log https://chatgpt.com/codex/tasks/task_ID_VALID
```

`task_ID_VALID` este un placeholder: copiază URL-ul real, verificat vizual, din prima
rulare. Mesajul de continuare este explicit scris de om; canalul nu formulează răspunsuri.

- Probă normală: cere un răspuns scurt fără modificări în repo; verifică mediul,
  egalitatea textului (inclusiv diacritice/spații), un singur Send, URL și răspuns
  final în log. Ultima linie `PAW_GATA <id> stare=gata`, jurnal Europe/Bucharest.
- ON înainte de lipire, apoi ON între lipire și Send: ambele trebuie să refuze
  fără Send. Testele simulate acoperă cele două cazuri; reproduce-le supravegheat.
- Mediu necunoscut, URL advers, brief în afara brief/out în afara out, UNC/ADS/junction,
  atașamente sau draft vechi: refuz. Nu se suprascrie un draft existent.
- Confirmare publicare/aprobare sau întrebare: fără click/răspuns; logul are URL,
  text disponibil și `PAW_GATA <id> stare=asteapta_confirmare`. Omul decide separat.
  Orice dialog/control de confirmare este tratat conservator ca o cerere umană.
- Concurența, lock-ul real și timeout-ul se certifică obligatoriu prin secțiunea 3a;
  o probă secvențială sau doar simularea offline nu este suficientă.
- PR: cu un brief autorizat separat care cere PR draft, verifică linkul github.com
  `/owner/repo/pull/număr` în `pr_urls`; canalul însuși nu apasă Create PR/Publish.
- Log: hash SHA256 al textului UTF-8 fără BOM + lungime; brief-ul integral nu apare.
  Răspunsurile sunt JSON pe o singură linie fizică; nu pot falsifica markeri PAW.
  Erorile Playwright brute/stderr nu se persistă. Tokenurile uzuale sunt redactate;
  probele și brief-urile nu trebuie să conțină secrete/date personale. Test negativ:
  brief alcătuit exclusiv dintr-un link PR sintetic; chiar dacă răspunsul îl repetă
  într-un href, `pr_urls` trebuie să-l omită, la fel ca textul filtrat.

## 3a. Certificare Windows OBLIGATORIE: concurență, lock și kill pe arbore

Aceasta este poartă de acceptanță înainte de utilizarea cxw și de restabilirea
pornirilor normale. Răzvan o execută după review, pe bin-ul cu hash-urile v47,
în N; inventarul proceselor poate fi colectat read-only în A. Fiecare punct de mai
jos trebuie să aibă PASS și dovadă în `$Audit`; altfel STOP, canal neacceptat.
Agentul nu a executat aceste probe pe server și nu instalează nimic.

1. Rulează `teste/test_codexweb_pw.py` pe Python Windows și
   `teste/test_contract.ps1` pe PowerShell 5.1. Testul
   `test_real_two_process_lock_and_crash_release` trebuie să TREACĂ, fără skip:
   proces A ține lock-ul, proces B primește exact `interactiune_ocupata`; după
   moartea lui A, B îl poate lua, fără ștergerea fișierului. Testul PowerShell
   trebuie să confirme și respingerea junction, protocolul HOME/confirmare și
   calculul bugetului rămas. Salvează rezultatele și versiunile în audit.
2. Pregătește patru brief-uri sintetice read-only suficient de lungi ca rulările
   să se suprapună: două cxw cu markeri diferiți, un cop pe conversație permisă
   și un gem cu etichetă nouă permisă. Pornește cop și gem prin `run_paw.cmd` și
   confirmă că ambele sunt active; notează URL-urile/taburile și PID-urile lor.
   Nu există date personale/secrete, publicare sau aprobări în brief-uri.
3. Pornește două instanțe cxw SIMULTAN (două console/procese, fără a aștepta
   terminarea primei), fiecare cu propriul brief/output. Dacă se suprapun în
   fereastra scurtă de interacțiune, una poate refuza `interactiune_ocupata`:
   verifică lipsa Send/mesajului user și lipsa `trimis` pentru cea refuzată.
   Numai după verificarea aceasta, operatorul o poate relansa manual, după
   confirmarea mesajului user al primei în UI și eliberarea lock-ului; în logul
   final trebuie să existe `trimis` pentru ea. Fără retry automat și fără
   retrimiterea unui caz ambiguu.
   Trebuie să rezulte DOUĂ sarcini cloud și două watch-uri simultan active,
   cu URL-uri distincte, în timp ce cop și gem încă rulează.
   Notă: pipe-ul lansatorului persistă evenimentele helperului după ieșirea lui;
   nu aștepta un `trimis` live în fișier cât timp watch-ul rulează. Dovada live este
   mesajul user exact în UI + lock-ul liber; logul final confirmă evenimentul.
4. Înainte ca prima sarcină să se termine, verifică faptul că `lock_cxw` poate fi
   luat (sau că a doua trimitere a reușit în acel interval), fără ștergere de lock.
   Pentru fiecare log `trimis`, inspectează mesajul user corespunzător: exact +1,
   text normalizat identic markerului/brief-ului propriu. La `cxw-continua`,
   repetă proba cu URL neschimbat: niciun `trimis` înainte de existența mesajului.
   Taburile/mesajele cop/gem nu trebuie schimbate de cxw; niciun focus/reload/close.
5. Pe un turn nou, verifică BUSY propriu → completed propriu și 3 citiri stabile.
   Cu completed rămas în turnul vechi și text parțial nou, fără completed în
   containerul răspunsului nou, NU trebuie să apară `stare=gata`. Testele DOM
   offline acoperă această secvență; reproduce-o observând UI-ul, fără a atribui
   unui badge global sens de finalizare. Confirmarea din draft trebuie să dea
   `asteapta_confirmare` + URL + `submitted=false`, fără Send sau `trimis`.
6. Pornește o a treia probă cxw cu `PAW_CXW_TIMEOUT_SECONDS=60` (șterge variabila
   după probă), cu celelalte watch-uri/cop/gem active. Cronometrează de la pornire,
   nu de la Send: verificarea listenerului și a driverului orfan consumă ACELAȘI
   buget, fără încă 10/15/30 secunde adăugate înaintea lui. Înregistrează arborele
   procesului acestei rulări: PID, ParentProcessId, CreationDate și numele
   executabilului (fără dump de mediu sau conținut de brief). La timeout trebuie
   `PAW_EROARE`, iar toți descendenții săi Python/Node/PowerShell de verificare să
   dispară. Acordă separat numai grația de curățare Job deja existentă; nu o
   confunda cu timp acordat trimiterii/urmăririi. Verifică PID + CreationDate,
   ca un PID reutilizat să nu mascheze rezultatul.
7. Repetă întrerupând procesul părinte al unei probe în faza de interacțiune:
   Job Object trebuie să oprească descendenții; o pornire nouă trebuie să refuze
   cât timp există un driver orfan, fără contact CDP și fără Send. Niciun proces
   din celelalte cxw/cop/gem și nici Edge-ul extern nu trebuie omorât. Arhivează
   inventarul înainte/după, logurile și exit-urile pentru TOATE procesele lansate.
8. Verifică finalizarea normală a celorlalte sarcini, lipsa mesajelor duplicate,
   hash-ul/lungimea în locul brief-ului și absența linkului-brief în `pr_urls`.
   Sarcina cloud a probei oprite poate continua: inspectează URL-ul manual înainte
   de alt mesaj; nu apăsa automat Stop/Approve/Publish și nu interpreta timeout-ul
   local drept anulare cloud. Atașează matricea PASS/FAIL pe punctele 1–8 la audit.

## 4. Rollback numai la pachetul anterior revizuit

Păstrează arhiva v461/retired bin și hash-urile din pasul 2. În mentenanță, cu
aceleași bariere și porniri oprite, reinstalează pachetul v461 revizuit după
[runbook-ul lui](../run_paw_v461/RUNBOOK_RAZVAN.md), adaptând inventarul la arhiva
salvată, și recertifică cdx pentru hash-urile restaurate. Nu executa automat v46
secțiunea 8 (aceea revine la v45). Nu șterge lock-uri și nu restaura certificat
vechi peste runtime diferit. La stare neclară: lasă cdx necertificat și investighează.
