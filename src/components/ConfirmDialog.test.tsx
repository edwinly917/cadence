import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const baseProps = {
    title: "删除任务",
    message: "确定吗？",
    onConfirm: () => {},
    onCancel: () => {},
  };

  it("does not render when open=false", () => {
    render(<ConfirmDialog open={false} {...baseProps} />);
    expect(screen.queryByText("删除任务")).not.toBeInTheDocument();
  });

  it("renders title and message when open=true", () => {
    render(<ConfirmDialog open={true} {...baseProps} />);
    expect(screen.getByText("删除任务")).toBeInTheDocument();
    expect(screen.getByText("确定吗？")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        {...baseProps}
        onConfirm={onConfirm}
        confirmLabel="删除"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape pressed", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Enter pressed", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open={true} {...baseProps} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("destructive variant renders red confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        {...baseProps}
        destructive
        confirmLabel="删除"
      />,
    );
    const btn = screen.getByRole("button", { name: "删除" });
    expect(btn.className).toMatch(/bg-red-600/);
  });

  it("non-destructive variant uses dark gray confirm button", () => {
    render(
      <ConfirmDialog
        open={true}
        {...baseProps}
        confirmLabel="导入"
      />,
    );
    const btn = screen.getByRole("button", { name: "导入" });
    expect(btn.className).toMatch(/bg-gray-900/);
  });

  it("clicking the overlay calls onCancel", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} {...baseProps} onCancel={onCancel} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking inside the modal box does not trigger cancel", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open={true} {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("确定吗？"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
