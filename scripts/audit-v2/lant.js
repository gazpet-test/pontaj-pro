import { compuneLant } from '../../src/ofertareLantProbator.js'

const eq = (a, b) => a != null && b != null && String(a) === String(b)
const hash = s => /^[0-9a-f]{64}$/.test(s || '')
const link = (stare, de_ce, randuri = []) => ({ stare, de_ce, randuri })
const all = (rows, predicate) => rows.length > 0 && rows.every(predicate)
export function compuneNouaVerigi(date = {}) {
  const r17 = compuneLant(date)
  const c = date.cerinta
  const erori = date.erori || {}
  const rezultat = {}
  const pune = (nr, keys, value) => {
    const esuate = keys.filter(k => erori[k])
    rezultat[nr] = esuate.length ? link('nedeterminat', `Citire eșuată: ${esuate.join(', ')}`, value.randuri) : value
  }
  const manifest = (date.manifest || []).filter(m => eq(m.document_id, c?.sursa_document_id))
  const sursa = r17.cerinta.document
  pune(1, ['cerinta', 'documente', 'manifest'], !c || !sursa || !manifest.length
    ? link('lipsa', 'Documentul sau manifestul de origine lipsește; nu deducem identitatea.', [c, sursa, ...manifest].filter(Boolean))
    : link(c.pasaj_verificat === true && c.sursa_pagina && c.sursa_pasaj && all(manifest, m => hash(m.sha256) && ['urcat', 'deja_in_platforma'].includes(m.stare)) ? 'ok' : 'propusa',
      'Proveniență înregistrată în BD; hashul este declarat în manifest, nu reverificat aici din Storage.', [c, sursa, ...manifest]))
  const puncte = (date.puncte || []).filter(p => eq(p.cerinta_id, c?.id))
  const chain = []; const seen = new Set(); let current = c; let broken = false
  while (current) {
    if (seen.has(String(current.id))) { broken = true; break }
    seen.add(String(current.id)); chain.push(current)
    if (!current.inlocuita_de) break
    current = (date.toateCerintele || date.istoric || []).find(x => eq(x.id, current.inlocuita_de))
    if (!current) broken = true
  }
  const raspunsLipsa = c?.raspuns_set_id && !date.raspunsSet
    || c?.raspuns_clarificare_id && !(date.clarificari || []).some(q => eq(q.id, c.raspuns_clarificare_id) && q.raspuns_document_id)
  pune(2, ['cerinta', 'istoric', 'raspunsSet', 'clarificari', 'puncte'], !c ? link('lipsa', 'Cerință absentă')
    : link(broken ? 'nedeterminat' : c.inlocuita_de ? 'veche' : raspunsLipsa ? 'lipsa'
      : puncte.some(p => p.rezolutie !== 'rezolvat' || !p.document_rezolutie_id || !p.rezolvat_de) ? 'propusa'
        : c.versiune == null ? 'nedeterminat' : 'ok',
    'Lanț inlocuita_de explicit; răspunsul nu echivalează cu rezoluția punctelor. Absența unei clarificări neînregistrate nu poate fi demonstrată.', [...chain, ...puncte, ...(date.raspunsSet ? [date.raspunsSet] : [])]))
  const ac = r17.acoperire.randuri; const alese = ac.filter(a => a.ales)
  const fisiereDovada = a => a.fisier_path || a.autorizatie?.fisier_path || a.doc_firma?.fisier_path || a.doc_firma?.pdf_path || a.studii?.fisier_path || a.recomandare?.fisier_path || a.experienta?.fisier_path
  pune(3, ['acoperire', 'fisiereAcoperire'], !ac.length ? link('lipsa', 'Nicio dovadă de acoperire')
    : link(alese.length > 1 ? 'nedeterminat' : alese.some(a => a.reverificare_ceruta || a.valabil_la_depunere === false) ? 'veche'
      : all(alese, a => a.ales_de && a.dovada && ['acoperit', 'acoperit_partener'].includes(a.status) && a.valabil_la_depunere === true && fisiereDovada(a)) ? 'ok' : 'propusa',
    'Necesare: alegere unică semnată, status acoperit/partener, scan verificat, valabilitate și fișier; AI nu aprobă.', ac))
  const ls = r17.legaturi.randuri
  pune(4, ['legaturi', 'capitole'], !ls.length ? link('lipsa', 'Niciun răspuns PT legat')
    : link(all(ls, l => l.fel === 'capitol' && l.capitol && l.locator_raspuns && l.stare === 'verificata' && l.confirmat_de && l.confirmat_la) ? 'ok' : 'propusa', 'Legăturile și capitolele din R17; atribuit nu înseamnă verificat.', ls))
  pune(5, ['legaturi', 'capitole'], !ls.length ? link('lipsa', 'Fără versiune verificată')
    : link(ls.some(l => l.versiuneVeche) ? 'veche' : all(ls, l => l.stare === 'verificata' && l.confirmat_de && l.confirmat_la && eq(l.verificat_la_versiunea, l.capitol?.versiune)) ? 'ok' : 'propusa',
    'Comparație exactă verificat_la_versiunea / capitol.versiune (R17).', ls))
  // Schema anexelor NU oferă un FK cerinta_id. Nu inventăm o asociere semantică prin ref.
  const anexe = date.anexe || []
  pune(6, ['anexe'], link(anexe.length ? 'nedeterminat' : 'lipsa', anexe.length
    ? 'Inventar de anexe pe licitație; legătura exactă cerință → anexă trebuie demonstrată separat.' : 'Niciun artefact așteptat înregistrat.', anexe))
  const ff = r17.fisierFinal.randuri
  pune(7, ['pachet', 'fisiere', 'legaturi', 'capitole'], !date.pachet || !ff.length ? link('lipsa', 'Niciun fișier final asociat capitolului (R17).')
    : link(ff.some(f => f.capitole.some(cap => cap.depasit)) ? 'veche'
      : r17.fisierFinal.capitoleFaraFisier.length ? 'lipsa' : 'nedeterminat',
    'Manifestul BD nu probează octeții existenți și hashul reverificat de server; necesar read-back independent.', ff))
  const dv = r17.dovezi.randuri
  pune(8, ['dovezi', 'fisiere'], link(dv.length ? 'nedeterminat' : 'lipsa',
    'Pagina globală nu are FK către versiunea/fișierul final. Locatorul declarat nu dovedește pagina artefactului depus.', dv))
  const fisiere = date.pachet?.fisiere || []
  const depuse = fisiere.filter(f => ['depus_final', 'dovada_seap'].includes(f.rol))
  const areDepunere = ['depus_final', 'dovada_seap'].every(rol => depuse.some(f => f.rol === rol && f.fisier_path && hash(f.sha256)))
  const depunereDeclarata = date.pachet?.stare === 'depus' && date.pachet?.depus_la && date.licitatie?.status === 'depusa'
  pune(9, ['licitatie', 'pachet', 'fisiere'], link(!areDepunere || !depunereDeclarata ? 'lipsa' : 'nedeterminat', !areDepunere
    ? 'Lipsesc depus_final sau dovada_seap cu fișier/hash, indiferent de statusul licitației.'
    : `Depunere declarată: licitație=${date.licitatie?.status || 'lipsă'}, pachet=${date.pachet?.stare || 'lipsă'}. Identitatea octeților/paginii față de cerință rămâne nedemonstrată.`, depuse))
  return { cerinta_id: c?.id ?? null, verigi: rezultat }
}

export function tabelText(rezultate) {
  return rezultate.flatMap(r => [`Cerința ${r.cerinta_id ?? 'lipsă'}`, ...Object.entries(r.verigi).map(([n, v]) => `${n}\t${v.stare}\t${v.de_ce}`)]).join('\n')
}
