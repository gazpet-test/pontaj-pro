// ═══════════════════════════════════════════════════════════════════════════
// UscareMobil.jsx — „💨 Uscare conductă” din lansatorul de telefon (/m).
// Runda 2: la deschiderea lansatorului NU se enumeră nimic (butonul apare după arataButonUscare din uscareMobilLogica.js). Abia la APĂSARE,
//   useUscareMobil citește proiectele ACTIVE și le verifică pe fiecare la server cu aceeași funcție ca ecranul de uscare
//   (fn_executie_nod_drept(proiect, true)), cu stare de încărcare; niciun proiect cu drept = mesaj clar, nu ecran gol.
// UscareMobil: un singur proiect activ -> direct ecranul de uscare; mai multe -> lista scurtă, apoi ecranul. Ecranul e componenta
//   existentă UscareConducta (aceleași RPC-uri, aceeași logică), încadrată cu „← Înapoi”; nimic din logica ei nu se copiază aici.
// L24: fiecare încărcare are generația ei: un răspuns vechi nu se aplică ȘI paginarea / verificările se opresc (viu() înaintea fiecărei
//   pagini și a fiecărei verificări) la demontare sau la o reîncărcare nouă; la schimbarea proiectului UscareConducta se montează din nou
//   (key = proiectul), deci răspunsurile proiectului vechi nu ajung pe ecranul celui nou.
// L18: o verificare eșuată se arată („Reîncearcă”), nu devine „fără drept” și nici „are drept”.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import UscareConducta from './UscareConducta.jsx'
import { G, S } from './NodCuplareVizualizare.jsx'
import { RPC_DREPT_USCARE, PARALEL_DREPT, candidatiUscare, stareDinDrepturi, drumUscare, inParalel, etichetaProiect, paginiCatTimpViu } from './uscareMobilLogica.js'

const pagini = (client, viu, tabel, coloane, filtru = q => q) => paginiCatTimpViu((ultim, pas) => {
  let q = filtru(client.from(tabel).select(coloane)).order('id').limit(pas)
  if (ultim != null) q = q.gt('id', ultim)
  return q
}, viu)

export function useUscareMobil(client) {
  const [st, setSt] = useState({ stare: 'incarcare', proiecte: [] })
  const gen = useRef(0)
  const reincarca = useCallback(async () => {
    const g = ++gen.current
    const viu = () => g === gen.current
    setSt({ stare: 'incarcare', proiecte: [] })
    try {
      // RLS dă doar proiectele / uscările vizibile contului; doar proiectele ACTIVE (filtrul pe server, înaintea paginării);
      // dreptul de SCRIERE îl spune apoi serverul, pe fiecare proiect
      const [proiecte, deschise] = await Promise.all([
        pagini(client, viu, 'executie_proiecte', 'id, nume, cod_intern, activ', q => q.eq('activ', true)),
        pagini(client, viu, 'executie_uscari', 'id, proiect_id', q => q.eq('stare', 'deschisa')),
      ])
      if (!viu()) return
      const cand = candidatiUscare(proiecte, deschise)
      const rez = await inParalel(cand, PARALEL_DREPT, c => Promise.resolve(client.rpc(RPC_DREPT_USCARE, { p_proiect: c.id, p_scriere: true }))
        .then(r => ({ id: c.id, data: r?.data, error: r?.error || null }), e => ({ id: c.id, data: null, error: e || { message: 'eroare' } })), viu)
      if (!viu()) return
      setSt(stareDinDrepturi(cand, rez))
    } catch (e) {
      if (viu()) setSt({ stare: 'eroare', eroare: e?.message || String(e), proiecte: [] })
    }
  }, [client])
  useEffect(() => { reincarca(); return () => { gen.current += 1 } }, [reincarca])
  return { ...st, reincarca }
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const btnInapoi = { background: G.surface, border: `1px solid ${G.border}`, color: G.text, borderRadius: 10, width: 44, height: 44, fontSize: 18, cursor: 'pointer', flex: '0 0 auto' }

// Se montează abia la apăsarea butonului din lansator: atunci pornește enumerarea (useUscareMobil); la ieșire se demontează și o oprește.
export default function UscareMobil({ client, onBack, stocare }) {
  const st = useUscareMobil(client)
  const drum = drumUscare(st)
  const [ales, setAles] = useState(null)
  const [inFormular, setInFormular] = useState(false)
  const proiecte = st.stare === 'gata' ? st.proiecte : []
  // un singur proiect activ (listă completă) = direct pe el, fără listă; „Înapoi” din ecran duce atunci la lansator
  const directId = drum.tip === 'direct' ? drum.proiectId : null
  const idAles = directId ?? ales
  const proiect = idAles != null ? proiecte.find(p => p.id === idAles) || null : null

  if (proiect) {
    const inapoi = () => { if (directId == null) { setAles(null); setInFormular(false) } else onBack() }
    return (
      <div style={{ minHeight: '100vh', background: G.bg, fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 720, margin: '0 auto', padding: '12px 12px 0' }}>
          {/* cât e deschis un raport, ieșirea e „← Lista” din ecranul de uscare (întreabă la modificări nesalvate) */}
          {!inFormular && <button onClick={inapoi} aria-label="Înapoi" style={btnInapoi}>←</button>}
          <div style={{ minWidth: 0, fontSize: 13, color: G.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{etichetaProiect(proiect)}</div>
        </div>
        <UscareConducta key={proiect.id} proiectId={proiect.id} client={client} stocare={stocare} onFormular={setInFormular} />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: G.bg, padding: '20px 16px', maxWidth: 520, margin: '0 auto', fontFamily: FONT, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} aria-label="Înapoi" style={btnInapoi}>←</button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: G.text }}>💨 Uscare conductă</div>
          <div style={{ fontSize: 13, color: G.muted }}>Alege proiectul</div>
        </div>
      </div>
      {st.stare === 'incarcare' && <div role="status" style={{ color: G.dim, textAlign: 'center', padding: 30 }}>Se verifică proiectele pe care poți lucra…</div>}
      {st.stare === 'eroare' && (
        <div role="alert" style={{ background: G.surface, border: `1px solid ${G.red}`, borderRadius: 12, padding: 14, color: G.text, fontSize: 14 }}>
          Nu am putut verifica proiectele pe care poți lucra: {st.eroare}
          <div><button style={{ ...S.btn, marginTop: 10, minHeight: 44 }} onClick={st.reincarca}>Reîncearcă</button></div>
        </div>
      )}
      {st.stare === 'gata' && st.incomplet && (
        <div role="alert" style={{ background: G.surface, border: `1px solid ${G.yellow}`, borderRadius: 12, padding: 14, color: G.text, fontSize: 14, marginBottom: 12 }}>
          Dreptul nu s-a putut verifica pe {st.erori.length} {st.erori.length === 1 ? 'proiect' : 'proiecte'}: lista poate fi incompletă.
          <div><button style={{ ...S.btn, marginTop: 10, minHeight: 44 }} onClick={st.reincarca}>Reîncearcă</button></div>
        </div>
      )}
      {st.stare === 'gata' && !proiecte.length && (
        <div role="status" style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: 14, color: G.text, fontSize: 14 }}>
          {/* stareDinDrepturi: zero proiecte + vreo eroare = 'eroare' (L18), deci aici e un „nu” dovedit pe toate proiectele */}
          Nu ai drept de scriere pe niciun proiect activ de Execuție.
        </div>
      )}
      <div style={{ display: 'grid', gap: 10 }}>
        {proiecte.map(p => (
          <button key={p.id} onClick={() => setAles(p.id)} style={{
            background: G.surface, border: `1px solid ${G.border}`, borderLeft: `4px solid ${p.deschise ? G.yellow : p.activ ? G.blue : G.dim}`,
            borderRadius: 14, padding: '14px 14px', minHeight: 64, textAlign: 'left', color: G.text, fontFamily: 'inherit', cursor: 'pointer',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{etichetaProiect(p)}</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 4 }}>
              {p.activ ? 'Activ' : 'În arhivă'}
              {p.deschise > 0 && <span style={{ color: G.yellow, fontWeight: 700 }}> · {p.deschise} {p.deschise === 1 ? 'raport de uscare deschis' : 'rapoarte de uscare deschise'}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
