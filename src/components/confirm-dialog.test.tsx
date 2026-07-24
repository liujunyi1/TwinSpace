// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog } from "@/components/confirm-dialog";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
});

function render(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(ui);
  });
  return container;
}

describe("ConfirmDialog", () => {
  it("does not render a dialog while closed", () => {
    render(
      <ConfirmDialog
        open={false}
        message="确定删除吗？"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("calls cancel and confirm callbacks from the custom dialog buttons", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        message="确定删除吗？"
        title="确认删除"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("确定删除吗？");

    const buttons = Array.from(document.querySelectorAll("button"));
    act(() => {
      buttons.find((button) => button.textContent === "取消")?.click();
    });
    act(() => {
      buttons.find((button) => button.textContent === "删除")?.click();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes through Escape and backdrop clicks", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        message="确定删除吗？"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    act(() => {
      document
        .querySelector('[role="presentation"]')
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
