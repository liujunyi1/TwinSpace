import {
  addMemoryAction,
  confirmMemoryAction,
  deleteMemoryAction,
  toggleMemoryAction
} from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

export default async function MemoriesPage() {
  const user = await requireUser();
  const memories = await prisma.memory.findMany({
    where: { userId: user.id },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }]
  });

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">事实记忆</h1>
      </header>

      <form action={addMemoryAction} className="card mb-5 p-5">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <input name="content" className="field" placeholder="新增一条记忆" required />
          <button className="btn-primary h-12 px-5">新增</button>
        </div>
        <select name="type" className="field mt-3">
          <option>基本事实</option>
          <option>兴趣偏好</option>
          <option>人际关系</option>
          <option>长期目标</option>
          <option>近期事件</option>
          <option>表达习惯</option>
          <option>明确禁忌</option>
        </select>
      </form>

      <div className="space-y-3">
        {memories.map((memory) => (
          <article key={memory.id} className="soft-panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{memory.type}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{memory.content}</p>
                <p className="mt-2 text-xs text-muted">
                  {memory.sourceType} · 置信度 {Math.round(memory.confidence * 100)}% · {formatRelativeTime(memory.createdAt)}
                </p>
              </div>
              <span className="chip">{memory.status === "PENDING" ? "待确认" : memory.enabled ? "启用" : "停用"}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {memory.status === "PENDING" ? (
                <form action={confirmMemoryAction}>
                  <input type="hidden" name="id" value={memory.id} />
                  <button className="btn-secondary h-9 px-3 text-xs">确认</button>
                </form>
              ) : null}
              <form action={toggleMemoryAction}>
                <input type="hidden" name="id" value={memory.id} />
                <button className="btn-secondary h-9 px-3 text-xs">{memory.enabled ? "停用" : "启用"}</button>
              </form>
              <form action={deleteMemoryAction}>
                <input type="hidden" name="id" value={memory.id} />
                <button className="btn-secondary h-9 px-3 text-xs text-red-600">删除</button>
              </form>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
