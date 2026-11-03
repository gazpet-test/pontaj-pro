# Plan: e-mail Redări prin `redari@gazpet.ro` — r4 (04.11.2026)

Doar plan de design: fără cod de producție, fără scrieri în BD, fără secrete. Fiecare felie se livrează separat, cu porțile ei.
**r4** = revizia după NO-GO Jakarinos + Copilot pe r3 (`6f6c80bd`). Tabelul de rezolvare pe toate rundele e la §9. Ce rămâne intenționat pentru implementare, cu criteriul de acceptanță, e la §8.

**Deciziile lui Razvan (03.11.2026)**
- Căsuța `redari@gazpet.ro` există (Google Workspace). Autorizarea Gmail API o facem împreună, într-o singură ședință.
- **Trimitere** ERP → proprietari: **fără niciun automatism**. Fluxul: lot → aprobare → trimitere, ca la SMS. Mailurile către instituții rămân în 📨 Corespondență (`red_corespondenta`), cu „da” pe fiecare rând.
- **Primire**: răspunsurile intră în ERP, se asociază proprietarului sau parcelei și se centralizează pe „📥 Mesaje Redări” (nou → asociat → rezolvat), plus istoricul pe fișa proprietarului.
- Conținutul primit e **extern** (CLAUDE.md pct. 7 și 10). ERP-ul nu face nicio acțiune automată pe baza lui. AI-ul poate doar sugera, iar omul confirmă.
- **Toate variantele A de la §7 sunt acceptate** (decizii închise).

**Decizii implicite — de confirmat de Razvan** (marcate „*implicit (x)*” în text). Lista completă, cu felia **înaintea căreia** trebuie confirmată și locul pentru data confirmării, e în tabelul de la §7. Comportamentul care depinde de o decizie neconfirmată nu se implementează (Jak r3 P3-02):
- **(a)** adresele din formularul public / din `From` rămân „propuse” până le confirmă un om (§1.11) — înainte de F1;
- **(b)** prima activare citește doar de atunci înainte; importul istoric doar la cerere (§1.1) — înainte de F1;
- **(c)** viewer-ul nu vede conținut de mail; excepția explicită: în `red_raspunsuri` vede canalul `email`, opțiunea, data și referința fixă (§2.1) — înainte de F1;
- **(d)** răspunsul din mail intră în Registru doar verificat, fără text copiat, și apoi nu se mai modifică prin API (§1.10) — înainte de F1;
- **(e)** **nu se golește automat niciun mesaj netriat / neasociat**: alertă la 60 de zile și rămâne; golirea la 90 de zile doar pentru `ignorat` (marcat de un om, cu motiv); corespondența asociată urmează `text_gdpr`, fără golire automată (§1.8) — înainte de F1;
- **(f)** termenele pentru adresele propuse și pentru metadatele de audit (§1.8) — înainte de F1;
- **(g)** cei doi clienți OAuth în **proiecte GCP separate** (revocare independentă) și **două ședințe** de consimțământ, câte una pe felie (§2.3) — înainte de F1 (citire) / F2 (trimitere);
- **(h)** aprobarea unui lot expiră după 7 zile, doar pentru mesajele `in_coada` (§1.3) — înainte de F2.

**Surse citite**: `CLAUDE.md`, `docs/paw/LECTII_REVIEW.md` (L01–L25), `docs/sms/RAPORT_SMS_2026-11-03.md`, migrările `20261130a_sms_mvp.sql` / `20261130b_sms_acces_modul.sql`, `20261126a_redari_teren.sql` (politicile `red_raspunsuri_*`, `red_jurnal_sel`, `red_storage_*`, `fn_red_jurnal`), `20261129e`, `20261129h_redari_corespondenta.sql`, consumatorii `red_raspunsuri` din `src/redari/` și `src/Redari.jsx`, `docs/redari/README.md`, `SABLOANE.md`, `CONTRACT_SCHEMA.md`, edge-urile `redirect-mai-gov`, `noutati-mail`, `ofertare-rfq-inbox`, `ingest-document`, `vicare`, `olx-api`, plus `claude_docs.registru_automatizari` (doar SELECT pe rândurile despre mail/Gmail), DNS-ul public al `gazpet.ro` (03.11) și verdictele r1/r2 Jakarinos + Copilot (citite ca date).

---

## 0. Ce există și ce se refolosește

### 0.1 Gmail API în platformă azi
| Ce | Cum funcționează | Se refolosește? |
|---|---|---|
| `redirect-mai-gov` (repo, v9) | OAuth2 cu refresh token pe o singură căsuță (`razvan.trusu@`), `messages.list` / `get`, idempotență `UNIQUE gmail_msg_id` scrisă ÎNAINTE de acțiune, poarta `esteApelIntern` sau owner, răspuns HTTP doar cu stări fixe. | **Tiparul** da, **secretele** nu. |
| `productie-mail-facturi`, `import-evogps-gmail` | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` pe căsuța lui Razvan / `automatizari@`. | Nu. |
| `ofertare-rfq-inbox`, `ingest-document` | Apps Script de pe căsuță → edge, cu secret în antet. | Nu (decizia 1A). |
| `noutati-mail`, `send-factura-email` | Resend, claim atomic înainte de trimitere. | Tiparul de claim. |
| `vicare`, `olx-api` | Callback OAuth doar owner, `state` consumat atomic, refresh token în Vault prin RPC. | Da, pentru §2.3. |

### 0.2 Delegare pe domeniu vs. refresh token pe căsuță
- **Delegarea pe domeniu** (service account): un secret pentru orice căsuță `@gazpet.ro`. **Exclusă.**
- **Refresh token pe căsuță**: doar `redari@`, doar scope-urile acordate, secrete proprii (L10).
- Consimțământul îl dă Razvan, logat ca `redari@`. Ecran de consimțământ **Internal**.

### 0.3 Redări azi (ce atinge planul)
- `red_detinatori_contact.email`: 0 adrese din 2.548. Convocatorul tipărit are deja `redari@gazpet.ro`.
- `red_convocari.canal` și `red_raspunsuri.canal` acceptă `email`. `nr_document` = `C-nnnn`.
- **Ce poate citi viewer-ul azi** (contează pentru decizia (c)):
  - `red_raspunsuri_sel`: orice nivel Redări, deci și viewer, inclusiv `obiectii_text`;
  - `red_jurnal_sel`: orice nivel, mai puțin rândurile `red_detinatori_contact` / `red_raspunsuri_meta`. `fn_red_jurnal` copiază valorile pe `red_raspunsuri`;
  - `FisaParcela.jsx` afișează `obiectii_text` în istoric.
- **Consumatorii `red_raspunsuri`**: `stare.js` (`ultimulRaspuns`, starea), `pv.js` (PV A/B), `exportXlsx.js` + `ExportEcran.jsx` (Model_6), `ModalPv.jsx`, `FisaParcela.jsx`, `SesiuneEcran.jsx`, `Redari.jsx`, SQL: `red_v_stare_parcela` (și ce depinde de ea), `fn_red_formular_public` / `fn_red_raspuns_public` (`deja_raspuns`), indexul de prezență `20261129e`, triggerul `fn_red_raspunsuri_valideaza`.
- **Bucketul `redari`**: `red_storage_sel` / `_ins` = SELECT/INSERT pe tot bucketul pentru admin/editor, fără UPDATE/DELETE.
- Decizia 6 (01.11): răspunsul public nu trimite nimic. Planul nu o schimbă.

### 0.4 SPF / DKIM / DMARC `gazpet.ro` (DNS public, 03.11.2026)
- MX = Google. SPF `v=spf1 a mx ip4:<IP firmă> include:_spf.google.com ~all`.
- **DKIM Google lipsește** (`google._domainkey` inexistent). **DMARC `p=none`, fără `rua`**.
- Precondiție F2 (decizia 11A): DKIM pornit, DMARC cu `rua`, `p=none` 2 săptămâni, apoi `p=quarantine`.

---

## 1. Arhitectura

```
                    ┌──────────── redari@gazpet.ro (Gmail) ────────────────┐
  token CITIRE      │ history.list INBOX + SENT / messages.get / attachments │  token TRIMITERE
  (gmail.readonly)  │ messages.list (recuperare, reconciliere)               │  (gmail.send + openid email)
                    └────────────────────────────────────────────────────────┘
        ▲ redari-mail-citeste (cron 5 min, lease)              ▲ redari-mail-trimite (doar UI, lot aprobat)
        │ ingestie: rând + manifest → obiecte → finalizare      │
  red_mail_primite / _obiecte / _evenimente             red_mail_loturi → red_mail_mesaje (snapshot imuabil)
  mail/carantina/ (.eml) · mail/atasamente/ (lista albă)            ▲ aprobare owner pe lot_sha256
        │ indicii (fir / cod / expeditor) + conflicte                │
        ▼                                                             │
  📥 Mesaje Redări: nou → asociat → rezolvat · verificare     (F3) răspuns pe fir = lot de 1 ─┘
        │ doar după verificare: RPC atomic → red_raspunsuri (fără text din mail)
        ├─► fișa proprietarului: istoric (admin/editor)        redari-mail-fisier: proxy de descărcare
        └─► red_mail_adrese_propuse (F1b) → confirmare om → contact
                                               redari-mail-retentie (cron zilnic): golire + orfane
```

- **Cod și identitate separate**: `_shared/gmailCitire.ts` (doar secretele de citire) și `_shared/gmailTrimitere.ts` (doar secretele de trimitere). Un test static verifică faptul că niciunul nu importă celălalt modul și nu numește secretele celuilalt.
- **Identificatorii Gmail** (`id`, `threadId`, `historyId`) rămân **șiruri exacte** în TypeScript (fără `Number`). În PostgreSQL, `historyId` e `numeric(20,0)` și se compară numeric.
- **Timpul de încredere** = `internalDate` (Gmail). Antetul `Date` e scris de expeditor: se păstrează ca `data_declarata`, doar informativ, și nu se folosește la ordonare, retenție sau termene (Cop P3-01).

### 1.1 Citirea: `redari-mail-citeste` (F1)
**Pornire și lease**
- `pg_cron` la 5 minute (decizia 12A) → `pg_net` cu `x-intern-secret` (`poartaCron.ts`), sau owner-ul logat (`?dry=1`, contractul mai jos).
- `citire_activa` (implicit `false`), doar owner.
- **Starea pe flux** (Jak r3 P2-06): tabelul `red_mail_flux`, cheie `(casuta, flux)`, `flux` ∈ {`inbox`, `sent`}. Fiecare rând are **propriile** `history_id` (`numeric(20,0)`), `mod_cursor` (`neinitializat` / `normal` / `recuperare`), `data_start`, `recuperare_tip`, `recuperare_history_id`, `recuperare_page_token`, lease (`lease_token`, `lease_pana`, ~4 min), `versiune`. INBOX și SENT nu împart niciun checkpoint: unul poate fi în recuperare în timp ce celălalt merge normal.
- **Lease**: `fn_red_mail_flux_lease(p_flux, p_token, p_secunde)`, CAS pe rândul fluxului. O rulare procesează fluxurile pe rând (INBOX, apoi SENT), fiecare sub lease-ul lui.
- **Orice scriere de progres** (cursor, `mod_cursor`, `recuperare_*`, starea unui mesaj) e CAS pe **lease-ul curent al fluxului + `versiune` + starea așteptată**. O invocare cu lease expirat nu poate suprascrie progresul uneia noi: RPC-ul întoarce `lease_pierdut`, iar edge-ul se oprește imediat.
- **Rândul `sent`** se creează în F2, la activarea trimiterii, cu aceeași regulă de pornire ca INBOX (*implicit (b)*): `history_id` = `getProfile().historyId` capturat la activare, fără scanare retroactivă a SENT.

**Contractul `?dry=1`** (Jak r3 P3-01)
- Permis: refresh token, `history.list` / `messages.list` și `messages.get?format=metadata` (doar antetele `Delivered-To`, `Message-ID`, `Date` și `sizeEstimate`). Răspunsul conține doar numărători și coduri.
- Interzis: `format=full` / `raw` / `attachments.get`, orice scriere în Storage, manifest, rânduri `red_mail_*` (în afara evenimentului `dry_rulat`), cursoare, reconciliere.
- Dry-ul pe căsuța reală e tot prelucrare: e permis doar după condițiile §2.7. Înainte de §2.7 se testează doar pe fixture-uri (teste Deno fără rețea) și în **modul test** de mai jos.

**Modul test** (înainte de §2.7, pe căsuța reală)
- `red_mail_flux.mod_test = true`: ingestia ia în considerare **doar** mesajele adresate `redari+test@gazpet.ro` (plus-addressing Gmail). Selecția se face pe `Delivered-To`, citit cu `format=metadata`. Celelalte mesaje se sar fără citirea corpului, fără scriere și fără eveniment cu identificatorul lor.
- Mesajele de test le trimit doar căsuțe interne `@gazpet.ro`.
- Citirea antetului `Delivered-To` al mesajelor reale e totuși o prelucrare minimă. Dacă Juridic n-o acceptă înainte de §2.7, se folosește o căsuță de test separată (§8).

**Prima activare** (*implicit (b)*)
- Starea inițială a rândului `inbox`: `mod_cursor = 'neinitializat'`, `history_id = NULL`.
- La activare (owner), sub lease: `C_start = users.getProfile().historyId`, `data_start = now()` (`timestamptz`), apoi `history_id = C_start` și `mod_cursor = 'normal'`.
- **Fără import retroactiv**: mesajele aflate în căsuță înainte de activare nu intră în ERP.
- Mesajele sosite după captură le aduce istoricul de la `C_start`, iar filtrul suplimentar `internalDate ≥ data_start − 5 min` (suprapunere de siguranță, dedup-ul o absoarbe) se aplică la fel peste tot.
- **Importul istoric** se face doar la cererea explicită a lui Razvan, ca **recuperare separată** (`recuperare_tip = 'import_istoric'`), cu algoritmul de mai jos și cu limita `data_import_de_la` aleasă de el. „da” separat.

**Mod normal**
- `C0` = `history_id`, citit o dată. **`startHistoryId = C0` fix pe toată paginarea** (`pageToken` până la capăt), `historyTypes = messageAdded, labelAdded`, filtrat pe `INBOX`.
- Înregistrările de istoric au `id` crescător. Mesajele lor se procesează în ordine.
- **Publicarea cursorului**:
  - după TOATE paginile: `historyId`-ul întors la ultima pagină, **inclusiv la rezultat gol**;
  - la oprire înainte de final (buget, eroare tranzitorie): doar până la `id`-ul ultimei înregistrări ale cărei mesaje sunt **toate finale** (`ok`, `neprocesabil`, `disparut`). Un mesaj `in_curs` (ingestie incompletă, §1.2) oprește cursorul la înregistrarea dinaintea lui.
- **Reluare în interiorul unei înregistrări / pagini**: la rularea următoare se recitește aceeași fereastră; mesajele deja finale se sar după `(casuta, gmail_id)`, cele `in_curs` se reiau din manifest (§1.2), cele noi se procesează. Nu există progres „pe jumătate de înregistrare” salvat separat: starea mesajului e progresul.

**Istoric expirat (`404`)** — istoricul poate expira în câteva ore, deci e caz normal:
1. Sub lease se capturează **ÎNAINTE de scanare** `C_nou = getProfile().historyId` → `recuperare_history_id`, `mod_cursor = 'recuperare'`, `recuperare_tip = 'cursor_expirat'`.
2. Scanare completă a domeniului urmărit: `messages.list?q=in:inbox after:<epoch_secunde(data_start) − 3600>`, iar în cod filtrul exact `internalDate ≥ data_start − 5 min`. `after:` cu **epoch în secunde** (nu `AAAA/LL/ZZ`, care depinde de fusul orar Gmail), cu o oră de suprapunere: limita Gmail e tratată ca aproximativă, limita exactă e cea din cod.
3. Progresul (`recuperare_page_token`) e durabil, scris cu CAS pe lease. **`pageToken` respins** (`400` / invalid) → scanarea **repornește de la început**, cu același `C_nou`; dedup-ul sare ce e final.
4. La final: `history_id = C_nou`, `mod_cursor = 'normal'`. Rularea următoare citește istoricul de la `C_nou`, deci prinde și ce a sosit în timpul scanării.

**Trei cazuri separate, per mesaj**
| Caz | Exemplu | Ce se face | Cursorul |
|---|---|---|---|
| Dispărut | `messages.get` → `404` | `red_mail_evenimente` (`disparut`, `gmail_id`) | merge mai departe |
| Neprocesabil | peste limite, structură invalidă, decodare imposibilă | rând **durabil** `stare_ingestie = 'neprocesabil'` + `motiv_cod`; apare la „De triat” | merge mai departe |
| Eroare tranzitorie | `5xx`, `429`, timeout, eroare BD | oprește rularea | rămâne la ultima înregistrare finală |

`invalid_grant` / `401` → `citire_activa = false` automat + `ultima_eroare_cod` + notificare owner.

**Secvența de citire a unui mesaj și limitele** (corectată în r3: `metadata` nu dă structura MIME)
1. `messages.get?format=metadata&metadataHeaders=…` → **doar** `sizeEstimate`, etichete, antete. `sizeEstimate > 25 MB` → `neprocesabil` (`prea_mare`) fără altă descărcare.
2. `messages.get?format=full` cu **plafon pe răspunsul HTTP** citit ca flux: 30 MB de JSON, oprire la depășire → `neprocesabil`. Aici se verifică structura: adâncime ≤ 5, ≤ 50 de părți, ≤ 20 de atașamente, tipurile și `body.size` declarat pe fiecare parte. Datele inline (`body.data`) intră în același plafon.
3. `attachments.get` **doar** pentru părțile permise (§2.6): plafon pe răspunsul base64url (14 MB pentru 10 MB decodați), apoi verificarea mărimii decodate și a octeților magici.
4. `format=raw` doar dacă `sizeEstimate ≤ 10 MB`, cu plafon de 14 MB pe răspuns. Peste → fără `.eml` (`eml_absent = 'prea_mare'`), mesajul rămâne procesabil.
5. **Decodare**: `body.data` e base64url. Codarea de transfer (base64 / quoted-printable) o decodează Gmail în `format=full` (*de confirmat pe fixture-uri reale, §8*); parserul tratează defensiv și varianta nedecodată. Charset din `Content-Type` prin `TextDecoder`; necunoscut → UTF-8 cu înlocuire + steag `charset_necunoscut`. Ordinea corpului: `text/plain` → altfel `text/html` convertit în text pe server (tokenizator simplu, fără DOM, fără randare) cu steag `doar_html` → altfel corp gol cu steag `fara_corp`. `multipart/alternative`: se alege `text/plain`.
6. **Bugetul pe rulare**: ≤ 50 de mesaje, ≤ 100 MB descărcați în total, ≤ 50 s. La depășire se oprește curat; mesajul început rămâne `in_curs` și se reia.
- Corp ≤ 20.000 de caractere (restul `trunchiat`, L12), subiect ≤ 500.

### 1.2 Deduplicare, ingestie în doi pași, BD ↔ Storage
- **Identitatea de ingestie = `(casuta, gmail_id)`**, `UNIQUE`. `rfc_message_id` e index **neunic**, doar pentru corelare: coliziunile se păstrează și se semnalează (`coliziune_message_id`). `raw_sha256` e doar indiciu.
- **„Cunoscut” nu înseamnă „complet”.** Ingestia are stări:
  1. `fn_red_mail_ingestie_incepe` (o tranzacție): rândul `red_mail_primite` cu `stare_ingestie = 'in_curs'` + **manifestul** în `red_mail_obiecte` (un rând per obiect așteptat: `.eml`, fiecare atașament permis, cu `cale` deterministă pe `gmail_id`, mărimea declarată, `stare = 'asteptat'`). Părțile respinse au deja `stare = 'respins_*'` (durabil).
  2. Edge-ul urcă fiecare obiect (`upsert = false`). Dacă obiectul există deja (reluare), îl citește și compară `sha256`: același → ok; diferit → `conflict_obiect` (neprocesabil).
  3. `fn_red_mail_obiect_confirma(obiect_id, sha256, marime)` după fiecare upload reușit.
  4. `fn_red_mail_ingestie_finalizeaza`: CAS pe `in_curs`, verifică faptul că **toate** obiectele manifestului sunt `stocat` sau `respins_*`, apoi `stare_ingestie = 'ok'`. Abia atunci mesajul e final pentru cursor (§1.1).
- **Reluare**: un `gmail_id` găsit cu `in_curs` se reia din manifest (obiectele `asteptat`), nu se sare. Un `in_curs` mai vechi de 24 h fără progres → `neprocesabil` (`ingestie_blocata`), durabil, vizibil.
- **Orfane**: căile se creează doar după manifest, deci un crash lasă cel mult obiecte `asteptat` (reluate) sau obiecte urcate neconfirmate (confirmate la reluare prin sha). Plasa de siguranță: `redari-mail-retentie` listează zilnic prefixul `mail/` și compară cu `red_mail_obiecte`; orice obiect fără rând de manifest, mai vechi de 24 h, se șterge (numărul în jurnal, fără nume).
- **Fără obiecte partajate**: căile sunt pe `gmail_id` (`mail/carantina/<gmail_id>.eml`, `mail/atasamente/<gmail_id>/<n>`), deci retenția șterge per mesaj, fără numărare de referințe.

### 1.3 Trimiterea: `redari-mail-trimite` (F2, F3)
- **Pornire**: doar din UI, owner sau admin Redări (§2.1), pe un lot `aprobat`. Fără cron.
- **Snapshot imuabil la crearea lotului**: pe fiecare `red_mail_mesaje`: `catre` complet, `subiect_final`, `corp_text_final`, `corp_html_final`, `antete_snapshot` (jsonb: From, To, Message-ID, In-Reply-To, References, List-Unsubscribe), `atasament_path` + `atasament_nume` + `atasament_mime` + `atasament_sha256` + `atasament_marime` (citite din fișier), `mesaj_sha256`. Pe lot: `lot_sha256` peste lista ordonată a `mesaj_sha256`.
  - Owner-ul vede în preview **adresele complete**, textul exact și atașamentul.
  - `fn_red_mail_lot_aproba(p_lot, p_versiune, p_lot_sha256)` refuză la hash diferit. După aprobare, triggerul blochează câmpurile snapshotului (L07). **Singura excepție** e golirea de retenție (§1.8): triggerul acceptă un UPDATE pe snapshot doar dacă **toate** câmpurile de conținut devin NULL deodată, `retentie_stare` trece în `golit`, iar termenul proiectului a trecut (verificat în trigger, fără identitatea apelantului, L08).
  - **Expirarea aprobării după 7 zile** (*implicit (h)*, Cop r3 P3-03): se aplică **doar** mesajelor `in_coada`, care trec în `anulat` (`aprobare_expirata`). `rezervat` cu lease valid se termină normal; `in_apel`, `necunoscut`, `trimis` și `esuat_*` **nu se rescriu**: își păstrează reconcilierea și auditul.
- **Destinatarii eligibili**: doar `red_detinatori_contact.email` (adrese introduse de operatori sau confirmate din `red_mail_adrese_propuse`, §1.11). O adresă doar propusă nu intră niciodată într-un lot.
- **Forma canonică și `mesaj_sha256`** (Cop r3 P2-07, Jak r3 P2-05):
  - `mesaj_sha256` = SHA-256 peste **JSON canonic** (RFC 8785, chei sortate, UTF-8) al obiectului `{v: 1, mesaj_id, from, to, subiect, message_id, in_reply_to, references, corp_text, corp_html, atasamente: [{nume, mime, marime, sha256}]}`.
  - Normalizare: textele în Unicode NFC, sfârșiturile de rând `\n`, fără spații finale la sfârșit de rând; adresele în minuscule; `references` ca listă ordonată.
  - **Excluse**: antetul `X-Gazpet-Redari`, delimitatorii MIME, codarea de transfer, `Date`, ordinea antetelor. Deci aceeași aprobare recompusă de două ori dă același hash, chiar cu delimitatori diferiți, și nu există dependență circulară.
  - Aceeași funcție în TS (compunere + reconciliere) și în SQL (crearea snapshotului), cu test de paritate (L19).
- **Antet de control**: `X-Gazpet-Redari: <id mesaj>; h=<mesaj_sha256>`. E doar **indiciu de corelare**, nu dovadă: la reconciliere hash-ul se recalculează din conținutul găsit (§1.4).
- **Pașii și tranzițiile per mesaj** (L01–L05):
  1. `fn_red_mail_rezerva(p_lot, p_apelant)`: lock setări → lot → mesaj (ordinea scrisă în comentariu, L06). Verifică kill-switch, plafon (§1.9), opt-out, `extern_permis`, expirarea aprobării, nivelul. `in_coada → rezervat` + `lease_token`, `lease_pana` (~2 min), `rezervare_nr` crescător.
  2. Edge-ul recompune MIME-ul **din snapshot** și verifică `mesaj_sha256` + `atasament_sha256` (descarcă și hash-uiește). Diferență → `esuat_sigur` (`snapshot_diferit`), fără apel.
  3. `fn_red_mail_apel_incepe(id, lease_token)`: **CAS** pe `stare = 'rezervat'` + lease propriu + `lease_pana > now()`. Întoarce `true` / `false`, **commit înainte de apel**. `false` → **niciun apel Gmail** (lease pierdut).
  4. Refresh token → access token (dacă eșuează aici, apelul nu s-a făcut: §tabel).
  5. `users.messages.send` (`raw`; la F3 și `threadId`).
  6. `fn_red_mail_rezultat(id, lease_token, …)`: CAS; în aceeași tranzacție `trimis` + `red_convocari.data_expediere` (§1.5).

**Tabelul complet al rezultatelor**
| Moment | Rezultat | Tranziție | Retrimitere automată |
|---|---|---|---|
| rezervare | plafon atins / kill-switch / opt-out / aprobare expirată | rămâne `in_coada` (sau `anulat` la expirare / opt-out; expirarea atinge doar `in_coada`) | n/a |
| înainte de `apel_incepe` | lease expirat (măturat) | `rezervat → in_coada` (apelul sigur nu s-a făcut) | da, e sigur |
| `apel_incepe` | CAS eșuat | nimic; worker-ul se oprește | — |
| refresh token, înainte de `send` | `invalid_grant` / `401` | `in_apel → in_coada` (`apel_neefectuat`) + `trimitere_oprita = true` | după repornirea de owner |
| `send` | `200` + răspuns valid (`id`, `threadId`) | `trimis` (CAS) | — |
| `send` | `200` dar răspuns de neînțeles | `necunoscut` | **nu** |
| `send` | `400`, `403` scope / permisiune (determinist) | `esuat_sigur` + `eroare_cod` | nu |
| `send` | `429`, `403 rateLimitExceeded`, `5xx`, timeout, rețea | `necunoscut` + pauză de trimitere 15 min | **nu** (§1.4) |
| după `send` OK | RPC-ul `rezultat` eșuează (BD) | 3 reîncercări cu aceleași argumente (idempotent); tot eșec → rămâne `in_apel` → măturat `necunoscut` → reconcilierea îl găsește | nu |
| worker întârziat | răspunde după ce mesajul a fost măturat `necunoscut` | `fn_red_mail_rezultat_tarziu` salvează `gmail_id_raportat`; reconcilierea confirmă | nu |
| `in_apel` cu lease expirat | crash după `apel_incepe` | `necunoscut` | **nu** |
| `necunoscut` | reconciliere: găsit și potrivit | `trimis` (`reconciliat = true`) | — |
| `necunoscut` | 0 găsite după 30 min / 24 h / mai multe / nepotrivire | rămâne `necunoscut`, „de decis” (owner) | nu |
| decizia owner-ului | „nu a plecat” | `esuat_confirmat`; retrimiterea = mesaj nou, aprobare nouă | — |

- **Ritm**: maximum 1 mesaj / 2 s, maximum 50 / invocare. UI-ul reia până se golește coada.
- `429` / `5xx` repetate (≥ 3 într-o oră) sau „sending limit exceeded” → `trimitere_oprita = true` automat + motiv. O repornește doar owner-ul.

### 1.4 Reconcilierea și monitorizarea SENT
**Reconcilierea rândurilor `necunoscut`** (din `redari-mail-citeste`, care are tokenul de citire; trimiterea nu poate citi)
- Pornire: la fiecare rulare de cron (doar citește SENT și mută starea, nu trimite) + manual (owner / admin).
- `messages.list?q=in:sent rfc822msgid:<Message-ID>`, **paginat complet**, apoi `messages.get?format=full` pe fiecare candidat.
- **Potrivire = toate**:
  - exact un candidat;
  - **un singur** antet `Message-ID`, identic octet cu octet;
  - **un singur** `To`, egal cu `catre`; fără `Cc`, fără `Bcc` (noi nu le punem niciodată);
  - `Subject` identic cu `subiect_final`;
  - **hash-ul recalculat din candidat** = `mesaj_sha256`: se decodează părțile MIME ale copiei din SENT (`text/plain`, `text/html`, **toate** atașamentele, descărcate cu `attachments.get` și hash-uite), se construiește forma canonică (§1.3) și se compară. Valoarea `h=` din `X-Gazpet-Redari` nu contează la decizie (un antet copiat nu dovedește conținutul);
  - manifestul complet al atașamentelor identic (număr, nume, mime, mărime, sha256): nici în plus, nici lipsă;
  - `internalDate ≥ apel_inceput_la − 5 min`.
  - Orice nepotrivire sau imposibilitate de verificare → rămâne `necunoscut`, cu `conflict_reconciliere = true` și motivul.
  - Test: antete și atașament identice, corp modificat → conflict + alertă.
- Rezultat: `fn_red_mail_reconciliaza` (CAS pe `necunoscut`) → `trimis` + `data_expediere`. Căutarea fără rezultat **nu** e dovadă că mesajul n-a plecat: retrimiterea rămâne decizia omului.

**Monitorizarea SENT (separată)** — prinde mesajele trimise din `redari@` fără rând în ERP (token scurs sau trimitere manuală din Gmail):
- Rândul `sent` din `red_mail_flux` (§1.1), cu stare proprie: `startHistoryId` fix, CAS pe lease-ul lui, la `404` scanare `in:sent after:<epoch − 3600>` cu cursor capturat înainte, `labelId = SENT`. Pornit la activarea F2, fără scanare retroactivă.
- Fiecare mesaj nou din SENT se clasifică:
  | Caz | Eveniment + alertă către owner |
  |---|---|
  | niciun rând `red_mail_mesaje` cu acel `Message-ID` / id `X-Gazpet-Redari` | `trimis_in_afara_erp` |
  | identificatori cunoscuți, dar hash-ul recalculat ≠ `mesaj_sha256` | `trimis_modificat` (identificatori refolosiți, conținut diferit) |
  | al doilea mesaj din SENT pentru același rând ERP | `trimis_duplicat` |
  | identificatori cunoscuți, conținut identic | fără alertă; dacă rândul e `necunoscut`, intră în reconciliere |
  Evenimentele conțin doar id-ul Gmail, id-ul rândului ERP și data, fără destinatar sau subiect.
- Regula de operare: din `redari@` nu trimite nimeni manual din Gmail. Orice excepție apare ca alertă și o explică owner-ul.

### 1.5 Momentul juridic și `red_convocari`
- Convocarea pe e-mail = rând `red_convocari` cu `canal = 'email'`, `C-nnnn` propriu, creat la aprobarea lotului cu `data_expediere = NULL`.
- `data_expediere` se scrie atomic **doar la succes confirmat** (direct sau prin reconciliere), în aceeași tranzacție. La `esuat_*` / `anulat` → convocarea trece în `anulat` cu motiv.
- „Expediat” = Gmail a acceptat mesajul. **Nu e livrare și nu e confirmare de primire.**
- **E-mailul e canal suplimentar** (decizia 6A): poșta cu AR rămâne obligatorie. Starea parcelei și Model_6 nu tratează o convocare `email` ca înlocuitor.

### 1.6 Compunerea MIME sigură
- **Un singur `To`**. Fără `Cc`, fără `Bcc`, fără `Reply-To` diferit de `redari@`.
- Orice valoare de antet cu `CR`, `LF`, `NUL` sau alte caractere de control → **refuz** în BD (la crearea lotului) și din nou în edge.
- Adresa: validare strictă (o singură adresă, fără liste, comentarii sau `<>` în plus, domeniu ASCII / punycode). Aceeași funcție în SQL și TS, cu test de paritate (L19).
- RFC 2047 pentru subiect și nume, corpuri `base64`, delimitatori aleatori, RFC 2231 pentru numele de fișier. `Message-ID: <uuid@gazpet.ro>` generat și salvat înainte. `List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>`. `X-Gazpet-Redari` (§1.3).
- Teste: injecție de antete (`\r\nBcc:`), două adrese, ghilimele și diacritice în nume, subiect lung.

### 1.7 Codul din subiect și firul Gmail
- **Format**: `[RED-C-0012-K7Q]` (`nr_document` + 3 caractere de control `HMAC(REDARI_MAIL_REF_SECRET, cod)`). Pentru celelalte mesaje: `[RED-M-000123-XXX]` (cheia `M` în `red_numere`).
- În F1 se recunoaște și forma tipărită pe convocatorul poștal (`C-0012`, fără control), ca indiciu slab. Parsare ancorată (L13), teste pozitive + negative.
- **Firul**:
  - răspunsul din ERP (F3): subiectul = `Re: ` + **subiectul primit, neschimbat**. Fără cod în subiectul primit → codul nu se adaugă în subiect, referința merge pe prima linie a corpului;
  - `threadId`, `In-Reply-To`, `References`.
- **Contactul diferă de expeditor**: implicit, răspunsul pleacă la adresa din contact, ca **mesaj nou** (fără `threadId` / `In-Reply-To`, referința în corp). Pe firul expeditorului doar cu alegerea explicită a owner-ului la aprobare, cu adresa completă afișată. Adresa expeditorului merge doar în `red_mail_adrese_propuse` (§1.11), nu în contact.

### 1.8 Tabele, Storage, retenție
**Tabele noi** (prefix `red_mail_`, RLS, fără DELETE pentru roluri, jurnal doar cu numele câmpurilor):
| Tabel | Felie | Ce ține |
|---|---|---|
| `red_mail_setari` (un rând) | F1 (+ F2) | `citire_activa`, `ultima_eroare_cod`, `retentie_activa` + lease-ul global de retenție (cursoarele stau în `red_mail_flux`); F2: `trimitere_oprita` (implicit `true`), plafoane, `extern_permis` (implicit `false`); `versiune` |
| `red_mail_primite` | F1 | `casuta` + `gmail_id` (UNIQUE), `rfc_message_id` (neunic) + `coliziune_message_id`, `raw_sha256` (neunic), `thread_id`, `in_reply_to`, `references_ids`, `de_la_adresa`, `de_la_nume`, `reply_to`, `catre`, `subiect`, `corp_text`, steagurile de decodare, `primit_la` (= `internalDate`), `data_declarata`, `auth_*` + `auth_sursa`, `stare_ingestie` (`in_curs` / `ok` / `neprocesabil`) + `motiv_cod`, indiciile (§1.10), legăturile confirmate, `stare` (`nou` / `asociat` / `rezolvat` / `ignorat`) + `ignorat_la` / `ignorat_de` / `ignorat_motiv`, `verificare` + `verificare_nota` (§1.10), `nota`, `cere_dezabonare`, `inregistrat_in_registru` (§1.10), `retentie_stare` (`activ` / `in_golire` / `golit`), `golire_claim_token` / `_pana`, `blocaj_stare` (`fara` / `cerut` / `activ`) + `retentie_blocata_motiv`, `gmail_id_hmac`, `versiune` |
| `red_mail_obiecte` | F1 | manifestul (§1.2): `primit_id`, `tip` (`eml` / `atasament`), `nr`, `cale`, `nume` curățat, `mime_declarat`, `mime_detectat`, `marime_declarata`, `marime`, `sha256`, `stare` (`asteptat` / `stocat` / `respins_tip` / `respins_marime` / `respins_structura` / `respins_buget` / `conflict_obiect` / `sters`) |
| `red_mail_evenimente` | F1 | ingestie / recuperare / retenție / reconciliere / SENT / descărcări: `tip`, id-uri, numărători, `cod`. Fără adrese, subiecte, nume de fișier sau text. |
| `red_mail_flux` | F1 (rândul `sent` în F2) | starea pe flux, cheie `(casuta, flux)` (§1.1) |
| `red_mail_raspuns_sursa` | F1 | `raspuns_id` (UNIQUE), `tip_sursa` (`gmail_redari` / `manual_verificat`), `primit_id` (obligatoriu la `gmail_redari`), `detinator_id`, **UNIQUE `(primit_id, detinator_id)`**, `cerere_sha256` (hash-ul argumentelor, pentru idempotență), `metoda_verificare`, `verificat_de/la`; scris doar de RPC-urile de la §1.10 |
| `red_mail_adrese_propuse` | F1 (folosit și de F1b) | §1.11 |
| `red_mail_oauth_state` | F1 | §2.3 |
| `red_mail_loturi`, `red_mail_mesaje` | F2 | §1.3–1.4 |
| `red_mail_optout` | F2 | `email` normalizat UNIQUE, `activ`, `motiv`, `sursa`, `primit_id`, `setat_de/la` |
| `red_mail_sugestii` | F4 | §2.5 |

**Storage (bucketul `redari`, schimbare explicită pentru `mail/`)**
- `red_storage_sel` / `red_storage_ins` se modifică să **excludă `mail/`** pentru `authenticated`. Postcondiția migrării verifică faptul că nicio politică pentru `authenticated` / `anon` nu acoperă `mail/`.
- INSERT și DELETE pe `mail/`: doar `service_role` (citirea, respectiv retenția). Promisiunea „fișiere imutabile” din README rămâne pentru restul bucketului și se amendează explicit pentru `mail/`.
- **Descărcarea: proxy edge, nu URL semnat** (Cop P2-04). `redari-mail-fisier`, cu `obiect_id` (contractul de identitate la §2.4):
  1. RPC `fn_red_mail_fisier_autorizeaza(obiect_id)`, **apelat cu clientul utilizatorului** (JWT-ul lui, deci `auth.uid()` = utilizatorul final): verifică nivelul (`.eml` doar owner / admin; atașament owner / admin / editor), faptul că obiectul e `stocat` și aparține unui mesaj vizibil apelantului, `retentie_stare = 'activ'`, și scrie evenimentul `descarcare` (cine, ce obiect, fără nume);
  2. edge-ul citește obiectul prin `descarcaCuJurnal` (monitorul de egress: blocare + jurnal de octeți) și îl întoarce în flux cu `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename*=…`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
  - Fiecare transfer trece prin proxy, deci fiecare descărcare e jurnalizată, nu doar emiterea unui link. Nu există URL refolosibil.

**Retenția: `redari-mail-retentie`** (F1, livrată oprită, fișa la §2.4)
- **Ce e eligibil pentru golire automată** (*implicit (e)*, Cop r3 P1-01). Toate termenele se socotesc după `primit_la` = `internalDate`, niciodată după `Date`:
  | Categorie | Regula |
  |---|---|
  | `ignorat` (spam / irelevant), **marcat de un om, cu motiv** | golire automată la **90 de zile** de la `ignorat_la` (nu de la primire: un mesaj marcat ignorat în ziua 89 nu dispare a doua zi), dacă nu e blocat |
  | `nou` / „de triat” (neasociat, netriat) | **niciodată golit automat**. Alertă către admin la **60 de zile** („de triat vechi”), repetată săptămânal; rămâne până îl clasifică un om |
  | `neprocesabil` | **niciodată golit automat**. Circuit manual: admin-ul îl verifică (originalul e încă în Gmail) și îl marchează `ignorat` sau îl asociază manual |
  | `asociat` / `rezolvat` (corespondența unui proprietar) | **fără golire automată**: urmează retenția din `text_gdpr`. La termenul `red_proiecte.retentie_mail_pana` (fixat de owner) panoul îl propune la golire, iar golirea se face ca operație pe date reale (pct. 3: preview → „da” → apply), nu de cron |
  | mesajele trimise (`red_mail_mesaje`) | ca `asociat`: la termenul proiectului, golire doar cu „da” |
  | `ignorat` → `redeschide` | termenul de 90 de zile se anulează; la o nouă marcare pornește din nou |
  Regula se poate schimba doar printr-o decizie explicită a lui Razvan, cu validarea Juridic a termenului.
- **Două categorii de date** (Cop r3 P2-05). Golirea înseamnă **ștergerea conținutului**, nu anonimizare completă:
  1. **Conținutul corespondenței** (text, adrese, nume de fișier, fișiere, note libere): se golește la regula de mai sus.
  2. **Metadatele de audit** (`id`, `primit_la`, stările, autorii pașilor, legătura cu deținătorul / parcela, evenimentele): rămân, pentru că documentează ce a făcut ERP-ul cu o corespondență juridică. Temeiul: interesul legitim al operatorului / obligația de evidență din contract (de confirmat cu Juridic). Termen: `retentie_mail_pana` al proiectului, apoi ștergerea completă a rândului, ca operație cu „da” (*implicit (f)*).
  - `gmail_id` și `thread_id` se înlocuiesc la golire cu `gmail_id_hmac = HMAC(REDARI_MAIL_REF_SECRET, gmail_id)`: dedup-ul rămâne posibil (o recuperare nu reimportă un mesaj golit care e încă în Gmail), dar identificatorul nu mai e cel din Gmail. Pseudonimizare, nu anonimizare.
- **Inventarul la nivel de coloană** (Jak r3 P2-02). Ce se golește:
  | Tabel | Coloane golite (→ NULL) | Ce rămâne |
  |---|---|---|
  | `red_mail_primite` | `corp_text`, `subiect`, `de_la_adresa`, `de_la_nume`, `reply_to`, `catre`, `rfc_message_id`, `in_reply_to`, `references_ids`, `raw_sha256`, `data_declarata`, `gmail_id`, `thread_id` (→ `gmail_id_hmac`), **`verificare_nota`**, **`ignorat_motiv`**, **`nota`**, indiciile (liste de id-uri) | stări, date, autori, legătura confirmată |
  | `red_mail_obiecte` + Storage | obiectele șterse; `nume`, `sha256`, `cale` | `tip`, `marime`, `stare = 'sters'` |
  | `red_mail_mesaje` (trimise) | `catre`, `subiect_final`, `corp_text_final`, `corp_html_final`, **`antete_snapshot`**, `atasament_nume`, `rfc_message_id` (excepția din triggerul de imuabilitate, §1.3) | stări, `mesaj_sha256`, datele, legătura cu convocarea; atașamentul juridic rămâne în `red_convocari` cu retenția lui |
  | `red_mail_adrese_propuse` | `email`, `nota` | starea, sursa, datele |
  | `red_mail_optout` | `motiv` (text liber); adresa rămâne cât timp opt-out-ul e activ (fără ea opt-out-ul nu funcționează) | |
  | `red_mail_sugestii` (F4) | `fragmente`, `categorie` | costul |
  | blocajul legal | `retentie_blocata_motiv` rămâne cât timp blocajul e activ; se golește la ridicarea lui, odată cu restul | |
  | `red_mail_evenimente`, `red_jurnal` (`red_mail_*`) | nimic: fără PII prin construcție (verificat de test) | |
  | `red_raspunsuri` | nimic: fără text din mail (§1.10) | |
  | backup-urile Supabase (PITR / zilnice) | nu se șterg selectiv; ies la rotația lor (durata de verificat, §8), notată în informare | |
  | căsuța Gmail | politică în Google Vault, aliniată (manual, Razvan); ERP-ul nu poate șterge din Gmail | |
- **Adrese propuse — termen propriu** (*implicit (f)*), indiferent dacă au `primit_id` sau vin din formular (`primit_id = NULL`): `propusa` neconfirmată → `email` și `nota` golite după **180 de zile** de la `propus_la`; `respinsa` → după **30 de zile** de la respingere. Acestea se golesc automat (sunt date nevalidate, nu corespondență); rândul rămâne pentru audit.
- **Mașina de stări și blocajul legal** (Cop r3 P2-01):
  - Stări: `activ → in_golire → golit`. Rândurile fără obiecte trec direct prin `fn_red_mail_goleste` (o tranzacție).
  - **Lease global de retenție** (`red_mail_setari.retentie_lease_*`): o singură rulare de retenție la un moment dat.
  - **Claim exclusiv per mesaj**: `fn_red_mail_golire_incepe(primit_id)` ia `FOR UPDATE`, refuză dacă `blocaj_stare` ≠ `fara` sau dacă eligibilitatea nu mai e îndeplinită, apoi scrie `in_golire` + `golire_claim_token` + `golire_claim_pana` + lista exactă de obiecte. Un mesaj cu claim activ nu poate primi alt claim.
  - Obiectele se șterg **secvențial**. Înainte de FIECARE `DELETE`, `fn_red_mail_golire_poate(primit_id, obiect_id, claim_token)` (`FOR UPDATE`) verifică claim-ul propriu, `blocaj_stare = 'fara'` și starea obiectului, și marchează obiectul `in_stergere`. Răspuns negativ → oprire; rândul revine în `activ` cu obiectele rămase.
  - **Blocajul are două stări** (`blocaj_stare`): `fn_red_mail_blocaj_seteaza` (owner / admin, același `FOR UPDATE`) setează imediat `cerut`. Dacă nu există claim activ sau obiect `in_stergere`, trece direct în `activ`. Dacă există, rămâne `cerut` până se încheie claim-ul (sau expiră), apoi `activ`. UI-ul arată: „blocaj cerut — X obiecte deja șterse, Y în ștergere” / „blocaj activ, nicio operație în curs”.
  - Garanția: după `cerut`, se mai poate finaliza **cel mult obiectul deja marcat `in_stergere`** (unul singur, pentru că claim-ul e exclusiv și ștergerea secvențială). Niciun claim nou nu se mai dă.
  - Asocierea, verificarea sau înregistrarea unui răspuns pe un rând `in_golire` / `golit` e refuzată.
  - `fn_red_mail_golire_confirma(claim_token)`: golește coloanele doar pentru obiectele confirmate șterse (Storage confirmă că nu mai există), apoi `golit`. Eșec la mijloc → `in_golire` până la expirarea claim-ului, apoi reluat.
  - Test obligatoriu: două procese de retenție + un admin care cere blocajul, intercalate (barieră, L25).

### 1.9 Limite și plafoane
- **Citire**: §1.1 (secvența și plafoanele de octeți).
- **Trimitere, limitele Google** (de verificat pe „Gmail sending limits” înainte de F2): ~2.000 de mesaje / zi / utilizator, ~3.000 de destinatari externi unici / zi; depășirea suspendă trimiterea până la 24 h.
- **Plafoanele proprii** (decizia 7A): **200 / zi, 1.000 / lună, maximum 300 / lot**, plus maximum 1 `reamintire` / destinatar / 24 h.
  - Ferestrele sunt **calendaristice în `Europe/Bucharest`**: ziua = data locală a lui `rezervat_la`, luna = luna calendaristică locală (nu fereastră mobilă), prin helperul existent de oră RO (L17).
  - **Contabilizarea** se face la rezervare, pe `(mesaj_id, rezervare_nr)`. Se numără `rezervat`, `in_apel`, `trimis`, `necunoscut`, `esuat_*`. Doar întoarcerea în coadă fără apel (lease expirat înainte de `apel_incepe`, `apel_neefectuat`) eliberează locul.
  - **Lot de 300 cu plafon de 200 / zi**: lotul se poate aproba. Rezervarea se oprește la plafon, restul rămâne `in_coada`, iar UI-ul arată „plafon zilnic atins, continuă mâine”. Continuarea cere din nou pornirea manuală, în fereastra de 7 zile a aprobării.
- **Kill-switch**: `trimitere_oprita` (implicit `true`), `citire_activa` (implicit `false`), `retentie_activa` (implicit `false`), doar owner. Oprirea ocolește orice cotă (L20).
- **Mod test**: cât timp `extern_permis = false`, orice destinatar în afara `@gazpet.ro` (potrivire exactă de domeniu) e refuzat în BD.

### 1.10 Asocierea, verificarea și intrarea în Registru
**Indicii, calculate toate** (`fn_red_mail_indicii`, o definiție, L19): fir (din F2), cod (+ forma), expeditor (pot fi mai mulți deținători), `conflict_indicii`, `expeditor_diferit`, `reply_to_diferit`, autentificarea (§2.6). Niciun indiciu → „de triat”.

**Stările** (doar omul): `nou → asociat` (cu conflict, alegere explicită), `asociat → rezolvat`, `ignorat` (cu motiv), `redeschide`.

**Verificarea identității**: `verificare` = `neverificat` (implicit) / `verificat_telefon` / `verificat_semnatura` / `verificat_prezenta` / `verificat_alt` + autor + notă, prin `fn_red_mail_verifica` (admin / editor).

**Intrarea în Registru** (*implicit (d)*) — contractul pentru toți consumatorii:
- **Un răspuns din mail intră în `red_raspunsuri` doar după verificare**, printr-un singur RPC atomic: `fn_red_mail_inregistreaza_raspuns(primit_id, detinator_id, optiune, zi, metoda_verificare, nota, versiune)`. În aceeași tranzacție:
  - `FOR UPDATE` pe rândul `red_mail_primite` (L01: serializează apelurile concurente pe același mesaj);
  - verifică faptul că mesajul e `asociat`, `ok`, `retentie_stare = 'activ'`, iar `detinator_id` e deținătorul asociat (sau unul din coproprietarii aceleiași parcele, confirmați la asociere);
  - setează `verificare` (dacă nu era) cu metoda dată;
  - inserează `red_raspunsuri` (`canal = 'email'`) + `red_mail_raspuns_sursa`.
- **Idempotența și cardinalitatea** (Jak r3 P2-01, Cop r3 P2-02):
  - un mesaj poate privi mai mulți deținători (coproprietari care scriu împreună), dar **cel mult un răspuns per (mesaj, deținător)**: `UNIQUE (primit_id, detinator_id)` în `red_mail_raspuns_sursa`;
  - `cerere_sha256` = hash peste argumentele canonice (`primit_id`, `detinator_id`, `optiune`, `zi`, `metoda_verificare`);
  - **reluare identică** (același `cerere_sha256`, de ex. după timeout) → RPC-ul întoarce `raspuns_id`-ul existent, fără al doilea rând;
  - **cerere diferită** pe aceeași pereche → eroare `conflict_raspuns_existent` (corectarea urmează procedura de la §8);
  - test: două apeluri concurente reale (barieră, L25) → un rând; reluare după timeout → același `raspuns_id`; cerere diferită → conflict.
- **Textul din mail nu se copiază**: `obiectii_text` primește doar o referință fixă, pusă de RPC (`Obiecții transmise pe e-mail — mesajul RED-…; textul în 📥 Mesaje`). Așa, `red_raspunsuri`, jurnalul lui (`fn_red_jurnal` copiază valorile) și istoricul din `FisaParcela.jsx` nu conțin conținut de mail. Triggerul de validare existent (obiecții ⇒ text nevid) e satisfăcut.
- **Proveniența și conținutul protejate în BD** (L07, Jak r3 P1-01):
  - **constraint trigger `DEFERRABLE INITIALLY DEFERRED`** pe `red_raspunsuri`: la commit, orice rând **nou** `canal = 'email'` trebuie să aibă rândul `red_mail_raspuns_sursa`. Un INSERT direct prin PostgREST (tranzacție proprie, fără sursă) e refuzat. Fără GUC-uri (L08);
  - trigger `BEFORE UPDATE` pe `red_raspunsuri`: `canal` nu se poate schimba nici spre `email`, nici dinspre;
  - **trigger `BEFORE UPDATE` pentru rândurile care au sursă e-mail** (`EXISTS` în `red_mail_raspuns_sursa`): orice schimbare a `optiune`, `data`, `zi_sesiune_aleasa`, `obiectii_text`, `declaratie_confirmata`, `semnatura_electronica_ref`, `detinator_id`, `created_by`, `created_at` e **refuzată**, pentru toate rolurile aplicației. `obiectii_text` trebuie să rămână egal cu referința fixă (verificat și la INSERT). Drepturile UPDATE existente ale editorului (`red_raspunsuri_upd`) rămân pentru celelalte răspunsuri, dar nu ating rândurile din mail;
  - `red_mail_raspuns_sursa`: fără drepturi de scriere pentru roluri, doar prin RPC; nu are DELETE;
  - test obligatoriu: PATCH direct ca editor pe **fiecare** câmp protejat → refuz, rândul neschimbat, niciun rând nou în `red_jurnal` cu valoarea încercată.
- **Răspunsurile `email` preexistente și cele venite pe alt circuit** (Cop r3 P2-03):
  - preflight-ul migrării F1 numără rândurile `red_raspunsuri` cu `canal = 'email'` și le listează (id + dată, fără text) în raportul DRY. Constraint trigger-ul verifică doar rândurile **inserate după** migrare, deci cele vechi nu sunt blocate și nu devin „importate din Gmail”;
  - dacă numărul e > 0, migrarea nu le atinge. Tratarea lor (lăsate ca atare sau marcate `manual_verificat`) e decizia lui Razvan, ca operație pe date reale (§8);
  - un e-mail primit pe alt circuit (de ex. în căsuța unui angajat) se înregistrează prin `fn_red_mail_inregistreaza_raspuns_manual(detinator_id, optiune, zi, metoda_verificare, nota)` → `tip_sursa = 'manual_verificat'`, `primit_id = NULL`, aceleași protecții. Conținutul acelui mail nu intră în ERP; se recomandă redirecționarea lui către `redari@`.
- **După înregistrare, asocierea și verificarea mesajului se îngheață** (trigger). Corectarea unei atribuiri greșite **nu** e în F1: e operație pe date reale (pct. 3, preview → „da” → apply) până la o felie dedicată de anulare a răspunsurilor (§8).
- **Consumatorii existenți nu se schimbă** și nu au nevoie de o regulă „neverificat”: prin construcție, în `red_raspunsuri` nu există răspunsuri de mail neverificate. Un mail neverificat nu poate înlocui un răspuns verificat (nu ajunge în `ultimulRaspuns`) și nu poate intra în PV, Model_6, starea parcelei sau `deja_raspuns`. Un răspuns de mail verificat se comportă ca orice răspuns înregistrat de operator (e verificat).
- **PV**: obiecțiile din PV le transcrie operatorul în documentul PV (act juridic, cu vizibilitatea existentă a PV-urilor), ca acțiune explicită. ERP-ul nu copiază automat textul mailului în PV.

### 1.11 Adrese propuse (F1b și din mailuri) — *implicit (a)*
- Tabelul `red_mail_adrese_propuse`: `detinator_id`, `email` normalizat, `sursa` (`formular_public` / `mail_primit`), `primit_id` (dacă e cazul), `propus_la`, `stare` (`propusa` → `confirmata` | `respinsa`), `confirmat_de/la`, `metoda_verificare`, notă. Vizibil doar admin / editor.
- **Formularul public (F1b) scrie DOAR aici**, niciodată în `red_detinatori_contact`. Deținerea linkului nu dovedește identitatea sau controlul asupra adresei.
- **Confirmarea**: `fn_red_mail_adresa_confirma` (admin / editor), după verificarea pe alt canal (telefon / prezență / procedura aprobată de Juridic, §8). Abia atunci adresa se scrie în `red_detinatori_contact.email` (dacă e gol; dacă există alta, se cere alegerea explicită), jurnalizat.
- **Până la confirmare**, adresa nu intră în niciun lot și nu primește nimic (nici mail de confirmare automat: ar fi o trimitere).
- Test obligatoriu: contact gol, token public valid, adresă controlată de altcineva → rând `propusa`, contactul rămâne gol, lotul F2 nu o vede.

---

## 2. Securitatea

### 2.1 Roluri și ce vede viewer-ul (*implicit (c)*)
| Acțiune | owner | admin Redări | editor Redări | viewer Redări |
|---|---|---|---|---|
| lista mesajelor, corpul, atașamentele permise, istoricul de mail pe fișă | da | da | da | **doar numărători** |
| `.eml` brut (carantină) | da | da | nu | nu |
| asociere / rezolvare / ignorare / verificare / înregistrare răspuns | da | da | da | nu |
| confirmarea adreselor propuse | da | da | da | nu |
| `retentie_blocata` | da | da | nu | nu |
| creare lot (preview) | da | da | da | nu |
| **aprobare lot** | **da** | nu | nu | nu |
| pornire trimitere, reconciliere manuală | da | da | nu | nu |
| decizie pe `necunoscut` | da | nu | nu | nu |
| opt-out: confirmarea unei cereri / scoaterea | da / da | da / nu | nu | nu |
| comutatoare, plafoane, termene, OAuth | da | nu | nu | nu |

**Viewer-ul — ce se modifică**:
- `red_mail_*`: politicile RLS de SELECT doar pentru admin / editor (owner prin `fn_red_nivel` = admin).
- Vederile noi (`red_mail_v_inbox`, `red_mail_v_istoric_detinator`) sunt `security_invoker`, deci moștenesc RLS-ul: viewer-ul primește 0 rânduri.
- **Numărătorile** viewer-ului vin din RPC-ul `fn_red_mail_numaratori(proiect_id)` (SECURITY DEFINER): doar contoare pe stare / UAT, fără id-uri de mesaj, adrese sau date.
- **`red_jurnal_sel`** se modifică: rândurile cu `tabela LIKE 'red_mail_%'` intră în lista „doar admin / editor” (alături de `red_detinatori_contact`, `red_raspunsuri_meta`). În plus, `fn_red_jurnal` pune doar numele câmpurilor pe toate tabelele `red_mail_*`.
- **`red_raspunsuri` / `red_raspunsuri_sel` — excepția explicită** (*implicit (c)*, Cop r3 P3-01): politica rămâne neschimbată (viewer-ul vede răspunsurile, ca azi). Pentru un răspuns venit din mail, viewer-ul vede **doar**: `canal = 'email'`, `optiune`, `data`, `zi_sesiune_aleasa` și referința fixă din `obiectii_text`. „Viewer doar numărători” se referă la 📥 Mesaje și la tabelele `red_mail_*`, nu la Registru. Dacă Razvan vrea ca viewer-ul să nu vadă nici asta, se schimbă `red_raspunsuri_sel` (și consumatorii viewer-ului), cu felie separată.
- `FisaParcela.jsx`: secțiunea „Istoric e-mail” se încarcă doar pentru admin / editor. Istoricul de răspunsuri existent rămâne cum e (nu conține text de mail).
- `red_corespondenta.observatii` e text liber: UI-ul nu oferă „copiază din mail”. Regula „nu lipi conținut de mail în câmpuri vizibile viewer-ului” intră în ghidul operatorului (și în §8 ca verificare la review-ul UI).
- **Test obligatoriu** (F1, prin API, ca viewer, după „Înregistrează răspuns”): `red_mail_*`, vederile noi, `red_jurnal` (inclusiv rândurile `red_raspunsuri` noi), `red_raspunsuri`, `storage.objects` pe `mail/`, proxy-ul de descărcare → niciun text din mail, nicio adresă, niciun obiect. Testul verifică și **lista pozitivă**: pe răspunsul din mail viewer-ul vede exact câmpurile permise de mai sus, nimic în plus.

### 2.2 Accesul conturilor AI la căsuță
- **Conturile AI (inclusiv `claude@gazpet.ro`) NU primesc acces direct la `redari@`**: fără delegare, fără parolă, fără sesiune logată în vreun browser de pe serverul AI.
- Singurul acces e tokenul OAuth al ERP-ului, prin porțile ERP.
- Testele se fac prin ERP, către și dinspre adrese `@gazpet.ro`; rezultatul se verifică pe ecranul ERP.
- Consimțământul OAuth îl dă Razvan, logat el ca `redari@`.

### 2.3 Tokenurile, riscul rezidual și callback-ul OAuth
**Riscul rezidual (declarat)**: tokenul de citire poate citi toată căsuța, cel de trimitere poate trimite oriunde; porțile sunt doar în ERP. `service_role`, Edge Secrets și Vault sunt comune proiectului, deci separarea dintre funcții e de cod și review, nu de platformă. Măsuri:
- doi clienți OAuth, două tokenuri, **în două proiecte GCP separate** (*implicit (g)*, Jak r3 P2-04): Google revocă granturile tuturor clienților **din același proiect** pentru un utilizator, deci numai proiectele separate dau revocare independentă (o revocare la callback-ul de trimitere nu oprește citirea). Varianta „același proiect” e acceptabilă doar dacă Razvan o alege explicit: atunci orice revocare oprește **ambele** fluxuri (`citire_activa = false`, `trimitere_oprita = true`) și cere reconectarea amândurora;
- **două ședințe de consimțământ** (*implicit (g)*, Cop r3 P2-06), câte una pe felie: citirea la activarea F1, trimiterea la activarea F2. Asta înlocuiește formularea „o singură ședință” din decizia 2A, pentru că F1 și F2 se activează la momente diferite (de confirmat);
- cod și secrete separate, testul static de import;
- tokenurile în Vault, citite de un RPC cu EXECUTE doar `service_role`, care acceptă doar cele două nume;
- verificarea scope-urilor **la callback și la fiecare refresh**, pe seturi **normalizate** (mai jos): ceva în plus, ceva lipsă, sau câmpul `scope` absent → funcția se oprește (`citire_activa = false` / `trimitere_oprita = true`) + alertă. Lipsa unui câmp necesar verificării = oprire, nu acceptare;
- monitorizarea SENT (§1.4);
- revocarea (mai jos).

**Seturile OAuth complete** (fără alternative). Se compară **seturi canonice**, nu șiruri literale (Jak r3 P2-03): Google poate întoarce un scope într-o reprezentare echivalentă. Normalizarea folosește o **listă închisă de echivalențe**; orice altceva rămâne diferit:
| Reprezentare întoarsă | Forma canonică |
|---|---|
| `email`, `https://www.googleapis.com/auth/userinfo.email` | `email` |
| `openid` | `openid` |
| `https://www.googleapis.com/auth/gmail.readonly` | `gmail.readonly` |
| `https://www.googleapis.com/auth/gmail.send` | `gmail.send` |

| Client | Cerute | Setul canonic acceptat (exact, după normalizare) | Verificarea căsuței înainte de salvare |
|---|---|---|---|
| „ERP Redări citire” | `https://www.googleapis.com/auth/gmail.readonly` | {`gmail.readonly`} | `users.getProfile().emailAddress` == `redari@gazpet.ro` (exact, minuscule). Fără afirmația `hd` (getProfile nu o dă). |
| „ERP Redări trimitere” | `https://www.googleapis.com/auth/gmail.send openid email` | {`gmail.send`, `openid`, `email`} | `id_token`-ul din răspunsul de token, **validat local** (fără `tokeninfo`): semnătura RS256 cu cheile JWKS Google (WebCrypto, fără librărie nouă), `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `aud` = client ID-ul de trimitere, `exp` în viitor, `iat` rezonabil, `email_verified = true`, `email` == `redari@gazpet.ro`, `hd` == `gazpet.ro`. |
- Cererea de autorizare: `access_type=offline`, `prompt=consent`, **`include_granted_scopes=false`** (nu se combină cu permisiuni acordate altor clienți din același proiect), `login_hint=redari@gazpet.ro`, `hd=gazpet.ro`. `login_hint` și `hd` din cerere sunt **doar sugestii pentru ecranul Google, nu dovezi**: dovada e verificarea din tabel.
- La **refresh**, Google poate omite `id_token` și poate întoarce `scope` în altă formă: la refresh se verifică doar setul canonic de scope-uri (căsuța a fost verificată la callback). Fixture-uri reale pentru callback și refresh sunt criteriu de acceptanță (§8).
- Proiectele GCP: separate (*implicit (g)*, mai sus).

**Fișa a–e: `redari-mail-oauth`**
- **(a)**: răspunsurile Google (`code`, `state`, erori, răspunsul de token, `id_token`).
- **(b)**: un secret în Vault, rândul `red_mail_oauth_state`, un eveniment. Nu trimite mail. Atinge un drept puternic (accesul la căsuță), deci doar owner.
- **(c)**: `service_role` după poartă, pentru Vault (`fn_red_mail_secret_seteaza`, EXECUTE doar `service_role`, numai cele două nume).
- **(d)**:
  - `start`: doar owner (JWT + `is_owner` în cod și în RPC), `scop` ∈ {`citire`, `trimitere`} (trimiterea acceptată doar după ce migrarea F2 e aplicată). `state` aleator de 32 de octeți, salvat ca sha256, legat de `owner_id` + `scop`, expiră în 10 minute;
  - `callback` (GET, fără JWT): `state` consumat atomic (`UPDATE … WHERE sha = … AND consumat_la IS NULL AND expira_la > now() RETURNING`), owner-ul re-verificat, schimbul `code → token`, verificarea scope-urilor exacte și a căsuței (tabelul de mai sus). Orice nepotrivire → **revocare imediată** la Google și nimic salvat.
- **(e)**: fiecare conectare e o acțiune a owner-ului, logat ca `redari@` la Google. Înlocuirea unui token existent cere confirmare explicită.
- **Cine accesează secretul**: doar `redari-mail-citeste` (citire) și `redari-mail-trimite` (trimitere), prin RPC-ul din Vault. Niciun rol de aplicație.
- **Revocarea**: (1) kill-switch-urile din ERP; (2) acțiunea `revoca` (owner): revocare la Google + golirea secretului; (3) de rezervă, contul `redari@` → Securitate → Aplicații terțe, sau Admin Console → API controls; (4) parola `redari@` schimbată + sesiunile închise, la suspiciune; (5) notă în `registru_automatizari`.

### 2.4 Fișele a–e pentru celelalte automatizări
**Contractul de identitate pentru edge-urile pornite de un utilizator** (Cop r3 P2-04; se aplică la `redari-mail-fisier`, `redari-mail-trimite`, `redari-mail-oauth` / `start`, reconcilierea manuală, F4):
1. Identitatea vine **doar din JWT-ul din `Authorization`**, verificat cu `auth.getUser(jwt)` (refuză tokenurile expirate și sesiunile revocate). Niciun uid, rol sau nivel din body, query sau alte antete nu e luat în seamă (L08).
2. Autorizarea pe entitate se face **în BD**, în una din două forme, aleasă per RPC și scrisă în comentariul lui:
   - **(i)** RPC apelat **cu clientul utilizatorului** (JWT-ul lui): `auth.uid()` e utilizatorul final, iar RPC-ul (SECURITY DEFINER) recalculează nivelul și apartenența. Folosită la `fn_red_mail_fisier_autorizeaza`;
   - **(ii)** RPC de serviciu (EXECUTE doar `service_role`) care primește `p_apelant` = **exclusiv** uid-ul întors de `getUser` și recalculează drepturile din `profiles` / `user_module_access` (excepția de cale server din L08). Folosită la `fn_red_mail_rezerva` (ca `fn_sms_rezerva`).
3. Clientul `service_role` se folosește pentru Storage și pentru operațiile privilegiate **numai după** ce RPC-ul de autorizare a întors „da”, și numai pe obiectul / lotul autorizat (calea vine din RPC, nu din cerere).
4. Teste: editor cu `obiect_id` al unui mesaj pe care nu-l poate vedea → 404 generic; uid de owner pus în body / query → ignorat; JWT expirat sau sesiune revocată → 401; cheia anon ca JWT → 401.

**`redari-mail-citeste` (F1)**
- **(a)**: tot ce intră în `redari@` (antete, corp, atașamente) + SENT (antete, `X-Gazpet-Redari`, atașamentul la reconciliere).
- **(b)**: scrie `red_mail_primite` / `_obiecte` / `_evenimente`, obiecte în `mail/`, cursoarele; la reconciliere doar `necunoscut → trimis` + `data_expediere`; alertele SENT. **Nu trimite, nu modifică Gmail.** (a) ∩ (b) doar ca date.
- **(c)**: `service_role` după poartă: nimeni din aplicație nu are voie să fabrice un mesaj primit sau proveniența lui (L08). RPC-uri cu EXECUTE doar `service_role`.
- **(d)**: cron cu `x-intern-secret` sau owner (reconcilierea manuală și admin). Teste: anon 401, utilizator obișnuit 403.
- **(e)**: nu trimite. Efectele le face omul. Activarea: owner, după §2.7.

**`redari-mail-trimite` (F2 + F3)**
- **(a)**: adresele din contact; la F3 antetele mesajului la care se răspunde.
- **(b)**: **trimite mail extern** din `redari@` (PII), scrie `red_mail_mesaje`, `red_convocari`. Nu citește căsuța.
- **(c)**: `service_role` după poartă; RPC-urile re-verifică nivelul apelantului (`p_apelant`).
- **(d)**: owner sau admin Redări (`poartaModul.ts` + nivel în BD), doar loturi aprobate. Teste: anon 401, viewer / editor 403 la pornire, lot modificat după aprobare refuzat.
- **(e)**: orice trimitere = lot aprobat de owner pe `lot_sha256`. F3 = lot de 1. Un mail primit nu declanșează nicio trimitere.

**`redari-mail-fisier` (F1, proxy de descărcare)**
- **(a)**: niciun conținut extern interpretat; transmite octeții unui obiect deja stocat.
- **(b)**: nu scrie altceva decât evenimentul de descărcare și jurnalul de egress.
- **(c)**: `service_role` pentru citirea din Storage (prefixul `mail/` nu are politici pentru utilizatori), după autorizarea în RPC.
- **(d)**: utilizator logat; nivelul, apartenența obiectului și starea se verifică în `fn_red_mail_fisier_autorizeaza`. Teste: viewer 403, editor pe `.eml` 403, `obiect_id` al altui mesaj / golit / respins → 404 generic.
- **(e)**: fiecare descărcare e o acțiune explicită a unui om.

**`redari-mail-retentie` (F1, oprită)**
- **(a)**: nimic extern; rândurile proprii, termenele, lista prefixului `mail/`.
- **(b)**: **șterge** obiecte din `mail/` și golește coloane — ireversibil. **Automat doar**: mesajele `ignorat` (marcate de un om, cu motiv) la 90 de zile, adresele propuse expirate, obiectele orfane. **Niciodată automat**: `nou`, `neprocesabil`, `asociat`, `rezolvat`, mesajele trimise (§1.8).
- **(c)**: `service_role` (DELETE în Storage + coloane închise pentru roluri), prin RPC-urile mașinii de stări.
- **(d)**: cron cu `x-intern-secret`; owner `?dry=1` (numărătoarea a ce ar goli, pe categorii, fără nicio ștergere).
- **(e)**: activarea = „da” după un dry-run. Golirea corespondenței asociate / trimise = operație cu „da” la termenul proiectului. Blocajul legal oprește golirea (§1.8).

### 2.5 F4 — sugestii AI (opțional)
- **(a)** subiect și corp (extern, ostil). **(b)** doar `red_mail_sugestii` (enum + încredere + offset-uri); costă bani. **(c)** `service_role`, `ANTHROPIC_API_KEY` prin `_shared/haiku55.ts`. **(d)** admin / editor pe un mesaj, owner pe mai multe; fără cron; cost rezervat înainte (L22). **(e)** sugestia doar se afișează.
- Model fără unelte, fără web, fără BD, `max_tokens` mic; ieșire validată strict (L21).
- **Verificare GDPR separată** înainte de activare: furnizorul AI ca sub-împuternicit (DPA, loc, transfer, retenția la furnizor), autorizarea Transgaz.

### 2.6 Riscuri și măsuri
- **Anti prompt-injection**: F1–F3 fără model AI pe mailuri. Textul primit nu ajunge ca instrucțiune la un model cu unelte (nici la sesiunile Claude: pct. 10).
- **Atașamente**: listă albă PDF / JPEG / PNG pe octeții magici, ca **filtru de tip, nu certificat de inofensivitate** (un PDF poate fi poliglot sau conține JavaScript). De aceea nimic nu se deschide, randează, convertește, OCR-izează sau trimite la AI automat; descărcarea e doar fișier (`octet-stream`, `nosniff`), iar ghidul operatorului cere deschiderea cu cititorul PDF din sistem, nu în browser. Respinse (durabil, doar metadate): executabile, arhive, HTML, SVG, Office cu macro, `.eml` încuibate.
- **Linkuri**: doar text, neclicabile, nicio imagine la distanță, ERP-ul nu urmează linkuri.
- **`Authentication-Results`, frontiera de încredere** (Jak P2-05):
  - proprietatea pe care ne bazăm: la mesajele **primite din internet prin MX-ul Google**, Google adaugă deasupra tuturor antetelor existente un `Authentication-Results` cu `authserv-id` = `mx.google.com`. Expeditorul nu poate scrie deasupra lui;
  - regula: se citește **doar antetul cel mai de sus**; e de încredere doar dacă `authserv-id` = `mx.google.com` **și** mesajul a intrat pe traseul MX (primul `Received` de sus e al Google, eticheta nu indică import / POP);
  - precondiție F1 (Admin Console, Razvan): `redari@` **fără** reguli de rutare, import, POP sau redirecționare spre / dinspre serverul local. Altfel proprietatea nu se aplică;
  - **când proveniența nu se poate stabili** (antet absent, `authserv-id` diferit, traseu non-MX, mesaj intern din domeniu, antete duplicate în blocul de sus) → `auth_sursa = 'necunoscut'`, afișat „necunoscut”, nu „pass”;
  - **confirmarea empirică** a proprietății pe fixture-uri reale e criteriu de acceptanță F1 (§8);
  - în orice caz rezultatul e **informativ**: `dmarc=pass` dovedește domeniul, nu persoana, și nu e folosit în nicio decizie automată.
- **Spoofing**: `From` / `Reply-To` falsificabile. Asocierea după expeditor sau cod nu dovedește identitatea (§1.10). Răspunsul pleacă implicit la contact (§1.7). `Reply-To` diferit de `From` → steag `reply_to_diferit`, iar ERP-ul nu răspunde niciodată la `Reply-To`.
- **PII în loguri**: `console.*` doar coduri; răspunsuri HTTP doar contoare; Sentry cu `src/redari/sentryScrub.js`; `red_jurnal` doar numele câmpurilor pe `red_mail_*`; adrese mascate în liste.
- **Teste ostile obligatorii (F1)**: `From` falsificat cu adresa unui deținător; `Reply-To` diferit de `From`; **două antete `From`**; `Authentication-Results: mx.google.com; dmarc=pass` pus de expeditor sub cel real; **fără antet autentic, cu un `Authentication-Results: mx.google.com` fals** (fixture de traseu non-MX) → `necunoscut`; **două `Authentication-Results` în blocul de sus**; două `Message-ID`; `Message-ID` refolosit (coliziune); cod valid copiat de pe un plic; subiect cu `\r\n`; atașament `.pdf` care e ZIP; **PDF poliglot** (PDF valid + ZIP / HTML) → stocat ca PDF doar ca fișier descărcabil, niciodată randat; MIME adânc / 500 de părți; răspuns `full` peste plafon; corp cu instrucțiuni injectate → nicio acțiune; `Date` retrodatat cu 1 an → retenția după `internalDate`.

### 2.7 GDPR — condiții înainte de F1 pe date reale
F1 se poate livra și testa cu `citire_activa = false` și cu mailuri interne de test. **Activarea pe căsuța reală** cere toate:
1. **Cadrul contractual**: contractul / împuternicirea Transgaz permite comunicarea pe e-mail și prelucrarea mailurilor primite de Gazpet în numele Transgaz.
2. **Sub-împuternicitul Google**: autorizarea scrisă a Transgaz (art. 28(2)); Cloud Data Processing Addendum acceptat; locul datelor și transferurile (SCC / DPF) la dosar.
3. **Informarea aplicabilă** pe canalele unde apare `redari@`: scop, temei, destinatari (inclusiv Google), retenție, transferuri, drepturi. `text_gdpr` implicit nu menționează azi e-mailul; informarea v3 (PR #939 draft) nu e în repo.
4. `retentie_mail_pana` fixat pe proiect.
5. Precondiția de traseu de la §2.6 (fără rutare / import / POP).

F1b cere în plus informarea din formular și procedura de confirmare a adreselor (Juridic). F2: textul mailurilor validat de Juridic + DKIM / DMARC. F4: verificarea separată (§2.5).

---

## 3. Felii de livrare (cu dependențele)

Porți comune: branch din `origin/main`; GO Jakarinos + Copilot pe diff; DRY verde pe prod (gardă de start, o tranzacție, postcondiții, `_ROLLBACK.sql` care nu șterge date, L14); build `npx vite build`; rând în `automatizari` + secțiune în `registru_automatizari` (fișa a–e, doar nume de secrete). Merge / deploy / apply: sesiunea de programare, după GO. **Activarea citirii, a trimiterii, a `extern_permis`, a retenției, importul istoric și fiecare conectare OAuth cer „da”-ul lui Razvan.**

**Ordinea internă în F1** (Cop §6): (1) schema + RLS + politicile Storage + modificările la `red_jurnal_sel` / `fn_red_jurnal` + regresii pe `red_raspunsuri`; (2) OAuth de citire cu verificarea căsuței; (3) ingestia (inițializare, lease, cursor, recuperare, manifest) pe fixture-uri; (4) UI de triere / asociere / verificare / înregistrare răspuns; (5) proxy-ul de descărcare; (6) retenția, livrată oprită, cu termene și blocaje testate; (7) abia după §2.7: activarea controlată.

### F0 — Pregătire (fără cod de producție)
§4 (fără conectarea OAuth); condițiile §2.7 pornite (Juridic, Transgaz); DKIM / DMARC; verificarea traseului `redari@` (fără rutare / import / POP).

### F1 — Primirea + schema minimă comună
- **Migrare: da.** `red_mail_setari` (coloanele de citire), `red_mail_flux` (rândul `inbox`), `red_mail_primite`, `red_mail_obiecte`, `red_mail_evenimente`, `red_mail_raspuns_sursa`, `red_mail_adrese_propuse`, `red_mail_oauth_state`, `red_proiecte.retentie_mail_pana`; RPC-urile §1.1–1.2, §1.8, §1.10–1.11, §2.1 (numărătorile), §2.3 (Vault, state); triggerele de proveniență pe `red_raspunsuri` (constraint trigger amânat, `BEFORE UPDATE` pe `canal`, `BEFORE UPDATE` pe câmpurile rândurilor din mail) + preflight-ul pe răspunsurile `email` preexistente; modificarea `red_jurnal_sel` și a `fn_red_jurnal` pentru `red_mail_*`; politicile Storage pentru `mail/`; vederile noi. Cronurile se creează oprite. **`red_v_stare_parcela` nu se modifică** (r2 o modifica; r3 n-are nevoie, §1.10).
- **Edge: da.** `redari-mail-oauth` (doar `citire`), `redari-mail-citeste` (INBOX; monitorizarea SENT și reconcilierea vin în F2), `redari-mail-fisier`, `redari-mail-retentie`, `_shared/gmailCitire.ts`.
- **UI: da.** `src/redari/ui/MesajeEcran.jsx` (Nou / De triat / Asociat / Rezolvat / Ignorat, firul, indiciile cu conflicte, autentificarea cu „necunoscut”, steagurile, verificarea, atașamentele prin proxy, „Înregistrează răspuns” → RPC-ul atomic, adresele propuse din mail); „Istoric e-mail” pe `FisaParcela.jsx` (admin / editor); contorul pe Dashboard (pentru viewer prin RPC-ul de numărători); panoul owner (comutatoare, activare, termen, conectare / revocare OAuth de citire).
- **Amânate explicit în F2**: indiciul de fir, reconcilierea, monitorizarea SENT, opt-out-ul (în F1 doar steagul `cere_dezabonare`), OAuth de trimitere.
- **DRY / teste**:
  - cursor: inițializare (*b*), `startHistoryId` fix, rezultat gol, oprire la mijloc, 404 → recuperare cu cursor capturat înainte, `pageToken` invalid → restart, lease expirat înainte de salvarea checkpoint-ului, două rulări concurente, `historyId` > `Number.MAX_SAFE_INTEGER`;
  - ingestie: crash după rând / după un obiect / înainte de finalizare → reluare completă; obiect orfan; conflict de sha; dispărut / neprocesabil / tranzitoriu;
  - dedup și coliziuni; secvența metadata → full → attachments cu plafoane;
  - testele ostile §2.6;
  - **viewer prin API** (§2.1), editor fără `.eml`, politicile Storage ca non-owner;
  - proveniența: INSERT direct `canal = email` refuzat, schimbarea `canal` refuzată, PATCH ca editor pe fiecare câmp protejat al unui răspuns din mail → refuz fără urmă în jurnal, RPC-ul atomic (eșec la mijloc → nimic scris), idempotența (concurență, reluare, conflict), asociere înghețată după înregistrare, răspunsurile `email` preexistente neatinse, un mail neverificat nu apare în `ultimulRaspuns` / PV / export / `deja_raspuns`;
  - contractul de identitate (§2.4, punctul 4);
  - fluxurile INBOX / SENT: ambele cursoare expirate, întrerupere și reluare fără suprascriere reciprocă (cu rândul `sent` din fixture);
  - `?dry=1`: nicio scriere în afara evenimentului, niciun `full` / `raw`; modul test: un mesaj real (nu `redari+test@`) nu e citit dincolo de `Delivered-To`;
  - retenția în dry-run și pe fixture-uri: `nou` de 120 de zile **nu** se golește (doar alertă), `neprocesabil` vechi nu se golește, `ignorat` la 90 de zile de la `ignorat_la` se golește, asociat marcat greșit `ignorat` apoi `redeschide` nu se golește, propunere din formular neconfirmată la 180 de zile, blocaj cerut în timpul `in_golire` cu două procese de retenție intercalate, eșec după ștergerea parțială, `Date` retrodatat; după golire, **fiecare coloană** din inventar e verificată (NULL / HMAC);
  - callback OAuth: state expirat / refolosit / alt owner, scope în plus / lipsă, altă căsuță → revocare.
- Probă pe prod: înainte de §2.7 doar **modul test** (`redari+test@`, mesaje trimise din căsuțe interne); după §2.7, `?dry=1` de owner, apoi activarea.

### F1b — Câmpul de e-mail în formularul public (*implicit (a)*)
- **Migrare: da**: `fn_red_raspuns_public` primește un câmp opțional `email`, validat, scris **doar** în `red_mail_adrese_propuse` (`sursa = formular_public`), cu rate limit-ul existent. **UI**: `RedariRaspunsPublic.jsx` + informarea.
- Depinde de F1 (tabelul) și de §2.7 punctul 3 + procedura Juridic de confirmare.
- DRY + teste ca anon: injecție, adresă invalidă, prima introducere malițioasă (contact gol → rămâne gol, lotul F2 nu o vede).

### F2 — Trimiterea în loturi + reconcilierea + SENT
- **Migrare: da.** Coloanele de trimitere, `red_mail_loturi`, `red_mail_mesaje` (snapshot + triggere de imuabilitate, expirarea aprobării), `red_mail_optout`, cheia `M`, RPC-urile §1.3–1.5, §1.9, rândul `sent` în `red_mail_flux`, funcția canonică de hash (SQL + TS, paritate).
- **Edge: da.** `redari-mail-oauth` (scopul `trimitere`), `redari-mail-trimite` + `_shared/gmailTrimitere.ts`; în `redari-mail-citeste`: reconcilierea și monitorizarea SENT.
- **UI: da.** „✉️ Lot e-mail” (filtre, șabloane validate de Juridic, preview cu adresele complete, aprobare, „Trimite” cu progres, plafon atins), lista „de decis” pentru `necunoscut`, alertele SENT, setările, opt-out.
- **DRY / teste**: fiecare rând din tabelul de la §1.3 (inclusiv worker întârziat, eșec de persistare, `429` după `in_apel`), `apel_incepe` cu lease pierdut → niciun apel, snapshot / atașament schimbat, plafon la concurență (2 sesiuni + barieră, L25), ferestrele în `Europe/Bucharest` la miezul nopții și la schimbarea orei, lot 300 / plafon 200, opt-out între creare și rezervare, `extern_permis = false`, reconcilierea (exact 1 / 0 / 2 / `Cc` prezent / antet dublu / **antete și atașament identice dar corp modificat** / atașament în plus / paginare), SENT (fără rând ERP, identificatori refolosiți cu conținut diferit, duplicat), hash canonic stabil la două compuneri cu delimitatori diferiți, expirarea aprobării care nu atinge `in_apel` / `necunoscut`, MIME ostil.
- Probă: 3 adrese `@gazpet.ro`, apoi „da” pentru `extern_permis` și un prim lot ≤ 10.
- **Precondiții**: DKIM + DMARC, textul validat, §2.7.

### F3 — Răspuns pe fir
- **Migrare: mică** (`raspuns_fir`, `in_reply_to_primit_id`, alegerea destinatarului, „lot de 1”). **Edge**: `threadId` + antetele de fir, subiectul neschimbat, referința în corp. **UI**: „Răspunde” (ciornă → aprobare → trimite). **Teste**: subiect fără cod, contact ≠ expeditor (mesaj nou), fir corect pe o căsuță internă.

### F4 — Sugestii AI (opțional)
- **Migrare: da** (`red_mail_sugestii` + rezervarea costului). **Edge**: `redari-mail-sugereaza`. **UI**: insigna „sugestie”. **Teste**: §2.5 + injecții. **Precondiție**: verificarea GDPR separată.

---

## 4. Pașii manuali cu Razvan (fără valori, doar nume)

1. **Conturile AI nu primesc acces la `redari@`** (§2.2).
2. **Clienții OAuth**: Gmail API activat, ecran **Internal**, clienții Web „ERP Redări citire” și „ERP Redări trimitere” (redirect = URL-ul `redari-mail-oauth`), eventual în proiecte GCP separate; în Admin Console, aplicațiile marcate de încredere, limitate la scope-urile lor.
3. **Două ședințe de consimțământ** (*implicit (g)*): la activarea F1, Razvan, în ERP ca owner, apasă „Conectează citire”; la activarea F2, „Conectează trimitere” (butonul există doar după aplicarea F2). De fiecare dată Google cere logarea **lui** ca `redari@`. Tokenurile ajung direct în Vault. Clienții stau în proiecte GCP separate (*implicit (g)*).
4. **Secretele** (doar nume):
   - Edge Secrets: `REDARI_GMAIL_CITIRE_CLIENT_ID`, `REDARI_GMAIL_CITIRE_CLIENT_SECRET`, `REDARI_GMAIL_TRIMITERE_CLIENT_ID`, `REDARI_GMAIL_TRIMITERE_CLIENT_SECRET`;
   - Vault: `REDARI_GMAIL_CITIRE_REFRESH_TOKEN`, `REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN` (scrise de callback), `REDARI_MAIL_REF_SECRET`;
   - refolosit: `INTERN_EDGE_SECRET`; doar F4: `ANTHROPIC_API_KEY`;
   - **nu se refolosesc** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`.
5. **DNS / Admin Console**: DKIM + DMARC (§0.4); `redari@` fără rutare / import / POP / redirecționare; retenție în Google Vault; DPA acceptat.
6. **Juridic / Transgaz**: §2.7 + procedura de confirmare a adreselor (F1b).
7. **Registre**: rândurile în `public.automatizari` (citire, trimitere, oauth, fișier, retenție, F4) + secțiunea „E-mail Redări” în `registru_automatizari`, cu procedura de revocare.

## 5. Ce cere „da” separat
Fiecare conectare OAuth, `citire_activa` pe căsuța reală, importul istoric (dacă se cere), `retentie_activa`, `trimitere_oprita = false`, `extern_permis = true`, fiecare lot extern (aprobarea e „da”-ul), F1b, F4, orice corectare de răspuns deja înregistrat, golirea corespondenței asociate / trimise la termenul proiectului, ștergerea finală a metadatelor de audit, tratarea răspunsurilor `email` preexistente, fiecare decizie implicită din §7.1.

## 6. Ce NU face planul
Nu trimite către instituții (rămân în `red_corespondenta`). Nu înlocuiește poșta cu AR. Nu răspunde automat. Nu șterge și nu mută nimic în Gmail. Nu dă conturilor AI acces la căsuță. Nu folosește o adresă nevalidată de un om. Nu importă istoricul căsuței fără cerere.

---

## 7. Decizii închise (Razvan, 03.11.2026: toate variantele A)
1. **Acces**: clienți OAuth dedicați, refresh token în Vault prin callback doar owner (doi clienți, §2.3).
2. **Scope-uri**: `gmail.readonly` + `gmail.send` (+ `openid email` pe clientul de trimitere, pentru verificarea căsuței). „O singură autorizare” devine, *implicit (g)*, două ședințe (citirea la F1, trimiterea la F2), pentru că feliile se activează separat.
3. **Asocierea**: o confirmă mereu omul.
4. **Dezabonarea venită pe mail**: steag + confirmarea omului.
5. **Aprobarea loturilor**: doar owner-ul.
6. **Valoarea juridică**: e-mailul e canal suplimentar; poșta cu AR rămâne.
7. **Plafoane**: 200 / zi, 1.000 / lună, maximum 300 / lot.
8. **Retenția**: dosarul la termenul din `text_gdpr`; spam / irelevant golite după 90 de zile. Precizarea r4 (*implicit (e)*): doar mesajele marcate `ignorat` de un om se golesc automat; netriatele nu.
9. **Sursa adreselor**: operator + câmp opțional în formular (F1b) + adresa dintr-un mail, ultimele două doar ca propuneri confirmate de om.
10. **Cine vede mesajele**: admin + editor Redări; viewer doar numărători.
11. **DKIM / DMARC**: înainte de F2.
12. **Cronul de citire**: 5 minute.

### 7.1 Decizii implicite — de confirmat de Razvan înaintea feliei indicate
Regula (Jak r3 P3-02): comportamentul care depinde de o decizie din tabel **nu se implementează** până nu are data confirmării completată aici (PR de documentație). O decizie respinsă redeschide secțiunea respectivă din plan înainte de felie.
| Cod | Decizia implicită | Unde | Înainte de | Confirmat (data, de către) |
|---|---|---|---|---|
| (a) | Adresele din formular / din `From` rămân „propuse” până le confirmă un om; neeligibile pentru loturi | §1.11 | F1 (tabelul) / F1b | — |
| (b) | Prima activare citește doar de atunci înainte; importul istoric doar la cerere, separat | §1.1 | F1 | — |
| (c) | Viewer-ul nu vede conținut de mail; excepția: în `red_raspunsuri` vede canal, opțiune, dată, zi și referința fixă | §2.1 | F1 | — |
| (d) | Răspunsul din mail intră în Registru doar verificat, fără text copiat, cel mult unul per (mesaj, deținător), apoi neschimbabil prin API | §1.10 | F1 | — |
| (e) | Nicio golire automată pentru `nou` / `neprocesabil` / `asociat` / `rezolvat` / trimise; automat doar `ignorat` (om + motiv), la 90 de zile de la marcare; alertă la 60 de zile pentru netriate | §1.8 | F1 (retenția) | — |
| (f) | Metadatele de audit păstrate până la `retentie_mail_pana`; adrese propuse golite la 180 de zile (neconfirmate) / 30 de zile (respinse) | §1.8 | F1 (retenția) | — |
| (g) | Clienții OAuth în proiecte GCP separate; două ședințe de consimțământ (F1, F2) | §2.3, §4 | F1 (citire) / F2 (trimitere) | — |
| (h) | Aprobarea unui lot expiră după 7 zile, doar pentru `in_coada` | §1.3 | F2 | — |

---

## 8. Rămâne pentru implementarea F1 / F2 (cu criteriul de acceptanță)
| Felie | Ce | Criteriul de acceptanță |
|---|---|---|
| F1 | Proprietatea `Authentication-Results` pe traseul real al `redari@` | Fixture-uri reale (expeditor gmail.com, yahoo, intern `@gazpet.ro`, redirecționat, cu antet fals): rezultatul e `pass` / `fail` doar pe traseul MX confirmat, altfel `necunoscut`; capturile atașate la PR (fără PII) |
| F1 | Decodarea codării de transfer în `format=full` | Fixture-uri reale base64 / quoted-printable / charset necunoscut / HTML-only: textul afișat corect, steagurile corecte |
| F1 | Durata backup-urilor Supabase (PITR / zilnice) | Valoarea citită din dashboard și trecută în informare + `registru_automatizari` |
| F1 | Regula „nu lipi conținut de mail în câmpuri vizibile viewer-ului” | Ghidul operatorului actualizat; UI-ul nu are „copiază din mail” în afara `red_mail_*` (verificat la review) |
| F1 | Corectarea unui răspuns înregistrat greșit | F1 o blochează (trigger testat); până la o felie de anulare, owner-ul o face ca operație pe date reale (pct. 3) |
| F1b | Procedura Juridic de confirmare a adreselor propuse | Text aprobat, metoda de verificare în enum, fără mail automat de confirmare |
| F2 | Semantica lui `429` / `403 rateLimitExceeded` | Tratat ca `necunoscut` (tabelul §1.3); dacă documentația Google confirmă neacceptarea sigură, se poate trece prin owner la „repune în coadă” cu același `Message-ID`, după o reconciliere negativă |
| F1 | Răspunsurile `canal = 'email'` preexistente | Numărate și listate de preflight; dacă > 0, Razvan decide (lăsate / `manual_verificat`) înainte de apply, ca operație pe date reale |
| F1 | Modul test pe căsuța reală (`Delivered-To` al mesajelor reale citit înainte de §2.7) | Acceptat de Juridic; altfel o căsuță de test separată, iar codul are aceeași cale de test |
| F1 / F2 | Scope-urile întoarse de Google | Fixture-uri reale ale endpoint-ului de token (callback + refresh, pentru ambii clienți); normalizarea acoperă doar echivalențele din lista închisă; orice altceva → oprire |
| F1 | Temeiul păstrării metadatelor de audit | Confirmat de Juridic (decizia (f)); trecut în informare |
| F2 | `X-Gazpet-Redari` păstrat în copia din SENT; corpul decodat din SENT dă aceeași formă canonică | Test pe o căsuță internă: antetul există, iar hash-ul recalculat din SENT = `mesaj_sha256` (Gmail nu transformă corpurile `base64`) |
| F2 | Limitele Google la zi | Citite pe pagina oficială și notate; plafoanele proprii rămân sub ele |

---

## 9. Tabelul de rezolvare (r1 → r2 → r3 → r4)
Rezolvările marcate „cond. (x)” depind de o decizie implicită din §7.1 și se implementează doar după confirmarea ei.
| Runda / punct | Rezolvare |
|---|---|
| r1 Decizii (Jak P3-12, Cop P3-03) | r2: §7 închis; r3: + deciziile implicite (a)–(d) marcate |
| r1 Jak/Cop acces AI direct (Cop P1-01) | r2: §2.2; închis |
| r1 Cursor (Jak P1-1, Cop P2-01) | r2: §1.1; r3: completat (vezi r2 Jak P2-02, Cop P2-01/03) |
| r1 Dedup (Jak P1-2, Cop P2-02) | r2: §1.2; închis |
| r1 Crash la trimitere (Jak P1-3, Cop P2-05) | r2: §1.3–1.5; r3: completat (r2 Jak P2-07, Cop P2-08) |
| r1 Retenție (Jak P1-4, Cop P2-06) | r2: §1.8; r3: completat (r2 Jak P2-04, Cop P2-06) |
| r1 GDPR (Jak P1-5, Cop P2-07) | r2: §2.7; închis ca porți |
| r1 Token (Jak P2-6, Cop P2-03/04) | r2: §2.3; r3: seturi OAuth exacte (r2 Jak P2-03, Cop P2-07) |
| r1 Snapshot / MIME (Jak P2-7, Cop P3-02) | r2: §1.3, §1.6; închis |
| r1 `.eml` / atașamente (Jak P2-8, Cop P3-01) | r2: §1.8–1.9; r3: secvența corectată (r2 Jak P2-01, Cop P2-02) |
| r1 Asociere ≠ identitate (Jak P2-9) | r2: §1.10; r3: contractul complet (r2 Jak P1-02) |
| r1 Dependențe (Jak P2-10) | r2: §3; r3: F1b refăcut, OAuth trimitere în F2 |
| r1 Fir Gmail (Jak P2-11) | r2: §1.7; închis |
| **r2 Jak P1-01** viewer prin tabelele existente | §2.1: `red_jurnal_sel` + `fn_red_jurnal` pentru `red_mail_*`, RLS / vederi / RPC de numărători; §1.10: în `red_raspunsuri` nu intră text din mail; test API ca viewer |
| **r2 Jak P1-02** contractul de verificare pentru toți consumatorii | §1.10: doar răspunsuri verificate intră în Registru, RPC atomic, constraint trigger amânat, `canal` imuabil, asociere înghețată; consumatorii inventariați la §0.3, neschimbați prin construcție; corectarea → §8 |
| **r2 Jak P1-03** recuperarea BD ↔ Storage | §1.2: `in_curs` + manifest `red_mail_obiecte`, reluare idempotentă, finalizare, cursor doar pe mesaje finale, orfane curățate zilnic |
| r2 Jak P2-01 `metadata` fără MIME | §1.1: secvența metadata → full (plafon) → attachments → raw, plafoane pe HTTP / base64 / decodat, reguli de decodare |
| r2 Jak P2-02 inițializare și progres | §1.1: prima activare (*implicit b*), reluarea în pagină / înregistrare, `pageToken` invalid → restart, `data_start` `timestamptz` + epoch, `historyId` șir / `numeric` |
| r2 Jak P2-03 OAuth contradictoriu | §2.3: seturile exacte per client, getProfile pentru citire, `id_token` validat local pentru trimitere, `include_granted_scopes=false`, scope verificat la fiecare refresh |
| r2 Jak P2-04 retenția: copii și concurență | §1.8: tabelul copiilor (inclusiv backup-uri, Gmail), `retentie_stare` în schemă, protocolul cu blocajul (verificare înainte de fiecare DELETE), mesajele `nou` |
| r2 Jak P2-05 frontiera `Authentication-Results` | §2.6: proprietatea traseului MX, precondiția fără rutare / import, `necunoscut` la proveniență nestabilită, teste; confirmarea empirică → §8 |
| r2 Jak P2-06 monitorizarea SENT | §1.4: cursor SENT separat, checkpoint + suprapunere, corelare, alertă; reconcilierea cu antete duplicate, `Cc` / `Bcc`, paginare |
| r2 Jak P2-07 contractul operațional | §1.3: tabelul complet (inclusiv `429` după `in_apel`, 200 neinterpretabil, eșec de persistare, worker întârziat); §1.9: ferestre `Europe/Bucharest`, contabilizarea pe `(mesaj_id, rezervare_nr)`, lot 300 / plafon 200 |
| r2 Jak P3-01 OAuth trimitere | Doar în F2 (§2.3, §3, §4) |
| r2 Jak P3-02 teste ostile | §2.6: `Reply-To`, PDF poliglot, `From` / `Authentication-Results` duplicate |
| **r2 Cop P1-01** F1b, adresă anonimă | §1.11 (*implicit a*): doar `red_mail_adrese_propuse`, confirmare umană, neeligibilă pentru loturi, test de primă introducere malițioasă |
| r2 Cop P2-01 inițializarea cursorului | §1.1 (*implicit b*): `neinitializat`, captură sub lease, fără import retroactiv; importul istoric separat, cu epoch și suprapunere |
| r2 Cop P2-02 `metadata` | ca Jak P2-01 |
| r2 Cop P2-03 lease pe progres, `pageToken`, `historyId` | §1.1: CAS pe lease + versiune + stare pe toate scrierile, restart la `pageToken` invalid, `numeric(20,0)` / șir; teste în F1 |
| r2 Cop P2-04 URL-uri semnate | §1.8: proxy edge `redari-mail-fisier` (autorizare RPC + flux + jurnal pe fiecare transfer), fără URL semnat; fișa la §2.4 |
| r2 Cop P2-05 consumatorii `red_raspunsuri` | ca Jak P1-02 (varianta conservatoare, *implicit d*); fără invariant dublu: verificarea stă pe `red_mail_primite`, iar `red_mail_raspuns_sursa` există doar pentru verificate |
| r2 Cop P2-06 retenție: netriate, blocaj în `in_golire` | ca Jak P2-04: termen 60 / 90 de zile pentru `nou`, mașina de stări, teste |
| r2 Cop P2-07 OAuth inconsistent | ca Jak P2-03 + o singură regulă de livrare (trimiterea în F2) |
| r2 Cop P2-08 `apel_incepe` + conținutul la reconciliere | §1.3: CAS cu rezultat explicit, niciun apel fără el; §1.4: `X-Gazpet-Redari` + sha-ul atașamentului |
| r2 Cop P3-01 antetul `Date` | §1: timpul de încredere = `internalDate`; `Date` → `data_declarata`; test de retrodatare |
| r2 Cop P3-02 README | Rândul din `docs/redari/README.md` reformulat: trimiterea cere lot aprobat de owner; citirea, reconcilierea și retenția sunt automatizări separate, activate explicit de owner |
| **r3 Jak P1-01** răspunsul înregistrat modificabil prin API | §1.10: trigger `BEFORE UPDATE` pe rândurile cu sursă e-mail (toate câmpurile de conținut / rezultat / dată / proveniență), referința fixă impusă la INSERT și UPDATE; test PATCH ca editor pe fiecare câmp, fără urmă în jurnal — cond. (d) |
| r3 Jak P2-01 / Cop P2-02 idempotența înregistrării | §1.10: `FOR UPDATE` pe mesaj, `UNIQUE (primit_id, detinator_id)`, `cerere_sha256`, reluare identică → același `raspuns_id`, cerere diferită → conflict; test concurent — cond. (d) |
| r3 Jak P2-02 inventarul retenției | §1.8: inventar pe coloane (note, motive, `antete_snapshot`, propuneri fără mesaj), termen propriu pentru propuneri, excepția din triggerul de imuabilitate al snapshotului (§1.3); test pe fiecare coloană — cond. (f) |
| r3 Jak P2-03 / Cop P3-02 scope-uri echivalente | §2.3: cerute vs. set canonic, listă închisă de echivalențe (`email` ≡ `userinfo.email`), verificare la callback și la refresh, `scope` absent = oprire; fixture-uri reale → §8 |
| r3 Jak P2-04 revocarea comună în același proiect GCP | §2.3: proiecte GCP separate — cond. (g); varianta „același proiect” doar explicit, cu oprirea și reconectarea ambelor fluxuri |
| r3 Jak P2-05 reconcilierea nu verifică corpul | §1.3: forma canonică (RFC 8785, NFC, `\n`, fără `X-Gazpet-Redari` / delimitatori); §1.4: hash recalculat din copia SENT, manifest complet de atașamente, `h=` doar indiciu; SENT: `trimis_modificat` / `trimis_duplicat`; test cu corp modificat |
| r3 Jak P2-06 starea comună a două cursoare | §1.1: `red_mail_flux` cu cheie `(casuta, flux)`, lease și checkpoint pe flux; rândul `sent` creat la F2, fără scanare retroactivă; test cu ambele cursoare expirate |
| r3 Jak P3-01 contractul `?dry=1` | §1.1: operații permise / interzise; dry pe căsuța reală doar după §2.7; modul test `redari+test@` (varianta cu căsuță separată în §8) |
| r3 Jak P3-02 deciziile implicite înaintea feliei | Introducere + §7.1: tabel cu felia și coloana „confirmat (data, de către)”; regula „nu se implementează până la confirmare”; în §9 rezolvările dependente sunt marcate „cond.” |
| **r3 Cop P1-01** ștergerea automată a netriatelor | §1.8: nicio golire automată pentru `nou` / `neprocesabil` / asociate / trimise; automat doar `ignorat` (om + motiv), la 90 de zile de la marcare; alertă la 60 de zile; asociatele la termen doar cu „da”; §2.4 (b) actualizat — cond. (e) |
| r3 Cop P2-01 fereastra blocajului legal | §1.8: lease global de retenție, claim exclusiv per mesaj, ștergere secvențială cu `in_stergere`, blocaj `cerut` → `activ`; garanția „cel mult obiectul deja în ștergere”; test cu două procese + admin |
| r3 Cop P2-03 răspunsurile `email` preexistente | §1.10: preflight cu numărătoare, constraint trigger doar pe rânduri noi, decizia pe cele vechi la Razvan (§8); RPC manual `manual_verificat` pentru e-mailuri primite pe alt circuit |
| r3 Cop P2-04 identitatea la RPC-urile din edge | §2.4: contractul JWT → `getUser` → RPC (cu clientul utilizatorului sau `p_apelant` doar din `getUser`) → `service_role` doar după autorizare; teste (alt `obiect_id`, uid falsificat, JWT revocat) |
| r3 Cop P2-05 metadatele rămase, propuneri din formular | §1.8: două categorii (conținut / audit), temei și termen pentru audit, `gmail_id` → HMAC, „pseudonimizare, nu anonimizare”; termen pentru propuneri, inclusiv cele fără `primit_id` — cond. (f) |
| r3 Cop P2-06 „o singură ședință OAuth” contradictoriu | §2.3, §4, §7: două ședințe, câte una pe felie — cond. (g) |
| r3 Cop P2-07 canonicalizarea hash-ului | §1.3: forma canonică, fără dependență circulară, stabilă între compuneri; test cu delimitatori diferiți |
| r3 Cop P3-01 excepția viewer-ului | §2.1: câmpurile pe care viewer-ul le vede din `red_raspunsuri` enumerate explicit + lista pozitivă în test — cond. (c) |
| r3 Cop P3-03 expirarea aprobării pe stări | §1.3: expirarea atinge doar `in_coada`; `in_apel` / `necunoscut` / `trimis` / `esuat_*` neschimbate; test — cond. (h) |
