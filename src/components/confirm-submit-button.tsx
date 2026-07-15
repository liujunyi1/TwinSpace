"use client";

import { Trash2 } from "lucide-react";

export function ConfirmSubmitButton({
  message,
  label = "删除"
}: {
  message: string;
  label?: string;
}) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-red-600"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
