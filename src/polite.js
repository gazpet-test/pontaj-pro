// Polite CAR / GBE (20261205a) — ajutoare de UI. Logica pura stă în supabase/functions/_shared/polite.mjs (aceeași în edge-uri).
export * from '../supabase/functions/_shared/polite.mjs'
import { dataExpirarePropusa, MAX_PDF_BYTES } from '../supabase/functions/_shared/polite.mjs'

// fișierul ales → base64 (fără prefixul data:), cu limita edge-ului
export async function pdfInBase64(file) {
  if (!file) throw new Error('Alege un PDF.')
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF-ul are peste 8 MB. Păstrează doar paginile poliței.')
  const buf = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...buf.subarray(0, 5)) !== '%PDF-') throw new Error('Fișierul nu e PDF.')
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

// propunerea → câmpurile formularului (doar ce s-a citit cu dovadă); `propuse` = cheile completate din document, `nesigure` = cheile
// formularului pentru câmpurile respinse la citire. `chei` redenumește cheile canonice în cheile formularului (ex. valoare → valoare_lei).
export function formDinPropunere(propunere, tinta, chei = {}) {
  const b = formCanonic(propunere, tinta)
  const r = k => chei[k] || k
  const valori = Object.fromEntries(Object.entries(b.valori).map(([k, v]) => [r(k), v]))
  return { valori, propuse: b.propuse.map(r), nesigure: [...new Set(b.nesigure.map(r))] }
}
const NESIGUR_LA = tinta => ({
  suma: [tinta === 'act' ? 'valoare_noua_lei' : 'valoare'], valabila_pana_la: [tinta === 'act' ? 'data_expirare_noua' : 'data_expirare'],
  executie: ['executie_de_la', 'executie_pana_la'], garantie: ['garantie_de_la', 'garantie_pana_la'], contract_nr: ['contract_numar'],
})
function formCanonic(propunere, tinta) {
  const c = propunere?.campuri || {}
  const f = {}
  const pune = (k, v) => { if (v != null && v !== '') f[k] = v }
  if (tinta === 'act') {
    pune('nr_act', c.nr_act)
    pune('valoare_noua_lei', c.suma)
    pune('data_emitere', c.data_emitere)
    pune('data_expirare_noua', dataExpirarePropusa(c))
  } else {
    pune('tip', c.tip)
    pune('asigurator', c.asigurator)
    pune('nr_polita', c.nr_polita)
    pune('valoare', c.suma)
    pune('moneda', c.moneda)
    pune('data_emitere', c.data_emitere)
    pune('data_expirare', dataExpirarePropusa(c))
  }
  pune('executie_de_la', c.executie_de_la)
  pune('executie_pana_la', c.executie_pana_la)
  pune('garantie_de_la', c.garantie_de_la)
  pune('garantie_pana_la', c.garantie_pana_la)
  if (tinta === 'registru') { pune('lucrare', c.lucrare); pune('beneficiar', c.beneficiar); pune('contract_numar', c.contract_nr); pune('contract_data', c.contract_data) }
  const harta = NESIGUR_LA(tinta)
  return { valori: f, propuse: Object.keys(f), nesigure: (propunere?.dezacorduri || []).flatMap(d => harta[d.camp] || [d.camp]) }
}

// r2 (Jakarinos r1 P2-4): aplicarea unei propuneri NOI pe formular. Câmpurile completate de propunerea ANTERIOARĂ (alt PDF) revin întâi
// la valoarea inițială, apoi se pun valorile noii propuneri — nicio valoare din documentul vechi nu rămâne lângă documentul nou.
export function aplicaPropunere(form, initial, propuseVechi = [], valoriNoi = {}) {
  const f = { ...form }
  for (const k of propuseVechi) if (Object.prototype.hasOwnProperty.call(initial, k)) f[k] = initial[k]
  for (const [k, v] of Object.entries(valoriNoi || {})) f[k] = v == null ? '' : String(v)
  return f
}

// r4 (Jakarinos r3 P2-4): o eroare e „sigur eșec” doar dacă vine de la server cu cod (SQLSTATE de 5 caractere sau PGRSTnnn).
// Rețea / timeout / răspuns pierdut = necunoscut: nu se compensează (nu se șterge fișierul nou), se reîncarcă starea.
export function esecDeterminist(error) {
  return /^([0-9A-Z]{5}|PGRST[0-9]{3})$/.test(String(error?.code || ''))
}

// codurile din RPC / edge → mesaj pentru om (fără termeni tehnici)
const MESAJE = {
  fara_drept: 'Nu ai drept să salvezi polițe.',
  fara_drept_registru: 'Nu ai drept de scriere în Registrul garanțiilor.',
  propunere_deja_decisa: 'Documentul a fost deja confirmat sau respins (poate din altă fereastră). Reîncarcă.',
  propunere_inexistenta: 'Citirea documentului nu mai există. Reîncarcă și citește din nou.',
  registru_incomplet: 'Pentru Registru completează asigurătorul, nr. poliței și valoarea.',
  tip_fara_registru: 'Tipul „Altul” nu se poate trece în Registrul garanțiilor.',
  beneficiar_lipsa: 'Completează beneficiarul.',
  contract_inexistent: 'Alege contractul.',
  polita_inexistenta: 'Polița de bază nu mai există.',
  nr_act_invalid: 'Nr. actului trebuie să fie între 1 și 999.',
  tip_invalid: 'Alege tipul poliței.',
  moneda_invalida: 'Moneda trebuie să fie RON sau EUR.',
  expirare_inainte_de_emitere: 'Data expirării e înaintea datei emiterii.',
  provenienta_invalida: 'Salvarea a fost refuzată. Reîncarcă pagina.',
  plafon_depasit: 'S-a atins plafonul lunar pentru citirea documentelor. Completează manual.',
  citire_in_curs: 'Documentul se citește deja (altă fereastră). Așteaptă un minut și încearcă din nou.',
  citire_esuata: 'Documentul nu a putut fi citit. Completează manual.',
  nu_e_polita: 'Documentul nu pare a fi o poliță sau un act adițional. Completează manual.',
  pdf_invalid: 'PDF-ul nu poate fi deschis (protejat cu parolă sau deteriorat).',
  pdf_prea_mare: 'PDF-ul e prea mare pentru citire. Completează manual.',
  polita_incompleta_pentru_registru: 'Polița e legată în Registrul garanțiilor: trebuie să aibă asigurător, nr. și valoare (și după actele adiționale).',
  citire_goala: 'Din document nu s-a putut citi niciun câmp util. Completează manual.',
  raspuns_invalid: 'Documentul nu a putut fi citit. Completează manual.',
  fara_proba: 'Rulează întâi proba (cine ce ar primi).',
  proba_veche: 'Proba are mai mult de 24 de ore. Rulează-o din nou.',
  doar_owner: 'Doar owner-ul poate face asta.',
}
export function mesajEroare(e) {
  const t = String(e?.message || e?.eroare || e || '')
  const cod = Object.keys(MESAJE).find(k => t === k || t.startsWith(k + ':') || t.includes(`"${k}"`))
  if (cod) return MESAJE[cod]
  if (/^(data_invalida|camp_invalid|suma_invalida|camp_prea_lung):/.test(t)) return `Valoare invalidă la „${t.split(':')[1]}”. Verifică formatul (dată AAAA-LL-ZZ, sumă cu punct zecimal).`
  if (/23503/.test(t) || /garantii_contract_polita_fkey/.test(t)) return 'Polița are un rând legat în Registrul garanțiilor: nu se poate șterge de aici.'
  return t || 'Eroare necunoscută.'
}
