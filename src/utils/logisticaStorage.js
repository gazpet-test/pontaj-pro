// 04.10.2026 D1 prep: curățare best-effort, numai după confirmarea scrierii în BD.
export async function removeLogisticaFiles(supabase, bucket, paths) {
  const validPaths = paths.filter(Boolean)
  if (!validPaths.length) return
  try {
    const { error } = await supabase.storage.from(bucket).remove(validPaths)
    if (error) console.warn('Storage delete warning:', error.message)
  } catch (error) {
    console.warn('Storage delete warning:', error.message || error)
  }
}
