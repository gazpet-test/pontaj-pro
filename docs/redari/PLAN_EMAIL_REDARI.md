# Plan: e-mail Redări prin `redari@gazpet.ro` (03.11.2026)

Doar plan de design: fără cod de producție, fără scrieri în BD, fără secrete. Fiecare felie de mai jos se livrează separat, cu porțile ei.

**Deciziile lui Razvan (03.11.2026)**
- Căsuța `redari@gazpet.ro` există (Google Workspace). Razvan dă acces și contului Claude. Autorizarea Gmail API o facem împreună, o singură dată.
- **Trimitere** ERP → proprietari (de ex. convocarea pe e-mail pentru cei care au adresă în contact): **fără niciun automatism**. Fluxul: lot → aprobare → trimitere, ca la SMS. Mailurile către instituții rămân în 📨 Corespondență (`red_corespondenta`), cu „da” pe fiecare rând.
- **Primire**: răspunsurile intră în ERP, se asociază proprietarului sau parcelei și se centralizează pe ecranul „📥 Mesaje Redări” (nou → asociat → rezolvat). Istoricul apare și pe fișa proprietarului.
- Conținutul primit e **extern** (CLAUDE.md pct. 7 și 10). ERP-ul nu face nicio acțiune automată pe baza lui. AI-ul poate doar sugera, iar omul confirmă.

**Surse citite**: `CLAUDE.md`, `docs/paw/LECTII_REVIEW.md` (L01–L25), `docs/sms/RAPORT_SMS_2026-11-03.md`, migrările `20261130a_sms_mvp.sql` / `20261130b_sms_acces_modul.sql`, `20261126a_redari_teren.sql`, `20261129h_redari_corespondenta.sql`, `docs/redari/README.md`, `SABLOANE.md`, `CONTRACT_SCHEMA.md`, edge-urile `redirect-mai-gov`, `noutati-mail`, `ofertare-rfq-inbox`, `ingest-document`, `vicare`, `olx-api`, plus `claude_docs.registru_automatizari` (doar SELECT pe rândurile despre mail/Gmail) și DNS-ul public al `gazpet.ro` (TXT/MX, citit 03.11).

---

## 0. Ce există deja și ce se refolosește

### 0.1 Gmail API în platformă azi
| Ce | Cum funcționează | Se refolosește? |
|---|---|---|
| `redirect-mai-gov` (repo, v9) | OAuth2 cu **refresh token pe o singură căsuță** (`razvan.trusu@`): `POST oauth2.googleapis.com/token` (`grant_type=refresh_token`) → access token → `gmail/v1/users/me/messages?q=…` + `messages/{id}?format=full`. Corpul îl scoate din `payload.parts`. Idempotență: `UNIQUE gmail_msg_id`, rândul se scrie ÎNAINTE de acțiune. Poarta: `esteApelIntern` (cron cu `x-intern-secret` din Vault) sau JWT de owner. Răspunsul HTTP conține doar stări din listă fixă (`raport.ts`), pentru că `pg_net` păstrează răspunsul în `net._http_response`. | **Da, tiparul**: token, `gFetch`, `findBody`, poarta, răspunsul fără PII. **Nu, secretele**. |
| `productie-mail-facturi` (live, cron 15 min), `import-evogps-gmail` | Aceleași 3 secrete `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (Edge Secrets). Caută în `razvan.trusu@` / `automatizari@`, cu etichetă Gmail pentru idempotență. | Nu: alt cont, alt scop. |
| `ofertare-rfq-inbox`, `ingest-document` | Varianta **Apps Script**: scriptul de pe căsuță (`oferte@`, `razvan.trusu@`) împinge mailul spre edge, cu secret partajat în antet. Edge-ul nu are niciun token Google. | Alternativa C de la §6. |
| `noutati-mail`, `send-factura-email` etc. | Trimitere prin **Resend** de pe `rapoarte@` / `facturi@` (DKIM `resend._domainkey.gazpet.ro`). Claim atomic înainte de trimitere. | Tiparul de claim, da. Canalul, nu: răspunsurile trebuie să vină înapoi în `redari@`, deci trimitem DIN Gmail. |
| `vicare`, `olx-api` | Callback OAuth în edge, doar owner, cu `state` aleator consumat atomic. Refresh token-ul se scrie în **Vault** prin RPC (`iot_secret_set`), nu în Edge Secrets. | **Da**: așa obținem refresh token-ul pentru `redari@` fără ca valoarea să treacă prin chat sau prin fișiere (§4). |

### 0.2 Delegare pe domeniu vs. refresh token pe căsuță
- **Delegarea pe domeniu** (service account cu domain-wide delegation): un singur secret care poate citi și trimite din **orice** căsuță `@gazpet.ro`. Nu se justifică pentru o căsuță: o scurgere a cheii ar deschide tot domeniul. **Nu o folosim.**
- **Refresh token pe căsuță** (ce face platforma azi): tokenul vede doar `redari@` și doar cu scope-urile acordate. **Asta folosim**, cu secret propriu (L10: „secret propriu per integrare, fără fallback pe alt modul”), separat de `GMAIL_REFRESH_TOKEN`-ul lui Razvan.
- Un refresh token obținut cu contul lui Razvan **nu** poate citi `redari@`. Consimțământul se dă **logat ca `redari@`**: delegarea din Gmail („acces delegat”) nu ajunge pentru API.
- Ecranul de consimțământ trebuie să fie **Internal** (doar utilizatori `gazpet.ro`). La o aplicație externă în modul „Testing”, tokenurile expiră după 7 zile (de verificat în proiectul GCP existent).

### 0.3 Redări azi (ce atinge planul)
- `red_detinatori_contact.email` există (PII, SELECT doar admin/editor), dar azi are **0 adrese din 2.548 de rânduri** (numărătoare din raportul SMS, 03.11). Primul beneficiu real e la **primire**: convocatorul tipărit are deja `{{contact_email}}` = `redari@gazpet.ro`, deci răspunsurile vor veni acolo oricum. Trimiterea contează pe măsură ce strângem adrese.
- `red_convocari.canal` acceptă `email`; `nr_document` = `C-nnnn` (prin `fn_red_numar_document`, numere nerefolosite, `red_numere`). `red_raspunsuri.canal` acceptă `email`.
- `red_corespondenta`: evidența mailurilor către instituții, cu aprobarea owner-ului pe conținut. **Nu trimite nimic și rămâne așa** (decizia lui Razvan).
- Decizia 6 (01.11): răspunsul public nu trimite mail/SMS. Planul nu o schimbă: nimic nu pleacă automat la un eveniment.
- Bucket privat `redari` (fișiere imutabile, versiunile pe căi distincte, fără DELETE).

### 0.4 SPF / DKIM / DMARC pentru `gazpet.ro` (DNS public, citit 03.11.2026)
- **MX**: Google (`ASPMX.L.GOOGLE.COM` + ALT1–4). `redari@` trebuie să fie căsuță Google reală, nu rutată spre serverul local ca alte cutii (vezi `redirect-mai-gov`, comentariul din antet).
- **SPF**: `v=spf1 a mx ip4:<IP firmă> include:_spf.google.com ~all` → Gmail e autorizat. `~all` e softfail.
- **DKIM Google**: selectorul implicit `google._domainkey.gazpet.ro` **nu există**. Există doar `resend._domainkey`. Fără DKIM-ul propriu, mailurile din Gmail sunt semnate pe domeniul tehnic Google, iar alinierea DMARC se bazează doar pe SPF (fragil la redirecționări).
- **DMARC**: `v=DMARC1; p=none`, fără `rua`: nu protejează de spoofing și nu trimite rapoarte.
- **De făcut înainte de F2** (Admin Console, Razvan): DKIM Google pornit (cheie 2048, TXT `google._domainkey`), apoi DMARC cu `rua=` pe o adresă internă, `p=none` 2 săptămâni, apoi `p=quarantine`. Altfel convocările pot ajunge în spam, iar oricine poate trimite „de la” `redari@gazpet.ro` către proprietari.

---

## 1. Arhitectura

```
            ┌──────────── redari@gazpet.ro (Gmail) ────────────┐
 cron 5 min │  users.history.list (INBOX, messageAdded)         │  users.messages.send (raw MIME)
 ─────────► │  messages.get / attachments.get                  │ ◄── doar mesaje din loturi APROBATE
            └──────────────────────────────────────────────────┘
                  │ redari-mail-citeste (edge)            ▲ redari-mail-trimite (edge)
                  ▼                                        │
  red_mail_primite + red_mail_atasamente (+ .eml în Storage)  red_mail_loturi → red_mail_mesaje
                  │  propunere de asociere (cod / fir / expeditor)        ▲
                  ▼                                                        │ aprobare (owner), pe versiune
         📥 Mesaje Redări: nou → asociat → rezolvat  ── om ──► (F3) răspuns pe fir = lot de 1
                  │
                  └─► fișa proprietarului: istoric (trimise + primite)
```

Un singur modul comun pe edge, `_shared/gmailRedari.ts`: `token()`, `listeazaIstoric(startHistoryId)`, `citesteMesaj(id)`, `atasament(id, attId)`, `compuneMime({…})`, `trimiteRaw(raw, threadId?)`, `cautaTrimisDupaMessageId(id)`. Testele rulează pe fixture-uri JSON Gmail, fără rețea, ca simulatorul de la SMS.

### 1.1 Funcția de citire: `redari-mail-citeste` (F1)
- **Pornire**: `pg_cron` la 5 minute → `pg_net` cu `x-intern-secret` din Vault (`_shared/poartaCron.ts`), sau owner-ul logat (probă manuală, `?dry=1`). Fără `verify_jwt` ca singură poartă.
- **Comutator**: `red_mail_setari.citire_activa` (implicit `false` la instalare). Îl pornește doar owner-ul.
- **Cursorul**: `red_mail_setari.history_id` (scris doar de RPC-ul `fn_red_mail_cursor_avanseaza`, CAS pe valoarea veche, L03).
  - Pornire: `users.getProfile` → `historyId` + recuperare cu `messages.list?q=in:inbox after:<data aleasă de Razvan>`.
  - Normal: `users.history.list?startHistoryId=<cursor>&historyTypes=messageAdded&labelId=INBOX`, paginat până la capăt.
  - `404` (istoric expirat, ~7 zile de oprire) → recuperare cu `messages.list` de la `ultima_citire_la` minus 1 zi. Dedup-ul acoperă suprapunerea. Evenimentul se notează (`cursor_resetat`).
  - Cursorul **avansează doar după ce toate mesajele paginii sunt salvate** (L12/L21). La o eroare la mijloc rămâne pe loc, iar dedup-ul face reluarea sigură.
- **Ce se ia**: doar `INBOX`. Se sar `SENT`, `DRAFT`, `SPAM`, `TRASH` (spamul se numără, nu se importă). Mesajele noastre trimise intră în BD doar prin calea de trimitere.
- **Per mesaj**: `messages.get?format=full` (Gmail desface MIME-ul, fără parser nou) + `format=raw` o singură dată, pentru `.eml`-ul de evidență din Storage.
- **Câmpuri**: `Message-ID`, `In-Reply-To`, `References`, `From` (adresa normalizată + numele afișat separat), `To`/`Cc`, `Subject`, `Date`, `internalDate`, `threadId`, `Authentication-Results` (doar antetul pus de `mx.google.com`, primul de sus), corpul `text/plain`. HTML-ul e doar convertit în text pe server: nu se stochează pentru afișare și nu se randează niciodată.
- **Limite**: corp ≤ 20.000 de caractere (restul marcat `trunchiat = true`, nu tăiat tacit, L12), subiect ≤ 500, ≤ 20 de atașamente / mesaj, ≤ 10 MB / atașament, ≤ 25 MB / mesaj.
- **Scriere**: un singur RPC atomic `fn_red_mail_primit_insereaza(...)` (L02): `INSERT … ON CONFLICT DO NOTHING RETURNING` (L04) + propunerea de asociere calculată **în BD** (aceeași funcție pentru cron și UI, L19).
- **Erori** (CLAUDE.md, anti-bug edge): erorile de business se scriu în BD + `return`, nu `throw`. `invalid_grant` (token revocat) → `citire_activa = false` automat + `ultima_eroare_cod` + notificare către owner. Răspunsul HTTP conține doar contoare și coduri din listă fixă, fără adrese și subiecte.

### 1.2 Funcția de trimitere: `redari-mail-trimite` (F2, F3)
- **Pornire**: DOAR din UI, de un utilizator cu dreptul de trimitere (§2, fișa d), pe un **lot aprobat**. Fără cron în MVP. Dacă vreodată un lot aprobat trebuie trimis eșalonat de cron, cronul ia doar loturi deja aprobate (ca `sms-trimite`).
- **Pași, per mesaj**:
  1. `fn_red_mail_rezerva(p_lot, p_apelant)`: RPC atomic care ține `red_mail_setari` FOR UPDATE și verifică kill-switch-ul, plafonul pe zi/lună, starea lotului, opt-out-ul și nivelul apelantului. Mută `in_coada → rezervat` cu token de lease (L01, L03).
  2. Compune MIME-ul: `multipart/mixed` (`text/plain` + `text/html` generat din același șablon, UTF-8, antete RFC 2047), `Message-ID: <uuid@gazpet.ro>` **generat de noi și salvat înainte**, `From: Gazpet Instal – Redări <redari@gazpet.ro>`, `List-Unsubscribe: <mailto:redari@gazpet.ro?subject=dezabonare>`. Atașamentul = exact fișierul convocatorului din bucket (`fisier_convocator_path`), verificat pe `continut_hash`-ul arătat la aprobare.
  3. `users.messages.send` (`raw`; la F3 și `threadId`).
  4. `fn_red_mail_rezultat(id, token, gmail_id, thread_id | eroare_cod)`: CAS pe token-ul propriu.
- **Ambiguu** (L05): timeout / 5xx / crash după `send` → stare `necunoscut`, **fără retrimitere automată**. Reconcilierea caută în `SENT` după `rfc822msgid:<Message-ID-ul nostru>`: găsit → `trimis`; negăsit după 24 h → îl decide omul (retrimite = mesaj nou, cheie nouă, aprobare nouă).
- **Ritm**: maximum 1 mesaj / 2 s într-o invocare, maximum 50 / invocare. UI-ul reia până se golește coada (fiecare apel e idempotent).
- **Erori de cont** (`invalid_grant`, `429` repetat, „sending limit exceeded”): `trimitere_oprita = true` automat + motiv. O repornește doar owner-ul.

### 1.3 Tabele noi (prefix `red_mail_`, toate cu RLS, fără DELETE, jurnal prin `fn_red_jurnal` fără PII în clar)
| Tabel | Felie | Conținut | Cine scrie |
|---|---|---|---|
| `red_mail_setari` (un rând) | F1 (+F2) | `citire_activa`, `trimitere_oprita` (implicit `true`), `kill_motiv`, `plafon_zi` / `plafon_luna`, `max_lot`, `extern_permis` (implicit `false`: până atunci doar destinatari `@gazpet.ro`), `history_id`, `ultima_citire_la`, `ultima_eroare_cod`, `versiune` | owner prin RPC; cursorul doar prin RPC-ul de serviciu |
| `red_mail_primite` | F1 | `gmail_id` UNIQUE, `rfc_message_id` UNIQUE (normalizat; lipsă = `sha256(raw)`), `thread_id`, `in_reply_to`, `references_ids text[]`, `de_la_adresa`, `de_la_nume`, `catre`, `subiect`, `corp_text`, `trunchiat`, `primit_la`, `auth_spf` / `auth_dkim` / `auth_dmarc` (`pass` / `fail` / `none` / `necunoscut`), `eml_path`, `proiect_id`; asocierea: `propunere_detinator_ids uuid[]`, `propunere_metoda` (`fir` / `cod` / `expeditor` / `niciuna`), `detinator_id`, `parcela_id`, `convocare_id`, `corespondenta_id`, `mesaj_trimis_id`; starea: `nou` → `asociat` → `rezolvat`, plus `ignorat` (spam / irelevant, cu motiv); `asociat_de/la`, `rezolvat_de/la`, `nota`, `raspuns_id` (legătura cu `red_raspunsuri`, dacă operatorul înregistrează un răspuns), `versiune` | inserare doar prin RPC-ul de serviciu; asociere / stare prin RPC-uri UI (admin / editor), triggerele verifică tranzițiile (L07, L20) |
| `red_mail_atasamente` | F1 | `primit_id`, `nume` (curățat), `mime_declarat`, `mime_detectat` (octeții magici), `marime`, `sha256`, `cale` (bucket `redari`, `mail/primite/<sha256>`), `stare` (`stocat` / `respins_tip` / `respins_marime`) | RPC de serviciu |
| `red_mail_loturi` | F2 | `proiect_id`, `tip` (`convocare` / `reamintire` / `informare` / `raspuns_fir`), `subiect_sablon`, `corp_sablon`, `hash_continut`, `nr_destinatari`, filtrul, excluderile (fără adresă / opt-out / duplicat), stări `draft → aprobat → in_trimitere → coada_golita | anulat` (fără „trimis” pe lot, ca la SMS), `creat_de/nivel`, `aprobat_de/la/nivel` pe `versiune`, `anulat_*` | RPC-uri; triggere ca `fn_sms_loturi_reguli` |
| `red_mail_mesaje` | F2 | un rând per destinatar: `lot_id`, `detinator_id`, `convocare_id`, `catre` (normalizat, **înghețat la crearea lotului**), `cod_ref`, `subiect_final`, `corp_hash`, `atasament_path` + `atasament_hash`, `rfc_message_id` UNIQUE, `idempotency_key` UNIQUE, `in_reply_to_primit_id` (F3), `gmail_id`, `thread_id`, stări `in_coada → rezervat → trimis | esuat | necunoscut | anulat`, `eroare_cod` (doar `[a-z0-9_]`, niciodată textul Google) | doar RPC-uri |
| `red_mail_optout` | F2 | `email` normalizat UNIQUE, `activ`, `motiv`, `sursa` (`cerere_mail` / `telefon` / `operator`), `primit_id` (dovada) | owner / admin prin RPC, după confirmare umană |
| `red_mail_sugestii` | F4 | `primit_id`, `model`, `categorie` (enum), `incredere`, `fragmente` (offset-uri în text, nu text nou), `cost` | edge F4 prin RPC |

**Storage**: `redari/mail/primite/<sha256>.eml` și `redari/mail/primite/<sha256>` (atașamente), descărcare doar admin / editor, prin URL semnat cu `Content-Disposition: attachment` și `descarcaCuJurnal` (monitorul de egress).

**Vederi** (`security_invoker = on`): `red_mail_v_inbox` (lista pentru ecran, cu un fragment scurt de corp), `red_mail_v_istoric_detinator` (trimise + primite + convocări pe canal `email`, ordonate în timp).

### 1.4 Codul unic în subiect
- **Format**: `[RED-C-0012-K7Q]`.
  - `C-0012` = `nr_document`-ul convocării. Convocarea pe e-mail = un rând `red_convocari` cu `canal = 'email'` și numărul ei propriu `C-nnnn`, ca la poștă.
  - `K7Q` = 3 caractere de control: `HMAC(REDARI_MAIL_REF_SECRET, cod)`, base32 fără caractere ambigue. Prinde greșelile de tastare și codurile inventate.
- La mesajele care nu sunt convocări (reamintire, răspuns pe fir): `[RED-M-000123-XXX]`, cu cheia nouă `M` în `red_numere` (prin `fn_red_numar_document`, numere nerefolosite).
- **Parsare** (L13): regex ancorat pe forma exactă, cu test pozitiv + negativ (`[RED-C-12]`, `RED-C-0012` fără paranteze, cod valid cu control greșit, două coduri diferite în subiect → „ambiguu”).
- **Codul e un indiciu, nu o dovadă**: oricine îl vede pe plic sau în mail îl poate copia. Așa că nu asociază singur, doar propune (§1.5).

### 1.5 Asocierea (propunere în BD, confirmare de om)
Ordinea, într-o singură funcție SQL (`fn_red_mail_propunere`, L19):
1. **Firul**: `In-Reply-To` / `References` conțin `rfc_message_id`-ul unui mesaj trimis de noi → deținătorul acelui mesaj.
2. **Codul** valid din subiect → convocarea → deținătorul.
3. **Expeditorul**: adresa normalizată (minuscule, fără `+tag` doar la gmail.com, de verificat) = `red_detinatori_contact.email` (deținători activi). Poate întoarce **mai mulți** deținători (coproprietari, aceeași adresă pe mai multe parcele): `propunere_detinator_ids` = lista.
4. Altfel: `niciuna` → mesajul apare ca **„de triat”**.

- Expeditor ≠ adresa din contact, deși firul sau codul se potrivesc → steag „expeditor diferit”. Operatorul poate adăuga adresa la contact doar cu o confirmare separată (PII nou, jurnalizat).
- Autentificarea (`dmarc = fail` sau `none`) se afișează lângă expeditor. **Nu e dovadă de identitate** în niciun caz (§2.4).
- Mailurile de la instituții (primării, APM, Transgaz) se pot lega de un rând `red_corespondenta`. Starea `raspuns_primit` acolo o pune tot omul, cu regulile existente.
- **„Asociat”** = omul a confirmat legătura (sau a ales manual deținătorul / parcela). **„Rezolvat”** = omul a terminat ce era de făcut: a înregistrat răspunsul în Registru (`red_raspunsuri`, `canal = 'email'`), a sunat proprietarul, a răspuns pe fir etc. Nicio tranziție nu se face automat.

### 1.6 Deduplicare, fire, răspuns pe fir
- **Dedup**: `UNIQUE (gmail_id)` + `UNIQUE (rfc_message_id)`. Același mail ajuns de două ori (Cc + To, redirecționat) intră o singură dată. Reluarea cursorului e sigură.
- **Firul** se vede în ecran după `thread_id` (Gmail) și, la mesajele noastre, după `References`.
- **Răspuns din ERP pe același fir** (F3): butonul „Răspunde” creează un **lot de 1** (`tip = raspuns_fir`, `in_reply_to_primit_id`). Textul îl scrie omul. Aprobarea e aceeași ca la loturi, apoi `messages.send` cu `threadId` + `In-Reply-To` + `References` + `Re: <subiect>` + codul.
- **Destinatarul răspunsului = adresa din contactul deținătorului**, nu `From` / `Reply-To` din mailul primit. Dacă diferă, UI-ul arată ambele și cere o confirmare explicită. Așa evităm să trimitem date ale proprietarului către o adresă falsificată.

### 1.7 Limite, plafoane, kill-switch, opt-out
- **Limitele Google** (de verificat pe pagina Google Workspace „Gmail sending limits” înainte de F2; cifrele de mai jos sunt din cunoștințe generale):
  - ~2.000 de mesaje / zi / utilizator;
  - ~10.000 de destinatari / zi, dintre care ~3.000 externi unici;
  - API: `messages.send` = 100 de unități de cotă, limita per utilizator ~250 de unități / s.
  - **La depășire, Google suspendă trimiterea contului până la 24 de ore**, deci plafonul nostru stă mult sub.
- **Plafoane proprii** (în BD, atomic la rezervare, ca `fn_sms_rezerva`): pornire **200 / zi, 1.000 / lună, maximum 300 de destinatari / lot**, plus maximum 1 mesaj / destinatar / 24 h pe tipul `reamintire`.
- **Kill-switch**: `trimitere_oprita` (implicit `true` la instalare) și `citire_activa` (implicit `false`), doar owner-ul. Operațiile de oprire ocolesc orice cotă (L20).
- **Mod test**: cât timp `extern_permis = false`, lotul se poate crea și aproba, dar RPC-ul refuză orice destinatar în afara `@gazpet.ro` (verificare pe domeniu exact, ca testele `destinatari_test.ts` din `ofertare-rc-necitit`).
- **Opt-out**: `red_mail_optout`, verificat la crearea lotului și din nou la rezervare. Cererea de dezabonare care vine pe mail (subiect „dezabonare” de la `List-Unsubscribe` sau text liber) **nu** se aplică automat: e conținut extern. Apare ca steag „cere dezabonare” pe mesaj, iar un singur clic al operatorului o confirmă. Efectul unui opt-out fals e mic (proprietarul primește convocarea prin poștă), dar regula rămâne: nicio acțiune automată pe text extern.

---

## 2. Securitatea

### 2.1 Fișa a–e: `redari-mail-citeste` (F1)
- **(a) Conținut extern citit**: TOT ce intră în `redari@`: mailuri de la proprietari, instituții, spam, phishing; antete, corp, atașamente. Se tratează ca date (pct. 10).
- **(b) Ce scrie / face**: inserează în `red_mail_primite` / `red_mail_atasamente` + fișiere în `redari/mail/primite/`, avansează cursorul. **Nu trimite nimic, nu modifică nimic în Gmail** (scope `gmail.readonly`), nu atinge bani, drepturi sau `red_raspunsuri`. → (a) ∩ (b) se ating doar prin scrierea datelor ca date. Nicio acțiune nu decurge din ele.
- **(c) Identitate**: edge cu `service_role`, **doar după poartă**. Justificare: tabelele `red_mail_*` nu au INSERT pentru `authenticated` (nici n-ar trebui: nimeni nu are voie să „fabrice” un mail primit), iar cursorul și coloanele de proveniență (`gmail_id`, `auth_*`, `de_la_adresa`) le scrie doar serverul (L08). Totul trece prin RPC-ul `fn_red_mail_primit_insereaza`, cu EXECUTE doar pentru `service_role`.
- **(d) Cine o poate porni**: cronul cu `x-intern-secret` (Vault, `poartaCron.ts`), sau owner-ul logat (`is_owner`, verificat în cod). Test obligatoriu: cheia anon și un JWT de utilizator obișnuit primesc 401 / 403 (lecția PR #318).
- **(e) Confirmare umană**: nu trimite nimic. Asocierea, rezolvarea, înregistrarea răspunsului și opt-out-ul le face omul. Pornirea citirii (`citire_activa`) o face doar owner-ul.

### 2.2 Fișa a–e: `redari-mail-trimite` (F2 + F3)
- **(a) Conținut extern citit**: indirect. Adresele din `red_detinatori_contact.email` (introduse de operatori sau propuse dintr-un mail primit), iar la F3 mesajul la care se răspunde (doar pentru `threadId` / `In-Reply-To`, nu ca text care decide ceva).
- **(b) Ce scrie / face**: **trimite mail extern** din `redari@` (cu PII: nume, parcelă, convocator atașat), scrie `red_mail_mesaje` și `red_convocari` (`canal = email`, `data_expediere`). Nu atinge drepturi, nu șterge.
- **(c) Identitate**: edge cu `service_role` după poartă. Justificare: stările, `gmail_id`, `rfc_message_id` și consumul din plafon nu pot fi lăsate la îndemâna `authenticated`. Scrierea trece doar prin RPC-uri SECURITY DEFINER care re-verifică nivelul apelantului (`p_apelant` = uid-ul verificat de edge, ca `fn_sms_rezerva` din 20261130b).
- **(d) Cine o poate porni**: utilizator logat cu nivelul Redări cerut (`poartaModul.ts` + nivelul verificat **și în BD** la rezervare), doar pe loturi `aprobat`. Aprobarea lotului: **doar owner-ul** (întrebarea 5), pe `versiune` + `hash_continut` văzute. Teste: anon 401, viewer Redări 403, editor fără aprobare → refuz în BD, lot modificat după aprobare → aprobarea cade (ca `fn_red_corespondenta_reguli`).
- **(e) Confirmare umană**: **orice trimitere = lot aprobat de owner**, după un preview cu lista **fixată** a destinatarilor (nume + e-mail mascat), textul final exact, atașamentul cu hash-ul lui, numărul de excluși (fără adresă / opt-out / duplicat) și plafonul rămas. Răspunsul pe fir (F3) = lot de 1, aprobat la fel. Un mail primit nu poate declanșa niciodată o trimitere. → Regula tare (a) ∩ (b) e acoperită de poarta de rol + aprobare.

### 2.3 Fișa a–e: `redari-mail-sugereaza` (F4, opțional)
- **(a)**: corpul și subiectul mailurilor primite (extern, posibil ostil).
- **(b)**: scrie doar `red_mail_sugestii` (categorie din enum + încredere + offset-uri). Costă bani (API AI). Nu trimite, nu asociază, nu schimbă stări.
- **(c)**: `service_role` după poartă; cheia AI e cea existentă a platformei (`ANTHROPIC_API_KEY`), prin `_shared/haiku55.ts`.
- **(d)**: operatorul (admin / editor Redări) pe un mesaj, sau owner-ul pe un lot de mesaje. **Nu din cron** în prima variantă. Rezervarea costului înainte de apel (L22, ca `fn_tts_rezerva`).
- **(e)**: sugestia e doar afișată („pare: particip / obiecții / cere dezabonare / spam / instituție”). Orice efect (asociere, răspuns, opt-out) îl face omul.

### 2.4 Riscuri și măsuri
- **Anti prompt-injection**:
  - F1–F3: **niciun model AI** pe mailuri.
  - F4: modelul primește textul încadrat ca date, **fără unelte, fără web, fără acces la BD**, cu `max_tokens` mic. Ieșirea se validează strict pe schemă (enum, offset-uri în interiorul textului, L21): orice altceva = sugestie aruncată. Textul primit nu ajunge niciodată ca instrucțiune la un model cu unelte (nici la Claude din sesiunile de lucru: când un mail Redări e citit de o sesiune, regula pct. 10 se aplică).
- **Atașamente**:
  - listă albă: PDF, JPEG, PNG (eventual HEIC, de decis), verificată pe octeții magici, nu pe extensie sau pe MIME-ul declarat;
  - respinse (doar metadatele rămân): executabile, arhive, HTML, SVG, Office cu macro (`.docm`, `.xlsm`), `.eml` încuibate;
  - niciun atașament nu se deschide, convertește, OCR-izează sau trimite la AI automat;
  - descărcare doar ca fișier (`attachment`), niciodată randat în aplicație;
  - mărimi: 10 MB / fișier, 25 MB / mesaj.
- **Linkuri**: corpul se afișează doar ca text. Linkurile **nu sunt clicabile** (se arată domeniul evidențiat), imaginile la distanță nu se încarcă niciodată (nu randăm HTML, deci nici pixeli de urmărire), ERP-ul nu urmează niciun link.
- **PII în loguri**:
  - `console.*` doar coduri (`eroare_cod`), niciodată adrese, subiecte sau corp;
  - răspunsurile HTTP ale edge-urilor = contoare + stări din listă fixă (`pg_net` le păstrează);
  - Sentry pe ecran cu `src/redari/sentryScrub.js`;
  - jurnalul `red_jurnal` doar cu numele câmpurilor + sha256 pe adrese (ca la `red_detinatori_contact`);
  - adresele afișate mascat în listele de lot (`i***n@gmail.com`).
- **Vizibilitate**: mesajele primite (corp, atașamente, adrese) le văd **admin / editor Redări**. Viewer-ul vede doar numărătorile (întrebarea 10). RLS + RPC, nu doar UI (L07, L09).
- **Retenție** (de confirmat cu Juridic):
  - mesajele asociate + `.eml` + atașamente: ca restul dosarului (`text_gdpr`: „pe durata contractului și a termenelor legale de arhivare”);
  - `ignorat` (spam / irelevant): corpul și atașamentele se golesc după 90 de zile, rămâne rândul cu metadate minime;
  - căsuța Gmail: politică de retenție în Google Vault (Admin Console), aliniată cu cea din ERP.
- **GDPR**:
  - textul implicit `red_proiecte.text_gdpr` (din 20261126a) **nu menționează e-mailul** ca mijloc de comunicare și nici Google ca destinatar / sub-împuternicit;
  - informarea v3 (`A3_Informare_GDPR_Lot1_v3_final.docx`, PR #939 draft) **nu e în repo**: de verificat dacă acoperă e-mailul;
  - Transgaz e operatorul, Gazpet e împuternicitul, deci Google Workspace devine sub-împuternicit (art. 28(2): autorizarea scrisă a Transgaz, la fel ca la SMS). DPA-ul Google Workspace există (de atașat la dosar);
  - de unde vin adresele: operator la telefon, un câmp opțional în formularul public (cu informare), sau adresa dintr-un mail primit, adăugată la contact doar după confirmarea omului;
  - **e-mailul nu înlocuiește convocarea poștală cu confirmare de primire** până nu spune altfel Juridic (întrebarea 6).
- **SPF / DKIM / DMARC**: §0.4. DKIM Google + DMARC cu raportare sunt **precondiție pentru F2**.
- **Spoofing pe expeditor**:
  - `From` se falsifică ușor, mai ales de pe domenii cu DMARC `p=none` (inclusiv al nostru, azi);
  - asocierea după expeditor sau după cod **nu dovedește identitatea**: e doar o propunere, cu insigna `spf` / `dkim` / `dmarc` alături;
  - un răspuns cu efect juridic (obiecții, refuz, renunțare) înregistrat din mail se marchează `sursa = email, neverificat` până la o confirmare pe alt canal (telefon / semnătură), de decis cu Juridic;
  - răspunsul pe fir merge la adresa din contact, nu la `From` (§1.6).

---

## 3. Felii de livrare

Porți comune pentru fiecare felie: branch din `origin/main`, review **GO Jakarinos + Copilot** pe diff, DRY verde pe prod (migrare cu gardă de start, o tranzacție, postcondiții, `_ROLLBACK.sql` care nu șterge date, L14), build `npx vite build`, rând în `automatizari` + secțiune în `registru_automatizari` (fișa a–e, doar nume de secrete). Merge / deploy / apply le face sesiunea de programare după GO (regula din 01.11). **Pornirea citirii, pornirea trimiterii și `extern_permis` cer „da”-ul lui Razvan** (date reale / mail extern).

### F0 — Pregătire (fără cod de producție; în paralel cu F1)
- Pașii manuali de la §4 (OAuth, consimțământ, secrete, DKIM / DMARC).
- Juridic: mențiunea e-mailului în informare, autorizarea Transgaz pentru Google, valoarea juridică a convocării pe e-mail.
- Deciziile de la §5.

### F1 — Primirea (citire + centralizare, fără trimitere)
- **Migrare: da.** `2026113?a_redari_mail_primire`: `red_mail_setari`, `red_mail_primite`, `red_mail_atasamente`, RPC-urile `fn_red_mail_primit_insereaza` (doar `service_role`), `fn_red_mail_cursor_avanseaza` (CAS), `fn_red_mail_propunere`, `fn_red_mail_asociaza` / `_rezolva` / `_ignora` / `_redeschide` (admin / editor, CAS pe `versiune`), `fn_red_mail_setari_salveaza` (owner), vederile `red_mail_v_inbox` / `red_mail_v_istoric_detinator`, politicile de Storage pe `redari/mail/`. Cronul `pg_cron` se creează **oprit** (sau `citire_activa = false`).
- **Edge: da.** `redari-mail-citeste` + `_shared/gmailRedari.ts` (doar citire). Scope `gmail.readonly`.
- **UI: da.**
  - `src/redari/ui/MesajeEcran.jsx` — „📥 Mesaje Redări”: file Nou / De triat / Asociat / Rezolvat / Ignorat, căutare, firul, propunerea de asociere cu motivul, insignele de autentificare, steagurile („expeditor diferit”, „cere dezabonare”, „trunchiat”), atașamentele ca listă descărcabilă, butoanele Asociază / Rezolvă / Ignoră / Înregistrează răspuns (deschide formularul existent de răspuns, cu `canal = email`);
  - pe `FisaParcela.jsx` (fișa proprietarului): secțiunea „Istoric e-mail”;
  - Dashboard: contorul „mesaje noi”.
- **DRY / teste**:
  - DRY SQL (tranziții, CAS, dedup dublu, cursor care nu avansează la eroare, viewer fără acces la corp, anon fără nimic, L25 ca non-owner);
  - teste Deno pe fixture-uri Gmail (multipart, HTML-only, fără `Message-ID`, `history` 404 → recuperare, atașament respins pe octeți magici, cod valid / greșit / dublu, `invalid_grant` → citire oprită), poarta 401 / 403;
  - teste Vitest pe ecran (randare text, linkuri neclicabile);
  - probă pe prod: `?dry=1` de owner, apoi citire reală pe mailuri de test trimise de noi pe `redari@`.

### F2 — Trimiterea în loturi cu aprobare
- **Migrare: da.** `…b_redari_mail_trimitere`: `red_mail_loturi`, `red_mail_mesaje`, `red_mail_optout`, cheia `M` în `red_numere`, RPC-urile `fn_red_mail_lot_creeaza` (preview implicit: excluderi, lista fixată, plafon), `_lot_destinatari`, `_lot_aproba` (owner, pe versiune + hash), `_lot_anuleaza`, `fn_red_mail_rezerva` (atomic: kill-switch, plafon, opt-out, `extern_permis`, nivel), `fn_red_mail_rezultat` (CAS pe lease), `fn_red_mail_reconciliaza`, `fn_red_mail_optout_seteaza`; crearea `red_convocari` cu `canal = 'email'` în același RPC cu lotul (L02). Ordinea lock-urilor scrisă în comentariu (L06): setări → lot → mesaje.
- **Edge: da.** `redari-mail-trimite` (+ `compuneMime`, `trimiteRaw`, `cautaTrimisDupaMessageId` în `_shared`). Scope `gmail.send` (acordat de la început, §4).
- **UI: da.** În Registru / Convocări: „✉️ Lot e-mail” (alegi UAT / parcele / doar cei cu adresă și fără convocare pe e-mail), șabloanele de text (subiect + corp, cu `{{…}}` din `SABLOANE.md`, textul validat de Juridic), preview-ul fixat, aprobarea (owner), butonul „Trimite” cu progres și reluare, panoul de setări (kill-switch, plafoane, `extern_permis`, opt-out).
- **DRY / teste**:
  - DRY SQL: aprobare pe versiune veche refuzată, lot schimbat după aprobare, plafon la concurență (2 sesiuni + barieră, L25), opt-out adăugat între creare și rezervare, destinatar extern cu `extern_permis = false`, `necunoscut` fără retrimitere;
  - teste Deno: MIME (UTF-8, RFC 2047, atașament, `Message-ID`), timeout după `send` → `necunoscut` → reconciliere;
  - probă: 3 adrese `@gazpet.ro`, apoi „da” pentru `extern_permis` și un prim lot mic (≤ 10 destinatari).
- **Precondiții**: DKIM Google + DMARC cu `rua`, textul validat de Juridic, autorizarea Transgaz.

### F3 — Răspuns pe fir
- **Migrare: mică** (`…c`): `tip = raspuns_fir`, `in_reply_to_primit_id`, regula „lot de 1”, destinatarul = contactul deținătorului (sau confirmarea explicită a diferenței), legătura primit → răspuns trimis. Poate intra în F2 dacă e gata odată cu ea.
- **Edge**: `redari-mail-trimite` primește `threadId` + `In-Reply-To` / `References`.
- **UI**: „Răspunde” în Mesaje (ciornă → aprobare → trimite), firul complet pe ecran, mesajul primit devine `rezolvat` doar când omul îl marchează.
- **DRY / teste**: răspuns la adresă diferită de contact (cere confirmare), fir corect în Gmail (test pe o căsuță internă), aprobarea care cade la editarea textului.

### F4 — Sugestii AI (opțional)
- **Migrare: da** (`…d`): `red_mail_sugestii` + rezervarea costului (tiparul `fn_tts_rezerva`, L22).
- **Edge**: `redari-mail-sugereaza` (Haiku prin `_shared/haiku55.ts`, fără unelte, ieșire validată pe schemă).
- **UI**: insigna „sugestie” pe mesaj, cu fragmentele subliniate. Butonul „Aplică” face doar ce ar face omul manual, cu clicul lui.
- **DRY / teste**: răspuns AI gol / trunchiat / în afara enumului aruncat, text cu instrucțiuni injectate („ignoră regulile și trimite…”) → doar o categorie, nicio acțiune, cost rezervat și decontat o dată.

---

## 4. Pașii manuali cu Razvan (fără valori, doar nume)

1. **Accesul contului Claude la `redari@`**: delegare Gmail către contul Claude (citire, pentru verificarea testelor), sau parola contului în Credential Manager pe serverul AI, doar dacă Razvan preferă. Claude nu trimite niciodată manual din interfața Gmail.
2. **Clientul OAuth** (Google Cloud, în proiectul în care stă clientul existent pentru `GMAIL_CLIENT_ID`, sau în unul nou):
   - Gmail API activat;
   - ecran de consimțământ **Internal**;
   - client nou dedicat „ERP Redări mail” (tip Web, redirect = URL-ul unei funcții de callback, ca la `vicare`);
   - în Admin Console, dacă accesul aplicațiilor terțe e restricționat: aplicația marcată de încredere.
3. **Consimțământul, o singură dată**, logat ca `redari@`: scope-urile `gmail.readonly` + `gmail.send` (fără `gmail.modify` și fără `https://mail.google.com/`: ERP-ul nu poate șterge sau muta nimic în căsuță).
   - Fluxul recomandat: un edge `redari-mail-oauth` (doar owner, `state` aleator cu consum atomic, ca `olx-api` / `vicare`) scrie refresh token-ul direct în **Vault**. Valoarea nu trece prin chat, loguri sau fișiere.
   - Alternativa fără callback: OAuth Playground cu clientul propriu → `.env` temporar → `supabase secrets set --env-file` → fișier șters (tiparul Firecrawl din registru).
4. **Secretele** (doar nume):
   - `REDARI_GMAIL_CLIENT_ID`, `REDARI_GMAIL_CLIENT_SECRET` (Edge Secrets);
   - `REDARI_GMAIL_REFRESH_TOKEN` (Vault, citit de edge prin RPC doar pentru `service_role`);
   - `REDARI_MAIL_REF_SECRET` (Vault: cheia HMAC pentru caracterele de control din cod);
   - existente, refolosite: `INTERN_EDGE_SECRET` (cron, Vault), `ANTHROPIC_API_KEY` (doar F4).
   - **Nu se refolosesc** `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` (căsuța lui Razvan).
5. **DNS / Admin Console**: DKIM Google pornit + TXT `google._domainkey` publicat; DMARC cu `rua=` (de ales adresa), apoi `p=quarantine`; politica de retenție pentru `redari@`.
6. **Registre**: rând în `public.automatizari` pentru fiecare funcție (citire, trimitere, oauth, F4) + secțiunea „E-mail Redări” în `registru_automatizari`, în aceeași sesiune cu livrarea.
7. **Revocare de urgență**, de scris în registru: Admin Console → Security → API controls (sau contul `redari@` → Securitate → Aplicații terțe) → elimină accesul „ERP Redări mail”, plus kill-switch-urile din ERP.

---

## 5. Întrebări deschise (varianta recomandată prima)

1. **Cum ajunge ERP-ul la căsuță**: **A** client OAuth dedicat + refresh token în Vault prin callback owner (recomandat) / **B** clientul existent `GMAIL_CLIENT_ID` + refresh token nou pe `redari@` / **C** Apps Script pe `redari@` care împinge mailurile spre edge (ca `oferte@`; trimiterea rămâne însă la A sau B).
2. **Scope-urile, într-o singură autorizare**: **A** `gmail.readonly` + `gmail.send` de la început (recomandat, se potrivește cu „o singură dată”) / **B** doar `readonly` acum și `send` la F2 (al doilea consimțământ).
3. **Asocierea**: **A** mereu confirmată de om, cu propunerea precompletată (recomandat) / **B** automată când firul ȘI expeditorul se potrivesc cu contactul.
4. **Cererile de dezabonare venite pe mail**: **A** steag + confirmarea omului (recomandat) / **B** opt-out automat la „dezabonare” în subiect.
5. **Cine aprobă loturile de e-mail**: **A** doar owner-ul (recomandat, ca la SMS extern) / **B** owner + admin Redări (Răzvan Toma), cu nivel explicit.
6. **Valoarea juridică a e-mailului**: **A** canal suplimentar, poștă cu AR rămâne obligatorie (recomandat până la avizul Juridic) / **B** echivalent cu convocarea poștală pentru cei care și-au dat acordul.
7. **Plafoanele de pornire**: **A** 200 / zi, 1.000 / lună, maximum 300 / lot (recomandat) / **B** alte cifre.
8. **Retenția**: **A** dosar = termenul din `text_gdpr`; spam / irelevant golite după 90 de zile (recomandat) / **B** altă durată (Juridic).
9. **Sursa adreselor**: **A** operator + câmp opțional în formularul public, cu informare + propunere din mail primit, confirmată de om (recomandat) / **B** doar operatorul.
10. **Cine vede mesajele primite**: **A** admin + editor Redări, viewer doar numărători (recomandat) / **B** doar admin.
11. **DKIM / DMARC**: **A** DKIM Google acum, DMARC `p=none` + `rua` 2 săptămâni, apoi `quarantine`, înainte de F2 (recomandat) / **B** după F2.
12. **Cronul de citire**: **A** la 5 minute (recomandat) / **B** la 15 minute / **C** notificare push Gmail prin Pub/Sub (mai rapid, dar cere Pub/Sub și un endpoint public: nu merită la volumul ăsta).
