# 529 — follow-up P2 (20261002b): delta pentru Copilot

> **r2 (02.10.2026) e mai jos; secțiunea de început e r1 (`b126b50`, sha 0ae0c0da…, NO-GO static Copilot), păstrată ca istoric.**

# r1 (istoric)

**context_version:** branch `claude/529-p2-followup` din `origin/main` (`11d18de`), commit `11d18de`; generated_at 2026-10-02. Decizia Răzvan **16A**: PR mic de follow-up pentru cele 4 P2 acceptate de Jakarinos ca risc documentat pe #529 r11 (`529_DELTA_COPILOT.md`, secțiunea „P2 declarate acceptabile”). c/d/e sunt LIVE (v20261001230000 / 231500 / 233000, sha256 identic cu tabelul r11 din `docs/CONTURI_CICLU_VIATA.md`). **Pe live NIMIC** în această rundă (nici SELECT): md5-urile LIVE din precondiții sunt calculate pe harness din fișierele c/d cu sha256 identic cu cel livrat.

## Fișiere
| Fișier | sha256 |
|---|---|
| `supabase/migrations/20261002b_conturi_p2_followup.sql` (migrare NOUĂ, aditivă) | `0ae0c0dafa579bfc44072b779465f422e7669b5d88c9b850e1fcf997fb6a8a85` |
| `supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql` (revenire tehnică, armată, fără GO) | `3f4d37432596ce09cdf967070f5557a4579eef62e331b07b84434acf4d210a25` |
| `supabase/tests/conturi_ciclu_viata.test.sql` (secțiunea r12: 4 teste, 23 aserțiuni + pregătire / curățenie) · `supabase/tests/conturi_ciclu_viata.migrari.txt` (+ 20261002b) · `scripts/test_conturi_ciclu_viata.sh` (rollback din `supabase/revenire/`, armare după antet) · `src/App.jsx` (eticheta `amanat_lock` în „Leagă automat”) · `docs/CONTURI_CICLU_VIATA.md` §H · `supabase/revenire/README.md` | — |

Funcții înlocuite (semnături, ACL-uri, SECURITY DEFINER + search_path neschimbate): `fn_cont_notifica_owneri`, `fn_cont_serializare_activa`, `fn_cont_revalideaza_candidat`, `fn_cont_leaga_automat` (c), `fn_conturi_inchideri_sweep` (d). md5 live r11 → 20261002b: `0bbbf41d…` → `f969f776…`, `8327108d…` → `526b9a2c…`, `7bb0d97e…` → `ecbbd64c…`, `349f5402…` → `a32cb851…`, `7bc5ddf2…` → `9e203157…`. Precondiția acceptă md5-ul live SAU propriu (reaplicare); postcondiția cere exact md5-ul propriu + ACL. NOTĂ: precondițiile lui d / e verifică md5-ul lui `fn_cont_notifica_owneri` ⇒ o REAPLICARE a lui d / e pe live după follow-up ar fi refuzată (corect; harness-ul reaplică în ordine c → d → e → 20261002b).

## Tabel P2 → fix → test → mutație
| # | P2 (r11, Jakarinos) | Fix (20261002b) | Test nou (harness, secțiunea r12) | Mutația care îl pică |
|---|---|---|---|---|
| 1 | **Deadlock la legarea pe loturi** (c:858-875): după legarea lui A lotul ține cheia comună de nume; HR ține fișa B și așteaptă cheia; lotul ajunge la B și așteaptă fișa ⇒ ciclu (40P01) | `fn_cont_leaga_automat` + `fn_cont_revalideaza_candidat`: politica sweep-ului — lotul așteaptă doar cât nu ține nimic; după un element care a lăsat lock-uri `gazpet.cont_lock_nowait = on` ⇒ fișa / cheile / profilul NOWAIT ⇒ rezultat explicit `amanat_lock` (UI: reia „Leagă automat”); `auth_ocupat` neschimbat; GUC readus pe off | **P2-1-LOT-NOWAIT** (8): HR ține fișa B ⇒ lotul [A, B] se termină ≤ 3 s, A `legat`, B `amanat_lock`; redenumirea lui B de către HR trece imediat; reluarea leagă B; primul element al lotului AȘTEAPTĂ (semantica păstrată); GUC-ul nu rămâne pe on | **M-a** (GUC-ul rămâne off) ⇒ cade la „lotul [A, B] se TERMINĂ (≤ 3 s)…” |
| 2 | **Garda `fn_cont_serializare_activa` fără `tgqual` / `tgattr`** (c:341-350) | garda cere `tgqual IS NULL` și lista exactă a coloanelor din `UPDATE OF` (pe nume, sortate): employees {active, cnp, email, name, termination_date}, hr_employees_private {cnp, employee_id}; md5-urile funcțiilor de lock neschimbate; pre/postcondiția migrării cer garda = true pe triggerele live | **P2-2-GARDA-TGQUAL** (3): trigger cu `WHEN (false)` (restul identic) ⇒ garda FALSE + `serializare_indisponibila`; `UPDATE OF cnp` fără employee_id ⇒ FALSE; după `ROLLBACK TO SAVEPOINT` TRUE | **M-b** (varianta r11 a gărzii) ⇒ cade la „trg_employees_persoana_lock cu WHEN (false)…” |
| 3 | **Notificări pierdute fără reluare** (c:436-437 owner ținut ⇒ sărit; d:1232 `notificat_la = now()` chiar cu 0 livrate) | `fn_cont_notifica_owneri` întoarce ownerii ACOPERIȚI (inserat acum sau deja necitit); handlerul marchează `notificat_la` doar dacă > 0; la abandonare 0 ⇒ `notificat_la = NULL` + pasul final „reluare notificări” al sweep-ului (re-trimite anunțul de abandonare până ajunge; rezultat `notificare_reluata`) | **P2-3-NOTIF-RELUATA** (6): toți ownerii ținuți ⇒ backoff, `notificat_la` NULL, nicio notificare; ownerii liberi ⇒ anunț la eroarea următoare; abandonare cu ownerii ținuți ⇒ neanunțată; rularea următoare ⇒ `notificare_reluata = 1`; idempotent; notificatorul = owneri acoperiți | **M-c** (`notificat_la = now()` necondiționat) ⇒ cade la „eroare în sweep cu toți ownerii ținuți…” |
| 4 | **Amânare nelimitată la contenție** (d:1190-1192, `amanat_lock` fără contor / alertă) | coloană nouă aditivă `conturi_inchideri_coada.amanari integer NOT NULL DEFAULT 0`; sweep: la fiecare amânare `amanari += 1` (intrarea FOR UPDATE NOWAIT în subtranzacție; ținută ⇒ fără așteptare, fără incrementare); alertă owner `cont_inchidere_amanata` la 6 amânări la rând (~30 min) și la fiecare multiplu de 6 (rezultat `amanari_alerta`); reset la procesare normală cu intrarea rămasă deschisă; semantica `amanat_lock` neschimbată | **P2-4-AMANARI** (6): auth.users ținut de GoTrue ⇒ amânări succesive, contorul 1…6, alertă exact la 6; intrarea altui element ținută ⇒ sweep-ul nu așteaptă, contorul lui rămâne 0; eliberare ⇒ închidere, contorul rămâne ca istoric | **M-d** (`SET amanari = amanari`) ⇒ cade la „rularea 1: … amanari = 1 …” |

## Teste
- harness PG16 `--reaplica --rollback`: **1966 aserțiuni PASS** (după migrare: 644, după reaplicare: 644, după rollback, doar BAZĂ: 26, după rollback + reaplicare: 644; + gărzile de ordine / coadă / fereastră c→d, rollback pas cu pas inclusiv revenirea 20261002b = schema de după 20260929e, schema finală = cea dinainte). Baseline r11 (fără follow-up) rerulat în aceeași sesiune: 620 aserțiuni după migrare.
- Mutații (fix-ul scos, al doilea cluster PG16 local port 5435, fișierul mutat cu numele original, lista cu precondițiile live, postcondiția md5 dezarmată în mutant):
- **M-a** (c, `fn_cont_leaga_automat`: GUC-ul rămâne `off` (lotul nu trece niciodată pe NOWAIT)) ⇒ harness-ul cade exact la „P2-1-LOT-NOWAIT lotul [A, B] se TERMINĂ (≤ 3 s) cât timp HR ține fișa B: după legarea lui A nu mai așteaptă fișa B (r11 rămânea blocat ținând cheia LOTESCU)”.
- **M-b** (c, `fn_cont_serializare_activa`: fără verificarea `tgqual` / `tgattr` (varianta r11)) ⇒ harness-ul cade exact la „P2-2-GARDA-TGQUAL trg_employees_persoana_lock cu WHEN (false) — nume / tgenabled / tgtype 23 / funcție / md5 IDENTICE cu d (r11 îl accepta) ⇒ garda e FALSE și legarea refuză explicit (serializare_indisponibila)”.
- **M-c** (d, handlerul sweep-ului: `notificat_la = now()` indiferent de rezultatul notificatorului (varianta r11)) ⇒ harness-ul cade exact la „P2-3-NOTIF-RELUATA eroare în sweep cu toți ownerii ținuți: backoff făcut, dar notificatorul a acoperit 0 owneri ⇒ notificat_la rămâne NULL (r11 îl punea oricum), nicio notificare”.
- **M-d** (d, sweep: `SET amanari = amanari` (contorul nu se incrementează)) ⇒ harness-ul cade exact la „P2-4-AMANARI rularea 1: A închis; B amânat (amanat_lock, semantica neschimbată: fără incercari / backoff / notificare) cu amanari = 1; RESET procesat normal (scadența mutată) ⇒ contorul lui revine la 0”.
- Validator `scripts/livrare_validator.py` pe migrare: OK. `npx vite build`: OK.

## Rămas deschis / de verdict
- GO/NO-GO Copilot pe migrarea de mai jos (singura schimbare de logică: cele 4 puncte; nimic altceva în c/d/e, care rămân LIVE neatinse).
- Alegeri de confirmat: pragul de alertă 6 amânări (~30 min) și repetarea la fiecare multiplu de 6; rezultatul notificatorului = owneri „acoperiți” (inserat sau deja necitit), nu „inserate acum”; `fn_cont_coada_pune` NU resetează `amanari` la ciclu nou (contorul rămâne istoric pe intrarea rezolvată; se resetează doar când elementul e procesat normal și rămâne deschis).
- Livrare: `bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261002b_conturi_p2_followup.sql --sha256 0ae0c0dafa579bfc44072b779465f422e7669b5d88c9b850e1fcf997fb6a8a85 --versiune <AAAALLZZHHMMSS, > 20261001233000> --tinta-db … --tinta-sistem … --tinta-host … --tinta-port …` — DOAR după GO Copilot + acordul lui Răzvan; preflight read-only înainte (md5-urile live ale celor 5 funcții = valorile r11 din tabel, `fn_cont_serializare_activa() = true`, coloana `amanari` absentă).

# r2 (02.10.2026) — după NO-GO-ul STATIC Copilot pe r1 `0ae0c0da…` (P2-1 și P2-2: GO static, neatinse)

**context_version:** branch `claude/529-p2-followup`, PR #576, commit r2 `5a58f86` (părinte r1 `b126b50`); generated_at 2026-10-02. **Pe live NIMIC.**

## Verdictul r1 (rezumat)
- **BLOCKER P2-3A** — calea triggerului `fn_employees_ciclu_cont → fn_cont_coada_pune(…, p_eroare) → fn_cont_notifica_owneri`: `fn_cont_coada_pune` (d r11) punea `notificat_la = now()` pentru orice `p_eroare` (și la conflict `notificat_la = EXCLUDED.notificat_la`), ÎNAINTEA notificării best-effort ⇒ `auth_ocupat` + toți ownerii ținuți ⇒ 0 acoperiți, UPDATE-ul HR comis, intrarea „anunțată”, sweep-ul (`ELSIF x.notificat_la IS NULL`) nu mai reîncearcă.
- **BLOCKER P2-4A** — în sweep, la prag (`amanari % 6 = 0`) rezultatul notificatorului era ignorat ⇒ la amânarea 6 cu toți ownerii ținuți `amanari_alerta = 1` raportat fals, iar la 7 condiția nu mai e adevărată ⇒ alerta pierdută definitiv.
- Alegeri cerute: `amanari` = consecutive; reziduu declarat (contenție pe rândul cozii); semantica „≥ 1 owner acoperit” rămâne.

## Ce s-a schimbat în r2
| Blocant | Fix (fișier) | Test nou | Mutația care îl pică |
|---|---|---|---|
| P2-3A | `fn_cont_coada_pune` intră în migrare (md5 live `890a0025…` → `b1c2b93c…`): `p_eroare` ⇒ DOAR `ultima_eroare`; `notificat_la` NULL la INSERT și readus NULL la ciclu nou; **marcajul „anunțat” îl pune DOAR sweep-ul, pe acoperire ≥ 1**. Anunțul din trigger rămâne best-effort (de curtoazie; în cazul normal: trigger + „încercarea 1 din 8”, apoi nimic până la abandonare — R2-41 adaptat) | **P2-3-TRIGGER-NOTIF-0** (3): Towner ține toți ownerii + GoTrue ține `auth.users` ⇒ HR încheie contractul ⇒ `auth_ocupat` ⇒ intrare `reincercare`, **`notificat_la IS NULL`** (r1: FALSE), nicio notificare; sweep cu GoTrue pe rând ⇒ `amanat_lock`, neanunțată și reluabilă; eliberare ⇒ închis | **M-e** (`CASE WHEN p_eroare IS NOT NULL THEN now() END`) |
| P2-4A | coloană nouă aditivă `ultima_amanare_alertata integer NOT NULL DEFAULT 0` (DROP în revenire); sweep: prag = `amanari − amanari % 6`; alerta se încearcă la fiecare rulare cât timp prag > marker; markerul avansează DOAR după acoperire > 0 (`amanari_alerta` / `amanari_alerta_neacoperita`) | **P2-4-ALERTA-RETRY** (3): la 6 toți ownerii ținuți ⇒ marker 0, `amanari_alerta_neacoperita = 1`, fără notificare; la 7, ownerii liberi, contenția menținută ⇒ alerta pragului 6 livrată („de 7 ori la rând”), marker = 6; la 8 nimic | **M-f** (markerul avansat indiferent de acoperire) |
| alegerea 1 | `amanari` consecutive: reset `amanari = 0, ultima_amanare_alertata = 0` la orice procesare non-amanat_lock (succes, rezolvare, eroare cu backoff) și la ciclu nou (`fn_cont_coada_pune`) | P2-4-AMANARI adaptat (RESET: contor 3 + marker 3 ⇒ 0; B închis ⇒ 0/0; P2-3-TRIGGER: eroare/închidere ⇒ 0) | M-d (contorul nu se incrementează) |
| alegerea 2 | reziduu declarat în `docs/CONTURI_CICLU_VIATA.md` §H.1(7) și aici: contenție persistentă pe însuși rândul cozii ⇒ `amanat_lock` repetat fără incrementare (sweep-ul nu așteaptă niciodată acolo; contorul nu se poate persista fără lock) — risc acceptat, telemetrie separată ca follow-up | P2-4-AMANARI (intrarea RESET ținută ⇒ contorul lui rămâne 0, sweep-ul se termină) | — |
| alegerea 3 | semantica notificatorului „≥ 1 owner acoperit” (mesaj inserat acum sau deja necitit la acel owner) = SLA „minim un owner află”; scrisă explicit în §H.1(7) | P2-3-NOTIF-RELUATA (dedupe ⇒ același număr, nu 0) | M-c |

Neatinse față de r1: P2-1 (`fn_cont_leaga_automat` / `fn_cont_revalideaza_candidat`, md5 `a32cb851…` / `ecbbd64c…`), P2-2 (`fn_cont_serializare_activa`, `526b9a2c…`), `fn_cont_notifica_owneri` (`f969f776…`), UI, harness-ul (rollback din `supabase/revenire/`). Sweep: md5 nou `c65d27e1…` (r1 `9e203157…`).

## Fișiere (r2 — istoric; r3 mai jos)
| Fișier | sha256 |
|---|---|
| `supabase/migrations/20261002b_conturi_p2_followup.sql` | `408acee583e5c345b566041c81d23c0704241bdfa4c6195d064fa7dd953a2936` |
| `supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql` | `42f27506983f81607687c26837738d2cf683c1b186eb520af2f55423b6636ef8` |

## Teste (r2 — istoric)
- harness PG16 `--reaplica --rollback`: **1981 aserțiuni PASS** (după migrare: 649, după reaplicare: 649, după rollback, doar BAZĂ: 26, după rollback + reaplicare: 649; + gărzile de ordine / coadă / fereastră c→d, rollback pas cu pas inclusiv revenirea 20261002b = schema de după 20260929e, schema finală = cea dinainte). Baseline r11 (fără follow-up): 620 aserțiuni după migrare.
- Mutații (fix-ul scos, al doilea cluster PG16 local port 5435, fișierul mutat cu numele original, lista cu precondițiile live, postcondiția md5 dezarmată în mutant):
- **M-a** (c, `fn_cont_leaga_automat`: GUC-ul rămâne `off` (lotul nu trece niciodată pe NOWAIT)) ⇒ harness-ul cade exact la „P2-1-LOT-NOWAIT lotul [A, B] se TERMINĂ (≤ 3 s) cât timp HR ține fișa B: după legarea lui A nu mai așteaptă fișa B (r11 rămânea blocat ținând cheia LOTESCU)”.
- **M-b** (c, `fn_cont_serializare_activa`: fără verificarea `tgqual` / `tgattr` (varianta r11)) ⇒ harness-ul cade exact la „P2-2-GARDA-TGQUAL trg_employees_persoana_lock cu WHEN (false) — nume / tgenabled / tgtype 23 / funcție / md5 IDENTICE cu d (r11 îl accepta) ⇒ garda e FALSE și legarea refuză explicit (serializare_indisponibila)”.
- **M-c** (d, handlerul sweep-ului: `notificat_la = now()` indiferent de rezultatul notificatorului (varianta r11)) ⇒ harness-ul cade exact la „P2-3-NOTIF-RELUATA eroare în sweep cu toți ownerii ținuți: backoff făcut, dar notificatorul a acoperit 0 owneri ⇒ notificat_la rămâne NULL (r11 îl punea oricum), nicio notificare”.
- **M-d** (d, sweep: `SET amanari = amanari` (contorul nu se incrementează)) ⇒ harness-ul cade exact la „P2-4-AMANARI rularea 1: A închis; B amânat (amanat_lock, semantica neschimbată: fără incercari / backoff / notificare) cu amanari = 1; RESET procesat normal (scadența mutată) ⇒ contorul și markerul lui revin la 0”.
- **M-e** (d r2, `fn_cont_coada_pune`: `notificat_la = CASE WHEN p_eroare IS NOT NULL THEN now() END` (varianta r11)) ⇒ harness-ul cade exact la „P2-3-TRIGGER-NOTIF-0 Towner ține toți ownerii + GoTrue ține auth.users ⇒ HR încheie contractul: auth_ocupat ⇒ intrare „reincercare” cu ultima_eroare, notificatorul 0 acoperiți ⇒ notificat_la rămâne NULL (r1: now()), nicio notificare”.
- **M-f** (d r2, sweep: markerul `ultima_amanare_alertata` avansat indiferent de acoperire (varianta r1)) ⇒ harness-ul cade exact la „P2-4-ALERTA-RETRY a 6-a amânare cu toți ownerii ținuți: alerta nu acoperă pe nimeni ⇒ markerul rămâne 0 (alertă pending), rezultatul o raportează ca neacoperită, nu ca livrată”.
- Validator `scripts/livrare_validator.py` pe migrare: OK. `npx vite build`: OK.

## Rămas deschis (r2 — istoric)
- GO/NO-GO Copilot pe r2 (P2-3A, P2-4A + cele 3 alegeri, decise cum a cerut Copilot).
- Consecință asumată a P2-3A: în cazul normal (owneri liberi) owner-ul primește două anunțuri `cont_inchidere_esuata` cu text diferit (trigger + prima reîncercare din sweep); singura alternativă fără dublură ar fi mutarea anunțului din trigger în `fn_cont_coada_pune` (schimbare în `fn_employees_ciclu_cont`, d GO static) — nefăcută.
- Livrare: `bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261002b_conturi_p2_followup.sql --sha256 408acee583e5c345b566041c81d23c0704241bdfa4c6195d064fa7dd953a2936 --versiune <AAAALLZZHHMMSS, > 20261001233000> …` — DOAR după GO Copilot + acordul lui Răzvan; preflight read-only: md5-urile live ale celor 6 funcții = valorile r11, `fn_cont_serializare_activa() = true`, coloanele `amanari` / `ultima_amanare_alertata` absente.

# r3 (02.10.2026) — după NO-GO-ul STATIC Copilot pe r2 `408acee5…` (un singur blocant: P2-4B; P2-1, P2-2, P2-3A, P2-4A, alegerile 1–3: închise / GO)

**context_version:** branch `claude/529-p2-followup`, PR #576, commit r3 `2666d04` (părinte r2 `5a58f86`, r1 `b126b50`); generated_at 2026-10-02. **Pe live NIMIC.**

## Verdictul r2 (rezumat)
- **P2-4B — spec ≠ cod**: docs/delta spuneau „alerta se încearcă la fiecare rulare cât timp prag > marker”, dar codul o încearcă DOAR în ramura `v_amanat`. Contraexemplu: `amanari = 5`, marker 0; rularea 6 ⇒ amanat_lock, `amanari = 6`, ownerii ținuți ⇒ 0 acoperiți (marker rămâne 0 — corect); înainte de rularea 7 contenția dispare ⇒ elementul se procesează normal ⇒ nicio verificare prag > marker pe calea normală ⇒ `amanari = 0, marker = 0` ⇒ alerta pragului 6 uitată definitiv. P2-4-ALERTA-RETRY nu o vedea (menținea contenția și la 7).

## Decizia (sesiunea principală): varianta 2 — politică operațională simplă
Alerta de amânări e relevantă **doar cât timp contenția continuă**. Dacă următoarea rulare procesează elementul normal, alerta pending se **ANULEAZĂ explicit** (nu „se reîncearcă până ajunge”). Codul rămâne în esență cum era; schimbare minimă în sweep pentru observabilitate: pe calea normală, la resetul seriei, dacă `amanari − amanari % 6 > ultima_amanare_alertata` ⇒ rezultatul capătă `amanari_alerta_anulata` (+1). Pe calea de eroare (backoff) resetul rămâne tăcut (owner-ul primește anunțul de eșec / abandonare).

| Punct | Ce s-a făcut în r3 | Test | Mutația care îl pică |
|---|---|---|---|
| P2-4B | docs §H.1 (6, 8) și delta rescrise fără „pending până la ≥ 1 owner”; sweep: contor `amanari_alerta_anulata` la resetul pe calea normală când prag > marker (md5 sweep `c65d27e1…` → `ee501560…`); antet migrare + revenire (doar md5 în precondiție) | **P2-4-ALERTA-ANULATA-LA-RECUPERARE** (3): amânări 1–5; la 6 contenție + toți ownerii ținuți ⇒ `amanari = 6`, marker 0, 0 `cont_inchidere_amanata`; la 7 ownerii liberi și contenția DISPĂRUTĂ ⇒ `inchis = 1`, `amanari = 0`, marker 0, `amanari_alerta_anulata = 1`, NICIO `cont_inchidere_amanata`, `cont_inchis_automat` există | (politică: nu există fix de ascuns; testul fixează comportamentul; M-f rămâne pentru P2-4A) |
| antet delta | r2 = commit `5a58f86`, părinte r1 `b126b50` (corectat) | — | — |

Neatinse față de r2: `fn_cont_coada_pune` (`b1c2b93c…`), `fn_cont_notifica_owneri`, `fn_cont_serializare_activa`, `fn_cont_revalideaza_candidat`, `fn_cont_leaga_automat`, coloanele, UI, harness.

## Fișiere (r3)
| Fișier | sha256 |
|---|---|
| `supabase/migrations/20261002b_conturi_p2_followup.sql` | `61798922725de46f17e5828eb7235c9f43e29fc7dea887d8668621166af327dc` |
| `supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql` | `0d7b516e400f9f98a0c0472bdeeacd4594e91b37fb06abec17be2d7221d5de88` |

## Teste (r3)
- harness PG16 `--reaplica --rollback`: **1990 aserțiuni PASS** (după migrare: 652, după reaplicare: 652, după rollback, doar BAZĂ: 26, după rollback + reaplicare: 652; + gărzile de ordine / coadă / fereastră c→d, rollback pas cu pas inclusiv revenirea 20261002b = schema de după 20260929e, schema finală = cea dinainte). r2: 1981; r1: 1966; baseline r11: 620.
- Mutații (fix-ul scos, al doilea cluster PG16 local port 5435, fișierul mutat cu numele original, lista cu precondițiile live, postcondiția md5 dezarmată în mutant):
- **M-a** (c, `fn_cont_leaga_automat`: GUC-ul rămâne `off` (lotul nu trece niciodată pe NOWAIT)) ⇒ harness-ul cade exact la „P2-1-LOT-NOWAIT lotul [A, B] se TERMINĂ (≤ 3 s) cât timp HR ține fișa B: după legarea lui A nu mai așteaptă fișa B (r11 rămânea blocat ținând cheia LOTESCU)”.
- **M-b** (c, `fn_cont_serializare_activa`: fără verificarea `tgqual` / `tgattr` (varianta r11)) ⇒ harness-ul cade exact la „P2-2-GARDA-TGQUAL trg_employees_persoana_lock cu WHEN (false) — nume / tgenabled / tgtype 23 / funcție / md5 IDENTICE cu d (r11 îl accepta) ⇒ garda e FALSE și legarea refuză explicit (serializare_indisponibila)”.
- **M-c** (d, handlerul sweep-ului: `notificat_la = now()` indiferent de rezultatul notificatorului (varianta r11)) ⇒ harness-ul cade exact la „P2-3-NOTIF-RELUATA eroare în sweep cu toți ownerii ținuți: backoff făcut, dar notificatorul a acoperit 0 owneri ⇒ notificat_la rămâne NULL (r11 îl punea oricum), nicio notificare”.
- **M-d** (d, sweep: `SET amanari = amanari` (contorul nu se incrementează)) ⇒ harness-ul cade exact la „P2-4-AMANARI rularea 1: A închis; B amânat (amanat_lock, semantica neschimbată: fără incercari / backoff / notificare) cu amanari = 1; RESET procesat normal (scadența mutată) ⇒ contorul și markerul lui revin la 0”.
- **M-e** (d r2, `fn_cont_coada_pune`: `notificat_la = CASE WHEN p_eroare IS NOT NULL THEN now() END` (varianta r11)) ⇒ harness-ul cade exact la „P2-3-TRIGGER-NOTIF-0 Towner ține toți ownerii + GoTrue ține auth.users ⇒ HR încheie contractul: auth_ocupat ⇒ intrare „reincercare” cu ultima_eroare, notificatorul 0 acoperiți ⇒ notificat_la rămâne NULL (r1: now()), nicio notificare”.
- **M-f** (d r2, sweep: markerul `ultima_amanare_alertata` avansat indiferent de acoperire (varianta r1)) ⇒ harness-ul cade exact la „P2-4-ALERTA-RETRY a 6-a amânare cu toți ownerii ținuți: alerta nu acoperă pe nimeni ⇒ markerul rămâne 0 (alertă pending), rezultatul o raportează ca neacoperită, nu ca livrată”.
- Validator `scripts/livrare_validator.py` pe migrare: OK. `npx vite build`: OK.

## Rămas deschis / de verdict
- GO/NO-GO Copilot pe r3 (P2-4B: politica operațională + testul care o fixează).
- Livrare: `bash scripts/livrare_migrare.sh --migrare supabase/migrations/20261002b_conturi_p2_followup.sql --sha256 61798922725de46f17e5828eb7235c9f43e29fc7dea887d8668621166af327dc --versiune <AAAALLZZHHMMSS, > 20261001233000> …` — DOAR după GO Copilot + acordul lui Răzvan; preflight read-only: md5-urile live ale celor 6 funcții = valorile r11, `fn_cont_serializare_activa() = true`, coloanele `amanari` / `ultima_amanare_alertata` absente.

## Diff r2 → r3 (migrare + revenire)
```diff
diff --git a/supabase/migrations/20261002b_conturi_p2_followup.sql b/supabase/migrations/20261002b_conturi_p2_followup.sql
index 31fdde0..62abb11 100644
--- a/supabase/migrations/20261002b_conturi_p2_followup.sql
+++ b/supabase/migrations/20261002b_conturi_p2_followup.sql
@@ -38,8 +38,12 @@
 --       (≥ 1 owner). Anunțul din trigger rămâne best-effort (de curtoazie; poate fi urmat de anunțul primei reîncercări din sweep).
 --   (d, P2-4A) alerta de prag folosea doar amanari % 6 = 0 și ignora acoperirea ⇒ la amânarea 6 cu toți ownerii ținuți alerta se pierdea
 --       definitiv. Fix: marker durabil conturi_inchideri_coada.ultima_amanare_alertata integer NOT NULL DEFAULT 0 (coloană nouă, aditivă):
---       bucket-ul (6, 12, …) = amanari − amanari % 6; alerta se încearcă la fiecare rulare cât timp bucket > marker și se marchează
---       DOAR după acoperire > 0 (rulările 7, 8… continuă să încerce bucket-ul 6).
+--       bucket-ul (6, 12, …) = amanari − amanari % 6; cât timp CONTENȚIA CONTINUĂ alerta se încearcă la fiecare amânare (bucket > marker)
+--       și se marchează DOAR după acoperire > 0 (rulările 7, 8… continuă să încerce bucket-ul 6).
+--   r3 (P2-4B, politică operațională simplă — decizia sesiunii principale): alerta de amânări e relevantă DOAR cât timp contenția
+--       continuă; dacă următoarea rulare procesează elementul normal, o alertă încă neacoperită se ANULEAZĂ explicit (reset contor +
+--       marker, rezultat amanari_alerta_anulata) — NU „se reîncearcă până ajunge”. Pe calea de eroare (backoff) resetul e tăcut
+--       (owner-ul primește oricum anunțul de eșec / abandonare).
 --   (alegeri cerute de Copilot) amanari = amânări CONSECUTIVE: reset la 0 (și marker 0) la orice procesare non-amanat_lock (succes,
 --       rezolvare, eroare cu backoff) și la ciclu nou (fn_cont_coada_pune). Reziduu declarat: contenția persistentă pe însuși rândul cozii
 --       ⇒ amanat_lock repetat FĂRĂ incrementare (contorul nu se poate persista fără lock-ul rândului) — risc acceptat, telemetrie separată
@@ -87,7 +91,7 @@ BEGIN
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',           '349f540203eeb73639c4cfa4316a8cd6', 'a32cb851d317d273feee8e975eba66a4'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', '890a0025f513ca02ac9276cd4a360afb', 'b1c2b93cbe3b9560bcb38d460c717fce'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', 'c65d27e17297056cc3a5a752248b6591')) AS w(f, sig, m_live, m_nou)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', 'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m_live, m_nou)
    WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) IN (w.m_live, w.m_nou) AND p.prosecdef
@@ -428,7 +432,8 @@ GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authen
 --   (d) la fiecare amânare (amanat_lock) contorul amanari += 1 pe intrare (FOR UPDATE NOWAIT în subtranzacție proprie: intrarea ținută
 --       de altcineva ⇒ WARNING, fără așteptare, fără incrementare — reziduu declarat: contenție persistentă pe însuși rândul cozii ⇒
 --       amanat_lock repetat fără incrementare); r2 (P2-4A): la prag (amanari − amanari % 6 > ultima_amanare_alertata) owner-ul e anunțat
---       (cont_inchidere_amanata) și markerul se avansează DOAR după acoperire > 0 (altfel se reîncearcă la fiecare rulare);
+--       (cont_inchidere_amanata) și markerul se avansează DOAR după acoperire > 0 (altfel se reîncearcă la următoarea AMÂNARE; r3 — P2-4B:
+--       dacă elementul se procesează normal între timp, alerta neacoperită se anulează explicit, amanari_alerta_anulata);
 --       r2 (alegerea 1): amanari = amânări CONSECUTIVE — orice procesare non-amanat_lock (succes, rezolvare, eroare cu backoff) pune
 --       amanari = 0 și ultima_amanare_alertata = 0; fn_cont_coada_pune le resetează la ciclu nou.
 --       Rezultatul sweep-ului capătă cheile 'amanari_alerta', 'amanari_alerta_neacoperita' și 'notificare_reluata' (contoare).
@@ -559,7 +564,12 @@ BEGIN
         v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
       END IF;
       IF x.amanari > 0 OR x.ultima_amanare_alertata > 0 THEN
-        -- 20261002b (P2-4, r2: amânări CONSECUTIVE): orice procesare non-amanat_lock (rezolvare sau rămas deschis) închide seria
+        -- 20261002b (P2-4, r2: amânări CONSECUTIVE): orice procesare non-amanat_lock (rezolvare sau rămas deschis) închide seria.
+        -- r3 (P2-4B, politică operațională): o alertă de prag încă neacoperită (prag > marker) se ANULEAZĂ explicit aici — alerta e
+        -- relevantă doar cât timp contenția continuă; elementul tocmai s-a procesat normal (contorizat: amanari_alerta_anulata).
+        IF x.amanari - x.amanari % c_prag_amanari > x.ultima_amanare_alertata THEN
+          v_n := jsonb_set(v_n, ARRAY['amanari_alerta_anulata'], to_jsonb(COALESCE((v_n ->> 'amanari_alerta_anulata')::int, 0) + 1));
+        END IF;
         UPDATE public.conturi_inchideri_coada SET amanari = 0, ultima_amanare_alertata = 0 WHERE id = x.id;
       END IF;
       v_tine := true;
@@ -699,7 +709,7 @@ BEGIN
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4',       '{postgres=X/postgres,authenticated=X/postgres}'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce',       '{postgres=X/postgres}'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'c65d27e17297056cc3a5a752248b6591',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
    WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
diff --git a/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql b/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
index 1fd04da..b315298 100644
--- a/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
+++ b/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
@@ -31,7 +31,7 @@ BEGIN
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'c65d27e17297056cc3a5a752248b6591')) AS w(f, sig, m)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m)
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m);
   IF v_lipsa IS NOT NULL THEN
     RAISE EXCEPTION 'Revenire 20261002b: precondiție — funcțiile nu sunt varianta 20261002b (md5): %', v_lipsa;
```

## Migrarea completă r3 (`supabase/migrations/20261002b_conturi_p2_followup.sql`)
```sql
-- ============================================================================
-- 20261002b — Conturi (c/d live din 02.10.2026, v20261001230000 / v20261001231500 / v20261001233000): follow-up pentru cele 4 P2
-- acceptate de Jakarinos ca risc documentat pe #529 (docs/AUDIT_OFERTARE_V2/529_DELTA_COPILOT.md, r11 „P2 declarate acceptabile”;
-- decizia Răzvan 16A). Migrare ADITIVĂ, în stilul runner-ului (gardă de livrare start/final cu marcaj txid, precondiții fail-closed
-- cu md5 pe funcțiile LIVE pe care le înlocuiește, postcondiții, fără BEGIN/COMMIT). Revenire: supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql.
--
--   (a) P2-1 — deadlock în legarea pe loturi (c:858-875, fn_cont_leaga_automat, aplicare multiplă). După legarea elementului A
--       tranzacția lotului ține fișa A, cheile persoanei (cheia comună de nume!), profilul A și rândul auth.users A până la COMMIT.
--       HR ține fișa B și așteaptă cheia de nume ținută de lot; lotul ajunge la B și AȘTEAPTĂ fișa B ⇒ ciclu (40P01, victimă posibil HR).
--       Fix: aceeași politică ca sweep-ul (r8/r9, gazpet.cont_lock_nowait): lotul AȘTEAPTĂ doar cât timp nu ține nimic de la un
--       element anterior; de la al doilea element ținut încolo fișa, cheile persoanei și profilul se iau FĂRĂ așteptare
--       (fn_cont_revalideaza_candidat citește GUC-ul: FOR UPDATE NOWAIT + fn_cont_lock_chei NOWAIT) ⇒ 55P03 ⇒ rezultat EXPLICIT
--       de reîncercare 'amanat_lock' (subtranzacția elementului abandonată, nimic ținut de la el; owner-ul reia „Leagă automat”).
--       Calea cont-nou (fn_cont_leaga_la_creare) e un singur element ⇒ neschimbată (GUC off ⇒ așteaptă ca până acum).
--   (b) P2-2 — fn_cont_serializare_activa nu verifica tgqual / tgattr (c:341-350): un trigger cu același nume, tip, funcție și md5
--       dar cu WHEN (…) sau UPDATE OF pe mai puține coloane trecea garda. Fix: garda cere și tgqual IS NULL (fără WHEN) și lista
--       EXACTĂ a coloanelor din UPDATE OF (nume, nu attnum — stabile între medii): employees {active, cnp, email, name, termination_date},
--       hr_employees_private {cnp, employee_id} — exact ce livrează d.
--   (c) P2-3 — notificări pierdute fără reluare: fn_cont_notifica_owneri sare un owner ținut FOR UPDATE (c:436-437, corect: fără
--       așteptare), dar handlerul sweep-ului marca notificat_la = now() CHIAR dacă notificatorul livrase 0 mesaje (d:1232) ⇒ intrarea
--       nu se mai anunța niciodată; la fel anunțul de abandonare (o singură șansă). Fix: notificatorul întoarce numărul de owneri
--       ACOPERIȚI (mesaj inserat acum SAU același mesaj deja necitit la acel owner — dedupe-ul nu mai „pierde” acoperirea);
--       handlerul marchează notificat_la DOAR dacă rezultatul > 0, altfel intrarea rămâne reluabilă (la eroarea următoare se anunță
--       din nou); la abandonare, 0 livrate ⇒ notificat_la = NULL și un pas final al sweep-ului („reluare notificări”) re-trimite
--       anunțul de abandonare la fiecare rulare până ajunge (abandonat_la IS NOT NULL AND notificat_la IS NULL).
--   (d) P2-4 — amânare nelimitată la contenție (d:1190-1192, amanat_lock fără contor / alertă). Fix: coloană nouă ADITIVĂ
--       conturi_inchideri_coada.amanari integer NOT NULL DEFAULT 0; la fiecare amânare sweep-ul incrementează contorul pe intrare
--       (intrarea luată FOR UPDATE NOWAIT în subtranzacție proprie — ținută de altcineva ⇒ WARNING, fără așteptare, fără incrementare)
--       și după prag (6 amânări la rând = ~30 min la cron de 5 min; apoi la fiecare multiplu de 6) anunță owner-ul
--       (cont_inchidere_amanata). Semantica amanat_lock e NEschimbată: intrarea rămâne fără incercari / backoff / abandon, se reia la
--       rularea următoare; contorul se resetează când elementul e procesat normal și rămâne deschis (ex. scadența mutată).
--
--   r2 (NO-GO static Copilot pe r1 0ae0c0da…; P2-1 / P2-2 GO static, neatinse):
--   (c, P2-3A) calea triggerului: fn_employees_ciclu_cont → fn_cont_coada_pune(…, p_eroare) punea notificat_la = now() DOAR pentru că
--       exista o eroare, înaintea notificării best-effort a triggerului ⇒ cu toți ownerii ținuți (0 acoperiți) intrarea rămânea „anunțată”
--       și sweep-ul nu mai reîncerca anunțul. Fix: fn_cont_coada_pune separă ultima_eroare de notificat_la — p_eroare se scrie în
--       ultima_eroare, notificat_la rămâne / revine NULL (ciclu nou). Marcajul „anunțat” îl pune DOAR sweep-ul, pe baza acoperirii
--       (≥ 1 owner). Anunțul din trigger rămâne best-effort (de curtoazie; poate fi urmat de anunțul primei reîncercări din sweep).
--   (d, P2-4A) alerta de prag folosea doar amanari % 6 = 0 și ignora acoperirea ⇒ la amânarea 6 cu toți ownerii ținuți alerta se pierdea
--       definitiv. Fix: marker durabil conturi_inchideri_coada.ultima_amanare_alertata integer NOT NULL DEFAULT 0 (coloană nouă, aditivă):
--       bucket-ul (6, 12, …) = amanari − amanari % 6; cât timp CONTENȚIA CONTINUĂ alerta se încearcă la fiecare amânare (bucket > marker)
--       și se marchează DOAR după acoperire > 0 (rulările 7, 8… continuă să încerce bucket-ul 6).
--   r3 (P2-4B, politică operațională simplă — decizia sesiunii principale): alerta de amânări e relevantă DOAR cât timp contenția
--       continuă; dacă următoarea rulare procesează elementul normal, o alertă încă neacoperită se ANULEAZĂ explicit (reset contor +
--       marker, rezultat amanari_alerta_anulata) — NU „se reîncearcă până ajunge”. Pe calea de eroare (backoff) resetul e tăcut
--       (owner-ul primește oricum anunțul de eșec / abandonare).
--   (alegeri cerute de Copilot) amanari = amânări CONSECUTIVE: reset la 0 (și marker 0) la orice procesare non-amanat_lock (succes,
--       rezolvare, eroare cu backoff) și la ciclu nou (fn_cont_coada_pune). Reziduu declarat: contenția persistentă pe însuși rândul cozii
--       ⇒ amanat_lock repetat FĂRĂ incrementare (contorul nu se poate persista fără lock-ul rândului) — risc acceptat, telemetrie separată
--       ca follow-up. Semantica notificatorului „≥ 1 owner acoperit” rămâne (SLA: minim un owner află).
--
-- Funcții înlocuite (precondiție = md5 LIVE r11, calculat pe harness din fișierele cu sha256 identic cu docs/CONTURI_CICLU_VIATA.md r11;
-- la reaplicare = md5 propriu): fn_cont_notifica_owneri (c), fn_cont_serializare_activa (c), fn_cont_revalideaza_candidat (c),
-- fn_cont_leaga_automat (c), fn_cont_coada_pune (d, r2), fn_conturi_inchideri_sweep (d). Semnături, ACL-uri, SECURITY DEFINER + search_path: neschimbate.
-- NOTĂ: precondițiile lui d / e verifică md5-ul lui fn_cont_notifica_owneri (0bbbf41d…) — după acest follow-up o REAPLICARE a lui d / e
-- pe live ar fi refuzată de ele (corect: starea de pornire s-a schimbat); harness-ul reaplică c → d → e → 20261002b în ordine.
-- Idempotentă. Nu atinge datele (coloana nouă pornește pe 0).
-- ============================================================================

-- ── Garda de livrare (start): DOAR prin scripts/livrare_migrare.sh (psql --single-transaction, marcaj legat de txid).
--    Fișierul NU conține BEGIN/COMMIT; psql -f simplu, apply_migration / execute_sql MCP nu îl pot aplica.
DO $livrare_start$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002b_conturi_p2_followup:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002b: garda de livrare (start) — rulează DOAR prin scripts/livrare_migrare.sh';
  END IF;
END $livrare_start$;

-- ── Precondiții fail-closed ──────────────────────────────────────────────────────────────
DO $pre_livrare$
DECLARE v_lipsa text[]; v_tip text;
BEGIN
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Precondiție: migrarea rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- pachetul c/d/e e livrat (obiectele de care depinde follow-up-ul)
  SELECT array_agg(f) INTO v_lipsa FROM unnest(ARRAY['fn_cont_leaga_automat','fn_cont_revalideaza_candidat','fn_cont_serializare_activa',
                                                      'fn_cont_notifica_owneri','fn_conturi_inchideri_sweep','fn_cont_lock_chei','fn_cont_chei_potrivire',
                                                      'fn_cont_candidati_angajat','fn_identitate_privilegiata','fn_cont_inchide','fn_cont_garda_persoana',
                                                      'fn_cont_motiv_garda','fn_cont_flaguri','fn_cont_restaurare_activa']::text[]) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: lipsesc funcțiile pachetului c/d: %', v_lipsa; END IF;
  IF to_regclass('public.conturi_inchideri_coada') IS NULL OR to_regclass('public.conturi_inchideri_jurnal') IS NULL THEN
    RAISE EXCEPTION 'Precondiție: tabelele cozii / jurnalului (20260929d) lipsesc';
  END IF;
  -- Funcțiile înlocuite pornesc EXACT din varianta LIVE r11 (md5 prosrc) sau, la reaplicare, din varianta proprie (semnătură unică,
  -- SECURITY DEFINER, proconfig, owner postgres).
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',   '0bbbf41d3097840c16a97a263ff4cd5f', 'f969f77614176d63341f69e1909c11f1'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                   '8327108ddc25b66c312b7ba82e3a83b2', '526b9a2c30d4d70df3d94928e597de17'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',           '349f540203eeb73639c4cfa4316a8cd6', 'a32cb851d317d273feee8e975eba66a4'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', '890a0025f513ca02ac9276cd4a360afb', 'b1c2b93cbe3b9560bcb38d460c717fce'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', 'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m_live, m_nou)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) IN (w.m_live, w.m_nou) AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Precondiție: funcțiile înlocuite nu au amprenta LIVE r11 (semnătură/md5/secdef/proconfig/owner): % — se reanalizează', v_lipsa; END IF;
  -- (a) ACL-urile de pornire (păstrate de CREATE OR REPLACE): fn_cont_leaga_automat = owner + authenticated; celelalte doar postgres
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_cont_leaga_automat(boolean,jsonb)')) IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.fn_cont_notifica_owneri(text,text,text,text)'), to_regprocedure('public.fn_cont_serializare_activa()'),
                                                        to_regprocedure('public.fn_cont_revalideaza_candidat(uuid,integer,boolean)'), to_regprocedure('public.fn_conturi_inchideri_sweep()'),
                                                        to_regprocedure('public.fn_cont_coada_pune(uuid,integer,text,text,date,text)'))
                   AND p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'Precondiție: ACL-urile funcțiilor înlocuite diferă de cele livrate de c/d — se reanalizează';
  END IF;
  -- (b) triggerele de serializare ale lui d sunt live în forma livrată (fără WHEN, UPDATE OF pe coloanele exacte) — garda nouă le cere
  IF NOT public.fn_cont_serializare_activa() THEN
    RAISE EXCEPTION 'Precondiție: fn_cont_serializare_activa() = false (triggerele de lock ale lui d nu sunt instalate / active) — se reanalizează';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock' AND g.tgqual IS NULL
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                       = ARRAY['active','cnp','email','name','termination_date'])
     OR NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.hr_employees_private') AND g.tgname = 'trg_hr_employees_private_persoana_lock' AND g.tgqual IS NULL
                   AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                       = ARRAY['cnp','employee_id']) THEN
    RAISE EXCEPTION 'Precondiție: triggerele de lock ale lui d nu au forma livrată (WHEN / UPDATE OF) — se reanalizează';
  END IF;
  -- (d) coloanele noi: absente (prima aplicare) sau exact integer NOT NULL DEFAULT 0 (reaplicare)
  FOR v_tip IN SELECT c || ': ' || COALESCE((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || ' default ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-')
                                               FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                                              WHERE a.attrelid = 'public.conturi_inchideri_coada'::regclass AND a.attname = c AND NOT a.attisdropped), 'absent')
                 FROM unnest(ARRAY['amanari', 'ultima_amanare_alertata']) c LOOP
    IF split_part(v_tip, ': ', 2) NOT IN ('absent', 'integer not null default 0') THEN
      RAISE EXCEPTION 'Precondiție: conturi_inchideri_coada.% există cu altă definiție — se reanalizează', v_tip;
    END IF;
  END LOOP;
END $pre_livrare$;

-- (d) coloanele contorului de amânări — aditive, cu valoare implicită; intrările existente pornesc de la 0 -----------------------
ALTER TABLE public.conturi_inchideri_coada ADD COLUMN IF NOT EXISTS amanari integer NOT NULL DEFAULT 0;
ALTER TABLE public.conturi_inchideri_coada ADD COLUMN IF NOT EXISTS ultima_amanare_alertata integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.conturi_inchideri_coada.amanari IS
  'P2-4 (20261002b): de câte ori LA RÂND (consecutiv) sweep-ul a amânat intrarea din contenție (amanat_lock). Se resetează la orice procesare non-amanat_lock și la ciclu nou (fn_cont_coada_pune). Owner-ul e anunțat (cont_inchidere_amanata) la pragurile 6, 12, … (ultima_amanare_alertata).';
COMMENT ON COLUMN public.conturi_inchideri_coada.ultima_amanare_alertata IS
  'P2-4A (20261002b r2): ultimul prag de amânări (6, 12, …) pentru care alerta cont_inchidere_amanata a ACOPERIT ≥ 1 owner; cât timp pragul curent > marker, sweep-ul reîncearcă alerta la fiecare rulare. Se resetează odată cu amanari.';

-- (d, P2-3A) B.2b fn_cont_coada_pune — ultima_eroare separată semantic de notificat_la --------------------------------------------
-- r11: notificat_la = now() când p_eroare nu era NULL („apelantul tocmai a anunțat owner-ul”) — dar anunțul triggerului e best-effort
-- și vine DUPĂ; cu toți ownerii ținuți (FOR KEY SHARE NOWAIT ⇒ 0 acoperiți) intrarea rămânea marcată „anunțată” și sweep-ul
-- (ELSIF x.notificat_la IS NULL) nu mai anunța niciodată. 20261002b r2: p_eroare ⇒ DOAR ultima_eroare; notificat_la rămâne NULL la
-- INSERT și revine NULL la ciclu nou (ON CONFLICT) — marcajul îl pune DOAR sweep-ul, când notificatorul acoperă ≥ 1 owner.
-- (P2-4, alegerea 1) ciclu nou ⇒ amanari = 0, ultima_amanare_alertata = 0 (contorul e al amânărilor CONSECUTIVE).
CREATE OR REPLACE FUNCTION public.fn_cont_coada_pune(p_profile_id uuid, p_employee_id integer, p_tip text, p_motiv text,
                                                     p_scadent date DEFAULT CURRENT_DATE, p_eroare text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.conturi_inchideri_coada (profile_id, employee_id, tip, motiv, scadent_la, ultima_eroare, creat_de_identitate,
                                              notificat_la)
  VALUES (p_profile_id, p_employee_id, p_tip, p_motiv, COALESCE(p_scadent, CURRENT_DATE), p_eroare, public.fn_identitate_eticheta(),
          NULL)
  ON CONFLICT (profile_id, tip) WHERE rezolvat_la IS NULL
  DO UPDATE SET scadent_la = EXCLUDED.scadent_la, employee_id = EXCLUDED.employee_id, motiv = EXCLUDED.motiv,
                ultima_eroare = COALESCE(EXCLUDED.ultima_eroare, public.conturi_inchideri_coada.ultima_eroare),
                incercari = 0, urmatoarea_incercare_la = NULL, abandonat_la = NULL, notificat_la = NULL,
                amanari = 0, ultima_amanare_alertata = 0;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_coada_pune(uuid, integer, text, text, date, text) FROM PUBLIC, anon, authenticated, service_role;

-- (c) A.3 Notificări pentru owneri (c) — întoarce numărul de owneri ACOPERIȚI ---------------------------------------------------
-- r10: destinatarii se iau FOR KEY SHARE NOWAIT (owner ținut ⇒ sărit cu WARNING, fără așteptare) — neschimbat.
-- 20261002b (P2-3): rezultatul = owneri care AU notificarea după apel: mesajul inserat acum SAU același mesaj (type + message) deja
-- necitit la acel owner (dedupe-ul nu mai înseamnă „0 livrate”). Un owner sărit (ținut) NU contează. Apelanții care au nevoie de
-- garanția livrării (handlerul sweep-ului) marchează „anunțat” DOAR dacă rezultatul > 0; ceilalți (PERFORM) rămân best-effort.
CREATE OR REPLACE FUNCTION public.fn_cont_notifica_owneri(p_type text, p_title text, p_message text, p_link text DEFAULT '/admin')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n integer := 0; v_id uuid; v_k integer;
BEGIN
  BEGIN
    FOR v_id IN SELECT p.id FROM public.profiles p WHERE p.is_owner IS TRUE ORDER BY p.id LOOP
      BEGIN
        PERFORM 1 FROM public.profiles p WHERE p.id = v_id FOR KEY SHARE NOWAIT;   -- lock-ul implicit al FK-ului, luat FĂRĂ așteptare
        INSERT INTO public.notifications (profile_id, type, modul, title, message, link_to)
        SELECT v_id, p_type, 'HR', p_title, p_message, p_link
         WHERE NOT EXISTS (SELECT 1 FROM public.notifications n
                            WHERE n.profile_id = v_id AND n.type = p_type
                              AND n.message IS NOT DISTINCT FROM p_message AND n.read_at IS NULL);
        GET DIAGNOSTICS v_k = ROW_COUNT;
        -- 20261002b (P2-3): dedupe = owner-ul are deja exact acest mesaj necitit ⇒ e acoperit, nu „pierdut”
        IF v_k = 0 AND EXISTS (SELECT 1 FROM public.notifications n
                                WHERE n.profile_id = v_id AND n.type = p_type
                                  AND n.message IS NOT DISTINCT FROM p_message AND n.read_at IS NULL) THEN
          v_k := 1;
        END IF;
        v_n := v_n + v_k;
      EXCEPTION WHEN lock_not_available THEN
        RAISE WARNING 'fn_cont_notifica_owneri (%): owner-ul % e ținut de altă tranzacție — notificarea e sărită, fără așteptare', p_type, v_id;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_cont_notifica_owneri (%): % [%]', p_type, SQLERRM, SQLSTATE;
    v_n := 0;
  END;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_notifica_owneri(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- (b) Garda ferestrei c→d (c, r10) — acum verifică și WHEN (tgqual) și lista coloanelor din UPDATE OF (tgattr) --------------------
-- Constantele md5 ale funcțiilor de lock din d sunt NEschimbate (a1cd5859… / aa5e1a5a…); coloanele se compară pe NUME (sortate),
-- nu pe attnum — stabile între live și harness. Un trigger cu WHEN (…) sau cu UPDATE OF restrâns nu mai trece garda.
CREATE OR REPLACE FUNCTION public.fn_cont_serializare_activa()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.employees') AND g.tgname = 'trg_employees_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 23
                    AND g.tgfoid = to_regprocedure('public.fn_employees_persoana_lock()')
                    AND md5(p.prosrc) = 'a1cd5859f28b4f0c8483835d640d6cb8'
                    AND g.tgqual IS NULL                                                     -- 20261002b (P2-2): fără WHEN
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)                -- 20261002b (P2-2): UPDATE OF exact
                           FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_catalog.pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                        = ARRAY['active', 'cnp', 'email', 'name', 'termination_date'])
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
                  WHERE g.tgrelid = to_regclass('public.hr_employees_private') AND g.tgname = 'trg_hr_employees_private_persoana_lock'
                    AND NOT g.tgisinternal AND g.tgenabled IN ('O', 'A') AND g.tgtype = 31
                    AND g.tgfoid = to_regprocedure('public.fn_hr_employees_private_persoana_lock()')
                    AND md5(p.prosrc) = 'aa5e1a5a83c6c2b1eb39416579347293'
                    AND g.tgqual IS NULL
                    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                           FROM unnest(g.tgattr::int2[]) k(n) JOIN pg_catalog.pg_attribute a ON a.attrelid = g.tgrelid AND a.attnum = k.n)
                        = ARRAY['cnp', 'employee_id']);
$fn$;
REVOKE ALL ON FUNCTION public.fn_cont_serializare_activa() FROM PUBLIC, anon, authenticated, service_role;

-- (a) Revalidarea sub lock (c, r6–r10) — pașii 1 (fișă + chei) și 2 (profil) FĂRĂ așteptare când apelantul ține deja lock-uri -----
-- gazpet.cont_lock_nowait = 'on' (setare locală tranzacției, pusă de fn_cont_leaga_automat de la al doilea element ținut încolo,
-- ca în sweep): fișa FOR UPDATE NOWAIT, cheile persoanei prin fn_cont_lock_chei (care citește același GUC), profilul FOR UPDATE NOWAIT.
-- 55P03 la pașii 1–2 în modul fără așteptare ⇒ 'amanat_lock' (subtranzacția abandonată ⇒ nimic ținut de la acest element; de reîncercat).
-- Cu GUC-ul off (cont-nou, primul element al lotului) comportamentul e identic cu r11: așteaptă; 55P03 la pașii 1–2 se propagă.
-- Pasul 3 (auth.users) rămâne NOWAIT întotdeauna ⇒ 'auth_ocupat' (r9).
CREATE OR REPLACE FUNCTION public.fn_cont_revalideaza_candidat(p_profile_id uuid, p_emp integer, p_cere_marcaj boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_p      public.profiles%ROWTYPE;
  v_email  text;
  v_conf   boolean;
  v_incr   boolean;
  v_n      integer;
  v_emp    integer;
  v_ocupat boolean;
  v_pas    integer := 0;
  v_email0 text;
  v_nowait boolean := COALESCE(current_setting('gazpet.cont_lock_nowait', true), '') = 'on';   -- 20261002b (P2-1)
BEGIN
  IF p_emp IS NULL OR p_profile_id IS NULL THEN RETURN 'fara_candidat'; END IF;
  -- r10 (fereastra c→d): fără triggerele de serializare ale scriitorilor (d) instalate ȘI active, cheile luate mai jos nu
  -- serializează nimic ⇒ refuz explicit, ÎNAINTEA oricărui lock (nimic ținut), pe toate căile de legare.
  IF NOT public.fn_cont_serializare_activa() THEN RETURN 'serializare_indisponibila'; END IF;
  BEGIN
    v_pas := 1;
    IF v_nowait THEN
      PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE NOWAIT;      -- 1) fișa (fără așteptare: lotul ține deja lock-uri)
    ELSE
      PERFORM 1 FROM public.employees e WHERE e.id = p_emp FOR UPDATE;             -- 1) fișa
    END IF;
    -- 1b) r9 (P1-c Copilot „candidat-fantomă”): cheile identității de potrivire (fn_cont_chei_potrivire, EXACT cheile pe care le iau
    --     triggerele employees din d), în poziția comună a pachetului: fișă → persoană (advisory) → profil → auth.users.
    --     Emailul de aici e citit fără lock; dacă sub lock (pasul 3) e altul ⇒ 'schimbat' (de reîncercat), niciodată legare pe chei vechi.
    SELECT u.email::text INTO v_email0 FROM auth.users u WHERE u.id = p_profile_id;
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
    PERFORM public.fn_cont_lock_chei(public.fn_cont_chei_potrivire(v_email0));     -- (NOWAIT prin același GUC)
    v_pas := 2;
    IF v_nowait THEN
      SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE NOWAIT;   -- 2) profilul (recitit SUB lock)
    ELSE
      SELECT * INTO v_p FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
    v_pas := 3;
    SELECT u.email::text, u.email_confirmed_at IS NOT NULL, COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true'
      INTO v_email, v_conf, v_incr
      FROM auth.users u WHERE u.id = p_profile_id FOR NO KEY UPDATE NOWAIT;         -- 3) rândul de logare, BLOCAT FĂRĂ așteptare (r9) și recitit (r8)
    IF NOT FOUND THEN RETURN 'inexistent'; END IF;
  EXCEPTION WHEN lock_not_available THEN
    IF v_pas = 3 THEN
      RETURN 'auth_ocupat';     -- r9: rândul din auth.users e ținut de GoTrue (ștergere / schimbare în curs): retragere curată, fără ciclu
    END IF;
    IF v_nowait THEN
      RETURN 'amanat_lock';     -- 20261002b (P2-1): fișa / cheile persoanei / profilul ținute de altă tranzacție cât timp lotul ține deja
                                -- lock-uri de la un element anterior ⇒ retragere fără așteptare (fără ciclu cu HR); de reîncercat
    END IF;
    RAISE;
  END;
  IF lower(btrim(COALESCE(v_email, ''))) <> lower(btrim(COALESCE(v_email0, ''))) THEN RETURN 'schimbat'; END IF;   -- r9 (P1-c): chei luate pe alt email
  IF p_cere_marcaj AND NOT v_incr THEN RETURN 'fara_marcaj_incredere'; END IF;    -- marcajul retras cât timp se aștepta (r8)
  IF v_p.employee_id IS NOT NULL THEN RETURN 'legatura_existenta'; END IF;
  IF COALESCE(v_p.tip_cont, 'angajat') <> 'angajat' THEN RETURN 'tip_cont_exceptat'; END IF;
  IF NULLIF(lower(btrim(COALESCE(v_email, ''))), '') IS NULL
     OR lower(btrim(COALESCE(v_p.email, ''))) <> lower(btrim(v_email)) THEN RETURN 'email_diferit'; END IF;
  IF NOT v_conf THEN RETURN 'email_neconfirmat'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.employees e
                  WHERE e.id = p_emp AND e.active IS TRUE AND (e.termination_date IS NULL OR e.termination_date > CURRENT_DATE)) THEN
    RETURN 'fara_candidat';
  END IF;
  SELECT count(*), min(c.employee_id), COALESCE(bool_or(c.profil_legat IS NOT NULL), false)
    INTO v_n, v_emp, v_ocupat
    FROM public.fn_cont_candidati_angajat(v_email) c;
  IF v_n = 0 THEN RETURN 'fara_candidat'; END IF;
  IF v_n <> 1 OR v_emp IS DISTINCT FROM p_emp THEN RETURN 'schimbat'; END IF;
  IF v_ocupat THEN RETURN 'candidat_ocupat'; END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_cont_revalideaza_candidat(uuid, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- (a) A.5 Legarea la cerere, cu previzualizare (c) — politica „fără așteptare” pe elementele următoare ale lotului -----------------
-- Lotul e O tranzacție: lock-urile elementului legat (fișă, chei, profil, auth.users) rămân până la COMMIT. r11: la al doilea element
-- aștepta fișa B ținând cheia comună de nume de la A ⇒ ciclu posibil cu HR (ține fișa B, vrea cheia). 20261002b (P2-1): v_tine = true
-- după orice element care a lăsat lock-uri în urmă (subtranzacție încheiată normal: 'legat', dar și 'schimbat' / 'candidat_ocupat' /
-- 'legatura_existenta' etc., toate luate SUB lock); de atunci gazpet.cont_lock_nowait = 'on' ⇒ fn_cont_revalideaza_candidat ia fișa,
-- cheile și profilul NOWAIT ⇒ 55P03 ⇒ 'amanat_lock' (rezultat explicit; subtranzacția abandonată nu ține nimic). Rezultatele care
-- NU lasă lock-uri ('auth_ocupat', 'amanat_lock' — subtranzacția revalidării s-a anulat; 'eroare' / unique_violation — blocul s-a anulat)
-- nu schimbă v_tine. Primul element (nimic ținut) așteaptă ca până acum. Setarea e locală tranzacției și revine pe off după buclă.
CREATE OR REPLACE FUNCTION public.fn_cont_leaga_automat(p_simulare boolean DEFAULT true, p_confirmate jsonb DEFAULT NULL)
RETURNS TABLE(profile_id uuid, email text, rezultat text, employee_id integer, employee_name text,
              metoda text, cont_creat_la timestamptz, cont_provider text, cont_incredere boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r record;
  v_tine boolean := false;   -- 20261002b (P2-1): lotul ține lock-uri de la un element anterior
BEGIN
  IF public.fn_identitate_privilegiata() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Doar owner poate lega automat conturile' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(p_simulare, true) AND (p_confirmate IS NULL OR jsonb_typeof(p_confirmate) IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Aplicarea cere lista perechilor confirmate din previzualizare: p_confirmate = [{profile_id, employee_id}]'
      USING ERRCODE = '22023';
  END IF;
  FOR r IN
    WITH baza AS (
      SELECT pr.id AS pid, u.email AS uemail, u.created_at AS creat,
             u.raw_app_meta_data ->> 'provider' AS prov,
             COALESCE(u.raw_app_meta_data ->> 'gazpet_legare_automata', '') = 'true' AS incr,
             lower(btrim(COALESCE(pr.email, ''))) = lower(btrim(COALESCE(u.email, ''))) AS email_ok,
             u.email_confirmed_at IS NOT NULL AS conf
        FROM public.profiles pr
        JOIN auth.users u ON u.id = pr.id
       WHERE pr.employee_id IS NULL AND COALESCE(pr.tip_cont, 'angajat') = 'angajat'
    ),
    cand AS (
      SELECT b.pid, count(c.employee_id) AS n, min(c.employee_id) AS emp, min(c.employee_name) AS nume,
             min(c.metoda) AS met, COALESCE(bool_or(c.profil_legat IS NOT NULL), false) AS ocupat
        FROM baza b
        LEFT JOIN LATERAL public.fn_cont_candidati_angajat(b.uemail) c ON true
       WHERE b.email_ok AND b.conf
       GROUP BY b.pid
    )
    SELECT b.pid, b.uemail, b.creat, b.prov, b.incr, b.email_ok, b.conf, c.n, c.emp, c.nume, c.met, c.ocupat,
           count(*) FILTER (WHERE c.n = 1) OVER (PARTITION BY c.emp) AS pe_aceeasi_fisa
      FROM baza b
      LEFT JOIN cand c ON c.pid = b.pid
     ORDER BY b.uemail, b.pid
  LOOP
    profile_id := r.pid; email := r.uemail; cont_creat_la := r.creat; cont_provider := r.prov; cont_incredere := r.incr;
    employee_id := NULL; employee_name := NULL; metoda := NULL;
    IF NOT r.email_ok THEN
      rezultat := 'email_diferit';                        -- profiles.email ≠ emailul de logare: verifică manual
    ELSIF NOT r.conf THEN
      rezultat := 'email_neconfirmat';                    -- adresa de logare nedovedită: fără potrivire automată
    ELSIF COALESCE(r.n, 0) = 0 THEN
      rezultat := 'fara_candidat';
    ELSIF r.n > 1 THEN
      rezultat := 'ambiguu';
    ELSE
      employee_id := r.emp; employee_name := r.nume; metoda := r.met;
      IF r.ocupat THEN
        rezultat := 'candidat_ocupat';
      ELSIF r.pe_aceeasi_fisa > 1 THEN
        rezultat := 'ambiguu';                            -- mai multe conturi nelegate vor aceeași fișă
      ELSIF NOT public.fn_cont_serializare_activa() THEN
        rezultat := 'serializare_indisponibila';          -- r10 (fereastra c→d): și în previzualizare, ca owner-ul să vadă refuzul
      ELSIF COALESCE(p_simulare, true) THEN
        rezultat := 'de_legat';
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text) THEN
        rezultat := 'neconfirmat';                        -- nu era în previzualizarea confirmată
      ELSIF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_confirmate) x
                         WHERE jsonb_typeof(x) = 'object' AND x ->> 'profile_id' = r.pid::text
                           AND x ->> 'employee_id' = r.emp::text) THEN
        rezultat := 'schimbat';                           -- potrivirea s-a schimbat de la previzualizare
      ELSE
        -- 20261002b (P2-1): de la al doilea element ținut încolo, toate lock-urile revalidării se iau FĂRĂ așteptare
        PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
        BEGIN
          -- r6 (C-RACE-LINK-1) + r7 (P1-C): lock fișă → profil (ordinea comună a pachetului) și revalidarea AMBELOR jumătăți
          -- sub lock (fișă activă; profil încă nelegat, tip angajat, email profil = email de logare recitit, confirmat;
          -- potrivire recalculată identică). Altfel rezultatul revalidării (schimbat / fara_candidat / tip_cont_exceptat /
          -- email_diferit / email_neconfirmat / legatura_existenta / candidat_ocupat / auth_ocupat — r9: rândul de logare
          -- ținut de GoTrue, fără așteptare; amanat_lock — 20261002b: fișa / cheile / profilul ținute, lotul nu așteaptă;
          -- owner-ul reia „Leagă automat”), fără legare.
          rezultat := public.fn_cont_revalideaza_candidat(r.pid, r.emp);
          IF rezultat IS NULL THEN
            UPDATE public.profiles pr SET employee_id = r.emp
             WHERE pr.id = r.pid AND pr.employee_id IS NULL;
            rezultat := CASE WHEN FOUND THEN 'legat' ELSE 'candidat_ocupat' END;
          END IF;
          IF rezultat NOT IN ('auth_ocupat', 'amanat_lock') THEN
            v_tine := true;                               -- blocul a reușit ⇒ lock-urile lui rămân până la COMMIT ⇒ de aici încolo NOWAIT
          END IF;
        EXCEPTION
          WHEN unique_violation THEN rezultat := 'candidat_ocupat';
          WHEN OTHERS THEN
            RAISE WARNING 'fn_cont_leaga_automat (%): % [%]', r.uemail, SQLERRM, SQLSTATE;
            rezultat := 'eroare';
        END;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
END $fn$;
-- P3 (audit C): fără service_role — poarta e owner, service_role ar fi refuzat oricum.
REVOKE ALL ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cont_leaga_automat(boolean, jsonb) TO authenticated;

-- (c)+(d) B.5b Procesarea cozii (d) — notificări reluabile + contor de amânări cu alertă ----------------------------------------
-- Neschimbat față de r11: identitatea, ordinea lock-urilor (fișă → persoană → profil → intrare), modul fără așteptare (v_tine),
-- backoff / abandon, semantica amanat_lock (intrarea rămâne fără incercari / backoff / notificare de eșec).
-- 20261002b:
--   (c) handlerul de eroare marchează notificat_la DOAR dacă fn_cont_notifica_owneri a acoperit ≥ 1 owner; la abandonare, 0 acoperiți
--       ⇒ notificat_la = NULL; pasul final „reluare notificări” re-trimite anunțul de abandonare pentru intrările deschise, abandonate,
--       cu notificat_la NULL (intrarea luată FOR UPDATE, NOWAIT dacă sweep-ul ține deja lock-uri) — la fiecare rulare, până ajunge.
--   (d) la fiecare amânare (amanat_lock) contorul amanari += 1 pe intrare (FOR UPDATE NOWAIT în subtranzacție proprie: intrarea ținută
--       de altcineva ⇒ WARNING, fără așteptare, fără incrementare — reziduu declarat: contenție persistentă pe însuși rândul cozii ⇒
--       amanat_lock repetat fără incrementare); r2 (P2-4A): la prag (amanari − amanari % 6 > ultima_amanare_alertata) owner-ul e anunțat
--       (cont_inchidere_amanata) și markerul se avansează DOAR după acoperire > 0 (altfel se reîncearcă la următoarea AMÂNARE; r3 — P2-4B:
--       dacă elementul se procesează normal între timp, alerta neacoperită se anulează explicit, amanari_alerta_anulata);
--       r2 (alegerea 1): amanari = amânări CONSECUTIVE — orice procesare non-amanat_lock (succes, rezolvare, eroare cu backoff) pune
--       amanari = 0 și ultima_amanare_alertata = 0; fn_cont_coada_pune le resetează la ciclu nou.
--       Rezultatul sweep-ului capătă cheile 'amanari_alerta', 'amanari_alerta_neacoperita' și 'notificare_reluata' (contoare).
CREATE OR REPLACE FUNCTION public.fn_conturi_inchideri_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_max_incercari constant integer := 8;
  c_prag_amanari  constant integer := 6;   -- 20261002b (P2-4): ~30 min la cron de 5 min
  q        record;
  x        public.conturi_inchideri_coada%ROWTYPE;
  e        record;
  v_rez    text;
  v_garda  text;
  v_set    text;
  v_n      jsonb := '{}'::jsonb;
  v_rezult text;
  v_err    text;
  v_email  text;
  v_k      integer;
  -- r8 (P2 Jakarinos pe b916970): sweep-ul e O tranzacție (SELECT din pg_cron) ⇒ lock-urile elementelor procesate (fișă,
  -- cheile persoanei, profil, intrare) rămân până la COMMIT. Regula r8: sweep-ul AȘTEAPTĂ doar cât timp nu ține nimic de la un
  -- element anterior (v_tine = false); de la al doilea element ținut încolo, toate lock-urile se iau FĂRĂ așteptare
  -- (NOWAIT / pg_try_advisory_xact_lock prin gazpet.cont_lock_nowait) și un 55P03 = „amânat” (amanat_lock): intrarea rămâne
  -- NEATINSĂ (fără incercari / backoff / notificare de eșec) și se procesează la rularea următoare (≤ 5 min).
  v_tine   boolean := false;
  v_amanat boolean;
  v_detail text;
BEGIN
  IF public.fn_identitate_privilegiata() IS NULL THEN
    RAISE EXCEPTION 'Coada închiderilor o procesează doar pg_cron (login postgres) sau o identitate privilegiată explicită'
      USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(format('%I = false', f), ', ') INTO v_set FROM unnest(public.fn_cont_flaguri()) f;
  FOR q IN SELECT c.id, c.profile_id, c.employee_id, c.tip
             FROM public.conturi_inchideri_coada c
            WHERE c.rezolvat_la IS NULL AND c.abandonat_la IS NULL AND c.scadent_la <= CURRENT_DATE
              AND (c.urmatoarea_incercare_la IS NULL OR c.urmatoarea_incercare_la <= now())
            ORDER BY c.id LOOP
    v_rezult := NULL;
    v_garda := NULL;
    v_amanat := false;
    -- r9 (P2-2): modul „fără așteptare” e pus pe TOT elementul (nu doar pe gardă): fn_cont_lock_chei (garda) ȘI fn_cont_inchide
    -- (preblocare NOWAIT a rândurilor scrise: auth.users, module, șantiere, tokens, sesiuni, intrările din coadă) îl citesc.
    PERFORM set_config('gazpet.cont_lock_nowait', CASE WHEN v_tine THEN 'on' ELSE 'off' END, true);
    BEGIN
      IF q.tip <> 'flaguri' AND q.employee_id IS NOT NULL THEN
        -- 0) fișa de angajat (r3, D1 Copilot): aceeași ordine ca un UPDATE HR pe employees (rând → advisory → profil → coadă).
        IF v_tine THEN
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE NOWAIT;
        ELSE
          PERFORM 1 FROM public.employees y WHERE y.id = q.employee_id FOR UPDATE;
        END IF;
        -- 1) persoana (lock până la COMMIT); r8: fără așteptare dacă sweep-ul ține deja lock-uri de la alt element
        v_garda := public.fn_cont_garda_persoana(q.employee_id);
      END IF;
      IF v_tine THEN                                                           -- 2) profilul
        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;   -- 3) intrarea, recitită
      ELSE
        PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE;
      END IF;
      -- (v_tine devine true DOAR la ieșirea normală din bloc — și la CONTINUE: subtranzacția reușită păstrează lock-urile
      --  până la COMMIT; o eroare anulează subtranzacția și le eliberează, deci v_tine rămâne cum era)
      IF NOT FOUND OR x.rezolvat_la IS NOT NULL OR x.abandonat_la IS NOT NULL THEN
        v_tine := true;
        CONTINUE;                                    -- rezolvată între timp (restaurare, închidere manuală, reactivare)
      END IF;
      -- r4 (Copilot pe dac4bda): upsert-ul fn_cont_coada_pune poate retargeta intrarea (employee_id A→B) cât timp sweep-ul
      -- aștepta. Fișa blocată mai sus e A; nu blocăm B DUPĂ coadă (ar inversa ordinea fișă → advisory → profil → coadă).
      IF (x.profile_id, x.employee_id, x.tip) IS DISTINCT FROM (q.profile_id, q.employee_id, q.tip) THEN
        v_tine := true;
        CONTINUE;
      END IF;
      IF x.tip = 'flaguri' THEN
        IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id) THEN
          v_rezult := 'anulat_profil_inexistent';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL)
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.is_owner IS NOT TRUE) THEN
          IF v_set IS NOT NULL THEN
            EXECUTE format('UPDATE public.profiles SET %s WHERE id = $1', v_set) USING x.profile_id;
          END IF;
          v_rezult := 'flaguri_resetate';
        ELSE
          v_rezult := 'anulat_restaurat';
        END IF;
      ELSE
        SELECT y.* INTO e FROM public.employees y WHERE y.id = x.employee_id;   -- recitire după lock (revalidare)
        IF NOT FOUND
           OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.employee_id = x.employee_id)
           OR e.active IS TRUE OR e.termination_date IS NULL THEN
          v_rezult := 'anulat_conditii';
        ELSIF e.termination_date > CURRENT_DATE THEN
          UPDATE public.conturi_inchideri_coada SET scadent_la = e.termination_date WHERE id = x.id;   -- data s-a mutat
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j WHERE j.profile_id = x.profile_id AND j.restaurat_la IS NULL) THEN
          v_rezult := 'deja_inchis';
        ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id
                        AND (p.is_owner IS TRUE OR COALESCE(p.tip_cont, 'angajat') <> 'angajat')) THEN
          v_rezult := 'suspendat_owner_sau_tip_cont';
        ELSIF EXISTS (SELECT 1 FROM public.conturi_inchideri_jurnal j
                       WHERE j.id = public.fn_cont_restaurare_activa(x.profile_id)
                         AND (j.restaurat_la >= x.creat_la OR x.tip = 'reevaluare_istorica')) THEN
          -- restaurare mai nouă decât intrarea: decizia owner-ului rămâne. r10: pentru o REEVALUARE ISTORICĂ restaurarea se respectă
          -- INDIFERENT de creat_la — nu e o plecare nouă a lui B; doar o plecare nouă ('programata') sau închiderea manuală ridică blocajul.
          v_rezult := 'anulat_restaurat';
        ELSIF v_garda IS NOT NULL THEN
          v_rezult := 'suspendat_' || split_part(v_garda, ':', 1);
          PERFORM public.fn_cont_notifica_owneri('cont_inchidere_suspendata', '⏸ Contract încheiat — contul NU s-a închis automat',
            format('%s (fișa #%s %s): %s. Contul rămâne deschis; închide-l manual din Admin → Manageri sau corectează fișa.',
                   (SELECT p.email FROM public.profiles p WHERE p.id = x.profile_id), e.id, e.name, public.fn_cont_motiv_garda(v_garda)),
            '/admin?tab=managers&cont=' || x.profile_id::text);
        ELSE
          v_rez := public.fn_cont_inchide(x.profile_id,
                     format('Contract încheiat la %s (fișa #%s %s) · %s', to_char(e.termination_date, 'DD.MM.YYYY'), e.id, e.name,
                            CASE x.tip WHEN 'programata' THEN 'închidere programată'
                                       WHEN 'reevaluare_istorica' THEN 'fișă istorică a aceleiași persoane (CNP comun), judecată cu garda ei'
                                       ELSE 'reîncercare după eșec' END),
                     'coada_contract_incheiat', e.id);
          v_rezult := v_rez;                                -- fn_cont_inchide a rezolvat deja intrarea
        END IF;
      END IF;
      IF v_rezult IS NOT NULL THEN
        UPDATE public.conturi_inchideri_coada
           SET rezolvat_la = COALESCE(rezolvat_la, now()), rezultat = COALESCE(rezultat, v_rezult), incercari = incercari + 1
         WHERE id = x.id;
        v_n := jsonb_set(v_n, ARRAY[v_rezult], to_jsonb(COALESCE((v_n ->> v_rezult)::int, 0) + 1));
      END IF;
      IF x.amanari > 0 OR x.ultima_amanare_alertata > 0 THEN
        -- 20261002b (P2-4, r2: amânări CONSECUTIVE): orice procesare non-amanat_lock (rezolvare sau rămas deschis) închide seria.
        -- r3 (P2-4B, politică operațională): o alertă de prag încă neacoperită (prag > marker) se ANULEAZĂ explicit aici — alerta e
        -- relevantă doar cât timp contenția continuă; elementul tocmai s-a procesat normal (contorizat: amanari_alerta_anulata).
        IF x.amanari - x.amanari % c_prag_amanari > x.ultima_amanare_alertata THEN
          v_n := jsonb_set(v_n, ARRAY['amanari_alerta_anulata'], to_jsonb(COALESCE((v_n ->> 'amanari_alerta_anulata')::int, 0) + 1));
        END IF;
        UPDATE public.conturi_inchideri_coada SET amanari = 0, ultima_amanare_alertata = 0 WHERE id = x.id;
      END IF;
      v_tine := true;
    EXCEPTION WHEN OTHERS THEN
      -- r8 (P2): 55P03 primit cât timp sweep-ul ținea lock-uri de la alt element = contenție, nu eșec: intrarea rămâne
      -- neatinsă (fără incercari / backoff / notificare), se reia la rularea următoare.
      -- r10 (blocant d): rândul din auth.users ținut de GoTrue (fn_cont_inchide: 55P03 cu DETAIL 'auth_ocupat') = retragere și pe
      -- PRIMUL element (v_tine = false); elementul se reia la rularea următoare (amanat_lock), nu intră în backoff.
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      IF SQLSTATE = '55P03' AND (v_tine OR v_detail = 'auth_ocupat') THEN
        v_amanat := true;
        v_n := jsonb_set(v_n, ARRAY['amanat_lock'], to_jsonb(COALESCE((v_n ->> 'amanat_lock')::int, 0) + 1));
        -- 20261002b (P2-4): contorul de amânări pe intrare + alertă după prag. Subtranzacția elementului s-a anulat (nimic ținut de la
        -- el); intrarea se ia FĂRĂ așteptare (altcineva o ține ⇒ fără incrementare la rularea asta — nu se așteaptă niciodată aici).
        -- Dacă blocul reușește, intrarea rămâne ținută până la COMMIT ⇒ v_tine := true (regula r9 P2-3).
        BEGIN
          PERFORM 1 FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;
          UPDATE public.conturi_inchideri_coada
             SET amanari = amanari + 1
           WHERE id = q.id AND rezolvat_la IS NULL
             AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)   -- (r5: doar intrarea pe care a lucrat)
          RETURNING * INTO x;
          v_tine := true;
          -- r2 (P2-4A): pragul curent = amanari − amanari % 6 (6, 12, …); alerta se încearcă la FIECARE rulare cât timp pragul > marker
          -- (ultima_amanare_alertata) și se marchează DOAR dacă notificatorul a acoperit ≥ 1 owner — o alertă neacoperită nu se pierde.
          IF FOUND AND x.amanari - x.amanari % c_prag_amanari > x.ultima_amanare_alertata THEN
            v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
            v_k := public.fn_cont_notifica_owneri('cont_inchidere_amanata', '⏳ Închiderea automată a contului e amânată repetat',
              format('%s (coada #%s, %s): amânată de %s ori la rând (~%s min) — altă operație ținea fișa, contul de logare sau cheile persoanei de fiecare dată; coada reîncearcă la fiecare rulare. Verifică dacă există o tranzacție blocată (HR / GoTrue) sau închide contul manual (Admin → Manageri).',
                     v_email, x.id, x.tip, x.amanari, x.amanari * 5),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            IF v_k > 0 THEN
              UPDATE public.conturi_inchideri_coada SET ultima_amanare_alertata = x.amanari - x.amanari % c_prag_amanari WHERE id = q.id;
              v_n := jsonb_set(v_n, ARRAY['amanari_alerta'], to_jsonb(COALESCE((v_n ->> 'amanari_alerta')::int, 0) + 1));
            ELSE
              v_n := jsonb_set(v_n, ARRAY['amanari_alerta_neacoperita'], to_jsonb(COALESCE((v_n ->> 'amanari_alerta_neacoperita')::int, 0) + 1));
            END IF;
          END IF;
        EXCEPTION WHEN lock_not_available THEN
          RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): intrarea e ținută de altă tranzacție — contorul de amânări nu se incrementează la rularea asta', q.id;
        END;
      END IF;
      IF NOT v_amanat THEN
      v_err := SQLERRM;
      v_n := jsonb_set(v_n, ARRAY['eroare'], to_jsonb(COALESCE((v_n ->> 'eroare')::int, 0) + 1));
      BEGIN
        -- subtranzacția anulată a eliberat lock-urile din bloc → aceeași ordine: profil, apoi intrarea
        -- (r8: fără așteptare dacă se țin lock-uri de la alt element; 55P03 aici ⇒ doar WARNING, backoff-ul se face la rularea următoare)
        -- r9 (P2-3): și intrarea se preblochează NOWAIT când se țin lock-uri anterioare; dacă blocul reușește, lock-urile lui
        -- (profil + intrare) rămân până la COMMIT ⇒ v_tine := true la final.
        IF v_tine THEN
          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE NOWAIT;
          PERFORM 1 FROM public.conturi_inchideri_coada c WHERE c.id = q.id FOR UPDATE NOWAIT;
        ELSE
          PERFORM 1 FROM public.profiles p WHERE p.id = q.profile_id FOR UPDATE;
        END IF;
        UPDATE public.conturi_inchideri_coada
           SET incercari = incercari + 1, ultima_eroare = v_err,
               urmatoarea_incercare_la = now() + least(interval '5 minutes' * power(2, incercari), interval '6 hours'),
               abandonat_la = CASE WHEN incercari + 1 >= c_max_incercari THEN now() END,
               amanari = 0, ultima_amanare_alertata = 0   -- 20261002b r2: eroarea (procesare non-amanat_lock) închide seria de amânări
         WHERE id = q.id AND rezolvat_la IS NULL
           -- r5 (D-ERR-IDENTITY): backoff / abandon / notificare DOAR pe intrarea pe care a lucrat sweep-ul; una retargetată
           -- între timp (fn_cont_coada_pune: employee_id A→B) nu primește eroarea altei fișe ⇒ NOT FOUND, nimic de făcut
           AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)
        RETURNING * INTO x;
        IF FOUND THEN
          v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
          IF x.abandonat_la IS NOT NULL THEN
            -- 20261002b (P2-3): anunțul de abandonare e marcat DOAR dacă a acoperit ≥ 1 owner; altfel notificat_la = NULL ⇒ pasul
            -- „reluare notificări” îl re-trimite la rulările următoare (intrarea abandonată nu mai trece prin bucla principală)
            v_k := public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
              format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                     v_email, x.id, x.tip, x.incercari, v_err),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            UPDATE public.conturi_inchideri_coada SET notificat_la = CASE WHEN v_k > 0 THEN now() END WHERE id = q.id;
          ELSIF x.notificat_la IS NULL THEN
            v_k := public.fn_cont_notifica_owneri('cont_inchidere_esuata', '❌ Închiderea automată a contului a eșuat',
              format('%s (coada #%s, %s): %s · se reîncearcă automat (încercarea %s din %s; următoarea după %s)',
                     v_email, x.id, x.tip, v_err, x.incercari, c_max_incercari,
                     to_char(x.urmatoarea_incercare_la AT TIME ZONE 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')),
              '/admin?tab=managers&cont=' || q.profile_id::text);
            -- 20261002b (P2-3): 0 owneri acoperiți (toți ținuți FOR UPDATE) ⇒ intrarea rămâne „neanunțată” și se anunță la eroarea următoare
            IF v_k > 0 THEN
              UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = q.id;
            END IF;
          END IF;
        END IF;
        v_tine := true;   -- r9 (P2-3): blocul a reușit ⇒ profilul + intrarea rămân ținute până la COMMIT ⇒ de aici încolo NOWAIT
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): % [%] · eroarea inițială: %', q.id, SQLERRM, SQLSTATE, v_err;
      END;
      END IF;   -- NOT v_amanat
    END;
  END LOOP;
  -- 20261002b (P2-3): reluarea anunțului de abandonare pentru intrările deschise, abandonate, încă neanunțate (0 owneri acoperiți la
  -- abandonare). Aceeași regulă de așteptare ca bucla principală: FOR UPDATE NOWAIT dacă se țin lock-uri; blocul reușit ⇒ v_tine.
  FOR q IN SELECT c.id, c.profile_id, c.employee_id, c.tip
             FROM public.conturi_inchideri_coada c
            WHERE c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL
            ORDER BY c.id LOOP
    BEGIN
      IF v_tine THEN
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id AND c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL FOR UPDATE NOWAIT;
      ELSE
        SELECT c.* INTO x FROM public.conturi_inchideri_coada c WHERE c.id = q.id AND c.rezolvat_la IS NULL AND c.abandonat_la IS NOT NULL AND c.notificat_la IS NULL FOR UPDATE;
      END IF;
      IF FOUND THEN
        v_tine := true;
        v_email := (SELECT p.email FROM public.profiles p WHERE p.id = x.profile_id);
        v_k := public.fn_cont_notifica_owneri('cont_inchidere_abandonata', '⛔ Închiderea automată a contului s-a oprit',
          format('%s (coada #%s, %s): %s încercări eșuate, ultima: %s · coada NU mai reîncearcă — elimină cauza și închide contul manual (Admin → Manageri)',
                 v_email, x.id, x.tip, x.incercari, x.ultima_eroare),
          '/admin?tab=managers&cont=' || x.profile_id::text);
        IF v_k > 0 THEN
          UPDATE public.conturi_inchideri_coada SET notificat_la = now() WHERE id = x.id;
          v_n := jsonb_set(v_n, ARRAY['notificare_reluata'], to_jsonb(COALESCE((v_n ->> 'notificare_reluata')::int, 0) + 1));
        END IF;
      END IF;
    EXCEPTION WHEN lock_not_available THEN
      RAISE WARNING 'fn_conturi_inchideri_sweep (coada #%): intrarea abandonată e ținută de altă tranzacție — anunțul se reia la rularea următoare', q.id;
    END;
  END LOOP;
  PERFORM set_config('gazpet.cont_lock_nowait', 'off', true);
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.fn_conturi_inchideri_sweep() FROM PUBLIC, anon, authenticated, service_role;

-- ── Postcondiții — orice abatere anulează tot ────────────────────────────────────────────
DO $post_livrare$
DECLARE v_lipsa text[]; v_tip text;
BEGIN
  -- funcțiile înlocuite au EXACT amprenta acestei migrări (semnătură unică, md5, SECURITY DEFINER, proconfig, owner, ACL neschimbat)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       'f969f77614176d63341f69e1909c11f1',    '{postgres=X/postgres}'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '526b9a2c30d4d70df3d94928e597de17', '{postgres=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4',       '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce',       '{postgres=X/postgres}'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres'
                        AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: amprentă diferită (semnătură/md5/secdef/proconfig/owner/ACL): %', v_lipsa; END IF;
  SELECT array_agg(p.proname::text) INTO v_lipsa FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = ANY(ARRAY['fn_cont_notifica_owneri','fn_cont_serializare_activa','fn_cont_revalideaza_candidat','fn_cont_leaga_automat','fn_cont_coada_pune','fn_conturi_inchideri_sweep']::text[])
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Postcondiție: funcții executabile de anon: %', v_lipsa; END IF;
  -- (b) garda nouă trece pe triggerele live ale lui d (altfel legarea ar refuza cu serializare_indisponibila după livrare)
  IF NOT public.fn_cont_serializare_activa() THEN
    RAISE EXCEPTION 'Postcondiție: fn_cont_serializare_activa() = false după înlocuire — triggerele lui d nu au forma așteptată';
  END IF;
  -- (d) coloanele contorului și ale markerului de alertă
  FOR v_tip IN SELECT c || ': ' || COALESCE((SELECT format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END || ' default ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '-')
                                               FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                                              WHERE a.attrelid = 'public.conturi_inchideri_coada'::regclass AND a.attname = c AND NOT a.attisdropped), 'absent')
                 FROM unnest(ARRAY['amanari', 'ultima_amanare_alertata']) c LOOP
    IF split_part(v_tip, ': ', 2) IS DISTINCT FROM 'integer not null default 0' THEN
      RAISE EXCEPTION 'Postcondiție: conturi_inchideri_coada.% lipsește sau are altă definiție', v_tip;
    END IF;
  END LOOP;
  -- tabela cozii rămâne cu RLS și fără drepturi pentru anon (coloana nouă nu schimbă nimic, dar se verifică)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conturi_inchideri_coada'::regclass)
     OR has_table_privilege('anon', 'public.conturi_inchideri_coada', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'Postcondiție: conturi_inchideri_coada fără RLS sau cu drepturi pentru anon';
  END IF;
END $post_livrare$;

DO $livrare_final$
BEGIN
  IF current_setting('gazpet.livrare_migrare', true) IS DISTINCT FROM '20261002b_conturi_p2_followup:' || txid_current() THEN
    RAISE EXCEPTION 'Livrare 20261002b: garda de livrare (final) — marcajul s-a pierdut în timpul migrării; se anulează tot';
  END IF;
END $livrare_final$;
```

## Revenirea r3 (`supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql`) — antetul și gărzile; corpurile funcțiilor sunt copia verbatim a liniilor c 429-456 / 341-356 / 590-654 / 800-893 și d 245-260 / 1061-1259
```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 20261002b_conturi_p2_followup_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
-- LIVE r11 a pachetului Conturi (c v20261001230000 / d v20261001231500): cele 5 funcții înlocuite de 20261002b revin VERBATIM la
-- corpurile din 20260929c / 20260929d (md5 prosrc: fn_cont_notifica_owneri 0bbbf41d…, fn_cont_serializare_activa 8327108d…,
-- fn_cont_revalideaza_candidat 7bb0d97e…, fn_cont_leaga_automat 349f5402…, fn_cont_coada_pune 890a0025…, fn_conturi_inchideri_sweep
-- 7bc5ddf2…) și coloanele conturi_inchideri_coada.amanari / ultima_amanare_alertata dispar (contorul de amânări se pierde — doar diagnostic). REDESCHIDE cele 4 P2 (risc documentat
-- pe #529, r11). Fără GO de execuție: doar la cererea explicită a lui Răzvan, după decizie + review Copilot. Armarea nu e autorizare.
-- Procedura (un singur string; fișierul nu conține BEGIN/COMMIT):
--   BEGIN;
--   SELECT set_config('gazpet.rollback_tehnic_20261002b', 'REVINE_P2_FOLLOWUP:' || txid_current(), true);
--   -- <conținutul exact al fișierului>
--   COMMIT;
-- harness-armare: gazpet.rollback_tehnic_20261002b REVINE_P2_FOLLOWUP
-- ════════════════════════════════════════════════════════════════════════════
DO $arm$
DECLARE v_lipsa text[];
BEGIN
  IF current_setting('gazpet.rollback_tehnic_20261002b', true) IS DISTINCT FROM 'REVINE_P2_FOLLOWUP:' || txid_current() THEN
    RAISE EXCEPTION 'Revenire 20261002b: nearmată (gazpet.rollback_tehnic_20261002b legat de txid_current) — refuz';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE lower(c) LIKE 'gazpet.rollback_tehnic_20261002b=%') THEN
    RAISE EXCEPTION 'Revenire 20261002b: armare persistentă (ALTER DATABASE/ROLE SET) — refuz';
  END IF;
  IF current_user IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Revenire 20261002b: rulează ca postgres (current_user = %)', current_user;
  END IF;
  -- precondiție: starea e EXACT cea a lui 20261002b (md5 propriu pe toate cele 5 funcții + coloana amanari)
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       'f969f77614176d63341f69e1909c11f1'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '526b9a2c30d4d70df3d94928e597de17'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m)
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m);
  IF v_lipsa IS NOT NULL THEN
    RAISE EXCEPTION 'Revenire 20261002b: precondiție — funcțiile nu sunt varianta 20261002b (md5): %', v_lipsa;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.conturi_inchideri_coada'::regclass AND attname IN ('amanari', 'ultima_amanare_alertata') AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'Revenire 20261002b: precondiție — coloanele conturi_inchideri_coada.amanari / ultima_amanare_alertata lipsesc';
  END IF;
END $arm$;

-- ── c, A.3: fn_cont_notifica_owneri — VERBATIM din 20260929c (liniile 429-456) ──
-- … (corpurile verbatim r11 ale celor 6 funcții) …
ALTER TABLE public.conturi_inchideri_coada DROP COLUMN IF EXISTS amanari;
ALTER TABLE public.conturi_inchideri_coada DROP COLUMN IF EXISTS ultima_amanare_alertata;

-- ── Postcondiție: EXACT starea live r11 (md5 c/d, ACL-uri neschimbate), fără coloană; apoi dezarmare ──
DO $post$
DECLARE v_lipsa text[];
BEGIN
  SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
    FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       '0bbbf41d3097840c16a97a263ff4cd5f', '{postgres=X/postgres}'),
                 ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '8327108ddc25b66c312b7ba82e3a83b2', '{postgres=X/postgres}'),
                 ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', '{postgres=X/postgres}'),
                 ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               '349f540203eeb73639c4cfa4316a8cd6', '{postgres=X/postgres,authenticated=X/postgres}'),
                 ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', '890a0025f513ca02ac9276cd4a360afb', '{postgres=X/postgres}'),
                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       '7bc5ddf2f4097525e6c24f499a8fb5e7', '{postgres=X/postgres}')) AS w(f, sig, m, acl)
   WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
      OR NOT EXISTS (SELECT 1 FROM pg_proc p
                      WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
                        AND p.proconfig::text = '{"search_path=public, pg_temp"}'
                        AND pg_get_userbyid(p.proowner)::text = 'postgres' AND p.proacl::text = w.acl);
  IF v_lipsa IS NOT NULL THEN RAISE EXCEPTION 'Revenire 20261002b: postcondiție — amprenta nu e cea live r11: %', v_lipsa; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.conturi_inchideri_coada'::regclass AND attname IN ('amanari', 'ultima_amanare_alertata') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Revenire 20261002b: postcondiție — coloanele amanari / ultima_amanare_alertata au rămas';
  END IF;
  PERFORM set_config('gazpet.rollback_tehnic_20261002b', '', true);
END $post$;

```


# r4 (02.10.2026) — după GO STATIC Copilot pe r3 `61798922…` (P2-4B închis, fără blocant funcțional): DOAR corecturi editoriale

**context_version:** branch `claude/529-p2-followup`, PR #576, commit r4 = commit-ul care conține această secțiune (următorul după `2666d04` pe branch) (părinte r3 `2666d04`); generated_at 2026-10-02. **Pe live NIMIC** (doar preflight read-only, mai jos). **Nicio schimbare de logică**: diff-ul r3→r4 pe `supabase/` conține exclusiv comentarii, `COMMENT ON COLUMN` și constantele md5 ale sweep-ului (schimbat de comentariul din corpul funcției).

| Corectură cerută | Făcută |
|---|---|
| `COMMENT ON COLUMN … ultima_amanare_alertata` („reîncearcă la fiecare rulare”) | → „cât timp contenția continuă și pragul curent > marker, alerta se reîncearcă la fiecare amânare; la procesare normală, alerta pending se anulează și seria se resetează (r3)” |
| comentariul intern din sweep („la FIECARE rulare cât timp pragul > marker”) | → „la fiecare AMÂNARE cât timp contenția continuă și pragul > marker … r3: la procesare normală alerta neacoperită se anulează explicit”; + antetul migrării („amânările 7, 8… cât timp contenția continuă”). md5 sweep `ee501560…` → **`facbcd2b4059a16b24f95674b0986ad2`** (precondiție m_nou / postcondiție / revenire / docs actualizate) |
| revenire: „cele 5 funcții” | → „cele 6 funcții … (r2: + fn_cont_coada_pune)”, „coloanele amanari / ultima_amanare_alertata” |
| antet delta r3 | → `commit r3 2666d04 (părinte r2 5a58f86, r1 b126b50)` |

## Fișiere (r4)
| Fișier | sha256 |
|---|---|
| `supabase/migrations/20261002b_conturi_p2_followup.sql` | `6e0a1fb0408cd368a1de0ad867f55096d9ac600b71cbedfbfe5805dfaa6751fb` |
| `supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql` | `3b20a51f1dbd65b22d1e6de9ce81335f99619295642004b0e5cd886703210997` |

## Verificări (r4)
- harness PG16 `--reaplica --rollback`: **1990 aserțiuni PASS** (după migrare: 652, după reaplicare: 652, după rollback, doar BAZĂ: 26, după rollback + reaplicare: 652; rollback pas cu pas inclusiv revenirea = schema de după 20260929e, schema finală = cea dinainte).
- Validator `scripts/livrare_validator.py`: OK. `npx vite build`: OK. Mutanții (6) nu au fost rerulați: r4 nu schimbă logica (diff-ul de mai jos).

## Preflight READ-ONLY pe live (02.10.2026, MCP execute_sql, doar SELECT)
| Control | Rezultat live | Așteptat |
|---|---|---|
| md5 `fn_cont_coada_pune` | `890a0025f513ca02ac9276cd4a360afb` | = r11 ✔ |
| md5 `fn_conturi_inchideri_sweep` | `7bc5ddf2f4097525e6c24f499a8fb5e7` | = r11 ✔ |
| md5 `fn_cont_notifica_owneri` | `0bbbf41d3097840c16a97a263ff4cd5f` | = r11 ✔ |
| md5 `fn_cont_serializare_activa` | `8327108ddc25b66c312b7ba82e3a83b2` | = r11 ✔ |
| md5 `fn_cont_revalideaza_candidat` | `7bb0d97ed57bfef1c4555fbf94629071` | = r11 ✔ |
| md5 `fn_cont_leaga_automat` | `349f540203eeb73639c4cfa4316a8cd6` | = r11 ✔ |
| `fn_cont_serializare_activa()` | `true` | true ✔ |
| coloane `amanari` / `ultima_amanare_alertata` pe `conturi_inchideri_coada` | absente (NULL) | absente ✔ |
| coada: intrări deschise / abandonate | 0 / 0 | — |
| ultima versiune `schema_migrations` | `20261002090000` | versiunea follow-up-ului trebuie să fie > 20261002090000 |

## Diff r3 → r4 pe `supabase/` (doar comentarii / COMMENT ON / md5)
```diff
diff --git a/supabase/migrations/20261002b_conturi_p2_followup.sql b/supabase/migrations/20261002b_conturi_p2_followup.sql
index 62abb11..6ccdd6c 100644
--- a/supabase/migrations/20261002b_conturi_p2_followup.sql
+++ b/supabase/migrations/20261002b_conturi_p2_followup.sql
@@ -39,7 +39,7 @@
 --   (d, P2-4A) alerta de prag folosea doar amanari % 6 = 0 și ignora acoperirea ⇒ la amânarea 6 cu toți ownerii ținuți alerta se pierdea
 --       definitiv. Fix: marker durabil conturi_inchideri_coada.ultima_amanare_alertata integer NOT NULL DEFAULT 0 (coloană nouă, aditivă):
 --       bucket-ul (6, 12, …) = amanari − amanari % 6; cât timp CONTENȚIA CONTINUĂ alerta se încearcă la fiecare amânare (bucket > marker)
---       și se marchează DOAR după acoperire > 0 (rulările 7, 8… continuă să încerce bucket-ul 6).
+--       și se marchează DOAR după acoperire > 0 (amânările 7, 8… continuă să încerce bucket-ul 6 cât timp contenția continuă).
 --   r3 (P2-4B, politică operațională simplă — decizia sesiunii principale): alerta de amânări e relevantă DOAR cât timp contenția
 --       continuă; dacă următoarea rulare procesează elementul normal, o alertă încă neacoperită se ANULEAZĂ explicit (reset contor +
 --       marker, rezultat amanari_alerta_anulata) — NU „se reîncearcă până ajunge”. Pe calea de eroare (backoff) resetul e tăcut
@@ -91,7 +91,7 @@ BEGIN
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', '7bb0d97ed57bfef1c4555fbf94629071', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',           '349f540203eeb73639c4cfa4316a8cd6', 'a32cb851d317d273feee8e975eba66a4'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', '890a0025f513ca02ac9276cd4a360afb', 'b1c2b93cbe3b9560bcb38d460c717fce'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', 'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m_live, m_nou)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                   '7bc5ddf2f4097525e6c24f499a8fb5e7', 'facbcd2b4059a16b24f95674b0986ad2')) AS w(f, sig, m_live, m_nou)
    WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) IN (w.m_live, w.m_nou) AND p.prosecdef
@@ -135,7 +135,7 @@ ALTER TABLE public.conturi_inchideri_coada ADD COLUMN IF NOT EXISTS ultima_amana
 COMMENT ON COLUMN public.conturi_inchideri_coada.amanari IS
   'P2-4 (20261002b): de câte ori LA RÂND (consecutiv) sweep-ul a amânat intrarea din contenție (amanat_lock). Se resetează la orice procesare non-amanat_lock și la ciclu nou (fn_cont_coada_pune). Owner-ul e anunțat (cont_inchidere_amanata) la pragurile 6, 12, … (ultima_amanare_alertata).';
 COMMENT ON COLUMN public.conturi_inchideri_coada.ultima_amanare_alertata IS
-  'P2-4A (20261002b r2): ultimul prag de amânări (6, 12, …) pentru care alerta cont_inchidere_amanata a ACOPERIT ≥ 1 owner; cât timp pragul curent > marker, sweep-ul reîncearcă alerta la fiecare rulare. Se resetează odată cu amanari.';
+  'P2-4A (20261002b r2): ultimul prag de amânări (6, 12, …) pentru care alerta cont_inchidere_amanata a ACOPERIT ≥ 1 owner; cât timp contenția continuă și pragul curent > marker, alerta se reîncearcă la fiecare amânare; la procesare normală, alerta pending se anulează și seria se resetează (r3). Se resetează odată cu amanari.';
 
 -- (d, P2-3A) B.2b fn_cont_coada_pune — ultima_eroare separată semantic de notificat_la --------------------------------------------
 -- r11: notificat_la = now() când p_eroare nu era NULL („apelantul tocmai a anunțat owner-ul”) — dar anunțul triggerului e best-effort
@@ -593,8 +593,9 @@ BEGIN
              AND (profile_id, employee_id, tip) IS NOT DISTINCT FROM (q.profile_id, q.employee_id, q.tip)   -- (r5: doar intrarea pe care a lucrat)
           RETURNING * INTO x;
           v_tine := true;
-          -- r2 (P2-4A): pragul curent = amanari − amanari % 6 (6, 12, …); alerta se încearcă la FIECARE rulare cât timp pragul > marker
-          -- (ultima_amanare_alertata) și se marchează DOAR dacă notificatorul a acoperit ≥ 1 owner — o alertă neacoperită nu se pierde.
+          -- r2 (P2-4A): pragul curent = amanari − amanari % 6 (6, 12, …); alerta se încearcă la fiecare AMÂNARE cât timp contenția continuă
+          -- și pragul > marker (ultima_amanare_alertata) și se marchează DOAR dacă notificatorul a acoperit ≥ 1 owner; r3 (P2-4B): dacă
+          -- elementul se procesează normal între timp, alerta neacoperită se anulează explicit (calea normală, amanari_alerta_anulata).
           IF FOUND AND x.amanari - x.amanari % c_prag_amanari > x.ultima_amanare_alertata THEN
             v_email := (SELECT p.email FROM public.profiles p WHERE p.id = q.profile_id);
             v_k := public.fn_cont_notifica_owneri('cont_inchidere_amanata', '⏳ Închiderea automată a contului e amânată repetat',
@@ -709,7 +710,7 @@ BEGIN
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419', '{postgres=X/postgres}'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4',       '{postgres=X/postgres,authenticated=X/postgres}'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce',       '{postgres=X/postgres}'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'facbcd2b4059a16b24f95674b0986ad2',       '{postgres=X/postgres}')) AS w(f, sig, m, acl)
    WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = w.f) IS DISTINCT FROM 1
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m AND p.prosecdef
diff --git a/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql b/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
index b315298..636c356 100644
--- a/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
+++ b/supabase/revenire/20261002b_conturi_p2_followup_ROLLBACK.sql
@@ -1,6 +1,6 @@
 -- ════════════════════════════════════════════════════════════════════════════
 -- 20261002b_conturi_p2_followup_ROLLBACK — NU e migrare (niciun runner nu parcurge supabase/revenire/). Readuce EXACT starea
--- LIVE r11 a pachetului Conturi (c v20261001230000 / d v20261001231500): cele 5 funcții înlocuite de 20261002b revin VERBATIM la
+-- LIVE r11 a pachetului Conturi (c v20261001230000 / d v20261001231500): cele 6 funcții înlocuite de 20261002b (r2: + fn_cont_coada_pune) revin VERBATIM la
 -- corpurile din 20260929c / 20260929d (md5 prosrc: fn_cont_notifica_owneri 0bbbf41d…, fn_cont_serializare_activa 8327108d…,
 -- fn_cont_revalideaza_candidat 7bb0d97e…, fn_cont_leaga_automat 349f5402…, fn_cont_coada_pune 890a0025…, fn_conturi_inchideri_sweep
 -- 7bc5ddf2…) și coloanele conturi_inchideri_coada.amanari / ultima_amanare_alertata dispar (contorul de amânări se pierde — doar diagnostic). REDESCHIDE cele 4 P2 (risc documentat
@@ -24,14 +24,14 @@ BEGIN
   IF current_user IS DISTINCT FROM 'postgres' THEN
     RAISE EXCEPTION 'Revenire 20261002b: rulează ca postgres (current_user = %)', current_user;
   END IF;
-  -- precondiție: starea e EXACT cea a lui 20261002b (md5 propriu pe toate cele 5 funcții + coloana amanari)
+  -- precondiție: starea e EXACT cea a lui 20261002b (md5 propriu pe toate cele 6 funcții + coloanele amanari / ultima_amanare_alertata)
   SELECT array_agg(w.f ORDER BY w.f) INTO v_lipsa
     FROM (VALUES ('fn_cont_notifica_owneri',      'fn_cont_notifica_owneri(text,text,text,text)',       'f969f77614176d63341f69e1909c11f1'),
                  ('fn_cont_serializare_activa',   'fn_cont_serializare_activa()',                       '526b9a2c30d4d70df3d94928e597de17'),
                  ('fn_cont_revalideaza_candidat', 'fn_cont_revalideaza_candidat(uuid,integer,boolean)', 'ecbbd64ceffd6ed13ed91a04f6f14419'),
                  ('fn_cont_leaga_automat',        'fn_cont_leaga_automat(boolean,jsonb)',               'a32cb851d317d273feee8e975eba66a4'),
                  ('fn_cont_coada_pune',           'fn_cont_coada_pune(uuid,integer,text,text,date,text)', 'b1c2b93cbe3b9560bcb38d460c717fce'),
-                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'ee5015604d7a6dc0ab46d4ca4e5a8741')) AS w(f, sig, m)
+                 ('fn_conturi_inchideri_sweep',   'fn_conturi_inchideri_sweep()',                       'facbcd2b4059a16b24f95674b0986ad2')) AS w(f, sig, m)
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || w.sig) AND md5(p.prosrc) = w.m);
   IF v_lipsa IS NOT NULL THEN
     RAISE EXCEPTION 'Revenire 20261002b: precondiție — funcțiile nu sunt varianta 20261002b (md5): %', v_lipsa;
```
