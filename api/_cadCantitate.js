// Rândul de cantitate scris din traseul măsurat într-un desen CAD (DXF / DWG convertit) — folosit de cad-parse.js.
//
// R5 (Copilot 25.09.2026): „extras" ≠ aprobat, iar aprobat = status 'validat' = bifa unui OM în 📋 Cantități.
// Până la 25.09 rândul intra direct cu status 'validat' — o măsurătoare automată trecea drept cantitate aprobată
// în poarta graficului și în poarta propunerii. Caz real: lic. 3, rândul 9 („Traseu rețea măsurat din desenul
// proiectantului", 35.620,59 m), 'validat' cu created_at = updated_at = 28.08.2026 20:19:55, fără niciun om.
// Acum: rând nou => 'extras'. Rând existent validat de om => nu i se schimbă nici cifra, nici statusul (ca în
// transferul din planșă, handler.ts: „dacă cineva a validat deja poziția, nu-i schimbăm decizia"); primește doar
// măsurătoarea nouă în cantitate_plansa și nota. Rând existent nevalidat => se actualizează, statusul rămâne al lui.
export function randCantitateCad({ licitatieId, denumire, c, notaAnaliza }, existent = null) {
  const l3d = c.lungime_3d_m
  const nota = `Măsurat din desen: ${l3d.toLocaleString('ro-RO')} m în spațiu, ${c.lungime_2d_m.toLocaleString('ro-RO')} m în plan` +
    `${c.numar > 1 ? `, pe ${c.numar} trasee` : ''}. ${notaAnaliza || ''}`.trim()
  if (!existent) {
    return { op: 'insert', rand: { licitatie_id: licitatieId, denumire, cantitate: l3d, um: 'm', cantitate_plansa: l3d, status: 'extras', diferenta_nota: nota } }
  }
  if (existent.status === 'validat') {
    const vechi = Number(existent.cantitate)
    const difera = existent.cantitate != null && Math.abs(vechi - l3d) >= 1
    return { op: 'update', id: existent.id, patch: { cantitate_plansa: l3d,
      diferenta_nota: nota + (difera ? ` Rândul e validat cu ${vechi.toLocaleString('ro-RO')} m — noua măsurătoare diferă, verifică.` : '') } }
  }
  return { op: 'update', id: existent.id, patch: { cantitate: l3d, um: 'm', cantitate_plansa: l3d, diferenta_nota: nota } }
}
