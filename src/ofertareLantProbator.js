// R17: compunere pură, fără verdicte deduse din simpla existență a unei legături.
export const LIPSA = '— lipsă'
const egal = (a, b) => a != null && b != null && String(a) === String(b)
const lista = randuri => ({ randuri, lipsa: randuri.length ? null : LIPSA })

export function candidatiAcoperire(a) {
  const nume = r => r?.emp?.name || r?.ext?.nume
  const definitii = [
    ['autorizatie_id', 'Autorizație', a.autorizatie, r => [nume(r), r.tip?.denumire, r.numar_autorizatie]],
    ['doc_firma_id', 'Document firmă', a.doc_firma, r => [r.denumire || r.tip, r.numar_document]],
    ['partener_id', 'Partener', a.partener, r => [r.nume]],
    ['experienta_id', 'Experiență', a.experienta, r => [r.denumire, r.beneficiar]],
    ['recomandare_id', 'Recomandare', a.recomandare, r => [nume(r), r.rol, r.beneficiar]],
    ['document_personal_id', 'Studii / document personal', a.studii, r => [nume(r), r.tip?.denumire, r.numar_document, r.emitent]],
  ]
  return definitii.filter(([id, , r]) => a[id] != null || r).map(([id, tip, r, descrie]) => ({
    tip, id: a[id] ?? r?.id, descriere: r ? descrie(r).filter(Boolean).join(' · ') || LIPSA : LIPSA,
  }))
}

function acoperire(a) {
  const dovada = a.verificat_pe_scan === true && !a.reverificare_ceruta
  return { ...a, candidati: candidatiAcoperire(a), dovada,
    verificare: a.reverificare_ceruta ? 'De reverificat'
      : dovada ? 'Verificată de om' : 'Propusă de AI / neverificată pe scan' }
}

// Formatele scrise de ofertare-acoperire/core.ts și ofertare-clarificari-propune/core.ts.
// Nu folosim simplul #ID, nr_ordine, asemănarea semantică sau ID-ul unei cantități drept ID de cerință.
export function clarificareAtingeCerinta(q, c) {
  if (!c?.id) return false
  for (const text of [q.sursa, q.intrebare, q.raspuns]) {
    if (typeof text !== 'string') continue
    const normalizat = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const grupuri = normalizat.matchAll(/\bcerint(?:a|e|ele)\s*[:=]?\s*(#\d+\b(?:\s*,\s*#\d+\b)*)/g)
    for (const g of grupuri) {
      if ([...g[1].matchAll(/#(\d+)\b/g)].some(m => egal(m[1], c.id))) return true
    }
    // Referință explicită, inclusiv dacă a fost păstrată ca fragment JSON în text.
    for (const m of normalizat.matchAll(/\bcerinta_id["']?\s*[:=]\s*["']?(\d+)\b/g)) {
      if (egal(m[1], c.id)) return true
    }
  }
  return false
}

function versiuniDinManifest(sursa) {
  const m = /^capitole@\{(\d+:v\d+(?:,\d+:v\d+)*)?\}$/.exec(sursa || '')
  return new Map(m ? (m[1] || '').split(',').filter(Boolean).map(p => p.split(':v')) : [])
}

export function compuneLant({ cerinta = null, istoric = [], acoperiri = [], dovezi = [], legaturi = [],
  capitole = [], clarificari = [], pachet = null, documente = [], raspunsSet = null } = {}) {
  const doc = id => documente.find(d => egal(d.id, id)) || null
  const ls = legaturi.filter(l => egal(l.cerinta_id, cerinta?.id)).map(l => {
    const capitol = capitole.find(c => egal(c.id, l.capitol_id)) || null
    const versiuneVeche = l.verificat_la_versiunea != null && capitol?.versiune != null
      && !egal(l.verificat_la_versiunea, capitol.versiune)
    return { ...l, capitol, versiuneVeche }
  }).sort((a, b) => Number(b.stare === 'blocata') - Number(a.stare === 'blocata'))
  const legIds = new Set(ls.map(l => String(l.id)))
  const vechi = []
  const vazute = new Set([String(cerinta?.id)])
  const parcurge = id => {
    for (const c of istoric.filter(r => egal(r.inlocuita_de, id))) {
      if (vazute.has(String(c.id))) continue
      vazute.add(String(c.id))
      vechi.push({ ...c, document: doc(c.sursa_document_id),
        acopeririIstorice: (c.acoperire_snapshot?.acoperiri || []).map(acoperire) })
      parcurge(c.id)
    }
  }
  if (cerinta) parcurge(cerinta.id)
  const fisiere = (pachet?.fisiere || []).flatMap(f => {
    // Borderoul are aceeași amprentă, dar nu conține răspunsul din capitol.
    if (f.rol !== 'propunere_docx') return []
    const surse = versiuniDinManifest(f.sursa_versiune)
    const incluse = ls.filter(l => l.fel === 'capitol' && surse.has(String(l.capitol_id)))
      .map(l => ({ id: l.capitol_id, titlu: l.capitol?.titlu || LIPSA,
        versiuneSursa: surse.get(String(l.capitol_id)), versiuneCurenta: l.capitol?.versiune ?? null,
        depasit: l.capitol?.versiune != null && !egal(surse.get(String(l.capitol_id)), l.capitol.versiune) }))
    return incluse.length ? [{ ...f, capitole: incluse }] : []
  })
  const capitoleIncluse = new Set(fisiere.flatMap(f => f.capitole.map(c => String(c.id))))
  const capitoleFaraFisier = ls.filter(l => l.fel === 'capitol' && !capitoleIncluse.has(String(l.capitol_id)))
    .map(l => ({ id:l.capitol_id, titlu:l.capitol?.titlu || LIPSA }))
  return {
    cerinta: { rand: cerinta, document: doc(cerinta?.sursa_document_id), raspunsSet,
      lipsa: cerinta ? null : LIPSA, anterioare: lista(vechi) },
    acoperire: lista(acoperiri.filter(a => egal(a.cerinta_id, cerinta?.id)).map(acoperire)),
    dovezi: lista(dovezi.filter(d => legIds.has(String(d.legatura_id))).map(d => ({ ...d, document: doc(d.document_id) }))),
    legaturi: lista(ls),
    clarificari: { ...lista(clarificari.filter(q => clarificareAtingeCerinta(q, cerinta))),
      mesajLipsa: '— lipsă · nicio legătură înregistrată' },
    fisierFinal: { ...lista(fisiere), pachet, capitoleFaraFisier },
  }
}
