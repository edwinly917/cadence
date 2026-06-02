import { describe, it, expect, beforeEach } from "vitest";
import {
  formatMMSS,
  start,
  pause,
  resume,
  reset,
  finish,
  computeRemaining,
  loadState,
  saveState,
  clearState,
  DEFAULT_STATE,
  TimerState,
} from "./timer";

describe("formatMMSS", () => {
  it("formats sub-hour as MM:SS", () => {
    expect(formatMMSS(0)).toBe("00:00");
    expect(formatMMSS(1000)).toBe("00:01");
    expect(formatMMSS(60_000)).toBe("01:00");
    expect(formatMMSS(20 * 60_000)).toBe("20:00");
    expect(formatMMSS(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("formats >= 1h as HH:MM:SS", () => {
    expect(formatMMSS(60 * 60_000)).toBe("01:00:00");
    expect(formatMMSS(120 * 60_000)).toBe("02:00:00");
    expect(formatMMSS(60 * 60_000 + 30 * 1000)).toBe("01:00:30");
  });

  it("rounds up sub-second remainders", () => {
    expect(formatMMSS(500)).toBe("00:01");
    expect(formatMMSS(999)).toBe("00:01");
  });

  it("clamps negative to 00:00", () => {
    expect(formatMMSS(-1000)).toBe("00:00");
  });
});

describe("state machine", () => {
  const t0 = 1_700_000_000_000;

  it("start: idle → running with endsAt = now + duration", () => {
    const s = start(DEFAULT_STATE, 20, t0);
    expect(s.status).toBe("running");
    expect(s.presetMinutes).toBe(20);
    expect(s.endsAt).toBe(t0 + 20 * 60_000);
    expect(s.remainingMs).toBeNull();
  });

  it("pause: running → paused, captures remaining at pause moment", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    const paused = pause(running, t0 + 5 * 60_000);
    expect(paused.status).toBe("paused");
    expect(paused.remainingMs).toBe(15 * 60_000);
    expect(paused.endsAt).toBeNull();
  });

  it("pause is no-op on non-running state", () => {
    expect(pause(DEFAULT_STATE, t0)).toEqual(DEFAULT_STATE);
  });

  it("resume: paused → running with new endsAt anchored to current time", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    const paused = pause(running, t0 + 5 * 60_000);
    const resumed = resume(paused, t0 + 60 * 60_000);
    expect(resumed.status).toBe("running");
    expect(resumed.endsAt).toBe(t0 + 60 * 60_000 + 15 * 60_000);
    expect(resumed.remainingMs).toBeNull();
  });

  it("resume preserves remaining duration across long pause", () => {
    const running = start(DEFAULT_STATE, 40, t0);
    const paused = pause(running, t0 + 10 * 60_000);
    const resumed = resume(paused, t0 + 24 * 60 * 60_000);
    expect(computeRemaining(resumed, t0 + 24 * 60 * 60_000)).toBe(30 * 60_000);
  });

  it("reset: any state → idle", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    const back = reset(running);
    expect(back.status).toBe("idle");
    expect(back.endsAt).toBeNull();
    expect(back.remainingMs).toBeNull();
    expect(back.presetMinutes).toBe(20);
  });

  it("finish: forces remaining to 0", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    const done = finish(running);
    expect(done.status).toBe("finished");
    expect(computeRemaining(done, t0 + 30 * 60_000)).toBe(0);
  });
});

describe("computeRemaining", () => {
  const t0 = 1_700_000_000_000;

  it("idle returns full preset duration", () => {
    expect(computeRemaining(DEFAULT_STATE, t0)).toBe(40 * 60_000);
  });

  it("running shrinks over time", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    expect(computeRemaining(running, t0)).toBe(20 * 60_000);
    expect(computeRemaining(running, t0 + 5 * 60_000)).toBe(15 * 60_000);
    expect(computeRemaining(running, t0 + 30 * 60_000)).toBe(0);
  });

  it("paused returns frozen remaining", () => {
    const running = start(DEFAULT_STATE, 20, t0);
    const paused = pause(running, t0 + 7 * 60_000);
    expect(computeRemaining(paused, t0 + 60 * 60_000)).toBe(13 * 60_000);
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saveState then loadState round-trips", () => {
    const s: TimerState = {
      status: "running",
      presetMinutes: 60,
      endsAt: 1_700_000_000_000,
      remainingMs: null,
      soundId: "rain",
      volume: 0.7,
    };
    saveState(s);
    expect(loadState()).toEqual(s);
  });

  it("loadState returns null when nothing saved", () => {
    expect(loadState()).toBeNull();
  });

  it("loadState returns null for malformed JSON", () => {
    localStorage.setItem("cadence.timer", "{not-json");
    expect(loadState()).toBeNull();
  });

  it("loadState merges defaults for missing fields", () => {
    localStorage.setItem(
      "cadence.timer",
      JSON.stringify({ status: "idle", presetMinutes: 20 }),
    );
    const loaded = loadState();
    expect(loaded?.volume).toBe(0.5);
    expect(loaded?.soundId).toBeNull();
  });

  it("clearState removes the key", () => {
    saveState(DEFAULT_STATE);
    clearState();
    expect(loadState()).toBeNull();
  });
});
