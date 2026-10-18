# Validare locala v4.4 r3 - 2026-10-18

Rezultate masurate in worktree, numai date sintetice si copii ale lansatorului.
Nicio rulare Codex reala, instalare, certificat, autentificare sau acces DB.

| Suita (python -I docs/paw/run_paw_v44/teste/...) | Rezultat | Ce acopera |
|---|---|---|
| test_cdx.py | 14 trecute, 1 SKIPPED; 37.165 s | worktree/base/commit/diff, certificat lipsa, slug/cale, timeout+copil, lock, tinta/fetch esuat, mediu, tmp, metadata/filter/nested Git/hardlink refuzate |
| test_cdx_security.py | 54 cazuri trecute in 1 test cu subteste; 0.913 s | PS syntax, NTFS/reparse/ACL, env/Git/hash/quoting, actiune vs stdout/proza, evenimente si item.id distincte, ID/path/comanda exacta, excerpt real, succes/unfinished/schema refuzate, native curl neexecutat/timeout/neconfirmat refuzate; taskuri/servicii/procese fixture; flag real al handle-ului install.lock comun/exclusiv nemostenibil |
| test_cdx_installer.py | 4 trecute; 1.491 s | Prepare pe copii, hash eronat/helper modificat/stage existent refuzate; octeti copiati identic |
| test_run_paw.py | 33 trecute; 56.672 s | regresii legacy, Job Object, lock mostenit de canal, moartea lansatorului/copilului, stuburi fara browser/model real |
| test_cdx_cert_probes.py | 1 trecut; 0.766 s | 20 definitii generate, ID/argumente/write initial fix, curl.exe copiat executat pentru read/write FILE pe canare temporare, argumente cu spatii; helper Git sintetic executat cu Git real fara retea/credentiale reale |

Total: **106 verificari/cazuri trecute, 1 test OS SKIPPED**. Acest total include
54 subteste in acelasi harness; nu sunt 106 teste de penetrare independente.

Probele native locale sunt CONTROALE NECONFINATE: executabilul a putut citi si
scrie canarul din fixture-ul temporar, inclusiv din afara subdirectorului simulat
worktree. Demonstreaza ca payload-ul/URI/comanda functioneaza, NU ca sandbox-ul
Codex il blocheaza. Toate fisierele fixture sunt sub worktree-ul autorizat.
Niciun listener LAN, TCP public sau DNS nu a fost pornit/cerut de aceste teste.

Testul helperului Git a picat initial cu forma quoted-absolute din r2: Git cauta
un subcommand credential-C:/... . Fixul !"cale absoluta" a trecut; cauza nu este
ArgCdx care ar transmite gresit ghilimelele. Helperul a returnat numai date fixe
sintetice; nu s-a rulat GCM real si nu s-au accesat servicii externe.

Testele cdx schimba ACL/binding/runtime/origin numai in COPII temporare. Produsul
nu are flag de bypass. Originul este un repo bare local; niciun push de retea.
Testele Job/process au rulat cu permisiune pentru interogarea/oprirea propriilor
procese sintetice. TEMP/TMP pentru Add-Type raman in fixture. Nicio configurare
globala ori memorie a agentului nu a fost modificata.

NETESTAT: Install pe ProgramData, inventar scheduler/CIM real pentru instalare,
swap/rollback, provisionare auth, copie runtime reala, Run/Seal cu modelul real,
refuzuri native/shell/tool ale sandbox-ului, citirea auth sub token sandbox,
link escape real, TCP LAN/public/DNS, firewall/WFP, repetabilitatea probelor,
GCM/fetch privat. Cerinta de activare ramane NO-GO pana la probele reale.
Unealta de citire separata de shell poate lipsi sau avea alta schema; atunci
certificarea ramane INCOMPLETE, nu acceptam proza modelului ca substitut.
PawCdx varianta 2 este doar pasul urmator propus daca varianta 1 nu trece.

Hash-uri runtime verificate pe octetii exacti ai celor sapte fisiere, cu .gitattributes
-text; si asupra bloburilor din commit la final. Git diff --check trecut.
SHA256.json: F8A7237631198DC371D1B6FB5193B831C37CB1FD7FE336F5BF8AA933E1916A63
Acesta este hash-ul manifestului de instalare, nu un certificat OS.
