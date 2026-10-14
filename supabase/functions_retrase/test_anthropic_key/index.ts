// Diagnostic exact: apel cu prompt-ul EXACT folosit în bot principal pentru un activ real
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req: Request) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  const act = { marca: "JCB", model: "EXCAVATOR 220XL 4F", an_fabricatie: 2018, capacitate_motor: null, putere_kw: null, serie_sasiu: null };

  const descriere = [
    act.marca ? `Marcă: ${act.marca}` : null,
    act.model ? `Model: ${act.model}` : null,
    act.an_fabricatie ? `An: ${act.an_fabricatie}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Caută online specificații tehnice oficiale pentru acest utilaj/vehicul:\n\n${descriere}\n\nReturnează EXACT acest JSON (fără markdown, fără explicații suplimentare înainte sau după):\n{\n  "tip_carburant": "motorina" sau "benzina" sau "electric" sau "gpl" sau "hibrid" sau null,\n  "norma_consum": număr zecimal sau null (consum mediu, NU min sau max),\n  "unitate_norma": "l/h" sau "l/100km" sau "kWh/h" sau "kWh/100km" sau null,\n  "source_url": URL-ul EXACT de unde ai luat informația (obligatoriu dacă ai date),\n  "confidence": 0.0-1.0,\n  "motivare": "explicație scurtă în română, max 100 cuvinte"\n}\n\nREGULI STRICTE:\n- Utilaje grele (excavator, buldozer) → unitate "l/h"\n- Autoturisme/camioane → unitate "l/100km"\n- source_url OBLIGATORIU dacă confidence > 0.3`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    let fullText = "";
    for (const block of (data.content || [])) {
      if (block.type === "text" && block.text) fullText += block.text + "\n";
    }

    const cleaned = fullText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    let parsed = null;
    let parseError = null;
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); }
      catch (e: any) { parseError = e?.message; }
    }

    return new Response(JSON.stringify({
      status: res.status,
      stop_reason: data.stop_reason,
      fullText: fullText.slice(0, 2000),
      cleaned: cleaned.slice(0, 2000),
      jsonMatchFound: !!jsonMatch,
      parsed,
      parseError,
      usage: data.usage,
    }, null, 2), { headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ exception: e?.message }), { headers });
  }
});
