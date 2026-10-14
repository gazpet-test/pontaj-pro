// Logică pură: lista „Izometrii generate” din CTC (exporturile din Execuție → Izometrie, read-only).

// Aprobat = pachetul are aprobarea Transgaz (aprobat_la sau status 'aprobat') sau e chiar PDF-ul de aprobare.
export function esteAprobat(doc, pachet) {
  return doc?.tip_document === 'pdf_aprobare_transgaz' || !!pachet?.aprobat_la || pachet?.status === 'aprobat'
}

// docs: executie_pachete_documente; pachete: executie_pachete_lansare (doar ale proiectului); tronsoane: executie_tronsoane.
// Întoarce rândurile ordonate: cod document, apoi revizie descrescător, apoi cel mai nou upload.
// `ultima` = cel mai nou fișier din cea mai nouă revizie, pe document și tip (centralizator / PDF aprobat).
export function construiesteIzometrii(docs, pachete, tronsoane) {
  const pm = new Map((pachete || []).map(p => [p.id, p]))
  const tm = new Map((tronsoane || []).map(t => [t.id, t]))
  const rows = (docs || []).filter(d => pm.has(d.pachet_id)).map(d => {
    const p = pm.get(d.pachet_id)
    const t = tm.get(p.tronson_id)
    return {
      id: d.id, fisier_nume: d.fisier_nume, fisier_path: d.fisier_path, tip_document: d.tip_document, uploadat_la: d.uploadat_la,
      cod: p.cod_document_full || `#${p.numar_document ?? p.id}`, revizie: p.revizie ?? 0,
      tronson: t ? [t.cod, t.denumire].filter(Boolean).join(' · ') : '—',
      aprobat: esteAprobat(d, p), ultima: false,
    }
  })
  rows.sort((a, b) => a.cod.localeCompare(b.cod, 'ro', { numeric: true }) || b.revizie - a.revizie
    || String(b.uploadat_la || '').localeCompare(String(a.uploadat_la || '')) || b.id - a.id)
  const vazut = new Set()
  for (const r of rows) { const k = r.cod + '|' + r.tip_document; if (!vazut.has(k)) { vazut.add(k); r.ultima = true } }
  return rows
}
