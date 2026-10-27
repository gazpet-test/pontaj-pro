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
