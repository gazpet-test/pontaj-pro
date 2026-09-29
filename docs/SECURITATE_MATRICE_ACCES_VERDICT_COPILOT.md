# Verdict Copilot pe matricea de acces efectiv (5af94a3) — 30.09.2026 ~02:07 RO

Text integral, primit prin canalul Copilot (conversația 2) după 208 s. Mesajul trimis: antet cu DELTA, cererea (metodă / prioritizare / ce lipsește), faptele adiționale și `docs/SECURITATE_MATRICE_ACCES_2026-09-30.md` integral.

---

GO CU CORECTURI ca bază pentru decizia lui Răzvan; nu GO de execuție și nu certificare exhaustivă a accesului. Mă bazez pe documentul 5af94a3 și rezultatele raportate, fără verificare independentă în BD.

## 1. Metoda este utilă, dar §0 conține erori care trebuie corectate

Privilegii efective + politici + numărători sub identitatea testată reprezintă o probă bună pentru citirea observată. Pentru INSERT/UPDATE/DELETE, marcați separat „permis structural” și „demonstrat dinamic local”; numărarea rândurilor nu demonstrează scrierea. Nu cer teste mutante în producție.

Corecturile necesare:

- **FORCE RLS:** cu RLS activ și fără politică aplicabilă, accesul nu devine permis doar prin GRANT. BYPASSRLS nu acordă, singur, privilegii de citire/scriere; afirmația despre supabase_read_only_user și „scrie tot” trebuie retrasă. Nici ownerul aplicației nu trece automat orice politică.
- **Roluri și privilegii:** lipsa moștenirii nu înseamnă „privilegiu efectiv = grant direct”; contează și PUBLIC și granturile pe coloane. Verificați sensul relației roleid → member pentru authenticator, nu descrieți generic rolurile ca membre unele ale altora.
- **Simularea:** SET ROLE + claims demonstrează traseul evaluat, nu reproduce integral PostgREST/Storage/edge. session_user poate rămâne postgres, diferență relevantă pentru funcții care îl verifică. Zero rânduri pe un tabel gol nu dovedește lipsa accesului.
- **Contradicție cu S-A:** §1.1 spune greșit că toate cele patru triggere sar verificarea când UID-ul lipsește. S-A g aprobat nu face asta; identitățile privilegiate sunt verificate explicit.
- **TRUNCATE:** ocolește RLS și nu execută triggerele DELETE, dar execută triggerele specifice TRUNCATE. Nu declarați că ocolește toate triggerele; auditul J05 are tocmai o asemenea protecție.

Pentru completarea matricei lipsesc: enumerarea celor 16 excepții INSERT anon, verificarea view-ului v_ofertare_identitate_tokens, căile prin RPC/edge și URL-uri semnate, plus separarea accesului la metadatele Storage de descărcarea efectiv demonstrată. Nu sunt necesare descărcări de documente sensibile pentru această analiză.

Corectați și prezentarea: 297/324 ≈ 91,7%, nu 77%; la contracte_terti, matricea trebuie să arate permisiunea efectivă rezultată din politica ALL permisivă, nu poarta strictă anulată de aceasta. „Token/PIN activ” cere criteriul de valabilitate, nu doar valoare nenulă.

## 2. Priorități #1–#10

Nu susțin o coadă rigidă în care tokenurile/PIN-urile și trezoreria așteaptă terminarea tuturor patch-urilor precedente. Acestea trebuie pregătite în paralel.

„Înainte” înseamnă limitarea autorizată a expunerii, nu obligatoriu refactorizarea completă. Orice modificare directă Ofertare sau a unei componente comune care îi schimbă accesul/funcționarea cere aprobarea impactului și, unde se încalcă freeze-ul, excepția exactă. Un deploy UI rămâne supus separat Q2-B.

| Expunere | Prioritate și domeniu |
|---|---|
| #1 — profile/escaladare | ÎNAINTE, prioritar. Protejarea câmpurilor care acordă capabilități; componentă comună, deci impactul Ofertare trebuie verificat. Nu corectează retroactiv drepturile existente. |
| #2 — tokenuri concediu | ÎNAINTE, prioritate imediată. Restrângerea citirii și decizia privind invalidarea/reemiterea credentialelor expuse. HR, fără excepție Ofertare dacă patch-ul rămâne izolat. |
| #3 — QR-PIN, date employees, trezorerie | ÎNAINTE pentru credențiale și scrierile financiare deschise. Nu amânați întregul grup fiindcă refactorul employees este mai mare; vedeți punctul 4. |
| #4 — RSVTI/jurnal | ÎNAINTE. #538 după corecturi și noul GO; domeniul punctual HR nu cere automat excepție Ofertare. Integritatea completă a jurnalului rămâne un pas distinct. |
| #5 — stoc/transferuri | ÎNAINTE pentru scrierile neautorizate, prin REST și RPC împreună. Corecțiile mai ample de concurență pot avea etapă separată. |
| #6 — financiar/comercial și prețuri Ofertare | ÎNAINTE pentru modificările neautorizate și datele comerciale sensibile. Separați domeniile; partea Ofertare cere excepție explicită. Nu o lăsați la coada listei. |
| #7 — Storage | ÎNAINTE pentru ștergere/suprascriere neautorizată și documente sensibile. Documentele neutre pot aștepta clasificarea. Verificați dependențele folosite de Jilava. |
| #8 — scanuri HR în inbox | ÎNAINTE, împreună cu #7; politica metadatelor și accesul la fișier trebuie tratate coerent. |
| #9 — TRUNCATE/default privileges | DUPĂ, dacă rămâne latent conform analizei; obligatoriu înainte de P2. „Regresie zero” trebuie demonstrată, nu presupusă. |
| #10 — net/olx/configurări | Verificarea căilor indirecte azi; hardening-ul latent poate DUPĂ. Dacă apare o cale accesibilă către secrete sau operații externe neautorizate, trece imediat în prioritatea de dinainte. |

Tokenurile/PIN-urile expuse și trezoreria modificabilă sunt o deltă de transmis imediat lui Răzvan. Decizia lui de amânare a celor patru RPC-uri nu acoperă implicit aceste suprafețe noi. Nu rezultă de aici autorizarea unor schimbări de drepturi.

## 3. Patch-ul propus: GO pentru pregătire, dar separați domeniile

GO DOAR PREGĂTIRE pentru două patch-uri distincte: unul pentru hr_concediu_tokens, altul pentru trezorerie_conturi și extrase. Au actori legitimi, impact și proceduri de revenire diferite.

La tokenuri, restrângerea SELECT nu invalidează o copie obținută anterior. Puneți separat în decizia ownerului revocarea/reemiterea, verificarea expirării și păstrarea fluxului legitim din edge. Aceasta nu înseamnă că furtul este demonstrat. Testele folosesc tokenuri fictive locale.

La trezorerie, matricea țintă de citire/scriere trebuie aprobată explicit; nu deduceți dreptul de modificare doar din dreptul de vizualizare.

Nu declarați încă #1 „acoperită integral de 30a”. Lista prezentată pentru 30a nu reconciliază toate câmpurile din matrice: receive_bonuri_consum, whatsapp_enabled și phone_whatsapp necesită clarificare față de SQL-ul exact. În special, dacă numărul WhatsApp participă la identificare sau rutarea datelor, auto-editarea lui nu este automat un câmp personal inofensiv. Noul review trebuie făcut pe revizie, nu pe eticheta extensiei.

## 4. employees: refactor separat — da; amânarea întregii protecții — nu

GO pe direcția unei proiecții neutre și a accesului server-side controlat la datele sensibile. NO-GO pentru lăsarea tuturor IBAN-urilor și QR-PIN-urilor accesibile până după Jilava doar fiindcă există select('*').

Un view neutru nu protejează nimic cât timp tabelul de bază rămâne integral citibil. Nici security_invoker nu conferă automat acces suplimentar față de privilegiile și RLS-ul sursei; proiectați împreună tabelul, coloanele, view-ul/RPC-ul și consumatorii.

Refactorul UI complet poate veni după depunere numai cu o măsură interimară aprobată acum pentru credențiale și datele sensibile, cu impactul asupra ecranelor și fluxurilor Jilava prezentat lui Răzvan. Eventuala degradare temporară, restricționare sau reemitere este decizia lui, după preview — nu o operație automată a echipei.

Consemnare: matricea justifică prioritizarea și extinderea incidentului OPEN; nu demonstrează exploatarea și nu autorizează singură aplicarea patch-urilor.
