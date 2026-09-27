# JAK_D4_r3 — două completări de proveniență după runda 2 Copilot (NO-GO)

Pleci de la aeb81db (branch `claude/d4-plansa-cli`). Copilot a închis punctele 1, 3, 4, 5 — nu le atinge.
Aceleași limite ca în `docs/JAK_D4_plansa_cli.md` și `AGENTS.md`. Fiecare reparație cu testul scenariului.

## D4-01 [MAJOR] Launcher-ul nu verifică bytes-ii JPEG efectiv citiți
`worker/claude-cli/launcher.sh` (L107–118, L151–164): `pachet_id` se calculează din hash-urile DECLARATE în manifest;
fișierele din `/data/felii` nu sunt hash-uite înainte de CLI. Un JPEG diferit în staging trece, iar textul lui e atribuit feliei corecte.
**Reparație**: înainte de pornirea CLI, launcher-ul calculează SHA-256 pentru FIECARE fișier din `/data/felii` și îl compară cu
manifestul; orice nepotrivire, fișier lipsă sau fișier în plus → oprire (cod ≠ 0, motiv în jurnal), CLI nu pornește.
Nu „repara” manifestul. Hash-urile verificate efectiv se scriu în rezultat (câmp calculat de launcher, nu de model).
**Test**: manifest corect + un JPEG local modificat → refuz înainte de CLI (CLI simulat nu e apelat).

## D4-02 [MAJOR] Promptul efectiv și modelul real nu intră în compatibilitatea citirii
`plansa_cli_comun.ts` (`calculeazaPachetId`), `plansa_cli_importa.ts` (L9–14, L109–110, L140–149), `handler.ts` (versiuneCur).
Două rulări CLI cu același `pachet_id`, dar alt `prompts/plansa_felii.md` sau alt model Opus, continuă tacit aceeași citire,
fiindcă handlerul primește tot `cli:opus` + sha-ul INSTRUCTIUNI.
**Reparație**: separă identitatea intrărilor (`pachet_id`, neschimbat) de identitatea configurației de lectură:
`config_cli` = { model raportat de CLI, sha256 al promptului efectiv al launcher-ului (`plansa_felii.md` + ce se trimite CLI-ului) }.
Transmite-o handlerului prin `Deps` (extinde minimal: ex. `Deps.versiuneExtra` sau `modelEticheta` = `cli:<model>` + prompt_sha
compus) astfel încât `versiuneCur` și regula existentă `versiuneIncompatibila` să le distingă la continua/lipire/CAS.
Diferență → refuz (fără mixare tacită); proveniența rămâne în citire. Fără `Deps` nou setat → comportament identic cu azi.
**Test**: R1 (prompt V1, model A) importat parțial; R2 cu același pachet_id dar prompt V2 SAU model B → continuarea refuzată.
Plus: suita handler 240/240 neschimbată.

## La final
Actualizează `docs/JAK_D4_raport.md` (secțiunea „r3”).
