import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer } from "../types";

type Props = {
  customers: Customer[];
  /** customer_id → last ride date, to show recent customers first */
  recent?: Map<string, string>;
  value: string; // selected customer id, "" = none / new
  newName: string;
  onSelect: (id: string) => void;
  onNewName: (name: string) => void;
  disabled?: boolean;
};

const MAX = 8;

/** Search box for customers: type part of a name or phone, pick from the list, or keep the text as a new customer */
export default function CustomerPicker({ customers, recent, value, newName, onSelect, onNewName, disabled }: Props) {
  const selected = customers.find((c) => c.id === value) ?? null;
  const [text, setText] = useState(selected?.name ?? newName);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the box in sync when the form changes from outside (load, voice parsing)
  useEffect(() => {
    setText(selected?.name ?? newName);
  }, [value, selected?.name, newName]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const matches = useMemo(() => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = text.replace(/\D/g, "");
    const list = customers.filter((c) => {
      if (!words.length) return true;
      const hay = c.name.toLowerCase();
      const phone = (c.phone ?? "").replace(/\D/g, "");
      return words.every((w) => hay.includes(w)) || (digits.length >= 3 && phone.includes(digits));
    });
    const last = (id: string) => recent?.get(id) ?? "";
    return list.sort((a, b) => last(b.id).localeCompare(last(a.id)) || a.name.localeCompare(b.name, "he")).slice(0, MAX);
  }, [customers, recent, text]);

  const exact = customers.some((c) => c.name.trim() === text.trim());

  const type = (t: string) => {
    setText(t);
    setOpen(true);
    if (value) onSelect(""); // editing the text clears the chosen customer
    onNewName(t);
  };

  const pick = (c: Customer) => {
    onSelect(c.id);
    onNewName("");
    setText(c.name);
    setOpen(false);
  };

  return (
    <div className="picker" ref={boxRef}>
      <input
        type="search"
        placeholder="חיפוש לקוח לפי שם או טלפון, או שם של לקוח חדש"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => type(e.target.value)}
      />
      {selected && <span className="picker-chosen small">✓ לקוח קיים{selected.phone ? ` · ${selected.phone}` : ""}</span>}
      {!selected && text.trim() && !exact && <span className="picker-new small">+ לקוח חדש: {text.trim()}</span>}
      {open && !disabled && matches.length > 0 && !(selected && text === selected.name) && (
        <ul className="picker-list">
          {!text.trim() && <li className="picker-head small muted">לקוחות אחרונים</li>}
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                <span>{c.name}</span>
                <span className="muted small" dir="ltr">{c.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
