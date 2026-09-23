#!/bin/sh
# launcher — o rulare = un raport. Argument: numele sarcinii (fișier în /opt/prompts/<sarcina>.md). Implicit: lectura_licitatie.
# Garanții (condițiile Jakarinos 22.09.2026): fără cheie API, fără Bash/Edit/Write/Agent/Web, fără BD, fără mail,
# /data montat :ro, timeout + max-turns + stop la orice eroare; jurnal fără secrete.
set -u
TASK="${1:-lectura_licitatie}"
PROMPT_F="/opt/prompts/$TASK.md"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_MD="/out/${STAMP}_${TASK}.md"; OUT_JSON="/out/${STAMP}_${TASK}.json"; JURNAL="/out/jurnal.log"
START=$(date +%s)
J() { echo "$(date +%H:%M:%S) $*" | tee -a "$JURNAL" >&2; }
final() { # cod motiv
  DUR=$(( $(date +%s) - START ))
  J "FINAL task=$TASK cod=$1 motiv=$2 durata=${DUR}s raport=$OUT_MD"
  exit "$1"
}
# 1. identitate: DOAR abonament (token setup-token). Orice cheie API moștenită ar factura API de la început.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL 2>/dev/null
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { J "CLAUDE_CODE_OAUTH_TOKEN lipsește din .env"; final 2 fara_token; }
[ -f "$PROMPT_F" ] || { J "prompt necunoscut: $TASK"; final 2 prompt_lipsa; }
[ -d /data ] || { J "/data nu e montat"; final 2 fara_date; }
command -v claude >/dev/null || { J "claude CLI lipsește din imagine"; final 2 fara_cli; }
J "START task=$TASK cli=$(claude --version 2>/dev/null | head -1) model=${TASK_MODEL:-sonnet} effort=${TASK_EFFORT:-medium} timeout=${TASK_TIMEOUT_MIN:-15}m max_turns=${TASK_MAX_TURNS:-20}"

# 2. pre-extragere text (agentul nu are Bash): PDF → text cu marcaje ⟦PAGINA n⟧ (același format ca ingest-ul Deno), DOCX → text brut.
mkdir -p /work/text
N_PDF=0; N_DOCX=0; N_SARIT=0; MAX_FISIERE=300; MAX_MB=60
: > /work/INVENTAR.md
echo "# Inventar /data (generat de launcher, $STAMP)" >> /work/INVENTAR.md
echo "" >> /work/INVENTAR.md
echo "| fișier | MB | pagini | text |" >> /work/INVENTAR.md
echo "|---|---|---|---|" >> /work/INVENTAR.md
find /data -type f \( -iname '*.pdf' -o -iname '*.docx' \) | sort | head -n "$MAX_FISIERE" | while IFS= read -r f; do
  rel="${f#/data/}"; mb=$(( $(stat -c %s "$f") / 1048576 )); dest="/work/text/$rel.txt"; mkdir -p "$(dirname "$dest")"
  if [ "$mb" -gt "$MAX_MB" ]; then echo "| $rel | $mb | - | sărit (> ${MAX_MB} MB) |" >> /work/INVENTAR.md; continue; fi
  case "$f" in
    *.pdf|*.PDF)
      pg=$(pdfinfo "$f" 2>/dev/null | awk '/^Pages:/{print $2}'); [ -n "$pg" ] || pg='?'
      if pdftotext -layout "$f" - 2>/dev/null | awk 'BEGIN{p=1; printf "⟦PAGINA 1⟧\n"} { n=split($0, a, "\f"); for(i=1;i<=n;i++){ if(i>1){p++; printf "\n⟦PAGINA %d⟧\n", p} printf "%s", a[i] } printf "\n" }' > "$dest"; then
        car=$(wc -c < "$dest"); if [ "$car" -lt 200 ]; then echo "| $rel | $mb | $pg | fără text (scanat?) |" >> /work/INVENTAR.md; else echo "| $rel | $mb | $pg | text/$rel.txt |" >> /work/INVENTAR.md; fi
      else echo "| $rel | $mb | $pg | eroare pdftotext |" >> /work/INVENTAR.md; fi ;;
    *.docx|*.DOCX)
      if unzip -p "$f" word/document.xml 2>/dev/null | sed -e 's#</w:p>#\n#g' -e 's#<w:tab/>#\t#g' -e 's#<[^>]*>##g' > "$dest" && [ "$(wc -c < "$dest")" -gt 50 ]; then
        echo "| $rel | $mb | - | text/$rel.txt |" >> /work/INVENTAR.md; else echo "| $rel | $mb | - | docx necitibil |" >> /work/INVENTAR.md; fi ;;
  esac
done
find /data -type f ! \( -iname '*.pdf' -o -iname '*.docx' \) | sort | sed 's#^/data/#| #; s#$# | - | - | alt format (necitit) |#' >> /work/INVENTAR.md
TOTAL_FIS=$(find /data -type f | wc -l); TXT=$(find /work/text -type f | wc -l)
J "inventar: $TOTAL_FIS fișiere în /data, $TXT texte extrase (limită $MAX_FISIERE fișiere, $MAX_MB MB/fișier)"
[ "$TOTAL_FIS" -gt 0 ] || { J "STOP: /data e gol — LIC_FOLDER greșit? (docker creează un folder gol dacă ruta nu există)"; final 3 fara_fisiere; }
[ "$TXT" -gt 0 ] || { J "STOP: niciun text extras (doar scanări?)"; final 3 fara_text; }
if [ -d /context ] && [ -n "$(ls -A /context 2>/dev/null)" ]; then echo "" >> /work/INVENTAR.md; echo "Context suplimentar în /context: $(ls /context | tr '\n' ' ')" >> /work/INVENTAR.md; fi

# 3. rularea agentului: doar Read/Glob/Grep, fără prompturi (dontAsk = orice ar cere aprobare e refuzat), fără subagenți, fără sesiune pe disc.
PROMPT="$(cat "$PROMPT_F")

Directoare: textele extrase sunt în /work/text (oglinda lui /data, cu ⟦PAGINA n⟧), originalele în /data (doar citire), inventarul în /work/INVENTAR.md, contextul opțional în /context."
cd /work || final 2 fara_work
timeout -s TERM "$(( ${TASK_TIMEOUT_MIN:-15} * 60 ))" claude -p "$PROMPT" \
  --model "${TASK_MODEL:-sonnet}" --effort "${TASK_EFFORT:-medium}" \
  --tools "Read,Glob,Grep" \
  --disallowedTools "Bash,Edit,Write,MultiEdit,NotebookEdit,Agent,Task,WebFetch,WebSearch,TodoWrite" \
  --permission-mode dontAsk --max-turns "${TASK_MAX_TURNS:-20}" --no-session-persistence \
  --add-dir /data /context --output-format json > "$OUT_JSON" 2> "/out/${STAMP}_${TASK}.stderr"
COD=$?
# 4. raportul + jurnalul (fără secrete): tokeni, cost API echivalent (estimare client), ture, motiv oprire
if [ -s "$OUT_JSON" ]; then
  node -e '
    const fs=require("fs"); let j; try { j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch(e) { process.exit(3); }
    const r=(j.result||"").trim(); fs.writeFileSync(process.argv[2], r ? r+"\n" : "");
    const u=j.usage||{}; console.log(`turns=${j.num_turns??"?"} cost_usd_estimat=${j.total_cost_usd??"?"} in=${u.input_tokens??"?"} out=${u.output_tokens??"?"} cache_read=${u.cache_read_input_tokens??"?"} cache_create=${u.cache_creation_input_tokens??"?"} is_error=${j.is_error??"?"} subtype=${j.subtype??"?"} durata_api_ms=${j.duration_api_ms??"?"} denials=${(j.permission_denials||[]).length}`);
  ' "$OUT_JSON" "$OUT_MD" 2>/dev/null | while IFS= read -r l; do J "rezultat $l"; done
fi
[ "$COD" -eq 124 ] && final 124 timeout
[ "$COD" -ne 0 ] && final "$COD" claude_exit_$COD
[ -s "$OUT_MD" ] || final 5 raport_gol
grep -q "⟦PAGINA\|text/\|/data/" "$OUT_MD" || J "ATENȚIE: raportul nu citează niciun fișier/pagină — de tratat ca nevalidat"
final 0 ok
