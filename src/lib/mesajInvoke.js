// Mesajul real al unei funcții Edge apelate cu supabase.functions.invoke. Un singur loc (25.09.2026):
// înainte existau două copii identice (OfertareLicitatii.jsx și ofertareExtragereCantitati.js).
//
// R4 risc 3: la non-2xx (403, 409, 500…) supabase-js dă FunctionsHttpError cu mesajul generic
// „Edge Function returned a non-2xx status code"; motivul real (ex. „o pornește doar ownerul sau
// responsabilul", „scrisă simultan din altă parte") e în corpul răspunsului: error.context (Response).
export async function mesajInvoke(error, data) {
  if (data?.error) return data.error
  const ctx = error?.context
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.clone().json(); if (j?.error || j?.message) return `${j.error || j.message}${ctx.status ? ` (HTTP ${ctx.status})` : ''}` } catch { /* nu e JSON */ }
    try { const t = await ctx.text(); if (t) return `${t.slice(0, 300)}${ctx.status ? ` (HTTP ${ctx.status})` : ''}` } catch { /* corp deja citit */ }
  }
  return error?.message || 'eroare necunoscută'
}

// Statusul HTTP al erorii (FunctionsHttpError are Response în context), sau null (eroare de rețea / 200 cu {error}).
export const statusInvoke = (error) => (typeof error?.context?.status === 'number' ? error.context.status : null)
