# gazpet-claude-cli — Claude Code CLI pe NAS Terra (pilot read-only)

Decizie Răzvan 22.09.2026 (varianta A; fallback B = tura de noapte redusă la inventar), pe condițiile lui Jakarinos:
pilot pe Terra, doar sarcinile personale ale lui Răzvan, doar citire și propuneri, fără `service_role`, fără Bash, fără mail,
raport pentru om. Abonamentul lui Răzvan NU devine backend ERP pentru alți utilizatori — pentru asta rămâne API-ul (workerul Deno).

## Ce face
`docker-compose run` = o rulare = un raport `.md` în `./out/`, cu jurnal (`out/jurnal.log`: ture, tokeni, cost API echivalent,
motiv de oprire — fără secrete). Sarcina de probă: `lectura_licitatie` = „a doua lectură” a documentației dintr-un folder de
licitație montat `:ro` (`prompts/lectura_licitatie.md`). Launcher-ul pre-extrage textul (pdftotext/unzip) pentru că agentul
nu are Bash; agentul are DOAR `Read, Glob, Grep`, `--permission-mode dontAsk`, `--max-turns`, `timeout`, fără subagenți,
fără sesiune pe disc, fără MCP, fără conectorii claude.ai (token-ul din `setup-token` nici nu le poate accesa).

## Identitate și limite (surse: code.claude.com/docs/en/authentication, /headless, /cli-reference)
- `claude setup-token` (pe laptop, în browser) → token OAuth de abonament valabil 1 an → `CLAUDE_CODE_OAUTH_TOKEN` în `.env`.
  Poate face DOAR cereri către model. Consumul intră în limitele abonamentului lui Răzvan (comune cu laptopul și chatul).
- Launcher-ul șterge `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` din mediu: o cheie moștenită ar factura API de la început.
- La plafon de abonament rularea pică (exit ≠ 0, motiv în jurnal). NU se reia automat: se așteaptă resetarea. Fără retry loop.
- `--bare` NU se folosește: nu citește token-ul de abonament (ar cere cheie API).

## Instalare pe Terra (o singură dată)
```
mkdir -p /Volume1/docker/gazpet-claude-cli/{out,context,claude-home,prompts} && cd /Volume1/docker/gazpet-claude-cli
for f in Dockerfile docker-compose.yml launcher.sh .env.example; do curl -fsSLO https://raw.githubusercontent.com/gazpet-test/pontaj-pro/main/worker/claude-cli/$f; done
curl -fsSL -o prompts/lectura_licitatie.md https://raw.githubusercontent.com/gazpet-test/pontaj-pro/main/worker/claude-cli/prompts/lectura_licitatie.md
cp .env.example .env && chmod 600 .env && chown -R 1000:1000 out context claude-home
# token-ul: generat pe laptop cu `claude setup-token`, trimis prin SSH stdin (terra_ssh.py + `cat >> .env`), NU prin chat
docker-compose -p gazpet-claude-cli build
```
Rulare de probă (Mânăstirea, lic. 3):
```
sh run_pilot.sh "/Volume1/Licitatii_Executate/Oferte/2.DISTRIBUTIE GAZE/58.Distrib gn in com MANASTIREA, JUD CALARASI termen dep 24.09.2026"
tail -n 20 out/jurnal.log; ls -la out/
```
`LIC_FOLDER` (din `.env`) e folderul licitației pe NAS. Opțional, în `context/` se pune un `.md` cu clarificările deja
trimise/propuse (export făcut de om sau din chat), ca să nu le repete.

## Plafoane pilot (Jakarinos)
o rulare/noapte · concurență 1 · 15 min · 20 ture · fără subagenți · 2 GB RAM / 2 CPU · root fs read-only, `cap_drop ALL`,
`no-new-privileges`, user 1000. Stop automat: plafon, token expirat, timeout, acces refuzat, raport gol. Un raport fără
citate fișier/pagină e marcat „nevalidat” în jurnal.

## Măsurare (minimum 2 săptămâni, aceleași dosare, același Sonnet)
Din jurnal: tokeni in/out/cache, cost API echivalent (estimare client, NU factura abonamentului), durată, ture; plus, de la om:
constatări corecte / greșite și minute de verificare. Comparație cu workerul Deno pe aceleași licitații.

## Ce NU face (și nu se adaugă fără o a doua părere)
Nu scrie în Supabase, nu urcă fișiere, nu trimite mail, nu rulează comenzi, nu are cheie API, nu are `service_role`,
nu execută cereri ale altor utilizatori din platformă.


## Sarcina `source_pack` (B1, 23.09.2026) — CLI citește, workerul scrie

`sh run_pilot.sh "<folder licitație>" source_pack` → agentul (Sonnet, fără scriere) produce un **Source Pack v1**
(`claude_docs.source_pack_ofertare_v1`): cerințe verbatim cu `nume_fisier` + `pagina` + `excerpt`, `nereusite` obligatoriu.
Răspunsul brut rămâne în `out/<stamp>_source_pack.md`; `verifica_pack.mjs` (fără AI) caută fiecare `excerpt` LITERAL în
`/work/text` — întâi pe pagina declarată, apoi în tot documentul (corectează pagina) — și scoate cerințele negăsite în
`nereusite`. Rezultatul validat: `out/<stamp>_source_pack.pack.json` (jurnal: `pack VALIDARE …`, `PACK=…`).
Opțional `context/documente.json` (lista documentelor din ERP: id, nume_fisier, seap_cod, tip, pagini) — de acolo ia
agentul `seap_cod`. Containerul NU are chei: importul în BD îl face doar workerul (B2), din pack-ul validat.
