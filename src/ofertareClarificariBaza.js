// ════════════════════════════════════════════════════════════════
// ofertareClarificariBaza.js — R5 RUNDA 9 (verificatorii rundei 8, M2 + ADDENDUM 3 Copilot): baza cifrelor din ciornele automate de clarificare.
//
// Principiul: o ciornă aprobată / editată de om NU se rescrie. Serverul păstrează AMPRENTA bazei de la generare (ofertare_clarificari.baza_generare)
// și o compară cu baza de ACUM (v_ofertare_clarificari_baza). Oriunde e afișată ciorna (❓ Clarificări, fișa licitației) și la EXPORT (adresa PDF),
// o bază schimbată spune „cifrele din ciornă s-au schimbat de la generare — de reverificat înainte de trimitere”, iar aprobarea / trimiterea cer
// reconfirmarea omului (verificată și în BACKEND: trg_ofertare_clarificari_baza refuză → de_trimis / → trimisa). View-ul necitit / eroare =
// „nu putem verifica” => ciorna automată NU intră în adresă (fail-closed), nu „ok”.
// Conflictele deschise NU blochează o clarificare (ADDENDUM 3, 2 — o întrebare despre ele se poate trimite): blochează doar o bază SCHIMBATĂ.
// Funcții PURE (fără React / Supabase) — src/ofertareRunda9.test.js.
// ════════════════════════════════════════════════════════════════
export const eCiornaAutomata = q => /^auto_planse_/.test(String(q?.cheie || ''))
export const MESAJ_SCHIMBATA = 'cifrele din ciornă s-au schimbat de la generare — de reverificat înainte de trimitere'

// q = rândul clarificării; bazaPeId = Map(id → rândul din v_ofertare_clarificari_baza); eroare = mesajul citirii view-ului (sau null)
// => { nivel: 'ok' | 'schimbata' | 'indisponibila' | 'luat_act' | 'nu_putem_verifica' | 'na', blocheaza, text, rand }
export function stareBazaCiorna(q, bazaPeId, eroare) {
  if (!eCiornaAutomata(q) || q?.status === 'retrasa') return { nivel: 'na', blocheaza: false, text: '' }
  if (eroare || !(bazaPeId instanceof Map)) return { nivel: 'nu_putem_verifica', blocheaza: true,
    text: `nu putem verifica baza cifrelor ciornei (${eroare || 'starea nu s-a citit'}) — nu înseamnă că e în regulă; ciorna nu intră în adresă până se poate verifica` }
  const r = bazaPeId.get(q.id)
  if (!r) return { nivel: 'nu_putem_verifica', blocheaza: true, text: 'nu putem verifica baza cifrelor ciornei (lipsește din control) — ciorna nu intră în adresă' }
  const marcaj = r.marcaj_planse === true
  if (r.stare === 'ok') return { nivel: 'ok', blocheaza: marcaj, text: marcaj ? 'planșele s-au schimbat după ce ciorna a fost editată / aprobată — de revizuit' : '', rand: r }
  if (r.stare === 'luat_act') return { nivel: 'luat_act', blocheaza: false, text: r.text || 'baza s-a schimbat după transmitere — luat act', rand: r }
  if (r.stare === 'schimbata' || r.stare === 'indisponibila') return { nivel: r.stare, blocheaza: true, text: r.text || MESAJ_SCHIMBATA, rand: r }
  return { nivel: 'nu_putem_verifica', blocheaza: true, text: `stare necunoscută a bazei („${r.stare}”) — nu putem verifica`, rand: r }
}

// diferențele față de baza anterioară (detalii.diferente din view) => rânduri de text pentru om
const fmtC = v => (v == null || v === '' ? 'fără cantitate' : `${Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 6 })}`)
const descr = x => `#${x?.id} „${String(x?.d || '').slice(0, 60)}” ${fmtC(x?.c)} ${x?.um || '(fără unitate)'}, ${x?.s || '—'}`
export function textDiferente(detalii) {
  const d = detalii?.diferente
  if (!d || typeof d !== 'object') return []
  const out = []
  for (const x of d.adaugate || []) out.push(`＋ apărut: ${descr(x)}`)
  for (const x of d.scoase || []) out.push(`− dispărut (șters / mutat / altă categorie): ${descr(x)}`)
  for (const m of d.modificate || []) {
    const a = m?.inainte || {}, b = m?.acum || {}
    const ce = [
      String(a.c) !== String(b.c) ? `cantitate ${fmtC(a.c)} → ${fmtC(b.c)}` : '',
      a.um !== b.um ? `unitate ${a.um || '—'} → ${b.um || '—'}` : '',
      a.s !== b.s ? `status ${a.s || '—'} → ${b.s || '—'}` : '',
      a.d !== b.d ? `denumire „${String(a.d || '').slice(0, 40)}” → „${String(b.d || '').slice(0, 40)}”` : '',
      a.o !== b.o ? `obiect „${a.o || '—'}” → „${b.o || '—'}”` : '',
    ].filter(Boolean)
    out.push(`≠ #${m?.id}: ${ce.length ? ce.join('; ') : 'sursă / categorie schimbată'}`)
  }
  const rest = (Number(d.n_adaugate) || 0) + (Number(d.n_scoase) || 0) + (Number(d.n_modificate) || 0) - out.length
  if (rest > 0) out.push(`… încă ${rest} diferențe`)
  return out
}

// EXPORTUL (adresa PDF): din clarificările „de trimis”, cele care intră — verificat pe starea citită CHIAR ÎNAINTE de generare (backend)
// => { incluse, excluse: [{ q, motiv }] }
export function deExportat(clar, bazaRanduri, eroare) {
  const peId = eroare ? null : new Map((bazaRanduri || []).map(r => [r.id, r]))
  const incluse = [], excluse = []
  for (const q of clar || []) {
    if (q?.status !== 'de_trimis' || !String(q?.intrebare || '').trim()) continue
    const revizie = String(q?.sursa || '').split(',').slice(1).map(t => t.trim()).filter(t => /^revizie_[a-z0-9_]+$/i.test(t))
    if (revizie.length) { excluse.push({ q, motiv: `necesită revizie (${revizie.join(', ')})` }); continue }
    const st = stareBazaCiorna(q, peId, eroare)
    if (st.blocheaza) { excluse.push({ q, motiv: st.text }); continue }
    incluse.push(q)
  }
  return { incluse, excluse }
}
