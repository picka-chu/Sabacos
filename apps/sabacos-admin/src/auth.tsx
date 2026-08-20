import { create } from "zustand";
import { supabase } from "./lib/supabase.js";

interface AdminSession {
  token: string | null;
  email: string | null;
  ready: boolean;
  setSession: (token: string | null, email: string | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  restore: () => Promise<void>;
}

export const useAuth = create<AdminSession>((set) => ({
  token: null,
  email: null,
  ready: false,

  setSession: (token, email) => set({ token, email }),

  restore: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    set({
      token: session?.access_token ?? null,
      email: session?.user.email ?? null,
      ready: true,
    });
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    set({ token: data.session.access_token, email: data.session.user.email ?? email });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ token: null, email: null });
  },
}));