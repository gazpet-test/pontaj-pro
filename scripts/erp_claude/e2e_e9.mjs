// Proba E2E E9 (după #907 + bucket-ul din 20261125a): contul claude@ (gestionar pe depozitul de TEST 12, proiect 37 TEST IZOMETRIE,
// acord Răzvan 01.11.2026, atribuirea expiră 08.11) trimite prin izo-e3-ocr-local și VERIFICĂ (review Jakarinos / Copilot #909, P2):
//   invalid -> 422 pdf_invalid · multi (2 pagini) -> 409 multipagina · mono -> 200 + cerere_id, apoi stare până la una terminală
//   (gata / esuata / expirata). Rezultatul OCR (gata vs esuata, ex. tabel_negasit) se raportează separat: proba e pe TRANSPORT
//   (admite -> upload -> confirmare -> preluare de worker); `esuata` după `preluata` = lanțul a mers, conținutul n-a fost citit.
// Identitate = utilizator obișnuit (cheia anon + parolă din fișier, nu se afișează). Cod de ieșire: 0 ok · 1 abatere / timeout / eroare.
// Rulare din rădăcina repo-ului: node scripts/erp_claude/e2e_e9.mjs <imagine.jpg> [toate|invalid|multi|mono]
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'

const SECRETE = 'C:/Users/Gazpet-Ai/.secrete'
const URL_ERP = 'https://dxczwkbciseqniprspcu.supabase.co'
const TERMINALE = ['gata', 'esuata', 'expirata']
const parola = readFileSync(`${SECRETE}/erp_claude_parola.txt`, 'utf8').split(/\r?\n/)[0]
const anon = readFileSync(`${SECRETE}/supabase_anon_key.txt`, 'utf8').trim()
const img = readFileSync(process.argv[2]).toString('base64')
const CAZURI = ['toate', 'invalid', 'multi', 'mono']
const caz = process.argv[3] || 'toate'
if (!CAZURI.includes(caz)) { console.log(`ABATERE caz necunoscut „${caz}” (permis: ${CAZURI.join(' | ')})`); process.exit(1) }
const TERMEN_MS = 200_000, APEL_MS = 30_000   // termen absolut pentru starea terminală; fiecare apel are propriul timeout
const cuTimeout = (p, ms, ce) => Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error(`timeout ${ce} ${ms} ms`)), ms))])
let abateri = 0
const verifica = (nume, ok, detaliu) => { console.log(`${ok ? 'OK ' : 'ABATERE'} ${nume} ${JSON.stringify(detaliu)}`); if (!ok) abateri++ }

const pdfDin = (pagini) => {
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  for (let i = 0; i < pagini; i++) { if (i) d.addPage(); d.addImage('data:image/jpeg;base64,' + img, 'JPEG', 20, 20, 555, 800) }
  return Buffer.from(d.output('arraybuffer')).toString('base64')
}
const sb = createClient(URL_ERP, anon, { auth: { persistSession: false } })

// status: codul HTTP real; null = eroare de transport (fără răspuns) — niciodată tratată ca succes
// timeout pe TOATĂ operația (invocare + citirea corpului de eroare); ms = min(APEL_MS, timpul rămas până la termen, dacă e dat)
async function apel(body, pana = Infinity) {
  const ms = Math.max(1, Math.min(APEL_MS, pana - Date.now()))
  const tot = (async () => {
    const { data, error } = await sb.functions.invoke('izo-e3-ocr-local', { body })
    if (!error) return { status: 200, corp: data }
    const status = error.context?.status ?? null
    let corp = null
    if (error.context?.json) { try { corp = await error.context.json() } catch { /* fără JSON */ } }
    return { status, corp, transport: status === null ? String(error.message || error) : undefined }
  })()
  try { return await cuTimeout(tot, ms, body.op) }
  catch (e) { return { status: null, corp: null, transport: String(e.message || e) } }
}
const cere = (pdf_base64) => apel({ op: 'cere', pdf_base64, proiect_id: 37, depozit_id: 12, sablon: 'aviz_teava' })

try {
  const { error: eLogin } = await cuTimeout(sb.auth.signInWithPassword({ email: 'claude@gazpet.ro', password: parola }), APEL_MS, 'login')
  if (eLogin) { console.log('ABATERE login', eLogin.message); abateri++ }
  else {
    if (caz === 'toate' || caz === 'invalid') {
      const r = await cere(Buffer.from('nu e PDF %%EOF').toString('base64'))
      verifica('invalid -> 422 pdf_invalid', r.status === 422 && r.corp?.eroare === 'pdf_invalid', r)
    }
    if (caz === 'toate' || caz === 'multi') {
      const r = await cere(pdfDin(2))
      verifica('multi -> 409 multipagina', r.status === 409 && r.corp?.eroare === 'multipagina', r)
    }
    if (caz === 'toate' || caz === 'mono') {
      const r = await cere(pdfDin(1))
      const id = r.corp?.cerere_id
      verifica('mono -> 200 + cerere_id', r.status === 200 && r.corp?.success === true && typeof id === 'string', r)
      if (id) {
        let final = null, vazutPreluata = false
        const limita = Date.now() + TERMEN_MS
        for (let i = 0; !final && Date.now() < limita; i++) {
          await new Promise((ok) => setTimeout(ok, Math.max(0, Math.min(5000, limita - Date.now()))))
          if (Date.now() >= limita) break
          const s = await apel({ op: 'stare', cerere_id: id }, limita)
          // răspuns primit după termen = nu contează (termen absolut)
          if (Date.now() > limita) break
          // orice răspuns de stare care nu e 200 + success = abatere (nu se interpretează mai departe)
          if (s.status !== 200 || s.corp?.success !== true) { verifica(`stare ${i}: 200 + success`, false, s); continue }
          const st = s.corp?.stare
          if (st === 'preluata') vazutPreluata = true
          console.log('STARE', i, s.status, st ?? '-', s.corp?.eroare ?? '')
          if (TERMINALE.includes(String(st))) final = s
        }
        verifica('mono: stare terminală în 200 s', !!final, final?.corp?.stare ?? 'timeout')
        if (final) {
          verifica('mono: transport până la worker (nu expirata)', final.corp.stare !== 'expirata', final.corp.stare)
          console.log(`REZULTAT_OCR ${final.corp.stare}${final.corp.eroare ? ' ' + final.corp.eroare : ''} (preluata văzută: ${vazutPreluata})`)
        }
      }
    }
  }
} finally {
  // timeout / eroare la închiderea sesiunii = abatere (sesiunea poate rămâne deschisă)
  try { const { error } = await cuTimeout(sb.auth.signOut(), APEL_MS, 'signOut'); if (error) throw error }
  catch (e) { console.log('ABATERE signOut', String(e.message || e)); abateri++ }
}
console.log(abateri ? `ESEC ${abateri} abateri` : 'TOATE OK')
process.exit(abateri ? 1 : 0)
