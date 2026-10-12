// contracte-pdf-link v1 (12.10.2026, varianta A aleasă de Răzvan) — link semnat de 5 minute către PDF-ul unui contract
// din contracte_terti, pentru serverul AI (revizuiri de contracte). DEPLOY cu verify_jwt = false: poarta e secretul din Vault.
//
// Cerere:  POST { "contract_id": <bigint> }  cu antetul x-contracte-secret = Vault CONTRACTE_PDF_LINK_SECRET (64 hex).
// Răspuns: 200 { url, expira_in_sec, contract_id } · 400 corp invalid · 401 neautorizat · 404 inexistent/fără PDF ·
//          422 cale invalidă · 429 limită depășită · 502 storage · 500 configurare/BD.
//
// FIȘA DE SECURITATE (CLAUDE.md pct. 7):
//  (a) conținut EXTERN citit: doar `contract_id` din corpul cererii (validat ca întreg pozitiv) și `pdf_path` din
//      contracte_terti (text scris de utilizatori, validat de caleSigura înainte de orice folosire). PDF-ul în sine NU e citit aici;
//  (b) scrie DOAR rânduri de jurnal în contracte_pdf_link_jurnal (prin fn_contracte_pdf_link_rezerva / _final); nu trimite mail, nu atinge
//      bani, drepturi sau alte tabele; emite doar URL semnat de citire, 300 s, pentru obiectul din bucketul contracte-terti;
//  (c) rulează cu service_role fiindcă apelantul NU are cont Supabase (poarta e secretul) iar bucketul e restrâns la owner +
//      can_manage_contracts (migrarea 20261024a); service_role e necesar pentru createSignedUrl și pentru RPC-ul cu EXECUTE doar service_role;
//  (d) cine o poate porni: doar cine deține CONTRACTE_PDF_LINK_SECRET (Vault, verificat în BD prin fn_verifica_secret, fail-closed);
//      verify_jwt = false NU înseamnă poartă deschisă, cheia anon nu trece de verificarea secretului;
//  (e) confirmare umană: nu e cazul (doar citire de document existent); limită 20/min și 300/24h pe TOATE cererile autorizate
//      (și cele pentru contracte inexistente sau fără PDF), fiecare în jurnal cu rezultatul final (emis / cale_invalida / eroare_semnare).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { caleSigura, esteApelContractePdf, valideazaCerere } from '../_shared/poartaContractePdf.ts'

const BUCKET = 'contracte-terti'
const VALABIL_SEC = 300

function raspuns(status: number, corp: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corp), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return raspuns(405, { error: 'Doar POST' })
  const url = Deno.env.get('SUPABASE_URL')
  const cheie = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !cheie) return raspuns(500, { error: 'Configurare lipsă' })
  const sb = createClient(url, cheie, { auth: { persistSession: false, autoRefreshToken: false } })

  if (!(await esteApelContractePdf(req, sb))) return raspuns(401, { error: 'Neautorizat' })

  let corp: unknown
  try { corp = await req.json() } catch (_) { return raspuns(400, { error: 'Corp JSON invalid' }) }
  const cerere = valideazaCerere(corp)
  if (!cerere.ok) return raspuns(400, { error: cerere.error })

  // limita + jurnalul + citirea pdf_path se fac atomic în BD (un rând de jurnal pentru fiecare cerere autorizată)
  const { data, error } = await sb.rpc('fn_contracte_pdf_link_rezerva', { p_contract_id: cerere.contractId })
  if (error || !data || typeof data !== 'object') return raspuns(500, { error: 'Eroare internă' })
  const r = data as { rezultat?: string; pdf_path?: string; jurnal_id?: number }
  if (r.rezultat === 'limita') return raspuns(429, { error: 'Limită de cereri depășită' })
  if (r.rezultat === 'inexistent' || r.rezultat === 'fara_pdf') return raspuns(404, { error: 'Contract inexistent sau fără PDF' })
  if (r.rezultat !== 'permis' || typeof r.jurnal_id !== 'number') return raspuns(500, { error: 'Eroare internă' })

  // rezultatul final intră în jurnal DUPĂ încercarea de semnare ('rezervat' → emis / cale_invalida / eroare_semnare)
  const final = async (rezultat: 'emis' | 'cale_invalida' | 'eroare_semnare') => {
    try { await sb.rpc('fn_contracte_pdf_link_final', { p_jurnal_id: r.jurnal_id, p_rezultat: rezultat }) } catch (_) { /* jurnalul rămâne 'rezervat' */ }
  }

  const cale = caleSigura(r.pdf_path)
  if (!cale) { await final('cale_invalida'); return raspuns(422, { error: 'Cale PDF invalidă' }) }
  const { data: semnat, error: eroareSemnare } = await sb.storage.from(BUCKET).createSignedUrl(cale, VALABIL_SEC)
  if (eroareSemnare || !semnat?.signedUrl) { await final('eroare_semnare'); return raspuns(502, { error: 'Fișierul nu a putut fi semnat' }) }

  await final('emis')
  return raspuns(200, { url: semnat.signedUrl, expira_in_sec: VALABIL_SEC, contract_id: cerere.contractId })
})
