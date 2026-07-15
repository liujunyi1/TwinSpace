export function TopBar({
  title,
  muted,
  action
}: {
  title: string;
  muted?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex items-center justify-between">
      <div className="flex items-baseline gap-4">
        <h1 className="text-[34px] font-semibold leading-none tracking-normal text-ink">{title}</h1>
        {muted ? <span className="text-[28px] font-semibold text-muted/45">{muted}</span> : null}
      </div>
      {action}
    </header>
  );
}
