// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let originalRequestSubmit: HTMLFormElement["requestSubmit"];

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  HTMLFormElement.prototype.requestSubmit = function requestSubmitForTest() {
    this.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  };
});

afterAll(() => {
  HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
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

describe("ConfirmSubmitButton", () => {
  it("opens a custom confirmation dialog before submitting", () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form>
        <ConfirmSubmitButton message="确定删除这条评论吗？" />
      </form>
    );
    document.querySelector("form")?.addEventListener("submit", onSubmit);

    act(() => {
      document.querySelector("button")?.click();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "确定删除这条评论吗？"
    );
  });

  it("does not submit when the custom dialog is cancelled", () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form>
        <ConfirmSubmitButton message="确定删除这条评论吗？" />
      </form>
    );
    document.querySelector("form")?.addEventListener("submit", onSubmit);

    act(() => {
      document.querySelector("button")?.click();
    });
    act(() => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "取消")
        ?.click();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("submits exactly once after the user confirms", () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form>
        <ConfirmSubmitButton message="确定删除这条评论吗？" />
      </form>
    );
    document.querySelector("form")?.addEventListener("submit", onSubmit);

    act(() => {
      document.querySelector("button")?.click();
    });
    act(() => {
      const buttons = Array.from(
        document.querySelector('[role="dialog"]')?.querySelectorAll("button") || []
      );
      buttons.at(-1)?.click();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
