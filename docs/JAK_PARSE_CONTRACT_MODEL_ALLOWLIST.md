# Validare PARSE_CONTRACT_MODEL

- `_shared/haiku55.ts`: `modelParsare` accepta strict `claude-haiku-5-5`, `claude-haiku-4-5`, `claude-sonnet-5-5`. Orice alta valoare (inclusiv sir gol) revine la Haiku 5.5 cu un singur `console.warn` per apel, continand valoarea respinsa. Variabila absenta revine fara avertisment.
- Acelasi fisier: tarif Sonnet 5.5 de 2 / 10 USD per milion de tokeni input/output.
- `ocr-packing-list`, `parse-anexa-pdf`, `parse-contract-pdf`, `parse-contract-proiect`, `parse-pccvi-faze`: modelul se selecteaza prin helper; configuratia existenta `faraGandire(MODEL)` si calculul `costApel(MODEL, u)` folosesc acelasi model validat.
- `_shared/haiku55_test.ts`: teste pentru modelele permise, configuratia gandirii, tarifele input/output, variabila absenta, valori necunoscute, goale, spatii, majuscule si alias nepermis; verifica si avertismentele.

Verificare statica PowerShell trecuta pentru integrarea helper-ului, gandirii si costului in toate cele cinci functii.

Testele nu au putut fi executate: `deno` nu este disponibil in PATH. Comanda incercata, fara acces la retea:

```powershell
deno test --cached-only --node-modules-dir=none supabase/functions/_shared/haiku55_test.ts supabase/functions/_shared/gandire_test.ts
```

Nu s-au executat Git, instalari, acces la retea, operatii pe baza de date sau deploy.
