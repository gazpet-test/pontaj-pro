# R17 — lanțul dovezii

Implementat local, numai UI și citire. Fără Git, producție, migrări, SQL nou sau dependențe noi. Ramura nu a fost creată/verificată: AGENTS.md interzice rularea Git.

## Modificări

- `src/OfertarePropunere.jsx`: selecția din `MatriceCerinte` deschide panoul; pentru selecții multiple există selector al cerinței inspectate. Acțiunile în bloc sunt păstrate.
- `src/OfertareLantProbator.jsx`: cele șase verigi în ordinea cerută, câmpuri absente explicite, erori de citire distincte, reîncărcare și ignorarea răspunsurilor sosite după schimbarea selecției. Autorii sunt afișați prin harta existentă de profiluri, cu UUID dacă numele nu este disponibil.
- `src/ofertareLantProbator.js`: compunere pură; scan verificat fără reverificare cerută; blocajele primele; semnalarea versiunilor vechi; istoricul invers `inlocuita_de`, cu snapshot-uri separate de acoperirea curentă; potrivire exactă a ID-urilor din clarificări și manifest.
- `src/ofertareLantProbatorDate.js`: numai `supabase.from(...).select(...)`, paginare și loturi de ID-uri. Dovezile se citesc prin `legatura_id`, fișierele separat prin `pachet_id`; ultimul pachet se alege după `versiune`. Nu se revine la unul vechi dacă ultimul este gol.
- `src/ofertareLantProbator.test.js`: 27 teste pentru regulile cerute, istoricul acoperirii, izolare per cerință, candidați, potrivirea clarificărilor, manifest, paginare și erori de citire.

## Schema și limitele interpretării

Coloanele/relațiile au fost confruntate cu migrările `20260912_ofertare_propunere_tehnica_v1.sql`, `20260913_ofertare_pt_legaturi_stare_si_dovezi.sql`, `20260913_ofertare_pt_pachet_manifest.sql`, `20260912_ofertare_raspuns_set_schema.sql`, funcția de aplicare a setului și query-urile existente din `OfertareCerinte.jsx`/`OfertareLicitatii.jsx`.

Clarificările folosesc referințele textuale explicite existente: `cerința #ID`, `cerințe #ID, #ID` (formatele producătorilor din `ofertare-acoperire/core.ts` și `ofertare-clarificari-propune/core.ts`), respectiv `cerinta_id: ID`/`cerinta_id=ID` în sursă, întrebare sau răspuns. Nu am găsit o relație demonstrată între cerință și cantitate care să permită asocierea prin `cantitate_id`; nu am inventat una. Fără referință explicită: „nicio legătură înregistrată”.

Manifestul este interpretat conform `ofertarePachet.js`: `capitole@{ID:vN,...}`. Sunt afișate fișierele cu rolul existent `propunere_docx`; borderoul primește aceeași amprentă în codul existent, dar nu conține răspunsurile capitolelor. Un capitol legat absent din manifest este semnalat inclusiv când alt capitol este inclus. Prezența în manifest nu certifică verificarea conținutului sau depunerea; starea pachetului rămâne vizibilă.

## Verificări

- `npx vitest run src/ofertareLantProbator.test.js`, `npx vitest run`, `npx vite build`: oprite la pornire cu `spawn EPERM`, la procesul esbuild. Nu sunt declarate trecute.
- Rulare Vitest prin API, cu configurație temporară în memorie (`config:false`, `configFile:false`, `esbuild:false`, `resolve.preserveSymlinks:true`, pool `threads`, un worker): **27/27 teste R17 trecute**. Configurația proiectului nu a fost modificată.
- Aceeași rulare alternativă pe întreaga suită: **810 teste trecute, 2 eșuate**, 26 fișiere trecute și 5 eșuate. Patru suite nu se pot colecta fără transformarea JSX/TS (`ofertareRunda9`, `ofertareCandidati`, `terraTemperaturi`, `OfertareOrganigrama`). Cele două aserțiuni eșuate sunt în `service.test.js`: 89 în loc de 90 de zile și urgență 0,9666 în loc de 1. Fișierele respective nu au fost modificate; cauza nu a fost investigată în R17.
- Parserul Babel existent: sintaxă validă pentru cele cinci fișiere JS/JSX modificate/adăugate.

Reproducerea rulării alternative R17 în PowerShell:

```powershell
@'
import { startVitest } from 'vitest/node';
const ctx = await startVitest('test', ['src/ofertareLantProbator.test.js'],
  { config:false, watch:false, pool:'threads', maxWorkers:1, minWorkers:1 },
  { configFile:false, esbuild:false, resolve:{ preserveSymlinks:true } });
if (ctx) {
  process.exitCode = ctx.state.getUnhandledErrors().length || ctx.state.getFiles().some(f => f.result?.state === 'fail') ? 1 : process.exitCode;
  await ctx.close();
}
'@ | node --input-type=module
```

Nu am validat vizual în browser și nu am apelat PostgREST real: producția și secretele sunt excluse prin instrucțiuni. Dublul PostgREST din teste verifică selecția/paginarea, nu RLS sau rezolvarea embed-urilor. Claude trebuie să ruleze build-ul și suita standard și să verifice citirile pe API cu rolul real înainte de publicare.
