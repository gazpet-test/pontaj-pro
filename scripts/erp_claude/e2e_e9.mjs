// Proba E2E E9 după PR #907 (Copilot r2, condiția 2): contul claude@ (gestionar pe depozitul de TEST 12, proiect 37 TEST IZOMETRIE,
// acord Răzvan 01.11.2026) trimite prin izo-e3-ocr-local: (a) PDF cu o pagină -> 200 + cerere_id, apoi stare până la rezultat;
// (b) PDF cu 2 pagini -> 409 multipagina, fără upload; (c) fișier invalid -> 422 pdf_invalid. Identitate = utilizator obișnuit (anon + parolă).
// Rulare din rădăcina repo-ului: node scripts/erp_claude/e2e_e9.mjs <imagine.jpg>
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { jsPDF } from 'jspdf'

const SECRETE = 'C:/Users/Gazpet-Ai/.secrete'
const URL_ERP = 'https://dxczwkbciseqniprspcu.supabase.co'
const parola = readFileSync(`${SECRETE}/erp_claude_parola.txt`, 'utf8').split(/\r?\n/)[0]
const anon = readFileSync(`${SECRETE}/supabase_anon_key.txt`, 'utf8').trim()
const img = readFileSync(process.argv[2]).toString('base64')

const pdfDin = (pagini) => {
  const d = new jsPDF({ unit: 'pt', format: 'a4' })
  for (let i = 0; i < pagini; i++) { if (i) d.addPage(); d.addImage('data:image/jpeg;base64,' + img, 'JPEG', 20, 20, 555, 800) }
  return Buffer.from(d.output('arraybuffer')).toString('base64')
}
const sb = createClient(URL_ERP, anon, { auth: { persistSession: false } })
const { error: eLogin } = await sb.auth.signInWithPassword({ email: 'claude@gazpet.ro', password: parola })
if (eLogin) { console.log('LOGIN_ESUAT', eLogin.message); process.exit(1) }

async function cere(pdf_base64) {
  const { data, error } = await sb.functions.invoke('izo-e3-ocr-local', { body: { op: 'cere', pdf_base64, proiect_id: 37, depozit_id: 12, sablon: 'aviz_teava' } })
  let corp = data
  if (error?.context?.json) { try { corp = await error.context.json() } catch { /* */ } }
  return { status: error?.context?.status ?? 200, corp }
}
const caz = process.argv[3] || 'toate'
if (caz === 'toate' || caz === 'invalid') console.log('INVALID', JSON.stringify(await cere(Buffer.from('nu e PDF %%EOF').toString('base64'))))
if (caz === 'toate' || caz === 'multi') console.log('MULTI', JSON.stringify(await cere(pdfDin(2))))
if (caz === 'toate' || caz === 'mono') {
  const r = await cere(pdfDin(1)); console.log('MONO', JSON.stringify(r))
  const id = r.corp?.cerere_id
  if (id) {
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 5000))
      const { data, error } = await sb.functions.invoke('izo-e3-ocr-local', { body: { op: 'stare', cerere_id: id } })
      const st = data?.stare ?? (error ? 'eroare ' + (error.context?.status ?? '') : '?')
      console.log('STARE', i, st, data?.eroare ?? '')
      if (['gata', 'eroare', 'expirata', 'fallback'].includes(String(data?.stare))) { console.log('FINAL', JSON.stringify(data).slice(0, 600)); break }
    }
  }
}
await sb.auth.signOut()
