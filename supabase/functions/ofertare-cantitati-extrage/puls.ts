// Răspuns „cu puls” pentru modul structurat (bug 20.10.2026: HTTP 504 „Request idle timeout limit (150s)” la gateway — o felie A cu
// escaladare Haiku → Sonnet poate depăși singură 150 s fără niciun octet trimis; datele rămâneau curate, dar clientul vedea eroare).
// Dacă lucrul se termină în `primaMs`, răspunsul e cel obișnuit (statusul real). Altfel se trimite IMEDIAT 200 cu un corp în flux:
// câte un spațiu alb la fiecare `pulsMs` (gateway-ul nu mai vede conexiunea inactivă), apoi JSON-ul final. Spațiile albe de la început
// sunt JSON valid (RFC 8259), deci `response.json()` / `supabase.functions.invoke` îl citesc neschimbat. Un status final ≠ 200 ajunge
// în corp ca `status_http` + `error` (clientul tratează `error` ca eroare). Limita de timp a worker-ului (wall clock) rămâne neschimbată.
export async function raspunsCuPuls(lucru: Promise<{ status: number; body: Record<string, unknown> }>, headers: Record<string, string>,
  { primaMs = 5000, pulsMs = 10000 }: { primaMs?: number; pulsMs?: number } = {}): Promise<Response> {
  // review Copilot #811 r1: Content-Type JSON impus aici (supabase-js alege parserul după el), indiferent ce headere primește
  headers = { ...headers, 'Content-Type': 'application/json' }
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers })
  const final = lucru.then((r) => ({ r }), (e) => ({ e }))
  let timer: ReturnType<typeof setTimeout> | undefined
  const repede = await Promise.race([final, new Promise<null>((ok) => { timer = setTimeout(() => ok(null), primaMs) })])
  clearTimeout(timer)
  if (repede) return 'r' in repede ? json(repede.r.body, repede.r.status) : json({ error: 'exceptie: ' + mesaj(repede.e) }, 500)
  const enc = new TextEncoder()
  let puls: ReturnType<typeof setInterval> | undefined
  const flux = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(' '))
      puls = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')) } catch { /* fluxul s-a închis */ } }, pulsMs)
      final.then((x) => {
        clearInterval(puls)
        const corp = 'r' in x
          ? (x.r.status === 200 ? x.r.body : { ...x.r.body, status_http: x.r.status, error: x.r.body.error ?? `status ${x.r.status}` })
          : { error: 'exceptie: ' + mesaj(x.e), status_http: 500 }
        try { ctrl.enqueue(enc.encode(JSON.stringify(corp))); ctrl.close() } catch { /* clientul a închis conexiunea */ }
      })
    },
    cancel() { clearInterval(puls) },
  })
  return new Response(flux, { status: 200, headers })
}
const mesaj = (e: unknown) => String((e as Error)?.message || e).slice(0, 300)
