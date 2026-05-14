# 🖋️ Etapa 7.5 — Faza 1: Patch HR.jsx (3 modificări mici)

Aplică direct în VSCode (deschide `src/HR.jsx` și folosește **Ctrl+H** — Find/Replace).
Cele 3 modificări sunt sigure (string-uri unice, nu se confundă).

---

## ✏️ Modificarea 1/3 — Adaugă import (sus în fișier)

**FIND** (linia ~7-8):
```jsx
import TabDocumentePersonale from './TabDocumentePersonale.jsx'
```

**REPLACE WITH:**
```jsx
import TabDocumentePersonale from './TabDocumentePersonale.jsx'
import TabSemnaturi from './TabSemnaturi.jsx'
```

---

## ✏️ Modificarea 2/3 — Adaugă tab în array tabs

**FIND** (cca. linia 166-172 — array-ul de tab-uri):
```jsx
  const tabs = [
    { key: 'personal',    icon: '👥', label: 'Angajați' },
    { key: 'autorizatii', icon: '📋', label: 'Autorizații' },
    { key: 'alerte',      icon: '🔔', label: 'Alerte', badge: stats.expirat + stats.expira_7z },
    { key: 'documente',   icon: '📁', label: 'Documente personale' },
    { key: 'salarii',     icon: '💰', label: 'Salarii', superOnly: true },
  ].filter(t => !t.superOnly || isSuperAdmin)
```

**REPLACE WITH:**
```jsx
  const tabs = [
    { key: 'personal',    icon: '👥', label: 'Angajați' },
    { key: 'autorizatii', icon: '📋', label: 'Autorizații' },
    { key: 'alerte',      icon: '🔔', label: 'Alerte', badge: stats.expirat + stats.expira_7z },
    { key: 'documente',   icon: '📁', label: 'Documente personale' },
    { key: 'semnaturi',   icon: '🖋️', label: 'Semnături' },
    { key: 'salarii',     icon: '💰', label: 'Salarii', superOnly: true },
  ].filter(t => !t.superOnly || isSuperAdmin)
```

---

## ✏️ Modificarea 3/3 — Adaugă render condițional pentru tab

**FIND** (cca. linia 207 — chiar înainte de `{!load && tab === 'salarii' ...}`):
```jsx
      {!load && tab === 'documente' && <TabDocumentePersonale employees={employees} canAccessPersonal={canAccessPersonal} showToast={showToast} />}
      {!load && tab === 'salarii' && isSuperAdmin && <TabSalarii showToast={showToast} />}
```

**REPLACE WITH:**
```jsx
      {!load && tab === 'documente' && <TabDocumentePersonale employees={employees} canAccessPersonal={canAccessPersonal} showToast={showToast} />}
      {!load && tab === 'semnaturi' && <TabSemnaturi profile={profile} showToast={showToast} />}
      {!load && tab === 'salarii' && isSuperAdmin && <TabSalarii showToast={showToast} />}
```

---

## 🚀 Plan push final (4 fișiere)

1. **`src/App.jsx`** — înlocuiește cu `App.jsx` din output (are: fix lățimi ordin -2cm + import + tab Semnături în Admin)
2. **`src/HR.jsx`** — aplică cele 3 modificări de mai sus
3. **`src/TabSemnaturi.jsx`** — fișier nou, copiază `TabSemnaturi.jsx` din output în `src/`

Push prin GitHub Desktop cu commit:
```
feat(hr): tab Semnături Electronice (Etapa 7.5 Faza 1)

- Tabel hr_semnaturi_electronice + bucket Storage hr-semnaturi (RLS strict)
- Componenta reutilizabilă TabSemnaturi.jsx (upload PNG/JPG, max 500KB)
- Filtre: departament + search + show only missing
- Stats top + breakdown per departament (TESA/Logistică/Execuție)
- Integrare în HR.jsx (tab nou) + Admin → Setări (tab nou)
- Bonus: fix lățimi ordin deplasare -2cm (cols 83 units)

Faza 2 (next): jsPDF integration pentru ordin de deplasare cu semnături.
```

După deploy Vercel (~3 min), testează:
1. Mergi în HR → tab „🖋️ Semnături" — vezi lista 127 angajați
2. Mergi în Admin → tab „🖋️ Semnături" (sidebar setări) — același tab
3. Upload o semnătură PNG la 1 angajat → verifică thumbnail + preview
4. Replace cu altă imagine → confirmă că vechea devine inactivă (păstrată în istoric BD)

---

## 🔐 Notă RLS

Tab-ul e gate-uit pe `can_access_personal_data OR is_owner`. Asta înseamnă că momentan **doar tu (owner) + Marilena + Natalia** au acces, conform setărilor anterioare. Dacă vrei să dai acces și altcuiva (ex: Mirela), bifează „🆔 Acces Date Personale" pe profilul ei în Admin → Manageri.
