import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { userAutorizat } from './acces.ts'

// Domeniul gazpet.ro verificat in Resend din 29.07.2026
// v12 (08.08.2026): lista interna de destinatari MEREU inclusa (Marilena, Mirela, Razvan)
// v13 (13.10.2026, inventar securitate): sursa adusa in repo + POARTA — inainte orice detinator al cheii anon (publice)
//   putea trimite orice factura + PDF la orice adresa. Acum: JWT utilizator, owner SAU modul 'financiar'
//   (aceiasi oameni ca la bucketul facturi-emise). email_to validat ca lista de adrese.
const GAZPET_FROM = 'facturi@gazpet.ro'
const GAZPET_NAME = 'Gazpet Instal SRL'
const DESTINATARI_INTERNI = ['marilena.tudorache@gazpet.ro', 'mirela.popescu@gazpet.ro', 'razvan.trusu@gazpet.ro']
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' }
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i

const fmtLei = (v: number) =>
  new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
const raspuns = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    if (!(await userAutorizat(req, supabase, ['financiar']))) return raspuns({ error: 'neautorizat' }, 403)

    const { factura_id, email_to } = await req.json()
    if (!factura_id) return raspuns({ error: 'factura_id required' }, 400)
    const extra = email_to ? String(email_to).split(/[,;\s]+/).filter(Boolean) : []
    if (extra.length > 10 || extra.some(e => !EMAIL.test(e))) return raspuns({ error: 'email_to invalid' }, 400)

    const { data: f, error: fetchErr } = await supabase
      .from('facturi_emise')
      .select('*')
      .eq('id', factura_id)
      .single()
    if (fetchErr || !f) return raspuns({ error: 'Factura negasita' }, 404)

    // Destinatari: cel din formular/factura (daca exista) + lista interna, fara duplicate
    const dest = [...new Set([
      ...(extra.length ? extra : (f.email_destinatar ? String(f.email_destinatar).split(/[,;\s]+/).filter(Boolean) : [])),
      ...DESTINATARI_INTERNI,
    ])]

    // Obtine PDF din Storage daca exista
    let pdfAttachment = null
    if (f.pdf_path) {
      const { data: pdfBlob } = await supabase.storage
        .from('facturi-emise')
        .download(f.pdf_path)
      if (pdfBlob) {
        const buffer = await pdfBlob.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        pdfAttachment = {
          filename: `${f.nr_complet}.pdf`,
          content: btoa(binary),
        }
      }
    }

    const articoleHtml = (f.articole || []).map((a: any, i: number) => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px;text-align:center">${i + 1}</td>
        <td style="padding:8px">${a.denumire}</td>
        <td style="padding:8px;text-align:center">${a.um}</td>
        <td style="padding:8px;text-align:right">${a.cantitate}</td>
        <td style="padding:8px;text-align:right;font-family:monospace">${fmtLei(a.pret_unitar)} RON</td>
        <td style="padding:8px;text-align:right;font-family:monospace;font-weight:600">${fmtLei(a.valoare)} RON</td>
        <td style="padding:8px;text-align:center">${a.tva_pct}%</td>
      </tr>`).join('')

    const emailHtml = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;max-width:680px;margin:0 auto">
  <div style="background:#1C2128;padding:20px 30px;border-radius:8px 8px 0 0">
    <h2 style="color:#58A6FF;margin:0">Gazpet Instal SRL</h2>
    <p style="color:#8B949E;margin:4px 0 0">Factura electronica</p>
  </div>
  <div style="padding:24px 30px;border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px">
    <p>Stimate partener,</p>
    <p>Va transmitem alaturat <strong>factura ${f.nr_complet}</strong> din data <strong>${f.data}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:center;border-bottom:2px solid #ddd">Nr</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd">Denumire</th>
          <th style="padding:8px;border-bottom:2px solid #ddd">UM</th>
          <th style="padding:8px;border-bottom:2px solid #ddd">Cant.</th>
          <th style="padding:8px;border-bottom:2px solid #ddd">Pret unitar</th>
          <th style="padding:8px;border-bottom:2px solid #ddd">Valoare neta</th>
          <th style="padding:8px;border-bottom:2px solid #ddd">TVA</th>
        </tr>
      </thead>
      <tbody>${articoleHtml}</tbody>
    </table>
    <table style="width:300px;margin-left:auto;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 12px;color:#666">Valoare neta:</td><td style="padding:6px 12px;text-align:right;font-family:monospace">${fmtLei(f.valoare_neta)} RON</td></tr>
      <tr><td style="padding:6px 12px;color:#666">TVA ${f.tva_pct}%:</td><td style="padding:6px 12px;text-align:right;font-family:monospace">${fmtLei(f.tva)} RON</td></tr>
      <tr style="background:#f0f8ff"><td style="padding:10px 12px;font-weight:700">Total plata:</td><td style="padding:10px 12px;text-align:right;font-weight:800;font-size:16px;color:#1F6FEB;font-family:monospace">${fmtLei(f.total)} RON</td></tr>
    </table>
    <p style="margin-top:20px;font-size:13px;color:#666">Termen de plata: <strong>${f.termen_plata_zile || 30} zile</strong> de la data facturii. Mod plata: <strong>${f.mod_plata || 'OP'}</strong>.</p>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:12px;color:#888">S.C. GAZPET INSTAL SRL &middot; Ploiesti, Str. Fluturilor nr. 34, Prahova &middot; CIF: RO22029920<br>Cont: RO25 BTRL RONC RT0T 1801 7E01 &middot; Banca Transilvania Sucursala Ploiesti<br>Tel: 0244/435.005 &middot; office@gazpet.ro</p>
  </div>
</body></html>`

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      return raspuns({
        error: 'RESEND_API_KEY neconfigurat',
        hint: 'Seteaza RESEND_API_KEY in Supabase Dashboard -> Edge Functions -> Secrets'
      }, 503)
    }

    const emailPayload: any = {
      from: `${GAZPET_NAME} <${GAZPET_FROM}>`,
      to: dest,
      subject: `Factura ${f.nr_complet} — ${f.beneficiar_nume} — ${fmtLei(f.valoare_neta)} RON`,
      html: emailHtml,
    }
    if (pdfAttachment) emailPayload.attachments = [pdfAttachment]

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    })

    const resendData = await resendResp.json()

    if (resendResp.ok) {
      await supabase.from('facturi_emise').update({
        status: 'trimisa',
        email_destinatar: dest.join(', '),
        trimisa_email_la: new Date().toISOString(),
      }).eq('id', factura_id)
    }

    return raspuns({ ok: resendResp.ok, destinatari: dest, ...resendData }, resendResp.ok ? 200 : 400)
  } catch (e: any) {
    return raspuns({ error: e.message }, 500)
  }
})
