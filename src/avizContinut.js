// ===========================================================================
// Conținutul unui transport, așa cum îl arată AVIZUL de însoțire a mărfii (TKT-2026-0379 r2, L19).
// Oglinda, ca date, a tabelului „Conținut transport” din AvizInsotireMarfaModal (Logistica.jsx).
// Avizul nu se atinge în acest PR (limita din cerere), deci regula există de două ori: în JSX-ul avizului
// și aici. Paritatea e fixată de pvPredareAvizParitate.test.jsx, care compilează și randează JSX-ul REAL
// al avizului direct din Logistica.jsx pe același tabel de cazuri (fixe + aleatoare) și îl compară
// cu aceste rânduri și cu liniile PV-ului. O schimbare în aviz fără schimbarea de aici pică testul.
// Funcție pură: fără React, fără BD.
// ===========================================================================

// Câmpurile activului — aceeași listă ca selecția avizului (verificată textual în testul de paritate).
export const SELECT_ACTIV_AVIZ = 'id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu, regim_transport_special'
// Rândurile din logistica_transporturi_continut cu activul legat (identic cu .select-ul avizului).
export const SELECT_CONTINUT_AVIZ = `*, asset:logistica_active!active_id(${SELECT_ACTIV_AVIZ})`

// Câmpurile de identificare ale unui activ, în ordinea din aviz. Eticheta numărului de înmatriculare
// diferă între forma cu conținut multiplu („Nr. înmatr.”) și forma simplă („Nr. înmatriculare”), ca în aviz.
function identificareAviz(a, etichetaInmatr) {
  const r = []
  if (a.nr_inventar) r.push({ camp: 'nr_inventar', eticheta: 'Nr. inventar', valoare: a.nr_inventar })
  if (a.cod_intern) r.push({ camp: 'cod_intern', eticheta: 'Cod intern', valoare: a.cod_intern })
  if (a.nr_inmatriculare) r.push({ camp: 'nr_inmatriculare', eticheta: etichetaInmatr, valoare: a.nr_inmatriculare })
  if (a.serie_sasiu) r.push({ camp: 'serie_sasiu', eticheta: 'Serie șasiu', valoare: a.serie_sasiu })
  return r
}

const gol = (v) => v === null || v === undefined || v === false ? '' : String(v)

// Rândurile tabelului „Conținut transport” din aviz.
// Fiecare rând: { forma: 'multiplu' | 'simplu', key, nr, isUtilaj, denumire, descriere, regimSpecial, observatii,
//                 identificare: null (celula „—”) | [{ camp, eticheta, valoare }], um, cantitate, faraBunuri }
// `faraBunuri` = true doar pe rândul simplu care nu arată niciun bun (fără utilaj și fără descriere text):
// avizul îl afișează cu „—”, PV-ul refuză să se genereze.
export function randuriContinutAviz(transport, continutItems) {
  const T = transport || {}
  if (T.continut_multiplu && Array.isArray(continutItems) && continutItems.length > 0) {
    return continutItems.map((it, idx) => {
      const isUtilaj = it.tip === 'utilaj'
      const asset = it.asset
      return {
        forma: 'multiplu',
        key: it.id || idx,
        nr: idx + 1,
        isUtilaj,
        denumire: isUtilaj && asset ? `${asset.marca || ''} ${asset.model || ''}`.trim() : (it.denumire || '—'),
        descriere: '',
        regimSpecial: !!(isUtilaj && asset?.regim_transport_special),
        observatii: it.observatii || '',
        identificare: isUtilaj && asset ? identificareAviz(asset, 'Nr. înmatr.') : null,
        um: it.um || (isUtilaj ? 'buc' : '—'),
        cantitate: it.cantitate ? Number(it.cantitate).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) : (isUtilaj ? '1' : '—'),
        faraBunuri: false,
      }
    })
  }
  // Forma simplă (un singur rând): utilajul de pe transport sau descrierea text.
  const a = T.tip === 'utilaj' && T.activ_transportat ? T.activ_transportat : null
  const descriere = a ? '' : (T.continut_descriere || '—')
  return [{
    forma: 'simplu',
    key: 'simplu',
    nr: 1,
    isUtilaj: !!a,
    denumire: a ? `${gol(a.marca)} ${gol(a.model)}` : '',
    descriere,
    regimSpecial: !!a?.regim_transport_special,
    observatii: '',
    identificare: a ? identificareAviz(a, 'Nr. înmatriculare') : null,
    um: T.tip === 'utilaj' ? 'buc' : '—',
    cantitate: T.tip === 'utilaj' ? '1' : '—',
    faraBunuri: !a && !(T.continut_descriere && /\S/.test(String(T.continut_descriere))),
  }]
}
