// ════════════════════════════════════════════════════════════════
// Ofertare.jsx — Modulul OFERTARE (placeholder Faza 1)
// LIVE: 19.05.2026 (Etapa 15 Faza 1)
// Owner principal: TBD (structură ofertare în formalizare)
// Next: Faza 3 (CRUD proiecte ofertare + import materiale Excel + legare șantier la câștig)
// ════════════════════════════════════════════════════════════════
import ModulePlaceholder from './ModulePlaceholder.jsx'

export default function OfertarePage() {
  return (
    <ModulePlaceholder
      icon="📋"
      title="Ofertare"
      subtitle="Cereri ofertă · Licitații · Calculații · Caiete de sarcini"
      color="#3FB6E2"
      faza={3}
      etapa="15.3"
      owner="TBD (de stabilit responsabil)"
      statusBd={true}
      statusUi={false}
      features={[
        'CRUD proiecte ofertare — denumire, beneficiar, data licitație, valoare',
        'Status flow: în_ofertare → depus → câștigat / pierdut / anulat',
        'Upload caiet de sarcini + proiect tehnic (PDF în Storage)',
        'Listă materiale ofertate per proiect (manual sau import Excel)',
        'Flag „material mare" pentru cereri de ofertă specifice furnizori',
        'Trecere proiect câștigat → legare automată cu site_id (șantier nou)',
        'Materialele câștigate devin disponibile în panoul MP la comandă',
        'AI Phase 2: generator cerere ofertă (Claude + KB normative)',
      ]}
    />
  )
}
