# Corpus CNSC — paginile citatelor și controlul judiciar la cele 8 decizii din testul Răcari (propunere de date, fără scriere în BD)

> 19.10.2026 · sesiunea de cercetare juridic-normativă, la cererea sesiunii de chat (după `TEST_B_LICITATIE_15.md`, #788). Doar SELECT pe `cnsc_decizii`. Nimic nu se scrie fără „da” de la Răzvan.

## 1. Corectură: cele 8 decizii AU pagina la citate

`TEST_B_LICITATIE_15.md` §4 spune că „citatele n-au pagina (`[p.?]`) pentru toate cele 8 decizii” și că „`control_judiciar` e necompletat la toate cele 8”. În BD, la 19.10.2026, **toate cele 8 au `loc` cu pagină** în `citate_cheie` (format `p. N (din M)`), deci `formatCitare` le exportă. `[p.?]` a venit din modul în care au fost citite în test, nu din corpus. Controlul judiciar e completat (căutat, fără plângere găsită → `necunoscut`) la 3 din 8 și `NULL` (= neverificat, niciodată căutat) la 5.

Citările gata de folosit, în formatul unic din spec §3 (nr. exact + dată → „Decizia CNSC nr. …”; altfel „publicată în BO nr. …”), cu link-urile din `link_sursa`:

| Decizie | Citare (formatul §3) | Citat 1 | Citat 2 | Control judiciar azi |
|---|---|---|---|---|
| BO2024_2683 | `Decizia CNSC nr. 2683/C1/2979 din 23.09.2024, p. 19 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=NTEzZTU1MzgtOTU3Zi00NWJlLWJlYjItYjk5MGEyZGVmODQw&pdfa1=ZmFsc2U=&filename=Qk8yMDI0XzI2ODMucGRm&action=aW5saW5l` | p. 19: „Cerințele suplimentare ca managerul de proiect să dețină certificări emise de ANRE” | p. 18: „ponderea alocată factorului preț nu poate fi mai mare de 40%” | `necunoscut` (căutat: Diversinst c. Comuna Malu Mare, fără plângere; dosarele 510/511/57/2025 CA Alba Iulia sunt altă decizie) |
| BO2024_1870 | `Decizia CNSC publicată în BO nr. BO2024_1870 (nr./data anonimizate), p. 13 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=ZDA4ZDhhMDAtMTg3Zi00Mjg4LWI1ZjYtYjI2ZWY3MDMxNTRj&pdfa1=ZmFsc2U=&filename=Qk8yMDI0XzE4NzAucGRm&action=aW5saW5l` | p. 13: „practic dublează cerințele de calificare și limitează numărul de posibili participanți” | p. 11: „nici ofertele nu pot fi detaliate la nivel de articol de deviz” | `necunoscut` (căutat: decizia 1870 din 05.07.2024, dosar 1810/2024, Bedamiro c. Comuna Luciu; fără plângere) |
| BO2026_2328 | `Decizia CNSC nr. 2328/C5/1924 din 17.07.2026, p. 15 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=MmFiMzg0N2UtMzM5Mi00OGVlLTg0YmQtMjc5MWU0OGRkMjVl&pdfa1=ZmFsc2U=&filename=Qk8yMDI2XzIzMjgucGRm&action=aW5saW5l` | p. 15: „Comisia de evaluare nu poate respinge o ofertă în baza unei recomandări menționate în cadrul caietului de sarcini” | p. 15: „autoritatea contractantă nu poate introduce mascat cerințe de calificare și selecție în cadrul caietului de sarcini” | `necunoscut` (căutat: Teoval & Co c. Comuna Belcești; fără plângere — decizie recentă, de recăutat în 2027) |
| BO2026_3104 | `Decizia CNSC publicată în BO nr. BO2026_3104 (nr./data anonimizate), p. 13 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=ZWJkNmFlNDEtODg3OS00MjJiLTg4MzEtM2U1N2NjZDg0M2Ey&pdfa1=ZmFsc2U=&filename=Qk8yMDI2XzMxMDQucGRm&action=aW5saW5l` | p. 13: „reducerea cu 25% neputând fi justificată printr-o anumită asimilare a normelor de deviz” | p. 13: „va dispune reevaluarea ofertei câștigătoare prin verificarea conformității propunerii tehnice cu listele de cantități publicate în SEAP” | `NULL` (necăutat) |
| BO2021_1060 | `Decizia CNSC publicată în BO nr. BO2021_1060 (nr./data anonimizate), p. 46 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=YjY4MWE4OTMtMDEwOS00OTdlLWIzMzYtYmZjMmEwNjg0ZGY3&pdfa1=ZmFsc2U=&filename=Qk8yMDIxXzEwNjAucGRm&action=aW5saW5l` | p. 46: „prin demersul făcut comisia de evaluare a avantajat ofertantul care ulterior a fost declarat câștigător” | p. 48: „au fost aduse modificări valorii totale a propunerii financiare, respectiv o majorare a prețului total cu 0,97% și de 21,47% la cazul rândului 7” | `NULL` |
| BO2025_1138 | `Decizia CNSC publicată în BO nr. BO2025_1138 (nr./data anonimizate), p. 97 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=ZDYyZDA5ZTEtNDkwMy00ZDNjLTkxNjgtYjE4ZDQyMDZlNDMx&pdfa1=ZmFsc2U%3D&filename=Qk8yMDI1XzExMzgucGRm&action=aW5saW5l` | p. 97: „prețurile unitare ale furnizorilor nu sunt elemente pur formale ale ofertei” | p. 69: „prin luarea în considerare a valorii integrale a contractelor prezentate, inclusiv a studiilor de teren aferente fazei SF” | `NULL` |
| BO2025_286 | `Decizia CNSC nr. 286/C11/31 din 07.02.2025, p. 59 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=NGRjMzRjNDQtNmY4Ny00YzJiLWFkZDQtZWVkMDE2ZjZhZjVk&pdfa1=ZmFsc2U%3D&filename=Qk8yMDI1XzI4Ni5wZGY%3D&action=aW5saW5l` | p. 59: „termene de 1 zi lucrătoare pentru studiu al documentației de atribuire și înaintare solicitări de clarificări” | p. 60: „singura măsură ce poate fi adoptata ca remediu la încălcările legale constatate este anularea întregii proceduri de atribuire” | `NULL` |
| BO2023_1128 | `Decizia CNSC publicată în BO nr. BO2023_1128 (nr./data anonimizate), p. 42 — http://portal.cnsc.ro/sivadoc/download.aspx?docUID=YzZlNzdjZDQtNTYxYi00NzkzLTk0ZjItN2E0OTczNjU0Nzdi&pdfa1=ZmFsc2U%3D&filename=Qk8yMDIzXzExMjgucGRm&action=aW5saW5l` | p. 42: „Consiliul consideră că o măsură echitabilă în această situație este ca vizitarea amplasamentului să devină opțională” | p. 24: „autoritatea contractantă ar trebui să prevadă în documentația de atribuire o perioadă estimată de obținere a autorizației de construire” | `NULL` |

Toate 8: `verificat = true`, `snapshot_text_sha256` prezent, `versiune_import = cercetare-2026-10-02`. Cele 57 de decizii **fără** pagină din spec sunt altele (34 cu citatele în format vechi, text simplu); lista lor se obține cu: `SELECT id FROM cnsc_decizii d WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.citate_cheie) c WHERE jsonb_typeof(c)='object' AND (c->>'loc') ~* 'p(ag(ina)?)?\.?\s*[0-9]+')`.

## 2. Controlul judiciar — ce lipsește de fapt și ce propun

Verificarea se face pe portal.just.ro (căutare după părți sau după numărul deciziei CNSC, în dosarele de la curțile de apel). Nu se poate face din containerul cloud (portalul e aplicație JavaScript cu formular), ci de pe PC/server, cum s-a făcut pe 02.10 pentru cele 37 verificate. De aceea aici e doar **lista de căutat + valorile propuse**, nu rezultatul.

| Decizie | Ce se știe pentru căutare | Șanse | Propunere (după căutare, cu „da”) |
|---|---|---|---|
| BO2026_3104 | 2026, UAT anonimizat, „rețele de distribuție și branșamente gaze”, simplificată online, 5 oferte; câștigătorul = fostul proiectant | mici fără părți; decizie din 2026 → eventuala plângere e încă pe rol | căutare după „3104” + 2026 în listele CA; dacă nimic: `{"rezultat":"necunoscut","gasit":false,"nota":"părți anonimizate în BO, căutat <data>"}` |
| BO2021_1060 | 2021, spital județean anonimizat, P+E modernizare corp de spital | mici (părți anonimizate, 5 ani) | la fel, `necunoscut` cu notă |
| BO2025_1138 | 2025, **UAT Comuna Turț** (numită în considerente), P+E canalizare, CPV 45232400-6 | bune: AC cunoscută → căutare „Comuna Turt” la CA Oradea | `mentinuta` / `modificata` / `necunoscut` după rezultat |
| BO2025_286 | 286/C11/31 din 07.02.2025, UAT comună anonimizată, canalizare pluvială | medii: numărul exact există → căutare „286/C11/31” | după rezultat |
| BO2023_1128 | 2023, UAT comună anonimizată, P+E canalizare menajeră | mici | `necunoscut` cu notă |
| BO2024_2683, BO2024_1870, BO2026_2328 | deja căutate (vezi notele din tabelul 1) | — | nimic de făcut; BO2026_2328 de recăutat după 6 luni |

Regulă de cod pe care o respectă deja `ofertareTemeiuri.js`: `NULL` = „neverificată în instanță” (rang 1, deasupra lui `necunoscut`), deci o căutare fără rezultat **coboară** decizia în ordonare. E corect: „am căutat și n-am găsit” spune mai puțin decât pare. Nu propun schimbarea rangului.

## 3. Ce ar fi de scris în BD (doar după „da”)

- Pentru cele 3 anonimizate fără șanse (BO2026_3104, BO2021_1060, BO2023_1128): `control_judiciar = {"rezultat":"necunoscut","gasit":false,"instanta":null,"nr_hotarare":null,"data":null,"link":null,"nota":"părți anonimizate în BO, căutat portal.just.ro <data>"}` — **numai după** căutarea efectivă, ca să nu scriem „căutat” fără să fi căutat.
- Pentru BO2025_1138 și BO2025_286: valoarea rezultată din căutare.
- Nicio modificare la `citate_cheie` ale celor 8: sunt complete.
- Runda mare rămâne cea din spec §3.2: paginile la cele 57 de decizii din format vechi (altă listă, alt efort: recitirea PDF-urilor).

## Rezumat
1. Nota din testul Răcari e greșită pe date: toate cele 8 decizii au pagina la citate și sunt exportabile; citările gata făcute sunt în tabelul 1.
2. Controlul judiciar: 3 din 8 sunt deja căutate (`necunoscut`), 5 sunt `NULL`; din cele 5, doar BO2025_1138 (Comuna Turț) și 286/C11/31 au chei reale de căutare.
3. Căutarea se face pe portal.just.ro de pe PC/server, nu din cloud; aici e doar lista și valorile propuse.
4. Nimic de scris în BD acum; după căutare, 5 UPDATE-uri mici cu „da”.
5. Decizie pentru Răzvan: PR #787 (testul meu pe Vâlcelele, făcut înainte de anulare) — A) rămâne ca al doilea test și se mergeuiește (găsește termenul 15.10 ratat pe 95), B) se închide. Nu-l închid singur.
