# JAK_494_r4 — raport (27.09.2026)

Implementate cele trei cerințe din `JAK_494_r4.md`.

- `worker/ofertare/plansa.ts`: hash-uri valide distincte, normalizate lowercase. A+B anulează cu motivul de identitate contradictorie, doar B cu motivul schimbării fișierului; doar A permite citirea, duplicatele A/a nu sunt contradicții. Lipsa hash-urilor valide păstrează jurnalul `neverificata`. Manifestul nu se modifică.
- După fiecare rezervare reușită, inclusiv pentru lipire, workerul recitește documentul și manifestul și reaplică `motivAnulare`. Schimbarea sursei anulează jobul și regularizează rezervarea la cost 0 cert. Eroarea recitirii încearcă aceeași regularizare și oprește jobul. Dacă regularizarea este indisponibilă, rezerva nu este suprascrisă local.
- Toate corpurile de citire/reluare/lipire includ `asteptat: { taiat_la, cale_felii }`, din job. Workerul clasifică și refuzul 409 fără `in_lucru` de la lipire drept `anulat`.
- `supabase/functions/ofertare-plansa-citeste/handler.ts`: singura adăugare este verificarea `asteptat`, comună citirii și lipirii, înainte de storage/rezervări/AI. Poarta existentă de autorizare și răspunsul pentru document inexistent preced verificarea, păstrând protecția împotriva enumerării documentelor. Nepotrivirea întoarce exact 409 + mesajul cerut + `cost_usd: 0`, fără `in_lucru`. Fără `asteptat`, fluxul existent rămâne neschimbat.
- Un răspuns final cere propriul sumar obiect (nu null/array/primitiv). Altfel: `partial`, `răspuns final fără sumar`, rezultat null, fără lipire. Sumarele intermediare se păstrează numai în jurnal.
- `worker/ofertare/plansa_test.ts`: cele 28 de teste păstrate, cu verdictul vechi A+B corectat; 6 teste noi, unele parametrizate. `poarta_test.ts`: 2 teste noi parametrizate pentru nepotrivire și compatibilitate pe ambele moduri.

Verificări RULATE:

| Verificare | Rezultat |
| --- | --- |
| `deno check --node-modules-dir=none worker/ofertare/plansa.ts worker/ofertare/plansa_test.ts` | PASS |
| `deno test -A --node-modules-dir=none worker/ofertare/plansa_test.ts` | Runner Deno 2.9.7 căzut: `Unexpected client pipe failure`, Windows 5 / handle invalid |
| `deno test -A --node-modules-dir=none supabase/functions/ofertare-plansa-citeste/` | Blocat la descărcarea manifestului JSR `@std/assert`; nu a executat teste |
| Worker prin adaptor `deno eval --node-modules-dir=none` | **34 PASS, 0 FAIL** |
| Toate cele 7 fișiere de teste handler prin adaptor Deno, cu dependențe locale | **240 PASS, 0 FAIL** |
| `deno check` handler + poarta_test cu import map local | FAIL: 34 erori de tipuri ale importurilor adaptate (`anon.auth.getUser` din CJS, aliasurile de aserțiuni); nu declar validarea de tipuri a handlerului trecută |

Cele 240: agregare 57, aprobare_runda5 5, cantitati_nevalidate 30, concurenta 96, invalidare_unitati 24, poarta 16, transfer_conflicte 12.

Adaptorul worker este cel documentat în `docs/JAK_494_r3_raport.md`: înlocuiește înregistrarea `Deno.test` și execută secvențial funcțiile originale. Pentru handler, JSR indisponibil a fost înlocuit numai în adaptor cu `node:assert/strict`, iar importul npm Supabase cu pachetul local 2.105.3 (clientul din teste este simulat). Nu s-au schimbat importurile surselor. Prima încercare cu `--node-modules-dir=none` nu a rezolvat pachetul local; rularea reușită folosește `manual`.

Reproducerea adaptorului handler, PowerShell din rădăcina proiectului:

```powershell
$assertModule = @'
import { ok, deepStrictEqual } from 'node:assert/strict';
export const assert = ok;
export const assertEquals = deepStrictEqual;
export function assertFalse(value, message) { ok(!value, message); }
'@
$jakMap = Join-Path $env:TEMP 'jak494-r4-import-map.json'
$imports = @{
  'jsr:@std/assert@1' = ('data:application/javascript;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($assertModule)))
  'npm:@supabase/supabase-js@2' = ([System.Uri](Join-Path (Get-Location) 'node_modules/@supabase/supabase-js/dist/index.cjs')).AbsoluteUri
}
@{ imports = $imports } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $jakMap
$runner = @'
const tests = [];
Deno.test = (name, fn) => {
  if (typeof name !== 'string' || typeof fn !== 'function') throw new Error('Unsupported test registration');
  tests.push({ name, fn });
};
for (const file of Array.from(Deno.readDirSync('./supabase/functions/ofertare-plansa-citeste'))
  .filter(f => f.name.endsWith('_test.ts')).sort((a,b) => a.name.localeCompare(b.name))) {
  await import('./supabase/functions/ofertare-plansa-citeste/' + file.name);
}
let failed = 0;
for (const t of tests) {
  try { await t.fn(); }
  catch (e) { failed++; console.error('FAIL', t.name, e); }
}
console.log(`${tests.length - failed} PASS, ${failed} FAIL`);
if (failed) Deno.exit(1);
'@
deno eval --no-config --no-lock --cached-only --node-modules-dir=manual --import-map $jakMap $runner
```

Limite: adaptorul nu reproduce verificările de resurse ale runnerului nativ și nu validează tipurile dependențelor originale. Testele folosesc Supabase și AI simulate; nu dovedesc comportamentul PostgREST/Postgres real. Nu am rulat Vitest/build (fără schimbări React), nu am rulat git și nu am accesat producția. Nu am modificat schema, RPC-urile sau migrările.
