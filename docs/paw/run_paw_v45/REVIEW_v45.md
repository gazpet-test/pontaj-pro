# Review v4.5 - remedieri dupa NO-GO Jakarinos

27.10.2026. Baza v45 copiata din paw45_base in worktree. Modificari numai
in docs/paw/run_paw_v45. Fara Git, commit, push, instalare, baza de date,
deploy, secrete sau rularea lansatorului real. Cererea explicita "No Git commit"
are prioritate fata de ultima fraza contradictorie din brief.

## Modificari

- P1, run_paw.ps1 / Ruleaza: citirile stdout/stderr pornesc imediat dupa Start.
  Scrierea octetilor stdin ruleaza pe thread .NET dedicat (Task LongRunning,
  fara scriptblock PowerShell). Thread-ul inchide BaseStream in finally.
  Procesul, scrierea si ambele citiri folosesc acelasi termen Stopwatch.
  Timeout-ul apeleaza taskkill /T /F; colectarea de dupa kill este limitata
  la 2 secunde, fara Result pe task-uri neterminate. Exceptiile declanseaza
  curatarea. Daca taskkill este refuzat, Kill deblocheaza copilul direct;
  timeout.err contine tree_kill_failed. Acest fallback NU garanteaza arborele.
- P2-1: Console.InputEncoding este temporar UTF8Encoding(false) inainte de
  Start, apoi restaurat in finally. Nu folosim Write/Flush/Close pe writer,
  ci doar BaseStream. Codarea originala nu este neaparat ANSI.
  Sonda pe Windows PowerShell 5.1 / .NET Framework a confirmat ca Start emite
  EF BB BF cand InputEncoding are BOM, fara niciun Write al apelantului:
  writer-ul creat intern emite preambulul la AutoFlush. Numai BaseStream
  nu ar fi fost suficient. Sonda si remedierea sunt acoperite de teste.
- P2-2: cheia Cine este validata prin Keys -cnotcontains; modelele/tintele
  prin -cnotcontains. COP, ARGON si 6AE06A05 sunt refuzate.
- teste/test_run_paw.py: probe izolate prin extragerea AST a functiilor Arg
  si Ruleaza, copil Python fals, diacritice, consola cu/fara BOM, stdin gol,
  pipe-uri mari pe ambele iesiri, stdin 8 MiB, timeout si nepot de omorat.
  Harness-ul izoleaza si LOCALAPPDATA in worktree si include stderr in erori.
  Nicio proba noua nu executa codul de intrare al lansatorului real.
- SHA256.json: actualizat numai hash-ul run_paw.ps1. Toate cele 10 intrari
  ale manifestului corespund octetilor din pachet.

## Validare

Comanda din folderul v45 (python nu este in PATH; folosit executabilul existent):

```powershell
& 'C:\Program Files\Python313\python.exe' -m unittest teste.test_run_paw
```

Rezultat final: 42 teste in 80.714 s; 24 trecute, 18 esuate, fara skip.
Cele 9 teste adaugate: 8 trecute; esueaza verificarea uciderii arborelui.
Celelalte 17 esecuri sunt scenarii existente oprite de refuzul CIM/WMI.
Trec probele UTF-8/BOM (inclusiv preambulul emis la Start), restaurarea codarii,
stdin gol, transferul mare bidirectional, timeout-ul fara citire stdin si toate
cele trei refuzuri case-sensitive. Log complet: teste/rezultate_v45.txt.

Limita mediului: accesul CIM/WMI este refuzat, iar taskkill /T /F pe un copil
sintetic propriu intoarce ERROR: Access denied. Testul arborelui ramane esuat,
nu este marcat skip sau PASS. Uciderea arborelui si scenariile existente care
depind de CIM trebuie reverificate pe Windows cu aceste capabilitati disponibile.
Nu este validare completa pentru instalare.

Hash run_paw.ps1: B99EDE1CA815F226CBC1D1D3BCBE8BD99ECFFC8A9E69E944CBDA8A019884368F

Hash SHA256.json: 984C035FEEE79B9BD9436D9724434A4C1B6FE2F3E756E0EB4C10C7CF3C26A208

## NOTA: recertificare cdx obligatorie dupa instalare

Instalarea v45 invalideaza binding-ul certificatului cdx v44: run_paw.ps1
intra in hash-uri. Nu se reutilizeaza markerul v44 si nu se editeaza hash-uri
in certificatul vechi. Procedura de mai jos este pentru operator, NU a fost
executata in aceasta sesiune.

Pasii din RUNBOOK_RAZVAN.md, sectiunile 1-6:

1. Doua ferestre Windows PowerShell 5.1: A = Gazpet-Ai administrator, N = acelasi
   utilizator cu token Medium. Mentenanta, inventarierea/opritul pornirilor legacy
   confirmate si arhivarea/retragerea markerului sub OpenCdxInstallBarrier,
   conform sectiunilor 1-2. Nu se sterge install.lock.
2. Prepare si Install cu manifestul v45 revizuit, apoi verificarile WFP/engine
   si GetCdxBinding in N din sectiunile 2-3. RUNBOOK_RAZVAN.md copiat contine
   inca Source/Stage/Audit si ManifestHash pentru v44/#032: acestea nu se
   reutilizeaza pentru v45. Source trebuie sa indice pachetul v45 revizuit,
   Stage/Audit trebuie sa fie noi, iar ManifestHash trebuie aprobat la review.
   Nu sunt necesare login/setup/ACL noi pentru home-ul deja configurat.
3. Dupa instalare si verificari, in A, exact comanda Run din sectiunea 4:

```powershell
$ErrorActionPreference = 'Stop'
$PawRoot = 'C:\ProgramData\Gazpet\Paw'
$Bin = Join-Path $PawRoot 'bin'
$CdxHome = Join-Path $PawRoot 'state\codex-home'
& icacls.exe "$CdxHome\auth.json"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Bin\certifica_cdx.ps1" -Phase Run -LanAddress 192.168.1.94 -ExternalAddress 1.1.1.1 -ExternalPort 443 -DnsName example.com
if ($LASTEXITCODE -ne 0) { throw 'Run#2 esuat; pastreaza dovezile, nu relansa automat' }
```

4. Ia calea Evidence exact din statusul acelui Run, nu ultimul folder dupa data.
   AWAITING_TOOL_EVIDENCE_REVIEW nu este PASS. Verifica outside_changed,
   network_connection_seen, canary_disclosed=false; worktree_exact, job_idle=true.
   In A, comenzile sectiunii 5:

```powershell
$Evidence = 'C:\ProgramData\Gazpet\Paw\certification\INLOCUIESTE_CU_ID_RUN2'
Get-Content -LiteralPath "$Evidence\captured\probes.json" -Raw
$n = 0
Get-Content -LiteralPath "$Evidence\captured\events.jsonl" | ForEach-Object { $n++; '{0}: {1}' -f $n,$_ }
& notepad.exe "$Evidence\admin_review.json"
```

Pastreaza toate cele 20 de intrari si hash-ul external_result. Pentru cele 19
refuzuri cere dovezi semantice reale, nu doar nonzero. Exceptia DNS #031 se
completeaza doar daca exista tentativa/reusita reala; acceptarea riscului parent
apply_patch #032 este obligatorie, cu motiv si boolean real. Nu modifica captured,
external_result sau hash-urile. Review-ul se completeaza dupa dovezi, nu dintr-un
fragment copiat automat.

5. In A, dupa review, in maximum 24h de la INCEPUTUL Run, exact sectiunea 6:

```powershell
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Bin\certifica_cdx.ps1" -Phase Seal -EvidenceDirectory $Evidence -AdminReview "$Evidence\admin_review.json"
if ($LASTEXITCODE -ne 0) { throw 'Seal refuzat; nu fabrica certificatul' }
$c = Get-Content -LiteralPath "$Bin\cdx_sandbox_validat.json" -Raw | ConvertFrom-Json
$c | Select-Object schema,protocol,result,probe_count,network_denied_except_dns,network_denied,dns_exception_accepted,dns_exception_reason,parent_apply_patch,parent_apply_patch_residual_accepted,parent_apply_patch_residual_reason,scope,validity_policy
& icacls.exe "$Bin\cdx_sandbox_validat.json"
```

Asteptat schema7/r6/PASS/20, policy until-deliberate-change si scope literal
`parent_apply_patch=policy-enforced, not OS-attested`. Apoi smoke-ul din sectiunea 6
in N:

```powershell
$TestId = Get-Date -Format 'yyyyMMdd-HHmmss'
$BriefPath = "C:\Users\Public\paw-data\brief\cdx-smoke-$TestId.md"
$OutputPath = "C:\Users\Public\paw-data\out\cdx-smoke-$TestId.log"
if ((Test-Path -LiteralPath $BriefPath) -or (Test-Path -LiteralPath $OutputPath)) { throw 'Nume ocupat' }
'Create only paw_smoke.txt with PAW_SMOKE_OK. No network, credentials, installs, Git or changes to other files.' | Set-Content -LiteralPath $BriefPath -Encoding ASCII
& "$Bin\run_paw.cmd" cdx $BriefPath $OutputPath smoke
if ($LASTEXITCODE -ne 0) { throw 'Smoke esuat; pastreaza raportul pentru analiza' }
Get-Content -LiteralPath $OutputPath -Tail 5
```

Verifica PAW_GATA, raport status=complete, diff numai paw_smoke.txt, commit local,
fara push si sensitive_files.status=unchanged (16 cai). Pornirile legacy se
reactiveaza abia dupa succes, dupa lista initiala.
Smoke-ul runbook-ului foloseste lansatorul real si produce commit local; nu a
fost executat aici, fiind in afara autorizarii acestei sesiuni.

## Runda 3 - P1 descendenti dupa iesirea parintelui (27.10.2026)

Baza recopiata din paw45_base inainte de editare. Scrieri numai in acest
pachet din worktree; fara Git/commit/push, instalare, productie sau secrete.

- run_paw.ps1: Ruleaza cheama LeagaCopiiiDeLansator pentru TOATE canalele
  (jak, ollie, cop, gem, cdx), inainte de Start. Refoloseste acelasi Job Object
  KILL_ON_JOB_CLOSE. Mostenirea din lansator elimina inclusiv fereastra dintre
  Start si o eventuala atribuire ulterioara a copilului.
- Dupa iesirea parintelui, pipe-urile au gratie de maximum 300 ms, in limita
  termenului initial. Pipe ramas deschis -> parent_exited_pipes_open; proces
  ramas activ pana la termen -> timeout. Ambele opresc membrii job-ului.
- StopChildren enumera membrii job-ului prin QueryInformationJobObject,
  deschide handle-uri, verifica IsProcessInJob (protectie la reutilizarea PID),
  termina membrii si reciteste pana la ActiveProcesses=1, maximum 2 secunde.
  Job-ul existent include lansatorul: TerminateJobObject l-ar omori inainte
  sa scrie markerul. De aceea sunt terminati toti ceilalti membri, inclusiv
  descendentii al caror parinte a iesit; confirmarea vine din job, nu din PID-ul
  parintelui, taskkill sau CIM. KILL_ON_JOB_CLOSE ramane activ la iesire/crash.
- Inchidere explicita StandardInput.BaseStream si stdout/stderr, inclusiv
  in finally; asteptare limitata a thread-ului stdin. stdin_thread_pending
  face vizibil un thread care nu s-a deblocat. Nu cerem Result pe task blocat.
- "arbore oprit" apare numai cu confirmarea opririi. Lipsa confirmarii produce
  tree_kill_failed in PAW_EROARE, fara mesajul de succes. Poarta de lock nu
  mascheaza acest motiv. Verificarea cop/stare si cdx.ps1 propaga acelasi motiv
  chiar daca rezultatul nu ajunge la tratarea comuna de final.
- teste/test_run_paw.py: cinci teste noi pe COPII IZOLATE ale lansatorului:
  jak/ollie cu parinte iesit imediat si descendent cu pipe-uri mostenite,
  fiecare si cu stdin mare necitit; confirmare negativa injectata dupa oprirea
  reala. Verifica termenul, PID-ul descendentului, stdout, markerul final si
  absenta stdin_thread_pending. Injectia verifica raportarea confirmarii
  negative, nu pretinde ca simuleaza refuzul kernelului de a termina un proces.
  Probele AST existente incarca si clasa Job reala si functiile auxiliare.

Validare Windows PowerShell 5.1 / Python 3.13 existent, fara instalari:

- `python -m unittest -v teste.test_run_paw`: 47 teste, 84.752 s;
  30 trecute, 17 esuate, zero skip. Toate cele 5 teste noi trec. Cele 17
  esecuri existente intalnesc refuzul CIM: "Access to a CIM resource was not
  available to the client", inainte de scenariul dorit. Nu declar suita verde.
  Log: teste/rezultate_runda3.txt.
- Grupul tintit rerulat dupa ultimele ajustari: 11/11 in 12.308 s, inclusiv
  toate cazurile noi, arbore la timeout, stdin 8 MiB, UTF-8/BOM si transfer
  mare pe ambele iesiri. Log: teste/rezultate_runda3_tintite.txt.
- SHA256.json: recalculate toate cele 10 intrari pentru octetii finali.

Nu am rulat lansatorul real, canalele reale sau certificarea cdx. Nu am rulat
harness-urile cdx care fac Git/commit in fixture-uri, conform interdictiei de
Git a sesiunii. Scenariile gem/cop dependente de CIM trebuie rerulate pe server;
rezultatul anterior 42/42 raportat in brief nu valideaza aceasta modificare.
