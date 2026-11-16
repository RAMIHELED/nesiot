import { useRef, useState } from "react";

// Browser speech recognition (Chrome on Android supports Hebrew well).
// Where it is not available, the keyboard's microphone works in the text box.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

type Props = {
  /** Called when a recording starts */
  onStart?: () => void;
  /** Transcript of the current recording so far */
  onText: (text: string) => void;
  /** Called when the recording stops, with its full transcript */
  onEnd?: (text: string) => void;
  label?: string;
};

export default function VoiceButton({ onStart, onText, onEnd, label = "🎤 הקלטה" }: Props) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const textRef = useRef("");

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      setUnsupported(true);
      return;
    }
    rec.lang = "he-IL";
    rec.interimResults = false;
    rec.continuous = true;
    textRef.current = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
      textRef.current = text.trim();
      onText(textRef.current);
    };
    rec.onend = () => {
      setListening(false);
      if (textRef.current) onEnd?.(textRef.current);
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    onStart?.();
    rec.start();
    setListening(true);
  };

  return (
    <>
      <button type="button" className={`btn mic ${listening ? "on" : ""}`} onClick={toggle}>
        {listening ? "■ עצור" : label}
      </button>
      {unsupported && (
        <p className="small muted">ההקלטה לא נתמכת בדפדפן הזה. אפשר ללחוץ על המיקרופון במקלדת ולהכתיב לתיבה.</p>
      )}
    </>
  );
}
