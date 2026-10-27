# Paw v4.6 - runda 4 (27.10.2026)

Stare: implementare locala; 152/152 executii de test Paw + 40/40 paw-juridic verzi.
Fara commit/push sau deploy.
Baza: paw_v46_r4_base.patch aplicat cu git apply --whitespace=nowarn.
SHA256 calculat: 5F12F8AB3027FBA02E66B74157CC906CBFE3312A2BC5949A0CEF5A1FA0AA4804.
Nu a fost furnizata o amprenta independenta pentru comparatie/autenticitate.

Decizia Razvan: jak fara integrari MCP sau chei; deschiderea paginilor prin
integrarea externa ramane la Claude cu omul in bucla. Gemini are conversatie
pe lucrare, optional; fara eticheta ramane chat nou. Dupa 30 schimburi roteste.

Eliminat din executabile/config: server, bearer, secrets, prompt de instalare,
preflight get si redactare. Testele vechi exclusiv pentru acea integrare sunt
inlocuite cu contractul zero MCP si lipsa cheilor; nu sunt declarate regresii
compatibile cu designul eliminat.

P1 r3: notify=[] in config si override, config/read verifica notify/hooks/MCP;
features list verifica apps/plugins/remote_plugin/hooks/dependency_install
false DUPA normalizarea requirements cloud. Apps implicita este conditionata
de features.apps: refuzul false inchide calea chiar daca mcp list omite Apps.
.env refuzat inaintea oricarui copil si reverificat inainte de exec.
Pastrat: runtime protejat, --ephemeral, --ignore-rules, refuz politici system,
sandbox unelevated/read-only explicit, exit nenul = PAW_EROARE.

Surse primare Codex rust-v0.162.0 (consultate read-only):
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/cli/src/main.rs
  FeaturesSubcommand::List: cloud_config::load_config -> config.features.enabled.
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/app-server/src/config_manager_service.rs#L119
  config/read: effective_config + apply_exact_to_config. Nu este un config local aproximat.
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/config/mod.rs#L3788
  Web implicit Cached. v45/run_paw.ps1 nu are --search/web_search override;
  r4 elimina web_search=disabled din v46, nu adauga live. Nu citim profil real.
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/mcp.rs#L394
  Apps implicita la runtime: blocata de features.apps=false efectiv.

Registru Gemini: numai lansatorul scrie JSON atomic cu flush pe disc, sub
lock_gem; browserul returneaza URL doar in ultima linie de protocol. URL-ul
este validat integral in ambele procese. URL invalid salvat = refuz tinta,
mesaj explicit, chat nou. JSON invalid/I/O esuat = refuz, nu registru gol.
Inainte de submit retragem intrarea veche; crash/timeout = context necunoscut,
fara retry; urmatorul apel deschide chat nou. Niciun chat Gemini nu este sters.

Limite: fara Codex/Edge/CDP real, instalare, login, ACL certificare sau smoke OS.
Smoke citire executata OK / scriere incercata si refuzata ramane in RUNBOOK,
obligatoriu pe server inainte de activare. Probe offline nu atesta acest lucru.
Incercarea accidentala de citire skill ProgramData a fost refuzata de mediu;
nu s-au facut scrieri acolo si nu s-a continuat accesul.

## Dovezi r4 si L01-L25

Rezultatele numerice sunt in teste/RESULTATS_r4.json si logul r4_execution.log.
Ultima suita extinsa: 152/152, zero skip, zero erori, 116.368s. Include 11
executii r3 repetate prin importul fixture-ului Isolation in modulul r4 (141
scenarii distincte). Nu prezentam repetitia ca probe independente.
Prima suita extinsa: 148/150; fixture Prepare fara noul helper si serializare
ETS in harness. Ambele corectate si intreaga selectie rerulata.
SHA256.json: 12/12 potriviri. Python AST/ASCII si parser PS 5.1: OK.
Testele paw-juridic: 40/40 la ultima rulare; o prima rulare a avut o cursa
in fixture-ul concurent (eroare locala, apoi rerulare completa verde).
Rezultatul initial nu este ascuns: nu constituie dovada unei regresii rezolvate.
Blocaj fixture PS URL invalid: serializarea JSON recursiva a proprietatilor
ETS atasate de Get-Content textului, dupa ce produsul terminase. Harness-ul
foloseste acum IO.File.ReadAllText pentru un string simplu. Fereastra harness
este 30s; timeout-ul produsului nu s-a marit. Corectia File.Replace testata real pe NTFS:
[NullString]::Value, nu $null convertit de PowerShell in string gol.

Regresii modificate justificat:
- test_v46.Jak si vechile Mcp r2 pentru server/bearer/cheie/redactare au fost
  inlocuite cu teste zero MCP, notify/hooks, features cloud, .env, mediu curat.
- test_gemini_pw sursa accepta o singura navigare la target validat, in loc
  de literal /app; testele fara eticheta pastreaza /app la fiecare apel.
- test_server asteapta 5 unelte si argon explicit; antetul jak reflecta decizia.
Toate celelalte scenarii de proces/lock/pipes/rules/runtime raman in selectie.
Suita nu ruleaza modulele cu Git/credential helper sau probele live.

| Regula | Dovada r4 / motiv n/a |
| --- | --- |
| L01 | run_paw.ps1: LuaLock inainte de CitesteGemLucrari/contor; test_run_paw lock/cursa pe procese reale. |
| L02 | ScrieGemLucrari: flush(true) + File.Replace atomic; Registry testeaza citire/scriere reala. |
| L03 | Lock pastrat prin navigare/raspuns/salvare; context retras inainte de submit; test_partial_response_retires_context. |
| L04 | n/a - fara cantitati/bani/mail noi; inchiderea este idempotenta prin Remove. |
| L05 | Timeout/exit nenul nu salveaza contextul; fara retry; test_partial_response_retires_context si test_close_gemini_error_and_timeout_not_success. |
| L06 | run_paw.ps1:568, comentariu ordine unica install barrier -> lock_gem -> state; fara lock nou imbricat invers. |
| L07 | n/a - fara acces/schema/RPC/ERP. |
| L08 | n/a - fara identitate BD/provenienta noua. |
| L09 | n/a - fara entitati ERP sau service_role. |
| L10 | Fara gestionare chei; Mcp.test_zero_mcp verifica env clean; Config.test_no_removed_integration_in_runtime_code. |
| L11 | n/a - fara extragere juridica determinista noua. |
| L12 | Raspuns incomplet nu salveaza contor/context; URL absent/invalid nu devine succes etichetat. |
| L13 | GemEticheta/GemUrl si re.fullmatch; Navigation.test_bad_urls_never_navigate, Registry.test_label_validation. |
| L14 | n/a - fara SQL/migrari. |
| L15 | n/a - fara porti de schema. |
| L16 | n/a - fara unicitate BD noua; registru indexat dupa eticheta canonica validata. |
| L17 | Contor integer 0..30, fara reparsare; Registry.test_rotation_at_30. Fara calcul temporal nou. |
| L18 | .env/I/O/config invalid/feature lipsa/JSON null = refuz; Mcp.test_env/test_unknown_feature/test_null/test_malformed. |
| L19 | Paritate PS/Python pe acelasi tabel independent: Registry.test_label_parity_python_powershell. |
| L20 | Caile legitime zero MCP/chat nou/reutilizare/inchidere; inchiderea nu consuma cota AI, test_close_gemini_fixed_args_no_paid_reservation. |
| L21 | Browserul cere raspuns stabil complet; lansatorul cere exit=0 si ultima linie URL valida inainte de scriere. |
| L22 | n/a pentru tarif/usage nou: niciun apel platit nou; rezervarea durabila paw-juridic existenta ramane neschimbata. |
| L23 | n/a - fara paginare BD. |
| L24 | n/a - fara React/load-uri UI. |
| L25 | Procese reale sintetice, PS 5.1, NTFS atomic, teste de concurenta mostenite; fara Codex/Edge/ACL real. Expected fixat independent. |

Istoricul r3 de mai jos nu este instructiune de operare si nu descrie r4.

---

# Paw v4.6 - runda 3 (27.10.2026)

Stare: reparatii locale; 125/125 teste verzi. Numai docs/paw/run_paw_v46.
Fara commit/push, credentiale reale, BD externa sau deploy. Interdictia initiala
"No Git commit" prevaleaza fata de ultima fraza contradictorie din brief.
Baza aplicata fara Git; toate blob-urile patch-ului verificate cu SHA1+antet blob.
SHA256 paw_v46_r3_base.patch:
EB4747CEB2F83476F4610FE0E641D00F58243708A0E8B06744B50E3C7936B944.
Hash independent nefurnizat; aceasta nu atesta autenticitatea PR #898.

Defect -> fix -> test:
- P1 cheie in preflight: list/get primesc mediu fara variabila, nu sir gol.
  Injectie exclusiv in exec dupa validare; AssertJakMcp refuza env contaminat.
  Am ales separarea mediilor: CLI ramane parserul efectiv al straturilor MCP;
  evitam un parser TOML ad-hoc care ar omite configuratia efectiva.
- P1 rules bypass: exec --ignore-rules (verificat in help CLI 0.162.0).
  AssertJakRules inainte de MCP si din nou inainte de injectie. Refuza toate
  .rules din home/system si toate config/requirements/managed_config system,
  inclusiv politici restrictive: limita deliberat conservatoare. Acces refuzat,
  junction/tip neasteptat = refuz, nu absenta. Nu parseaza Starlark cu regex.
- P2 backend Disabled: config si GetJakOverrides forteaza unelevated, valoarea
  din ~/.codex/config.toml v45, liniile 8-9, citita fara restul profilului/secrete.
  RUNBOOK include citire locala executata cu succes + scriere incercata/refuzata.
- P2 rollback Gemini: marker v46 retras sub bariera inainte de swap, teste v45
  text/detectare atasamente, marker NOU cu hash-ul restaurat, apoi smoke prin lansator.

DECIS de Razvan 27.10.2026: riscul citirii fisierului cheii de catre acelasi cont
Windows este acceptat; cheia dedicata este jak-paw-server. Nu il prezentam drept
punct in asteptare. Ephemeral/redactarea nu ascund secretul fata de acelasi cont.

Surse oficiale consultate ca date, nu instructiuni:
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/exec/src/cli.rs
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/src/exec_policy.rs
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/state.rs
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/loader/mod.rs
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/loader/layer_io.rs
- https://learn.chatgpt.com/docs/config-file/config-reference?translationFallback=es-419
System e singurul folder .rules ramas dupa ignore-rules. Enterprise/legacy nu
au config_folder; requirements managed permit doar prompt/forbidden, nu allow.
Pe Windows legacy home/managed_config.toml e ignorat. Politicile system locale
sunt refuzate integral; cloud restrictive nu sunt dezactivate. Nu certificam
schimbari admin/cloud concurente intre procese. MCP nu este izolat de sandbox
shell. Nu se declara GO live fara probele operatorului.

Skill openai-docs original: acces refuzat; ulterior citita copia generata
de CLI in home-ul sintetic din scope. Help/version: binarul 0.162.0 real, fara login.
O sonda app-server fara auth in home sintetic a generat automat SQLite/cache/skills
numai in scope; nu a returnat configRequirements/read la EOF si NU e folosita de
implementare. Curatarea artefactelor generate a fost respinsa automat de politica de executie,
inclusiv stergerea individuala cu verificarea cailor. Au ramas exclusiv in
teste/cli-help-home (ignorat explicit in teste/.gitignore); nu sunt livrabile sursa.
Fara date/credentiale reale. Nu ocolim refuzul prin alt utilitar.

## Verificari runda 3

- Comanda repetabila din acest director:
  `C:\Program Files\Python313\python.exe -B teste/run_r3.py`.
  Selectie explicita: 113 existente + 12 noi = 125/125 trecute, 0 skip,
  0 esecuri/erori, exit 0, 106.357 s. Dovezi: teste/RESULTATS_r3.json,
  teste/r3_execution.log. Fara discovery/Git/servicii reale.
- Cele 12 noi: header strain fara variabila, env preflight contaminat, rules
  allow in home/system, config system, requirements managed, legacy managed,
  rules tip invalid, eroare I/O, backend config/CLI, marker v45/v46/lipsa,
  contract runbook read/write + ordinea rollback/test/marker/smoke.
  Implementare teste/test_v46_r3.py; procesele false sunt in test_v46_r2.py.
- Fixture-urile existente au fost adaptate noului contract: enabled Firecrawl
  vine din override, nu din prezenta cheii in preflight. Timeout/exit negative
  nu mai incearca sa citeasca variabila care trebuie sa lipseasca. Toate
  cele 113 cazuri existente sunt pastrate, fara relaxarea asteptarilor de siguranta.
- Prima selectie completa: 113 teste trecute + 1 eroare de import, fiind pornita
  inainte ca test_v46_r3.py sa fie scris (cale relativa gresita la creare).
  Dovezi: RESULTATS_r3_initial.json/r3_initial_execution.log. Remediat harness-ul.
  Proba separata de 30 teste a inclus accidental 18 teste importate din r2;
  importul a fost corectat. Rezultatul FINAL 125 nu le dubleaza.
- Dupa clarificarea pasilor manuali pentru atasamente v45 si initializarea
  PAW_ROOT in consola A noua, cele 2 teste de runbook au fost rerulate: 2/2.
- SHA256.json actualizat: 11/11 intrari valide. SHA256 manifest:
  ED2AA0AD60BC4375D3DDA118337BD3E9865F243664DB8AA88F77D76985D0EC26.
  Verificare independenta in teste/VERIFICATION_r3.json. 41 fisiere in patch,
  35 pastrate octet-cu-octet; 6 schimbate: jak.ps1, RUNBOOK_RAZVAN.md,
  REVIEW_v46.md, SHA256.json, teste/test_v46.py, teste/test_v46_r2.py.
  Toate fisierele sursa/rapoartele livrate sunt ASCII; starea CLI generata si
  ignorata explicit este separata (67 fisiere, inclusiv SQLite binare).
- CLI 0.162.0 exec --help real confirma --ignore-rules/--ephemeral. Valoarea
  v45 windows.sandbox=unelevated a fost observata in configul normal. Nu s-au
  citit auth.json sau cheia reala. Nu s-au executat login, inferenta Codex,
  Firecrawl HTTP real, Gemini/CDP real, Install, WFP, Seal sau deploy.
- Testele dovedesc garzile wrapperului si contractele proceselor sintetice.
  Nu certifica izolarea OS, aplicarea ACL sau disponibilitatea serviciilor.
  Smoke-urile live read-success/write-denied si Gemini sunt documentate,
  NU declarate trecute. Nu se acorda GO de instalare din aceste fixture-uri.

## L01-L25 runda 3

| Regula | Aplicare / dovada |
| --- | --- |
| L01 | Bariera existenta neschimbata; mutarea markerului rollback ramane sub OpenCdxInstallBarrier, RUNBOOK sectiunea 8; teste concurente test_run_paw. |
| L02 | n/a |
| L03 | n/a |
| L04 | n/a |
| L05 | jak.ps1:162/195: erori/timeout refuzate fara retry/fallback; test_query_failed/test_query_timeout si RuleazaPipe. |
| L06 | n/a |
| L07 | n/a |
| L08 | n/a |
| L09 | n/a |
| L10 | jak.ps1:163/225/228: variabila ABSENTA in preflight si injectie numai dupa validare; test_foreign_env_http_headers_preflight_has_no_variable, test_contaminated_preflight_env_refused; scanari home/log/out/err cu cheie sintetica; risc acelasi cont DECIS. |
| L11 | n/a |
| L12 | Lista MCP exacta, fara disparitie tacita a serverelor necunoscute; Mcp.test_system_extra/test_system_extra_disabled/test_empty. |
| L13 | Nu parsare Starlark prin regex; refuz integral input system. Parser JSON real CLI; Mcp.test_query_malformed/test_query_null si pozitive test_clean. |
| L14 | n/a |
| L15 | n/a |
| L16 | SHA256.json pe continutul tuturor celor 11 runtime-uri; verificare independenta hashlib. GetJakRuntime neschimbat, test_tamper_refused/test_extra_file_refused. |
| L17 | Stopwatch si buget total in InvokeJak, timeout preflight comun list/get; test_query_timeout/RuleazaPipe. |
| L18 | jak.ps1:118/123: eroarea I/O nu devine absenta; test_rules_io_error_is_not_absence, test_rules_wrong_type_refused_before_mcp; reguli allow refuzate inainte de orice proces MCP. |
| L19 | GetJakOverrides:99 folosit in list/get/exec, backend acelasi in config si CLI; test_explicit_backend_config_and_cli_match_v45 + Mcp.test_clean compara override-uri. |
| L20 | Mcp.test_clean si cazul cheie absenta raman pozitive; negative home/system/managed, marker vechi/lipsa vs marker nou v45 in test_gemini_restored_hash_needs_new_marker. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | Procese PowerShell/Python reale cu cheia/headerul sintetice, argv/env/stdin capturate. Asteptari independente de cod (variabila absenta, unelte fixe, backend v45 observat). Poarta markerului executata pe hash-urile versiunilor reale v45/v46. ACL aplicat, OS sandbox si HTTP/CDP sunt explicit necertificate; fara inferenta live. |

---
## Istoric runda 2 (nu rezultate curente)

# Paw v4.6 - runda 2 (27.10.2026)

Stare: implementare locala, verificata pe fixture-uri. Nu este instalare sau
certificare OS/productie. Rezultatele rundei 2 si matricea curenta sunt mai jos;
sectiunea dupa separator este exclusiv istoricul rundei 1.

Baza extrasa fara Git: toate cele 35 intrari ale patch-ului sunt fisiere noi,
numai sub docs/paw/run_paw_v46. SHA256 paw_v46_base.patch:
99E4A4E1042F3D3E935717A748A4DB5ED886945650BCFD1C910E9FABE34DF129.
Nu a fost furnizat un hash independent; nu pretind verificarea autenticitatii PR.
Nu am executat Git (nici apply/commit), instalare, lansator real, Edge/CDP,
credentiale, BD sau deploy. Skill openai-docs indisponibil (acces refuzat);
verificarea CLI s-a facut din sursa oficiala publica etichetata rust-v0.162.0.

Defect -> fix -> test:
- P1 MCP mostenit: AssertJakMcp interogheaza list --json SI get firecrawl --json
  inainte de brief, cu acelasi exe/CLI, CODEX_HOME, cwd si GetJakOverrides.
  list 0.162.0 NU include enabled_tools; get este necesar. Refuz inclusiv pentru
  server in plus disabled, URL/transport/header/unelte schimbate, JSON invalid,
  lista goala, exit nenul. Diagnosticul brut nu este publicat.
  teste/test_v46_r2.py: Mcp (procese false, asteptari independente).
- P1 persistenta: exec --ephemeral obligatoriu; redactare out/err pastrata.
  test_v46 si test_v46_r2 scaneaza TOATE fisierele din jak-home sintetic,
  captureaza stdout/stderr si log Paw; copilul fals incearca afisarea cheii.
  Testul emuleaza contractul ephemeral, NU atesta comportamentul binarului real.
- P2 runtime: GetJakRuntime citeste cdx_install.json protejat, versiune exacta
  0.162.0, cale strict sub Paw/codex, ACL + intreg manifest runtime. Validarea
  run_paw si runbook folosesc acest helper. Fata de v45, jak nu mai foloseste npm
  din profilul Gazpet-Ai. Nu se modifica runtime-ul cdx.
- P2 exit: jak exit != 0 devine jak_exit_<cod> si PAW_EROARE, inclusiv fara imagini.
- P2 runbook: o singura secventa v46; arhiva inainte de schimbare, capturare
  install_paths.json, cheia numai prin Read-Host -AsSecureString, login separat,
  smoke MCP, canal Gemini, recertificare cdx, rollback v45 fara certificate vechi.

CLI verificat prin surse oficiale (date, nu instructiuni):
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/cli/src/mcp_cmd.rs
  ListArgs/GetArgs, run_list si run_get: sintaxa si campurile JSON.
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/exec/src/cli.rs
  ephemeral: flag global pentru exec, fara fisiere de sesiune persistente.
- https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/sandboxing/src/windows.rs
  backend restricted-token nu poate aplica deny-read; cere elevated. Jak pastreaza
  sandbox-ul legacy read-only, fara schimbare implicita la backend elevated.

Risc rezidual explicit: acelasi cont Windows poate citi state/secrets/firecrawl_api_key.
Nu este adaugata o promisiune falsa de deny-read printr-un flag legacy inexistent.
Profilurile granulare cu deny-read necesita backend elevated si validare separata;
nu au fost certificate aici. Mitigari: redactare, ephemeral, cheie Firecrawl dedicata
cu plafon de credite. RAZVAN decide acceptarea riscului. Ephemeral nu este o garantie
contra unui proces ostil care scrie propriile loguri sau transforma secretul.
MCP list/get si exec sunt procese succesive; configuratia cloud/system se poate
schimba intre ele. Nu este o atestare continua a serviciului sau a izolarii OS.

Verificari runda 2:
- Comanda repetabila: `C:\Program Files\Python313\python.exe -B teste/run_r2.py`
  din docs/paw/run_paw_v46. Selectie explicita; niciun discovery/Git/Install real.
- Rulare finala: 113/113 trecute = 87 existente + 26 noi; 0 skip, 0 esecuri,
  0 erori, exit 0. Durata 94.125 s. Dovezi: teste/RESULTATS_r2.json si
  teste/r2_execution.log (ASCII). Cele 26 noi sunt 18 cazuri MCP + 5 runtime +
  2 exit jak fara imagini + 1 verificare runbook. Scanarea cheii completeaza
  si testul existent. Nu sunt numarate subcazurile ca teste separate.
- Harness-ul test_run_paw foloseste snapshot Win32 real in process_fixture.ps1
  in locul CIM refuzat de container. TerminateProcess + WaitForSingleObject opresc
  exact fixture-ul propriu in locul taskkill refuzat. DriverOrfani, bariera,
  Job Object, lock-urile si pipe-urile din codul productiv nu sunt relaxate.
  Netstat/CDP este simulat; nu s-a contactat Edge. ACL privilegiat este simulat.
- Toate cele 35 blob-uri din patch au fost reverificate prin SHA1 cu antet blob,
  fara comanda Git. Cele 28 fisiere de baza nemodificate pastreaza octetii originali
  inclusiv CRLF; numai cele 7 fisiere de baza enumerate mai jos sunt schimbate.
- Baza schimbata: jak.ps1, run_paw.ps1, SHA256.json, RUNBOOK_RAZVAN.md,
  REVIEW_v46.md, teste/test_v46.py, teste/test_run_paw.py. Fisierele noi sunt doar
  teste/rapoarte sub acelasi director. Abatere de mediu: PowerShell a creat
  automat ModuleAnalysisCache sub Microsoft/Windows/PowerShell in radacina
  worktree-ului si in v46; am eliminat ambele fisiere generate. La verificarea
  finala nu raman fisiere schimbate in afara scope-ului. Niciun fisier sursa din
  afara scope-ului nu a fost editat.
- Timeout-ul preflight este comun list/get (maxim 60 s) si este scazut din bugetul
  total InvokeJak de 1200 s; nu extinde limita executiei. Fara retry/fallback.
- SHA256.json: 11/11 fisiere validate. SHA256 al manifestului final:
  874AFB6EE57AAAA4CD0CD02E75205C37CEE94076031686CE7BA92DFE7BB3470D.
  ASCII verificat pentru toate fisierele livrate; cache-ul binar PowerShell
  creat de harness in scope a fost eliminat dupa teste.
- Nu au rulat CLI-ul protejat real, login, API Firecrawl, ACL admin, WFP, instalare,
  recertificare cdx sau Gemini real. Acestea raman operatorului; nu declar GO live.

Matrice L01-L25 curenta, runda 2 (referinte relative la acest director):
| Regula | Aplicare / dovada |
| --- | --- |
| L01 | Bariera existenta tinuta inainte de validare si runtime (run_paw.ps1:568); lock-uri testate cu procese concurente reale in test_run_paw. Nicio mutatie BD. |
| L02 | n/a |
| L03 | n/a |
| L04 | n/a |
| L05 | jak.ps1:120/152: refuz fara retry/fallback la query/timeout; Mcp.test_query_failed/test_query_timeout, RuleazaPipe si cazurile parinte iesit. |
| L06 | n/a |
| L07 | n/a |
| L08 | n/a |
| L09 | n/a |
| L10 | jak.ps1:179/187: ephemeral + redactare exacta; test_v46 si Mcp scaneaza tot jak-home sintetic, stdout/stderr/log; test_name_secret, test_query_failed/test_query_timeout; risc acelasi cont declarat. |
| L11 | n/a |
| L12 | jak.ps1:120: lista goala/JSON invalid/server suplimentar nu dispar tacit; Mcp.test_empty/test_system_extra/test_query_malformed. |
| L13 | jak.ps1:107/134: parser JSON cu erori fatale, lista exacta si nume ancorat; test_name_injection/test_query_null/test_tools_duplicate + test_clean. |
| L14 | n/a |
| L15 | n/a |
| L16 | jak.ps1:78: manifest pe TOT runtime-ul; Runtime.test_tamper_refused/test_extra_file_refused, nu ultimul fisier sau nume/marime. |
| L17 | jak.ps1:124/153/182: Stopwatch si buget ramas, fara ora locala/offset; Mcp.test_query_timeout si testele RuleazaPipe. |
| L18 | jak.ps1:120: query esuat, null, JSON invalid, zero servere, set incomplet = refuz inainte de brief; Mcp teste negative. run_paw.ps1:686: jak exit nenul = PAW_EROARE fara imagini. |
| L19 | GetJakOverrides unic in list/get/exec (jak.ps1:96); Mcp.test_clean compara argv/cwd/home si override-uri. GetJakRuntime comun lansator/runbook. |
| L20 | Mcp.test_clean si vechiul test key prezent/absent, plus refuzuri system disabled, URL, header, unelte, versiune/cale/hash; test_jak_exit_zero_fara_imagini vs nenul. |
| L21 | n/a |
| L22 | n/a |
| L23 | n/a |
| L24 | n/a |
| L25 | Procese false reale + Win32/jobs/pipes/lock concurente; JSON fixture bazat pe sursa CLI 0.162.0 independenta. ACL privilegiat si servicii explicit simulate; limitele nu sunt declarate certificate. RESULTATS_r2.json contine rezultatul complet. |

---

## Istoric exclusiv runda 1 (nu rezultate curente)

# Paw v4.6 - review 27.10.2026

Stare: implementare locala verificata partial. Nu este instalat/certificat.
Testele noi trec; suita mostenita completa NU este verde in acest mediu.
Numai docs/paw/run_paw_v46 este modificat; v45 ramane baza nemodificata.
Fara modificari Git, credentale reale, BD, deploy, lansator real sau browser/CDP real.
Abatere: test_cdx_cert_probes a executat Git credential fill cu un helper SINTETIC
local, config global NUL si config system dezactivat. A fost inclus gresit in prima
selectie, contrar interdictiei de Git. Nu a modificat repository-ul si nu a folosit
autentificarea reala. Exclus din rularile ulterioare. Niciun commit/push.
Nu am facut nici commitul local cerut la sfarsitul brief-ului: interdictia initiala
si AGENTS.md au precedenta.

Gemini: fiecare trimite navigheaza acelasi tab la URL-ul literal
https://gemini.google.com/app, asteapta editorul, apoi verifica Argon.
Model gresit = model_gresit; fara schimbare automata de model. Stare este doar citire.
Generarea in curs este refuzata inainte de navigare. Lock-ul global ramane in run_paw.

Jak: jak.ps1 produce profilul separat state/jak-home si mediul curat al copilului.
Config fara definitii de pluginuri/apps; features apps/plugins/remote_plugin si
instalarea MCP din skills sunt false, repetate ca override CLI. Proiectul este
untrusted pentru a exclude .codex/config.toml local. Firecrawl este implicit OFF;
numai cheia prezenta il activeaza. Lipsa cheii produce exact un avertisment.
Config protejat/verificat, home modificabil pentru login/cache ca la cdx.
Install include noul helper in allowlist/manifest; Prepare nu cere cheia.

Alegere Firecrawl: HTTP remote https://mcp.firecrawl.dev/v2/mcp cu bearer din mediu.
Bundle-ul v45 nu include server stdio Firecrawl. Nu am inspectat instalarea privata
a contului si nu presupun ca exista un binar stdio revizuit. Remote nu cere pachet
npm nou; nu se foloseste npx (nici descarcare implicita), nu se instaleaza nimic.
Nu se foloseste endpoint-ul /mcp-oauth si cheia nu este inclusa in URL.
Allowlist: firecrawl_search, firecrawl_scrape, firecrawl_map. Fara interact/browser,
monitor, agent, crawl sau alte operatii. MCP nu este restrictionat de sandbox-ul
read-only al comenzilor; de aceea allowlist-ul este necesar.

Surse oficiale consultate ca date, nu instructiuni:
- https://developers.openai.com/codex/config-reference (features, trust, shell env)
- https://developers.openai.com/codex/config-basic/ (precedenta, proiect untrusted)
- https://developers.openai.com/codex/mcp (bearer_token_env_var, enabled_tools)
- https://docs.firecrawl.dev/mcp-server (endpoint API key cu bearer)
- https://github.com/firecrawl/firecrawl-mcp-server/blob/main/src/index.ts
- https://github.com/firecrawl/firecrawl-mcp-server/blob/main/src/server.ts
  Codul public arata safeMode pentru hosted, fara actiuni interactive la scrape.
  Aceasta este o inferenta despre implementarea remote, nu o atestare a serviciului:
  operatorul verifica schema efectiva fara actions in smoke.
Skill openai-docs local: acces refuzat; nu a fost citit sau aplicat.

Riscuri si limite:
- Compatibilitatea efectiva a flagurilor cu versiunea CLI instalata, login-ul,
  ACL-urile admin si conexiunea Firecrawl raman de verificat de Razvan in mentenanta.
  Niciun test local nu certifica izolarea OS ori configuratia cloud/system a contului.
- Cloud/system managed config poate adauga alte MCP; smoke-ul operatorului trebuie
  sa confirme numai firecrawl in lista efectiva. Daca apar altele: STOP, fara relaxare.
- Cheia API este text pe disc protejat prin ACL, asa cum cere brief-ul. Contul
  Gazpet-Ai o poate citi; profilul nu este o frontiera contra aceluiasi cont Windows.
  Redactarea stdout/stderr apara cheia exacta, nu poate certifica toate transformarile
  unui secret facute de un copil ostil. Memoria .NET nu ofera stergere garantata.
- Scrape/search consuma credite Firecrawl si trimit URL/interogare furnizorului.
  Citirea web nu inseamna fara cost sau fara efecte de acces pe site-ul extern.
- Hash-ul Gemini nou invalideaza markerul de canal vechi: retestare obligatorie.
- Modificarile bin invalideaza certificarea cdx existenta; urmati runbook-ul v45
  pentru recertificare, fara reutilizarea automata a markerelor.

Fisa Firecrawl a-e:
(a) Citeste pagini web externe prin search/scrape/map.
(b) Nu ofera unelte de scriere pe site-uri; nu modifica ERP/BD/mail/fisiere proiect.
    Serviciul poate tine evidenta cererilor si consuma credite.
(c) Proces Gazpet-Ai, cheie Firecrawl proprie, fara service_role.
(d) Configurat numai pentru jak pornit prin run_paw; contul Windows nu este izolat
    de propriile procese care pot citi aceeasi cheie.
(e) Nicio operatie ireversibila asupra datelor firmei; creditele consumate nu se restituie.

Verificari locale (Windows PowerShell 5.1, Python 3.13; temporare numai in v46):
- teste.test_v46 + teste.test_gemini_pw: 40 teste trecute (8 noi, 32 mostenite).
- Selectia finala repetabila este in teste/run_safe.py; rezultatul final este mai jos.
- Comanda finala: `python -B teste/run_safe.py`: 58 teste executate, 57 trecute,
  1 skip explicit (symlink fara privilegii), 0 esecuri/erori in aceasta SELECTIE.
  Rezultate: teste/RESULTATS_v46.json. Cazuri interne verificate: SECURITY 75,
  POLICY 10, R4 22, R5 41, R6 25. Nu sunt adunate artificial la numarul unittest.
  Selectia exclude explicit cazurile cu restrictii mentionate mai jos.
- Prima selectie larga: 18 teste, 1 esec HTTP loopback, 1 skip; restul trecute.
  test_cdx_patch_runtime importat NU executa teste (este doar opt-in standalone).
- HTTP loopback: acelasi esec native_same_binary_same_listener_exit_zero pe COPIA
  nemodificata a helperelor/testului v45 sub teste/baseline_v45. Nu se trage concluzie
  de regresie v46 sau de izolare OS din acest esec. Copia baseline este doar dovada.
- teste.test_run_paw.Lansator: 41 teste, 17 esecuri, 24 trecute. Toate esecurile
  arata acces CIM refuzat (Get-CimInstance Win32_Process), inainte de stub-urile
  gem/cop. Garda de productie nu a fost ocolita. Netstat este simulat numai in
  harness-ul v46: niciun Edge/CDP real nu a fost consultat. Testele pipe/stdin trec
  separat, cu procese false reale.
- Nu am rulat test_cdx (init/commit/push locale), test_instalare (Git show), nici
  opt-in standalone apply-patch cu CLI instalat.
- Nici Install admin, login, WFP real, API Firecrawl sau inferenta Codex nu au rulat.
  Planul ACL din InitializeJakProfile are Set-Acl simulat; descriptorul construit
  este real. Aplicarea ACL si compatibilitatea CLI raman operatorului.
- SHA256.json cuprinde cele 11 runtime-uri din allowlist, inclusiv jak.ps1;
  Prepare verifica octetii si refuza helperul jak modificat.
- Runtime-urile v45 sunt nemodificate; toate verificarile au folosit copii sub v46.
- Verificarea finala a confirmat SHA256 pentru 11 runtime-uri v46 si cele 10 v45
  nemodificate; toate fisierele din v46 sunt ASCII. RUNBOOK-ul copiat avea diacritice
  si a fost normalizat numai in copia v46, inclusiv in capitolele istorice.
- SHA256 al manifestului SHA256.json v46:
  C8C3CEE6274D94C3C067976DCB41EDDDD905373761D2C6799D46BD9399D33C67.

Repere implementare: gemini_pw.py:173 (trimite), :177 (unicul goto fix);
jak.ps1:2 (config comun), :33 (provisionare admin), :78 (proces jak);
run_paw.ps1:622 (apel InvokeJak); install.ps1:161 (provisionare profil).
RUNBOOK_RAZVAN.md incepe cu pasii v46 de Prepare/Install/login/smoke, iar procedura
v45 de baza este pastrata mai jos. Nu am aplicat niciunul dintre pasii operatorului.

Matrice reguli L01-L25:
| Regula | Aplicare / dovada |
| --- | --- |
| L01 | Lock gem existent in run_paw.ps1 inainte de Ruleaza/browser, nemodificat. Concurenta completa: limita CIM de mai sus; nu pretind test trecut. |
| L02 | n/a - fara tranzactii/date BD sau operatii business noi. |
| L03 | n/a - fara lease/CAS/cache nou. |
| L04 | n/a - fara cantitati/bani/mail sau retry nou. |
| L05 | Fara retry/fallback automat in InvokeJak; timeout/partial pastrate din Ruleaza; teste.test_run_paw.RuleazaPipe trece. |
| L06 | n/a - fara ordine noua de lock-uri multiple. |
| L07 | n/a - fara politici/acces BD. |
| L08 | n/a - fara auth.uid/identitate RPC. |
| L09 | n/a - fara service_role/proiecte BD. |
| L10 | jak.ps1: mediu copil curat, bearer numai din env, Read-Host SecureString, ACL prin SetCdxAdminAcl, redactare stdout/stderr; test proces fals si test profil optional. Nicio cheie reala citita. |
| L11 | n/a - fara extragere de dovezi/tabele. |
| L12 | n/a - fara extractor/paginare noua; partial Gemini existent ramane. |
| L13 | Validare cheie fc- pe lista inchisa in jak.ps1; test pozitiv sintetic si negativ invalid, fara eroare bruta cu secret. |
| L14 | n/a - fara migrari. |
| L15 | n/a - fara porti/amprente schema SQL. |
| L16 | SHA256 pe continut runtime, nu nume/marime; Prepare refuza jak.ps1 alterat (test_tampered_jak_refuses). |
| L17 | n/a - fara conversii numerice/date noi; timeout 1200 pastrat. |
| L18 | Lipsa cheii = avertisment unic + MCP OFF; invalid/necitibil/config schimbat = eroare, fara fallback implicit. Test proces: lipsa, invalid, config alterat. |
| L19 | GetJakConfig folosit de Install si validarea runtime; test TOML independent verifica politica; test argv verifica aceleasi 5 feature flags. |
| L20 | Succes Argon si refuz dupa model schimbat/editor absent/ocupat; jak cu/fara cheie, invalid, config alterat, Enter/DA si cheia existenta pastrata. |
| L21 | n/a - fara contract nou raspuns AI sau scrieri BD/cache. |
| L22 | n/a - fara contabilizare/apel AI automat nou; cost Firecrawl declarat, fara retry nou aici. |
| L23 | n/a - fara paginare UI/BD. |
| L24 | n/a - fara React/async UI. |
| L25 | Gemini fals executa trimite real; proces Python fals cu Ruleaza real, asteptari independente argv/env/stdin/log; ACL privilegiat explicit simulat. Esecurile/skip-urile nu sunt declarate trecute. |
