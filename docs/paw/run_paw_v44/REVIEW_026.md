# Runda 3 / claude#026 - 2026-10-18

Verdict: livrabil pentru review; varianta nativa NU este certificata/activata.
Intrari citite integral: pr759_cdx_r2_cop.log si pr759_cdx_r2_gem.log, paw-data/out.
Niciun Run/Seal/Install real, cont, secret, firewall sau ProgramData modificat.

| Punct | Decizie si dovada in cod |
|---|---|
| Copilot: binar nativ lipsa | Acceptat. Windows curl.exe semnat, snapshot admin + copie in worktree, hash in permis/raport; trei apeluri shell exacte pentru file-write/file-read/LAN. Nu este un stub Python sau PE managed. Controale pozitive sintetice inaintea testului real. Seal cere dovada executiei si eroare de operatie, nu simpla interdictie de lansare. |
| Copilot/Gemini: CODEX_HOME | Acceptat. Doua canare de citire cu ACL SDDL identic auth.json, shell + tool. Fara continut auth real. ACL intra in binding si se reverifica. Reguli speciale pentru numele auth.json nu sunt generalizate din canar. |
| Ambii: doar loopback insuficient | Acceptat. Listener LAN pe interfata verificata, TCP public, DNS; controale pozitive externe. Rezultat lipsa/timeout nu dovedeste refuz. network_denied are domeniul limitat explicit. |
| Copilot: link escape | Acceptat. HardLink/Junction/SymbolicLink create din worktree spre canare externe distincte, apoi write. Crearea permisa si link ramas inseamna NO-GO conservator prin post-validare. |
| Copilot: un eveniment putea valida toate probele | Acceptat. ID-uri probe, event_line si item.id distincte; item.completed; action fields cu ID/path/argumente, comanda shell exacta, rezultat esuat si citat din eroare. Schema necunoscuta se refuza. Review ADMIN ramane necesar pentru semnificatia erorii. |
| Gemini: canar write necunoscut | Acceptat. CANARY_WRITE_INITIAL fix in brief, hash extern. Secret sintetic numai pentru READ. Patch nu necesita citirea canarului. |
| Gemini: install.lock mostenibil | Acceptat. FileShare.Read fara Inheritable in ambele locuri. Test GetHandleInformation verifica flag-ul real pe handle comun/exclusiv. |
| Copilot: switch de mentenanta declarativ | Acceptat. Get-CimInstance + Get-ScheduledTask, erori fail-closed, verificari inainte/dupa lock si inainte swap. Procese absente, taskuri Disabled + !Enabled, servicii Stopped + Disabled. Nicio oprire automata a unui proces/task al altcuiva. |
| Gemini: quoting GCM | Problema confirmata prin Git real, cauza precizata: helper-ul care incepe cu ghilimea nu este recunoscut drept cale absoluta de Git si devine git credential-C:/... . ArgCdx transmite corect ghilimelele. Fix: helper shell explicit !"cale-pinned", doar parinte/fetch, fara configurari globale. Test cu helper sintetic, cale cu spatii, fara credentiale/retea. GCM real ramane netestat. |
| Gemini: config Git prea strict | Limitare acceptata/documentata; nu largim allowlist pentru cai/include/comenzi. Repo incompatibil se opreste inainte de Git. |
| Gemini: varianta 1 probabil pica read | Nu transformam predictia in rezultat masurat. Doar certificarea reala poate stabili. Daca esueaza/incomplet/nerepetabil, propunem PawCdx ca pas urmator, fara activare artificiala. |

## Audit handle-uri

- install.lock comun/exclusiv: nemostenibil; launcher/certifier il tin pe durata lor.
- lock_<canal>: MOSTENIBIL intentionat, contract legacy existent pentru eliberare
  numai dupa moartea ultimului copil. Job Object opreste arborele la moartea parintelui.
  Nu extindem aceasta exceptie la lock-ul global de instalare. Testele de kill/lock
  legacy raman obligatorii; un proces scapat din Job nu este declarat imposibil de stuburi.
- Handle Job: nemostenibil. Pipe-urile stdin/out/err sunt mostenite intentionat numai
  pentru comunicarea procesului; nu sunt handle-uri de instalare.
- Imagini/lista/read/hash/copie: FileShare.Read/None/ReadWrite fara Inheritable;
  stream-urile temporare se inchid in finally, ImgHandles raman ale parintelui.
- Installerul tine lock-urile publice doar READ + None, fara Inheritable/trunchiere.

## Limite care raman

Inventarul de mentenanta identifica lansatoare/actiuni/nume/cai Paw cunoscute, nu
poate descoperi orice wrapper opac sau bloca o lansare manuala legacy dupa inventar.
Fereastra de mentenanta ramane obligatorie. Nu s-au oprit taskuri sau servicii reale.

20 probe finite nu dovedesc rezistenta la orice program ostil. Copia curl citeste/scrie
fisiere si conecteaza socketuri nativ, dar nu testeaza toate syscalls/metodele de atac.
Tool events diferite de schema acceptata opresc Seal; nu inventam evidenta din prose.
Repetabilitatea reala, firewall/WFP, conturile sandbox, GCM si credentialele hostului
raman nevalidate. Run/Seal sunt pentru Razvan dupa review, nu au fost rulate aici.

Testele si cifrele: TEST_RESULTS.md. Pasii operatorului: ../LANSATOR_UNIC_PAW.md.
