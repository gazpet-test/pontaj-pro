// Redări PR4b r2 (Jak PR1120, pct. 7) — anularea unui import de utilizatori, FĂRĂ schemă nouă.
// Folosește ștergerea logică existentă a unui deținător (aceeași ca „Șterge” din Fișa parcelei: sters_la / sters_de / sters_motiv; politica
// red_detinatori_upd = admin / editor; trg_red_plic_identitate refuză un deținător dintr-un plic neexpediat), aplicată EXACT pe deținătorii care
// poartă marcajul lotului („; lot <uuid>” la finalul sursa_date) și nu au nicio urmă în aval. Ce NU garantează (spus și în document):
//  - verificarea urmelor și ștergerea sunt cereri separate (nu o tranzacție): o convocare / un răspuns / un PV apărut între ele nu e oprit;
//    îl prinde verificarea de după anulare („de verificat”). Cu poarta convocării utilizatorilor închisă, BD refuză oricum convocarea lor (RD006);
//  - „doar owner” e o regulă a ecranului; în BD orice admin / editor poate șterge logic un deținător (ca din Fișa parcelei);
//  - sters_de vine din client (ca în Fișa parcelei); autorul real al schimbării îl păstrează red_jurnal (auth.uid(), trigger).
import { citesteTot, loturi, scrisDeLot, SURSA_UTILIZATORI, CALITATE_UTILIZATOR } from './importUtilizatori.js'
import { LOT_CITIRE, PAGINA } from './importTgz.js'
import { celulaCsv } from './docx.js'

const BOM = String.fromCharCode(0xFEFF)
export const MOTIV_MINIM = 5
export const prefixMotiv = lotId => `Anulare import utilizatori (lot ${lotId}): `

// Urmele în aval care opresc anularea unui deținător (orice rând, inclusiv anulat / șters: urma există)
export const URME = [
  { tab: 'red_convocari', eticheta: 'are convocare (inclusiv anulată sau în plic)' },
  { tab: 'red_raspunsuri', eticheta: 'are răspuns' },
  { tab: 'red_procese_verbale', eticheta: 'are PV tip A' },
  { tab: 'red_mail_primite', eticheta: 'are e-mail primit legat de el' },
  { tab: 'red_mail_raspuns_sursa', eticheta: 'are răspuns din e-mail' },
  { tab: 'red_mail_adrese_propuse', eticheta: 'are adresă propusă din e-mail' },
  { tab: 'red_mail_mesaje', eticheta: 'are mesaj într-un lot de e-mail' },
]

/** Urmele în aval pentru deținătorii dați: Map id → [motive]. Orice citire eșuată = eroare (fail-closed, L18): nu se anulează nimic. */
export async function urmeInAval(supabase, detinatori, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  const motive = new Map(detinatori.map(d => [d.id, []]))
  const ids = detinatori.map(d => d.id)
  for (const u of URME) {
    for (const lotI of loturi(ids, lotCitire)) {
      let rows
      try { rows = await citesteTot(() => { let q = supabase.from(u.tab).select('id, detinator_id').in('detinator_id', lotI); if (u.tab === 'red_procese_verbale') q = q.eq('tip', 'A'); return q }, `urme: ${u.tab}`, pagina) }
      catch (e) { throw new Error(`Nu am putut verifica ${u.tab} (${e?.message || e}); anularea nu pornește`) }
      for (const r of rows) if (motive.has(r.detinator_id) && !motive.get(r.detinator_id).includes(u.eticheta)) motive.get(r.detinator_id).push(u.eticheta)
    }
  }
  // PV B pe parcelă, generat după import (poate cuprinde numele utilizatorului): orice PV B al parcelei creat la / după crearea deținătorului
  const peParcela = new Map()
  for (const d of detinatori) peParcela.set(d.parcela_id, [...(peParcela.get(d.parcela_id) || []), d])
  for (const lotI of loturi([...peParcela.keys()], lotCitire)) {
    let pv
    try { pv = await citesteTot(() => supabase.from('red_procese_verbale').select('id, parcela_id, created_at').in('parcela_id', lotI).eq('tip', 'B'), 'urme: PV B', pagina) }
    catch (e) { throw new Error(`Nu am putut verifica PV B (${e?.message || e}); anularea nu pornește`) }
    for (const p of pv) for (const d of peParcela.get(p.parcela_id) || []) {
      if (!d.created_at || !p.created_at || String(p.created_at) >= String(d.created_at)) { const m = motive.get(d.id); if (!m.includes('parcela are PV B generat după import')) m.push('parcela are PV B generat după import') }
    }
  }
  return motive
}

/**
 * pregatesteAnulare — previzualizarea anulării lotului (nimic scris).
 * → { anulabili: [{ id, parcela_id, id_parcela, nume, rand, updated_at }], raman: [{ ..., motive }], dejaAnulati: [...], faraMarcaj: [{ id, rand }] }
 */
export async function pregatesteAnulare(supabase, { proiectId, lotId }, { pagina = PAGINA, lotCitire = LOT_CITIRE } = {}) {
  if (!proiectId || !lotId) throw new Error('pregatesteAnulare: proiect / lot lipsă')
  const loturiU = await citesteTot(() => supabase.from('red_import_loturi').select('id, proiect_id, sursa, diferente').eq('proiect_id', proiectId).eq('sursa', SURSA_UTILIZATORI), 'citire loturi utilizatori', pagina)
  const lot = loturiU.find(l => l.id === lotId)
  if (!lot) throw new Error('Lotul nu e un import de utilizatori al acestui proiect')
  // momentul contactelor scrise de importuri (din evidența tuturor loturilor de utilizatori ale proiectului)
  const contactLa = new Map()
  for (const l of loturiU) {
    for (const s of l.diferente?.scrise || []) if (s?.id && s.contact_la) contactLa.set(s.id, s.contact_la)
    for (const [id, la] of Object.entries(l.diferente?.contacte_la || {})) if (la) contactLa.set(id, la)
  }
  const parcele = await citesteTot(() => supabase.from('red_parcele').select('id, id_parcela').eq('proiect_id', proiectId), 'citire parcele (anulare)', pagina)
  const idParcela = new Map(parcele.map(p => [p.id, p.id_parcela]))
  const cuMarcaj = []
  for (const lotI of loturi(parcele.map(p => p.id), lotCitire)) {
    const rows = await citesteTot(() => supabase.from('red_detinatori').select('id, parcela_id, nume, nume_normalizat, calitate, sursa_date, created_at, updated_at, sters_la, sters_motiv')
      .in('parcela_id', lotI).like('sursa_date', `%; lot ${lotId}`), 'citire deținători (anulare)', pagina)
    cuMarcaj.push(...rows.filter(d => scrisDeLot(d, lotId)))
  }
  const rand = d => { const m = /rândul (\d+)/.exec(String(d.sursa_date || '')); return m ? Number(m[1]) : null }
  const fisa = d => ({ id: d.id, parcela_id: d.parcela_id, id_parcela: idParcela.get(d.parcela_id) ?? null, nume: d.nume, rand: rand(d), created_at: d.created_at, updated_at: d.updated_at })
  const activi = cuMarcaj.filter(d => !d.sters_la)
  const dejaAnulati = cuMarcaj.filter(d => d.sters_la).map(d => ({ ...fisa(d), motive: [String(d.sters_motiv || '').startsWith(prefixMotiv(lotId)) ? 'anulat deja de o anulare a acestui lot' : 'șters deja (altă operație)'] }))
  const gasiti = new Set(cuMarcaj.map(d => d.id))
  const faraMarcaj = (lot.diferente?.scrise || []).filter(s => s?.id && !gasiti.has(s.id)).map(s => ({ id: s.id, rand: s.rand ?? null, motive: ['în evidența lotului, dar fără marcajul lotului în bază (modificat) — nu se atinge'] }))
  const contacte = new Map()
  for (const lotI of loturi(activi.map(d => d.id), lotCitire)) {
    for (const c of await citesteTot(() => supabase.from('red_detinatori_contact').select('detinator_id, updated_at').in('detinator_id', lotI), 'citire contacte (anulare)', pagina, 'detinator_id')) contacte.set(c.detinator_id, c.updated_at ?? null)
  }
  const urme = await urmeInAval(supabase, activi, { pagina, lotCitire })
  const anulabili = [], raman = []
  for (const d of activi) {
    const motive = [...(urme.get(d.id) || [])]
    if (d.calitate !== CALITATE_UTILIZATOR) motive.push(`calitatea e acum „${d.calitate}”`)
    // INSERT-ul pune created_at = updated_at (același now()); orice UPDATE ulterior (trigger) schimbă updated_at
    if (!d.updated_at || d.updated_at !== d.created_at) motive.push('modificat după import (nume, calitate sau alte câmpuri)')
    if (contacte.has(d.id) && (!contactLa.has(d.id) || contacte.get(d.id) !== contactLa.get(d.id))) motive.push('contactul a fost modificat sau adăugat în afara importului')
    if (motive.length) raman.push({ ...fisa(d), motive }); else anulabili.push(fisa(d))
  }
  return { lotId, anulabili, raman, dejaAnulati, faraMarcaj }
}

/**
 * executaAnulare — după confirmarea owner-ului. Reface previzualizarea (L03: se anulează doar ce era anulabil ȘI la previzualizarea arătată ȘI
 * acum, cu același updated_at), apoi pentru fiecare: UPDATE condiționat (CAS: sters_la IS NULL și updated_at neschimbat) cu motiv. 0 rânduri =
 * modificat între timp, rămâne. Eroare fără cod = necunoscut (se vede la reluare). Apoi verificarea urmelor apărute în timpul anulării și
 * consemnarea în lot (diferente.anulari[]). Reluabil: a doua rulare găsește rândurile deja anulate și nu mai scrie nimic.
 */
export async function executaAnulare(supabase, { proiectId, lotId, aratat, motiv, profilId }, { pagina = PAGINA, lotCitire = LOT_CITIRE, acum = () => new Date().toISOString() } = {}) {
  const m = String(motiv || '').trim()
  if (m.length < MOTIV_MINIM) throw new Error(`Motivul anulării e obligatoriu (minim ${MOTIV_MINIM} caractere)`)
  const proaspat = await pregatesteAnulare(supabase, { proiectId, lotId }, { pagina, lotCitire })
  const aratatIds = new Map((aratat?.anulabili || []).map(a => [a.id, a.updated_at]))
  const deAnulat = proaspat.anulabili.filter(a => aratatIds.get(a.id) === a.updated_at)
  const raman = [...proaspat.raman, ...proaspat.anulabili.filter(a => aratatIds.get(a.id) !== a.updated_at).map(a => ({ ...a, motive: ['nu era în previzualizarea confirmată (s-a schimbat între timp) — refaceți previzualizarea'] }))]
  const anulati = [], necunoscute = [], refuzate = []
  const sters_motiv = prefixMotiv(lotId) + m
  for (const a of deAnulat) {
    const { data, error } = await supabase.from('red_detinatori').update({ sters_la: acum(), sters_de: profilId || null, sters_motiv })
      .eq('id', a.id).is('sters_la', null).eq('updated_at', a.updated_at).select('id')
    if (error) { (error.code ? refuzate : necunoscute).push({ ...a, motive: [error.code ? `refuzat de bază: ${error.message || error.code}` : `rezultat necunoscut (${error.message || 'fără răspuns'}) — reluați anularea`] }); continue }
    if ((data || []).length === 1) anulati.push(a)
    else raman.push({ ...a, motive: ['modificat între timp (sau deja șters) — nu s-a anulat'] })
  }
  // urme apărute în timpul anulării (detecție): rândurile anulate care au acum convocare / răspuns / PV / e-mail
  let deVerificat = [], eroareVerificare = null
  try {
    const urme = await urmeInAval(supabase, anulati, { pagina, lotCitire })
    deVerificat = anulati.filter(a => (urme.get(a.id) || []).length).map(a => ({ ...a, motive: urme.get(a.id).map(x => `de verificat: ${x} (apărut în timpul anulării?)`) }))
  } catch (e) { eroareVerificare = String(e?.message || e).slice(0, 300) }
  const inregistrare = { la: acum(), de: profilId || null, motiv: m, anulati: anulati.map(a => a.id), raman: [...raman, ...refuzate].map(r => ({ id: r.id, motive: r.motive })),
    necunoscute: necunoscute.map(r => r.id), de_verificat: deVerificat.map(r => ({ id: r.id, motive: r.motive })), verificare: eroareVerificare ? `esuata: ${eroareVerificare}` : 'facuta' }
  let eroareLot = null
  try {
    const { data: lot, error } = await supabase.from('red_import_loturi').select('id, diferente').eq('id', lotId).maybeSingle()
    if (error) throw error
    const dif = lot?.diferente || {}
    const { error: e2 } = await supabase.from('red_import_loturi').update({ diferente: { ...dif, anulari: [...(dif.anulari || []), inregistrare] } }).eq('id', lotId)
    if (e2) throw e2
  } catch (e) { eroareLot = String(e?.message || e).slice(0, 300) }
  return { anulati, raman: [...raman, ...refuzate], necunoscute, deVerificat, dejaAnulati: proaspat.dejaAnulati, faraMarcaj: proaspat.faraMarcaj, eroareVerificare, eroareLot }
}

/** CSV-ul anulării (previzualizare sau rezultat): UTF-8 cu BOM, „;”, CRLF. Conține nume: se păstrează local, nu se urcă în repository / PR. */
export function csvAnulare(rezultat) {
  const linii = [['Rezultat', 'ID deținător', 'Parcelă (id)', 'Rând Excel', 'Nume', 'Motiv']]
  const adauga = (et, arr) => { for (const r of arr || []) linii.push([et, r.id, r.id_parcela ?? '', r.rand ?? '', r.nume ?? '', (r.motive || []).join('; ')]) }
  adauga(rezultat?.anulati ? 'anulat' : 'se poate anula', rezultat?.anulati ?? rezultat?.anulabili)
  adauga('rămâne', rezultat?.raman); adauga('necunoscut', rezultat?.necunoscute); adauga('de verificat', rezultat?.deVerificat)
  adauga('deja anulat / șters', rezultat?.dejaAnulati); adauga('fără marcaj', rezultat?.faraMarcaj)
  return BOM + linii.map(l => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n'
}
