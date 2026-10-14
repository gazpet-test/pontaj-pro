// ofertare-pdf-link v1 (D3b, 14.10.2026; spec docs/paw/PLAN_OCR_LOCAL_OFERTARE.md §6) — link semnat de 5 minute către PDF-ul unui
// document de licitație dintr-o rulare OCR locală preluată, pentru serverul AI. DEPLOY cu verify_jwt = false: poarta e secretul din Vault.
// Modelul: contracte-pdf-link (12.10.2026).
//
// Cerere:  POST { "rulare_id": <bigint>, "document_id": <bigint> } cu antetul x-ocr-local-secret = Vault OCR_LOCAL_SECRET (64 hex).
// Răspuns: 200 { url, expira_in_sec, document_id } · 400 corp invalid · 401 neautorizat · 403 document în afara rulării / neeligibil /
//          rularea nu e preluată · 422 cale invalidă · 429 limită · 502 storage · 500 configurare/BD.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN citit: doar rulare_id / document_id din corp (întregi pozitivi) și fisier_path din ofertare_documente_atribuire
//      (validat de caleSigura înainte de folosire). PDF-ul NU e citit aici;
//  (b) scrie DOAR rânduri de jurnal în ofertare_ocr_pdf_jurnal (fn_ofertare_ocr_pdf_rezerva / _final); emite doar un URL semnat de
//      citire, 300 s, în bucketul ofertare; nu trimite mail, nu atinge bani sau drepturi;
//  (c) service_role: apelantul n-are cont Supabase; createSignedUrl și RPC-urile (EXECUTE doar service_role) îl cer;
//  (d) cine pornește: doar deținătorul OCR_LOCAL_SECRET (fn_verifica_secret, fail closed); documentul trebuie să fie în rularea
//      preluată (pagini înghețate la cererea unui utilizator autorizat) și eligibil (poarta pe loturi) — verificat în BD;
//  (e) confirmare umană: pornirea rulării (fn_ofertare_ocr_cerere, poarta pe cheltuială); limită 30/min și 500/24h, jurnal complet.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { caleSigura } from '../_shared/poartaContractePdf.ts'
import { citesteCorp, esteApelOcrLocal, esteId, esteObiect, raspuns } from '../_shared/ocrLocal.ts'

const BUCKET = 'ofertare'
const VALABIL_SEC = 300

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const url = Deno.env.get('SUPABASE_URL'), cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !cheie) return raspuns(500, { error: 'Configurare lipsă' })
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })
  if (!(await esteApelOcrLocal(req, sb))) return raspuns(401, { error: 'Neautorizat' })

  const c = await citesteCorp(req, 4096)
  if (!c.ok) return raspuns(c.status, { error: c.error })
  const corp = c.corp
  if (!esteObiect(corp) || Object.keys(corp).sort().join(',') !== 'document_id,rulare_id' || !esteId(corp.rulare_id) || !esteId(corp.document_id)) {
    return raspuns(400, { error: 'Corp: exact {rulare_id, document_id}, întregi pozitivi' })
  }

  // limita + jurnalul + verificarea rulării / eligibilității + citirea căii, atomic în BD
  const { data, error } = await sb.rpc('fn_ofertare_ocr_pdf_rezerva', { p_rulare_id: corp.rulare_id, p_document_id: corp.document_id })
  if (error || !esteObiect(data)) return raspuns(500, { error: 'Eroare internă' })
  if (data.rezultat === 'limita') return raspuns(429, { error: 'Limită de cereri depășită' })
  if (data.rezultat === 'respins') return raspuns(403, { error: 'Document în afara rulării preluate sau neeligibil' })
  if (data.rezultat !== 'permis' || !esteId(data.jurnal_id)) return raspuns(500, { error: 'Eroare internă' })

  const final = async (rezultat: 'emis' | 'cale_invalida' | 'eroare_semnare'): Promise<boolean> => {
    try {
      const { data: ok, error: e } = await sb.rpc('fn_ofertare_ocr_pdf_final', { p_jurnal_id: data.jurnal_id, p_rezultat: rezultat })
      return !e && ok === true
    } catch (_) { return false }
  }
  const cale = caleSigura(data.fisier_path)
  if (!cale) { await final('cale_invalida'); return raspuns(422, { error: 'Cale PDF invalidă' }) }
  const { data: semnat, error: eSemn } = await sb.storage.from(BUCKET).createSignedUrl(cale, VALABIL_SEC)
  if (eSemn || !semnat?.signedUrl) { await final('eroare_semnare'); return raspuns(502, { error: 'Fișierul nu a putut fi semnat' }) }
  // URL-ul pleacă DOAR dacă emiterea a intrat în jurnal (ca la contracte-pdf-link, Copilot r2 P2-1)
  if (!(await final('emis'))) return raspuns(500, { error: 'Jurnalul nu a putut fi scris' })
  return raspuns(200, { url: semnat.signedUrl, expira_in_sec: VALABIL_SEC, document_id: corp.document_id })
})
