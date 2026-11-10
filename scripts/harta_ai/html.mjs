// Harta AI — asamblarea fișierului HTML standalone (06.11.2026). Funcție pură, testată în html.test.mjs.
// Datele intră ca JSON într-un <script type="application/json">, codul ca un singur <script> (fără CDN, fără rețea).

// În interiorul unui <script>, „</script”, „<!--” și „<script” pot închide sau încurca elementul. În JSON, „<” devine \u003c
// (JSON.parse îl citește înapoi identic); în JS, „<” din „</script” și „<!--” devine \x3C (valid și în șiruri, și în
// expresii regulate, inclusiv cu flagul u; codul minificat nu are comentarii, deci tiparele apar doar în șiruri/regex).
// U+2028 / U+2029 se construiesc din cod, ca un editor să nu le transforme în caractere reale de sfârșit de rând.
const SEP_LINIE = new RegExp(String.fromCharCode(0x2028), 'g')
const SEP_PARAGRAF = new RegExp(String.fromCharCode(0x2029), 'g')
export function escapeazaJsonInScript(text) {
  return String(text).replace(/</g, '\\u003c').replace(SEP_LINIE, '\\u2028').replace(SEP_PARAGRAF, '\\u2029')
}
export function escapeazaJsInScript(cod) {
  return String(cod).replace(/<(\/script|!--)/gi, '\\x3C$1')
}
const escapeazaHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function construiesteHtml(date, codJs) {
  const titlu = date?.meta?.titlu || 'Harta AI'
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeazaHtml(titlu)}</title>
<style>
  html, body { margin: 0; background: #F1F5F9; color: #263642; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #harta-radacina { padding: 12px 16px 24px; max-width: 1800px; margin: 0 auto; }
  #harta-radacina h1 { font-size: 20px; margin: 4px 0 10px; }
</style>
</head>
<body>
<div id="harta-radacina"><noscript>Harta are nevoie de JavaScript.</noscript></div>
<script type="application/json" id="harta-date">${escapeazaJsonInScript(JSON.stringify(date))}</script>
<script>${escapeazaJsInScript(codJs)}</script>
</body>
</html>
`
}
