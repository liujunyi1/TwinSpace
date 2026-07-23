"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function ConfirmSubmitButton({
  message,
  label = "删除"
}: {
  message: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const confirmedRef = useRef(false);

  const confirmSubmit = () => {
    const form = formRef.current ?? buttonRef.current?.form;
    setOpen(false);
    if (form) {
      confirmedRef.current = true;
      form.requestSubmit(buttonRef.current ?? undefined);
      window.setTimeout(() => {
        confirmedRef.current = false;
      }, 0);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="submit"
        onClick={(event) => {
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          event.preventDefault();
          formRef.current = event.currentTarget.form;
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
      <ConfirmDialog
        open={open}
        message={message}
        onConfirm={confirmSubmit}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
