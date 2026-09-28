# AS-IS 05 — Cantități → RFQ/prețuri → Garanție de participare → pt_garantie (Ofertare, HEAD 55779b5, 23.09.2026)

Surse citite integral: `supabase/functions/ofertare-cantitati-extrage/index.ts`, `ofertare-rfq-import/index.ts`, `ofertare-rfq-inbox/index.ts`, `ofertare-garantie-mail/index.ts`, `ofertare-plansa-citeste/index.ts` (partea `treciInCantitati`), `src/OfertareCantitati.jsx`, `src/OfertareRFQ.jsx`, `src/OfertareGarantie.jsx`, regiuni din `src/OfertareLicitatii.jsx`, `src/OfertarePropunere.jsx`, `src/GraficPoarta.jsx`, `src/ofertareControale.js`, `supabase/functions/ofertare-clarificari-propune/core.ts`; DB live: `fn_trg_categorie_cantitate`, `fn_categorie_cantitate`, `fn_sectiune_sursa`, `fn_subiect_total`, `v_ofertare_contradictii`, `v_ofertare_pt_stare`, `v_ofertare_dashboard` (garantie_status), CHECK-uri, triggere, RLS, migrația `ofertare_cantitati_tip_sursa_h2_lista`.

Stare date live (23.09): `ofertare_cantitati` ≈ 1.078 rânduri, TOATE `extras_de_ai=true`; status: 1.072 `extras`, 4 `validat`, 2 `diferenta`, 0 `revizuit_clarificare`; `cantitate_plansa` completat pe 5 rânduri. `ofertare_rfq_preturi`: 0 rânduri (fluxul RFQ nu a fost folosit încă). `ofertare_garantii`: 1 rând, status `original`, cu `polita_path`. `ofertare_pt_garantie`: 1 rând, confirmat, `cerut_cerinta_id` NULL. `ofertare_pt_pachet_fisiere`: 0 rânduri.

---

## (A) PIPELINE

Coloane: Stage · Trigger · UI (fișier:funcție:linie) · Function/API/RPC · Tables/views · Input · Output · Status_before → Status_after · Human_gate · AI_action · Versioning · Provenance · Downstream · Failure/retry

### Q — Cantități

**Q01 · Extragere AI din liste F3/C6/memoriu/caiet**
- Trigger: apel HTTP manual (curl/MCP/Claude Code) — **niciun buton în UI** (`grep cantitati-extrage src/` = 0 rezultate).
- UI: —
- Function: Edge `ofertare-cantitati-extrage` (`index.ts:165-325`). Auth: `x-radar-secret` (RPC `fn_verifica_radar_secret`, vault) SAU orice JWT de utilizator valid (`:170-176`) — **fără verificare de rol/owner**, deși costă (OpenAI/Gemini/Anthropic).
- Tables: citește `ofertare_documente_atribuire` (`tip IN ('lista_cantitati','cs_volum','alta')`, `text_extras` > 500 car.); scrie `ofertare_cantitati` (upsert `onConflict: 'licitatie_id,denumire,sursa', ignoreDuplicates: true`, `:300-301`), `ai_usage_log` per felie.
- Input: text_extras feliat la 55.000 car. cu suprapunere 2.000 (`:120-121`); prompt `:138-163` — modelul întoarce `[denumire, um, cantitate, sursa, e_total]`.
- Output: rânduri `{licitatie_id, denumire (prefix "TOTAL " dacă e_total), um, cantitate (null dacă lipsă), sursa: "<nume_original> — <text liber AI>", status:'extras', extras_de_ai:true}` (`:280-289`). `tip_sursa` NU se setează (rămâne NULL; vezi Q02).
- Status: ∅ → `extras`.
- Human_gate: niciunul la scriere. Doar dry_run opțional.
- AI_action: extrage cifre + sursa textuală (secțiune/rând). Categoria nu se cere modelului (comentariu `:37-40`).
- Versioning: NICIUNA — nu există tabel de istoric pentru `ofertare_cantitati`; re-rularea pe același document lovește indexul unic și **ignoră** rândul existent (`ignoreDuplicates`), deci o extragere nouă cu text ușor diferit produce rând nou lângă cel vechi, iar una identică nu actualizează nimic.
- Provenance: string `sursa` (max 300 car.), nu FK către `ofertare_documente_atribuire.id`, nu pagină. Modelul (`M.nume`) apare doar în `ai_usage_log`, nu pe rând.
- Downstream: Q02 (trigger categorie), Q05 (contradicții), Q06 (Gantt), Q07 (pt_stare/controlCantitati), clarificari-propune.
- Failure/retry: buget 60 s → `continua:true` + `urmatorul`; erori de model/JSON se adună în `raport` și felia se sare (`:228, :246-250`) — **feliile sărite nu sunt reținute nicăieri** pentru reluare.

**Q02 · Clasificare determinist post-insert**
- Trigger: `BEFORE INSERT OR UPDATE OF denumire` pe `ofertare_cantitati` → `fn_trg_categorie_cantitate` → `fn_categorie_cantitate(denumire)` (regex din `ofertare_categorii_reguli`, `fel='categorie'`, ordonat pe prioritate, `LIMIT 1`). Se aplică **doar când `extras_de_ai = true`**.
- `tip_sursa`: setat DOAR o dată, prin backfill în migrația `ofertare_cantitati_tip_sursa_h2_lista` (`UPDATE ... CASE WHEN sursa ~* 'list[ae]? ?cantit' AND sursa ~* '\mF3\M' THEN 'lista_f3' ...`). Nu există trigger, default sau cod de aplicație care să-l seteze la rânduri noi ⇒ orice rând inserat după 13.09 are `tip_sursa = NULL` (live: 1 rând NULL azi; va crește la următoarea extragere).
- Status: neschimbat.
- Human_gate: —. Provenance: regula care a decis categoria nu e reținută (doar rezultatul).

**Q03 · Planșă → `cantitate_plansa`**
- Trigger: buton „📐 citește" în `OfertareLicitatii.jsx:citestePlansa:960-993` (loop ≤15 runde) → `/api/plansa-felii` (Vercel) → Edge `ofertare-plansa-citeste` (Opus, `MODEL='claude-opus-5'`).
- Function: `treciInCantitati(supa, doc, tronsoane, nrPlansa)` (`index.ts:150-241`).
- Tables: citește `ofertare_cantitati` (toată licitația), scrie UPDATE (`:207-210`, `:232-237`) sau INSERT (`:213-224`); `ofertare_documente_atribuire.analiza.citire_ai` (felii, sumar, model); `ai_usage_log`.
- Input: tronsoane citite din tabelul de dimensionare (cifre scrise, nu măsurate), agregate pe diametru `Dn`.
- Output: pentru fiecare Dn: candidat = rând existent cu `um IN (m, ml)`, denumire fără „tub/protec", care conține `Dn<nr>`/`De<nr>`/ø; dacă exact 1 → `cantitate_plansa=m`, `diferenta_nota`, și **`status='diferenta'` doar dacă status era `extras` și |memoriu−planșă| ≥ 1** (`:209`); dacă 0 candidați → INSERT rând nou `denumire:'Conductă distribuție gaze Dn<dn>'`, `cantitate = cantitate_plansa = m`, `sursa:'Planșa … — tabel de dimensionare, citit automat din scanare'`; dacă >1 → `ambigue` în răspuns, nu scrie. Rândul „total" (regex `/total/i` pe denumire) primește `cantitate_plansa = suma`.
- Status: `extras` → `diferenta` (condiționat) ; `validat` rămâne `validat` (doar nota se schimbă).
- Human_gate: apăsarea butonului; scrierea e automată.
- AI_action: citește cifre din scanare; potrivirea Dn↔rând e cod (regex).
- Versioning: `cantitate_plansa` e o singură coloană — o a doua planșă pentru același Dn **suprascrie** valoarea și nota (cazul >1 candidați e protejat; cazul >1 planșe nu).
- Provenance: `diferenta_nota` text + `analiza.citire_ai` pe document; rândul nu reține `document_id` al planșei.
- Failure: buget/felii → `continua`; ambiguitățile se întorc în răspuns dar nu se persistă.

**Q04 · Validare / editare manuală**
- UI: `OfertareCantitati.jsx` — `saveC` (`:61-69`, onBlur; scrie obiect/categorie/denumire/um/cantitate/specificatii/sursa/diferenta_nota), `valideazaC` (`:70-74`, toggle `validat` ⇄ `extras`), `addC` (`:75-79`, insert manual `extras_de_ai:false`), `delC` (`:80-84`, DELETE fizic după `window.confirm`).
- Function: PostgREST direct, RLS `auth.uid() IS NOT NULL` (orice utilizator autenticat, ALL).
- Status: `extras|diferenta|revizuit_clarificare` → `validat`; `validat` → `extras` (toggle-ul întoarce la `extras` chiar dacă venea din `diferenta`).
- Human_gate: da (singura din pipeline pentru cantități), dar fără ștampilă: nu există `validat_de`/`validat_la`; doar `updated_at`.
- AI_action: —. Versioning: NICIUNA; `saveC` suprascrie valoarea AI fără urmă (nici măcar `extras_de_ai` nu se resetează la editare manuală → un rând editat de om rămâne `extras_de_ai=true` și trigger-ul îi recalculează categoria la orice schimbare de denumire).
- `revizuit_clarificare`: definit în CHECK și în `CANT_STATUS` (`:28`), dar **nimic din cod nu îl setează** (`grep revizuit_clarificare` = doar eticheta UI). `ofertare_clarificari.cantitate_id` există dar nu e scris nicăieri (nici UI, nici `clarificari-propune`).
- Downstream: Q05-Q07.

**Q05 · Contradicții numerice (determinist)**
- View `v_ofertare_contradictii` (4 CTE: `plansa_vs_document` |Δ|>0.5, `suma_vs_total` (poziții non-total cu același document/secțiune/subiect/um vs rândul TOTAL), `total_vs_total` (același subiect, documente diferite), `cantitate_lipsa` (cantitate și cantitate_plansa NULL, non-total)).
- Cheile de grupare vin din text: `document = split_part(sursa,' — ',1)`, `sectiune = fn_sectiune_sursa(sursa)` (regex care taie „poz./rând/nr. N"), `subiect = fn_subiect_total(denumire)` (regex din `ofertare_categorii_reguli fel='subiect_total'`), `e_total = denumire ~* '^\s*total\y'`.
- **Consumatori: NICIUNUL** în `src/`, edge functions sau skills (`grep v_ofertare_contradictii` → doar comentariul din cantitati-extrage). View-ul e calculat dar nu afișat/persistat; nu produce statusuri.
- Ce ajunge la om în locul lui: `ofertare-clarificari-propune/core.ts:69` citește rândurile cu `diferenta_nota IS NOT NULL` (max 40) și le dă modelului ca „DIFERENȚE CANTITĂȚI"; `diferenta_nota` e scrisă doar de Q03 (planșă) sau manual.

**Q06 · Cantități → Gantt (fronturi)**
- UI: `GraficPoarta.jsx:load:237-247` citește `ofertare_cantitati` + `grafic_parametri` + `ofertare_norme_productivitate`; `propuneFronturi` (`:261-276`) → `randuriFront(cantitati, baza)` (`:45-54`): `um='m'`, obiect fără „total", valoare >0; preferă rândurile cu `categorie ~ /titlu/` și denumire `rețea|conduct|extindere`, altfel `categorie ~ /rețea|conduct/`. `baza = p.cantitati_asumate==='plansa' ? 'cantitate_plansa' : 'cantitate'`.
- Output: `grafic_parametri.parametri.fronturi[] = {nume, lungime_m, dn, echipe}` (upsert `:280`) — **copie numerică**, fără referință la `ofertare_cantitati.id`. Omul poate edita/adăuga fronturi liber (`setFront`, `:258`, `:419`).
- Poartă locală (`:289-299`): rând `cant` block dacă există `status='diferenta'` fără `cantitati_asumate`; rând `front` warn dacă |Σfronturi − ref| > 10 %, unde `ref = totalRetea.cantitate || Σ reteaRows[baza]`.
- Status: — (cantitățile nu-și schimbă statusul). Human_gate: alege „memoriu/planșă" + salvează. Versioning: `grafic_versiuni` la generare (nu parametrii). Provenance: pierdută (numere copiate).
- Observație: `cantitati_asumate` ∈ {memoriu, planșă} contrazice regula din 13.09 („referința e F3", migrația `tip_sursa`): GraficPoarta nu știe de `tip_sursa`.

**Q07 · Cantități → v_ofertare_pt_stare → controlCantitati (H2)**
- View `v_ofertare_pt_stare` CTE `qm`: `lista_f3_m/lista_c6_m/memoriu_m` = `round(sum(cantitate))` filtrat pe `tip_sursa`, `plansa_m = round(sum(coalesce(cantitate_plansa, cantitate)))`, cu filtrele `um='m'`, `categorie ~* 'conduct|re[țt]ea'`, `(obiect||denumire||sursa) !~* 'total'`; `grafic_fronturi_m = Σ parametri.fronturi[].lungime_m`.
- `src/ofertareControale.js:controlCantitati:30-54`: block dacă `lista_f3_m` NULL; block dacă |grafic − F3| > `H2_TOLERANTA_RELATIVA`; warn dacă memoriu/planșe/C6 diferă de F3 peste toleranță („de rezolvat prin clarificare").
- **Care valoare câștigă**: F3 (`tip_sursa='lista_f3'`) e referința; graficul se compară cu F3. Dar Q06 construiește fronturile din `cantitate`/`cantitate_plansa` ale rândurilor de rețea indiferent de `tip_sursa` — deci suma fronturilor poate porni din memoriu/planșă și apoi e blocată de H2 față de F3. Statusul `validat`/`diferenta` NU intră în niciuna din cele două formule.
- Nu există control pe `status` (rânduri `extras` nevalidate intră la fel în F3 ca cele validate).

### R — RFQ / prețuri

**R01 · Creare RFQ + materiale**
- UI: `OfertareRFQ.jsx:creeaza:194-201` (`window.prompt` titlu) → INSERT `ofertare_rfq {titlu, created_by}` (status default `draft`); `RFQDetaliu:salveazaMeta:265-276` (titlu, licitatie_id, termen_raspuns, **status liber din select**, observatii); materiale: `addMat/saveMat/delMat` (`:279-297`) în `ofertare_rfq_materiale`.
- Materialele se scriu **manual** — nu există legătură cu `ofertare_cantitati` (nici FK, nici buton „din cantități"). `ofertare_rfq.transa` (tranșa 1/2, regula 28.08) există în schemă, nu în UI.
- Status: `draft` (default); omul poate seta oricare din cele 4 direct în select, fără condiții.
- Human_gate: totul manual. Versioning: nu.

**R02 · Trimitere RFQ**
- UI: `genereazaPdf` (`:300-346`, jsPDF client-side, `pdf.save`) + link `mailto:` (`:420-421`) cu subiectul `Cerere de ofertă RFQ-<id>`. Trimiterea o face omul din clientul lui de mail.
- Tables: NIMIC nu se scrie — `ofertare_rfq_destinatari` (furnizor, email, trimisa_la, raspuns, oferta_id) **nu e folosit nicăieri** (`grep rfq_destinatari src/` = 0). Status nu trece automat în `trimisa`.
- Provenance: PDF-ul cererii nu e salvat în storage.

**R03a · Ofertă furnizor — încărcare manuală**
- UI: `addOferta` (`:349-366`): `window.prompt` furnizor, upload `ofertare/rfq/<rfq_id>/<ts>_<nume>` (fără hash), INSERT `ofertare_rfq_oferte {rfq_id, furnizor, fisier_path}`.
- Status RFQ: neschimbat.

**R03b · Ofertă furnizor — inbox mail (extern)**
- Trigger: Google Apps Script pe `oferte@gazpet.ro` (la 10 min), pentru mailuri necitite cu „RFQ-##" în subiect → POST Edge `ofertare-rfq-inbox` cu `{subiect, expeditor, fisier_nume, pdf_base64}`.
- Auth: header `x-inbox-secret` == `RFQ_INBOX_SECRET` din Edge Secrets (`index.ts:27-29`). Comentariu `:13-20`: versiunea din repo **nu e deployată**; cea live avea secretul literal în sursă + `verify_jwt:false` (task #51).
- Conținut extern citit: subiect (regex `RFQ[-\s]?(\d+)`), expeditor (devine `furnizor` provizoriu), numele fișierului, PDF-ul.
- Scrie (service_role, sare RLS): storage `rfq/<id>/…` (`upsert:true`), INSERT `ofertare_rfq_oferte`, UPDATE `ofertare_rfq.status='oferte_primite'` dacă era `draft|trimisa` (`:57-59`), apoi apelează R04 cu cheia service_role (`:64-69`).
- Poartă: doar secretul; nu verifică că expeditorul e un destinatar al RFQ-ului (n-are cum — R02 nu îi înregistrează), nu limitează numărul de oferte, orice PDF cu „RFQ-<id existent>" în subiect intră și pornește o citire plătită.
- Status: `draft|trimisa` → `oferte_primite` (automat, declanșat de mail extern).

**R04 · Import AI prețuri**
- Trigger: buton „🤖 citește cu AI / recitește" (`importaAI:367-374`) SAU R03b.
- Function: Edge `ofertare-rfq-import` (`index.ts:53-141`), model `claude-sonnet-5`, PDF base64 ≤ 28 MB. Poartă de rol `autorizat()` (`:31-51`): service_role trece; cheia anon respinsă; om = `profiles.is_owner` sau `ofertare_licitatii.responsabil_id == uid` pentru licitația RFQ-ului (**RFQ fără `licitatie_id` ⇒ doar owner**).
- Tables: citește `ofertare_rfq_oferte`, `ofertare_rfq_materiale`; **DELETE toate `ofertare_rfq_preturi` ale ofertei + INSERT** (`:119-127`, cu restaurare a rândurilor vechi dacă insertul pică); UPDATE `ofertare_rfq_oferte {furnizor (din antetul PDF, suprascrie ce a scris omul), data_oferta, valabilitate, conditii, importat_ai:true}`; `ai_usage_log`.
- Output: `ofertare_rfq_preturi {oferta_id, material_id, denumire_furnizor, pret (null dacă „neofertat"), um, note}`; `ales` = default (false) — **un „recitește" șterge alegerile `ales` făcute de om** (rândurile vechi sunt șterse integral).
- Status RFQ: neschimbat de import. Human_gate: apăsarea butonului (owner/responsabil). AI_action: potrivire semantică material↔poziție + preț unitar.
- Versioning: nu; Provenance: rândul de preț nu reține pagina/poziția din PDF, doar `denumire_furnizor` + `note`; PDF-ul e legat prin `oferte.fisier_path` (fără sha256).

**R05 · Comparativ + „ales"**
- UI: `alege(p)` (`:383-389`): dezactivează celelalte `ales` ale materialului (update-uri secvențiale, nu atomice), toggle pe cel apăsat. Cine: orice utilizator autenticat (RLS ALL). Fără ștampilă `ales_de/ales_la`.
- Provenance a alegerii: `ofertare_rfq_preturi.oferta_id → ofertare_rfq_oferte.fisier_path` (PDF-ul furnizorului) — legătura există cât timp nu se re-importă (R04 șterge rândul, deci și `id`-ul).
- Status: neschimbat.

**R06 · Prețuri alese → Referințe**
- UI: `trimiteReferinte` (`:390-405`): INSERT în `ofertare_preturi_materiale {denumire, um, pret, furnizor, lucrare: titlul RFQ, an, note:'din RFQ #<id>'}` + UPDATE `ofertare_rfq.status='finalizata'`.
- Provenance: doar textul `note`; nu FK către `rfq_preturi.id`/`oferta_id`; nu deduplică (o a doua apăsare inserează din nou).
- `ofertare_preturi_unitare`, `ofertare_calibrari`, `ofertare_norme_productivitate`: tabele de referință citite în `OfertareLicitatii.jsx:3512-3514` (tab Referințe) și `GraficPoarta.jsx:240` (norme); `calibrari` are doar update `rezultat` castigata/pierduta (`:3581, :3589`). Nu sunt alimentate din RFQ.

### G — Garanție de participare (poliță)

**G01 · Cerere poliță → broker**
- UI: `OfertareGarantie.jsx:pregateste:589-598` (valoare din `licitatie.garantie_participare` prin `numar()`, zile din `ofertare_cerinte ilike '%garan%particip%'` regex `(\d{2,3}) zile`, fallback 90; broker implicit din `ofertare_brokeri`; atașamente = documente `fisa_date`) → `trimiteCerere:623-639`: INSERT `ofertare_garantii {…, cerere_text, cerere_atasamente:[{path,nume}], status:'cerere_trimisa'}` **înainte** ca mailul să plece; apoi Edge `ofertare-garantie-mail actiune:'cerere'`.
- Edge (`index.ts:82-93`): auth = orice JWT de utilizator valid (`getUser`), **fără rol**; rulează pe service_role; Resend `from rapoarte@gazpet.ro`, `to broker.email`, cc office + expeditor, `reply_to` = mailul userului; atașează fișiere din bucket `ofertare` (≤35 MB). Scrie `cerere_trimisa_la/_de`.
- Status: ∅ → `cerere_trimisa` (setat de UI chiar dacă mailul eșuează — mesajul „Cererea e salvată, dar mailul nu a plecat", `:636`; `cerere_trimisa_la` rămâne NULL = singurul semn).
- Human_gate: da (formular editabil + buton). Conținut extern: nu citește. Trimite mail extern: da (broker) — declanșat de om.

**G02 · Draft + decont → „la plată"**
- UI: `salveazaDraft:657-671`: upload draft (obligatoriu dacă lipsește) + decont (opțional), `decont_valoare` obligatoriu → UPDATE `{status:'draft_primit', draft_la, draft_de, draft_path, decont_path}` → mail `plata` (Edge `:96-117`: to Marilena Tudorache + Mirela Popescu hard-codate `PLATA_TO`, cc responsabil + expeditor; scrie `notificat_plata_la`).
- Status: `cerere_trimisa` → `draft_primit`. UI arată formularul doar când `g.status==='cerere_trimisa'` (`:799`), dar `patch` nu verifică starea anterioară server-side.

**G03 · OP → achitată**
- UI: `marcheazaAchitata:674-686`: OP obligatoriu (fișier sau `op_path` existent) → UPDATE `{status:'achitata', achitata_la, achitata_de, op_path}` → mail `achitata` (Edge `:119-131`: to responsabilul licitației sau office; scrie `notificat_achitata_la`).
- Status: `draft_primit` → `achitata`.

**G04 · Poliță în original**
- UI: `salveazaOriginal:689-701`: **PDF obligatoriu** (`if (!fPol) return …`, `:690`) + `polita_nr` obligatoriu; `polita_prima` opțional (fallback `decont_valoare`) → UPDATE `{status:'original', original_la, original_de, polita_nr, polita_prima, polita_path}`. Fără mail.
- Status: `achitata` → `original`. Răspuns la (4): în UI, `original` cere fișierul; în DB nu există CHECK `status='original' ⇒ polita_path IS NOT NULL` și RLS permite oricărui utilizator autenticat UPDATE direct, deci constrângerea e doar client-side.
- Downstream: `v_ofertare_dashboard.garantie_status` = ultimul `ofertare_garantii.status <> 'anulata'` → KPI „Garanție participare" verde în `OfertareLicitatii.jsx:2908` și eticheta tab-ului `:2871`.

**G05 · Actualizare perioadă / anulare**
- `trimiteActualizare:704-713` (când `termen_la_cerere ≠ licitatie.termen_depunere` și status ≠ original): UPDATE valabil_de/pana/termen_la_cerere → mail `actualizare` la broker. `anuleaza:714-717`: `status='anulata'` (rândul rămâne; `load` ia ultimul ne-anulat).
- Pachet final: **garanția NU intră în `ofertare_pt_pachet_fisiere`** — `aprobaPachet` (`OfertarePropunere.jsx:1726-1780`) generează doar `propunere_docx` și `borderou_docx` (`:1737-1739`), cu sha256; nu există rol `garantie`/`polita`. Polița rămâne doar în `ofertare_garantii.polita_path` (fără hash).

### P — pt_garantie (garanția lucrărilor, H4)

**P01 · Cerut vs oferit, confirmare**
- UI: `OfertarePropunere.jsx:Garantie:910-970`: candidate = cerințe cu `garan[țt]i` + `N luni` + `lucrări|punere|recepți` și fără `participare|bună execuție|…`; click pe cerință → `dinCerinta` (`:920`) completează `cerut_luni` (RX_LUNI) și `cerut_moment` (`ghicesteMoment`, regex `:903-910`). Oferitul se tastează.
- Function: `salveazaGarantie:1285-1296` → UPSERT `ofertare_pt_garantie` (PK `licitatie_id`, 1 rând/licitație) cu `confirmat_de = auth.uid()`, `confirmat_la = now()` **la fiecare salvare** (nu există „nesalvat dar propus": orice salvare = confirmare).
- Tables/views: `v_ofertare_pt_stare` expune `garantie_cerut_*`, `garantie_oferit_*`, `garantie_confirmata`, `garantie_justificata`, `garantie_luni_in_capitole` (regex pe `ofertare_pt_capitole.continut`), `garantie_cerinte_lucrari`; `controlGarantie` (`ofertareControale.js:64-93`): block dacă oferit < cerut, moment diferit, sau capitolele pomenesc alte luni; warn dacă cerința nu e notată, peste minim fără `oferit_justificare`, sau neconfirmat.
- Provenance: `cerut_cerinta_id` (FK la cerință) — opțional; live: NULL pe singurul rând. `cerut_text` există în schemă, nu e scris de UI.
- Versioning: nu (upsert peste același rând; nu există istoric).

---

## (B) OBJECT LIFECYCLE

### quantity (`ofertare_cantitati`)
- where_created: Edge `ofertare-cantitati-extrage` (upsert, AI); Edge `ofertare-plansa-citeste` (insert Dn nou, AI); `OfertareCantitati.addC` (manual, `extras_de_ai:false`).
- where_updated: `OfertareCantitati.saveC` (orice câmp, onBlur, orice user); `valideazaC` (status toggle); `ofertare-plansa-citeste` (`cantitate_plansa`, `diferenta_nota`, `status→diferenta`); trigger `fn_trg_categorie_cantitate` (categorie, doar dacă `extras_de_ai`); migrație one-shot (`tip_sursa`).
- how_versioned: deloc (nu există tabel de versiuni; `updated_at` singurul semn). Re-extragerea: `ignoreDuplicates` ⇒ rândul vechi rămâne, unul nou apare dacă `denumire`/`sursa` diferă cu un caracter.
- how_invalidated: DELETE fizic (`delC`, `window.confirm`); status `validat→extras` prin același toggle; `diferenta` doar de planșă (și doar dacă era `extras`).
- how_confirmed: `status='validat'` fără `validat_de/la`; nimic nu obligă validarea înainte de folosire (Gantt, F3, clarificări le iau indiferent de status).
- how_linked_to_source: `sursa` text „<nume_original> — <secțiune AI>" + `tip_sursa` (derivat o singură dată din text); niciun FK la document/pagină; planșa: `diferenta_nota` text.
- how_linked_to_final_package: indirect prin `grafic_parametri.fronturi` (copie numerică) → `grafic_versiuni` → `ofertare_pt_pachet.grafic_versiune`; nici un fișier de cantități în manifest.

### price / RFQ offer (`ofertare_rfq_oferte`, `ofertare_rfq_preturi`)
- where_created: oferta — `OfertareRFQ.addOferta` (manual) sau `ofertare-rfq-inbox` (mail extern, service_role); prețurile — exclusiv `ofertare-rfq-import` (AI). Nu există editare manuală a unui preț în UI.
- where_updated: `ofertare-rfq-import` (DELETE+INSERT toate prețurile ofertei; suprascrie `furnizor`); `alege` (`ales`); `delOferta` (DELETE ofertă; prețurile cad prin FK/rămân orfane — necunoscut, nu s-a verificat FK cascade).
- how_versioned: nu; re-import = pierderea rândurilor anterioare (inclusiv `ales`).
- how_invalidated: `ales=false` prin toggle; ștergere ofertă.
- how_confirmed: `ales=true` (orice user, fără ștampilă) → `trimiteReferinte` copiază în `ofertare_preturi_materiale` și pune `rfq.status='finalizata'`.
- how_linked_to_source: `preturi.oferta_id → oferte.fisier_path` (PDF în bucket, fără hash, fără pagină); `denumire_furnizor` textual. În Referințe: doar `note:'din RFQ #id'`.
- how_linked_to_final_package: niciuna (prețurile nu apar în pachet/PT; devizul nu e în această felie).

### garanție de participare (`ofertare_garantii`)
- where_created: `OfertareGarantie.trimiteCerere` (INSERT cu `status:'cerere_trimisa'` înainte de mail).
- where_updated: `patch()` din același ecran (status + fișiere + ștampile `draft_de/achitata_de/original_de`); Edge `ofertare-garantie-mail` scrie doar marcaje `*_trimisa_la/notificat_*_la`.
- how_versioned: nu; `anulata` + rând nou = singura formă de „versiune" (ultimul ne-anulat câștigă în dashboard).
- how_invalidated: `status='anulata'`.
- how_confirmed: `status='original'` cu `polita_path`+`polita_nr` cerute doar de UI; nu există verificare a documentului (nici AI, nici a doua persoană).
- how_linked_to_source: `cerere_atasamente` (paths fișă de date), `draft_path/decont_path/op_path/polita_path` în bucket `ofertare/<lic>/garantie/…`, fără sha256.
- how_linked_to_final_package: **nu** (nu există rol în `pt_pachet_fisiere`); efectul e doar KPI-ul verde.

### pt_garantie (`ofertare_pt_garantie`)
- created/updated: un singur UPSERT (`salveazaGarantie`); fiecare salvare re-ștampilează `confirmat_de/la`. invalidated: nu există (doar suprascriere). linked_to_source: `cerut_cerinta_id` opțional; `garantie_luni_in_capitole` e recalculat din text la citire. linked_to_final_package: prin `controlGarantie` (poartă), nu prin fișier.

---

## (C) BREAK_POINTS

**BP-Q1 · AI „extras" trece drept fapt în toate calculele (status ignorat)**
- `v_ofertare_pt_stare` CTE `qm`: `round(sum(q.cantitate)) FILTER (WHERE q.tip_sursa = 'lista_f3')` — fără `status`; `GraficPoarta.jsx:45-54 randuriFront` — filtrează pe um/obiect/categorie, nu pe status; `ofertare-clarificari-propune/core.ts:69` — `.not('diferenta_nota','is',null)` fără status. Live: 1.072/1.078 rânduri `extras`. Rezultatul: F3 „de decontat" = suma unor cifre pe care nu le-a validat nimeni.

**BP-Q2 · Categoria = regex pe denumire, aplicată doar rândurilor AI**
- `fn_trg_categorie_cantitate`: `IF coalesce(NEW.extras_de_ai,false) THEN NEW.categorie := fn_categorie_cantitate(NEW.denumire)`. Un rând AI editat de om (`saveC` nu resetează `extras_de_ai`) își pierde categoria aleasă manual la următoarea schimbare de denumire; un rând manual nu primește categorie. Categoria alimentează `qm` (`categorie ~* 'conduct|re[țt]ea'`) și `randuriFront` ⇒ o regulă din dicționar schimbă sumele F3/fronturi fără urmă (cazul documentat în `plansa-citeste:158-166`).

**BP-Q3 · `tip_sursa` — setat o singură dată, prin backfill regex**
- Migrația `ofertare_cantitati_tip_sursa_h2_lista`: `UPDATE ... SET tip_sursa = CASE WHEN sursa ~* 'list[ae]? ?cantit' AND sursa ~* '\mF3\M' ...`. Nici `cantitati-extrage` (`:280-289`), nici `plansa-citeste` (`:213-224`), nici `addC` nu scriu `tip_sursa`; nu există trigger/default. Orice extragere viitoare produce rânduri NULL ⇒ `lista_f3_m` NULL ⇒ `controlCantitati` block „lipsește lista F3" deși F3 e în tabel.

**BP-Q4 · Sursa = string, nu referință**
- `cantitati-extrage:286`: `sursa: \`${d.nume_original}${p[3] ? ' — ' + p[3] : ''}\`.slice(0,300)`. `v_ofertare_contradictii` reconstruiește `document`/`sectiune` din acel string (`split_part(sursa,' — ',1)`, `fn_sectiune_sursa`). Fără `document_id`/pagină: o revizie a documentului (`trg_pt_invalideaza_la_revizie_document` există doar pentru PT) nu invalidează cantitățile; `saveC` lasă omul să rescrie `sursa` liber.

**BP-Q5 · Index unic pe (licitatie_id, denumire, sursa) + `ignoreDuplicates` = versiune pierdută / dublură tăcută**
- `cantitati-extrage:300-301`: `.upsert(feliaAsta, { onConflict: 'licitatie_id,denumire,sursa', ignoreDuplicates: true })`. Re-extragere cu model diferit: rândurile identice ca text nu se actualizează (cifra veche rămâne chiar dacă noua citire diferă), cele cu text diferit se adaugă lângă. Nu există `extras_la`/`model` pe rând, deci nu se poate spune care rulare a produs ce.

**BP-Q6 · Planșa scrie statusul `diferenta` și inserează rânduri AI fără poartă**
- `plansa-citeste:209`: `if (potrivit.status === 'extras' && dinMemoriu !== null && Math.abs(dinMemoriu - m) >= 1) patch.status = 'diferenta'`; `:213-224` INSERT `denumire: 'Conductă distribuție gaze Dn${dn}'`, `cantitate: m, cantitate_plansa: m` — cifra planșei devine și `cantitate` (coloana „document"), deci în `qm` intră ca `plansa_m` doar dacă backfill-ul i-ar da `tip_sursa='plansa'` (nu se întâmplă, vezi BP-Q3). A doua planșă pentru același Dn suprascrie `cantitate_plansa` (`:207-210`), fără istoric.

**BP-Q7 · `v_ofertare_contradictii` nu are consumator; `revizuit_clarificare` și `clarificari.cantitate_id` nu au scriitor**
- `grep v_ofertare_contradictii src/ supabase/functions .claude/skills` → 0; `grep revizuit_clarificare` → doar `OfertareCantitati.jsx:28` (etichetă). Regula „diferențele devin întrebări de clarificare" (comentariu `:3-4`) se realizează prin AI (`clarificari-propune`) pe `diferenta_nota`, nu prin view-ul determinist, și răspunsul la clarificare nu se întoarce pe cantitate.

**BP-Q8 · Două reguli pentru „care cantitate câștigă"**
- `GraficPoarta.jsx:262`: `const baza = p.cantitati_asumate === 'plansa' ? 'cantitate_plansa' : 'cantitate'` (memoriu vs planșă, ales de om); `ofertareControale.js:30-54` + migrația 13.09: referința e F3, restul sunt „diferențe de clarificat". Aceeași cifră (Σ fronturi) e validată de două logici diferite; `cantitati_asumate` nu are echivalent în `tip_sursa`.

**BP-Q9 · Poarta de cost lipsă la `cantitati-extrage`**
- `index.ts:170-176`: orice JWT de utilizator (fără is_owner/responsabil) pornește extragerea plătită și scrie în tabel; contrast cu `rfq-import:31-51` care are poarta de rol.

**BP-R1 · Re-importul AI șterge alegerea omului**
- `rfq-import:119-127`: `await supabase.from('ofertare_rfq_preturi').delete().eq('oferta_id', of.id)` apoi INSERT; `ales` nu e purtat din `vechi` în noile rânduri. Butonul „🤖 recitește" (`OfertareRFQ.jsx:486`) e disponibil după alegere.

**BP-R2 · `ales` fără actor și fără atomicitate**
- `OfertareRFQ.jsx:383-389`: buclă de update-uri secvențiale (`for (const a of altele) await ... update({ ales:false })`), apoi toggle; nu există `ales_de/ales_la`; RLS ALL pentru orice user autenticat.

**BP-R3 · Statusul RFQ e liber și duplicat între UI și inbox**
- UI select (`:435-437`, `salveazaMeta`) permite orice tranziție; `rfq-inbox:57-59` setează `oferte_primite` doar din `draft|trimisa`; `trimiteReferinte:401` setează `finalizata` fără a verifica că toate materialele au un preț ales; nimic nu setează `trimisa` (R02 nu scrie nimic).

**BP-R4 · Referințele pierd proveniența**
- `OfertareRFQ.jsx:394-399`: `{ denumire, um, pret, furnizor, lucrare: meta.titlu, an, note: 'din RFQ #' + rfq.id }` — fără FK la `rfq_preturi.id`/`oferta_id`; apăsare repetată = rânduri duplicate în `ofertare_preturi_materiale`.

**BP-R5 · Inbox extern: scrie + declanșează AI pe baza subiectului**
- `rfq-inbox:39-41`: `const m = String(subiect).match(/RFQ[-\s]?(\d+)/i)` → orice mail cu un id valid urcă PDF (`upsert:true`), inserează ofertă, schimbă status, apelează import cu service_role. Nu există lista destinatarilor (R02 nu scrie `rfq_destinatari`), deci nu se poate verifica expeditorul. Repo ≠ deploy (comentariu `:13-20`; secret literal în versiunea live).

**BP-R6 · PDF-ul ofertei fără amprentă**
- `addOferta:355-360` și `rfq-inbox:47-49`: path cu timestamp, fără sha256/size; `ofertare_rfq_oferte` n-are coloane pentru ele. `furnizor` scris de om e suprascris de AI (`rfq-import:129`).

**BP-G1 · Statusul e scris de client, înainte de efect**
- `OfertareGarantie.jsx:628-632`: INSERT `status:'cerere_trimisa'` → apoi mail; dacă Resend pică rămâne `cerere_trimisa` cu `cerere_trimisa_la = NULL`; `patch()` (`:652`) nu verifică starea anterioară; RLS ALL ⇒ orice user poate scrie `status='original'` fără fișier direct prin PostgREST. Tranzițiile există doar ca `if (g.status === …)` în JSX (`:799, :810, :820`).

**BP-G2 · Mail extern trimis de orice utilizator autenticat, cu service_role**
- `garantie-mail:31-35`: `getUser()` = singura verificare; `db` = service_role; `to: g.broker.email` (broker configurat în `ofertare_brokeri`, editabil de oricine cu RLS ALL — neverificat aici, tabela n-are policy listată în interogare). Destinatarii plății sunt hard-codați (`PLATA_TO`, `:16`).

**BP-G3 · Zilele de valabilitate = regex pe cerințe, cu fallback tăcut 90**
- `pregateste:590-592`: `for (const c of cs) { const m = /(\d{2,3})\s*(?:de\s*)?zile/i.exec(c.text_cerinta); if (m) { zile = Number(m[1]); break } }` — prima cerință care conține „NN zile" (poate fi valabilitatea ofertei, nu a garanției) decide perioada trimisă brokerului; nu se reține cerința sursă.

**BP-G4 · Polița nu intră în pachet și nu are hash**
- `aprobaPachet` (`OfertarePropunere.jsx:1737-1739`) — surse fixe: `propunere_docx`, `borderou_docx`; `ofertare_pt_pachet_fisiere.sha256` CHECK `^[0-9a-f]{64}$` există, dar `polita_path` din `ofertare_garantii` nu e hash-uit nicăieri. KPI verde = „există un rând cu status original", nu „documentul e în dosar".

**BP-P1 · Cerut = regex pe text, confirmarea e implicită la salvare**
- `OfertarePropunere.jsx:920`: `cerut_luni: Number((c.text_cerinta.match(RX_LUNI)||[])[1])`, `cerut_moment: ghicesteMoment(c.text_cerinta)` (`:903-910`, prima potrivire câștigă: „recepție finală" înainte de „recepție"); `salveazaGarantie:1289-1294` pune `confirmat_de/la` la orice salvare, inclusiv la corecții parțiale; `controlGarantie` tratează `garantie_confirmata` ca gate uman. `cerut_text` din schemă nu e scris ⇒ nu se poate vedea ce text a citit omul când a confirmat. `garantie_luni_in_capitole` = regex pe capitole (`v_ofertare_pt_stare` CTE `gk`) devine „fapt" blocant în `controlGarantie:81`.

**BP-X1 · Reguli duplicate UI vs server (rezumat)**
- Regex „conductă/rețea": `qm` (`categorie ~* 'conduct|re[țt]ea'`), `randuriFront` (`rxFrontCateg`, `rxFrontTitlu`), `plansa-citeste:eConducta` (`/^(m|ml)$/` + `!/tub|protec/`) — trei definiții ale aceluiași set de rânduri.
- „Total": `v_ofertare_contradictii` (`denumire ~* '^\s*total\y'`), `qm` (`!~* 'total'` pe obiect||denumire||sursa), `randuriFront` (`/total/i` pe obiect), `plansa-citeste:230` (`/total/i` pe denumire), `cantitati-extrage:283` (prefix „TOTAL ").
- Luni garanție: `RX_LUNI` (Propunere), CTE `gk`, `garantie_cerinte_lucrari` (view) — regex-uri diferite pentru același concept.
