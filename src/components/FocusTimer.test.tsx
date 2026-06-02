import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FocusTimer } from "./FocusTimer";

vi.mock("@/lib/sounds", () => ({
  SOUNDS: [
    { id: "rain", label: "雨声", file: "/sounds/rain.mp3" },
    { id: "snow", label: "雪/风", file: "/sounds/snow.mp3" },
  ],
  playSound: vi.fn(),
  stopSound: vi.fn(),
  setVolume: vi.fn(),
  playChime: vi.fn(),
}));

describe("FocusTimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when open=false", () => {
    render(<FocusTimer open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog", { name: "心流计时" })).not.toBeInTheDocument();
  });

  it("renders idle state with default duration", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "心流计时" })).toBeInTheDocument();
    expect(screen.getByText("40:00")).toBeInTheDocument();
    expect(screen.getByText(/准备 · 40 分钟/)).toBeInTheDocument();
  });

  it("renders all duration presets", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "20 分钟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "40 分钟" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 小时" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 小时" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自定义" })).toBeInTheDocument();
  });

  it("clicking a preset starts the timer", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    expect(screen.getByText("专注中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⏸ 暂停" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "↺ 重置" })).toBeInTheDocument();
  });

  it("pause then resume keeps remaining time consistent", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    fireEvent.click(screen.getByRole("button", { name: "⏸ 暂停" }));
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ 继续" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "▶ 继续" }));
    expect(screen.getByText("专注中")).toBeInTheDocument();
  });

  it("reset returns to idle", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "40 分钟" }));
    fireEvent.click(screen.getByRole("button", { name: "↺ 重置" }));
    expect(screen.getByText(/准备/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "↺ 重置" })).not.toBeInTheDocument();
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(<FocusTimer open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("custom duration: typing then start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "自定义" }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(screen.getByText("专注中")).toBeInTheDocument();
    expect(screen.getByText("05:00")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("white noise selector includes options", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "rain" } });
    expect(select.value).toBe("rain");
  });

  it("volume slider updates display value", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.3" } });
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("auto-finishes when end time passes", () => {
    vi.useFakeTimers();
    const initialNow = 1_700_000_000_000;
    vi.setSystemTime(initialNow);
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    act(() => {
      vi.setSystemTime(initialNow + 21 * 60_000);
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("时间到 🎉")).toBeInTheDocument();
    expect(screen.getByText("00:00")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("minimize button is hidden in idle state", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "最小化" })).not.toBeInTheDocument();
  });

  it("running state shows minimize button; clicking it shows capsule", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    const minBtn = screen.getByRole("button", { name: "最小化" });
    fireEvent.click(minBtn);
    expect(
      screen.getByRole("dialog", { name: "心流计时(已最小化)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "20 分钟" })).not.toBeInTheDocument();
  });

  it("expand button restores full panel from capsule", () => {
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(screen.getByRole("dialog", { name: "心流计时" })).toBeInTheDocument();
    expect(screen.getByText("专注中")).toBeInTheDocument();
  });

  it("finishing while minimized auto-expands the panel", () => {
    vi.useFakeTimers();
    const initialNow = 1_700_000_000_000;
    vi.setSystemTime(initialNow);
    render(<FocusTimer open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "20 分钟" }));
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    expect(
      screen.getByRole("dialog", { name: "心流计时(已最小化)" }),
    ).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(initialNow + 21 * 60_000);
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("时间到 🎉")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "心流计时(已最小化)" }),
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
