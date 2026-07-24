// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentForm } from "@/components/comment-form";

const mocks = vi.hoisted(() => ({
  createCommentAction: vi.fn()
}));

vi.mock("@/app/actions", () => ({
  createCommentAction: mocks.createCommentAction
}));

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
  vi.clearAllMocks();
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

describe("CommentForm", () => {
  it("clears the input after a comment is submitted successfully", async () => {
    mocks.createCommentAction.mockResolvedValue(undefined);
    render(<CommentForm postId="post-1" />);

    const input = document.querySelector<HTMLInputElement>('input[name="content"]');
    const form = document.querySelector("form");
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();

    input!.value = "加油";
    await act(async () => {
      form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.createCommentAction).toHaveBeenCalledTimes(1);
    expect(mocks.createCommentAction.mock.calls[0][0].get("content")).toBe("加油");
    expect(input!.value).toBe("");
  });

  it("does not submit an empty comment", async () => {
    render(<CommentForm postId="post-1" />);

    await act(async () => {
      document
        .querySelector("form")!
        .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.createCommentAction).not.toHaveBeenCalled();
  });
});
