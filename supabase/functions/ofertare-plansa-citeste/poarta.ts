// „Poarta pe cheltuială" (server): cine poate porni o procesare PLĂTITĂ (AI/storage) pe o licitație.
// Doar ownerul platformei sau responsabilul licitației. responsabil_id null => doar ownerul.
// Funcție pură, testată în poarta_test.ts. Copie identică în ofertare-plansa-citeste și
// ofertare-cantitati-extrage (deploy-ul prin MCP/CLI pe folder nu garantează ../_shared) — ține-le la fel.
export function poateCheltui(
  ctx: { is_owner?: boolean | null; responsabil_id?: string | null },
  uid: string | null | undefined,
): boolean {
  if (!uid) return false
  if (ctx?.is_owner === true) return true
  return !!ctx?.responsabil_id && ctx.responsabil_id === uid
}
