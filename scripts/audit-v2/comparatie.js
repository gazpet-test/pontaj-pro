// P4: identitatea fișierului nu dovedește singură că pagina răspunde cerinței.
export function comparaGroundTruth(snapshot, groundTruth = []) {
  const files = snapshot.tabele.ofertare_pt_pachet_fisiere || []
  return snapshot.lant.rezultate.map(r => {
    const expected = groundTruth.find(g => g.cerinta_id === r.cerinta_id)
    const actual = files.filter(f => f.rol === 'depus_final')
    const artefacte = (expected?.artefacte || []).map(g => ({ asteptat: g,
      identic_in_manifest: actual.filter(f => f.sha256 === g.sha256),
      acelasi_nume_hash_diferit: actual.filter(f => f.nume === g.nume && f.sha256 !== g.sha256) }))
    return { cerinta_id: r.cerinta_id, verigi: r.verigi, ground_truth: expected || null, artefacte,
      stare: !expected || !artefacte.length ? 'UNDETERMINED'
        : expected.identitate_binara_obligatorie === true && artefacte.some(a => a.acelasi_nume_hash_diferit.length && !a.identic_in_manifest.length) ? 'CONFLICT'
          : artefacte.every(a => a.identic_in_manifest.length) ? 'PARTIAL' : 'UNDETERMINED',
      motiv: 'Comparație de identitate binară cu manifestul. CONFIRMED cere verificarea conținutului cerinței și a paginii din artefactul final; schema nu le leagă de versiunea fișierului.' }
  })
}
