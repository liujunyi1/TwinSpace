import { buildAvatarKnowledgeAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelativeTime } from "@/lib/utils";

function preview(content: string) {
  return content.length > 120 ? `${content.slice(0, 120)}...` : content;
}

export default async function AvatarBuildPage() {
  const user = await requireUser();
  const [personality, posts, messages, memories, selectedSources] = await Promise.all([
    prisma.personalityProfile.findUnique({ where: { userId: user.id } }),
    prisma.post.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.message.findMany({
      where: { senderId: user.id, senderMode: "HUMAN" },
      orderBy: { createdAt: "desc" },
      take: 30
    }),
    prisma.memory.findMany({
      where: { userId: user.id, enabled: true, status: "CONFIRMED" },
      orderBy: { updatedAt: "desc" },
      take: 30
    }),
    prisma.avatarKnowledgeSource.findMany({
      where: { userId: user.id, enabled: true },
      select: { kind: true, sourceKey: true }
    })
  ]);
  const selected = new Set(
    selectedSources.map((source) => `${String(source.kind)}:${source.sourceKey}`)
  );

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 第一步</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">选择构建材料</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          只有你主动选择的内容会进入分身知识库。聊天素材只包含你本人发出的消息。
        </p>
      </header>

      <section className="card mb-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">人格画像</h2>
            <p className="mt-1 text-xs text-muted">固定基础材料 · 始终纳入</p>
          </div>
          <span className="chip">必选</span>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">
          {personality?.summary || "尚未生成画像，请先完成注册问卷。"}
        </p>
      </section>

      <form action={buildAvatarKnowledgeAction} className="space-y-5">
        <section>
          <h2 className="mb-3 text-lg font-semibold">我的帖子</h2>
          <div className="space-y-3">
            {posts.length ? posts.map((post) => (
              <label key={post.id} className="soft-panel flex cursor-pointer items-start gap-3 p-4">
                <input
                  className="mt-1"
                  type="checkbox"
                  name="source"
                  value={`POST:${post.id}`}
                  defaultChecked={selected.has(`POST:${post.id}`)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-6">{preview(post.content)}</span>
                  <span className="mt-1 block text-xs text-muted">{formatRelativeTime(post.createdAt)}</span>
                </span>
              </label>
            )) : (
              <div className="soft-panel p-4 text-sm text-muted">还没有可选择的帖子。</div>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">我发出的消息</h2>
          <div className="space-y-3">
            {messages.length ? messages.map((message) => (
              <label key={message.id} className="soft-panel flex cursor-pointer items-start gap-3 p-4">
                <input
                  className="mt-1"
                  type="checkbox"
                  name="source"
                  value={`MESSAGE:${message.id}`}
                  defaultChecked={selected.has(`MESSAGE:${message.id}`)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-6">{preview(message.content)}</span>
                  <span className="mt-1 block text-xs text-muted">{formatRelativeTime(message.createdAt)}</span>
                </span>
              </label>
            )) : (
              <div className="soft-panel p-4 text-sm text-muted">还没有可选择的真人消息。</div>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">已确认的事实记忆</h2>
          <div className="space-y-3">
            {memories.length ? memories.map((memory) => (
              <label key={memory.id} className="soft-panel flex cursor-pointer items-start gap-3 p-4">
                <input
                  className="mt-1"
                  type="checkbox"
                  name="source"
                  value={`MEMORY:${memory.id}`}
                  defaultChecked={selected.has(`MEMORY:${memory.id}`)}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-semibold text-muted">{memory.type}</span>
                  <span className="mt-1 block text-sm leading-6">{preview(memory.content)}</span>
                </span>
              </label>
            )) : (
              <div className="soft-panel p-4 text-sm text-muted">还没有已确认且启用的事实记忆。</div>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-lg font-semibold">补充表达样本</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            可以粘贴几段你真实说过的话。不要粘贴他人的隐私内容。
          </p>
          <textarea
            name="manualSample"
            className="textarea mt-4 min-h-36"
            placeholder="例如：我平时如何打招呼、安慰朋友、拒绝请求……"
          />
        </section>

        <button className="btn-primary w-full" type="submit">
          构建并整理知识库
        </button>
      </form>
    </main>
  );
}
