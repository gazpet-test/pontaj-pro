// notify-whatsapp — RETRASĂ 03.11.2026 (decizia Razvan, chat): v29 se putea apela cu cheia anon publică, fără verificare de rol,
// cu service_role (force=true trimitea oricui; dry_run arăta telefonul + numele unui profil). Nu avea apelanți (un singur apel, 17.05).
// Codul v29 e păstrat în repo (supabase/functions/notify-whatsapp/_v29_retras.ts.txt). O versiune nouă trece prin review + poartă de rol.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  return new Response(JSON.stringify({ error: 'notify-whatsapp retrasă (03.11.2026)' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
});
