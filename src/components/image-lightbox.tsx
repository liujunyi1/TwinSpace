"use client";

import { useState } from "react";
import { X } from "lucide-react";

export function ImageLightbox({
  images,
  alt = "动态图片"
}: {
  images: string[];
  alt?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeImage = activeIndex === null ? null : images[activeIndex];

  if (images.length === 0) return null;

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {images.slice(0, 4).map((url, index) => (
          <button
            key={url}
            type="button"
            onClick={() => setActiveIndex(index)}
            className="relative overflow-hidden rounded-3xl bg-surface text-left"
            aria-label={`查看第 ${index + 1} 张图片`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={alt} className="aspect-square w-full object-cover" />
            {index === 3 && images.length > 4 ? (
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-lg font-semibold text-white">
                +{images.length - 4}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {activeImage ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveIndex(null)}
        >
          <button
            type="button"
            onClick={() => setActiveIndex(null)}
            className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white"
            aria-label="关闭图片预览"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeImage}
            alt={alt}
            className="max-h-[86vh] max-w-full rounded-[24px] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          {images.length > 1 ? (
            <div className="absolute bottom-6 flex gap-2 rounded-full bg-white/15 px-3 py-2 text-xs text-white">
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveIndex(index);
                  }}
                  className={`h-2 w-2 rounded-full ${index === activeIndex ? "bg-white" : "bg-white/40"}`}
                  aria-label={`切换到第 ${index + 1} 张图片`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
