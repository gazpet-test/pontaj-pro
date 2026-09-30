# Garda citirii automate Ofertare (`ofertare-ingest-doc` + worker NAS)

**Stare: DRAFT — nimic deployat, nimic aplicat.** Închide condițiile de reluare a citirii automate după incidentul de
egress din 24–25.09.2026 (`docs/INCIDENT_EGRESS_2026-09-25.md`, verdictul `docs/INCIDENT_EGRESS_VERDICT_COPILOT_2026-09-30.md`,
`docs/MONITOR_EGRESS.md`, PR #478).

## Ce se schimbă
| Condiție | Implementare |
|---|---|
| (1) fără cale anonimă | `identificaApelant()` (`supabase/functions/_shared/gardaIngestLogica.ts`). Două căi: **serviciu** = header `x-ingest-secret` egal (timp constant) cu `OFERTARE_INGEST_SECRET` (≥ 32 caractere); **utilizator** = JWT verificat de Auth (`getUser`) + `fn_are_acces_ofertare()` (owner sau `user_module_access.module='ofertare'`) + poarta pe cheltuială #51 (owner sau responsabilul licitației). Cheia anon e refuzată mereu; rolul NU se mai citește din payload-ul JWT decodat local; `service_role` ca Bearer fără secret = refuz. Refuz = 401/403 fără a atinge documentul. |
| (2) contor persistent + oprire | Tabel `ofertare_ingest_garda` (migrarea `20260930k_ofertare_ingest_garda.sql`). `ofertare_ingest_garda_incearca` (înainte de descărcare, atomic `FOR UPDATE`) și `ofertare_ingest_garda_rezultat` (după). 5 eșecuri consecutive → **blocat**; backoff 60 s × 2^(n−1), max 6 h. Deblocare DOAR `ofertare_ingest_garda_reactiveaza(doc_id)` — owner. |
| (3) fără re-descărcări complete repetate | Plafon **80 descărcări/document** (toate invocările, toate feliile) → blocat. Înainte de descărcare: mărime + etag din `storage.list` egale cu amprenta ultimei citiri încheiate → `deja_ingerat`, fără octeți. După descărcare: sha256 egal pe document încheiat → skip. Garda e **fail-closed**: dacă RPC-ul nu răspunde, nu se descarcă. |
| (4) alerte | La blocare: notificare către toți owner-ii (`ofertare_ingest_garda_notifica`, modul Ofertare). Consumul (bytes/obiect/oră, cota ciclului) rămâne la monitorul de egress (PR #543, branch `claude/erp-continuare-x4p5a7-monitor-egress`) — complementar: monitorul vede **bytes pe obiect** și blochează obiectul, garda vede **încercări pe document**. Se aplică amândouă; ordinea în cod: garda → poarta egress → descărcare. Integrarea `descarcaCuJurnal` se face la merge-ul celui de-al doilea PR (conflict mic, aceeași linie de `download`). |
| Worker NAS | `worker/ofertare/garda.ts` reexportă aceleași adaptoare. `candidati()` exclude documentele blocate/în backoff; drumul local (pdftotext) apelează garda în jurul descărcării; drumul AI trimite `x-ingest-secret`, iar un răspuns `garda:*` al edge-ului oprește documentul în tura curentă fără reîncercare și fără a-i schimba statusul. PDF-urile > 60 MB (`citire_mare.ts`) au deja contorul lor persistent (`analiza.citire_mare`, max 3, CAS) și filtrul de candidați al gărzii. |

## Efecte secundare de știut înainte de deploy
- **Tick-ul pg_cron `ofertare_ingest_tick`** (fallback când workerul NAS nu dă heartbeat) cheamă edge-ul cu `SUPABASE_ANON_JWT` din Vault. După deploy, apelurile lui sunt refuzate (401) — adică fallback-ul devine inert (fail-closed). Variante: A) îl lăsăm inert (recomandat până la reluarea completă); B) migrare separată care îi adaugă headerul `x-ingest-secret` citit din Vault (necesită secret în Vault = aceeași valoare ca în env-ul funcției).
- Drumul local (pdftotext) → AI: documentul se descarcă o dată de worker și o dată per invocare edge; ambele se numără în plafonul de 80.
- Un document în curs cu multe felii (ex. 100 pagini Sonnet, felii de 2 → ~50 invocări) încape în 80; plafonul se poate ridica doar în migrare (constantele sunt oglindite în `GARDA`).

## Ordinea de punere în funcțiune (fiecare pas cu acordul lui Razvan)
1. Secret nou `OFERTARE_INGEST_SECRET` (≥ 32 caractere aleatoare) în Edge Function secrets și în `.env` workerului NAS (chmod 600).
2. `apply_migration` `20260930k_ofertare_ingest_garda` + `get_advisors`.
3. Deploy `ofertare-ingest-doc` (v13). Test: apel cu cheia anon → 401; cu secret greșit → 401; user fără modul → 403.
4. Merge pe `main` → workerul face `git pull` și repornește.
5. Reactivarea citirii (coada) — decizie separată.
Rollback: `20260930k_ofertare_ingest_garda_ROLLBACK.sql` + redeploy v12 (atenție: v12 are calea anon).

## Fișa de securitate (CLAUDE.md pct. 7)
- **(a) Conținut extern citit:** PDF-uri din documentațiile de atribuire SEAP (scrise de autorități contractante / proiectanți), trimise la Claude (Haiku/Sonnet) pentru transcriere; `nume_original` al fișierelor. Textul rezultat e DATE: se scrie în `text_extras`, nu declanșează nicio acțiune.
- **(b) Ce scrie / face:** `ofertare_documente_atribuire` (text, status, pagini), `ai_usage_log`, `ofertare_ingest_garda` (doar prin RPC), `notifications` (doar owner-ilor, la blocare). NU trimite mail, NU atinge bani (în afară de costul apelului AI, plafonat de gardă), NU atinge drepturi.
- **(c) Identitate:** edge-ul folosește `service_role` pentru BD/Storage — justificat: bucketul `ofertare` e privat, iar RPC-urile gărzii sunt `SECURITY DEFINER` executabile doar de `service_role` (utilizatorul nu-și poate reseta singur contorul). Identitatea APELANTULUI e verificată înainte, separat. Workerul NAS rulează cu `service_role` din `.env` (container fără porturi de intrare).
- **(d) Cine pornește:** utilizator cu acces Ofertare ȘI (owner sau responsabilul licitației), verificat în cod; workerul NAS cu secret dedicat comparat în timp constant. `verify_jwt` NU e considerat suficient; cheia anon e refuzată.
- **(e) Confirmare umană:** reactivarea unui document blocat (owner, RPC dedicat); reluarea cozii după incident; aplicarea migrării / deploy / crearea secretului. Regula tare (a)+(b): citește conținut extern ȘI scrie → livrat DOAR cu poarta de rol de mai sus.

## Text propus pentru `claude_docs.registru_automatizari` (NU scris încă)
```
### ofertare-ingest-doc v13 + worker NAS ingest — GARDA (30.09.2026, PR draft claude/erp-continuare-x4p5a7-ingest-garda)
- Secret nou: OFERTARE_INGEST_SECRET — Edge Function secrets (ofertare-ingest-doc) + .env worker NAS Terra. Folosit doar ca header x-ingest-secret worker → edge.
- Tabel nou: ofertare_ingest_garda (RLS, SELECT pt fn_are_acces_ofertare). RPC: ofertare_ingest_garda_incearca / _rezultat (service_role), _reactiveaza (owner), _notifica (intern).
- Fișa: (a) PDF-uri SEAP → Claude; (b) scrie documente/ai_usage_log/garda/notificări owner, fără mail/bani/drepturi; (c) service_role justificat (bucket privat, contor ne-resetabil de user); (d) user cu acces Ofertare + owner/responsabil, sau worker cu secret (timp constant); anon refuzat; (e) reactivare blocat = owner.
- Limite: 5 eșecuri consecutive (backoff 1→2→4… min, max 6 h) sau 80 descărcări/document → blocat + notificare owner.
- Tick-ul pg_cron ofertare_ingest_tick (anon din Vault) e INERT după deploy până la o migrare care îi dă secretul.
```

## Teste
- `npx vitest run src/ingestGarda.test.js` — poarta de rol (secret timp constant, anon/service_role fără secret, fără modul, Auth/RPC care aruncă) și contorul (plafoane, backoff, etag/mărime, sha256, blocare o singură dată, succesul nu deblochează).
- `worker/ofertare/ingest_mare_test.ts` (Deno) — fake-ul BD răspunde `continua` la gardă, ca testele existente să rămână pe comportamentul lor.
- Funcțiile SQL nu au test automat (nu s-au aplicat nicăieri); logica lor oglindește `dupaRezultat`/`decizieInainte`.
