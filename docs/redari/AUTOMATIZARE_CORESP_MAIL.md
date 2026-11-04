# Automatizare: `redari-coresp-mail` („📧 Pregătește mailul”, Redări → Corespondență)

Stare la 04.11.2026: **cod livrat în PR #980 (draft), migrarea `20261130f` NEAPLICATĂ, edge function NEDEPLOYAT.**
Textele de mai jos sunt pregătite pentru rândul din `public.automatizari` și pentru secțiunea din `claude_docs` slug `registru_automatizari`
(CLAUDE.md pct. 7). Le pune Răzvan / sesiunea care face deploy-ul, DUPĂ deploy. Fără valori de secrete — doar nume.

> **DECIZIE 04.11.2026, aprobat de Răzvan (varianta A, „simplificăm”), risc acceptat: mail intern dublu.** Mailul pleacă doar în firmă (la
> expeditorul @gazpet.ro, CC office@), deci un eventual mail intern dublu e acceptat. Nu există mecanism de reluare / intenție: la un rezultat
> incert utilizatorul verifică inboxul expeditorului și, dacă mailul nu a venit, poate apăsa din nou după 60 s.

## Ce face
Pe un rând din `red_corespondenta` aprobat de owner, cu fișier `de_trimis` aprobat (PDF), un admin / editor pe Redări apasă „📧 Pregătește mailul”.
Edge function-ul trimite prin Resend un mail **intern** către `expeditor_email` (doar @gazpet.ro), CC `office@gazpet.ro`, cu adresa instituției,
subiectul și textul gata scrise și PDF-ul aprobat atașat. Expeditorul le copiază într-un mail nou și îl trimite el. **Platforma nu trimite nimic
în afara firmei.**

## Componente
| Ce | Unde |
|---|---|
| Edge function | `supabase/functions/redari-coresp-mail/index.ts` (verify_jwt = **false**; JWT validat în cod cu `getUser`) |
| Modul partajat (fluxul edge, HTML mail, reguli e-mail) | `supabase/functions/_shared/redariCorespMail.mjs` (importat și de UI / teste) |
| Migrare | `supabase/migrations/20261130f_redari_coresp_mail.sql` (+ revenire `supabase/revenire/…_ROLLBACK.sql`, DRY `supabase/tests/…_dryrun.sql`) |
| RPC-uri | `fn_red_coresp_mail_incepe(corespondenta_id, versiune_confirmata, fisier_id_confirmat)`, `fn_red_coresp_mail_inchide(uuid,text,text,text)` → text — SECURITY DEFINER, EXECUTE doar `authenticated`; `fn_red_coresp_mail_verifica_baza(text)` (baseline L15, fără EXECUTE pentru aplicație) |
| Urmă | `public.red_corespondenta_mailuri` — append-only: un rând = o încercare, închisă o singură dată de autorul ei; SELECT orice nivel Redări; fără INSERT / UPDATE / DELETE direct |
| UI | `src/redari/ui/CorespondentaEcran.jsx` (buton pe rând + „pregătit de X la Y”), `src/redari/corespondentaMail.js` |

## Secrete (nume, nu valori)
- `RESEND_API_KEY` — secret edge Supabase (același folosit de `ofertare-garantie-mail` și celelalte mailuri ale platformei).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — standard, injectate de Supabase. **NU** folosește `SUPABASE_SERVICE_ROLE_KEY`.

## Fișa de securitate (a–e)
- **(a) Conținut extern citit:** câmpurile scrise de editori pe rând (`destinatar`, `destinatar_email`, `mail_subiect`, `mail_text`) și PDF-ul urcat
  de ei. Se tratează ca date: escapare HTML completă (`& < > " '`), adresa instituției apare doar ca text (fără `mailto:` / linkuri generate de noi),
  subiectul intern pe un singur rând (CR/LF scoase; și CHECK în BD), PDF-ul se atașează ca octeți (verificat `%PDF-`, ≤ 25 MB). Nimic din conținut
  nu declanșează vreo acțiune.
- **(b) Ce scrie / trimite:** UN mail intern prin Resend, DOAR către `expeditor_email` (@gazpet.ro: CHECK în BD + RPC + edge), CC `office@gazpet.ro`;
  `reply_to` = adresa utilizatorului DOAR dacă e @gazpet.ro, altfel office@; un rând în `red_corespondenta_mailuri` (in_curs, apoi o singură
  închidere: trimis / eroare / necunoscut). Nu atinge bani, drepturi, alte tabele; nu trimite nimic în afara domeniului gazpet.ro.
  **Risc acceptat (decizia Răzvan 04.11.2026, varianta A): mail intern dublu** după un rezultat incert urmat de un nou click.
- **(c) Identitate:** JWT-ul utilizatorului pe tot drumul — RPC-urile SECURITY DEFINER iau identitatea din `auth.uid()` (JWT), descărcarea PDF-ului
  din bucket-ul `redari` se face cu JWT-ul utilizatorului (politica `red_storage_sel` = admin / editor). **Fără `service_role`.** DEFINER e necesar
  doar ca să scrie urma fără drept de INSERT direct și să citească `storage.objects` (eTag) — ambele sub verificarea explicită de nivel din funcție.
- **(d) Cine o poate porni:** `verify_jwt=false`, dar tokenul se validează în cod (`auth.getUser`): cheia anon nu are utilizator → 401. Apoi poarta
  de ROL în BD: `fn_red_coresp_mail_incepe` cere `fn_red_nivel() IN ('admin','editor')` → viewer / fără Redări → 403 (testat în DRY: viewer, anon,
  mentenanță fără JWT refuzați).
- **(e) Confirmare umană:** aprobarea owner-ului pe rând (stare `aprobat`, legată de fișierul exact + eTag; orice schimbare a câmpurilor mailului
  sau un PDF nou face aprobarea să cadă) + click-ul unui admin / editor cu confirmare în fereastră; click-ul trimite versiunea și fișierul aprobat
  VĂZUTE, iar RPC-ul le compară sub `FOR UPDATE` (diferență = „rândul s-a schimbat; reîncarcă”). Limite în RPC, sub blocare: 60 s pe rând pe TOATE
  încercările, indiferent de stare; 20 de încercări / zi (Europe/Bucharest) / proiect. PDF-ul: eTag-ul din `storage.objects` = cel aprobat (RPC) și
  antetul ETag al descărcării = valoarea puternică aprobată, exact (`W/…` refuzat). Succes doar dacă Resend a acceptat ȘI urma s-a închis `trimis`;
  orice rezultat incert (rețea, timeout, 5xx, eroare RPC netransparentă, închidere neconfirmată) → UI: „Rezultat incert — verifică inboxul
  expeditorului; dacă mailul nu a venit, poți apăsa din nou după 60 s (poate produce un mail intern dublu)”. Refuzurile de business clare
  (42501 / 23514 / P0002) apar ca atare. Dacă istoricul mailurilor nu se poate citi, butonul e oprit („Nu am putut citi istoricul mailurilor — reîncarcă”).
  Migrarea verifică baseline-ul L15 al obiectelor de care depinde (corp + setări + owner + EXECUTE pentru regulile corespondenței, `fn_red_nivel`,
  `fn_red_jurnal`, `fn_red_versiune_creste`; cele 3 triggere de pe `red_corespondenta`: funcție, activ, tip) — fără extindere la tot catalogul
  (observația Copilot r2 P3-01 rămâne acceptată).

## Text propus pentru `public.automatizari`
- **nume:** `redari-coresp-mail` — „📧 Pregătește mailul” (Redări → Corespondență)
- **tip:** edge function (pornită manual din UI, fără cron)
- **descriere:** Mail intern către expeditorul @gazpet.ro (CC office@) cu adresa instituției, subiectul, textul și PDF-ul aprobat; expeditorul trimite el mailul către instituție.
- **declanșator / cine pornește:** click admin / editor Redări pe un rând aprobat de owner; poarta de rol în RPC (`fn_red_nivel`).
- **(a) conținut extern:** câmpurile editorilor + PDF-ul urcat → escapate / atașate ca octeți.
- **(b) scrie / trimite:** 1 mail intern (doar @gazpet.ro + office@; reply_to doar @gazpet.ro sau office@) + rând în `red_corespondenta_mailuri`. Risc acceptat (Răzvan, 04.11.2026): mail intern dublu.
- **(c) identitate:** JWT utilizator; fără service_role.
- **(d) poartă:** getUser + `fn_red_nivel() IN ('admin','editor')` în RPC.
- **(e) confirmare umană:** aprobarea owner-ului pe rând + click (versiune + fișier văzute); 60 s / rând (orice stare), 20 / zi / proiect; rezultat incert → verificare în inbox, fără reluare automată.
- **secrete_nume:** `RESEND_API_KEY`
- **stare:** activ (după deploy) · **verificat_la:** data deploy-ului

## Text propus pentru `registru_automatizari`
> **redari-coresp-mail** (edge, manual din UI, din <data deploy>) — Redări → Corespondență, „📧 Pregătește mailul”. Pe rând aprobat de owner cu PDF
> aprobat, admin/editor cer un mail INTERN la expeditor (@gazpet.ro, verificat în BD + edge) cu CC office@, cu adresa instituției, subiectul,
> textul și PDF-ul aprobat (eTag verificat în BD și în antetul descărcării, doar ETag puternic). Nu trimite în afara firmei. Identitate: JWT
> utilizator, fără service_role; poartă de rol în RPC `fn_red_coresp_mail_incepe`; urmă append-only în `red_corespondenta_mailuri`; 60 s / rând,
> 20 / zi / proiect. Decizie Răzvan 04.11.2026 (varianta A): fără reluare, risc acceptat mail intern dublu. Secret: `RESEND_API_KEY`.
> Oprire: dezactivare / ștergere funcție edge; revenire BD: `20261130f_..._ROLLBACK.sql`.

## Ordinea de livrare
1. Review (Jakarinos + Copilot) pe diff → GO.
2. Migrarea `20261130f` (cere `20261130e` aplicată; garda md5 pe `fn_red_corespondenta_reguli` = `0705e04f3e26656c2116b6d1b9f87c6e` + baseline L15).
3. Deploy `redari-coresp-mail` cu `verify_jwt=false` (fișierele: `redari-coresp-mail/index.ts` + `_shared/redariCorespMail.mjs`).
4. Merge PR-ul (UI-ul citește coloanele noi: înainte de migrare ecranul Corespondență ar da eroare).
5. Test LIVE pe TEST-RAZVAN: completat câmpurile mailului, PDF de_trimis, aprobare owner, click → mailul ajunge la expeditor + office@.
6. Rândul din `public.automatizari` + secțiunea din `registru_automatizari` (textele de mai sus).

## Riscuri cunoscute
- **Mail intern dublu (ACCEPTAT, decizia Răzvan 04.11.2026, varianta A):** după un rezultat incert, un nou click după 60 s poate produce încă un mail intern.
- **eTag în antetul descărcării:** edge-ul cere ca antetul `ETag` al răspunsului Storage să fie egal exact (puternic) cu eTag-ul aprobat. Dacă Storage
  nu trimite antetul (sau îl formatează altfel / slab), mailul e refuzat — fail-closed. De verificat la primul test LIVE.
- **Încercări `in_curs` rămase:** dacă edge-ul cade între RPC și închidere, rândul rămâne `in_curs` (afișat „neconfirmat (în curs)”); blochează doar 60 s.
- **Urma poate fi închisă „trimis” fără mail** de un admin/editor care apelează RPC-urile direct (fără edge): afectează doar propria urmă (created_by),
  nu trimite nimic. Acceptat (alternativa ar fi service_role în edge).
