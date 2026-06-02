import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatePicker } from "./DatePicker";

describe("DatePicker", () => {
  it("renders the placeholder when no value is set", () => {
    render(<DatePicker value="" onChange={() => {}} placeholder="请选择" />);
    expect(screen.getByRole("button", { name: "选择日期" })).toHaveTextContent(
      "请选择",
    );
  });

  it("opens the calendar when trigger is clicked", () => {
    render(<DatePicker value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    expect(screen.getByRole("dialog", { name: "日期选择" })).toBeInTheDocument();
  });

  it("calls onChange with selected date and closes", () => {
    const onChange = vi.fn();
    render(<DatePicker value="2026-02-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    const cell = screen.getByRole("button", { name: /^17/ });
    fireEvent.click(cell);
    expect(onChange).toHaveBeenCalledWith("2026-02-17");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks 春节 cells with the holiday name", () => {
    render(<DatePicker value="2026-02-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("春节");
    expect(dialog.textContent).toContain("除夕");
  });

  it("marks 调休 cells with 班 tag", () => {
    render(<DatePicker value="2026-02-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    const cell = screen.getByRole("button", { name: /14班/ });
    expect(cell).toBeInTheDocument();
  });

  it("can navigate to next/previous month", () => {
    render(<DatePicker value="2026-02-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    expect(screen.getByText(/2026 年 2 月/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByText(/2026 年 3 月/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    fireEvent.click(screen.getByRole("button", { name: "上个月" }));
    expect(screen.getByText(/2026 年 1 月/)).toBeInTheDocument();
  });

  it("shows 数据待补充 banner for years without holiday data", () => {
    render(<DatePicker value="2027-03-15" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "选择日期" }));
    expect(screen.getByText(/2027 节假日数据待补充/)).toBeInTheDocument();
  });
});
