# Review #032 — r6: risc parent apply_patch si WFP read-only

18.10.2026. Branch `claude/cdx-acl-trustedinstaller`, parinte
`20ef5ebebce35c36ef2234873a8832d9e675c850`. Commit local nou; fara rebase/push,
instalare, Run/Seal real, login, modele/API sau modificari WFP/ProgramData.

## 1. Decizia A — acceptata explicit, fara atestare OS falsa

Seal cere booleanul `parent_apply_patch_residual_accepted: true` si un motiv
string nevid. Template-ul porneste false/gol; nu convertim stringul "true".
Certificatul schema7/protocol cdx-probes-r6 retine acceptarea/motivul si campul
`parent_apply_patch: "policy-enforced, not OS-attested"`, cu aceeasi limita in scope.
Lansatorul verifica aceste campuri; schema6/r5 veche nu trece implicit. Binding-ul
ramane schema5 cu noile hash-uri. Native-patch, controalele pozitive si cele 20 de
probe shell raman neschimbate. Exceptia DNS #031 ramane separata si explicita.

Limita acceptata de Razvan: politica Codex writable_roots/sandbox policy pentru
unealta interna din parinte nu este bariera OS. Nici aceste teste, nici probele
native-patch pe copil nu certifica acea cale interna. Nu am incercat un apel real
al uneltei parinte si nu am validat impunerea politicii printr-un test nou.

## 2. Control post-run — implementat si verificat cu stuburi

Inaintea copilului si dupa fiecare rulare normala se compara 16 cai fixe:
10 runtime-uri bin, cdx_install.json, cdx_runtime_manifest.json,
cdx_sandbox_validat.json, CODEX_HOME/config.toml, repo operational/.git/config
si config.worktree. Absenta este o stare; crearea/stergerea se detecteaza.
Nu se citeste continutul auth.json si nu se adauga hash-ul sau continutul lui
in raport. Cai reparse/hardlink/director sau nerecitibile sunt refuzate.

Raport: before/after hash, changed_paths, status changed/unchanged/unreadable,
job_idle; schimbarea sau imposibilitatea verificarii produce PAW_EROARE si fara
commit. Verificarea preceda Git post-copil; se face si la exit nenul/timeout ori
exceptie dupa snapshot. Un job inca activ pastreaza tratamentul de eroare/lock.
Teste noi: creatie config.toml, editare .git/config cu exit7, stergere certificat;
toate detectate, fara commit. Calea nemodificata pastreaza 16 hash-uri egale.

NU este preventie sau audit al intregului disc: schimbari temporare restaurate,
alte cai, numai ACL-uri si modificari dupa verificare nu sunt acoperite de hash.
Nu se restaureaza automat un fisier si nu se numeste izolarea OS demonstrata.

## 3. WFP — drepturi corecte si pas separat, neexecutat live

Am verificat SDK-ul Microsoft: **FWPM_ACTRL_OPEN=0x40**, **FWPM_ACTRL_READ=0x80**,
masca folosita **0xC0 / 192**. Valorile 0x2/0x4 si 0x20006 din review-ul Gemini
sunt respinse ca identificare incorecta a acestor drepturi. Sursa:
[fwpmu.h Microsoft](https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/fwpmu.h).

[EngineOpen0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmengineopen0)
cere OPEN pe engine; [FilterGetByKey0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmfiltergetbykey0)
si [SubLayerGetByKey0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmsublayergetbykey0)
cer READ pe OBIECT. Grant-ul engine nu inlocuieste ACL-urile GR ale celor trei
obiecte Paw din r5. READ_CONTROL pentru citirea DACL si WRITE_DAC pentru scriere
apartin adminului care face mentenanta, nu sunt adaugate contului reader.
[GetSecurityInfo0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmenginegetsecurityinfo0),
[SetSecurityInfo0](https://learn.microsoft.com/en-us/windows/win32/api/fwpmu/nf-fwpmu-fwpmenginesetsecurityinfo0).

Noul cdx_wfp_engine.ps1 este in pachet/manifest/binding; se executa numai explicit
in A din bin-ul instalat. NU este chemat automat de Install ori binding. Verifica
hash/ACL, SID local Gazpet-Ai = reader_sid, lock exclusiv, marker si permit absente.
Receipt admin-owned outside bin este scris cu CreateNew/flush INAINTE de mutatie:
sid,mask,added,before,after,state. C# foloseste GetSecurityInfo0/SetSecurityInfo0
numai DACL; owner/group/SACL neschimbate, memoria SD eliberata cu FwpmFreeMemory0.
Nu foloseste tranzactie WFP, interzisa pentru SetSecurityInfo0.

Planul pur pastreaza ACE-urile existente octet cu octet si adauga un singur allow
explicit 0xC0. Aceeasi stare/receipt este idempotenta. Exactul ACE preexistent este
added=false si NU se scoate la rollback. Revoke elimina numai propria adaugare
cand DACL corespunde exact after; already-before este no-op; drift/duplicare/
provenienta falsa refuzate. Nu se restaureaza un snapshot peste alte schimbari.

Limite: WFP nu ofera aici compare-and-set atomic; lock-ul Paw nu exclude un alt
admin. Mentenanta fara alt writer este necesara; pre/post-check nu elimina cursa.
Canonizarea/merging de ACE, persistenta grant-ului engine, restart BFE/reboot,
fluxul real al receipt-ului si citirea Medium nu au fost testate. Daca BFE modifica
forma DACL, verificarea exacta refuza si pastreaza receipt-ul pentru investigatie.
Observatia read-only anterioara era GetByKey ACCESS_DENIED, nu dovada ca am masurat
si un esec EngineOpen separat. Testul obligatoriu N din runbook decide accesul real.
Binding-ul ramane fail-closed, fara fallback admin sau ignorare ACCESS_DENIED.

## 4. Teste rulate in aceasta runda

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

## 5. Livrare si pasi ramasi

SHA256.json (10 runtime-uri):
`D57CD86A163CEBC524FA6B981F31BB6DC4FDB044E11CA8EB7C3E37768DD62FA2`.
Acesta este hash de pachet, nu certificat OS. RUNBOOK_RAZVAN.md descrie exact:
mentenanta + marker retras -> Prepare/Install -> Grant engine read in A ->
GetCdxBinding in N -> Run nou r6 -> review DNS + parent residual -> Seal -> smoke.
Rollback-ul engine ruleaza cu receipt-ul inainte de swap, in afara altui lock.

NEEXECUTAT: instalare, Grant/Revoke/Inspect live nou, Run/Seal/smoke reale,
certificare OS a uneltei parinte, firewall/conturi/ACL de productie, reboot,
login/GCM/fetch privat. Nu exista in aceasta livrare o certificare activata.
Modificarile preexistente deno.lock si __pycache__ nu sunt incluse in commit.
