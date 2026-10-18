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
