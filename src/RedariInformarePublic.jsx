// ═════════════════════════════════════════════════════════════════
// RedariInformarePublic.jsx — pagină PUBLICĂ (fără login): informarea GDPR completă, Lot 1.
// /redari/informare — juridic#031 „Canale”: QR-ul de pe hârtie duce la formularul de răspuns (/redari/raspuns/:token),
// care are sus linkul „Informarea privind datele personale” către această pagină; în mailuri apare și linkul direct.
// Pe hârtie, informarea completă e pe verso.
// Fără date individuale, fără urmărire externă, fără fonturi externe (NOTĂ INTERNĂ pct. 5 din Informare v3). Un singur apel la BD:
// fn_red_informare_publicata(cod) → da / nu (autorizarea Transgaz art. 28 încărcată, 20261130m); nu trimite și nu primește date personale.
// Cât nu e publicată (sau răspunsul lipsește / dă eroare) ori textul are câmpuri [ ], pagina arată banda „PROIECT” și noindex.
// ═════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { TEXT_INFORMARE_LOT1, VERSIUNE_INFORMARE_LOT1, COD_PROIECT_INFORMARE_LOT1, campuriNecompletate, informareGata, blocuri, segmenteInline } from './redari/informareGdpr.js'

// Aceeași paletă deschisă ca formularul public (se citește în soare, de pe telefon)
const G = { bg: '#f4f6f8', card: '#fff', text: '#1a2733', muted: '#5a6b7b', blue: '#0b4f8a', red: '#b42318', amber: '#8a5a00', border: '#cdd6de', galben: '#fff4cc' }

// Helper-ele stau în informareGdpr.js (aceeași definiție și pentru versoul DOCX); re-exportate pentru teste
export { campuriNecompletate, informareGata, blocuri }

// **x** → <strong>, [x] → evidențiat (câmp necompletat); restul text simplu (fără HTML din sursă)
function Inline({ text }) {
  return segmenteInline(text).map((p, i) => p.tip === 'bold' ? <strong key={i}>{p.text}</strong>
    : p.tip === 'camp' ? <mark key={i} style={{ background: G.galben, color: G.amber, padding: '0 3px', borderRadius: 3 }}>{p.text}</mark>
    : <span key={i}>{p.text}</span>)
}

export default function RedariInformarePublic() {
  // null = încă nu știm → tratat ca nepublicat (fail-closed)
  const [publicata, setPublicata] = useState(null)
  useEffect(() => {
    let viu = true
    // clientul se încarcă la cerere: modulul paginii rămâne importabil fără configurarea Supabase (testele citesc helper-ele de aici)
    import('./lib/supabase.js')
      .then(({ supabase }) => supabase.rpc('fn_red_informare_publicata', { p_cod: COD_PROIECT_INFORMARE_LOT1 }))
      .then(({ data, error }) => { if (viu) setPublicata(error || typeof data !== 'boolean' ? 'eroare' : data) }, () => { if (viu) setPublicata('eroare') })
    return () => { viu = false }
  }, [])
  const gata = informareGata(TEXT_INFORMARE_LOT1, publicata === true)
  useEffect(() => {
    document.title = 'Informare date personale — Lot 1 Prunișor–Jupa'
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'
    if (!gata) document.head.appendChild(meta)
    return () => { if (meta.parentNode) meta.parentNode.removeChild(meta) }
  }, [gata])

  return (
    <div style={{ minHeight: '100vh', background: G.bg, color: G.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', fontSize: 16, lineHeight: 1.55 }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 40px' }}>
        {!gata && <div role="status" style={{ background: G.galben, border: `1px solid ${G.amber}`, color: G.amber, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontWeight: 600 }}>
          PROIECT — text în curs de aprobare ({VERSIUNE_INFORMARE_LOT1}); nu este încă informarea oficială.
          {campuriNecompletate(TEXT_INFORMARE_LOT1).length > 0 && <span style={{ display: 'block', fontWeight: 400, fontSize: 14 }}>Câmpuri de completat: {campuriNecompletate(TEXT_INFORMARE_LOT1).length}</span>}
        </div>}
        <div style={{ background: G.card, border: `1px solid ${G.border}`, borderRadius: 10, padding: '18px 18px 8px' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 6px', color: G.blue }}>Informare privind folosirea datelor personale</h1>
          <div style={{ color: G.muted, fontSize: 14, marginBottom: 12 }}>Proprietarii de teren — Lot 1, conducta Prunișor – Orșova – Băile Herculane – Jupa</div>
          {!gata && <p style={{ margin: '8px 0', color: G.muted }}>{publicata === null ? 'Se încarcă…' : publicata === 'eroare' ? 'Pagina nu poate fi încărcată acum. Reîncercați peste câteva minute sau scrieți la redari@gazpet.ro.' : 'Informarea va fi publicată aici după aprobarea Transgaz. Pentru întrebări: redari@gazpet.ro.'}</p>}
          {gata && blocuri(TEXT_INFORMARE_LOT1).map((b, i) => b.tip === 'titlu' ? <h2 key={i} style={{ fontSize: 18, margin: '20px 0 6px', color: G.blue }}><Inline text={b.text} /></h2>
            : b.tip === 'lista' ? <ul key={i} style={{ margin: '6px 0 10px', paddingLeft: 22 }}>{b.elemente.map((e, j) => <li key={j} style={{ marginBottom: 4 }}><Inline text={e} /></li>)}</ul>
            : <p key={i} style={{ margin: '8px 0' }}><Inline text={b.text} /></p>)}
        </div>
        <div style={{ color: G.muted, fontSize: 13, marginTop: 14, textAlign: 'center' }}>GAZPET INSTAL S.R.L., în numele S.N.T.G.N. TRANSGAZ S.A. · redari@gazpet.ro</div>
      </div>
    </div>
  )
}
