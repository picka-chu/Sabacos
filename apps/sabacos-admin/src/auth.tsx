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
    set({
      token: session?.access_token ?? null,
      email: session?.user.email ?? null,
      ready: true,
    });
  },

  restoreFromTelegram: async () => {
    const initData = getTelegramInitData();
    if (!initData) return false;

    try {
      const res = await api.get<{ profile: AdminProfile }>("/admin/me");
      // Store initData as the "token" for subsequent API calls
      // The server accepts either Bearer token or X-Telegram-Init-Data
      set({
        token: null, // No bearer token — auth is via X-Telegram-Init-Data header
        email: res.profile.firstName ?? "Admin",
        profile: res.profile,
        ready: true,
      });
      return true;
    } catch {
      return false;
    }
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    set({ token: data.session.access_token, email: data.session.user.email ?? email });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ token: null, email: null, profile: null });
  },
}));
