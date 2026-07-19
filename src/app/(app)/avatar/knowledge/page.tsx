import {
  confirmAvatarKnowledgeAction,
  deleteAvatarKnowledgeAction,
  deleteAvatarSourceAction,
  toggleAvatarKnowledgeAction,
  updateAvatarKnowledgeAction
} from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export default async function AvatarKnowledgePage() {
  const user = await requireUser();
  const [pages, sources] = await Promise.all([
    prisma.avatarKnowledgePage.findMany({
      where: { userId: user.id },
      include: { citations: { include: { source: true } } },
      orderBy: [{ confirmationStatus: "desc" }, { updatedAt: "desc" }]
    }),
    prisma.avatarKnowledgeSource.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 知识层</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">分身知识库</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          这里保存分身对你的结构化理解。你可以查看来源，也可以随时修改、停用或删除。
        </p>
      </header>

      <section className="mb-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">知识条目</h2>
          <p className="text-xs text-muted">{pages.length} 条</p>
        </div>
        <div className="space-y-4">
          {pages.length ? pages.map((page) => {
            const pending = page.confirmationStatus === "PENDING";
            return (
              <article
                key={page.id}
                className={`card p-5 ${pending ? "ring-2 ring-amber-300" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{page.category}</span>
                  <span className={`chip ${pending ? "bg-amber-100 text-amber-900" : ""}`}>
                    {pending ? "待你确认" : page.enabled ? "已启用" : "已停用"}
                  </span>
                  <span className="text-xs text-muted">
                    置信度 {Math.round(page.confidence * 100)}%
                  </span>
                </div>

                <form action={updateAvatarKnowledgeAction} className="mt-4">
                  <input type="hidden" name="id" value={page.id} />
                  <input name="title" className="field font-semibold" defaultValue={page.title} required />
                  <textarea
                    name="content"
                    className="textarea mt-3 min-h-28"
                    defaultValue={page.content}
                    required
                  />
                  <button className="btn-secondary mt-3 h-10 px-4 text-xs" type="submit">
                    保存修改
                  </button>
                </form>

                <div className="mt-4 rounded-2xl bg-surface p-4">
                  <p className="text-xs font-semibold text-muted">来源</p>
                  <div className="mt-2 space-y-2">
                    {page.citations.length ? page.citations.map((citation) => (
                      <div key={citation.id} className="text-xs leading-5 text-muted">
                        <span className="font-semibold text-ink">
                          {citation.source.label || String(citation.source.kind)}
                        </span>
                        {" · "}
                        {citation.source.content.length > 100
                          ? `${citation.source.content.slice(0, 100)}...`
                          : citation.source.content}
                      </div>
                    )) : (
                      <p className="text-xs text-muted">暂无可追踪来源</p>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted">更新于 {formatRelativeTime(page.updatedAt)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {pending ? (
                    <form action={confirmAvatarKnowledgeAction}>
                      <input type="hidden" name="id" value={page.id} />
                      <button className="btn-primary h-10 px-4 text-xs">确认这条知识</button>
                    </form>
                  ) : null}
                  <form action={toggleAvatarKnowledgeAction}>
                    <input type="hidden" name="id" value={page.id} />
                    <button className="btn-secondary h-10 px-4 text-xs">
                      {page.enabled ? "停用" : "启用"}
                    </button>
                  </form>
                  <form action={deleteAvatarKnowledgeAction}>
                    <input type="hidden" name="id" value={page.id} />
                    <button className="btn-secondary h-10 px-4 text-xs text-red-600">删除</button>
                  </form>
                </div>
              </article>
            );
          }) : (
            <div className="soft-panel p-5 text-sm leading-6 text-muted">
              知识库还是空的。先前往“构建材料”选择内容并生成知识。
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">原始材料</h2>
            <p className="mt-1 text-xs text-muted">删除材料后，依赖它的知识会被重新评估。</p>
          </div>
          <p className="text-xs text-muted">{sources.length} 份</p>
        </div>
        <div className="space-y-3">
          {sources.map((source) => (
            <article key={source.id} className="soft-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip">{String(source.kind)}</span>
                    <span className="text-sm font-semibold">{source.label}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    {source.content.length > 160
                      ? `${source.content.slice(0, 160)}...`
                      : source.content}
                  </p>
                  <p className="mt-2 text-xs text-muted">{formatRelativeTime(source.createdAt)}</p>
                </div>
                <form action={deleteAvatarSourceAction}>
                  <input type="hidden" name="id" value={source.id} />
                  <button className="text-xs font-semibold text-red-600">删除</button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
