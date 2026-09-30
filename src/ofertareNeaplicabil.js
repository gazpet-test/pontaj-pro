// J02b — „nu se aplică" / „exceptată" = închidere DOAR prin confirmare umană explicită.
// Regula (aceeași ca în BD, fn_ofertare_cerinta_na_confirmata):
//   * AI-ul (ofertare_acoperire.status='nu_se_aplica', ofertare_pt_legaturi fel='exceptat' sursa='ai')
//     scrie doar o PROPUNERE: se vede, dar cerința rămâne deschisă (nu e verde, nu scade contoarele de alarmă);
//   * se închide doar cu un rând valid în ofertare_cerinte_na_confirmari (actor, motiv, amprenta sursei, moment),
//     citit prin v_ofertare_cerinte_na_stare (coloana `valida` = amprenta confirmării == amprenta CURENTĂ a sursei);
//   * dacă textul cerinței / documentul sursă se schimbă, amprenta diferă ⇒ confirmarea devine `invalidata`
//     automat, fără nicio acțiune în UI;
//   * ofertare_cerinte.stare='nu_se_aplica' fără confirmare cu amprentă (decizii vechi) NU mai închide nimic.
// Fail-closed: fără rânduri de confirmare (view lipsă / eroare de citire) nimic nu e închis ca neaplicabil.

export const TIP_NSA = 'nu_se_aplica'
export const TIP_EXCEPTAT_PT = 'exceptat_pt'

// rânduri din v_ofertare_cerinte_na_stare → Map `${cerinta_id}:${tip}` → { valida, invalidata, ... }
// Dacă există mai multe confirmări nerevocate pe aceeași cheie, una validă câștigă.
export function indexConfirmari(randuri) {
  const m = new Map()
  for (const r of randuri || []) {
    if (!r || r.cerinta_id == null || !r.tip || r.revocata_la) continue
    const k = `${r.cerinta_id}:${r.tip}`
    const prev = m.get(k)
    if (!prev || (r.valida === true && prev.valida !== true)) m.set(k, r)
  }
  return m
}

// 'confirmata' | 'invalidata' | null  (null = nicio confirmare umană)
export function stareConfirmare(idx, cerintaId, tip) {
  const r = idx?.get?.(`${cerintaId}:${tip}`)
  if (!r) return null
  return r.valida === true ? 'confirmata' : 'invalidata'
}

export const eConfirmata = (idx, cerintaId, tip) => stareConfirmare(idx, cerintaId, tip) === 'confirmata'

// Matricea PT: cerința e „exceptată" (închisă) DOAR cu legătură 'exceptat' + confirmare umană validă.
// Returnează { inchisa, propunere, eticheta } pentru badge.
export function stareExceptarePT(legaturiCerinta, idx, cerintaId) {
  const exc = (legaturiCerinta || []).filter(l => l && l.fel === 'exceptat')
  if (!exc.length) return { inchisa: false, propunere: false, eticheta: null }
  const st = stareConfirmare(idx, cerintaId, TIP_EXCEPTAT_PT)
  if (st === 'confirmata') return { inchisa: true, propunere: false, eticheta: '⊘ exceptată (confirmat de om)' }
  const deAi = exc.some(l => l.sursa === 'ai')
  if (st === 'invalidata') return { inchisa: false, propunere: true, eticheta: '⚠ exceptare invalidată — sursa s-a schimbat, reconfirmă' }
  return { inchisa: false, propunere: true, eticheta: deAi ? '⊘ propunere AI: exceptată — neconfirmată' : '⊘ exceptată — lipsește confirmarea cu amprentă' }
}

// Registrul de acoperire: „scoasă" (nu se aplică) DOAR cu confirmare umană validă de tip nu_se_aplica.
export function nsaScoasa(cerinta, idx) {
  if (!cerinta) return false
  return eConfirmata(idx, cerinta.id, TIP_NSA)
}

// Contoarele din panoul de acoperire. `acoperiri`: { [cerinta_id]: rând ofertare_acoperire (primul/ales) }.
// Aceeași formă ca vechiul `stats` din OfertareLicitatii — plus nsaPropuseAI (propuneri AI neconfirmate).
export function statisticiAcoperire(cerinte, acoperiri, idx) {
  const stats = { acoperit: 0, acoperit_partener: 0, gol: 0, neevaluate: 0, goluriElim: 0, neevaluateElim: 0,
    nuSeAplica: 0, naElim: 0, nu_se_aplica: 0, reverif: 0, reverifElim: 0, nsaPropuseAI: 0, nsaInvalidate: 0 }
  for (const c of cerinte || []) {
    const a = acoperiri?.[c.id]
    const scoasa = nsaScoasa(c, idx)
    if (scoasa) stats.nuSeAplica++
    if (stareConfirmare(idx, c.id, TIP_NSA) === 'invalidata') stats.nsaInvalidate++
    if (!a) { stats.neevaluate++; if (c.tip === 'eliminatorie' && !scoasa) stats.neevaluateElim++; continue }
    const acop = a.status === 'acoperit' || a.status === 'acoperit_partener'
    if (acop && a.reverificare_ceruta) {
      stats.reverif++
      if (c.tip === 'eliminatorie' && !scoasa) stats.reverifElim++
      continue
    }
    stats[a.status] = (stats[a.status] || 0) + 1
    if (a.status === 'gol' && c.tip === 'eliminatorie' && !scoasa) stats.goluriElim++
    if (a.status === 'nu_se_aplica' && !scoasa) {
      stats.nsaPropuseAI++
      if (c.tip === 'eliminatorie') stats.naElim++
    }
  }
  stats.elimFaraDovada = stats.goluriElim + stats.neevaluateElim + stats.naElim + stats.reverifElim
  return stats
}
