# ManageYourLife — Personal Strategic Management Ecosystem

**Canlı sayt:** [https://manageyourlife.netlify.app](https://manageyourlife.netlify.app)

GTD (Getting Things Done) metodologiyasına əsaslanan, RPG elementləri ilə zənginləşdirilmiş şəxsi strategiya və məhsuldarlıq platformasıdır. Gündəlik tapşırıqları, uzunmüddətli məqsədləri və həyat balansını bir yerdə idarə etməyə imkan verir.

## Əsas Funksionallıqlar

### 🎯 Tapşırıq İdarəetməsi (Schedule & Planning)
- **Execution Date vs Deadline** — icra tarixini və son tarixi ayrı planlaşdırma
- **Günlük 8 saatlıq tutum limiti** — overload-un qarşısını alır
- **Kateqoriyalar:** Work, Study, Fitness (Lucide ikonları ilə)
- **Prioritetlər:** High / Medium / Low / Idle
- **Subtask** dəstəyi və progress bar
- Vaxtı keçmiş tapşırıqlar üçün **qırmızı pulse** vizual göstərici
- **Start/End timestamp** ilə tapşırıq müddətinin avtomatik hesablanması

### 📝 Notes (Markdown Editor)
- Qalın kart şəbəkəsi (thick card grid) tərtibatı
- Tam **Markdown** dəstəyi (preview + edit rejimləri)
- **Klikləndikdə açılan linklər** (preview-də yeni tabda)
- **Smart lists** — markdown checkbox-ları avtomatik subtask-a çevrilir
- Note ↔ Task **2-tərəfli sinxronizasiya** (many-to-many bridge)
- Axtarış və soft delete (Trash)

### 📥 Opportunities Intake
- Eventlər, deadline-lar və imkanlar üçün intake sistemi
- Tapşırığa çevrildikdə avtomatik silinir
- Dashboard-da Calendar və Daily Plan ilə birgə görünür

### 📅 Google Calendar Sync
- Google OAuth ilə bağlantı
- Daxili tapşırıqları və opportunity-ləri Google Calendar ilə sinxronlaşdırır
- Schedule səhifəsindən tək kliklə sync

### 🤖 AI Assistant
- **Lovable AI Gateway** vasitəsilə Gemini və GPT modelləri
- Təbii dildə tapşırıq yaratma (tool calling)
- Mətndən tapşırıq parse etmə və avtomatik kateqoriyalaşdırma
- Settings-dən model seçimi (Gemini 3 Flash, Gemini 2.5 Pro, GPT-5 Mini və s.)

### 🎮 Gamified Strategy Dashboard
- **RPG atributları:** Wealth, Health, Freedom, Status
- **Task weighting** (1–100) və attribute tag-ləri ilə proqresin hesablanması
- **Vision Pipeline** — uzunmüddətli məqsədlərin vizuallaşdırılması
- **Life Ops** paneli

### ⏳ Chronos Timer
- 120 illik ömrə qarşı canlı countdown
- Doğum tarixinə əsasən hesablanır
- Vaxtın dəyərini xatırladan strategiya elementi

### 👥 Task Sharing
- Tapşırığı email vasitəsilə başqa istifadəçilərə göndərmək (send-style)
- **Inbox request** sistemi (duplicate-based sharing)
- Göndərildikdə email bildirişi

### 🔐 Authentication
- Email/şifrə ilə qeydiyyat (email confirmation tələb olunur)
- **Forgot password** / şifrə sıfırlama axını
- Google OAuth dəstəyi
- Row-Level Security (RLS) ilə qorunan məlumatlar

## Texnologiyalar

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons
- **Backend:** Lovable Cloud (Supabase) — Database, Auth, Edge Functions, Storage, RLS
- **AI:** Lovable AI Gateway (Google Gemini, OpenAI GPT)
- **Deploy:** Netlify

## Dizayn

Minimalist dark theme, glassmorphism effektləri və **Emerald Green** accent rəngi. Dinamik badge-lər overdue / qalan günləri göstərir.

---

🔗 **[manageyourlife.netlify.app](https://manageyourlife.netlify.app)**
