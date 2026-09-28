# V2-J01 — raport Jakarinos

Cele cinci corecții sunt implementate în `scripts/audit-v2/`. Validare locală cu mockuri CDP/BD: **106/106 teste Vitest trecute**. Comanda standard este blocată de `spawn EPERM`; rularea alternativă verifică aceleași cinci fișiere de teste.

## Modificări

1. **Dialoguri — `cdp.mjs`, `scenariu.mjs`:** listenerul `Page.javascriptDialogOpening` există înaintea clickurilor; runnerul armează răspunsurile din acțiunile `confirma` imediat următoare. `accept` implicit true; prompt din `text`/`prompt_env`; mai multe dialoguri declarate se consumă în ordine. Dialogul neașteptat se respinge, produce UNDETERMINED și păstrează tipul/textul în `dialoguri-N.json` și eroarea verdictului. Răspunsurile prompturilor nu se jurnalizează. Testul CDP blochează deliberat răspunsul mouseReleased până la handleJavaScriptDialog.
2. **Storage și gardă — `siguranta.js`, `sandbox_storage_copy.mjs`:** destinații numai `103/…`, perechi exacte `5/cale → 103/cale`; traversarea, codificările și prefixele străine sunt refuzate. Fixture-ul pentru execuție trebuie să indice exact 103; rândul citit din BD trebuie să aibă același ID și prefixul `SANDBOX-V2-`. Testele verifică refuzul înainte de CDP/Storage.
3. **Taburi — `cdp.mjs`, `scenariu.mjs`:** cu target null se alege primul tab page cu originea exactă configurată, implicit `https://pontaj-pro-sooty.vercel.app`. Al doilea context exclude targetul primului pe același port. ID-urile explicite rămân respectate; lipsa celui de-al doilea tab se refuză. Verificările originii și clonei în UI se păstrează.
4. **RLS auxiliar — `rls.js`, `verifica_lant.mjs`, `scenariu.mjs`, `asertiuni.js`:** numai eroarea explicită 42501 pe cele patru tabele permite continuarea. Verigi marcate nedeterminat: ingest_coada → 1; extragere_coada → 2; verificari → 5; grafic_versiuni → 5,7. Citirea refuzată nu devine tabel gol și nu satisface count=0. Aserțiunile/fazele independente continuă; o încălcare demonstrată, inclusiv BYPASS în UI, are prioritate față de necunoașterea auxiliară. Alte erori rămân blocante.
5. **Concurență — `retete.js`:** eliminată atribuirea generică din `p.capitol_id`; obiectul rămâne explicit în fixture și este verificat în snapshot. Teste pentru obiectele distincte din 13/14/15.

Corecție necesară fixture-ului real: snapshotul citește strict D1/D6/D8; `cerinte._nota` nu mai ajunge obiect în filtrul de ID PostgREST. Testele SQL locale pot fi colectate și de Vitest, și standalone. Fișierele temporare ale testelor sunt create în acest director și eliminate.

## Verificări executate

| Comandă | Rezultat |
|---|---|
| `node --check` pentru toate fișierele `.mjs` din scripts/audit-v2 | **25/25 OK**; scenariu.mjs reverificat după ultima corecție |
| `npx vitest run scripts/audit-v2` | **BLOCAT: spawn EPERM**, esbuild la încărcarea vite.config.js; nu este declarat verde |
| `node scripts/audit-v2/run-vitest-local.mjs` | **106/106 PASS**, 5 fișiere; 45 teste P2 noi |
| `node --test scripts/audit-v2/test_sql_local.test.mjs` | **BLOCAT: spawn EPERM** la pornirea procesului copil |
| `node scripts/audit-v2/test_sql_local.test.mjs` | **3/3 PASS**, fără acces PostgreSQL |
| `node scripts/audit-v2/test-retete.mjs` | **PASS**, mesajul harnessului: 12 aserțiuni locale |

Runnerul alternativ folosește API-ul Vitest, worker threads, `configFile:false`, `esbuild:false` și `preserveSymlinks:true`; nu modifică configurația aplicației sau dependențele. Setările evită procesele externe blocate de mediul Windows.

## Limite

Nu am rulat CDP real, Supabase/PostgREST, Storage copy, PostgreSQL real sau scenarii live. **Zero scrieri în BD**, inclusiv în clona 103. Nu am accesat producția, secrete, src/ sau supabase/ pentru modificări. Nu am rulat git.

Gărzile sunt probate prin mockuri; izolarea tuturor efectelor secundare ale UI-ului real nu este demonstrată de aceste teste. Un SELECT filtrat silențios de RLS nu poate fi identificat ca refuz dintr-un array gol. Fazele/selectoarele/ground truth necompletate în fixture rămân în sarcina operatorului, conform manualului. Nu a fost necesară o decizie nouă de arhitectură.

## Statistici fără git

`git diff --stat`: **NERULAT**, conform interdicției explicite. Mai jos este comparația textuală față de fișierele citite la începutul sesiunii, cu finalurile de linie normalizate; nu reprezintă un diff față de HEAD.

| Fișier | Linii adăugate | Linii eliminate |
|---|---:|---:|
| `scripts/audit-v2/asertiuni.js` | +9 | −3 |
| `scripts/audit-v2/cdp.mjs` | +65 | −12 |
| `scripts/audit-v2/p2.test.js` | +244 | −0 |
| `scripts/audit-v2/retete.js` | +2 | −2 |
| `scripts/audit-v2/rls.js` | +10 | −0 |
| `scripts/audit-v2/run-vitest-local.mjs` | +14 | −0 |
| `scripts/audit-v2/sandbox_storage_copy.mjs` | +1 | −1 |
| `scripts/audit-v2/scenariu.mjs` | +64 | −20 |
| `scripts/audit-v2/siguranta.js` | +3 | −2 |
| `scripts/audit-v2/siguranta.test.js` | +11 | −10 |
| `scripts/audit-v2/test-retete.mjs` | +2 | −2 |
| `scripts/audit-v2/test_sql_local.test.mjs` | +2 | −1 |
| `scripts/audit-v2/verifica_lant.mjs` | +1 | −1 |

**13 fișiere cod/teste: +428 / −54 linii**, plus acest raport nou. Modificările persistente sunt limitate la scripts/audit-v2 și acest raport.
