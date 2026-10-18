# Ofertare P1 — garzi la raspuns AI (19.10.2026, prin cdx)

Audit Jakarinos pe functiile AI din Ofertare: 11 riscuri P1. In acest PR:

- `ofertare-rfq-import`: res.ok, max_tokens, refuz si text gol opresc importul; fara fallback `{}`. Preturile existente se inlocuiesc DOAR daca AI intoarce cate un rand valid pentru fiecare material cerut (pret null = neofertat) si macar un pret real. Altfel preturile si metadatele raman neschimbate si importul nu e marcat reusit.
- `ofertare-clauze-formulare`: clauzele AI neverificate se inlocuiesc doar cu o lista validata nevida; `propunere_text` nu se suprascrie cu gol.

Ramase pentru sesiunea Ofertare (vezi `C:\Users\Public\paw-data\out\jak_audit_ofertare_ai.log`): `ofertare-cerinte` (resetul pe mai multe bucati trebuie sa valideze toate bucatile inainte de primul DELETE), ingest-doc, plansa-citeste, genereaza-capitol, organigrama-spec, document-nou-citeste, triere, clarificare-citeste, raspuns-set. Riscul DELETE→INSERT netranzactional ramane (erori DB dupa DELETE).
