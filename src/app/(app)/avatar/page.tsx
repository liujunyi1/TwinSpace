import Link from "next/link";
import { BookOpen, Bot, ChevronRight, CircleCheck, MessagesSquare, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function statusLabel(status?: string) {
  if (status === "ACTIVE") return "已激活";
  if (status === "PAUSED") return "已暂停";
  if (status === "CALIBRATING") return "校准中";
  if (status === "KNOWLEDGE_READY") return "等待校准";
  if (status === "BUILDING") return "构建中";
  return "尚未构建";
}

export default async function AvatarPage() {
  const user = await requireUser();
  const [avatarProfile, sourceCount, knowledgeCount, confirmedKnowledgeCount, calibrationCases] =
    await Promise.all([
      prisma.avatarProfile.findUnique({ where: { userId: user.id } }),
      prisma.avatarKnowledgeSource.count({ where: { userId: user.id, enabled: true } }),
      prisma.avatarKnowledgePage.count({ where: { userId: user.id, enabled: true } }),
      prisma.avatarKnowledgePage.count({
        where: { userId: user.id, enabled: true, confirmationStatus: "CONFIRMED" }
      }),
      prisma.avatarCalibrationCase.findMany({
        where: { userId: user.id },
        select: { kind: true, status: true, knowledgeRevision: true }
      })
    ]);

  const revision = avatarProfile?.knowledgeRevision ?? 0;
  const calibratedCount = calibrationCases.filter(
    (item) => item.status === "APPROVED" && item.knowledgeRevision === revision
  ).length;
  const chatReady = avatarProfile?.status === "ACTIVE" || avatarProfile?.status === "PAUSED";
  const primaryHref = chatReady
    ? "/avatar/chat"
    : sourceCount === 0 || knowledgeCount === 0
      ? "/avatar/build"
      : "/avatar/calibration";
  const primaryLabel = chatReady
    ? "和分身聊聊"
    : sourceCount === 0
      ? "开始构建"
      : knowledgeCount === 0
        ? "继续构建"
        : "继续校准";

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">我的 AI 分身</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          选择真正代表你的材料，检查分身形成的知识，再通过四类场景完成校准。
        </p>
      </header>

      <section className="relative overflow-hidden rounded-[32px] bg-ink p-6 text-white shadow-soft">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10" />
        <div className="relative flex items-start gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[30%] bg-white/12">
            <Bot className="h-8 w-8" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">
                {avatarProfile?.privateName || `${user.nickname} 的分身`}
              </h2>
              <span className="rounded-full bg-white/12 px-3 py-1 text-xs">
                {statusLabel(avatarProfile?.status)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60">
              知识版本 {revision} · {sourceCount} 份素材 · {knowledgeCount} 条知识
            </p>
          </div>
        </div>
        <Link
          href={primaryHref}
          className="relative mt-6 flex h-12 items-center justify-center gap-2 rounded-full bg-white font-semibold text-ink"
        >
          {primaryLabel}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      <section className="mt-5 grid grid-cols-3 gap-3">
        <div className="soft-panel p-4 text-center">
          <p className="text-2xl font-semibold">{sourceCount}</p>
          <p className="mt-1 text-xs text-muted">已选素材</p>
        </div>
        <div className="soft-panel p-4 text-center">
          <p className="text-2xl font-semibold">{confirmedKnowledgeCount}</p>
          <p className="mt-1 text-xs text-muted">确认知识</p>
        </div>
        <div className="soft-panel p-4 text-center">
          <p className="text-2xl font-semibold">{calibratedCount}/4</p>
          <p className="mt-1 text-xs text-muted">通过校准</p>
        </div>
      </section>

      <section className="mt-5 space-y-3">
        <Link href="/avatar/build" className="soft-panel flex items-center gap-4 px-5 py-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-surface">
            <Sparkles className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">构建材料</h2>
            <p className="mt-1 text-sm text-muted">选择帖子、本人消息、记忆或表达样本</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
        </Link>

        <Link href="/avatar/knowledge" className="soft-panel flex items-center gap-4 px-5 py-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-surface">
            <BookOpen className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">分身知识库</h2>
            <p className="mt-1 text-sm text-muted">查看、修改和追踪分身对你的理解</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
        </Link>

        <Link href="/avatar/calibration" className="soft-panel flex items-center gap-4 px-5 py-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-surface">
            <CircleCheck className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">场景校准</h2>
            <p className="mt-1 text-sm text-muted">日常聊天、安慰、拒绝和动态评论</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
        </Link>

        {chatReady ? (
          <Link href="/avatar/chat" className="soft-panel flex items-center gap-4 px-5 py-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-surface">
              <MessagesSquare className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">和分身聊聊</h2>
              <p className="mt-1 text-sm text-muted">直接体验当前知识版本的表达</p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
          </Link>
        ) : null}
      </section>
    </main>
  );
}
