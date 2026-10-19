# Validare locala v4.4 - #032 - 2026-10-18

Protocol r6, certificat schema7, binding schema5. Numai fixture-uri sintetice.
Fara instalare/Run/Seal real, modele/API, auth sau mutatii WFP/ProgramData.
REVIEW_032.md descrie acceptarea explicita parent apply_patch si grant-ul engine
read-only separat (masca SDK corecta 0xC0), nereexecutat live.

| Suita | Rezultat masurat | Domeniu |
|---|---|---|
| test_cdx.py | 22 PASS + 1 OS SKIP, 78.270 s | stub launcher/Git local, residual refuzat, 3 mutatii sensibile detectate, exit/timeout, commit pe succes |
| test_cdx_security.py | 75 subcazuri PASS, 1.030 s | helper-ele de securitate si evenimente, sintaxa |
| test_cdx_policy.py | 10 subcazuri PASS, 0.513 s | binding simulat, WFP schimbat refuzat |
| test_cdx_r5.py | 41 subcazuri PASS, 0.578 s | DNS, probe observabile, compilare/ABI C#, fara engine live |
| test_cdx_r6.py | 25 subcazuri PASS, 0.492 s | acceptare/scope, masca minima, ACE delta/ordine, idempotenta, rollback/drift/provenienta, sintaxa |
| test_cdx_installer.py | 5 PASS, 2.058 s | Prepare pe copii, 10 fisiere si manifest; fara Install |
| test_cdx_cert_probes.py | 1 PASS, 0.795 s | cele 20 definitii si controale native sintetice, fara model |

Dupa initializarea explicita sensitiveFailure am repetat numai succesul si
modificarea .git/config+exit7: 2 PASS, 4.375 s. Sunt reexecutari, nu teste noi.
15 blocuri PowerShell runbook + 7 fisiere PS1 parsate; 1 fragment JSON valid;
manifest 10/10 si regex/icacls verificate. Subcazurile comune nu sunt teste de
penetrare independente. OS SKIP ramane explicit: un stub sub acelasi utilizator
nu poate demonstra containment OS. Testele legacy/r4/dispatch patch din r5 NU au
fost reluate; sunt istorice in TEST_RESULTS.md, nu rezultate proaspete r6.

Manifest SHA256.json: D57CD86A163CEBC524FA6B981F31BB6DC4FDB044E11CA8EB7C3E37768DD62FA2.

---

## Arhiva: toate sectiunile de mai jos sunt istorice, anterioare #032

# Validare locala v4.4 - #030/#031 - 2026-10-18

Protocol r5, certificat schema6, binding schema5. Copii/fixture-uri sintetice,
fara Install/Run/Seal real, model/API, auth sau modificari ProgramData/WFP.

| Suita | Rezultat masurat | Ce acopera |
|---|---|---|
| test_cdx.py | 18 PASS, 1 OS SKIP; 70.755 s | launcher cu stub, schema6/r5, exceptie DNS valida/refuz fara motiv; Git local, mediu, arbore, timeout, lock |
| test_cdx_security.py | 75 subcazuri PASS; 1.111 s | sintaxa PS, ACL/TrustedInstaller/InheritOnly, hash/env/quoting, evenimente de comanda distincte; forme patch/read fictive refuzate |
| test_cdx_policy.py | 10 subcazuri PASS; 0.530 s | binding schema5; WFP schimbat refuzat (wrapper WFP simulat), Windows informational |
| test_cdx_installer.py | 5 PASS; 1.933 s | Prepare pe copii, 9 fisiere, WFP/helper/manifest alterate si stage existent refuzate; fara Install |
| test_cdx_cert_probes.py | 1 PASS; 0.872 s | 20 comenzi generate parsate, probe curl FILE si Git sintetic |
| test_cdx_r4.py | 26 subcazuri PASS, 1 symlink SKIP; 2.495 s | ACL helper protejat inaintea parintelui, schimbare reala refuzata; linkuri si HTTP loopback sintetic |
| test_cdx_r5.py | 41 subcazuri PASS; 0.563 s | exceptie DNS si certificat, patch observabil, compilare C#, ABI x64, SID/forma WFP pure; fara engine WFP |
| test_cdx_patch_runtime.py | 3 patch-uri + 2 cmd type PASS | comenzile exacte generate, copia binarului instalat 0.162.0, canare sintetice neconfinate; fara exec/model |
| test_run_paw.py | 33 PASS; 56.338 s | regresii legacy gem/cop cu stuburi, Job Object/lock/driver, fara browser/model real |

13 blocuri PS din runbook + 6 fisiere PS1 parsate, 1 fragment JSON valid, manifest
9/9 verificat. Regex Windows/slash si separarea icacls grant/setowner verificate.
Controalele patch folosesc binarul instalat doar in dispatch local pe canare; nu
testeaza unealta parent apply_patch sau sandbox-ul. WFP testat prin compilare/ABI
si validatori puri; Inspect real pe filtrul VECHI a dat ACCESS_DENIED, fara mutatii.
Noul drept de read pentru operator ramane de validat dupa instalare.

Suita legacy initial in sandbox: 17 esecuri Access denied din 33; aceleasi stuburi
neconfinate: 33 PASS. HTTP loopback r4 rulat neconfinat. Doua SKIP: OS containment
cu stub si symlink neprivilegiat. Nicio modificare de privilegii/politici.

Manifest SHA256.json: 47D62085839B691833F892178441ADAC62CDE9B0EFB5E8EBBDA076A0FB1DA386.
REVIEW_030.md descrie dovezile, exceptia DNS, limitele si pasii operatorului.
Nu exista certificare reala rezultata din aceste teste.

---

## Arhiva: rezultatele #028 si mai vechi, NU starea pachetului #030

Hash-urile, schemele, numarul de runtime-uri si afirmatiile despre binding din
sectiunile urmatoare sunt istorice. Rezultatele curente sunt numai cele de mai sus.

# Validare locala v4.4 - politica #028 - 2026-10-18

Numai fixture-uri sintetice si copii ale lansatorului. Nicio instalare ProgramData,
Run/Seal real, autentificare, apel de model/API sau acces DB. Markerii din teste
sunt sintetici; nu activeaza lansatorul de pe server.

| Suita (python -I docs/paw/run_paw_v44/teste/...) | Rezultat masurat acum | Ce acopera |
|---|---|---|
| test_cdx.py | 16 PASS, 1 OS SKIP; 41.096 s | lansator cu certificat din 2010, raport Windows curent, schema veche refuzata; Git/process/timeout/mediu si refuzurile existente |
| test_cdx_security.py | 71 subcazuri PASS in 1 test; 1.045 s | sintaxa PS si helper-ele existente; certificat >10 ani valid, politica/datestamp invalide refuzate; dovezi Run-Seal max 24h pastrate |
| test_cdx_policy.py | 9 subcazuri PASS in 1 test; 0.493 s | Windows build/UBR sau indisponibilitatea metadatelor nu schimba binding-ul; modificari auth ACL, CODEX_HOME ACL, versiune Codex, runtime, bin, node sunt refuzate |
| test_cdx_installer.py | 4 PASS; 1.482 s | Phase Prepare pe copii: octeti/manifest si refuzuri existente, fara Phase Install |

Total curent: **100 verificari/subcazuri PASS, 1 OS SKIP**. Subcazurile helperelor
nu sunt teste de penetrare independente. SKIP: containment OS nu se demonstreaza
cu un stub care ruleaza sub aceeasi identitate.

Testul de binding foloseste configuratie, hash-uri si descriptori ACL sintetici
pentru izolarea logicii reale GetCdxBinding. Valorile registry sunt simulate;
nu am facut update Windows, schimbare ACL de productie sau upgrade Codex.
Testul de lansator emite efectiv raportul pe fixture si citeste metadatele Windows
actuale local. Lipsa metadatelor este semnalata, fara invalidarea certificatului.
Nu am reexecutat in #028 suitele legacy/probe native/r4 nemodificate de mai jos.

Certificat schema 5: fara expirare calendaristica, politica explicita, expires_utc
null; Run-Seal ramane max 24h. Vechile certificate nu sunt migrate automat.
Pragurile probelor si protocolul cdx-probes-r4 raman neschimbate. Regula manuala:
retragerea markerului INAINTE de schimbari deliberate firewall/CodexSandbox*/Codex,
apoi Run + review + Seal. Nu exista detectie automata a schimbarilor firewall
sau a efectului update-urilor Windows asupra izolarii.

NETESTAT acum: Install/rollback/scheduler real, Run/Seal cu Codex, sandbox OS,
credentiale reale/GCM, firewall/LAN/public/DNS si upgrade efectiv. Activarea ramane
conditionata de certificarea initiala pe server. REVIEW_028.md explica alegerea.

Manifest actual SHA256.json (7 runtime-uri):
C6FB35B88CE1E87C3ABCEFFA1273C16392E5B2AD711B83394E764E06E1042782.
Verificarea octetilor si git diff --check sunt facute la predare; bloburile
commit-ului sunt verificate separat. Acesta este hash de pachet, nu certificat OS.

---

# Rezultate ISTORICE r4 (#027), inainte de politica #028

Sectiunea de mai jos pastreaza masuratorile de la commit 24d231f. NU sunt o noua
rulare in #028. Mentiunile TTL 24h si binding Windows de aici sunt istorice si au
fost inlocuite de politica documentata mai sus; hash-ul de la final este cel vechi.

# Validare locala v4.4 r4 - 2026-10-18

Date masurate in worktree, numai fixture-uri sintetice si copii ale lansatorului.
Nicio rulare Codex reala, instalare, certificat, autentificare, API sau acces DB.

| Suita (python -I docs/paw/run_paw_v44/teste/...) | Rezultat | Ce acopera |
|---|---|---|
| test_cdx.py | 15 trecute, 1 SKIPPED; 40.033 s | orchestrare, Git local, timeout/copil/lock, refuz metadate/filtre/linkuri, mediu; certificat expirat refuzat inainte de crearea worktree-ului |
| test_cdx_security.py | 69 cazuri trecute in 1 test; 0.934 s | sintaxa PS, NTFS/ACL/hash/env/Git/quoting, tokenuri de actiune vs stdout/proza, wrappers PS/cmd, GUID/verb/argument lipsa, sibling path, evenimente distincte, expirare certificat si dovezi, inventar fixture, handle install.lock nemostenibil |
| test_cdx_installer.py | 4 trecute; 1.464 s | Prepare pe copii, octeti identici; manifest/helper modificat/stage existent refuzate |
| test_run_paw.py | 33 trecute; 57.509 s | regresii legacy Job Object/lock/driver/timeout, fara browser/model real |
| test_cdx_cert_probes.py | 1 trecut; 0.769 s | 20 definitii, curl nativ FILE read/write pe canare, URI/argumente cu spatii, helper Git sintetic cu Git real fara retea |
| test_cdx_r4.py | 23 subcazuri trecute in 2 teste, 1 SKIPPED; 2.128 s | junction/hardlink unlink cu tinta intacta, link necunoscut/tinta/tip/nume incorect refuzate, ACL/hash/allowlist helper legacy cu descriptori sintetici, control HTTP loopback curl real, exit 7 si exit 0 fara conexiune refuzate, file:/// cu spatii |

Total **145 verificari/cazuri trecute, 2 teste SKIPPED**. Include subcazuri in
harness-uri comune; nu sunt 145 teste de penetrare independente.

## Dovezi si limite ale masurarii

- Controalele native sunt NECONFINATE. System32/curl.exe copiat in fixture a citit
  si scris numai canare sintetice locale, inclusiv URI file:/// cu %20. Copia a
  efectuat si un HTTP reusit, raspuns gol, catre listener LOOPBACK al fixture-ului.
  Niciun listener LAN, TCP public sau DNS nu a fost folosit. Acesta testeaza
  helperul/URI, NU izolarea sandbox-ului Codex ori controlul LAN de productie.
- System32/curl.exe: FileVersion si ProductVersion 8.21.0. Registry citit local:
  CurrentBuildNumber 26200, UBR 9711, DisplayVersion 25H2, EditionID Professional;
  ProductName legacy Windows 10 Pro. Nu am testat Windows Server 2019/2022.
- Fixture-urile native negative sunt executabile locale sintetice: unul iese cu 7,
  altul cu 0, fara conexiune. Ambele sunt refuzate de controlul pozitiv.
- Junction si hardlink sunt obiecte NTFS reale in fixture: detectie, tip/tinta,
  unlink nonrecursiv, canar exterior subdirectorului work ramas intact. Refuzul
  scrierii prin ele de catre sandbox-ul real NU a fost testat.
- SKIP 1: testul de containment OS nu poate fi demonstrat cu un stub de aceeasi
  identitate. SKIP 2: crearea symlink-ului de fisier a primit WinError 1314;
  nu am acordat privilegii/activat Developer Mode. Calea symlink de succes ramane
  de verificat de operator, separat de testele negative de tip/tinta.
- ACL pentru helperul legacy: validatorul real a primit descriptori in memorie;
  nu s-au schimbat ACL-uri reale de instalare. Copy/hash/allowlist/race de hash
  si schimbare SDDL sunt verificate in fixture. Install/rollback reale netestate.
- Evenimentele PS/cmd sunt sintetice ca date, cu forma wrapperelor reale; nu sunt
  capturi ale unei certificari reale. Tokenuri prezente != semantica certificata;
  review-ul uman al comenzii efective/refuzului ramane obligatoriu.
- Expirarea este verificata atat ca helper, cat si la intrarea lansatorului.
  Dovezile vechi nu pot primi o valabilitate noua prin repetarea Seal. Binding-ul
  build/UBR/Codex este implementat; nu am provocat un update de OS/Codex ca test.
- Testele Job/process au permisiune sa interogheze/opreasca numai propriii copii
  sintetici. TEMP/TMP Add-Type sunt in fixture. Nicio setare globala modificata.

## Ce NU s-a verificat

Install ProgramData, scheduler/CIM de instalare real, swap/rollback/provisionare
auth, Run/Seal cu Codex, probe shell/tool/native sub token sandbox, acces auth,
link escape real, LAN/public/DNS/firewall/WFP, repetabilitate si GCM/fetch privat.
Nu exista fingerprint automat pentru firewall/conturi sandbox; retragerea
certificatului INAINTE de schimbare si recertificarea dupa sunt obligatii ale
operatorului, peste TTL de 24h. Nu afirmam protectie universala.

Varianta 1 ramane CANDIDAT, NO-GO pentru activare pana la probele reale repetate.
PawCdx varianta 2 nu este implementata/atestata aici. Diferentele de review si
motivele acceptat/respins sunt in REVIEW_027.md; pasii in LANSATOR_UNIC_PAW.md.

Manifestul SHA256.json acopera exact cele 7 runtime-uri cu .gitattributes -text;
hash-ul este 1031603742538600A75E586D2E4117E25B0BE48393D38BFA4D931C86DFB1FBD9.
Hash de instalare, NU certificat OS. Verificare octeti si git diff --check trecute;
bloburile commit-ului sunt reverificate la predare. Rezultatele r3 raman in istoric.
