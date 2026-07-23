"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";

export function AvatarUploadInput({
  name = "avatarFile",
  label,
  previewName,
  currentSrc
}: {
  name?: string;
  label: string;
  previewName: string;
  currentSrc?: string | null;
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(currentSrc || null);

  useEffect(() => {
    setPreviewSrc(currentSrc || null);
  }, [currentSrc]);

  useEffect(() => {
    if (!previewSrc?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(previewSrc);
  }, [previewSrc]);

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-3">
        <Avatar name={previewName} src={previewSrc} size="lg" />
        <input
          name={name}
          className="min-w-0 flex-1 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setPreviewSrc(file ? URL.createObjectURL(file) : currentSrc || null);
          }}
        />
      </div>
    </label>
  );
}
