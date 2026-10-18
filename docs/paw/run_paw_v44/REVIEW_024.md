# Review #024 - 2026-10-18

Livrabil local, fara instalare, certificat real, cont nou, DB, push sau deploy.

| Punct review | Decizie si implementare |
|---|---|
| Certificat falsificabil din paw-data | Acceptat: mutat in bin administrativ, ACL/owner verificate, schema 2, hash-uri exacte |
| codex.js singur + TOCTOU | Acceptat: pachet npm intreg (dependente native nested), node.exe, directoare/hash-uri/ACL la fiecare pornire |
| Filtre Git la add/reset | Acceptat: config strict fara filtre/includes, atribute executable refuzate, mediu curat, hooks goale protejate |
| Config global/local si index modificabile | Acceptat: global=NUL/nosystem, allowlist local inainte de Git, snapshot complet metadir cu index, compare inainte de Git post-copil |
| Sterge index fizic pentru a ignora coruptia | Respins ca mecanism de mascare: orice schimbare a indexului opreste; nu reconstruim un index ostil ca si cum ar fi fost valid |
| Hardlink/reparse/nested .git/root/reserved names | Acceptat: verificari inainte de coborare in subdirector; refuz inclusiv root, handle LinkCount, atribute/module |
| --no-verify | Acceptat ca aparare suplimentara; nu inlocuieste hooksPath/admin ACL |
| Installer race | Acceptat: bariera comuna pe toate canalele, lock public read-only, recontrol procese dupa lock si inainte de swap, bin versionat/retired |
| v4.3 poate porni fara bariera | Limita reala: necesara oprire legacy in mentenanta; un flag nu opreste schedulerul vechi |
| Mediu contaminat | Acceptat: allowlist, TEMP/TMP numai in worktree, fara secrete/proxy/profile, auth dedicat administrat separat |
| Esuari lasa worktree | Pastrate intentionat pentru audit, raport status/phase/reason, procedura manuala fara force implicit |
| Gemini: user simplu + firewall simplu garanteaza tot | Respins ca garantie: token/profil/acces ACL/retea host-model vs copii necesita broker + probe reale, nu cinci linii icacls |
| Firewall pe acelasi user pentru host si copil | Nu adoptat: ar putea opri si transportul necesar modelului; pastram sandbox nativ si test separat al copiilor |
| OS validat de stub | Respins: 1 test explicit SKIPPED; certificarea reala nu a fost rulata |
| Autenticitate manifest | Hash din review administrativ separat; manifestul singur nu autentifica propriul furnizor |

## Dovezi si alegere

Citite package.json si bin/codex.js instalate: @openai/codex 0.162.0, wrapperul
spawn-eaza binarul din pachetul optional nested @openai/codex-win32-x64. Inventar
local read-only: CodexSandboxOffline / CodexSandboxOnline prezente. Nu deducem
identitatea efectiva a shell-ului din numele conturilor.

Documentatia oficiala consultata: https://learn.chatgpt.com/docs/windows/windows-sandbox
si https://learn.chatgpt.com/docs/config-file/config-reference . Elevated documenteaza
ACL/firewall/utilizatori dedicati pentru comenzi. Hostul modelului are nevoie de
transport separat. Sursa publica main pentru apply_patch, consultata pentru
orientare, transmite un FileSystemSandboxContext catre filesystem adapter;
nu este o inspectie a binarului instalat si nu dovedeste OS containment pe server.
Nu a fost disponibil aici un audit complet al sursei exact-tag si al traseului
Windows pentru fiecare operatie de filesystem. Aceasta intrebare ramane in
certificarea reala, nu este rezolvata prin afirmatie.

Alegere: varianta 1 numai CANDIDAT, activare blocata fara probe reale. Daca ea
nu blocheaza profilul/scrierile/patch-urile, nu exista fallback implicit nesigur.
Varianta 2 PawCdx necesita implementare si review separat dupa rezultatul probei;
nu am generat/stocat parola, configurat cont/ACL real, firewall sau login. Nu
pretind ca #024 a deblocat deja executia autonoma pe server.

Certifica_cdx are Run (real launcher limited interactive token, canari, evenimente,
verificare externa) si Seal (decizie admin pe dovezi, hash-bound). O relatare a
modelului nu este acceptata; probele lipsa fac certificarea incompleta. Markerul
nu apare la instalare. Loopback != dovada tuturor conexiunilor Internet. Read
profile este obligatoriu si poate esua ca poarta deoarece workspace-write singur
nu promite interdictia citirii profilului. Compatibilitatea CODEX_HOME fara profil
si fetch HTTPS (fara helper implicit, sau GCM administrativ fixat optional numai
pentru parinte) sunt preconditii inca neverificate.

## Ce nu s-a executat

- Codex real, consum de model, sandbox setup, autentificare sau certificat.
- ProgramData, ScheduledTask real, instalare, swap, rollback, user PawCdx/DPAPI.
- Fetch privat real, atac concurent arbitrar cu acelasi user, audit al tuturor
  proceselor pornite de brokerul sandbox elevated, retea Internet completa.
- Activare/deploy/push/PR/DB. Certificatele si canarii din teste sunt sintetici.

Raportul functional si comenzile de teste: TEST_RESULTS.md.
