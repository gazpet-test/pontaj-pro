# Activarea SMS Redări (șablonul fix pe UAT, 20261130c)

Comutatorul Redări (`sms_setari.redari_autorizat`, din 📱 SMS → Setări, doar owner) **se pornește numai după ce sunt îndeplinite toate condițiile de mai jos**:

1. **Autorizarea scrisă Transgaz** (sub-împuternicit, art. 28 GDPR). Numărul și data ei se trec la pornirea comutatorului.
2. **Textul final al șablonului**, formulat de Juridic și aprobat de Razvan.
   - Textul de acum e PROVIZORIU, cu versiunea `provizoriu-2026-11-03`.
   - Cât timp versiunea începe cu `provizoriu-`, comutatorul rămâne oprit.
3. **Textul final, schimbat într-o singură livrare**: o migrare nouă plus PR-ul de UI, cu verificările obișnuite (Jakarinos + Copilot, DRY pe producție):
   - `fn_sms_redari_sablon_model()` și `fn_sms_redari_sablon_versiune()` (versiune nouă, de ex. `final-AAAA-LL-ZZ`), în SQL;
   - `SABLON_REDARI` și `SABLON_REDARI_VERSIUNE` din `src/sms/sablonRedari.js`;
   - cazurile de paritate SQL / JS refăcute: `src/sms/sablonRedari.test.js` și DRY-ul (TEST2), cu textele noi scrise de mână.
4. **Lungimea textului.** Dacă textul final e mai lung, verificați că UAT-urile proiectului încap în 160 de caractere GSM-7. UI-ul și BD-ul refuză oricum lotul peste 160.

Loturile create cu un text vechi nu se mai pot trimite după schimbarea lui: aprobarea și rezervarea dau `text_schimbat`. Se anulează din 📱 SMS → Istoric și se refac.

Nu există o coloană separată pentru „text aprobat”. Poarta e această procedură, plus marcajul de versiune din lot (`filtru.sablon_versiune`).

**Blocaj tehnic** (r9, varianta implicită, de confirmat de Razvan):
- Cât timp versiunea începe cu `provizoriu` (sau lipsește), un lot din șablon primește `sablon_neaprobat` la aprobare, la rezervare și la cron.
- Excepție: proiectele cu codul `TEST-…` (de ex. `TEST-RAZVAN`). Acolo fluxul se poate testa înainte de textul final.
- Pe proiectele reale, previzualizarea arată avertismentul „șablon provizoriu, nu poate fi aprobat”, iar crearea e refuzată, ca să nu rămână loturi blocate.
- Regula e în `fn_sms_redari_sablon_aprobat(versiune, proiect)`.
- La textul final, migrarea nouă schimbă `fn_sms_redari_sablon_versiune()` într-o valoare fără `provizoriu`. Loturile provizorii create între timp pe proiecte TEST- dau apoi `text_schimbat`, dacă textul s-a schimbat, și se anulează.

## Limite cunoscute (acceptate)

- **Eligibilitatea** e garantată la momentul revalidării de la rezervare, nu la livrare. Un răspuns înregistrat după revalidare, în aceeași fracțiune de secundă, nu oprește un SMS deja rezervat.
- **`rezervat_la`** intră în numărarea consumului (`fn_sms_consum_la`, `fn_sms_test_consum_zi_la`).
  - Din r9, `fn_sms_rezerva` scrie `rezervat_la` = reperul final al rezervării (`v_acum`), în același UPDATE. Mesajele unei tranșe se numără deci în aceeași zi / lună în care s-au verificat plafonul și bugetul.
  - O valoare neplauzibilă (în viitor sau mai veche de un minut) e înlocuită de trigger cu momentul efectiv.
