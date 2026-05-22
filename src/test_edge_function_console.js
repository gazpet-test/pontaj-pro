// ════════════════════════════════════════════════════════════════════════════
// TEST E1+E1.5 Edge Function `process_carte_service_ai` v2 (cu vision)
// ════════════════════════════════════════════════════════════════════════════
// CUM SE FOLOSEȘTE:
// 1. Deschide aplicația în browser (pontaj-pro-sooty.vercel.app)
// 2. Loghează-te ca Razvan (sau orice user is_owner)
// 3. F12 → Console
// 4. Paste TOT codul de mai jos
// 5. Apasă Enter
// 6. Așteaptă ~10-30 sec → vezi rezultatul în consolă
//
// OPȚIONAL pentru testul VISION cu PDF/poză real - vezi instrucțiuni la final.
// ════════════════════════════════════════════════════════════════════════════

window.testProcessCarteServiceAi = async function(opts) {
  opts = opts || {}
  const includeVision = opts.includeVision || false
  const visionFile = opts.visionFile || null
  
  const sb = window.supabase || (await import('/src/lib/supabase.js')).supabase
  if (!sb) { console.error('❌ Supabase client nu e disponibil global.'); return }
  
  const { data: { session } } = await sb.auth.getSession()
  if (!session) { console.error('❌ Nu ești logat.'); return }
  
  console.log(`🚀 Test pornit pentru ${session.user.email}`)
  
  const files = [
    {
      file_id: 'test-A-cache-hit',
      filename: 'TEST_A_STIL.xlsx',
      utilaj_raw: { denumire: 'MOTOSTIVUITOR STIL 40 3TO', model: 'STIL 40' },
      interventii: [{
        tip: 'mentenanta', data_fisei: '2025-09-15',
        locatie: 'MEHEDINTI OS GAZPET',
        ore_intrare: 1200, urm_ore: 1500,
        piese: [{ denumire: 'Filtru Aer', cantitate: '1buc' }],
        obs: 'Test cache hit',
      }]
    },
    {
      file_id: 'test-B-nr-inmat',
      filename: 'TEST_B_DOOSAN.xlsx',
      utilaj_raw: { denumire: 'EXCAVATOR DOOSAN DX225 UT 1250', model: 'DX225', nr_inmat: 'UT 1250' },
      interventii: [{
        tip: 'reparatie', data_fisei: '2025-10-20',
        ore_intrare: 8500,
        piese: [{ denumire: 'Cilindru hidraulic brat', cantitate: '1buc' }],
        obs: 'Test nr_inmat',
      }]
    },
    {
      file_id: 'test-C-ai-resolved',
      filename: 'TEST_C_AI_FUZZY.xlsx',
      utilaj_raw: { denumire: 'EXCAVATOR Doosan DX 225 an 2013', model: 'DX 225' },
      interventii: [{
        tip: 'mentenanta', data_fisei: '2025-11-05',
        piese: [{ denumire: 'Ulei motor', cantitate: '20L' }],
        obs: 'Test AI fuzzy match',
      }]
    },
    {
      file_id: 'test-D-unmatched',
      filename: 'TEST_D_INEXISTENT.xlsx',
      utilaj_raw: { denumire: 'TRACTOR FERMA XYZBLABLA-9999', model: 'XYZ-9999', nr_inmat: 'AB 99 ZZZ' },
      interventii: [{ tip: 'mentenanta', data_fisei: '2025-12-01', piese: [], obs: 'Test unmatched' }]
    },
  ]
  
  if (includeVision && visionFile) {
    console.log(`📷 Adaug fișier vision: ${visionFile.name} (${(visionFile.size / 1024).toFixed(0)} KB)`)
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(reader.result.split(',')[1])
      reader.onerror = rej
      reader.readAsDataURL(visionFile)
    })
    let sourceType = visionFile.type
    const valid = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!valid.includes(sourceType)) {
      console.warn(`⚠️ Tip fișier necunoscut: ${sourceType}. Încerc image/jpeg`)
      sourceType = 'image/jpeg'
    }
    files.push({
      file_id: 'test-E-vision',
      filename: visionFile.name,
      source_type: sourceType,
      source_data: base64,
    })
  }
  
  console.log(`📦 Trimit ${files.length} fișiere...`)
  const tStart = performance.now()
  
  try {
    const { data, error } = await sb.functions.invoke('process_carte_service_ai', {
      body: { request_id: crypto.randomUUID(), files },
    })
    const elapsed = Math.round(performance.now() - tStart)
    
    if (error) { console.error(`❌ Eroare în ${elapsed}ms:`, error); return }
    
    console.log(`✅ Răspuns primit în ${elapsed}ms`)
    console.log('━'.repeat(60))
    console.log('📊 STATS:')
    console.table(data.stats)
    console.log('━'.repeat(60))
    
    data.results.forEach((r) => {
      const icon = r.status === 'matched' ? '✅' : '❌'
      const modeIcon = r.mode === 'vision' ? '📷' : '📄'
      console.log(`\n${icon} ${modeIcon} ${r.file_id}:`)
      console.log(`   Status: ${r.status} (${r.match_method}, conf=${r.match_confidence})`)
      if (r.asset_summary) {
        console.log(`   Asset: id=${r.asset_summary.id}, ${r.asset_summary.marca} ${r.asset_summary.model}`)
      }
      if (r.mode === 'vision' && r.vision_error) {
        console.log(`   ⚠️ Vision error: ${r.vision_error}`)
      }
      console.log(`   Fișe extrase: ${r.stats.total_fise} (${r.stats.duplicate_count} duplicate)`)
      if (r.mode === 'vision') {
        console.log(`   📷 Vision tokens: ${r.stats.vision_input_tokens} in + ${r.stats.vision_output_tokens} out, ${r.stats.vision_duration_ms}ms`)
        if (r.fise.length > 0) {
          console.log(`   📋 Primele 2 fișe extrase:`)
          r.fise.slice(0, 2).forEach((f, i) => {
            console.log(`      ${i+1}. ${f.tip} ${f.data_fisei}: ${f.titlu}`)
          })
        }
      }
      if (r.stats.ai_called && r.mode !== 'vision') {
        console.log(`   🤖 AI match tokens: ${r.stats.input_tokens} in + ${r.stats.output_tokens} out, ${r.stats.duration_ms}ms`)
      }
      if (r.cache_written) console.log(`   💾 Cache scris pentru viitor`)
    })
    
    console.log('━'.repeat(60))
    console.log(`💰 Cost total: $${data.stats.estimated_cost_usd.toFixed(4)}`)
    console.log(`   - Vision (Sonnet 4.5): $${data.stats.cost_vision_usd.toFixed(4)}`)
    console.log(`   - Match (Haiku 4.5): $${data.stats.cost_match_usd.toFixed(4)}`)
    console.log(`⏱️  Durată: ${data.stats.total_duration_ms}ms`)
    
    window.lastTestResult = data
    console.log('\n💡 Răspuns complet în `window.lastTestResult`')
    return data
  } catch (e) {
    console.error('❌ Exception:', e)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTĂ AUTOMAT TEST PARSED (cele 4 cazuri standard)
// ════════════════════════════════════════════════════════════════════════════
console.log('🚀 Execut testul standard (parsed mode)...')
window.testProcessCarteServiceAi()

// ════════════════════════════════════════════════════════════════════════════
// PENTRU A TESTA VISION cu un PDF/poză real:
//
// În Console, rulează:
//
//    const input = document.createElement('input')
//    input.type = 'file'
//    input.accept = '.pdf,image/*'
//    input.onchange = (e) => {
//      const f = e.target.files[0]
//      if (f) testProcessCarteServiceAi({ includeVision: true, visionFile: f })
//    }
//    input.click()
//
// Va deschide un selector. Alegi un PDF/poză (max 5MB) → testul rulează cu
// cele 4 cazuri parsed + 1 caz vision pentru fișierul tău.
// ════════════════════════════════════════════════════════════════════════════
