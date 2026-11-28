// DOAR pentru teste: client Supabase fals pentru „Izometrii generate” din CTC (tabele în memorie, RPC-ul fn_sud_drept,
// link-uri semnate din Storage) + fetch-ul care citește obiectele din Storage-ul fals. Fără rețea.
export function clientFals({ tabele = {}, obiecte = new Map(), drept = true, dreptEroare = null, semnatEroare = null } = {}) {
  const jurnal = { rpc: [], from: [], semnat: [], fetch: [] }
  const sb = {
    async rpc(nume, args) {
      jurnal.rpc.push([nume, args])
      if (dreptEroare) return { data: null, error: dreptEroare }
      return { data: drept, error: null }
    },
    from(t) {
      jurnal.from.push(t)
      const filtre = []
      let lim = Infinity
      const b = {
        select() { return b },
        order() { return b },
        eq(c, v) { filtre.push(x => x[c] === v); return b },
        in(c, l) { filtre.push(x => l.includes(x[c])); return b },
        limit(n) { lim = n; return b },
        then(res, rej) {
          const e = tabele[`${t}:eroare`]
          const r = e ? { data: null, error: e } : { data: (tabele[t] || []).filter(x => filtre.every(f => f(x))).slice(0, lim), error: null }
          return Promise.resolve(r).then(res, rej)
        },
      }
      return b
    },
    storage: {
      from: bucket => ({
        async createSignedUrl(p, _sec, opt) {
          jurnal.semnat.push([bucket, p, opt])
          if (semnatEroare) return { data: null, error: semnatEroare }
          return { data: { signedUrl: `https://fals/${bucket}/${p}` }, error: null }
        },
      }),
    },
  }
  const fetchFals = async url => {
    jurnal.fetch.push(url)
    const k = String(url).replace('https://fals/', '')
    if (!obiecte.has(k)) return { ok: false, status: 404 }
    const o = obiecte.get(k)
    return { ok: true, status: 200, arrayBuffer: async () => o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength) }
  }
  return { sb, jurnal, fetchFals }
}

// Un export IZO livrat separat pe pachetul 9 (proiectul 1), cum îl lasă executaExportIzo: rândul din istoric = Excel-ul,
// lista fișierelor în sud_exporturi.fotografie.fisiere, obiectele în executie-pachete-pdf. Conținutul fișierelor = octeți fixați aici.
export const DOSAR = '9/2026-11-27_u7_99_GAZ_X_DWG_00001_rev0_Centralizator'
export const XLSX = '99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx'
export const CONTINUT = {
  [XLSX]: new Uint8Array([80, 75, 3, 4, 1, 2, 3]),
  'buletine/PM_5_21.10.2026.pdf': new Uint8Array([37, 80, 68, 70, 45, 53]),
  'buletine/PA-UT_77_28.10.2026.pdf': new Uint8Array([37, 80, 68, 70, 45, 55, 55]),
}
export function fixturaSeparat() {
  const fisiere = Object.keys(CONTINUT).map(n => `${DOSAR}/${n}`)
  const docSeparat = { id: 61, pachet_id: 9, tip_document: 'centralizator', fisier_nume: XLSX, fisier_path: fisiere[0], uploadat_la: '2026-11-27T10:00:00Z' }
  const docVechi = { id: 40, pachet_id: 9, tip_document: 'centralizator', fisier_nume: 'vechi.xlsx', fisier_path: '9/2026-06-01_ab_vechi.xlsx', uploadat_la: '2026-06-01T10:00:00Z' }
  const tabele = {
    executie_pachete_lansare: [{ id: 9, proiect_id: 1, tronson_id: 5, cod_document_full: '99_GAZ_X_DWG_00001', revizie: 0, status: 'draft' }],
    executie_tronsoane: [{ id: 5, proiect_id: 1, cod: 'T1', denumire: 'Test' }],
    executie_pachete_documente: [docSeparat, docVechi],
    sud_exporturi: [{ id: 900, pachet_id: 9, tip: 'izo', fisier_path: fisiere[0], fotografie: { livrare: 'separat', fisiere } }],
  }
  const obiecte = new Map(Object.entries(CONTINUT).map(([n, b]) => [`executie-pachete-pdf/${DOSAR}/${n}`, b]))
  return { tabele, obiecte, fisiere, docSeparat, docVechi }
}
