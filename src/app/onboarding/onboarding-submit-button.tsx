"use client";

import { useFormStatus } from "react-dom";

export function OnboardingSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="btn-primary w-full disabled:cursor-wait disabled:opacity-70"
      type="submit"
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden />
          正在生成并保存画像...
        </span>
      ) : (
        "生成并保存画像"
      )}
    </button>
  );
}
