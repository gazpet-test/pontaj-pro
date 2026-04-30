# 🚀 Ghid Instalare PontajPRO în Cloud
### De la zero la aplicație live în ~30 minute

---

## Ce vei folosi (toate GRATUIT)

| Serviciu | Rol | Plan gratuit |
|----------|-----|--------------|
| **Supabase** | Bază de date + autentificare | ✅ 500MB, 50.000 req/lună |
| **Vercel** | Hosting aplicație web | ✅ Nelimitat pentru proiecte personale |
| **GitHub** | Stocare cod sursă | ✅ Nelimitat |

---

## PASUL 1 — Pregătești codul pe GitHub

1. Creează cont pe **github.com** (dacă nu ai)
2. Click **"New repository"** → Denumește-l `pontaj-pro`
3. Selectează **Private** → **Create repository**
4. Urci fișierele din acest folder (drag & drop sau GitHub Desktop)

> 💡 Alternativ: instalează **GitHub Desktop** de pe desktop.github.com — mai simplu vizual

---

## PASUL 2 — Configurezi Supabase (baza de date)

### 2.1 Creează contul și proiectul
1. Mergi pe **supabase.com** → **Start your project**
2. Înregistrează-te cu Google sau email
3. Click **New Project**
   - **Organization**: numele firmei
   - **Project name**: `pontaj-pro`
   - **Database password**: alege o parolă puternică (salveaz-o!)
   - **Region**: `Central EU (Frankfurt)` (cel mai aproape de România)
4. Așteaptă ~2 minute să se creeze proiectul

### 2.2 Creezi tabelele
1. În panoul Supabase, click **SQL Editor** (icona `</>` din stânga)
2. Click **New query**
3. Copiază tot conținutul fișierului `supabase_schema.sql`
4. Paste în editor → click **Run** (sau Ctrl+Enter)
5. Ar trebui să apară: `Success. No rows returned`

### 2.3 Copiezi cheile API
1. Click **Settings** (roată) → **API**
2. Copiază:
   - **Project URL** → ex: `https://abcdefgh.supabase.co`
   - **anon public** key → cheia lungă de sub "Project API keys"
3. Ține-le la îndemână pentru pasul următor

---

## PASUL 3 — Deployezi pe Vercel

### 3.1 Creează contul Vercel
1. Mergi pe **vercel.com** → **Start Deploying**
2. **Continue with GitHub** (conectează contul GitHub)

### 3.2 Importă proiectul
1. Click **Add New** → **Project**
2. Găsește repo-ul `pontaj-pro` → click **Import**
3. **Framework Preset**: selectează **Vite** (dacă nu e detectat automat)

### 3.3 Adaugi variabilele de mediu (IMPORTANT!)
Înainte de deploy, în secțiunea **Environment Variables** adaugă:

| Cheie | Valoare |
|-------|---------|
| `VITE_SUPABASE_URL` | URL-ul din Supabase (ex: `https://abcd.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Cheia `anon public` din Supabase |

4. Click **Deploy** → Așteaptă ~2-3 minute

✅ Aplicația ta e live! Vercel îți dă un URL de tipul `pontaj-pro.vercel.app`

> 💡 **Domeniu personalizat** (ex: pontaj.firma-ta.ro): Settings → Domains → Add în Vercel

---

## PASUL 4 — Creezi primul utilizator Admin

### 4.1 Creează userul în Supabase Authentication
1. În Supabase → **Authentication** → **Users**
2. Click **Add user** → **Create new user**
   - Email: `admin@firma-ta.ro`
   - Password: parola ta
   - Click **Create User**

### 4.2 Setează-l ca Admin
1. În Supabase → **SQL Editor** → **New query**
2. Rulează (înlocuiește emailul):
```sql
UPDATE public.profiles 
SET name = 'Numele Tău', role = 'admin' 
WHERE email = 'admin@firma-ta.ro';
```
3. Click **Run**

### 4.3 Testează login-ul
1. Deschide aplicația (URL-ul Vercel)
2. Introdu emailul și parola adminului
3. Ar trebui să intri cu acces complet ✅

---

## PASUL 5 — Adaugi manageri de departament

### Din aplicație (pagina Admin):
1. Loghează-te ca admin
2. Mergi la **⚙ Admin** → tab **Manageri**
3. Completează formularul:
   - **Nume**: Ion Popescu
   - **Email**: ion.popescu@firma.ro
   - **Parolă temporară**: (le vei comunica-o personal)
   - **Rol**: Manager
   - **Departament**: IT (sau departamentul lor)
4. Click **+ Adaugă Manager**

> ⚠️ **Important**: Managerul va primi un email de confirmare de la Supabase.
> Trebuie să dea click pe linkul din email înainte de a se putea loga prima dată.
> Poți dezactiva confirmarea email din Supabase → Authentication → Settings → dezactivează "Enable email confirmations"

---

## Structura rolurilor

```
ADMIN
├── Vede toți angajații din toate departamentele
├── Poate adăuga/dezactiva angajați
├── Poate crea manageri noi
└── Vede rapoarte complete

MANAGER (per departament)
├── Vede DOAR angajații din departamentul său
├── Înregistrează intrări/ieșiri
├── Poate introduce pontaj manual
└── Vede rapoarte pentru departamentul său
```

---

## Actualizări viitoare

Când vrei să modifici aplicația:
1. Modifici fișierele local
2. Push pe GitHub (git push)
3. **Vercel redeploy automat** în ~2 minute! 🚀

---

## Probleme frecvente

**"Invalid login credentials"**
→ Verifică că ai dat click pe linkul de confirmare din email

**"relation does not exist"**
→ Rulează din nou scriptul `supabase_schema.sql`

**Variabilele de mediu nu funcționează**
→ În Vercel: Settings → Environment Variables → verifică că sunt adăugate, apoi Deployments → Redeploy

**Managerul vede angajații altor departamente**
→ Verifică că în profiles, câmpul `department` este completat corect

---

## Securitate

- ✅ Parolele sunt criptate de Supabase (bcrypt)
- ✅ Fiecare manager vede DOAR datele departamentului său (Row Level Security)
- ✅ Conexiunea este HTTPS (SSL)
- ✅ Cheile API sunt private (în variabile de mediu, nu în cod)

---

*Suport: dacă ai întrebări, revin-o la conversația cu Claude 😊*
