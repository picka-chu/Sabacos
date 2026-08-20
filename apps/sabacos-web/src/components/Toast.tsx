import { create } from "zustand";
import { CheckCircle2 } from "lucide-react";

interface ToastState {
  message: string | null;
  show: (message: string) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  hide: () => set({ message: null }),
}));

let timeout: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string): void {
  useToastStore.getState().show(message);
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => useToastStore.getState().hide(), 2200);
}

export function ToastHost() {
  const message = useToastStore((s) => s.message);
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <CheckCircle2 size={16} />
      <span>{message}</span>
    </div>
  );
}