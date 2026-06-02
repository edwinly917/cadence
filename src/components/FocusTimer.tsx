import { useEffect, useRef, useState } from "react";
import {
  TimerState,
  DEFAULT_STATE,
  DURATION_PRESETS,
  formatMMSS,
  computeRemaining,
  loadState,
  saveState,
  start,
  pause,
  resume,
  reset,
  finish,
} from "@/lib/timer";
import { SOUNDS, playSound, stopSound, setVolume, playChime } from "@/lib/sounds";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FocusTimer({ open, onClose }: Props) {
  const [state, setState] = useState<TimerState>(() => loadState() ?? DEFAULT_STATE);
  const [now, setNow] = useState<number>(() => Date.now());
  const [customMinutes, setCustomMinutes] = useState<number>(30);
  const [showCustom, setShowCustom] = useState<boolean>(false);
  const [minimized, setMinimized] = useState(false);
  const lastStatusRef = useRef<TimerState["status"]>(state.status);

  useEffect(() => {
    if (state.status === "idle" || state.status === "finished") {
      setMinimized(false);
    }
  }, [state.status]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (
      state.status === "running" &&
      state.endsAt !== null &&
      now >= state.endsAt
    ) {
      setState((s) => finish(s));
    }
  }, [now, state.status, state.endsAt]);

  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = state.status;
    if (prev !== "finished" && state.status === "finished") {
      stopSound();
      playChime();
      notifyFinished(state.presetMinutes);
    }
  }, [state.status, state.presetMinutes]);

  useEffect(() => {
    if (state.status === "running" && state.soundId) {
      playSound(state.soundId, state.volume);
    } else {
      stopSound();
    }
  }, [state.status, state.soundId]);

  useEffect(() => {
    setVolume(state.volume);
  }, [state.volume]);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  if (!open) return null;

  const remaining = computeRemaining(state, now);
  const display = formatMMSS(remaining);
  const isRunning = state.status === "running";
  const isPaused = state.status === "paused";
  const isFinished = state.status === "finished";
  const isIdle = state.status === "idle";

  const handleStart = (minutes: number) => {
    setShowCustom(false);
    setState((s) => start(s, minutes, Date.now()));
  };

  const handleStartCustom = () => {
    const m = Math.max(1, Math.min(600, Math.round(customMinutes)));
    handleStart(m);
  };

  const handlePause = () => setState((s) => pause(s, Date.now()));
  const handleResume = () => setState((s) => resume(s, Date.now()));
  const handleReset = () => {
    stopSound();
    setState((s) => reset(s));
  };

  const handleSoundChange = (id: string) => {
    setState((s) => ({ ...s, soundId: id || null }));
  };

  const handleVolumeChange = (v: number) => {
    setState((s) => ({ ...s, volume: v }));
  };

  const handleClose = () => {
    stopSound();
    onClose();
  };

  if (minimized && (isRunning || isPaused)) {
    const capsuleColor = isRunning ? "text-blue-600" : "text-amber-600";
    return (
      <div
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 shadow-lg"
        role="dialog"
        aria-label="心流计时(已最小化)"
      >
        <span className={`font-mono text-sm font-medium tabular-nums ${capsuleColor}`}>
          {display}
        </span>
        {isRunning ? (
          <button
            onClick={handlePause}
            className="text-gray-500 hover:text-gray-800"
            aria-label="暂停"
            title="暂停"
          >
            ⏸
          </button>
        ) : (
          <button
            onClick={handleResume}
            className="text-blue-600 hover:text-blue-800"
            aria-label="继续"
            title="继续"
          >
            ▶
          </button>
        )}
        <button
          onClick={() => setMinimized(false)}
          className="text-gray-400 hover:text-gray-700"
          aria-label="展开"
          title="展开"
        >
          ▢
        </button>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-700"
          aria-label="关闭"
          title="关闭"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-80 rounded-lg border border-gray-200 bg-white shadow-xl"
      role="dialog"
      aria-label="心流计时"
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-gray-900">心流计时</h3>
        <div className="flex items-center gap-2">
          {(isRunning || isPaused) && (
            <button
              onClick={() => setMinimized(true)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="最小化"
              title="最小化"
            >
              ─
            </button>
          )}
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="关闭"
            title="关闭 (⌘T)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        <div
          className={`text-center font-mono text-5xl tabular-nums tracking-tight ${
            isFinished
              ? "animate-pulse text-red-600"
              : isRunning
                ? "text-blue-600"
                : isPaused
                  ? "text-amber-600"
                  : "text-gray-700"
          }`}
        >
          {display}
        </div>
        <div className="mt-1 text-center text-xs text-gray-500">
          {isIdle && `准备 · ${state.presetMinutes} 分钟`}
          {isRunning && "专注中"}
          {isPaused && "已暂停"}
          {isFinished && "时间到 🎉"}
        </div>

        {(isIdle || isFinished) && (
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.minutes}
                onClick={() => handleStart(p.minutes)}
                className={`rounded border px-2.5 py-1 text-xs transition ${
                  state.presetMinutes === p.minutes && !showCustom
                    ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setShowCustom((v) => !v)}
              className={`rounded border px-2.5 py-1 text-xs transition ${
                showCustom
                  ? "border-blue-500 bg-blue-50 font-medium text-blue-700"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              自定义
            </button>
          </div>
        )}

        {(isIdle || isFinished) && showCustom && (
          <div className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-600">
            <input
              type="number"
              min={1}
              max={600}
              value={customMinutes}
              onChange={(e) =>
                setCustomMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
              className="w-20 rounded border border-gray-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span>分钟</span>
            <button
              onClick={handleStartCustom}
              className="rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800"
            >
              开始
            </button>
          </div>
        )}

        <div className="mt-4 flex justify-center gap-2">
          {isRunning && (
            <button
              onClick={handlePause}
              className="rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              ⏸ 暂停
            </button>
          )}
          {isPaused && (
            <button
              onClick={handleResume}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              ▶ 继续
            </button>
          )}
          {(isRunning || isPaused || isFinished) && (
            <button
              onClick={handleReset}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              ↺ 重置
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-xs text-gray-700">
            <span className="shrink-0">🎵 白噪音</span>
            <select
              value={state.soundId ?? ""}
              onChange={(e) => handleSoundChange(e.target.value)}
              className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">关闭</option>
              {SOUNDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
            <span className="shrink-0">音量</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={state.volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="w-8 text-right tabular-nums">
              {Math.round(state.volume * 100)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function notifyFinished(minutes: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("时间到 🎉", {
      body: `${minutes} 分钟专注完成`,
      silent: false,
    });
  } catch {
    // notification creation may fail in some webviews; ignore
  }
}
