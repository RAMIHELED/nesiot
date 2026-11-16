import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import type { Customer } from "../types";

type Draft = { name: string; phone: string; email: string; kind: "private" | "company"; notes: string };

const toDraft = (c?: Customer): Draft => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  kind: c?.kind ?? "private",
  notes: c?.notes ?? "",
});

const toRow = (d: Draft) => ({
  name: d.name.trim(),
  phone: d.phone.trim() || null,
  email: d.email.trim() || null,
  kind: d.kind,
  notes: d.notes.trim() || null,
});

export default function Customers() {
  const orgId = useOrgId();
  const [list, setList] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [newDraft, setNewDraft] = useState<Draft>(toDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(toDraft());
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    supabase.from("customers").select("*").eq("org_id", orgId).order("name")
      .then(({ data }) => setList((data ?? []) as Customer[]));

  useEffect(() => {
    load();
  }, [orgId]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").insert({ org_id: orgId, ...toRow(newDraft) });
    if (error) return setError(error.message);
    setNewDraft(toDraft());
    setError(null);
    load();
  };

  const startEdit = (c: Customer) => {
    setEditId(c.id);
    setEdit(toDraft(c));
    setError(null);
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("customers").update(toRow(edit)).eq("id", editId);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const remove = async (c: Customer) => {
    const { count } = await supabase.from("rides").select("id", { count: "exact", head: true }).eq("customer_id", c.id);
    if (count && count > 0) {
      setError(`ל${c.name} יש ${count} נסיעות במערכת, ולכן אי אפשר למחוק אותו. אפשר לערוך את הפרטים.`);
      return;
    }
    if (!window.confirm(`למחוק את ${c.name}?`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const filtered = list.filter((c) => !q || c.name.includes(q) || (c.phone ?? "").includes(q));

  return (
    <div className="stack">
      <h2>לקוחות</h2>
      <input placeholder="חיפוש לפי שם או טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="error">{error}</p>}

      <ul className="cards">
        {filtered.map((c) =>
          editId === c.id ? (
            <li key={c.id}>
              <form onSubmit={saveEdit} className="panel stack">
                <CustomerFields d={edit} set={setEdit} />
                <div className="row">
                  <button className="btn primary">שמירה</button>
                  <button type="button" className="btn" onClick={() => setEditId(null)}>ביטול</button>
                  <button type="button" className="btn danger" onClick={() => remove(c)}>מחיקה</button>
                </div>
              </form>
            </li>
          ) : (
            <li key={c.id} className="card clickable" onClick={() => startEdit(c)}>
              <div className="row between">
                <strong>{c.name}</strong>
                <span className="badge">{c.kind === "company" ? "חברה" : "פרטי"}</span>
              </div>
              {c.phone && <span dir="ltr" className="small muted">{c.phone}</span>}
              {c.notes && <span className="small muted">{c.notes}</span>}
            </li>
          ),
        )}
      </ul>
      <p className="small muted">לחיצה על לקוח פותחת עריכה.</p>

      <form onSubmit={add} className="panel stack">
        <strong>לקוח חדש</strong>
        <CustomerFields d={newDraft} set={setNewDraft} />
        <button className="btn primary">הוספה</button>
      </form>
    </div>
  );
}

function CustomerFields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
  return (
    <>
      <input required placeholder="שם" value={d.name} onChange={(e) => set({ ...d, name: e.target.value })} />
      <input placeholder="טלפון" dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => set({ ...d, phone: e.target.value })} />
      <input placeholder="מייל" dir="ltr" type="email" value={d.email} onChange={(e) => set({ ...d, email: e.target.value })} />
      <select value={d.kind} onChange={(e) => set({ ...d, kind: e.target.value as Draft["kind"] })}>
        <option value="private">פרטי</option>
        <option value="company">חברה</option>
      </select>
      <input placeholder="הערות" value={d.notes} onChange={(e) => set({ ...d, notes: e.target.value })} />
    </>
  );
}
