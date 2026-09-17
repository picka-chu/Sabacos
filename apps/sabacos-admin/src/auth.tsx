import { create } from "zustand";
import { supabase } from "./lib/supabase.js";
import { api, getTelegramInitData } from "./lib/api.js";

interface AdminProfile {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  role: string;
}

interface AdminSession {
  token: string | null;
  email: string | null;
  profile: AdminProfile | null;
  ready: boolean;
  setSession: (token: string | null, email: string | null) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  restore: () => Promise<void>;
  restoreFromTelegram: () => Promise<boolean>;
  finishAuth: () => void;
}

export const useAuth = create<AdminSession>((set) => ({
  token: null,
  email: null,
  profile: null,
  ready: false,

  setSession: (token, email) => set({ token, email }),

  restore: async () => {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const token = session?.access_token ?? null;
    set({
      token,
      email: session?.user.email ?? null,
    });
    // Fetch admin profile if we have a Supabase session
    if (token) {
      try {
        const res = await api.get<{ profile: AdminProfile }>("/admin/me", token);
        set({ profile: res.profile });
      } catch { /* not an admin or token invalid */ }
    }
  },

  restoreFromTelegram: async () => {
    const initData = getTelegramInitData();
    if (!initData) return false;

    try {
      const res = await api.get<{ profile: AdminProfile }>("/admin/me");
      set({
        token: null,
        email: res.profile.firstName ?? "Admin",
        profile: res.profile,
      });
      return true;
    } catch {
      return false;
    }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const token = data.session.access_token;
    set({ token, email: data.session.user.email ?? email });
    // Fetch admin profile
    try {
      const res = await api.get<{ profile: AdminProfile }>("/admin/me", token);
      set({ profile: res.profile, ready: true });
    } catch {
      set({ ready: true });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ token: null, email: null, profile: null, ready: true });
  },

  finishAuth: () => set({ ready: true }),
}));