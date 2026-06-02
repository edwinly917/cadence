export type TimerStatus = "idle" | "running" | "paused" | "finished";

export interface TimerState {
  status: TimerStatus;
  presetMinutes: number;
  endsAt: number | null;
  remainingMs: number | null;
  soundId: string | null;
  volume: number;
}

export const DURATION_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 20, label: "20 分钟" },
  { minutes: 40, label: "40 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 120, label: "2 小时" },
];

const STORAGE_KEY = "cadence.timer";

export const DEFAULT_STATE: TimerState = {
  status: "idle",
  presetMinutes: 40,
  endsAt: null,
  remainingMs: null,
  soundId: null,
  volume: 0.5,
};

export function formatMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function computeRemaining(state: TimerState, now: number): number {
  if (state.status === "running" && state.endsAt !== null) {
    return Math.max(0, state.endsAt - now);
  }
  if (state.status === "paused" && state.remainingMs !== null) {
    return state.remainingMs;
  }
  if (state.status === "finished") return 0;
  return state.presetMinutes * 60 * 1000;
}

export function start(state: TimerState, minutes: number, now: number): TimerState {
  return {
    ...state,
    status: "running",
    presetMinutes: minutes,
    endsAt: now + minutes * 60 * 1000,
    remainingMs: null,
  };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== "running" || state.endsAt === null) return state;
  return {
    ...state,
    status: "paused",
    remainingMs: Math.max(0, state.endsAt - now),
    endsAt: null,
  };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.status !== "paused" || state.remainingMs === null) return state;
  return {
    ...state,
    status: "running",
    endsAt: now + state.remainingMs,
    remainingMs: null,
  };
}

export function reset(state: TimerState): TimerState {
  return {
    ...state,
    status: "idle",
    endsAt: null,
    remainingMs: null,
  };
}

export function finish(state: TimerState): TimerState {
  return {
    ...state,
    status: "finished",
    endsAt: null,
    remainingMs: 0,
  };
}

export function loadState(): TimerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TimerState>;
    if (
      !parsed ||
      typeof parsed.status !== "string" ||
      typeof parsed.presetMinutes !== "number"
    ) {
      return null;
    }
    return { ...DEFAULT_STATE, ...parsed } as TimerState;
  } catch {
    return null;
  }
}

export function saveState(state: TimerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable; non-fatal
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // non-fatal
  }
}
