"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";

type Preview = {
  name: string;
  url: string;
};

export function PostImageInput() {
  const [previews, setPreviews] = useState<Preview[]>([]);

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  return (
    <label className="block rounded-[24px] bg-surface p-3 text-sm text-muted">
      <span className="mb-3 flex items-center gap-2 px-1 font-medium text-ink">
        <ImageIcon className="h-4 w-4" aria-hidden />
        上传图片（最多 9 张）
      </span>
      <input
        name="imageFiles"
        className="block w-full rounded-2xl bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(event) => {
          previews.forEach((preview) => URL.revokeObjectURL(preview.url));
          const files = Array.from(event.target.files || []).slice(0, 9);
          setPreviews(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
        }}
      />
      <span className="mt-2 block px-1 text-xs">支持 JPG、PNG、WebP、GIF，单张不超过 5MB。</span>
      {previews.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {previews.map((preview) => (
            <div key={preview.url} className="relative overflow-hidden rounded-2xl bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={preview.name} className="aspect-square w-full object-cover" />
              <span className="absolute bottom-1 left-1 right-1 truncate rounded-full bg-black/45 px-2 py-1 text-[10px] text-white">
                {preview.name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 grid min-h-24 place-items-center rounded-2xl border border-dashed border-line bg-white/60 text-xs text-muted">
          选择图片后会在这里预览
        </div>
      )}
    </label>
  );
}
