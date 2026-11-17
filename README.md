# נסיעות – מערכת ניהול נסיעות והסעות (שלב 1)

אתר מותאם לנייד (PWA) לסדרן הסעות: קליטת הזמנה בהדבקה או בדיבור עם פענוח AI, יומן נסיעות, שיבוץ ושליחה לקבלן בוואטסאפ, זיכרון מחירים וסיכום חודשי. בנוי לכמה עסקים, עם הפרדה מלאה ביניהם.

## מבנה

```
supabase/
  migrations/0001_init.sql     טבלאות, הרשאות (RLS), זיכרון מחירים
  bootstrap_first_org.sql      פתיחת עסק חדש
  functions/parse-ride         פענוח הודעה לשדות נסיעה (Claude)
  functions/invite-user        הוספת משתמש לעסק (בעל העסק בלבד)
web/                           האתר: React + Vite + PWA
```

## הקמה

### 1. Supabase
1. פותחים פרויקט ב-[supabase.com](https://supabase.com). אזור מומלץ: Frankfurt.
2. **SQL Editor**: מריצים את `supabase/migrations/0001_init.sql`.
3. **Authentication → Sign In / Providers**:
   - Email: פעיל.
   - מכבים את "Allow new users to sign up". רק מי שהוזמן יוכל להיכנס.
4. **Authentication → Email Templates → Magic Link**: מוסיפים לתבנית את הקוד `{{ .Token }}`, כדי שהמשתמש יקבל קוד בן 6 ספרות. למשל:
   `קוד הכניסה שלך: {{ .Token }}`
5. **פתיחת העסק של גדי**: מעדכנים שם ומייל ב-`supabase/bootstrap_first_org.sql` ומריצים. אחר כך: Authentication → Users → Add user → אותו מייל.

### 2. פונקציות השרת
עם [Supabase CLI](https://supabase.com/docs/guides/cli):
```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy parse-ride
supabase functions deploy invite-user
```
אפשר לבחור מודל אחר לפענוח עם `PARSE_MODEL` (ברירת המחדל: `claude-haiku-5-5`).

### 3. האתר
```bash
cd web
cp .env.example .env      # ממלאים URL ו-anon key מ-Project Settings → API
npm install
npm run dev               # פיתוח מקומי
npm run build             # בנייה
```
**העלאה ל-Vercel:** מייבאים את ה-repo, Root Directory = `web`, ומוסיפים את שני משתני הסביבה.

## הרשאות
- כל טבלה מסוננת לפי `org_id` דרך Row Level Security. משתמש רואה וכותב רק בעסקים שהוא חבר בהם.
- אין הרשמה פתוחה: משתמש נוצר רק דרך הזמנה (`invitations`), וה-trigger משייך אותו לעסק.
- בעל העסק מוסיף משתמשים במסך **הגדרות**.

נבדק על PostgreSQL 16: חסימת כתיבה לעסק אחר, אי-חשיפת נתונים בין עסקים, שיוך משתמש מוזמן, וזיכרון מחירים.

## מה נבנה
- כניסה בקוד חד-פעמי במייל, למוזמנים בלבד
- יומן ליום או לשבוע, עם צבע לפי שיבוץ: שלי, קבלן, לא שובץ, בוטלה
- נסיעה חדשה: הדבקה או הקלטה, "מלא אוטומטית", לקוח חדש ישירות מהטופס
- זיכרון מחירים: מחיר אחרון ללקוח במסלול, ואחריו המחירון
- רווח לכל נסיעה, ושליחה לקבלן בוואטסאפ עם הודעה מנוסחת
- לקוחות, נהגים וקבלנים
- סוף חודש: לפי לקוח (סמן כחויב), לפי קבלן (סמן כשולם), רווח, וייצוא CSV לאקסל

## תזכורות (Push)
- תזכורת לכל מכשיר רשום בעסק X דקות לפני נסיעה (ברירת מחדל: שעה). אם הנסיעה לא שובצה, ההתראה אומרת זאת.
- סיכום ערב ב-20:00: כמה נסיעות מחר וכמה עוד לא שובצו.
- נשלח ע"י `send-reminders` שרץ כל 5 דקות דרך pg_cron.
- באייפון: עובד רק אחרי הוספה למסך הבית (iOS 16.4 ומעלה).

הקמה חד-פעמית:
1. SQL Editor: מריצים `supabase/migrations/0002_reminders.sql`.
2. `npx web-push generate-vapid-keys` → מפתח Public ומפתח Private.
3. סודות לפונקציה:
   ```
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<מחרוזת אקראית ארוכה>
   npx supabase functions deploy send-reminders --no-verify-jwt
   ```
4. SQL Editor: מריצים `supabase/setup_reminders_cron.sql` אחרי החלפת `PUT-YOUR-CRON-SECRET-HERE` באותו CRON_SECRET.
5. `web/.env` וב-Vercel: `VITE_VAPID_PUBLIC_KEY=<המפתח הציבורי>` (Config), ואז `npm install` ו-`npx vercel --prod`.
6. באפליקציה: הגדרות → הפעלת התראות במכשיר הזה → שליחת בדיקה.

## מרחק משוער (Google Maps)
- כשממלאים איסוף ויעד, המערכת מחשבת מרחק נסיעה (ק״מ) וזמן נסיעה משוער. אפשר לתקן ידנית.
- מסלול שכבר נמדד בעסק נלקח מנסיעה קודמת, בלי לפנות שוב ל-Google.
- "נתב״ג", "שדה התעופה" וכו' מתורגמים לנמל התעופה בן גוריון.

הקמה חד-פעמית:
1. SQL Editor: מריצים `supabase/migrations/0004_ride_distance.sql`.
2. [Google Cloud Console](https://console.cloud.google.com): פרויקט חדש → Billing → APIs & Services → מפעילים **Routes API** → Credentials → Create API key → מגבילים את המפתח ל-Routes API בלבד.
3. ```
   npx supabase secrets set GOOGLE_MAPS_API_KEY=...
   npx supabase functions deploy estimate-distance
   ```
4. `npx vercel --prod`.

## נסיעות קבועות
- תבנית: ימים בשבוע, שעה, מסלול, לקוח, נהג קבוע (לא חובה), מחיר ועלות קבלן, מתאריך / עד תאריך.
- המערכת יוצרת את הנסיעות ביומן שבועיים קדימה, ומשלימה כל לילה (pg_cron, 00:15 UTC).
- נסיעה בודדת אפשר לשנות או לבטל ביומן; תאריך שבוטל לא נוצר מחדש.
- עריכת תבנית בונה מחדש את הנסיעות שלה ממחר והלאה (חוץ ממה שחויב/שולם). נסיעות של היום לא משתנות.
- הקמה: SQL Editor → `supabase/migrations/0006_recurring_rides.sql` (אחרי שהרצתם את setup_reminders_cron.sql).

## אישור נסיעה ע"י הנהג
- הודעת הוואטסאפ לקבלן כוללת קישור אישי (`/d/<token>`). הנהג פותח, רואה את פרטי הנסיעה ולוחץ "מאשר" או "לא יכול". בלי התחברות.
- סירוב: הנהג יוצא מהנסיעה, הנסיעה חוזרת לצהוב "לא שובץ", בעל העסק מקבל התראה, והנהג מסומן "סירב" ומופיע אחרון ברשימה.
- לא ענה תוך שעה: בעל העסק מקבל התראה (send-reminders).
- ביומן: ✓ אישר, ⏳ ממתין, וכפתור סינון "לא אישרו".
- הקישור ייחודי לנסיעה ולנהג (64 תווים אקראיים), מתבטל כשמחליפים נהג, ומפסיק לעבוד אחרי יום הנסיעה.

הקמה:
1. SQL Editor: `supabase/migrations/0007_driver_confirmation.sql`.
2. ```
   npx supabase functions deploy driver-response --no-verify-jwt
   npx supabase functions deploy send-reminders --no-verify-jwt
   ```
3. `npx vercel --prod`.

## עוד לא נבנה (המשך שלב 1)
- ייבוא המחירון מהאקסל של גדי (ממתינים לקובץ)
