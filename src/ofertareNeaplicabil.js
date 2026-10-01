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

// J02b r6: UI-ul urmează comutatorul licitației (ofertare_licitatii.j02b_activ), exact ca poarta din BD:
//   j02b_activ === true  ⇒ semantica strictă de mai jos (doar confirmarea umană închide);
//   altfel (false, sau coloana lipsă = migrare neaplicată, când și BD-ul e pe regula veche) ⇒ semantica LEGACY,
//   textual cea dinainte de J02b: „nu se aplică” = cerinte.stare='nu_se_aplica', exceptarea PT = orice legătură 'exceptat'.
export const j02bActivPe = lic => lic?.j02b_activ === true

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
export function stareExceptarePT(legaturiCerinta, idx, cerintaId, j02bActiv = true) {
  const exc = (legaturiCerinta || []).filter(l => l && l.fel === 'exceptat')
  if (!exc.length) return { inchisa: false, propunere: false, eticheta: null }
  if (!j02bActiv) return { inchisa: true, propunere: false, eticheta: '⊘ exceptată' }   // legacy
  const st = stareConfirmare(idx, cerintaId, TIP_EXCEPTAT_PT)
  if (st === 'confirmata') return { inchisa: true, propunere: false, eticheta: '⊘ exceptată (confirmat de om)' }
  const deAi = exc.some(l => l.sursa === 'ai')
  if (st === 'invalidata') return { inchisa: false, propunere: true, eticheta: '⚠ exceptare invalidată — sursa s-a schimbat, reconfirmă' }
  return { inchisa: false, propunere: true, eticheta: deAi ? '⊘ propunere AI: exceptată — neconfirmată' : '⊘ exceptată — lipsește confirmarea cu amprentă' }
}

// J02b runda 2: confirmarea validează o PROPUNERE CONCRETĂ — cea mai nouă (id maxim), exact ca în BD
// (fn_ofertare_na_propunere_curenta). Exceptare PT: legătura fel='exceptat'; „nu se aplică”: rândul de acoperire
// status='nu_se_aplica'. null = nicio propunere (pentru „nu se aplică” = decizie umană fără propunere AI).
// Id-ul trimis la RPC e cel VĂZUT pe ecran: dacă între timp a apărut altă propunere, RPC-ul refuză (40001).
export function propunereCurenta(randuri, cerintaId, tip) {
  let max = null
  for (const r of randuri || []) {
    if (!r || r.cerinta_id !== cerintaId || r.id == null) continue
    const e = tip === TIP_EXCEPTAT_PT ? r.fel === 'exceptat' : tip === TIP_NSA ? r.status === 'nu_se_aplica' : false
    if (e && (max === null || r.id > max)) max = r.id
  }
  return max
}

// Registrul de acoperire: „scoasă" (nu se aplică) DOAR cu confirmare umană validă de tip nu_se_aplica.
export function nsaScoasa(cerinta, idx, j02bActiv = true) {
  if (!cerinta) return false
  if (!j02bActiv) return cerinta.stare === 'nu_se_aplica'   // legacy: decizia din registru, fără amprentă
  return eConfirmata(idx, cerinta.id, TIP_NSA)
}

// Contoarele din panoul de acoperire. `acoperiri`: { [cerinta_id]: rând ofertare_acoperire (primul/ales) }.
// Aceeași formă ca vechiul `stats` din OfertareLicitatii — plus nsaPropuseAI (propuneri AI neconfirmate).
export function statisticiAcoperire(cerinte, acoperiri, idx, j02bActiv = true) {
  const stats = { acoperit: 0, acoperit_partener: 0, gol: 0, neevaluate: 0, goluriElim: 0, neevaluateElim: 0,
    nuSeAplica: 0, naElim: 0, nu_se_aplica: 0, reverif: 0, reverifElim: 0, nsaPropuseAI: 0, nsaInvalidate: 0 }
  for (const c of cerinte || []) {
    const a = acoperiri?.[c.id]
    const scoasa = nsaScoasa(c, idx, j02bActiv)
    if (scoasa) stats.nuSeAplica++
    if (j02bActiv && stareConfirmare(idx, c.id, TIP_NSA) === 'invalidata') stats.nsaInvalidate++
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
      if (j02bActiv) stats.nsaPropuseAI++
      if (c.tip === 'eliminatorie') stats.naElim++
    }
  }
  stats.elimFaraDovada = stats.goluriElim + stats.neevaluateElim + stats.naElim + stats.reverifElim
  return stats
}

// J02b r5 (varianta B, 01.10.2026): comutator PE LICITAȚIE (ofertare_licitatii.j02b_activ), într-un singur sens.
// 'pornita' | 'oprita' | null (null = coloana lipsește: migrarea J02b nu e aplicată ⇒ nu afișăm nimic).
export function stareComutatorJ02b(lic) {
  if (!lic || typeof lic.j02b_activ !== 'boolean') return null
  return lic.j02b_activ ? 'pornita' : 'oprita'
}

// Butonul „Pornește J02b”: doar ownerul sau responsabilul licitației (aceeași poartă ca RPC-ul, care decide oricum).
export function poatePorniJ02b(lic, profile) {
  if (stareComutatorJ02b(lic) !== 'oprita' || !profile?.id) return false
  // r6: responsabilul care s-a numit singur (responsabil_setat_de = el) NU poate porni — RPC-ul refuză oricum
  return profile.is_owner === true || (lic.responsabil_id === profile.id && lic.responsabil_setat_de !== profile.id)
}

// Badge-ul „nu se aplică” din registrul de acoperire. Întoarce null (nimic) sau { fel, text, confirmabil }:
//   fel 'inchisa' (mov) | 'deschisa' (portocaliu, cu buton de confirmare doar când J02b e pornit).
export function badgeNsa(cerinta, acoperire, idx, j02bActiv = true) {
  if (!cerinta) return null
  if (!j02bActiv) return cerinta.stare === 'nu_se_aplica' ? { fel: 'inchisa', text: '⊘ NU SE APLICĂ', confirmabil: false } : null
  const st = stareConfirmare(idx, cerinta.id, TIP_NSA)
  if (st === 'confirmata') return { fel: 'inchisa', text: '⊘ NU SE APLICĂ ✓ om', confirmabil: false }
  if (st !== 'invalidata' && cerinta.stare !== 'nu_se_aplica' && acoperire?.status !== 'nu_se_aplica') return null
  const text = st === 'invalidata' ? '⚠ confirmare invalidată (sursa s-a schimbat)'
    : cerinta.stare === 'nu_se_aplica' ? '⊘ nu se aplică — fără confirmare cu amprentă' : '⊘ propunere AI — deschisă'
  return { fel: 'deschisa', text, confirmabil: true }
}
