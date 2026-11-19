// Public sales page for dispatchers (shown at "/" to visitors who are not logged in).
import { Link } from "react-router-dom";
import { contactLink } from "../lib/contact";
import "./landing.css";

const TRIAL_DAYS = 5;
const PRICE = 250;

const ask = contactLink("היי, ראיתי את האתר של מערכת ניהול הנסיעות ואשמח לנסות.\nשם העסק: \nכמה נהגים בערך: ");

const FEATURES = [
  {
    img: "/landing/04b_filled.jpg",
    title: "נסיעה חדשה בעשר שניות",
    text: "מדביקים הודעה מוואטסאפ או מקליטים בקול, והמערכת ממלאת לבד: תאריך, שעה, כתובות, טיסה, לקוח ומחיר.",
  },
  {
    img: "/landing/03_calendar.jpg",
    title: "כל היום במבט אחד",
    text: "מה שובץ, מה מחכה לנהג, מי אישר ומי עוד לא. נהג תפוס או בחופשה לא יוצע לך בשיבוץ.",
  },
  {
    img: "/landing/07_evening.jpg",
    title: "הנהגים והלקוחות מקבלים הכל בוואטסאפ",
    text: "סידור מחר לכל נהג בהודעה אחת, עם קישור אישור. תזכורת לכל לקוח עם פרטי הנהג והרכב.",
  },
  {
    img: "/landing/09_card.jpg",
    title: "יודעים מי חייב לך, ושולחים דף חשבון",
    text: "חוב לכל לקוח, תשלומים, ודף חשבון מוכן לשליחה. כולל כסף שהנהג גבה וקיזוז בסוף החודש.",
  },
  {
    img: "/landing/11_month.jpg",
    title: "סוף חודש בלי אקסלים",
    text: "כמה מגיע לכל קבלן, מה שולם, רווח החודש, וריכוז חודשי לכל נהג בלחיצה.",
  },
];

const PAINS = [
  "הזמנות מגיעות בוואטסאפ, בטלפון ובמייל, ונרשמות בפתקים",
  "שיחות הלוך ושוב עם נהגים כדי לבדוק מי פנוי ומי אישר",
  "בסוף החודש מחפשים מי שילם, מי חייב, וכמה מגיע לכל קבלן",
];

const FAQ = [
  ["צריך להתקין אפליקציה?", "לא. זה אתר שעובד בטלפון כמו אפליקציה, ואפשר להוסיף אותו למסך הבית."],
  ["הנהגים צריכים להירשם?", "לא חובה. הם מקבלים הודעות בוואטסאפ ומאשרים בקישור. מי שרוצה יכול לקבל אפליקציית נהג משלו."],
  ["מה קורה בסוף הניסיון?", "אם ממשיכים, מתחילים לשלם וממשיכים בדיוק מאיפה שעצרתם. אם לא, הגישה נסגרת. אין התחייבות."],
  ["הנתונים שלי בטוחים?", "כל עסק רואה רק את הנתונים שלו. הכניסה עם קוד חד-פעמי במייל, בלי סיסמאות."],
];

export default function Landing() {
  return (
    <div className="lp" dir="rtl">
      <header className="lp-top">
        <span className="lp-logo">נסיעות</span>
        <Link to="/login" className="lp-login">כניסה למשתמשים</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text">
          <h1>כל הנסיעות, הנהגים והתשלומים, בטלפון אחד.</h1>
          <p className="lp-lead">מערכת פשוטה לסדרנים ולבעלי מוניות והסעות: מכניסים נסיעה בקול, משבצים נהג, והוואטסאפים יוצאים לבד.</p>
          <div className="lp-cta-row">
            <a className="lp-cta" href={ask} target="_blank" rel="noreferrer">💬 {TRIAL_DAYS} ימי ניסיון בחינם</a>
            <a className="lp-cta-ghost" href="#video">לצפייה בהדגמה</a>
          </div>
          <p className="lp-note">בלי כרטיס אשראי · בלי התחייבות · פותחים לך תוך יום</p>
        </div>
        <div className="lp-hero-phone">
          <img src="/landing/03_calendar.jpg" alt="היומן במערכת" />
        </div>
      </section>

      <section className="lp-pains">
        <h2>נשמע מוכר?</h2>
        <ul>{PAINS.map((p) => <li key={p}>{p}</li>)}</ul>
      </section>

      <section className="lp-features">
        {FEATURES.map((f, i) => (
          <div key={f.title} className={`lp-feature ${i % 2 ? "rev" : ""}`}>
            <div className="lp-phone"><img src={f.img} alt={f.title} loading="lazy" /></div>
            <div className="lp-feature-text">
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="lp-video" id="video">
        <h2>איך זה נראה בפועל</h2>
        <video src="/landing/demo.mp4" poster="/landing/demo-poster.jpg" controls playsInline preload="none" />
      </section>

      <section className="lp-steps">
        <h2>איך מתחילים</h2>
        <ol>
          <li><strong>שולחים הודעה בוואטסאפ</strong><span>עם שם העסק והמייל שלך</span></li>
          <li><strong>פותחים לך חשבון</strong><span>בדרך כלל באותו יום, ומקבלים הסבר קצר</span></li>
          <li><strong>{TRIAL_DAYS} ימים לנסות בחינם</strong><span>על הנסיעות האמיתיות שלך</span></li>
        </ol>
      </section>

      <section className="lp-price">
        <div className="lp-price-card">
          <span className="lp-price-label">מחיר אחד, הכל כלול</span>
          <div className="lp-price-num"><b>{PRICE} ₪</b> לחודש</div>
          <ul>
            <li>נסיעות, נהגים ולקוחות ללא הגבלה</li>
            <li>הקלטה קולית והדבקה מוואטסאפ</li>
            <li>הודעות וואטסאפ, תזכורות והתראות</li>
            <li>חובות, דפי חשבון וסוף חודש</li>
            <li>אפליקציה לנהגים, בלי תוספת</li>
          </ul>
          <a className="lp-cta" href={ask} target="_blank" rel="noreferrer">💬 להתחיל {TRIAL_DAYS} ימי ניסיון</a>
        </div>
      </section>

      <section className="lp-faq">
        <h2>שאלות נפוצות</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <footer className="lp-foot">
        <a className="lp-cta" href={ask} target="_blank" rel="noreferrer">💬 דברו איתי בוואטסאפ</a>
        <Link to="/login" className="lp-login">כבר יש לך חשבון? כניסה</Link>
      </footer>
    </div>
  );
}
