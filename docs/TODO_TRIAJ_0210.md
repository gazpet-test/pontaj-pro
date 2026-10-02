# Triaj TODO — 02.10.2026

Sursa: `claude_context` category='todo', todo_completed=false → **165** rânduri (citire 01.10.2026). Verificare READ-ONLY: grep în repo (main @ c3745c7), information_schema, cron.job, lista edge functions. Nimic modificat în BD.

Verdictele PARȚIAL/LIVRAT bazate pe grep sunt dovezi indirecte — înainte de închidere se confirmă scurt în UI.

## Rezumat

- **LIVRAT**: 11
- **DEPĂȘIT**: 19
- **PARȚIAL**: 55
- **VALABIL**: 80

Total: 165

## LIVRAT — propunere de închidere

| id | prio | titlu | dată | verdict | dovadă / notă |
|---|---|---|---|---|---|
| 51 | medium | Istoric Export Suplimente Hrană | 2026-05-15 | LIVRAT | tabel supliment_hrana_istoric + folosit în src (3 refs) |
| 162 | high | Modul Izometrie - Faza 2: UI 4 nivele navigare | 2026-05-20 | LIVRAT | Izometrie.jsx + Executie (izometrie); vezi docs/IZOMETRIE_DE_FACUT.md |
| 163 | high | Modul Izometrie - Faza 3: Export Excel format Transgaz | 2026-05-20 | LIVRAT | Izometrie.jsx: centralizator/TOTAL LAN (18 refs); executie_pachete_exports |
| 260 | high | Integrare WhatsApp grup motorina → automatch șantier la import Rompetrol | 2026-05-24 | LIVRAT | ImportWhatsAppModal (37 refs) — match șantier din WhatsApp; v_alimentari_fara_santier |
| 362 | high | Refactor Executie.jsx - context proiect | 2026-06-02 | LIVRAT | Executie.jsx folosește ?proiect=&tab= (13 refs) |
| 955 | high | De pus SEAP_IMPORT_SECRET și în secretele Supabase (Razvan, 31.08) | 2026-08-30 | LIVRAT | SEAP_IMPORT_SECRET citit în hr-autorizatii-scan / ofertare-seap-veghe / vercel-relay — de confirmat că e setat |
| 1038 | high | Ofertare: regulă automată PDF > 20 MB → spart în bucăți (decis Răzvan 07.09.2026 | 2026-09-07 | LIVRAT | limită 20 MB tratată în funcții/OfertareLicitatii (3 refs) — de confirmat spargerea |
| 1041 | high | Ofertare: mail „Etapa 1” + cron zilnic licitații active (GO Răzvan 07.09, varian | 2026-09-07 | LIVRAT | ofertare-etapa1-mail + cron etapa1 (1 job) LIVE |
| 1048 | high | Flux GBE (garanție de bună execuție) în platformă + instrucțiuni Financiar/Ofert | 2026-09-07 | LIVRAT | GbeEvidenta.jsx, gbe_polite, gbe_restituiri, docs (98 refs) |
| 1086 | high | ingest v10: renumerotare marcaje ⟦PAGINA⟧ în cod, per felie | 2026-09-09 | LIVRAT | „renumerot” în supabase/functions (2 refs) |
| 1327 | medium | fn_ofertare_clasifica_registre nu are gardă de rol — orice utilizator autentific | 2026-09-16 | LIVRAT | fn_ofertare_clasifica_registre conține acum verificare de rol |

## DEPĂȘIT / expirat / înlocuit — propunere de închidere

| id | prio | titlu | dată | verdict | dovadă / notă |
|---|---|---|---|---|---|
| 46 | medium | Decizie permanentă roluri Eugen/Toma/Kostas | 2026-05-15 | DEPĂȘIT | Decizie de roluri din mai, depășită de modelul acces DUAL per sub-modul (CLAUDE.md); de închis sau reformulat — decizie Răzvan |
| 688 | medium | URMĂRIRE tichet TKT-2026-0029 Daniel Oancea — carte+talon 5/zi | 2026-06-17 | DEPĂȘIT | urmărire punctuală din iunie; de închis sau verificat o dată |
| 836 | high | MÂINE 10.08: verificare notificări Chuck Norris + Scorilos (suspendat) | 2026-08-09 | DEPĂȘIT | „MÂINE 10.08” — verificare punctuală expirată |
| 844 | high | Propunere tehnică pe baza documentelor Bisericani (după Import Documente) | 2026-08-11 | DEPĂȘIT | Bisericani — licitație punctuală din august, probabil expirată; de confirmat |
| 1085 | critical | Dimineață 10.09: Re-extrage Mănăstirea prin server, înainte de 8:00 | 2026-09-09 | DEPĂȘIT | punctual 10.09 dimineață — expirat |
| 1091 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test (citire-test req) — gunoi, de închis |
| 1092 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1093 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1094 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1095 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1096 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1097 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1098 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1099 | low | citire-test req | 2026-09-10 | DEPĂȘIT | rând de test |
| 1100 | low | citire-test relansare | 2026-09-10 | DEPĂȘIT | rând de test |
| 1188 | critical | LICITATII VII cu termen apropiat — modulul de propunere se foloseste ACUM, nu pe | 2026-09-13 | DEPĂȘIT | termene din 13.09 trecute |
| 1198 | high | Modulul PT n-are încă niciun capitol creat în producție | 2026-09-13 | DEPĂȘIT | ofertare_pt_capitole are acum 55 rânduri |
| 1210 | critical | 🔴 DOMNEȘTI (id 5, termen 18.09): sursele de cantități diferă între ele | 2026-09-13 | DEPĂȘIT | Domnești termen 18.09 — trecut |
| 1436 | critical | PT93 Jilava — review Jakarinos (Codex) 24.09: 48 constatări, verdict „nepregătit | 2026-09-24 | DEPĂȘIT | review PT93 Jilava 24.09 — înlocuit de #1443 (review v2) |

## PARȚIAL

| id | prio | titlu | dată | verdict | dovadă / notă |
|---|---|---|---|---|---|
| 45 | medium | Setări semnatari ordin editabile UI | 2026-05-15 | PARȚIAL | App.jsx citește setari_ordin_deplasare (3 locuri), nu există UI de scriere; S, fără schemă |
| 52 | medium | Istoric Export ITM | 2026-05-15 | PARȚIAL | referințe istoric ITM în src (3); de confirmat bucket arhivă ca la Diurne; S |
| 97 | high | Flow înregistrare contract HR (nefinalizat) | 2026-05-16 | PARȚIAL | HR.jsx are referințe contract (5); flow nefinalizat; dublură cu #110 → unificat |
| 107 | high | Scanner facturi OCR - actualizare automată stocuri | 2026-05-16 | PARȚIAL | productie-factura-ai / financiar-verifica-factura există; actualizarea automată de stoc nu; L |
| 108 | medium | Integrare WinMentor - modul financiar/contabil | 2026-05-16 | PARȚIAL | winmentor apare în Financiar/ContracteComerciale/InventarCorectii (import fișiere); API REST nu; L + cost/licență |
| 109 | medium | Claude Haiku în ERP - asistent input date pentru operatori | 2026-05-16 | PARȚIAL | chatbot edge + ChatbotWidget LIVE; asistent ghidat pe flow-uri nu; M |
| 110 | high | Finalizare modul Contracte HR + Word template OCR | 2026-05-16 | PARȚIAL | vezi #97 (dublură); M |
| 112 | high | Optimizare ERP pentru telefon + tablet + APK Android | 2026-05-16 | PARȚIAL | AppMobilManageri (/m) + serviceWorker în main.jsx; audit mobil complet + APK nu; L |
| 129 | medium | Speech-to-text chatbot + Scanner documente AI (Faza 1 MVP) | 2026-05-17 | PARȚIAL | scan-document/citeste-orice LIVE (scanner); speech-to-text doar SedintaVoice; vezi #811/#824 |
| 142 | high | Auto-extract VIN + cod card combustibil din arhiva autovehicule (Razvan cerere 1 | 2026-05-18 | PARȚIAL | VIN în Logistica (12 refs), extract-talon-ai LIVE; cod card + arhiva lui Răzvan neconfirmate |
| 157 | high | Parser factura PDF lunara Rompetrol cu Haiku Vision (Etapa Auto-Alimentari) | 2026-05-19 | PARȚIAL | ImportRompetrolModal + analyze_bon_rompetrol LIVE; parser factură PDF lunară cu vision nu; M; cost API |
| 159 | high | Email Auto-Inbox cu Haiku - clasificare + routing automat in ERP | 2026-05-19 | PARȚIAL | noutati-mail, mail-cu-atasamente, productie-mail-facturi, ofertare-rfq-inbox LIVE pe fluxuri punctuale; inbox general clasificat nu; L; poartă securitate pct.7 |
| 213 | critical | Etapa 12.6 — Sistem QR + Bazine Mobile pentru șantier (anti-furt motorină) | 2026-05-22 | PARȚIAL | QrUtilajPage + qr-alimentare-submit + logistica_qr_submit_log LIVE; bazine mobile nu apar; restul de clarificat |
| 223 | high | Etapa 14: Scorilos extrage date din documente Auto din Drive | 2026-05-22 | PARȚIAL | extract-talon-ai, extract-itp-ai LIVE; scanare folder Drive nu; blocat ca #949 pe cont serviciu Google |
| 226 | critical | Etapa 16: Asistent AI Licitatii (RAG cu Knowledge Base Gazpet) | 2026-05-22 | PARȚIAL | rag-normative + modul Ofertare (cerinte/acoperire/genereaza-capitol) LIVE — Etapa 16 practic înlocuită de Ofertare; de închis/reformulat |
| 259 | high | Integrare cross-check Rompetrol vs EvoGPS în Scorilos v15 (automat) | 2026-05-24 | PARȚIAL | views cross-check LIVE (v_audit_rompetrol_*); integrare automată în Scorilos de verificat; M |
| 324 | high | QR Bon Comun - pași următori | 2026-05-28 | PARȚIAL | logistica_bonuri_comune + qr-bon-comun-lookup + v_bonuri_comune_status LIVE; match cu raport Rompetrol de verificat |
| 598 | high | Subcategorii contracte comerciale (executie / aprovizionare / prestari speciale) | 2026-06-07 | PARȚIAL | ContracteComerciale are referințe aprovizionare/prestări (2); de verificat dacă e subcategorie; S |
| 599 | high | Suna Teraplast + modul online probe presiune | 2026-06-07 | PARȚIAL | executie_probe_presiune + migrare 20260914 LIVE (modulul probe); apelul Teraplast = acțiune Răzvan |
| 604 | medium | Fix click-to-close backdrop — toate modalele ERP | 2026-06-08 | PARȚIAL | încă 2 locuri cu e.target===e.currentTarget && onClose; S |
| 606 | high | Semnătură electronică destinatar extern la livrare transport | 2026-06-09 | PARȚIAL | semnatura_destinatar în App/Logistica; link unic pentru extern de verificat; M |
| 614 | high | TODO #613: Verificator Automat Conformitate Normative | 2026-06-09 | PARȚIAL | rag-normative + normative-scan-lunar + NTPEE în ofertare-acoperire; verificator memorii tehnice dedicat nu; L |
| 616 | high | Legare OP/plăți după EXTRASE BANCARE (nu doar fișa 401) | 2026-06-10 | PARȚIAL | trezorerie_extras_linii există în BD; legare OP↔extrase în UI de verificat; M |
| 627 | high | Workflow onboarding MP — notificare + tichete automate | 2026-06-11 | PARȚIAL | referințe onboarding/checklist în Executie; tichete automate nu; M |
| 628 | medium | PWA - transformare ERP în aplicație mobilă | 2026-06-12 | PARȚIAL | serviceWorker în main.jsx; PWA complet (manifest/instalare) de verificat; M |
| 669 | medium | Mapping responsabili pe departamente (Tichete) + rutare auto | 2026-06-15 | PARȚIAL | Tichete are referințe departament (41); rutare auto de verificat; S-M |
| 671 | medium | Tichete.jsx — căutare entitate pe marcă + model, nu doar cod/plăcuță | 2026-06-16 | PARȚIAL | Tichete.jsx are marca/model (3 refs) — de verificat dacă e în căutarea entității; S |
| 677 | low | Magazie 6.3 + 6.4 — consum proiect+PV, praguri minime+notif, valori pe stoc (pre | 2026-06-16 | PARȚIAL | consumuri_proiect + executie_bonuri_consum LIVE; praguri/preț mediu parțial; M |
| 679 | medium | ActivFormModal — checkbox „Service special (la cerere)" pentru service_la_cerere | 2026-06-16 | PARȚIAL | coloana service_la_cerere există; checkbox UI lipsă în Logistica; S (Logistica.jsx — cere cerere explicită) |
| 680 | medium | Proiecte — normalizare beneficiar + grupare pe Beneficiar în Achiziții | 2026-06-16 | PARȚIAL | normalizarea făcută 15.06; gruparea pe beneficiar în Achiziții de verificat; S |
| 695 | medium | Notificare prag EIP (protecția muncii) | 2026-06-21 | PARȚIAL | praguri în Magazie (31 refs); notificarea automată de verificat; S |
| 696 | medium | Notificare prag materiale sudură | 2026-06-21 | PARȚIAL | idem #695; S |
| 709 | medium | Achiziții — avertisment „total 0 → intră în aprobare" în modalul PO (Achizitii.j | 2026-06-22 | PARȚIAL | o referință în Achizitii.jsx — de confirmat dacă e avertismentul; S |
| 710 | high | Legare consum/flux materiale ↔ schema izometrică | 2026-06-22 | PARȚIAL | ConsumuriBonuriTab are 1 ref izometrie; legare reală lipsă; M |
| 712 | medium | Afișare furnizor în Magazie (per poziție stoc) | 2026-06-22 | PARȚIAL | furnizor în Magazie.jsx (17 refs), v_stoc_furnizori; de confirmat afișare per poziție; dublură #727 |
| 717 | medium | Infra Watchdog autonom (pg_cron zilnic) — alerte securitate/deploy | 2026-06-23 | PARȚIAL | nightly_patrol_bot există; watchdog securitate/deploy nu; M |
| 727 | medium | Magazie — afișează furnizorul materialului | 2026-06-25 | PARȚIAL | dublură #712 |
| 728 | high | Bon consum — leagă stocul Magazie (general) de proiect, nu doar trasabil | 2026-06-25 | PARȚIAL | ConsumuriBonuriTab are „din stoc” (3); stoc general vs trasabil de verificat; M |
| 736 | medium | Import Excel AEP → probe_log_executie (citiri P+T în sistem) | 2026-06-25 | PARȚIAL | probe_log_executie folosit în TabSantiere; import Excel AEP de verificat; S-M |
| 748 | medium | Coordonate GPS pe șantiere → match telemetrie EvoGPS automat | 2026-06-29 | PARȚIAL | sites are coloană lat*; match automat EvoGPS nu; M |
| 809 | medium | Căutare semantică pe NAS (embeddings + pgvector) — 194k documente | 2026-07-25 | PARȚIAL | pgvector instalat, rag-utilaj-embed există; embeddings pe nas_documente nu; L; cost API |
| 810 | medium | Verificare încrucișată la extragerea din documente (reguli de domeniu + al 2-lea | 2026-07-25 | PARȚIAL | ai-dezbatere / review adversarial folosit punctual; generalizare nu; M |
| 817 | critical | MÂINE — Corespondență proiecte prin email: automatizari@gazpet.ro → arhivare aut | 2026-08-04 | PARȚIAL | ProiectNouWizard menționează automatizari@; ingest automat complet de verificat |
| 825 | medium | Blocker soft SL fără factură (UI Financiar/SituatiiPlata) | 2026-08-09 | PARȚIAL | TabSituatiiPlata are nr_factura (14); blocker soft de verificat; S |
| 862 | critical | Etalonări scadente (INSEMEX firmă: închis — prin subcontractor) | 2026-08-13 | PARȚIAL | actualizat 28.09: INSEMEX personal reînnoit; rămâne restul etalonărilor; acțiune Răzvan |
| 992 | high | Participări SEAP din API + upgrade Etapa 16 (benchmark Licitor) | 2026-09-01 | PARȚIAL | ofertare-participari-import + ofertare_participari LIVE; upgrade Etapa 16 de verificat |
| 997 | high | Documentația de atribuire → server NAS (auto sau 1-click) + regula de salvare | 2026-09-01 | PARȚIAL | nas-upload-url + 1 ref nas în ofertare-seap-import; regula de salvare de confirmat |
| 1032 | high | Camere: snapshot orar + AI (după test claritate ziua) | 2026-09-06 | PARȚIAL | iot-camera edge + Cladire.jsx (20 refs camere); AI pe snapshot nu; M; cost |
| 1076 | medium | x-radar-secret hardcodat în 3 funcții + 10 cron-uri → Secrets | 2026-09-09 | PARȚIAL | funcțiile citesc secretul din header; 10 cron-uri tot au x-radar-secret în comandă (doar 2 folosesc vault) |
| 1077 | high | Backfill sursa_pagina/pasaj pe cele 2.191 cerințe existente | 2026-09-09 | PARȚIAL | sursa_pagina folosit în audit-v2; backfill de verificat cu COUNT |
| 1109 | high | Gemini cititor principal pe volume in ofertare-ingest-doc (agreat 10.09.2026) | 2026-09-10 | PARȚIAL | gemini în ofertare-cantitati-extrage/inventar-ai; nu în ofertare-ingest-doc — de verificat |
| 1110 | critical | Buget API Claude epuizat 10.09.2026 — plan de reducere a costului | 2026-09-10 | PARȚIAL | plan de reducere cost; parțial depășit de #1109 (Gemini) și pilot CLI #1392; de reformulat |
| 1432 | high | Ofertare: 8 ecrane lipsă în modulele-sursă (audit 24.09) | 2026-09-24 | PARȚIAL | OfertareParteneri etc. există; 8 ecrane de verificat individual; M |
| 1442 | high | Ofertare: .doc + model_contract + registru formulare (consens Claude/Codex/Copil | 2026-09-25 | PARȚIAL | ofertare-word-text (word-extractor), ofertare-clauze-formulare, OfertareClauzeFormulare.jsx LIVE; E2/E3 de verificat |
| 1519 | high | 02.10: generator cerere ofertă garanție pentru GBE, CAR, AVANS | 2026-10-01 | PARȚIAL | OfertareGarantie.jsx „Cere ofertă poliță” — participare; GBE/CAR/AVANS de extins; S-M; planificat 02.10 |

## VALABIL, nefăcut

| id | prio | titlu | dată | verdict | dovadă / notă |
|---|---|---|---|---|---|
| 53 | medium | Generator Ordin Deplasare din Istoric Plăți Diurne | 2026-05-15 | VALABIL | nicio referință la generare retroactivă; ordine_deplasare_arhiva există; S-M |
| 54 | low | Dashboard rapoarte centralizat | 2026-05-15 | VALABIL | low; parțial acoperit de dashboard-uri pe module; L, decizie scope |
| 55 | low | Logistica granular access | 2026-05-15 | VALABIL | low, „doar când apar probleme reale” — parcat |
| 56 | low | Modulul Suprem (Etapa 12+) | 2026-05-15 | VALABIL | low; L; suprapus cu #667 (Audit) și #54 |
| 60 | medium | Manual de utilizare - Pattern Registre toate documentele | 2026-05-15 | VALABIL | principiu de documentare; M; decizie Răzvan pe listă registre |
| 70 | medium | Buton Curățenie Arhivă Ordine > 2 ani | 2026-05-15 | VALABIL | niciun buton curățenie ordine în src; S |
| 71 | low | Retention policy general per modul (Admin Settings) | 2026-05-15 | VALABIL | low, „an 2+”; parcat |
| 72 | low | 🚗 Research complet Toyota Cressida / Corona Mark II 1972 coupe (pentru Razvan) | 2026-05-15 | VALABIL | personal Răzvan, nu ERP; S; de mutat în afara backlog-ului |
| 76 | high | 📋 Business Verification Meta (gratuită) - aplică pentru WhatsApp | 2026-05-16 | VALABIL | pași manuali Răzvan în Meta Business; extern |
| 105 | high | Localizare utilaje din comenzi transport | 2026-05-16 | VALABIL | nimic localizare_utilaj; se suprapune cu #748 (GPS); M |
| 128 | high | Sistem permisiuni granulare per user/departament (Opțiunea C Hybrid) | 2026-05-17 | VALABIL | amânat explicit de Răzvan 17.05; L; schemă nouă |
| 130 | low | Curatenie duplicate poze pe NAS QNAP | 2026-05-17 | VALABIL | NAS QNAP, în afara ERP; S-M; acces NAS |
| 150 | medium | UI editare defaults responsabili Tichete (acum doar SQL) | 2026-05-19 | VALABIL | tichete_default_responsabili doar citit în src; fără UI scriere; S |
| 158 | medium | Integrare software devize constructii (IntelSOFT / eDevize / Deviz360) | 2026-05-19 | VALABIL | cercetat, fără API la furnizori; L; decizie Răzvan |
| 181 | medium | Izometrie - Drag & Drop reordering tevi (peste sagetile ↑↓) | 2026-05-21 | VALABIL | niciun draggable în Izometrie.jsx; S-M |
| 182 | medium | Izometrie - Agent AI smecher (chatbot dedicat modulului) | 2026-05-21 | VALABIL | M; cost API |
| 220 | critical | Bot v2 — Web search Claude API pentru completare automată carburant + normă | 2026-05-22 | VALABIL | nightly_patrol_bot există; web search nu; M; cost API; de recântărit după #1110 |
| 221 | medium | Bot v3 — Anomalii vânzător + corelație EvoGPS | 2026-05-22 | VALABIL | după QR; M |
| 293 | medium | Banner alertă Logistica pentru card swaps noi detectate | 2026-05-26 | VALABIL | card_swap doar în ConfirmareAITab; banner în Logistica nu; S |
| 294 | medium | Badge 🔴 pe alimentări card_swap în lista principală + opțiune ascundere fantome | 2026-05-26 | VALABIL | nimic în AlimentariBulkPage; S |
| 295 | medium | Per vehicul: kilometraj real vs consum afișat în factură (detector discrepanțe) | 2026-05-26 | VALABIL | M |
| 296 | medium | Notificare automată șofer card swap (Edge Function trigger) | 2026-05-26 | VALABIL | M; trimitere notificare = automatizare (pct.7) |
| 314 | medium | Definire proces formal re-alocare card combustibil | 2026-05-27 | VALABIL | proces organizațional; decizie Răzvan |
| 330 | high | QR: cantitate opțională + OCR auto din poză | 2026-05-28 | VALABIL | fără OCR în QrUtilajPage; M; cost API |
| 339 | medium | WhatsApp Business API - inlocuire export zip manual | 2026-05-29 | VALABIL | înlocuiește export zip; M-L; cont Meta (#76) + cost |
| 349 | high | Scorilos v3 — tip sugestie site_mismatch (utilaj alocat pe șantier X, motorina p | 2026-06-02 | VALABIL | site_mismatch nu există; M |
| 533 | medium | Modul Diagnostic AI Mecanici (Vision) | 2026-06-03 | VALABIL | „după nucleul ERP”; L; cost API |
| 610 | medium | NAS Scanner - sync ștergere fișiere → ERP | 2026-06-09 | VALABIL | NAS scanner în afara repo (#827); M |
| 611 | high | Sistem Manuale Utilizator per Rol — cu auto-update + notificări versiune nouă | 2026-06-09 | VALABIL | fără tabel manuale_utilizator; L; schemă nouă |
| 638 | medium | Verifică cu colegii: MP pe Orșova Lot 1 + posibil duplicat Cosmești | 2026-06-12 | VALABIL | de clarificat cu colegii; decizie/verificare Răzvan |
| 644 | medium | Redesign Chat Intern — stil WhatsApp/Slack + DM + PWA | 2026-06-13 | VALABIL | chat_messages: 21 mesaje, ultimul 28.08 — tot neadoptat; L |
| 646 | high | Bot Responsabilizare — "Răzvanul digital" verificare automată useri | 2026-06-13 | VALABIL | spec în claude_docs; nimic în cod; L |
| 667 | medium | Modul AUDIT companie — cross-domeniu (vrere fermă Razvan 15.06.2026) | 2026-06-15 | VALABIL | L; decizie scope; suprapus #56 |
| 670 | high | PV Inventar — import PDF în BD + generare din platformă, legat de HR/angajare | 2026-06-15 | VALABIL | pv_inventar nu există; magazie_inventar_angajat există; M |
| 686 | high | Achiziții — etapă „Cerere de ofertă (RFQ)" între În aprobare și Emisă | 2026-06-16 | VALABIL | comenzi_furnizor nu are status de cerere ofertă; RFQ există doar în Ofertare (ofertare_rfq); M; schemă |
| 689 | medium | Legare raportare lucrări ↔ grafic execuție Microsoft Project | 2026-06-17 | VALABIL | L; decizie Răzvan pe format MS Project |
| 698 | medium | Semnături automate pe PV transfer + bon consum | 2026-06-21 | VALABIL | nicio semnătură în Magazie.jsx; S-M |
| 702 | medium | Valoare consumată pe bon de consum | 2026-06-21 | VALABIL | cost_mediu nu apare în ConsumuriBonuriTab; S |
| 711 | medium | Fix Bon de consum PDF — diacritice suprapuse | 2026-06-22 | VALABIL | niciun commit cu fix diacritice bon; S |
| 713 | high | Raport lunar consum/stoc per lucrare → migrare în Financiar | 2026-06-22 | VALABIL | nimic în Financiar; M |
| 718 | medium | Asistent email — rezumat inbox + draft răspunsuri | 2026-06-23 | VALABIL | M; citește mail extern → poartă pct.7/10 |
| 729 | low | Self-healing consum config probe (cache vs live) | 2026-06-25 | VALABIL | low; S |
| 732 | high | Auto-import alimentări Ramona (Template + PIUSI) + reconciliere Oscar | 2026-06-25 | VALABIL | nimic ramona/piusi în cod; M |
| 733 | medium | Cleanup dubluri alimentări Oscar (Template re-importat) | 2026-06-25 | VALABIL | v_alimentari_dubluri_oscar arată acum 61 rânduri (era 16) — problema crește; DML pe date reale → preview/confirmare |
| 741 | high | Magazia de șantier nu e legată de modul Magazie — articolele nu apar, nu se poat | 2026-06-25 | VALABIL | nicio legătură magazie șantier ↔ Magazie; M; posibil schemă |
| 792 | medium | Validare ore la QR alimentare — anti-typo | 2026-07-17 | VALABIL | fără validare ore în QrUtilajPage; S |
| 811 | medium | Voce → raport zilnic în /m (reutilizare infra speech-to-text de la Tichete) | 2026-07-25 | VALABIL | fără MediaRecorder în /m; M; suprapus #824 |
| 815 | medium | Contract 391 (CFI Tifești - Transgaz) lipsește complet din modulul Contracte | 2026-07-29 | VALABIL | 0 contracte_terti cu 391; S; DML → confirmare |
| 824 | high | Dictare vocală raport zilnic (Gemini) — confirmat 08.08.2026 | 2026-08-09 | VALABIL | fără MediaRecorder; M; cost Gemini |
| 826 | medium | Corespondență → acțiuni așteptate (AI) | 2026-08-09 | VALABIL | M; AI pe conținut extern — doar marcare, fără acțiuni |
| 827 | low | Igienă tehnică din auditul 09.08 | 2026-08-09 | VALABIL | low; S |
| 837 | high | Inventarierea containerelor | 2026-08-09 | VALABIL | scope nediscutat; decizie Răzvan |
| 850 | high | Declaratii lunare part-time — modul separat in HR | 2026-08-12 | VALABIL | nimic part-time în HR.jsx; M; schemă nouă |
| 859 | high | Export JSON date firmă pentru ofertare | 2026-08-13 | VALABIL | nimic export JSON; M |
| 868 | high | Import ISDP: parser F2/F3/Resurse .xls → proiect_articole + bază de preț din ach | 2026-08-13 | VALABIL | parser ISDP inexistent; L |
| 881 | medium | Seat Claude pt Cristiana la pornirea notificarilor | 2026-08-17 | VALABIL | amânat explicit; cost seat |
| 949 | high | HR nesincronizat cu Drive — trebuie importator server-side (blocat pe cont de se | 2026-08-29 | VALABIL | blocat pe cont serviciu Google — decizie/acțiune Răzvan |
| 981 | high | Confirmare rezultate calibrări | 2026-08-31 | VALABIL | 28 calibrări încă rezultat=depusa — acțiune Răzvan |
| 1029 | high | ERP Izocond (33.3% Gazpet) — instanță separată, același cod | 2026-09-06 | VALABIL | L; decizie Răzvan + infrastructură |
| 1030 | high | Tuya IoT Core trial expiră ~06.10.2026 | 2026-09-06 | VALABIL | expiră ~06.10.2026 — URGENT, acțiune Răzvan (prelungire gratuită) |
| 1033 | high | BursaTransport API — publicare curse din ERP | 2026-09-07 | VALABIL | nimic bursatransport; M; cont API extern |
| 1051 | medium | CS >50 MB pentru 7 proiecte | 2026-09-07 | VALABIL | 7 proiecte; decizie Răzvan pe opțiune |
| 1114 | medium | Ofertare licitația 1: 68 cerințe paralele din PDF-urile de răspuns | 2026-09-10 | VALABIL | 68 cerințe paralele; S-M |
| 1128 | medium | SCN1179522 (licitația 9, Potlogi): 421 cerințe fără pagină ȘI fără pasaj — cere  | 2026-09-11 | VALABIL | cere bani (re-extragere); decizie Răzvan |
| 1228 | low | Prunisor-Jupa: OPEN-uri ramase la linia de cercetare | 2026-09-13 | VALABIL | low; întrebări de cercetare |
| 1244 | medium | A: status „se verifică la propunere" în motorul de acoperire (regulile de echipă | 2026-09-14 | VALABIL | varianta A rămasă; S-M |
| 1392 | medium | Pilot gazpet-claude-cli pe Terra (după OK Răzvan) | 2026-09-22 | VALABIL | după OK Răzvan |
| 1399 | high | Recomandări HR: obiectivele enumerate structurat + verificare — altfel punctajul | 2026-09-23 | VALABIL | M |
| 1423 | high | Generator PT: cerințele NECONFIRMATE nu au interdicție tehnică — remediere desch | 2026-09-23 | VALABIL | M; vezi verdictele Copilot |
| 1424 | high | Dovada suplimentară de verificare per cerință: nu există loc structurat (limită  | 2026-09-23 | VALABIL | M; schemă |
| 1433 | high | Izometrie: trasabilitate recepție Transgaz lipsă (audit 24.09) | 2026-09-24 | VALABIL | 0 coloane recepție în tabelele izometrie; M; schemă |
| 1438 | critical | Ofertare — funcționalități lipsă descoperite pe Jilava 24.09 | 2026-09-24 | VALABIL | funcționalități Ofertare; L |
| 1439 | high | 🔐 Cron 41 productie-mail-facturi: x-bot-secret în clar în comanda cron | 2026-09-25 | VALABIL | cron 41 conține încă x-bot-secret în comandă — S, securitate |
| 1440 | medium | Backlog Ofertare din tichete colegi (0203–0269) | 2026-09-25 | VALABIL | backlog din tichete; M |
| 1443 | critical | Jilava 93: blocaje review v2 (Codex 38/8 blocante, Copilot concordant) — pentru  | 2026-09-25 | VALABIL | blocaje Jilava pentru colegii pe licitație; dacă termenul a trecut → DEPĂȘIT |
| 1444 | high | Așteptăm răspuns: Oana (clauze contract .doc, mail 25.09 thread 1a0d7b86094c4d57 | 2026-09-25 | VALABIL | așteptăm răspuns Oana/Silviu — extern |
| 1450 | critical | Vâlcelele 95: clarificarea #63 (liste de cantități + lungime rețea) — de confirm | 2026-09-25 | VALABIL | de confirmat dacă clarificarea #63 a fost depusă; dacă termenul a trecut → DEPĂȘIT |
| 1454 | high | 🔔 Amintește-i lui Razvan: IP static pe calculatorul „Razvan” | 2026-09-25 | VALABIL | IP static — acțiune Răzvan; S |
| 1492 | medium | [Clădire] Contract service EOS Corporation (centrala Viessmann) — de verificat m | 2026-09-29 | VALABIL | verificare mail — acțiune Răzvan |
| 1502 | medium | [Mail] Acces la atașamente PDF pentru instanța de mail — amânat (30.09.2026) | 2026-09-30 | VALABIL | amânat 30.09 |

## Top 15 recomandate (următoarele săptămâni)

1. **#1030** Tuya IoT Core expiră ~06.10 — prelungire (Răzvan, 5 min).
2. **#1439** Cron 41: x-bot-secret în clar → vault (S, securitate).
3. **#1076** 10 cron-uri cu x-radar-secret în comandă → vault (S).
4. **#733** Dubluri Oscar: 61 rânduri acum (16 în iunie) — preview + curățare cu confirmare (S-M).
5. **#1519** Generator cerere ofertă GBE/CAR/AVANS (S-M, deja planificat 02.10).
6. **#981** Confirmare rezultate pe 28 calibrări „depusa” (Răzvan).
7. **#97/#110** Contract HR — unificat și terminat (M).
8. **#741/#728** Magazie șantier legată de Magazie + bon din stoc general (M).
9. **#711** Diacritice suprapuse în PDF Bon de consum (S).
10. **#702** Valoare consumată pe bon (S).
11. **#150** UI pentru tichete_default_responsabili (S).
12. **#45** UI semnatari ordin (S).
13. **#792** Validare ore la QR alimentare anti-typo (S).
14. **#604** Ultimele 2 modale cu backdrop-close (S).
15. **#815** Contract 391 Tifești lipsă din Contracte (S, DML cu confirmare).

## Necesită decizia lui Răzvan

- **Închidere în bloc**: 10 rânduri de test #1091–#1100 și itemii expirați (#688, #836, #844, #1085, #1188, #1198, #1210, #1436).
- **#46** roluri Eugen/Toma/Kostas — mai e relevant?
- **#226 / #1110** de reformulat (Etapa 16 = Ofertare; planul de cost depășit de Gemini/CLI).
- **#1443 / #1450** Jilava / Vâlcelele — termenele au trecut? Dacă da → închise.
- **#949 / #223** cont de serviciu Google (deblochează HR din Drive + documente auto).
- **#1051** CS > 50 MB — care opțiune.
- **#128, #611, #646, #667, #56, #54** proiecte L — prioritizare sau parcare oficială.
- **#1029** ERP Izocond, **#1033** BursaTransport, **#339/#76** WhatsApp API — cost/conturi externe.
- **#837** scope inventariere containere; **#638** MP Orșova; **#314** proces cărți combustibil.
- **#72** (personal) — scos din backlog-ul ERP?
- Dubluri de unificat: #97=#110, #712=#727, #129≈#811≈#824, #105≈#748, #56≈#667.
