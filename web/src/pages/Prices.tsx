import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { useOrgId } from "../lib/session";
import { money } from "../lib/format";
import type { Customer } from "../types";

type PriceRow = {
  id: string;
  org_id: string;
  customer_id: string | null;
  pickup: string;
  dropoff: string;
  price: number | null;
  driver_cost: number | null;
  customer: { name: string } | null;
};

type Draft = { customer_id: string; pickup: string; dropoff: string; price: string; driver_cost: string };

const emptyDraft = (): Draft => ({ customer_id: "", pickup: "", dropoff: "", price: "", driver_cost: "" });
const toDraft = (r: PriceRow): Draft => ({
  customer_id: r.customer_id ?? "",
  pickup: r.pickup,
  dropoff: r.dropoff,
  price: r.price?.toString() ?? "",
  driver_cost: r.driver_cost?.toString() ?? "",
});
const num = (s: string) => (s.trim() === "" ? null : Number(s));
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export default function Prices() {
  const orgId = useOrgId();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft());
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    supabase.from("price_list").select("*, customer:customers(name)").eq("org_id", orgId)
      .order("pickup").order("dropoff")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data ?? []) as PriceRow[]);
      });

  useEffect(() => {
    load();
    supabase.from("customers").select("*").eq("org_id", orgId).order("name")
      .then(({ data }) => setCustomers((data ?? []) as Customer[]));
  }, [orgId]);

  const validate = (d: Draft): string | null => {
    if (!d.pickup.trim() || !d.dropoff.trim()) return "צריך למלא איסוף ויעד.";
    if (num(d.price) === null && num(d.driver_cost) === null) return "צריך למלא לפחות מחיר ללקוח או עלות לקבלן.";
    return null;
  };

  const toRow = (d: Draft) => ({
    customer_id: d.customer_id || null,
    pickup: d.pickup.trim(),
    dropoff: d.dropoff.trim(),
    price: num(d.price),
    driver_cost: num(d.driver_cost),
  });

  // Same customer (or general) + same route
  const findSame = (d: Draft, exceptId?: string) =>
    rows.find((r) =>
      r.id !== exceptId &&
      (r.customer_id ?? "") === d.customer_id &&
      norm(r.pickup) === norm(d.pickup) &&
      norm(r.dropoff) === norm(d.dropoff));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const v = validate(newDraft);
    if (v) return setError(v);
    const same = findSame(newDraft);
    const res = same
      ? await supabase.from("price_list").update(toRow(newDraft)).eq("id", same.id)
      : await supabase.from("price_list").insert({ org_id: orgId, ...toRow(newDraft) });
    if (res.error) return setError(friendly(res.error));
    setError(null);
    setNotice(same ? "המסלול כבר היה במחירון, המחיר עודכן." : "נוסף למחירון ✓");
    setNewDraft({ ...emptyDraft(), customer_id: newDraft.customer_id });
    load();
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(edit);
    if (v) return setError(v);
    if (findSame(edit, editId!)) return setError("המסלול הזה כבר קיים במחירון עבור אותו לקוח.");
    const { error } = await supabase.from("price_list").update(toRow(edit)).eq("id", editId);
    if (error) return setError(friendly(error));
    setError(null);
    setEditId(null);
    load();
  };

  const remove = async (r: PriceRow) => {
    if (!window.confirm(`למחוק מהמחירון את ${r.pickup} ← ${r.dropoff}?`)) return;
    const { error } = await supabase.from("price_list").delete().eq("id", r.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterCustomer === "general" && r.customer_id) return false;
    if (filterCustomer !== "all" && filterCustomer !== "general" && r.customer_id !== filterCustomer) return false;
    if (!q) return true;
    const t = q.trim();
    return r.pickup.includes(t) || r.dropoff.includes(t) || (r.customer?.name ?? "").includes(t);
  }), [rows, q, filterCustomer]);

  return (
    <div className="stack">
      <h2>מחירון</h2>
      <p className="small muted">
        מחיר לכל מסלול: כללי, או מחיר מיוחד ללקוח מסוים. בנסיעה חדשה המערכת מציעה קודם את המחיר האחרון של אותו לקוח במסלול, ואחר כך את המחירון.
      </p>

      <div className="row">
        <input placeholder="חיפוש לפי מקום או לקוח" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)}>
          <option value="all">כל המחירים</option>
          <option value="general">מחירים כלליים</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="small">{notice}</p>}
      {rows.length === 0 && <p className="muted center">המחירון ריק. הוסיפו מסלול למטה.</p>}

      <ul className="cards">
        {filtered.map((r) =>
          editId === r.id ? (
            <li key={r.id}>
              <form onSubmit={saveEdit} className="panel stack">
                <PriceFields d={edit} set={setEdit} customers={customers} />
                <div className="row">
                  <button className="btn primary">שמירה</button>
                  <button type="button" className="btn" onClick={() => setEditId(null)}>ביטול</button>
                  <button type="button" className="btn danger" onClick={() => remove(r)}>מחיקה</button>
                </div>
              </form>
            </li>
          ) : (
            <li key={r.id} className="card clickable" onClick={() => { setEditId(r.id); setEdit(toDraft(r)); setError(null); }}>
              <div className="row between">
                <strong>{r.pickup} ← {r.dropoff}</strong>
                <span className="badge">{r.customer?.name ?? "כללי"}</span>
              </div>
              <div className="row between small">
                <span>ללקוח {money(r.price)} · לקבלן {money(r.driver_cost)}</span>
                {r.price != null && r.driver_cost != null && (
                  <span className="muted">רווח {money(r.price - r.driver_cost)}</span>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
      {rows.length > 0 && <p className="small muted">לחיצה על מסלול פותחת עריכה.</p>}

      <form onSubmit={add} className="panel stack">
        <strong>מסלול חדש</strong>
        <PriceFields d={newDraft} set={setNewDraft} customers={customers} />
        <button className="btn primary">הוספה</button>
      </form>
    </div>
  );
}

function PriceFields({ d, set, customers }: { d: Draft; set: (d: Draft) => void; customers: Customer[] }) {
  const profit = num(d.price) != null && num(d.driver_cost) != null ? num(d.price)! - num(d.driver_cost)! : null;
  return (
    <>
      <label>
        לקוח
        <select value={d.customer_id} onChange={(e) => set({ ...d, customer_id: e.target.value })}>
          <option value="">כללי (לכל הלקוחות)</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="row">
        <label>איסוף<input required value={d.pickup} onChange={(e) => set({ ...d, pickup: e.target.value })} /></label>
        <label>יעד<input required value={d.dropoff} onChange={(e) => set({ ...d, dropoff: e.target.value })} /></label>
      </div>
      <div className="row">
        <label>מחיר ללקוח ₪
          <input type="number" step="0.01" min={0} inputMode="decimal" value={d.price} onChange={(e) => set({ ...d, price: e.target.value })} />
        </label>
        <label>עלות לקבלן ₪
          <input type="number" step="0.01" min={0} inputMode="decimal" value={d.driver_cost} onChange={(e) => set({ ...d, driver_cost: e.target.value })} />
        </label>
      </div>
      {profit != null && <span className="small muted">רווח במסלול: {money(profit)}</span>}
    </>
  );
}

function friendly(err: { code?: string; message: string }) {
  return err.code === "23505" ? "המסלול הזה כבר קיים במחירון עבור אותו לקוח." : err.message;
}
