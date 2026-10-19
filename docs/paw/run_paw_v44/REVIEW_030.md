# Review #030/#031 - cdx dupa Run#1b

18.10.2026. Cod, teste si documentatie pe `claude/cdx-acl-trustedinstaller`,
peste `2a930bbdd1370b27ab2b923325cd0f626f55d13c`; fara rebase/push. Corecturile
Claude pentru TrustedInstaller/InheritOnly si `Git\bin\git.exe` raman intacte.
Nu s-a executat instalare, Run/Seal real, login, setup, modificare WFP/ACL/cont
sau scriere in ProgramData. Nu exista certificat OS nou produs de aceasta lucrare.

## 1. Ce s-a observat efectiv in Codex 0.162.0

Runtime citit: `C:\ProgramData\Gazpet\Paw\codex\0.162.0-20261018-201308-6804`.
`package.json` indica 0.162.0. SHA-256 binar nativ:
`DCE685D569526EF4712FA82D20FF20E1309BAAD5FCD34215E1126698F611242F`.

Run#1b, directorul `C:\ProgramData\Gazpet\Paw\certification\fcde595949d44e53ae2766d09d83d4f2`,
a fost inspectat doar pentru metadatele/evenimentele relevante: 18 item.completed,
din care **16 command_execution si 2 agent_message**, plus 16 item.started.
Chei observate pe comenzi: id, type, command, aggregated_output, exit_code, status.
Nu exista file_change/patch_apply/tool_call in aceasta rulare. Asta NU demonstreaza
ca motorul nu emite niciodata acele evenimente sau ca unealta a fost efectiv apelata.
Binarul contine stringuri file_change/patch_apply_begin/patch_apply_end, insuficiente
pentru stabilirea unei scheme `exec --json`. Nu am rulat o noua cerere de model
pentru a forta tool-ul. Un prompt nu garanteaza apelarea lui.

In schimb, dispatch-ul local `codex.exe --codex-run-as-apply-patch <patch>` a
modificat corect un fisier sintetic, exit0, fara autentificare/model/retea. Au fost
verificate separat **toate cele 3 comenzi patch generate**, cu cai cu spatii, copia
binarului in `.paw-cert/native-patch.exe`, plus ambele comenzi `cmd type`.
Acestea sunt controale pozitive NEconfinate, nu proba refuzului sandbox-ului.
Observatia initiala e in workspace Codex `outputs/cdx030_runtime/runtime_probe.json`.
Testul opt-in reproductibil este livrat in `teste/test_cdx_patch_runtime.py`.

## 2. Protocolul observabil r5

- Se pastreaza 20 de ID-uri de probe. Cele 3 `*-patch` ruleaza motorul patch
  nativ fixat prin hash, ca proces copil al shell-ului, cu comanda exacta.
  `Run` verifica separat un control patch pozitiv si fixeaza binarul in permit;
  launcherul valideaza hash-ul copiei, iar Seal verifica controlul/fixture-ul.
- `profile-read-tool` / `auth-read-tool` devin `*-read-cmd`: interpreter distinct
  `cmd.exe /d /c type`, comparat cu citirea .NET din PowerShell. Nu se inventeaza
  o unealta non-shell. Sunt canare sintetice cu ACL-ul auth, nu auth.json real.
- AssertEventReview accepta numai `item.completed` / `command_execution`,
  fiecare cu ID/linie distincte, exit integer, ID/cale/verb/argument in ACTIUNE,
  excerpt real in output si declaratii booleene explicite ale reviewerului.
  Vechile forme fabricate `file_change.error/diff` si `tool_call` nu sunt acceptate.
- Pentru patch, reviewerul confirma executia nativa si refuzul operatiei.
  Eroarea de sintaxa, context absent, program absent, tinta inexistenta sau timeout
  NU dovedesc blocarea. Controlul automat nu inlocuieste judecata administratorului.
- Mediu minim: PATHEXT fix `.COM;.EXE;.BAT;.CMD`, nu mostenit. Fara el, controlul
  PowerShell al executabilului copiat esua cu "Cannot run a document in the middle
  of a pipeline"; dupa corectie comenzile generate au trecut.

**Limita explicita:** motorul patch rulat ca fiu al shell-ului nu certifica tokenul
sau calea uneltei apply_patch interne a parintelui Codex. Scope-ul certificatului
spune `internal parent patch tool NOT attested`. Nu pretindem acoperire echivalenta
pentru acea cale neobservata. Orice proba sarita face Run#2/Seal incomplet.

## 3. DNS - decizia #031 ramane explicita

Nu se activeaza automat din decizia de pe canal. Admin review trebuie sa contina
`dns_exception_accepted: true`, `dns_exception_reason` nevid si verdict
`ALL_DENIED_EXCEPT_DNS`. Intrarea network-dns trebuie sa arate o tentativa reala
reusita (exit0, success=true, denial=false, excerpt exact). Celelalte 19 probe
trebuie refuzate. Lipsa flagului/motivului/dovezii refuza Seal.

Certificat **schema6**, protocol **cdx-probes-r5**: `network_denied_except_dns:true`,
motiv si scope DNS, **fara campul network_denied**. Launcherul verifica din nou
consistenta acestor campuri. Daca DNS este efectiv refuzat fara exceptie, se poate
certifica varianta ALL_DENIED; nu se falsifica un succes DNS.

DNS si exfiltrarea prin DNS NU sunt blocate de aceasta atestare. Nu este o
certificare a izolarii universale de retea. Politica fara expirare calendaristica
din #028 ramane; dovezile Run-Seal trebuie sa fie proaspete, maximum 24h.

## 4. WFP persistent si verificare read-only

`cdx_wfp.cs` porneste din sursa Claude `C:\Users\Public\claude-server\wfp_cdx.cs`.
Clasa noua PawCdxWfp evita confundarea cu helperul temporar. `cdx_wfp.ps1` nu
modifica WFP la import. Install rezolva SID-ul contului LOCAL CodexSandboxOffline;
nu creeaza conturi si nu executa setup.

GUID-uri fixe:
- sublayer `5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e51`;
- v4 `5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e52`;
- v6 `5f1d7c2e-6a3b-4c1d-9e2f-0a1b2c3d4e53`.

Installerul copiaza/hash-verifica/protejeaza toate fisierele in incoming, apoi
incarca helperul PROTEJAT. Instaleaza persistent sublayer+ambele filtre, BLOCK
ALE_AUTH_CONNECT v4/v6, o conditie ALE_USER_ID exacta si CLEAR_ACTION_RIGHT,
tranzactional. GUID deja existent = eroare, fara ALREADY_EXISTS ignorat si fara
stergere automata a unui filtru preexistent. Rollback-ul unui swap esuat retrage
numai filtrul tocmai instalat. Remove explicit retrage tranzactional cele 3 chei.

Binding schema5 verifica la inceputul/finalul fiecarei rulări SID-ul actual si,
prin GetByKey read-only, existenta+persistenta+forma+conditia SID ale celor doua
filtre si sublayer-ului. Erori de citire/lipsa/schimbari refuza rularea. Acesta nu
este un monitor continuu si nu exclude schimbari efectuate de administrator intre
cele doua verificari. Hash-urile ambelor fisiere WFP fac parte din binding.

ACL-ul noilor obiecte este explicit: SYSTEM/Admin administrare, reader local GR
(read). Engine ACL global nu este schimbat. **Observatie reala:** inspectia
read-only a obiectului VECHI a intors `FwpmSubLayerGetByKey0 0x00000005`.
Prin urmare accesul normal N la noul ACL este un control obligatoriu dupa Install,
INAINTE de Run#2. Nu am testat Install/Remove persistent, rezistenta la reboot sau
efectul real al noilor ACL-uri. Nu relaxam verificarea daca acel control esueaza.

## 5. Instalare legacy si runbook

GetLegacyHelperPlan continua sa verifice hash/ACL inainte de schimbari. Noul
ProtectLegacyHelperPlan revalideaza, protejeaza ACL-ul helperului insusi si retine
noua stare INAINTE de ACL-urile parintilor; evita falsa neconcordanta mostenita,
dar o schimbare reala a helperului ramane refuzata. Teste cu descriptori sintetici,
nu o prima instalare reala.

RUNBOOK_RAZVAN.md include regexul Windows/slash verificat, comenzi icacls separate
pentru /grant si /setowner, Paw\tools ca loc oficial pentru helperii auxiliari,
mentenanta, arhiva marker/dovezi, Prepare, retragerea explicita a filtrului temporar,
Install nou, binding in fereastra N, Run#2, review DNS, Seal, smoke si rollback.
Numai cgpt_pw.py este preluat cu hash aprobat; installerul nu muta arbitrar tools.
Nu cere repetarea login/setup pentru home-ul existent.

Limita preexistenta pastrata: switch-ul optional GCM indica mingw64, iar instalarea
serverului are ucrt64. Runbook-ul NU activeaza switch-ul; daca fluxul anonim nu
functioneaza, este necesar patch separat, nu copiere de credentiale/helperi.

## 6. Verificari efectuate

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

Mai mult: 13 blocuri PowerShell din runbook, 1 fragment JSON si toate cele 6 PS1
ale pachetului parsate fara eroare; manifest 9/9 si regex/icacls verificate.
Subcazurile impart acelasi harness; nu sunt teste de penetrare independente.
Nu agregam controalele pozitive neconfinate cu certificarea OS.

Context de executie: test_run_paw initial in sandbox-ul agentului a avut 17/33
esecuri Access denied (68.714 s); aceeasi suita cu stuburi in afara acelui sandbox
a trecut 33/33 (56.338 s). Testul r4 HTTP loopback a avut de asemenea nevoie de
rularea locala neconfinata. Nicio schimbare de cod pentru mascarea acelor erori.
Doua SKIP intentionate: containment OS nu se poate demonstra cu stub sub acelasi
utilizator; crearea symlink fisier fara privilegiu nu e disponibila. Nu am activat
privilegii/politici ca sa treaca testul.

## 7. Livrare si ce NU este verificat

Manifest SHA256.json (9 runtime-uri):
`47D62085839B691833F892178441ADAC62CDE9B0EFB5E8EBBDA076A0FB1DA386`.
Manifestul este hash de pachet, NU certificat de securitate. Octetii sunt verificati
si dupa commit; TEST_RESULTS.md pastreaza separat rezultatele istorice.

De executat de operator, dupa review extern: mentenanta -> Install nou -> acces
WFP read-only in N -> Run#2 r5 -> review explicit DNS -> Seal -> smoke.
Nu re-sigila Run#1b cu r5. Nu restaura markerul schema5/r4 peste noul binding.

NEVERIFICAT: schema evenimentului intern apply_patch printr-o noua cerere reala;
comportamentul sandbox al copiilor patch/cmd; instalarea/rollback-ul WFP persistent
si reboot; citirea noului filtru din token Medium; scheduling/Run#2/Seal/smoke reale;
izolarea OS/retea curenta; login/tokenuri/GCM/fetch privat. Nu s-au schimbat ERP,
modele, Ollama, firewall, conturi, ACL-uri de productie, auth sau ProgramData.
