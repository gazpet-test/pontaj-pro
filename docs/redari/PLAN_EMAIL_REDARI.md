# Plan: e-mail Redări prin `redari@gazpet.ro` — r2 (03.11.2026)

Doar plan de design: fără cod de producție, fără scrieri în BD, fără secrete. Fiecare felie se livrează separat, cu porțile ei.
**r2** = revizia după NO-GO Jakarinos + Copilot pe r1. Schimbările sunt enumerate la §8.

**Deciziile lui Razvan (03.11.2026)**
- Căsuța `redari@gazpet.ro` există (Google Workspace). Autorizarea Gmail API o facem împreună, într-o singură ședință.
- **Trimitere** ERP → proprietari: **fără niciun automatism**. Fluxul: lot → aprobare → trimitere, ca la SMS. Mailurile către instituții rămân în 📨 Corespondență (`red_corespondenta`), cu „da” pe fiecare rând.
- **Primire**: răspunsurile intră în ERP, se asociază proprietarului sau parcelei și se centralizează pe „📥 Mesaje Redări” (nou → asociat → rezolvat), plus istoricul pe fișa proprietarului.
- Conținutul primit e **extern** (CLAUDE.md pct. 7 și 10). ERP-ul nu face nicio acțiune automată pe baza lui. AI-ul poate doar sugera, iar omul confirmă.
- **Toate variantele A de la §7 sunt acceptate** (decizii închise).

**Surse citite**: `CLAUDE.md`, `docs/paw/LECTII_REVIEW.md` (L01–L25), `docs/sms/RAPORT_SMS_2026-11-03.md`, migrările `20261130a_sms_mvp.sql` / `20261130b_sms_acces_modul.sql`, `20261126a_redari_teren.sql`, `20261129h_redari_corespondenta.sql`, `docs/redari/README.md`, `SABLOANE.md`, `CONTRACT_SCHEMA.md`, edge-urile `redirect-mai-gov`, `noutati-mail`, `ofertare-rfq-inbox`, `ingest-document`, `vicare`, `olx-api`, plus `claude_docs.registru_automatizari` (doar SELECT pe rândurile despre mail/Gmail) și DNS-ul public al `gazpet.ro` (TXT/MX, citit 03.11).

---

## 0. Ce există și ce se refolosește

### 0.1 Gmail API în platformă azi
| Ce | Cum funcționează | Se refolosește? |
|---|---|---|
| `redirect-mai-gov` (repo, v9) | OAuth2 cu refresh token pe **o singură căsuță** (`razvan.trusu@`): `oauth2.googleapis.com/token` → access token → `gmail/v1/users/me/messages`. Idempotență `UNIQUE gmail_msg_id`, rândul scris ÎNAINTE de acțiune. Poarta `esteApelIntern` (cron cu `x-intern-secret`) sau owner. Răspuns HTTP doar cu stări din listă fixă (`pg_net` îl păstrează). | **Tiparul**: da (token, `findBody`, poarta, răspuns fără PII). **Secretele**: nu. |
| `productie-mail-facturi`, `import-evogps-gmail` | Aceleași `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (Edge Secrets), pe căsuța lui Razvan / `automatizari@`. | Nu. |
| `ofertare-rfq-inbox`, `ingest-document` | Apps Script de pe căsuță → edge, cu secret în antet. | Nu (decizia 1A). |
| `noutati-mail`, `send-factura-email` | Resend de pe `rapoarte@` / `facturi@`, claim atomic înainte de trimitere. | Tiparul de claim, da. Canalul, nu: răspunsurile trebuie să vină în `redari@`. |
| `vicare`, `olx-api` | Callback OAuth doar owner, `state` aleator consumat atomic, refresh token scris în **Vault** prin RPC. | **Da**, pentru callback-ul de la §2.3. |

### 0.2 Delegare pe domeniu vs. refresh token pe căsuță
- **Delegarea pe domeniu** (service account): un secret care citește și trimite din orice căsuță `@gazpet.ro`. **Exclusă.**
- **Refresh token pe căsuță**: vede doar `redari@`, doar cu scope-urile acordate. Se folosește, cu secrete proprii (L10), separate de cele ale lui Razvan.
- Consimțământul se dă **logat ca `redari@`**. Ecranul de consimțământ e **Internal** (doar `gazpet.ro`; o aplicație externă în „Testing” are tokenuri de 7 zile — de verificat în GCP).

### 0.3 Redări azi
- `red_detinatori_contact.email`: 0 adrese din 2.548. Convocatorul tipărit are deja `{{contact_email}}` = `redari@gazpet.ro`, deci primul câștig e primirea.
- `red_convocari.canal` și `red_raspunsuri.canal` acceptă `email`. `nr_document` = `C-nnnn` (`fn_red_numar_document`, `red_numere`, nerefolosite).
- `red_corespondenta` rămâne doar evidență, fără trimitere.
- Decizia 6 (01.11): răspunsul public nu trimite nimic. Planul nu o schimbă.
- **Bucketul `redari`**: `red_storage_sel` / `red_storage_ins` dau SELECT și INSERT pe **tot** bucketul pentru admin/editor; nu există UPDATE/DELETE (fișiere imutabile). Planul schimbă asta explicit pentru prefixul `mail/` (§1.8).

### 0.4 SPF / DKIM / DMARC `gazpet.ro` (DNS public, 03.11.2026)
- MX = Google. `redari@` trebuie să fie căsuță Google reală, nu rutată spre serverul local.
- SPF: `v=spf1 a mx ip4:<IP firmă> include:_spf.google.com ~all`.
- **DKIM Google lipsește** (`google._domainkey` inexistent; există doar `resend._domainkey`).
- **DMARC `p=none`, fără `rua`**.
- Precondiție F2: DKIM Google pornit, apoi DMARC cu `rua`, `p=none` 2 săptămâni, apoi `p=quarantine` (decizia 11A).

---

## 1. Arhitectura

```
                    ┌──────────── redari@gazpet.ro (Gmail) ────────────┐
  token CITIRE      │ history.list / messages.get / attachments.get     │   token TRIMITERE
  (gmail.readonly)  │ messages.list in:sent rfc822msgid: (reconciliere) │   (gmail.send)
                    └───────────────────────────────────────────────────┘
        ▲ redari-mail-citeste (cron 5 min, lease)          ▲ redari-mail-trimite (doar UI, lot aprobat)
        │                                                   │
  red_mail_primite / _atasamente / _evenimente      red_mail_loturi → red_mail_mesaje (snapshot imuabil)
  .eml în mail/carantina/, atașamente în mail/atasamente/         ▲ aprobare owner pe hash
        │ indicii de asociere (fir / cod / expeditor) + conflicte │
        ▼                                                          │
  📥 Mesaje Redări: nou → asociat → rezolvat  (+ verificare: neverificat → verificat_*)
        │                                          (F3) răspuns pe fir = lot de 1 ──┘
        └─► fișa proprietarului: istoric          redari-mail-retentie (cron zilnic) → golește la termen
```

**Două coduri și două identități separate**, nu un modul comun pentru tot:
- `_shared/gmailCitire.ts`: doar citire, primește doar secretele de citire. Folosit de `redari-mail-citeste` (inclusiv reconcilierea).
- `_shared/gmailTrimitere.ts`: doar `compuneMime` + `messages.send`, primește doar secretele de trimitere. Folosit de `redari-mail-trimite`.
- Un test static verifică faptul că niciun fișier de citire nu importă modulul de trimitere sau numele secretelor de trimitere (și invers).

### 1.1 Citirea: `redari-mail-citeste` (F1)
**Pornire și concurență**
- `pg_cron` la 5 minute (decizia 12A) → `pg_net` cu `x-intern-secret` (`poartaCron.ts`), sau owner-ul logat (`?dry=1`).
- Comutatorul `red_mail_setari.citire_activa` (implicit `false`), doar owner.
- **Lease**: `fn_red_mail_citire_lease(p_token, p_secunde)`, CAS pe rândul de setări (`citire_lease_token`, `citire_lease_pana`, ~4 min). Fără lease → rularea se termină `ocupat`. Eliberarea e CAS pe tokenul propriu (L03), iar orice scriere de cursor cere lease-ul curent.

**Cursorul (mod normal)**
- `C0` = `red_mail_setari.history_id`, citit o dată la început. **`startHistoryId = C0` rămâne fix pe toată paginarea** (`pageToken` până la capăt).
- `historyTypes = messageAdded, labelAdded`, filtrat pe `INBOX` (un mesaj mutat de un om din Spam în Inbox apare ca `labelAdded`).
- Fiecare înregistrare de istoric are un `id` crescător. Mesajele lor se procesează în ordine.
- **Publicarea cursorului**:
  - după TOATE paginile, cursorul devine `historyId`-ul întors de API la ultima pagină, **inclusiv când rezultatul e gol**;
  - dacă rularea se oprește înainte (buget de timp / octeți, eroare tranzitorie), cursorul avansează **doar până la `id`-ul ultimei înregistrări ale cărei mesaje sunt toate tratate** (procesate, înregistrate ca dispărute sau neprocesabile).
  - Scrierea e `fn_red_mail_cursor_avanseaza(p_vechi, p_nou, p_lease)`: CAS pe `C0` + lease + `p_nou >= p_vechi`.

**Cursorul (istoric expirat, `404`)**
- Istoricul Gmail poate expira **în câteva ore** (garanția publică e mai slabă decât „o săptămână”), deci recuperarea e un caz normal, nu o excepție.
- Pași:
  1. Se capturează **ÎNAINTE de scanare** `C_nou = users.getProfile().historyId`, salvat în `red_mail_setari.recuperare_history_id`, cu `mod_cursor = 'recuperare'`.
  2. Recuperare **completă a domeniului urmărit**: `messages.list?q=in:inbox after:<data_start>` (`data_start` = data de pornire a urmăririi, fixată de owner la activare), paginat până la capăt. Dedup-ul sare ce e cunoscut.
  3. Progresul (`recuperare_page_token`) e durabil: dacă bugetul rulării se termină, următoarea rulare continuă de unde a rămas, tot sub lease.
  4. La final: cursorul = `C_nou`, `mod_cursor = 'normal'`. Rularea următoare citește istoricul de la `C_nou`, deci prinde și mesajele sosite în timpul scanării.
- Evenimentul (`cursor_expirat`, `recuperare_terminata`, numărători) se scrie în `red_mail_evenimente`.

**Trei cazuri separate, per mesaj**
| Caz | Exemplu | Ce se face | Cursorul |
|---|---|---|---|
| **Dispărut** | `messages.get` → `404` (șters între istoric și citire) | rând în `red_mail_evenimente` (`tip = disparut`, `gmail_id`) | merge mai departe |
| **Neprocesabil** | MIME peste limite, peste mărime, codare imposibilă | rând **durabil** în `red_mail_primite` cu `stare_ingestie = 'neprocesabil'` + `motiv_cod` + metadatele sigure; apare pe ecran la „De triat” | merge mai departe |
| **Eroare tranzitorie** | `5xx`, `429`, timeout, eroare BD | oprește rularea | rămâne la ultima înregistrare tratată |

`invalid_grant` / `401` → `citire_activa = false` automat + `ultima_eroare_cod` + notificare către owner.

**Per mesaj procesat**
- `messages.get?format=metadata` întâi: `sizeEstimate` și lista de părți se verifică **înainte** de descărcare.
- Apoi `format=full` pentru corp și antete. `format=raw` doar dacă `sizeEstimate` ≤ limita `.eml`.
- Câmpurile: `Message-ID`, `In-Reply-To`, `References`, `From` (adresa normalizată + numele afișat separat), `To` / `Cc`, `Subject`, `Date`, `internalDate`, `threadId`, `Authentication-Results` (frontiera de încredere, §2.6), corpul `text/plain`. HTML-ul e doar convertit în text pe server, nu se stochează pentru afișare și nu se randează.
- Scrierea: un singur RPC atomic `fn_red_mail_primit_insereaza` (L02), `INSERT … ON CONFLICT (casuta, gmail_id) DO NOTHING RETURNING` (L04). Indiciile de asociere se calculează în BD, în aceeași tranzacție (L19).
- Erorile de business se scriu în BD + `return` (anti-bug edge). Răspunsul HTTP = contoare + coduri din listă fixă.

### 1.2 Deduplicare și identitate
- **Identitatea de ingestie = `(casuta, gmail_id)`**, `UNIQUE`. `casuta` = `'redari@gazpet.ro'` (coloană explicită, nu presupunere).
- `rfc_message_id`: **index neunic**, folosit doar pentru corelare (fire, reconciliere). Două mesaje cu același `Message-ID` și `gmail_id` diferit se păstrează amândouă, cu steagul `coliziune_message_id = true` pe ambele, vizibil pe ecran. Un `Message-ID` e scris de expeditor, deci poate fi refolosit sau falsificat.
- `raw_sha256`: index neunic, **doar indiciu** („pare același conținut”), niciodată motiv de a sări un mesaj.
- **Obiectele din Storage nu se partajează**: căile sunt pe `gmail_id` (`mail/carantina/<gmail_id>.eml`, `mail/atasamente/<gmail_id>/<n>`), nu pe hash. Retenția (§1.8) poate șterge per mesaj fără numărare de referințe.

### 1.3 Trimiterea: `redari-mail-trimite` (F2, F3)
- **Pornire**: doar din UI, de owner sau admin Redări (§2.1), pe un lot `aprobat`. Fără cron.
- **Snapshot la aprobare (imuabil)**: la crearea lotului, fiecare `red_mail_mesaje` primește valorile **finale**: `catre` complet, `subiect_final`, `corp_text_final`, `corp_html_final`, antetele, `atasament_path` + `atasament_sha256` (citit din fișier, nu din `red_convocari.continut_hash`), `mesaj_sha256` = hash peste toate. `lot_sha256` = hash peste lista ordonată a hash-urilor mesajelor.
  - În preview-ul de aprobare, owner-ul vede **adresa completă** (mascată doar în celelalte liste), textul exact și atașamentul (deschis din aceeași cale).
  - `fn_red_mail_lot_aproba(p_lot, p_versiune, p_lot_sha256)` refuză dacă hash-ul diferă.
  - După aprobare, triggerul blochează orice schimbare a câmpurilor din snapshot (L07). O schimbare înseamnă lot nou.
- **Pași per mesaj**:
  1. `fn_red_mail_rezerva(p_lot, p_apelant)`: lock pe setări → lot → mesaj (ordinea scrisă în comentariu, L06). Verifică kill-switch, plafonul, opt-out, `extern_permis`, nivelul apelantului. `in_coada → rezervat` cu `lease_token` + `lease_pana` (~2 min).
  2. Edge-ul recompune MIME-ul **din snapshot**, recalculează `mesaj_sha256`, descarcă atașamentul și verifică `atasament_sha256`. Diferență → `esuat_sigur` (`snapshot_diferit`), fără apel.
  3. `fn_red_mail_apel_incepe(id, lease)`: `rezervat → in_apel`, `apel_inceput_la`, **commit înainte de apel**.
  4. `users.messages.send` (`raw`; la F3 și `threadId`).
  5. `fn_red_mail_rezultat(id, lease, gmail_id, thread_id | eroare_cod)`: CAS pe lease. În aceeași tranzacție: `trimis` + `red_convocari.data_expediere` (§1.5).
- **Erori**:
  - `4xx` determinist înainte de acceptare (`400` mesaj invalid, `403` scope) → `esuat_sigur` + `eroare_cod`;
  - timeout / `5xx` / rețea după `in_apel` → `necunoscut`, **fără retrimitere automată** (L05);
  - `invalid_grant`, `429` repetat, „sending limit exceeded” → `trimitere_oprita = true` automat + motiv; o repornește doar owner-ul.
- **Ritm**: maximum 1 mesaj / 2 s, maximum 50 / invocare. UI-ul reia până se golește coada.

### 1.4 Crash, lease expirat, reconciliere
- **Lease expirat** (măturat la începutul fiecărei rulări de trimitere, de `fn_red_mail_matura`):
  - `rezervat` fără `apel_inceput_la` → înapoi în `in_coada` (apelul sigur nu s-a făcut: `in_apel` se scrie durabil înainte);
  - `in_apel` → `necunoscut` (apelul poate să fi plecat). **Niciodată retrimis automat.**
- **Cine reconciliază**: `redari-mail-citeste`, acțiunea `reconciliaza` (are tokenul de citire; trimiterea nu poate citi). O pornește owner-ul / admin-ul din UI și se încearcă și la fiecare rulare de cron (doar citește SENT și mută starea, nu trimite).
- **Cum**: `messages.list?q=in:sent rfc822msgid:<Message-ID-ul nostru>` → `messages.get?format=metadata`. **Potrivire = toate**:
  - exact un mesaj în SENT;
  - antetul `Message-ID` identic octet cu octet;
  - `To` = `catre` din snapshot, un singur destinatar;
  - `Subject` = `subiect_final`;
  - `internalDate` ≥ `apel_inceput_la` − 5 min.
  - Rezultat: potrivire → `trimis` (cu `gmail_id`, `thread_id`, `reconciliat = true`) + `data_expediere`, prin `fn_red_mail_reconciliaza` (CAS pe `necunoscut`). Zero găsite → rămâne `necunoscut`; după 24 h de la `apel_inceput_la` apare la „de decis de om”. Mai multe sau nepotrivire → `necunoscut` + `conflict_reconciliere = true`, doar omul.
  - Decizia omului: „nu a plecat” → `esuat_confirmat`; retrimiterea = **mesaj nou** (cheie nouă, snapshot nou, aprobare nouă).
- **Plafoane**: se numără `rezervat` + `in_apel` + `trimis` + `necunoscut` + `esuat_*` după rezervare. Doar întoarcerea în coadă (fără apel) eliberează locul.

### 1.5 Momentul juridic și `red_convocari`
- Convocarea pe e-mail = rând `red_convocari` cu `canal = 'email'`, număr propriu `C-nnnn`, creat **la aprobarea lotului** cu `data_expediere = NULL`.
- `data_expediere` se scrie **atomic, doar la succes confirmat** (`trimis` direct sau prin reconciliere), în aceeași tranzacție. La `esuat_*` / anulare → convocarea trece în `anulat` cu motiv.
- „Expediat” = Gmail a acceptat mesajul (`messages.send` 200 sau găsit în SENT). **Nu e livrare și nu e confirmare de primire.**
- **E-mailul e canal suplimentar** (decizia 6A): convocarea poștală cu AR rămâne obligatorie. Exportul Model_6 și starea parcelei nu tratează o convocare `email` ca înlocuitor al celei poștale.

### 1.6 Compunerea MIME sigură
- **Un singur `To`**. Fără `Cc`, fără `Bcc`, fără `Reply-To` diferit de `redari@`.
- Orice valoare de antet (adresă, nume afișat, subiect, nume de fișier) cu `CR`, `LF`, `NUL` sau alte caractere de control → **refuz** la crearea lotului (în BD) și din nou în edge.
- Adresa: validare strictă (o singură adresă, fără virgulă / punct și virgulă / comentarii / `<>` în plus, domeniu în ASCII sau punycode), aceeași funcție în SQL și în TS, cu test de paritate (L19).
- Subiect și nume în RFC 2047 (`=?UTF-8?B?…?=`), corpuri `base64`, delimitatori aleatori, nume de fișier în RFC 2231. `Message-ID: <uuid@gazpet.ro>` generat și salvat înainte. `List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>`.
- Teste: injecție de antete (`\r\nBcc:`), adresă cu două destinatare, nume cu ghilimele și diacritice, subiect lung.

### 1.7 Codul din subiect și firul Gmail
- **Format**: `[RED-C-0012-K7Q]`. `C-0012` = `nr_document`-ul convocării; `K7Q` = 3 caractere de control `HMAC(REDARI_MAIL_REF_SECRET, cod)`, base32 fără caractere ambigue. Pentru mesajele care nu sunt convocări: `[RED-M-000123-XXX]` (cheia `M` în `red_numere`).
- **În F1** se recunoaște și forma tipărită pe convocatorul poștal (`C-0012` în subiect sau corp, fără control), ca indiciu slab.
- Parsare ancorată pe forma exactă (L13), cu teste: cod fără paranteze, control greșit, două coduri diferite (→ `ambiguu`).
- **Firul**:
  - subiectul trimis: `[RED-C-0012-K7Q] Convocare …`; răspunsurile oamenilor păstrează „Re: [RED-…]”;
  - la răspunsul din ERP (F3), subiectul = `Re: ` + **subiectul primit, neschimbat** (dacă îl schimbăm, clientul destinatarului rupe firul). Dacă subiectul primit nu are cod, codul **nu se adaugă în subiect**: referința merge pe prima linie a corpului (`Referință: RED-M-000123-XXX`);
  - `threadId`, `In-Reply-To` = `Message-ID`-ul primit, `References` = lanțul primit + acesta.
- **Contactul diferă de expeditor** (§1.10): implicit, răspunsul pleacă la adresa din contact, ca **mesaj nou** (fără `threadId` / `In-Reply-To`, cu referința în corp), pentru că firul expeditorului nu există în căsuța contactului. Răspunsul pe firul expeditorului (adresa `From`) se poate alege doar explicit de owner, la aprobare, cu adresa completă afișată. Adresa expeditorului **nu** intră automat în contact.

### 1.8 Tabele, Storage, retenție
**Tabele** (prefix `red_mail_`, RLS, fără DELETE pentru roluri, jurnal fără PII în clar):
| Tabel | Felie | Ce ține |
|---|---|---|
| `red_mail_setari` (un rând) | F1 (+ coloanele F2 adăugate în F2) | `citire_activa`, `data_start`, `history_id`, `mod_cursor`, `recuperare_history_id`, `recuperare_page_token`, lease de citire, `ultima_citire_la`, `ultima_eroare_cod`; F2: `trimitere_oprita` (implicit `true`), `kill_motiv`, `plafon_zi` / `plafon_luna` / `max_lot`, `extern_permis` (implicit `false`); `versiune` |
| `red_mail_primite` | F1 | `casuta` + `gmail_id` (UNIQUE), `rfc_message_id` (neunic), `coliziune_message_id`, `raw_sha256` (neunic), `thread_id`, `in_reply_to`, `references_ids`, `de_la_adresa`, `de_la_nume`, `catre`, `subiect`, `corp_text`, `trunchiat`, `primit_la`, `auth_*` + `auth_sursa`, `stare_ingestie` (`ok` / `neprocesabil`) + `motiv_cod`, indiciile (§1.10), legăturile confirmate (`detinator_id`, `parcela_id`, `convocare_id`, `corespondenta_id`; `mesaj_trimis_id` din F2), `stare` (`nou` → `asociat` → `rezolvat`, plus `ignorat`), `verificare` (§1.10), `cere_dezabonare`, `retentie_blocata` + motiv, `golit_la`, `versiune` |
| `red_mail_atasamente` | F1 | `primit_id`, `nume` curățat, `mime_declarat`, `mime_detectat`, `marime`, `sha256`, `cale` (doar dacă e `stocat`), `stare` (`stocat` / `respins_tip` / `respins_marime` / `respins_structura` / `respins_buget`) |
| `red_mail_evenimente` | F1 | evenimentele de ingestie / retenție / reconciliere: `tip`, `gmail_id` sau `primit_id`, numărători, `cod`. Fără adrese, subiecte sau text. |
| `red_mail_raspuns_sursa` | F1 | legătura `red_raspunsuri.id` ↔ `primit_id` + `verificat` (răspunsul înregistrat din mail; tabel nou, ca să nu modificăm `red_raspunsuri`) |
| `red_mail_loturi`, `red_mail_mesaje` | F2 | §1.3–1.4: snapshotul, stările `in_coada → rezervat → in_apel → trimis | esuat_sigur | necunoscut | esuat_confirmat | anulat`, lease, `reconciliat`, `conflict_reconciliere` |
| `red_mail_optout` | F2 | `email` normalizat UNIQUE, `activ`, `motiv`, `sursa`, `primit_id` (dovada), `setat_de/la` |
| `red_mail_oauth_state` | F0/F1 | §2.3 |
| `red_mail_sugestii` | F4 | §2.5 |

**Storage (bucketul `redari`, schimbare explicită pentru `mail/`)**:
- Politicile existente `red_storage_sel` / `red_storage_ins` se modifică să **excludă** prefixul `mail/` pentru `authenticated`. Altfel un editor ar putea citi `.eml`-urile din carantină sau ar putea urca fișiere „primite” false direct prin API.
- `mail/carantina/<gmail_id>.eml`: arhiva brută. **Nicio politică pentru `authenticated`.** Acces doar prin RPC `fn_red_mail_eml_url(primit_id)`: owner sau admin Redări, URL semnat de 60 s, `Content-Disposition: attachment`, fiecare acces jurnalizat (`red_mail_evenimente`, `tip = eml_descarcat`, fără PII).
- `mail/atasamente/<gmail_id>/<n>`: doar atașamentele din lista albă. Acces prin `fn_red_mail_atasament_url`: owner / admin / editor, URL semnat, `attachment`, prin `descarcaCuJurnal` (egress).
- **INSERT pe `mail/`**: doar `service_role` (edge-ul de citire).
- **DELETE pe `mail/`**: doar automatizarea de retenție (`service_role`). Promisiunea „fișiere imutabile” din README rămâne valabilă pentru restul bucketului și se amendează explicit pentru `mail/`, în aceeași felie. Postcondiția migrării verifică faptul că nicio politică pentru `authenticated` nu acoperă `mail/`.

**Retenția: `redari-mail-retentie`** (F1, livrată oprită; fișa la §2.4)
- Cron zilnic, `retentie_activa = false` până la „da”.
- Reguli (decizia 8A):
  - `ignorat` (spam / irelevant) și `neprocesabil` neasociat: după **90 de zile** se golesc `corp_text`, subiectul, adresele, `.eml`-ul și atașamentele; rămân data, starea și `motiv_cod`;
  - `asociat` / `rezolvat`: se păstrează până la `red_proiecte.retentie_mail_pana` (termenul din `text_gdpr`: durata contractului + arhivarea legală; fixat de owner pe proiect). După termen, același golit + anonimizare (`detinator_id` păstrat doar dacă dosarul de proiect îl cere, decizie Juridic).
- **Excepții legale**: `retentie_blocata = true` (litigiu, obiecție în curs, cerere ANSPDCP / autoritate, cerere a Transgaz), cu motiv, puse de owner sau admin. Blochează orice golire.
- **Ordinea** (L02): (1) RPC marchează rândul `in_golire` + lista exactă de obiecte; (2) edge-ul șterge obiectele; (3) RPC confirmă (`golit_la`) și golește coloanele doar pentru obiectele confirmate șterse. Eroare la mijloc → rândul rămâne `in_golire`, reluat la rularea următoare.
- **Jurnal fără PII**: `red_mail_evenimente` (`tip = golit`, `primit_id`, numărul de obiecte, octeți, data). Fără adresă, subiect sau nume de fișier.
- Căsuța Gmail: politică de retenție aliniată în Google Vault / Admin Console (manual, Razvan). ERP-ul nu poate șterge din Gmail (scope `readonly`).

### 1.9 Limite (citire și trimitere)
- **Citire, per mesaj**: `sizeEstimate` ≤ 25 MB; `.eml` stocat doar ≤ 10 MB; corp ≤ 20.000 de caractere (restul `trunchiat`, L12); structură MIME: adâncime ≤ 5, ≤ 50 de părți, ≤ 20 de atașamente; atașament ≤ 10 MB, verificat pe `body.size` **înainte** de `attachments.get` și numărat **în timpul** descărcării (oprire la depășire).
- **Citire, per rulare**: ≤ 50 de mesaje, ≤ 100 MB descărcați, ≤ 50 s. La depășire, rularea se oprește curat (cursorul la ultima înregistrare tratată). Mesajele care depășesc singure limitele → `neprocesabil`, durabil.
- **Trimitere**: limitele Google (de verificat pe pagina „Gmail sending limits”; din cunoștințe generale ~2.000 de mesaje / zi / utilizator, ~3.000 de destinatari externi unici / zi, iar depășirea suspendă trimiterea până la 24 h). Plafoanele proprii (decizia 7A): **200 / zi, 1.000 / lună, maximum 300 / lot**, plus maximum 1 mesaj de `reamintire` / destinatar / 24 h.
- **Kill-switch**: `trimitere_oprita` (implicit `true`), `citire_activa` (implicit `false`), `retentie_activa` (implicit `false`), doar owner. Oprirea ocolește orice cotă (L20).
- **Mod test**: cât timp `extern_permis = false`, orice destinatar în afara `@gazpet.ro` (potrivire exactă pe domeniu) e refuzat în BD.

### 1.10 Asocierea și verificarea (asocierea nu e identitate)
**Indicii, calculate toate, nu „primul găsit”** (`fn_red_mail_indicii`, o singură definiție, L19):
- `indiciu_fir_detinator_ids`: `In-Reply-To` / `References` conțin `rfc_message_id`-ul unui mesaj trimis de noi (activ din F2; în F1 e mereu gol);
- `indiciu_cod_detinator_ids` + `indiciu_cod_forma` (`cu_control_valid` / `tiparit_fara_control` / `control_gresit` / `ambiguu`);
- `indiciu_expeditor_detinator_ids`: adresa `From` normalizată = `red_detinatori_contact.email` (pot fi mai mulți: coproprietari, mai multe parcele);
- `conflict_indicii = true` când mulțimile nevide diferă (de ex. firul spune A, codul spune B). Ecranul le arată pe toate, cu sursa fiecăreia;
- `expeditor_diferit = true` când firul sau codul indică un deținător a cărui adresă de contact ≠ `From`;
- autentificarea (§2.6).
- Niciun indiciu → „de triat”.

**Stările** (doar omul le schimbă):
- `nou` → `asociat`: omul confirmă unul din candidați sau alege manual deținătorul / parcela / rândul de corespondență. Cu `conflict_indicii`, UI-ul cere alegerea explicită (nu există „acceptă propunerea”).
- `asociat` → `rezolvat`: omul a terminat (a înregistrat răspunsul, a sunat, a răspuns pe fir). `ignorat` cere motiv. `redeschide` e permis.

**Verificarea identității** (schemă și RPC-uri în F1):
- `verificare`: `neverificat` (implicit) / `verificat_telefon` / `verificat_semnatura` / `verificat_prezenta` / `verificat_alt` + `verificat_de/la` + notă. RPC `fn_red_mail_verifica` (admin / editor).
- **Efectele răspunsurilor neverificate sunt limitate**:
  - un răspuns înregistrat din mail (`red_raspunsuri`, `canal = 'email'`) primește rândul `red_mail_raspuns_sursa` cu `verificat = false`;
  - vederea de stare a parcelei, dashboard-ul și exportul îl arată ca „răspuns e-mail, neverificat”, separat de cele verificate; nu închide singur urmărirea (rămâne în lista de sunat);
  - obiecțiile și refuzurile primite pe mail nu intră în PV ca poziție a proprietarului până la verificare.
  - Schimbarea `red_v_stare_parcela` pentru starea „neverificat” e o modificare de vedere existentă: intră în migrarea F1 și cere review pe ea.
- Adăugarea adresei `From` la contactul deținătorului: acțiune separată, confirmată, jurnalizată (PII nou).

---

## 2. Securitatea

### 2.1 Roluri (în BD, nu doar în UI; L07, L09)
| Acțiune | owner | admin Redări | editor Redări | viewer Redări |
|---|---|---|---|---|
| lista mesajelor, corpul, atașamentele permise | da | da | da | doar numărători |
| `.eml` brut (carantină) | da | da | nu | nu |
| asociere / rezolvare / ignorare / verificare | da | da | da | nu |
| `retentie_blocata` (excepție legală) | da | da | nu | nu |
| creare lot (preview) | da | da | da | nu |
| **aprobare lot** | **da** | nu | nu | nu |
| pornire trimitere (lot aprobat), reconciliere manuală | da | da | nu | nu |
| decizie pe `necunoscut` (`esuat_confirmat`) | da | nu | nu | nu |
| opt-out: confirmarea unei cereri | da | da | nu | nu |
| opt-out: scoaterea unui opt-out | da | nu | nu | nu |
| comutatoare (citire, trimitere, `extern_permis`, retenție), plafoane, `data_start`, `retentie_mail_pana` | da | nu | nu | nu |
| OAuth (conectare / revocare) | da | nu | nu | nu |

### 2.2 Accesul conturilor AI la căsuță
- **Conturile AI (inclusiv `claude@gazpet.ro`) NU primesc acces direct la `redari@`**: fără delegare Gmail, fără parola contului, fără sesiune logată în vreun browser de pe serverul AI.
- **Singurul acces** e tokenul OAuth al ERP-ului, folosit doar de cele două edge-uri, prin porțile ERP: loturi aprobate de owner, plafoane, kill-switch, mod test.
- **Testele** se fac prin ERP: lot de test către adrese `@gazpet.ro` (cu `extern_permis = false`), iar mailurile de test pentru primire se trimit spre `redari@` din căsuțe interne. Rezultatul se verifică pe ecranul ERP, nu în Gmail.
- Consimțământul OAuth îl dă **Razvan**, logat el ca `redari@` (§4). Claude nu vede parola și nici tokenul.

### 2.3 Tokenul, riscul rezidual și callback-ul OAuth
**Riscul rezidual (declarat)**: un token `gmail.readonly` poate citi **toată căsuța** `redari@`, iar unul `gmail.send` poate trimite **oriunde**, în numele `redari@`. Porțile (aprobare, plafoane, kill-switch, mod test) există **doar în ERP**. Cine obține tokenul le ocolește. Măsurile:
- **doi clienți OAuth și două tokenuri**: „ERP Redări citire” (`gmail.readonly`) și „ERP Redări trimitere” (`gmail.send`). Tokenul de citire nu poate trimite, cel de trimitere nu poate citi. Decizia 2A („o singură autorizare”) se respectă ca **o singură ședință** cu Razvan, în care se dau două consimțăminte consecutive;
- secrete separate, cod separat (§1), testul static de import;
- tokenurile stau în **Vault**, citite printr-un RPC cu EXECUTE doar pentru `service_role`, care acceptă doar cele două nume. Limita: `service_role` și Edge Secrets sunt comune tuturor funcțiilor din proiect, deci separarea dintre funcții e de cod și de review, nu de platformă;
- tokenurile nu apar în loguri, răspunsuri sau jurnale. Access token-ul trăiește doar în memoria invocării;
- monitorizare: alertă către owner dacă SENT conține mesaje fără rând `red_mail_mesaje` corespunzător (verificat la reconciliere: mesaj trimis din afara ERP sau token scurs);
- revocare imediată (procedura de mai jos).

**Fișa a–e: `redari-mail-oauth` (callback)**
- **(a) Conținut extern**: răspunsul Google (`code`, `state`, eroare), răspunsul de token (scope-uri, adresă).
- **(b) Ce scrie**: un secret în Vault (refresh token-ul de citire sau de trimitere), rândul `red_mail_oauth_state`, un eveniment. Nu trimite mail. Atinge un drept puternic (accesul la căsuță), de aceea doar owner.
- **(c) Identitate**: `service_role` după poartă, pentru Vault (RPC `fn_red_mail_secret_seteaza`, EXECUTE doar `service_role`, numai cele două nume).
- **(d) Cine o pornește**:
  - `start`: **doar owner-ul** (JWT + `is_owner` verificat în cod și în RPC), cu `scop` ∈ {`citire`, `trimitere`}. RPC-ul creează `state` aleator (32 de octeți), salvat ca **sha256**, legat de `owner_id` + `scop`, cu **expirare 10 minute**. Redirect la Google cu `login_hint=redari@gazpet.ro`, `hd=gazpet.ro`, `access_type=offline`, `prompt=consent`, scope-ul exact.
  - `callback` (GET de la Google, fără JWT): `state` consumat **atomic** (`UPDATE … WHERE sha = … AND consumat_la IS NULL AND expira_la > now() RETURNING`), apoi se verifică din nou că `owner_id` e încă owner. `state` invalid / expirat / consumat → refuz generic.
  - Înainte de salvare: schimbul `code → token`; **scope-urile întoarse = exact setul cerut** (niciunul în plus, niciunul lipsă); **căsuța efectivă** = `users.getProfile().emailAddress` (cu scope-ul de citire) sau `id_token`-ul / `tokeninfo` (cu cel de trimitere, cere și `openid email`) == `redari@gazpet.ro` exact, `hd = gazpet.ro`. Orice nepotrivire → tokenul se **revocă imediat la Google** (`oauth2.googleapis.com/revoke`) și nu se salvează nimic.
- **(e) Confirmare umană**: fiecare conectare e o acțiune a owner-ului, logat ca `redari@` în fereastra Google. Înlocuirea unui token existent cere confirmare explicită în UI.
- **Cine accesează secretul**: doar `redari-mail-citeste` (numele de citire) și `redari-mail-trimite` (numele de trimitere), prin RPC-ul de citire din Vault. Niciun rol de aplicație.
- **Revocare**:
  1. kill-switch-urile din ERP (`citire_activa = false`, `trimitere_oprita = true`);
  2. `redari-mail-oauth` acțiunea `revoca` (owner): revocă tokenul la Google + golește secretul din Vault;
  3. de rezervă, în contul `redari@` → Securitate → Aplicații terțe → elimină „ERP Redări citire / trimitere”, sau Admin Console → Security → API controls;
  4. schimbarea parolei `redari@` + închiderea sesiunilor, dacă e suspiciune de compromitere;
  5. notă în `registru_automatizari`.

### 2.4 Fișele a–e pentru celelalte automatizări
**`redari-mail-citeste` (F1)**
- **(a)**: TOT ce intră în `redari@` (proprietari, instituții, spam, phishing): antete, corp, atașamente. Plus SENT, doar metadate, la reconciliere.
- **(b)**: scrie `red_mail_primite` / `_atasamente` / `_evenimente`, obiecte în `mail/`, cursorul; la reconciliere doar stări `necunoscut → trimis` + `data_expediere`. **Nu trimite, nu modifică Gmail** (`readonly`), nu atinge bani sau drepturi. (a) ∩ (b) se ating doar ca date, fără acțiune.
- **(c)**: `service_role` după poartă, pentru că nimeni din aplicație nu are voie să „fabrice” un mesaj primit sau proveniența lui (L08). Totul prin RPC-uri cu EXECUTE doar pentru `service_role`.
- **(d)**: cronul cu `x-intern-secret` sau owner-ul (reconcilierea și de admin Redări, verificat în cod). Teste: anon 401, utilizator obișnuit 403 (PR #318).
- **(e)**: nu trimite nimic. Asocierea, verificarea, rezolvarea, opt-out-ul le face omul. Pornirea citirii: owner, după condițiile GDPR (§2.7).

**`redari-mail-trimite` (F2 + F3)**
- **(a)**: adresele din contact (introduse de oameni), iar la F3 antetele mesajului la care se răspunde (doar `threadId` / `Message-ID`).
- **(b)**: **trimite mail extern** din `redari@` (PII: nume, parcelă, convocator), scrie `red_mail_mesaje`, `red_convocari`. Nu citește căsuța.
- **(c)**: `service_role` după poartă: stările, lease-ul și plafonul nu pot fi la îndemâna `authenticated`. RPC-urile re-verifică nivelul apelantului (`p_apelant`, ca `fn_sms_rezerva`).
- **(d)**: owner sau admin Redări (`poartaModul.ts` + nivelul verificat în BD la rezervare), doar pe loturi aprobate. Teste: anon 401, viewer / editor 403 la pornire, lot modificat după aprobare refuzat.
- **(e)**: orice trimitere = lot aprobat de owner pe `lot_sha256`, cu preview-ul complet (§1.3). F3 = lot de 1, la fel. Un mail primit nu poate declanșa o trimitere.

**`redari-mail-retentie` (F1, oprită)**
- **(a)**: nimic extern; citește doar rândurile proprii și termenele.
- **(b)**: **șterge** obiecte din `mail/` și golește coloane (ireversibil). Nu trimite, nu atinge drepturi.
- **(c)**: `service_role` (DELETE în Storage + coloane închise pentru roluri), prin RPC-uri `in_golire` / `confirma`.
- **(d)**: cronul cu `x-intern-secret`; owner-ul poate rula `?dry=1` (doar numărătoarea a ce ar goli).
- **(e)**: activarea = „da”-ul lui Razvan după un dry-run cu numărători. Termenul pe proiect îl fixează owner-ul. Excepțiile legale blochează golirea.

### 2.5 F4 — sugestii AI (opțional)
- **(a)**: subiectul și corpul mailurilor (extern, posibil ostil). **(b)**: scrie doar `red_mail_sugestii` (categorie din enum + încredere + offset-uri în text); costă bani. **(c)**: `service_role` după poartă, `ANTHROPIC_API_KEY` prin `_shared/haiku55.ts`. **(d)**: admin / editor pe un mesaj, owner pe mai multe; nu din cron; rezervare de cost înainte de apel (L22). **(e)**: sugestia doar se afișează; orice efect îl face omul.
- Modelul primește textul încadrat ca date, **fără unelte, fără web, fără BD**, `max_tokens` mic. Ieșirea e validată strict pe schemă (L21). Orice altceva = aruncată.
- **Verificare GDPR separată** înainte de activare: furnizorul AI ca sub-împuternicit (DPA, locul prelucrării, transferul în afara UE, retenția la furnizor), cu autorizarea Transgaz.

### 2.6 Riscuri și măsuri
- **Anti prompt-injection**: F1–F3 fără niciun model AI pe mailuri. Textul primit nu ajunge niciodată ca instrucțiune la un model cu unelte (nici la sesiunile Claude care lucrează pe ERP: pct. 10).
- **Atașamente**: listă albă PDF / JPEG / PNG pe octeții magici (HEIC doar dacă se cere); respinse: executabile, arhive, HTML, SVG, Office cu macro, `.eml` încuibate. Respingerile se înregistrează durabil (rând cu `stare = respins_*`, fără fișier). Nimic nu se deschide, convertește, OCR-izează sau trimite la AI automat. Descărcare doar ca fișier.
- **Linkuri**: corpul doar ca text, linkuri neclicabile (domeniul evidențiat), nicio imagine la distanță, ERP-ul nu urmează linkuri.
- **`Authentication-Results`, frontiera de încredere**:
  - se ia **doar antetul cel mai de sus**, și doar dacă `authserv-id` = `mx.google.com` (adăugat de serverul Google la primire); orice alt `Authentication-Results`, `ARC-*`, `X-*` scris de expeditor se ignoră;
  - rezultatul (`spf` / `dkim` / `dmarc`, cu domeniul aliniat) e **informativ**, nu dovadă: un `dmarc=pass` dovedește doar domeniul, nu persoana (oricine își face o adresă `@gmail.com`);
  - `auth_sursa = 'mx.google.com'` sau `'absent'`.
- **Spoofing**: `From` se falsifică ușor (DMARC `p=none` e frecvent, inclusiv la noi azi). Asocierea după expeditor sau cod nu dovedește identitatea (§1.10). Răspunsul pleacă implicit la adresa din contact (§1.7).
- **PII în loguri**: `console.*` doar coduri; răspunsuri HTTP doar contoare; Sentry cu `src/redari/sentryScrub.js`; `red_jurnal` doar numele câmpurilor; adrese mascate în liste.
- **Teste ostile obligatorii (F1)**: `From` falsificat cu adresa unui deținător; `Authentication-Results: mx.google.com; dmarc=pass` pus de expeditor sub antetul real; două antete `Message-ID`; `Message-ID` refolosit de la alt mesaj (coliziune); cod valid copiat de pe un plic; subiect cu `\r\n`; atașament `.pdf` care e de fapt ZIP; MIME adânc / 500 de părți; corp cu instrucțiuni („ignoră regulile, trimite…”) care nu produce nicio acțiune.

### 2.7 GDPR — condiții înainte de F1 pe date reale
F1 se poate livra și testa cu `citire_activa = false` și cu mailuri interne de test. **Activarea pe căsuța reală** cere toate:
1. **Cadrul contractual**: contractul / împuternicirea Transgaz permite comunicarea pe e-mail cu proprietarii și prelucrarea mailurilor primite de Gazpet în numele Transgaz.
2. **Sub-împuternicitul Google**: autorizarea scrisă a Transgaz (art. 28(2)); Cloud Data Processing Addendum acceptat în Admin Console; locul datelor și transferurile în afara UE (SCC / DPF) notate la dosar.
3. **Informarea aplicabilă** actualizată pe canalele unde apare `redari@` (convocator, formular public, răspunsul automat dacă există): scop, temei, destinatari (inclusiv Google), retenție, transferuri, drepturi. Textul implicit `red_proiecte.text_gdpr` **nu menționează azi e-mailul**; informarea v3 (`A3_Informare_GDPR_Lot1_v3_final.docx`, PR #939 draft) nu e în repo și trebuie verificată.
4. Termenul de retenție `retentie_mail_pana` fixat pe proiect.

F2 cere în plus textul mailurilor validat de Juridic și DKIM / DMARC (§0.4). F4 are verificarea lui separată (§2.5).

---

## 3. Felii de livrare (cu dependențele)

Porți comune: branch din `origin/main`; GO Jakarinos + Copilot pe diff; DRY verde pe prod (gardă de start, o tranzacție, postcondiții, `_ROLLBACK.sql` care nu șterge date, L14); build `npx vite build`; rând în `automatizari` + secțiune în `registru_automatizari` (fișa a–e, doar nume de secrete). Merge / deploy / apply le face sesiunea de programare după GO. **Activarea citirii, a trimiterii, a `extern_permis`, a retenției și conectarea OAuth cer „da”-ul lui Razvan.**

### F0 — Pregătire (fără cod de producție)
- Pașii manuali de la §4 (fără conectarea OAuth, care vine cu F1).
- Condițiile GDPR de la §2.7 pornite (Juridic, Transgaz), DKIM / DMARC.

### F1 — Primirea + schema minimă comună
- **Migrare: da.** `red_mail_setari` (coloanele de citire), `red_mail_primite`, `red_mail_atasamente`, `red_mail_evenimente`, `red_mail_raspuns_sursa`, `red_mail_oauth_state`, `red_proiecte.retentie_mail_pana`; RPC-urile de ingestie / cursor / lease / indicii / asociere / verificare / ignorare / redeschidere / URL-uri semnate / retenție / Vault; vederile `red_mail_v_inbox`, `red_mail_v_istoric_detinator`; starea „răspuns e-mail neverificat” în `red_v_stare_parcela`; politicile de Storage pentru `mail/` (§1.8). Cronurile se creează oprite.
- **Edge: da.** `redari-mail-oauth` (scopul `citire`), `redari-mail-citeste` (+ reconcilierea, inactivă până la F2), `redari-mail-retentie`, `_shared/gmailCitire.ts`.
- **UI: da.** `src/redari/ui/MesajeEcran.jsx` („📥 Mesaje Redări”: Nou / De triat / Asociat / Rezolvat / Ignorat, firul, toate indiciile cu conflictele, autentificarea, steagurile, verificarea, atașamentele, „Înregistrează răspuns” cu `canal = email` + `verificat = false`); secțiunea „Istoric e-mail” pe `FisaParcela.jsx`; contorul pe Dashboard; panoul owner (comutatoare, `data_start`, termen, conectare / revocare OAuth).
- **Amânate explicit în F2**: indiciul de fir (nu există mesaje trimise), reconcilierea, tabelul de opt-out. În F1, cererile de dezabonare sunt doar steag `cere_dezabonare`.
- **DRY / teste**: §1.1–1.2 (cursor fix pe paginare, rezultat gol, 404 → recuperare cu cursor capturat înainte, reluarea recuperării, dispărut / neprocesabil / tranzitoriu, două rulări concurente → una `ocupat`), dedup pe `(casuta, gmail_id)` + coliziune `Message-ID`, testele ostile de la §2.6, politicile Storage ca non-owner (editor nu citește `mail/carantina/`, nu urcă în `mail/`), retenția în dry-run (excepție legală respectată, ordinea `in_golire`), callback OAuth (state expirat / refolosit / alt owner, scope în plus, altă căsuță → revocare). Probă: `?dry=1` de owner, apoi mailuri interne de test.

### F1b — Câmpul de e-mail în formularul public
- **Migrare: da** (schimbare a RPC-ului public `fn_red_raspuns_public` + validare, `red_detinatori_contact.email` scris doar dacă e gol și jurnalizat, rate limit existent). **UI**: `RedariRaspunsPublic.jsx`, câmp opțional + informarea.
- Depinde de §2.7 punctul 3 (informarea care menționează e-mailul). DRY + test ca anon (injecție, adresă invalidă, suprascriere refuzată).

### F2 — Trimiterea în loturi cu aprobare
- **Migrare: da.** Coloanele de trimitere în `red_mail_setari`, `red_mail_loturi`, `red_mail_mesaje` (snapshot + triggere de imuabilitate), `red_mail_optout` (drepturile din §2.1), cheia `M` în `red_numere`, RPC-urile de creare / preview / aprobare pe hash / anulare / rezervare / `apel_incepe` / rezultat / măturare / reconciliere / decizie pe `necunoscut` / opt-out, crearea `red_convocari` (`canal = email`) la aprobare.
- **Edge: da.** `redari-mail-oauth` (scopul `trimitere`), `redari-mail-trimite` + `_shared/gmailTrimitere.ts`; activarea reconcilierii în `redari-mail-citeste`.
- **UI: da.** „✉️ Lot e-mail” în Registru (filtre, șabloanele validate de Juridic, preview cu adresele complete pentru owner, aprobare, „Trimite” cu progres și reluare), lista „de decis” pentru `necunoscut`, panoul de setări, opt-out.
- **DRY / teste**: snapshot modificat după aprobare, hash diferit, atașament schimbat în bucket, plafon la concurență (2 sesiuni + barieră, L25), opt-out între creare și rezervare, `extern_permis = false`, crash simulat în fiecare stare (`rezervat` → coadă, `in_apel` → `necunoscut`), reconciliere (exact 1 / 0 / 2 / subiect diferit), `data_expediere` doar la succes, MIME ostil (§1.6). Probă: 3 adrese `@gazpet.ro`, apoi „da” pentru `extern_permis` și un prim lot ≤ 10.
- **Precondiții**: DKIM + DMARC, textul validat, condițiile GDPR.

### F3 — Răspuns pe fir
- **Migrare: mică.** `tip = raspuns_fir`, `in_reply_to_primit_id`, alegerea destinatarului (contact implicit / expeditor doar cu owner), regula „lot de 1”.
- **Edge**: `threadId` + `In-Reply-To` / `References`, subiectul neschimbat, referința în corp (§1.7).
- **UI**: „Răspunde” în Mesaje (ciornă → aprobare → trimite), ambele adrese afișate când diferă.
- **DRY / teste**: subiect fără cod (rămâne neschimbat), contact ≠ expeditor (mesaj nou spre contact), fir corect pe o căsuță internă.

### F4 — Sugestii AI (opțional)
- **Migrare: da** (`red_mail_sugestii` + rezervarea costului). **Edge**: `redari-mail-sugereaza`. **UI**: insigna „sugestie” + fragmentele subliniate. **DRY / teste**: §2.5 + textele de injecție. **Precondiție**: verificarea GDPR separată.

---

## 4. Pașii manuali cu Razvan (fără valori, doar nume)

1. **Conturile AI nu primesc acces la `redari@`** (§2.2): nu se configurează delegare, nu se dă parola.
2. **Clienții OAuth** (Google Cloud; proiectul existent sau unul nou): Gmail API activat, ecran de consimțământ **Internal**, doi clienți Web „ERP Redări citire” și „ERP Redări trimitere”, cu redirect = URL-ul `redari-mail-oauth`. În Admin Console, dacă accesul aplicațiilor e restricționat, cele două aplicații marcate de încredere, limitate la scope-urile lor.
3. **Ședința de consimțământ** (o singură dată, decizia 2A): Razvan, în ERP ca owner, apasă „Conectează citire”, apoi „Conectează trimitere”. Fiecare deschide Google, unde se loghează **el** ca `redari@` și acceptă scope-ul. Callback-ul verifică căsuța și scope-urile și scrie tokenul în Vault. Valoarea nu trece prin chat, loguri sau fișiere. Conectarea trimiterii se poate face de la F1 (tokenul stă nefolosit, `trimitere_oprita = true`) sau la F2.
4. **Secretele** (doar nume):
   - Edge Secrets: `REDARI_GMAIL_CITIRE_CLIENT_ID`, `REDARI_GMAIL_CITIRE_CLIENT_SECRET`, `REDARI_GMAIL_TRIMITERE_CLIENT_ID`, `REDARI_GMAIL_TRIMITERE_CLIENT_SECRET`;
   - Vault: `REDARI_GMAIL_CITIRE_REFRESH_TOKEN`, `REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN` (scrise de callback), `REDARI_MAIL_REF_SECRET` (HMAC pentru cod);
   - refolosit: `INTERN_EDGE_SECRET` (cron); doar F4: `ANTHROPIC_API_KEY`;
   - **nu se refolosesc** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`.
5. **DNS / Admin Console**: DKIM Google + TXT `google._domainkey`; DMARC cu `rua=` (adresă de ales), apoi `p=quarantine`; politica de retenție pentru `redari@` în Google Vault; DPA-ul Google acceptat.
6. **Juridic / Transgaz**: §2.7.
7. **Registre**: rândurile în `public.automatizari` (citire, trimitere, oauth, retenție, F4) + secțiunea „E-mail Redări” în `registru_automatizari`, cu procedura de revocare (§2.3).

---

## 5. Ce cere „da” separat
Conectarea OAuth (fiecare token), `citire_activa` pe căsuța reală, `data_start`, `retentie_activa`, `trimitere_oprita = false`, `extern_permis = true`, fiecare lot extern (aprobarea e chiar „da”-ul), F4.

## 6. Ce NU face planul
Nu trimite către instituții (rămân în `red_corespondenta`). Nu înlocuiește poșta cu AR. Nu răspunde automat. Nu șterge și nu mută nimic în Gmail. Nu dă conturilor AI acces la căsuță.

---

## 7. Decizii închise (Razvan, 03.11.2026: toate variantele A)
1. **Acces la căsuță**: clienți OAuth dedicați, refresh token în Vault prin callback doar owner. (În r2: doi clienți, citire și trimitere, §2.3.)
2. **Scope-uri**: `gmail.readonly` + `gmail.send`, într-o singură ședință de autorizare (două consimțăminte consecutive, unul pe client).
3. **Asocierea**: o confirmă mereu omul; sistemul doar calculează indiciile.
4. **Dezabonarea venită pe mail**: steag + confirmarea omului.
5. **Aprobarea loturilor**: doar owner-ul.
6. **Valoarea juridică**: e-mailul e canal suplimentar; poșta cu AR rămâne obligatorie.
7. **Plafoane de pornire**: 200 / zi, 1.000 / lună, maximum 300 / lot.
8. **Retenția**: dosarul la termenul din `text_gdpr` (pe proiect); spam / irelevant golite după 90 de zile.
9. **Sursa adreselor**: operator + câmp opțional în formularul public (F1b), cu informare + adresa dintr-un mail primit, adăugată doar cu confirmare.
10. **Cine vede mesajele**: admin + editor Redări; viewer doar numărători.
11. **DKIM / DMARC**: DKIM acum, DMARC `p=none` + `rua` 2 săptămâni, apoi `quarantine`, înainte de F2.
12. **Cronul de citire**: la 5 minute.

---

## 8. Ce s-a schimbat în r2 (NO-GO Jakarinos + Copilot pe r1)
| Punct | Unde |
|---|---|
| Decizii închise (toate A), fără alternative | §7 |
| P1-1 Fără acces direct al conturilor AI la căsuță; testele prin ERP | §2.2, §4.1 |
| P1-2 Cursor: `startHistoryId` fix, publicare după toate paginile (și la gol), 404 → recuperare completă cu cursor capturat înainte, expirare în ore, dispărut / neprocesabil / concurență (lease) | §1.1 |
| P1-3 Dedup pe `(casuta, gmail_id)`, `Message-ID` neunic cu coliziuni semnalate, hash doar indiciu | §1.2 |
| P1-4 Crash la trimitere: `in_apel` durabil, lease expirat → `necunoscut`, reconcilierea (cine, cum, criterii), plafonul numără tot, `data_expediere` atomic la succes, momentul juridic | §1.3–1.5 |
| P1-5 Retenția: automatizare cu fișă, ordine, jurnal fără PII, excepții legale, obiecte nepartajate, Storage `mail/` cu DELETE explicit | §1.8, §2.4 |
| P1-6 GDPR înainte de activarea F1; F4 separat | §2.7, §2.5 |
| P2-7 Risc rezidual al tokenului, două tokenuri / clienți / coduri, fișa callback-ului (state, căsuță, scope-uri, revocare) | §1, §2.3 |
| P2-8 Snapshot imuabil la aprobare (adresa completă, atașamentul, hash), verificat înainte de trimitere; MIME sigur | §1.3, §1.6 |
| P2-9 `.eml` în carantină, limite înainte / în timpul descărcării, buget pe rulare, MIME maxim, respingeri durabile, INSERT restrâns pe `mail/`, teste ostile | §1.8–1.9, §2.6 |
| P2-10 Toate indiciile + conflictele, `verificare` cu schemă și RPC în F1, efecte limitate, frontiera `Authentication-Results` | §1.10, §2.6 |
| P2-11 Dependențe: schema comună în F1, ce se amână în F2, felia F1b pentru formular, drepturile de opt-out în tabelul de roluri | §3, §2.1 |
| P2-12 Firul: subiect neschimbat, referință în corp, contact ≠ expeditor | §1.7 |
