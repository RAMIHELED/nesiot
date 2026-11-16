import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

type Org = { id: string; name: string; role: "owner" | "member" };

type Ctx = {
  session: Session | null;
  loading: boolean;
  orgs: Org[];
  org: Org | null;
  setOrgId: (id: string) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Org[]>([]);
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
      return;
    }
    setLoading(true);
    supabase
      .from("memberships")
      .select("role, organizations(id, name)")
      .eq("user_id", session.user.id)
      .then(({ data, error }) => {
        if (error) console.error(error);
        type Row = { role: "owner" | "member"; organizations: { id: string; name: string } | null };
        const list = ((data ?? []) as unknown as Row[])
          .filter((r) => r.organizations)
          .map((r) => ({ id: r.organizations!.id, name: r.organizations!.name, role: r.role }));
        setOrgs(list);
        setLoading(false);
      });
  }, [session]);

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
    <SessionContext.Provider value={{ session, loading, orgs, org, setOrgId, signOut }}>
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
