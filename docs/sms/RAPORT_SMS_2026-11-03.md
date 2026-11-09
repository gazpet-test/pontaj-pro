# SMS în PontajPRO — review (doar citire), 03.11.2026

Surse: repo (`origin/main` 350b20ae), BD prin psql read-only (doar numărători), lista edge live (Supabase MCP, read-only), legislatie.just.ro.
Ce e marcat „de verificat” vine din cunoștințe generale: nu am deschis site-uri de furnizori.

## 0. De reținut înainte de orice (găsit în timpul review-ului)
- **`notify-whatsapp` (edge live v29, din 16.05, nu e în repo) e o gaură încă deschisă.** Are `verify_jwt=true`, dar nu verifică rolul în cod: cheia anon ajunge ca să trimită un șablon WhatsApp aprobat către ORICE număr (`recipient_phone` + `force=true` ocolesc tier / test_mode). Cu `dry_run` întoarce și telefonul + numele oricărui profil după UUID. E cunoscută din 30.09 (`docs/SECURITATE_MATRICE_ACCES_2026-09-30.md:391`, §5.3), dar nu e reparată. Nu e în `automatizari` și nici în registru. Jurnalul (`notification_logs`) are un singur apel, pe 17.05 → nu pare folosită.
- Tokenul WhatsApp e **scris în clar** în corpul funcțiilor BD `submit_template_to_meta` / `sync_templates_status` (registru, linia „Token WhatsApp vechi: încă HARDCODAT…”). EXECUTE are doar service_role, dar tokenul trebuie mutat în Vault. Nu l-am reprodus.
→ Le punem ca felia 0. Orice canal mobil nou pornește după ce astea două sunt închise.

## 1. Ce avem deja
| Ce | Unde | Stare |
|---|---|---|
| Canalul `sms` în schema Redări | `supabase/migrations/20261126a_redari_teren.sql:194` (`red_convocari.canal`), `:212` (`red_raspunsuri.canal`); `src/redari/ui/comune.jsx:115`; `src/redari/exportXlsx.js:23` | doar valoare de enum: 0 convocări, 0 răspunsuri |
| Decizia 6 (01.11): răspunsul public nu trimite mail/SMS, totul manual | `src/RedariRaspunsPublic.jsx:10`, `docs/redari/README.md:401` | în vigoare |
| SMSLink propus în brief-ul Redări (adaptor `send(to,text,ref)` + webhook DLR) | `docs/redari/BRIEF_2026-11-01.md:171-177` | doar propunere |
| R6: urmărirea celor fără răspuns („SMS/mail extern doar cu da”) | `docs/automatizari/PROPUNERI_20261103.md:21` | propunere |
| WhatsApp Business (Meta Cloud API): firmă verificată, **10 șabloane Utility aprobate**, toate `test_mode=true` | `notification_templates` (10), `notification_logs` (1 rând), edge `notify-whatsapp`, `src/whatsapp_meta_templates_ghid.md` | infrastructură adormită |
| Opt-in per utilizator: `phone_whatsapp`, `whatsapp_enabled`, `whatsapp_tier` | `src/App.jsx:6755-6762`, `:7585+`; în BD 6/36 profile au număr, 1 e activat | **auto-editabil** de utilizator (matricea, `:384-390`) → nu e sursă bună pentru SMS |
| Mail: Resend de pe `rapoarte@` / `facturi@gazpet.ro` (domeniu verificat), RESEND_API_KEY în Edge Secrets | `supabase/functions/send-factura-email/index.ts`, registru (secțiunea Resend) | ~20 automatizări active |
| Porțile de reutilizat | `_shared/poartaModul.ts` (JWT + owner sau `user_module_access`), `_shared/poartaIntern.ts` (`x-intern-secret` din Vault), `_shared/poartaCron.ts` (cron sau owner) | probate în producție |
| Model de aprobare umană pe canal extern | `meta-publish/index.ts:10-13`: publică doar ce e `aprobata` de owner / `marketing_aprobatori`, tokenul din Vault | de copiat la SMS |
| Model de plafon de cost atomic | `fn_tts_rezerva` (`20261019a_tts_mesaj_vocal.sql:8-10`) | de copiat (`fn_sms_rezerva`) |
| Notificări în aplicație | `notifications`: 11.661 în 30 de zile, către 24 de utilizatori (6.736 sunt „rompetrol fără whatsapp”) | SMS-ul trebuie să fie selectiv, nu încă o copie a clopoțelului |

**Câte numere de telefon avem** (completate / total):
- `employees.telefon`: 94 din 124 de angajați activi, toate în format mobil RO valid (76%).
- `red_detinatori_contact.telefon`: **0 din 2.548**. Emailuri: tot 0.
- `hr_recrutare_candidati`: 46/51. `comenzi_furnizor`: 68/169. `logistica_transporturi.sofer_extern_telefon`: 1/113.
- `red_uat`: 6/7 primării.

Formularul public Redări NU cere telefonul deținătorului (afișează doar telefonul Gazpet).

## 2. Cazuri de utilizare
| Caz | Destinatar | Volum estimat | Valoare | Risc juridic |
|---|---|---|---|---|
| Alerte critice interne (ITP / RSVTI / dovezi expirate, stoc motorină, login admin suspect) | intern, 3–10 persoane | 30–100 / lună | **mare**: oprește amenzi și opriri pe șantier | mic: angajați, scop operațional |
| Anunțuri HR / pontaj (ședință, schimbare de program, salariu virat) | 94 de angajați cu mobil | 100–300 / lună | mare la oamenii de pe teren fără email | mic: art. 6(1)(b)/(f) GDPR + mențiune în informarea angajaților |
| Transporturi: aprobat / blocat, către șofer | intern (șoferi), rar extern | ~25 / lună | medie | mic intern; extern doar cu număr dat de firma lui |
| Redări: reamintire de sesiune, confirmare răspuns, urmărirea celor fără răspuns (R6) | **extern**, proprietari | 0 azi (0 numere); 1,5–3k / proiect dacă strângem 20–40% din numere | mare la participare, dar **nu înlocuiește convocarea scrisă cu confirmare de primire** | **mare**: Transgaz e operatorul, Gazpet e împuternicit → furnizorul SMS e sub-împuternicit (art. 28(2) GDPR: autorizarea scrisă a Transgaz), mențiunea „pentru Transgaz” + link spre informarea `text_gdpr` |
| Recrutare: confirmare / programare interviu | extern, candidați | ~20 / lună | medie | mediu: demersuri precontractuale + informare în formularul de aplicare |
| Tichete | intern | ~50 / lună | mică: clopoțelul + mailul ajung | — |

Legea 506/2004 art. 12(1) (verificat pe legislatie.just.ro) cere consimțământ prealabil expres DOAR pentru **comunicări comerciale**. Mesajele noastre sunt operaționale, deci intră sub GDPR, nu sub art. 12. Condiție: niciun conținut promoțional în aceleași SMS-uri.

## 3. Variante
Criterii (cerința lui Razvan): (1) furnizor stabil, prezent în RO; (2) sender ID „GAZPET” înregistrat pe Gazpet și portabil; (3) API standard + webhook DLR; (4) factură în RON / românească; (5) DPA art. 28, servere în UE; (6) SLA; (7) cost previzibil la ~500/lună + vârfuri de 3k.

| | A. Agregator român (ex. SMSLink) | B. CPaaS european (ex. Infobip) | C. Operatorul de telefonie al firmei (Orange / Vodafone Business) |
|---|---|---|---|
| (1) Stabilitate / RO | firmă RO, mai mică (vechime și cifră de afaceri de verificat) | foarte mare, sediu în UE (HR); birou în RO de verificat | maximă |
| (2) Sender ID | da, taxă unică (brief: „270 + TVA”, moneda de verificat); LOA pe Gazpet de cerut | da, cu documente; LOA de cerut | da, direct la operator |
| (3) API + DLR | HTTP/JSON + webhook (brief) | REST matur, DLR, sandbox | HTTP/SMPP, documentație mai slabă (de verificat) |
| (4) Factură RON | da, prepaid | probabil EUR, entitate străină (de verificat) | da, pe contractul existent |
| (5) DPA / UE | de verificat (servere RO?) | ISO 27001, UE (de verificat) | da |
| (6) SLA | probabil fără SLA formal (de verificat) | SLA contractual | SLA contractual |
| (7) Cost | ~0,03–0,05 EUR/SMS (brief „~0,048”), fără abonament | ~0,05–0,09 EUR, posibil prag minim | negociat, posibil abonament minim |
| Efort integrare | mic | mic | mediu (onboarding prin account manager) |

Twilio / Vonage (SUA): transfer în afara UE (SCC/DPF), sender ID RO cu pre-înregistrare, mai scumpe, factură în USD/EUR → nu se potrivesc criteriilor 4–5.
WhatsApp prin Meta (deja aprobat): gratuit ca platformă, dar o parte din oameni nu au WhatsApp. Rămâne canal intern opțional, NU înlocuiește SMS-ul.

**Recomandarea fermă: A — agregator român, cu SMSLink drept candidat.** Motive: factură în RON, prepaid (cost previzibil, fără surprize), suport și lege română, deja ales în brief-ul Redări. Riscul de firmă mică îl acoperă arhitectura: schimbarea furnizorului = un adaptor nou + un secret.
**Rezervă: B — Infobip.** Trecem pe B dacă SMSLink pică verificarea de la §7 (fără DPA sau LOA pe Gazpet), sau dacă Transgaz cere pentru Redări un sub-împuternicit certificat ISO 27001.

**Arhitectura, independentă de furnizor (partea care rămâne definitivă):**
- **Adaptor unic** `_shared/smsFurnizor.ts` cu interfața `trimite({to,text,ref}) → {ok, furnizor_id, segmente, eroare}`, `status(furnizor_id)`, `parseazaDlr(req)` și `verificaDlr(req)`.
  - Implementări: `smsFurnizor_smslink.ts`, `smsFurnizor_infobip.ts`, `smsFurnizor_simulator.ts` (pentru teste, fără rețea).
  - Alegerea furnizorului: secretul `SMS_FURNIZOR`.
- **Tabelele noastre:**
  - `sms_mesaje` (coada + jurnalul): stările `ciorna → de_aprobat → aprobat → in_coada → trimis → livrat | esuat | respins | expirat`, plus `idempotency_key` unic, telefon E.164, modul, șablon, cost, segmente, `aprobat_de`/`aprobat_la`, `furnizor` + `furnizor_id`.
  - `sms_loturi`: un lot extern = o aprobare de owner, cu hash-ul textului și numărul de destinatari.
  - `sms_optout`, `sms_dlr_jurnal` (payload brut), `sms_setari` (kill-switch, plafon zi/lună, ore 08–20 pentru extern, furnizor activ), `sms_sabloane`.
- **Ecranele** vorbesc doar cu RPC-urile / tabelele noastre (o componentă comună „📱 SMS”). Nu ating niciodată furnizorul, deci schimbarea lui nu atinge UI-ul.
- **Edge `sms-trimite`**: trimite doar rânduri `aprobat`, după `fn_sms_rezerva` (plafon atomic, modelul TTS). Pornire: cron cu `x-intern-secret` sau UI cu `poartaModul`.
- **Edge `sms-dlr`**: doar mută starea, monoton, după `furnizor_id`. Nu trimite nimic, niciodată.
- **Text**: GSM-7 fără diacritice (cu diacritice ar fi 70 de caractere/segment și cost dublu), maximum 160. Link scurt pe un domeniu propriu, nu pe un scurtător public (operatorii filtrează).
- **Fără 2-way în MVP**: un număr de răspuns e al furnizorului și nu se mută cu noi. Opt-out-ul se face prin link sau telefon.

## 4. Fișa de securitate (varianta recomandată, pct. 7 din CLAUDE.md)
- **(a) Conținut extern citit**:
  - payload-urile DLR de la furnizor (stare, cod);
  - numerele de telefon introduse de operatori sau venite din formulare publice;
  - răspunsurile SMS (doar dacă se pornește 2-way, mai târziu).
  Toate se tratează ca date. Niciun text generat de AI nu pleacă extern fără aprobare.
- **(b) Ce scrie / face**:
  - scrie: `sms_*`, `ai_usage_log`-ul de cost;
  - **trimite SMS** (bani, plafonați în BD);
  - nu atinge drepturi și nu șterge date.
- **(c) Identitate**: edge cu service_role, numai DUPĂ poartă. Coada, costul și stările sunt închise pentru `authenticated` (scrierea doar prin RPC SECURITY DEFINER). service_role e necesar pentru că RLS nu poate lăsa utilizatorul să scrie `stare` / `cost` / `furnizor_id`.
- **(d) Cine pornește** (în cod, nu `verify_jwt`):
  - intern: cron cu `x-intern-secret` din Vault, sau utilizator cu modulul cerut (`poartaModul`);
  - aprobarea unui lot extern: DOAR owner-ul, prin RPC `fn_sms_lot_aproba` (verificare `is_owner` în BD);
  - DLR: secret în URL / HMAC, plus IP-ul furnizorului dacă se poate;
  - test obligatoriu: cheia anon primește 401 (lecția PR #318).
- **(e) Confirmare umană**:
  - **orice trimitere extern = lot aprobat de Razvan**: preview cu numărul de destinatari, textul exact, costul estimat și excluderile prin opt-out;
  - alertele interne către destinatari ficși merg fără confirmare, dar cu plafon, kill-switch și maximum N/zi/destinatar;
  - DLR-ul și răspunsurile nu pot declanșa niciodată o trimitere. Regula tare (a)∩(b) e acoperită de poartă + aprobare.
- **Registru**: rând nou în `automatizari` + secțiune în `registru_automatizari` (secrete DOAR ca nume: `SMS_FURNIZOR`, `SMS_API_KEY`, `SMS_DLR_SECRET`).

## 5. Pași și felii
- **Administrativ** (Razvan / juridic, în paralel cu codul):
  - cont la furnizor;
  - sender ID „GAZPET” înregistrat cu LOA pe Gazpet Instal SRL;
  - DPA art. 28;
  - nota de informare a angajaților actualizată (SMS + furnizorul ca destinatar);
  - pentru Redări: autorizarea scrisă a Transgaz pentru sub-împuternicit + textul SMS validat de Juridic.
- **Cost** (de verificat): intern ~300–500 SMS/lună ≈ 10–25 EUR/lună; Redări ≈ 50–150 EUR/proiect; plus sender ID o singură dată.
- **Felii:**
  0. **Curățenie**: `notify-whatsapp` porțit pe owner/service_role sau retras; tokenul Meta din cele 2 funcții BD mutat în Vault; rândurile lipsă în `automatizari`. Cere „da”: deploy / retragere.
  1. **Schemă + adaptor simulator**: migrarea `sms_*`, RPC-urile, `fn_sms_rezerva`, testele Deno pe adaptor și pe tranzițiile de stare. Fără furnizor, fără cost. PR + GO Jak/Copilot + DRY.
  2. **Furnizor + DLR**: secretele, edge `sms-trimite` / `sms-dlr`, test pe 5 numere interne (filtrarea URL-urilor la operatori, livrare, DLR).
  3. **MVP intern**: alertele critice către o listă fixă din `sms_setari` + anunțul HR (preview → confirmare HR / owner). Sursa numerelor: `employees.telefon`, nu `profiles.phone_whatsapp`.
  4. **Extern Redări**: câmp opțional „telefon pentru reamintire” + bifă de informare în formularul public (sau notat de operator la apel), lot de reamintire cu aprobarea owner-ului, opt-out. Doar după autorizarea Transgaz.
  5. **Opțional**: recrutare, șoferi externi, 2-way.

## 6. Întrebări pentru Razvan
1. Furnizorul: **A** SMSLink (recomandat) / **B** Infobip / **C** operatorul firmei (care e: Orange, Vodafone, Digi?).
2. `notify-whatsapp`: **A** îl retragem acum (nu are niciun apelant) / **B** poartă owner + service_role / **C** rămâne așa (nu recomand).
3. WhatsApp Meta (10 șabloane aprobate): **A** rămâne canal intern, SMS-ul e rezerva lui / **B** îl închidem, SMS = singurul canal mobil / **C** decidem după MVP.
4. Redări, de unde luăm numerele: **A** câmp + bifă în formularul public / **B** doar operatorul, la telefon / **C** fără SMS extern deocamdată.
5. Plafoane de pornire: **A** 200/zi și 1.500/lună intern, extern doar pe lot aprobat / **B** alte cifre.
6. Linkul din SMS: **A** subdomeniu scurt `gazpet.ro` (cere DNS) / **B** fără link, doar telefonul de contact / **C** `vercel.app` (risc de filtrare).
7. Cine aprobă loturile externe: **A** doar owner-ul / **B** owner + responsabilul Redări (cu modul explicit).

## 7. De verificat la furnizor înainte de semnare + URL-uri de aprobat
**Întrebări** (aceleași pentru A și B):
1. Conexiuni directe cu Orange, Vodafone, Digi (și cu rețeaua Telekom mobil preluată)? Fără rutare gri. Rata de livrare.
2. Sender ID: înregistrat pe Gazpet Instal SRL, cu LOA? Cost unic / recurent, termen. Rămâne al nostru la plecare? Există un registru sau o cerință ANCOM / a operatorilor?
3. API: HTTPS/JSON, chei per mediu și rotire, idempotency, limite de rată, sandbox gratuit.
4. DLR: semnătură HMAC sau secret + IP fix; stările raportate; reîncercări.
5. Preț per segment GSM-7 vs Unicode, pe rețea; abonament minim; creditul expiră?; preaviz la schimbarea prețului.
6. Factură RON, e-Factura, entitate RO, plată prin OP.
7. DPA art. 28, lista sub-împuterniciților, servere / loguri în UE, cât păstrează textul și numerele, ISO 27001, notificarea breșelor.
8. SLA: disponibilitate, timp de livrare, suport în română.
9. Opt-out / numere de răspuns: al cui rămâne numărul?
10. Trebuie înregistrate la operatori domeniile din linkuri?
11. La încetare: export, ștergere, preaviz.
12. Restricții de conținut (mesaj în numele Transgaz)?

**URL-uri** (de aprobat de Razvan; deschid doar ce aprobă):
- https://www.smslink.ro/ (prețuri, documentația API, termeni / GDPR) + https://github.com/SMSLink-ro (exemplul Node din brief)
- https://www.infobip.com/pricing , https://www.infobip.com/docs , https://www.infobip.com/trust-center (de verificat calea exactă)
- https://www.orange.ro/business/ și https://www.vodafone.ro/business/ (ofertele de SMS bulk / API)
- https://www.twilio.com/en-us/sms/pricing/ro (doar pentru comparație)
- https://www.ancom.ro/ (sender ID / anti-spoofing) și https://www.dataprotection.ro/ (ANSPDCP): oficiale, dar nu sunt pe lista pre-aprobată
- https://developers.facebook.com/docs/whatsapp/pricing (costul WhatsApp, pentru comparație)
- Fără aprobare (oficiale): https://legislatie.just.ro/Public/DetaliiDocument/56973 (Legea 506/2004, consultată), https://eur-lex.europa.eu/eli/reg/2016/679/oj (GDPR art. 28), anaf.gov.ro (datele firmei furnizorului, cu CUI-ul ei)
