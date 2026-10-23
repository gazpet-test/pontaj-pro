export type VerdictPdf = 'mono' | 'multi' | 'invalid' | 'neverificabil'
// Worker separat: Promise.race în același isolate nu oprește un parser sincron.
export async function verificaPdf(bytes: Uint8Array): Promise<VerdictPdf> {
  const text = new TextDecoder('latin1')
  if (!text.decode(bytes.slice(0, 5)).startsWith('%PDF-') || !/%%EOF\s*$/.test(text.decode(bytes.slice(-1024)))) return 'invalid'
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined
  try {
    worker = new Worker(new URL('./pdfWorker.ts', import.meta.url).href, { type: 'module' })
    return await new Promise<VerdictPdf>(resolve => {
      timer = setTimeout(() => resolve('neverificabil'), 3000)
      worker!.onmessage = event => resolve(['mono', 'multi', 'invalid'].includes(event.data) ? event.data : 'neverificabil')
      worker!.onerror = event => { event.preventDefault(); resolve('neverificabil') }
      worker!.postMessage(bytes)
    })
  } catch { return 'neverificabil' }
  finally { clearTimeout(timer); worker?.terminate() }
}
