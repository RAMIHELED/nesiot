import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export type Role = "owner" | "member" | "viewer" | "driver";
type Org = { id: string; name: string; role: Role; driver_id: string | null };

type Ctx = {
  session: Session | null;
  loading: boolean;
  orgs: Org[];
  org: Org | null;
  setOrgId: (id: string) => void;
  signOut: () => Promise<void>;
  /** Platform admin (opens and manages businesses) */
  isAdmin: boolean;
  /** Re-read the businesses list (after opening a new business) */
  refreshOrgs: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reload, setReload] = useState(0);
  const [orgId, setOrgIdState] = useState<string | null>(() => localStorage.getItem("orgId"));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setOrgs([]);
      setIsAdmin(false);
      return;
    }
    // A refresh (new business opened) keeps the current screen; only the first load shows "loading"
    if (orgs.length === 0) setLoading(true);
    supabase.rpc("is_platform_admin").then(({ data, error }) => setIsAdmin(!error && data === true));
    supabase
      .from("memberships")
      .select("role, driver_id, organizations(id, name)")
      .eq("user_id", session.user.id)
      .then(({ data, error }) => {
        if (error) console.error(error);
        type Row = { role: Role; driver_id: string | null; organizations: { id: string; name: string } | null };
        const list = ((data ?? []) as unknown as Row[])
          .filter((r) => r.organizations)
          .map((r) => ({ id: r.organizations!.id, name: r.organizations!.name, role: r.role, driver_id: r.driver_id ?? null }));
        setOrgs(list);
        setLoading(false);
      });
  }, [session, reload]);

  const org = orgs.find((o) => o.id === orgId) ?? orgs[0] ?? null;

  const setOrgId = (id: string) => {
    try {
      localStorage.setItem("orgId", id);
    } catch {
      /* ignore */
    }
    setOrgIdState(id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <SessionContext.Provider value={{ session, loading, orgs, org, setOrgId, signOut, isAdmin, refreshOrgs: () => setReload((n) => n + 1) }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}

/** Current org id – only use inside pages rendered after an org was resolved. */
export function useOrgId(): string {
  const { org } = useSession();
  if (!org) throw new Error("no org");
  return org.id;
}

/** owner / member can change data; viewer and driver cannot change business data */
export function useCanEdit(): boolean {
  const { org } = useSession();
  return org?.role === "owner" || org?.role === "member";
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "בעלים",
  member: "מנהל",
  viewer: "צפייה בלבד",
  driver: "נהג",
};

/** Businesses where the logged-in user is a driver */
export function useDriverOrgs() {
  const { orgs } = useSession();
  return orgs.filter((o) => o.role === "driver");
}
