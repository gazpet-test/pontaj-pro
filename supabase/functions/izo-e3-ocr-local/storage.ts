import { EroareE3, MAX_PDF_E3 } from '../ocr-packing-list/avizE3.ts'
import type { Client } from './rpc.ts'
export const BUCKET = 'ocr-local-cereri'
// Cheia B1 include prefixul și ÎN INTERIORUL bucketului. Nicio cale din HTTP.
export function verificaCale(cale: string, id: string) {
  if (cale !== `${BUCKET}/${id}.pdf`) throw new EroareE3('cale_invalida', 503)
}
export async function pdfBase64(client: Client, cale: string, id: string): Promise<string> {
  verificaCale(cale, id)
  const { data, error } = await client.storage.from(BUCKET).download(cale)
  if (error || !data || data.size < 1 || data.size > MAX_PDF_E3) throw new EroareE3('storage_indisponibil', 503)
  const bytes = new Uint8Array(await data.arrayBuffer())
  let binar = ''
  for (let i = 0; i < bytes.length; i += 32768) binar += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binar)
}
export async function plafon(client: Client, proiect: number, rezervare: number | null) {
  // Fără cheltuială nu presupunem existența unui rând lunar.
  if (rezervare === null) return null
  const { data: r, error: re } = await client.from('ai_plafon_rezervari').select('luna').eq('id', rezervare).single()
  if (re || !r) throw new EroareE3('plafon_indisponibil', 503)
  const { data, error } = await client.from('ai_plafon_lunar').select('cheie,luna,plafon_usd,consumat_usd,rezervat_usd').eq('cheie', `izo_e3_ocr:${proiect}`).eq('luna', r.luna).maybeSingle()
  if (error) throw new EroareE3('plafon_indisponibil', 503)
  return data
}
