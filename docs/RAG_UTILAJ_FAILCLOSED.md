# rag-utilaj — erori AI explicite

Modificări în `supabase/functions/rag-utilaj/index.ts`:
- Răspunsul conversațional verifică `aiRes.ok` înainte de citirea JSON-ului. La eroare întoarce HTTP 502 cu mesaj în română; `ask` și `ask_qr` propagă răspunsul imediat, fără scrieri ulterioare. Rezervările de cotă existente, anterioare apelului AI, rămân neschimbate.
- Transcrierea goală, trunchiată (`max_tokens`) sau imposibil de parsat ca listă JSON întoarce eroare de business prin mecanismul existent pentru refuzuri: coada este marcată `error`, fără throw și fără inserarea lotului invalid. Loturile valide procesate anterior rămân neschimbate.

Verificare: șase verificări statice PowerShell trecute pentru ordinea porților, propagarea erorilor și eliminarea fallback-ului pe text brut. Nu există fișier de teste lângă funcție; conform brief-ului nu am adăugat teste. Nu am rulat teste Deno sau verificare de tipuri: Deno și Node nu sunt disponibile în PATH.

Fără Git, rețea, instalări, acces la baze de date sau deploy.
