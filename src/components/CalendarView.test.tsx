import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CalendarView } from "./CalendarView";
import type { Task } from "@/types";

vi.mock("@/lib/db", () => ({
  listActive: vi.fn(),
}));

import { listActive } from "@/lib/db";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  title: "task",
  description: null,
  dimension: "work",
  importance: 1,
  urgency: 0,
  position: 1000,
  ddl_type: null,
  ddl_date: null,
  ddl_duration_days: null,
  ddl_set_at: null,
  status: "active",
  tags: null,
  created_at: "2026-04-01T00:00:00Z",
  completed_at: null,
  updated_at: "2026-04-01T00:00:00Z",
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 27, 10, 0));
  vi.mocked(listActive).mockReset();
});

describe("CalendarView", () => {
  it("renders the current month title", async () => {
    vi.mocked(listActive).mockResolvedValue([]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    expect(screen.getByText(/2026 年 4 月/)).toBeInTheDocument();
  });

  it("shows a hard DDL task on its target date", async () => {
    vi.mocked(listActive).mockResolvedValue([
      baseTask({
        id: 7,
        title: "提交季报",
        ddl_type: "hard",
        ddl_date: "2026-04-30",
      }),
    ]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("提交季报")).toBeInTheDocument(),
    );
    expect(screen.getByTitle("提交季报").textContent).toMatch(/⭐/);
  });

  it("renders hard DDL chip with strong red+white styling distinct from soft", async () => {
    vi.mocked(listActive).mockResolvedValue([
      baseTask({
        id: 10,
        title: "硬汇报",
        ddl_type: "hard",
        ddl_date: "2026-04-15",
      }),
      baseTask({
        id: 11,
        title: "软项目",
        ddl_type: "soft",
        ddl_set_at: "2026-04-25T00:00:00Z",
        ddl_duration_days: 7,
      }),
    ]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    await waitFor(() => screen.getByTitle("硬汇报"));
    const hardChip = screen.getByTitle("硬汇报");
    expect(hardChip.className).toMatch(/bg-red-600/);
    expect(hardChip.className).toMatch(/text-white/);
    expect(hardChip.className).toMatch(/font-semibold/);
    const softChips = screen.getAllByTitle("软项目");
    expect(softChips[0].className).not.toMatch(/bg-red-600/);
    expect(softChips[0].className).not.toMatch(/text-white/);
  });

  it("shows a soft DDL task only on the last 30% of its range", async () => {
    vi.mocked(listActive).mockResolvedValue([
      baseTask({
        id: 8,
        title: "学算法",
        ddl_type: "soft",
        ddl_set_at: "2026-04-25T00:00:00Z",
        ddl_duration_days: 7,
      }),
    ]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    await waitFor(() =>
      expect(screen.getAllByTitle("学算法").length).toBe(3),
    );
  });

  it("invokes onEditTask when a chip is clicked", async () => {
    const onEdit = vi.fn();
    vi.mocked(listActive).mockResolvedValue([
      baseTask({
        id: 9,
        title: "汇报",
        ddl_type: "hard",
        ddl_date: "2026-04-15",
      }),
    ]);
    render(
      <CalendarView dimension="all" onEditTask={onEdit} refreshKey={0} />,
    );
    await waitFor(() => screen.getByTitle("汇报"));
    fireEvent.click(screen.getByTitle("汇报"));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  it("navigates to next/previous month", async () => {
    vi.mocked(listActive).mockResolvedValue([]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByText(/2026 年 5 月/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    expect(screen.getByText(/2026 年 3 月/)).toBeInTheDocument();
  });

  it("shows holiday name in cell for known holiday day", async () => {
    vi.mocked(listActive).mockResolvedValue([]);
    render(
      <CalendarView dimension="all" onEditTask={() => {}} refreshKey={0} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    expect(screen.getByText(/2026 年 2 月/)).toBeInTheDocument();
    expect(screen.getAllByText("除夕").length).toBeGreaterThan(0);
  });
});
