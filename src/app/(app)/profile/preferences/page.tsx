import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function PreferencesPage() {
  const user = await requireUser();
  const preferences = await prisma.preference.findMany({
    where: { userId: user.id },
    orderBy: [{ category: "asc" }, { value: "asc" }]
  });
  const groups = preferences.reduce<Record<string, typeof preferences>>((acc, item) => {
    acc[item.category] = [...(acc[item.category] || []), item];
    return acc;
  }, {});

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">偏好设置</h1>
      </header>
      <div className="space-y-4">
        {Object.entries(groups).map(([category, items]) => (
          <section key={category} className="card p-5">
            <h2 className="text-lg font-semibold">{category}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {items.map((item) => (
                <span key={item.id} className={`chip ${item.enabled ? "" : "opacity-50"}`}>
                  {item.value}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
