# Raport JAK — R13 / R15 / R16

28.09.2026. Modificări locale implementate; validarea standard completă **nu este verde**, fiind blocată de mediul Windows.

## Modificări

- **R13 — `src/ofertareControale.js`:** fiecare piesă de grafic trebuie să declare în câmpul existent `sursa_versiune` versiunea înghețată curentă. Numărul textual (`3`) sau notația explicită `grafic@v3` sunt recunoscute; o versiune diferită produce `block`, absența unei legături identificabile produce `warn`. Un singur fișier corect nu acoperă celelalte fișiere. Amprentele capitolelor, numele și hash-ul fișierului nu sunt dovezi de corespondență. Lipsa oricărei versiuni înghețate rămâne blocantă.
- **R15 — `supabase/functions/ofertare-cerinte/core.ts`:** verificarea caută întregul pasaj normalizat, inclusiv partea de după caracterul 300. Prefixul de 80 de caractere păstrează pagina, dar produce `verificat: false, pasaj_partial: true`. Inserarea folosește numai coloanele existente; rezultatul adaugă `pasaje_partiale: [{ index, pagina }]`, cu index de la zero în lista inserată. Câmpul existent `trunchiat` devine `true` și la minimum 150 de elemente, pe lângă `max_tokens` și recuperarea JSON incomplet. Un răspuns fără niciun obiect JSON recuperabil întoarce eroare + `trunchiat: true`, nu succes gol. Trei parametri ai callback-urilor au primit tipuri explicite pentru verificarea Deno.
- **R16 — `supabase/functions/ofertare-organigrama-spec/core.ts`, `index.ts`, `src/OfertareOrganigrama.jsx`:** normalizarea pură exportată păstrează `true` / `false` numai pentru booleene explicite; valori omise, null sau invalide devin `null`. Regula acoperă și liniile, rolurile, tabelul nominal, organizarea per operator și corelarea cu graficul. UI afișează „nu s-a putut stabili — verifică documentația” și marchează informațiile necunoscute cu `?`.

## Teste

Adăugate: regresiile R13 în `src/ofertareControale.test.js`, testul UI `src/OfertareOrganigrama.test.jsx`, câte un `core_test.ts` în cele două funcții. Fixture-ul vechi din `src/graficRelatii.test.js` declară acum versiunea sursă.

| Validare | Rezultat |
| --- | --- |
| `npx vitest run` | Blocat înaintea testelor: `spawn EPERM`, la pornirea esbuild pentru configurația Vite. |
| `deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-cerinte supabase/functions/ofertare-organigrama-spec` | Blocat: Deno 2.9.7 panic, `Unexpected client pipe failure`, cod Windows 5 / handle invalid. |
| `npx vite build` | Blocat la configurație: `spawn EPERM` în esbuild. |
| `deno check --node-modules-dir=none --no-lock` pe cele două `core_test.ts` | Trecut, inclusiv modulele core importate. |
| Executarea directă a callback-urilor celor două `core_test.ts`, prin `deno run` și un colector temporar `Deno.test` în stdin | **21/21 trecute**, fără izolarea și sanitizatoarele runnerului standard. Transportul AI și BD sunt simulate. |
| Verificări directe Node pentru R13 | **12/12 trecute**: corespondență, diferență, sursă necunoscută, pachet mixt, versiune lipsă, pachet gol. |
| Parsare Babel pentru componentă și testul JSX | Trecut; nu echivalează cu rularea testelor UI sau cu build-ul. |

## Limite și verificări rămase

- Producția, schema, migrările, RPC-urile, `v_ofertare_pt_stare`, `fn_gate_depunere` și `src/OfertarePropunere.jsx` nu au fost modificate. Nu am creat/schimbat ramura, făcut commit sau push. Am executat doar comanda Git de citire `git diff --stat`, cerută explicit de specificație.
- Generatorul actual al manifestului din `OfertarePropunere.jsx` scrie `capitole@{...}`. Aceste manifeste primesc avertizare pentru piesele de grafic; nu am inventat o asociere din versiunea curentă. Formatele recunoscute mai sus sunt contractul cititorului, nu afirmația că producătorul existent le salvează deja. Claude trebuie să verifice ce câmpuri ajung efectiv în `st.pachet_fisiere` pe calea reală; lipsa provenienței rămâne vizibilă.
- Marcajul suplimentar al pasajelor parțiale este în rezultatul extractorului, nu într-o coloană nouă; BD păstrează pasajul, pagina și `pasaj_verificat=false`. `trunchiat` este deja preluat de worker în jurnalul extracției.
- Valorile `false` salvate anterior prin coerciție nu pot fi deosebite retrospectiv de un `false` explicit fără recitirea sursei. Nu am rescris date istorice.
- Claude trebuie să reruleze cele trei comenzi obligatorii într-un mediu funcțional. Nu am validat Deno HTTP, PostgREST sau UI în browser.

## `git diff --stat`

Capturat după modificările codului; Git nu include fișierele noi neadăugate:

```text
 src/OfertareOrganigrama.jsx                        | 14 ++++-----
 src/graficRelatii.test.js                          |  4 +--
 src/ofertareControale.js                           | 18 ++++++++---
 src/ofertareControale.test.js                      | 24 ++++++++++++++-
 supabase/functions/ofertare-cerinte/core.ts        | 35 ++++++++++++++--------
 .../functions/ofertare-organigrama-spec/index.ts   | 29 ++----------------
 6 files changed, 70 insertions(+), 54 deletions(-)
```

Fișiere noi suplimentare: acest raport, `src/OfertareOrganigrama.test.jsx`, `supabase/functions/ofertare-cerinte/core_test.ts`, `supabase/functions/ofertare-organigrama-spec/core.ts`, `supabase/functions/ofertare-organigrama-spec/core_test.ts`. Diff-ul este în fișierele locale, fără staging.
