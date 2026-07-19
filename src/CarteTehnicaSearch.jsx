// ===========================================================================
// 📖 CarteTehnicaSearch — căutare semantică în cartea tehnică a utilajului
// (spec_rag_carti_tehnice_utilaje) — pasaje din rag_utilaje via edge rag-utilaj
//   - căutare retrieval (gratuită, embeddings gte-small) → pasaje + pagina
//   - buton opțional „🤖 Explică" → răspuns AI (Haiku) pe baza pasajelor
//   - click pe sursă → deschide PDF-ul documentului (signed URL, documente-flota)
// Montat în fișa utilajului (Logistica.jsx, sub secțiunea 📎 Documente).
// ===========================================================================

import { useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E',
  logistica:'#E3B341',
}
const S = {
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:13, outline:'none', width:'100%' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, padding:'7px 14px', fontFamily:'inherit', fontSize:13, fontWeight:600, cursor:'pointer' },
}

const BUCKET = 'documente-flota'

// aceeași normalizare ca în edge rag-utilaj (slugKey) — cheia modelului
function modelKeyFor(activ) {
  const s = `${activ?.marca || ''} ${activ?.model || ''}`
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function CarteTehnicaSearch({ activ, showToast }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)   // null = nu s-a căutat încă
  const [aiAnswer, setAiAnswer] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [openingDocId, setOpeningDocId] = useState(null)

  const cauta = async (withAi = false) => {
    const q = query.trim()
    if (!q) { showToast('Scrie o întrebare sau un termen de căutat', 'warn'); return }
    if (withAi) setAiLoading(true); else { setLoading(true); setAiAnswer(null) }
    try {
      const { data, error } = await supabase.functions.invoke('rag-utilaj', {
        body: { action: 'ask', question: q, model_key: modelKeyFor(activ), ai: withAi },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setResults(data?.sources || [])
      if (withAi) setAiAnswer(data?.answer || 'Nu am putut genera un răspuns.')
    } catch (e) {
      showToast('Eroare căutare carte tehnică: ' + (e.message || e), 'error')
    } finally {
      setLoading(false); setAiLoading(false)
    }
  }

  const deschidePdf = async (documentId) => {
    if (!documentId) return
    setOpeningDocId(documentId)
    try {
      const { data: doc, error } = await supabase.from('logistica_documente')
        .select('pdf_url').eq('id', documentId).single()
      if (error) throw error
      if (!doc?.pdf_url) { showToast('Documentul nu mai are PDF atașat', 'warn'); return }
      const { data, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(doc.pdf_url, 60)
      if (sErr) throw sErr
      window.open(data.signedUrl, '_blank')
    } catch (e) {
      showToast('Eroare deschidere PDF: ' + (e.message || e), 'error')
    } finally {
      setOpeningDocId(null)
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: G.logistica, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
        📖 Cartea tehnică — caută în manual
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          style={S.input}
          placeholder="ex: presiune maximă, tip ulei, cuplu strângere, interval revizie..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') cauta(false) }}
        />
        <button onClick={() => cauta(false)} disabled={loading}
          style={{ ...S.btnS, color: G.logistica, borderColor: G.logistica + '55', whiteSpace: 'nowrap' }}>
          {loading ? '⏳' : '🔍 Caută'}
        </button>
        <button onClick={() => cauta(true)} disabled={aiLoading || loading}
          title="Răspuns AI pe baza pasajelor găsite"
          style={{ ...S.btnS, color: G.purple, borderColor: G.purple + '55', whiteSpace: 'nowrap' }}>
          {aiLoading ? '⏳' : '🤖 Explică'}
        </button>
      </div>

      {aiAnswer && (
        <div style={{ ...S.card, padding: '10px 14px', marginBottom: 10, borderLeft: `3px solid ${G.purple}`, fontSize: 13, color: G.text, whiteSpace: 'pre-wrap' }}>
          {aiAnswer}
        </div>
      )}

      {results !== null && results.length === 0 && (
        <div style={{ padding: '14px', background: G.bg, border: `1px dashed ${G.border2}`, borderRadius: 8, textAlign: 'center', color: G.dim, fontSize: 12 }}>
          Niciun pasaj găsit. Cartea tehnică a acestui model poate nu e indexată încă
          (se indexează automat după încărcarea în 📎 Documente, tip „Carte Tehnică").
        </div>
      )}

      {results !== null && results.length > 0 && (
        <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
          {results.map((r, idx) => (
            <div key={idx} style={{
              padding: '10px 14px', fontSize: 12,
              borderBottom: idx < results.length - 1 ? `1px solid ${G.border}` : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: G.blue, fontWeight: 600, fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.sursa} · {r.referinta}
                </span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{ color: G.dim, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round((r.similarity || 0) * 100)}%
                  </span>
                  <button
                    onClick={() => deschidePdf(r.document_id)}
                    disabled={openingDocId === r.document_id}
                    title="Deschide PDF-ul documentului"
                    style={{ ...S.btnS, padding: '2px 8px', fontSize: 11, color: G.blue }}>
                    {openingDocId === r.document_id ? '⏳' : '👁 PDF'}
                  </button>
                </span>
              </div>
              <div style={{ color: G.muted, lineHeight: 1.5 }}>{r.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
