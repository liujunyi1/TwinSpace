import { FileText } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-[32px] bg-white/70 px-8 py-12 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-surface text-muted">
          <FileText className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-base font-semibold text-ink">{title}</p>
        {description ? <p className="mt-2 text-sm leading-6 text-muted">{description}</p> : null}
      </div>
    </div>
  );
}
