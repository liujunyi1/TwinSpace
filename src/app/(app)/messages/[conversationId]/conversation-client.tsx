"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Pencil,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import {
  cancelAgentTaskAction,
  deleteAgentMessageAction,
  generateAssistDraftAction,
  hideAgentMessageAction,
  retryAgentTaskAction,
  sendAssistDraftAction,
  sendHumanChatMessageAction,
  takeOverAgentTaskAction,
  updateConversationAgentSettingsAction
} from "@/app/agent-actions";
import { AgentScheduleEditor } from "@/components/agent-schedule-editor";
import { Avatar } from "@/components/avatar";
import {
  delayLabel,
  modeLabel,
  type AgentActiveWindowMode,
  type AgentDelayOverride,
  type AgentModeOverride,
  type AgentTaskView,
  type ConversationAgentStateView
} from "@/lib/client/agent-view-models";
import { cn, formatRelativeTime } from "@/lib/utils";

export type ConversationMessageView = {
  id: string;
  senderId: string | null;
  senderName: string;
  senderAvatarUrl: string | null;
  content: string;
  senderMode: string;
  createdAt: string;
};

type ConversationClientProps = {
  conversationId: string;
  conversationType: string;
  title: string;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatarUrl: string | null;
  otherAvatarUrl: string | null;
  initialMessages: ConversationMessageView[];
  initialAgentState: ConversationAgentStateView;
  agentConfigurable: boolean;
};

type AssistStatus = "idle" | "generating" | "stopped" | "error";

const MODE_OVERRIDES: AgentModeOverride[] = ["INHERIT", "MANUAL", "ASSIST", "PROXY"];
const DELAY_OVERRIDES: AgentDelayOverride[] = [
  "INHERIT",
  "IMMEDIATE",
  "SHORT",
  "LONG",
  "CUSTOM"
];
const WINDOW_MODES: AgentActiveWindowMode[] = ["INHERIT", "ALWAYS", "CUSTOM"];

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "44px";
  const nextHeight = Math.min(element.scrollHeight, 124);
  element.style.height = `${nextHeight}px`;
  element.style.overflowY = element.scrollHeight > 124 ? "auto" : "hidden";
}

function remainingTime(target: string | null, now: number) {
  if (!target) return null;
  const seconds = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

function agentMessageLabel(senderMode: string) {
  if (senderMode === "AI_ASSISTED") return "AI 辅助生成";
  if (senderMode === "AI_PROXY") return "AI 分身代理";
  if (senderMode === "AI") return "AI 联系人";
  return null;
}

export function ConversationClient({
  conversationId,
  conversationType,
  title,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  otherAvatarUrl,
  initialMessages,
  initialAgentState,
  agentConfigurable
}: ConversationClientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [agentState, setAgentState] = useState(initialAgentState);
  const [settingsDraft, setSettingsDraft] = useState(initialAgentState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [assistStatus, setAssistStatus] = useState<AssistStatus>("idle");
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistTaskId, setAssistTaskId] = useState<string | null>(null);
  const [draftTaskId, setDraftTaskId] = useState<string | null>(null);
  const [draftOriginal, setDraftOriginal] = useState("");
  const [draftEdited, setDraftEdited] = useState(false);
  const [taskActionId, setTaskActionId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const generationRef = useRef(0);

  useEffect(() => setMessages(initialMessages), [initialMessages]);
  useEffect(() => {
    setAgentState(initialAgentState);
    if (!settingsOpen) setSettingsDraft(initialAgentState);
  }, [initialAgentState, settingsOpen]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const hasLiveTasks = agentState.tasks.some((task) =>
      task.status === "PENDING" || task.status === "RUNNING" || task.status === "READY"
    );
    if (!hasLiveTasks && agentState.effectiveMode !== "PROXY" && assistStatus !== "generating") {
      return;
    }
    const refresh = window.setInterval(() => router.refresh(), 3500);
    return () => window.clearInterval(refresh);
  }, [agentState.effectiveMode, agentState.tasks, assistStatus, router]);

  useEffect(() => {
    const readyAssist = initialAgentState.tasks.find(
      (task) =>
        task.status === "READY" &&
        task.draft &&
        (task.kind === "ASSIST" || task.kind === "ASSIST_DRAFT")
    );
    if (readyAssist && !draftTaskId && !input) {
      setDraftTaskId(readyAssist.id);
      setDraftOriginal(readyAssist.draft || "");
      setDraftEdited(false);
      setInput(readyAssist.draft || "");
      setAssistTaskId(readyAssist.id);
      setAssistStatus("idle");
      window.requestAnimationFrame(() => resizeTextarea(textareaRef.current));
    }

    const tracked = assistTaskId
      ? initialAgentState.tasks.find((task) => task.id === assistTaskId)
      : null;
    if (tracked?.status === "FAILED") {
      setAssistStatus("error");
      setAssistError(tracked.error || tracked.reason || "草稿生成失败");
    }
  }, [initialAgentState.tasks, assistTaskId, draftTaskId, input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, agentState.tasks]);

  const resetComposer = () => {
    setInput("");
    setDraftTaskId(null);
    setDraftOriginal("");
    setDraftEdited(false);
    setAssistTaskId(null);
    setAssistStatus("idle");
    setAssistError(null);
    window.requestAnimationFrame(() => resizeTextarea(textareaRef.current));
  };

  const loadTaskDraft = (task: AgentTaskView) => {
    const draft = task.draft || "";
    setDraftTaskId(task.id);
    setDraftOriginal(draft);
    setDraftEdited(false);
    setInput(draft);
    setAssistTaskId(task.id);
    setAssistStatus("idle");
    window.requestAnimationFrame(() => {
      resizeTextarea(textareaRef.current);
      textareaRef.current?.focus();
    });
  };

  const generateAssistDraft = async () => {
    if (assistStatus === "generating") return;
    const generation = ++generationRef.current;
    setAssistStatus("generating");
    setAssistError(null);
    setToast(null);
    try {
      const result = await generateAssistDraftAction(conversationId);
      if (generation !== generationRef.current) {
        if (result.taskId) await cancelAgentTaskAction(result.taskId);
        return;
      }
      if (!result.ok) {
        setAssistStatus("error");
        setAssistError(result.error || "草稿生成失败");
        return;
      }
      if (result.taskId) setAssistTaskId(result.taskId);
      if (result.taskId && result.draft) {
        setDraftTaskId(result.taskId);
        setDraftOriginal(result.draft);
        setDraftEdited(false);
        setInput(result.draft);
        setAssistStatus("idle");
        window.requestAnimationFrame(() => resizeTextarea(textareaRef.current));
      } else {
        router.refresh();
      }
    } catch (error) {
      if (generation === generationRef.current) {
        setAssistStatus("error");
        setAssistError(error instanceof Error ? error.message : "草稿生成失败");
      }
    }
  };

  const stopAssistDraft = async () => {
    generationRef.current += 1;
    setAssistStatus("stopped");
    setAssistError(null);
    if (!assistTaskId) return;
    const result = await cancelAgentTaskAction(assistTaskId);
    if (!result.ok) setAssistError(result.error || "停止任务失败");
    router.refresh();
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setToast(null);

    try {
      let result: { ok: boolean; error?: string };
      let optimisticMode = "HUMAN";
      if (draftTaskId && !draftEdited && content === draftOriginal) {
        result = await sendAssistDraftAction({ taskId: draftTaskId, content });
        const task = agentState.tasks.find((item) => item.id === draftTaskId);
        optimisticMode =
          task?.kind === "PROXY" || task?.kind === "PROXY_REPLY"
            ? "AI_PROXY"
            : "AI_ASSISTED";
      } else {
        if (draftTaskId) {
          const takeOver = await takeOverAgentTaskAction(draftTaskId);
          if (!takeOver.ok) {
            setToast(takeOver.error || "接管草稿失败");
            return;
          }
        }
        result = await sendHumanChatMessageAction({ conversationId, content });
      }

      if (!result.ok) {
        setToast(result.error || "消息发送失败");
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: `local-${Date.now()}`,
          senderId: currentUserId,
          senderName: currentUserName,
          senderAvatarUrl: currentUserAvatarUrl,
          content,
          senderMode: optimisticMode,
          createdAt: new Date().toISOString()
        }
      ]);
      resetComposer();
      router.refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "消息发送失败");
    } finally {
      setSending(false);
    }
  };

  const cancelTask = async (task: AgentTaskView) => {
    setTaskActionId(task.id);
    const result = await cancelAgentTaskAction(task.id);
    setTaskActionId(null);
    if (!result.ok) {
      setToast(result.error || "取消任务失败");
      return;
    }
    if (draftTaskId === task.id) resetComposer();
    setAgentState((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id)
    }));
    router.refresh();
  };

  const retryTask = async (task: AgentTaskView) => {
    setTaskActionId(task.id);
    const result = await retryAgentTaskAction(task.id);
    setTaskActionId(null);
    if (!result.ok) {
      setToast(result.error || "重试失败");
      return;
    }
    router.refresh();
  };

  const removeAgentMessage = async (message: ConversationMessageView) => {
    const owner = message.senderId === currentUserId;
    if (
      owner &&
      !window.confirm("将从双方界面无痕删除这条 AI 内容。确定继续吗？")
    ) {
      return;
    }
    const result = owner
      ? await deleteAgentMessageAction(message.id)
      : await hideAgentMessageAction(message.id);
    if (!result.ok) {
      setToast(result.error || "删除失败");
      return;
    }
    setMessages((current) => current.filter((item) => item.id !== message.id));
    setToast(owner ? "已从双方界面删除" : "已仅为你隐藏");
    router.refresh();
  };

  const saveConversationSettings = async () => {
    setSettingsSaving(true);
    setToast(null);
    const result = await updateConversationAgentSettingsAction({
      conversationId,
      modeOverride: settingsDraft.modeOverride,
      delayOverride: settingsDraft.delayOverride,
      customDelaySeconds: settingsDraft.customDelaySeconds,
      activeWindowMode: settingsDraft.activeWindowMode,
      activeWindows: settingsDraft.activeWindows,
      receiveAiFromContact: settingsDraft.receiveAiFromContact
    });
    setSettingsSaving(false);
    if (!result.ok) {
      setToast(result.error || "会话设置保存失败");
      return;
    }
    setSettingsOpen(false);
    router.refresh();
  };

  const policyProblem =
    agentConfigurable && agentState.effectiveMode !== "MANUAL"
      ? !agentState.avatarActive
        ? "分身尚未激活，当前会话只能手动发送。"
        : !agentState.globalEnabled
          ? "全局代理已暂停，当前会话不会生成或自动发送。"
          : !agentState.workerOnline
            ? "后台 Worker 离线，辅助和托管任务暂时不会执行。"
            : !agentState.recipientAllowsAi
              ? "对方拒绝接收 AI 代理内容，当前会话已强制回到手动模式。"
              : agentState.blockReason
      : null;
  const canGenerateAssist = !policyProblem && agentState.effectiveMode === "ASSIST";
  const activeTasks = agentState.tasks.filter(
    (task) =>
      task.id !== draftTaskId &&
      (task.status === "PENDING" ||
        task.status === "RUNNING" ||
        task.status === "READY" ||
        task.status === "FAILED")
  );

  return (
    <main
      className="page-shell flex w-full flex-col overflow-hidden"
      style={{
        height: "100dvh",
        paddingTop: "max(0.5rem, env(safe-area-inset-top))",
        paddingBottom: "calc(6.5rem + env(safe-area-inset-bottom))"
      }}
    >
      <header className="sticky top-0 z-20 flex flex-none items-center justify-between gap-3 bg-white/85 py-3 backdrop-blur">
        <Link
          href="/messages"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white"
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          <p className="text-xs text-muted">
            {conversationType === "AI_CONTACT"
              ? "独立 AI 联系人"
              : `${modeLabel(agentState.effectiveMode)} · ${
                  agentState.modeOverride === "INHERIT" ? "继承全局" : "本会话覆盖"
                }`}
          </p>
        </div>
        {agentConfigurable ? (
          <button
            type="button"
            onClick={() => {
              setSettingsDraft(agentState);
              setSettingsOpen(true);
            }}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-xs font-semibold"
            aria-label="会话代理设置"
          >
            {modeLabel(agentState.effectiveMode)}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
        )}
      </header>

      {policyProblem ? (
        <div className="mb-2 flex-none rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {policyProblem}
        </div>
      ) : null}
      {toast ? (
        <button
          type="button"
          onClick={() => setToast(null)}
          className="mb-2 flex-none rounded-2xl bg-ink px-4 py-3 text-left text-xs text-white"
        >
          {toast}
        </button>
      ) : null}

      <section
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-1"
        aria-live="polite"
      >
        {messages.map((message) => {
          const mine = message.senderId === currentUserId;
          const label = agentMessageLabel(message.senderMode);
          const managedAgentMessage =
            message.senderMode === "AI_ASSISTED" || message.senderMode === "AI_PROXY";
          return (
            <div key={message.id} className={cn("flex gap-2", mine && "justify-end")}>
              {!mine ? (
                <Avatar
                  name={message.senderName || title}
                  src={message.senderAvatarUrl || otherAvatarUrl}
                  size="sm"
                />
              ) : null}
              <div className={cn("max-w-[78%]", mine && "text-right")}>
                <div
                  className={cn(
                    "rounded-[24px] px-4 py-3 text-left text-sm leading-6",
                    mine ? "bg-ink text-white" : "bg-white text-ink"
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {label ? (
                    <span
                      className={cn(
                        "mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        mine ? "bg-white/15 text-white" : "bg-surface text-muted"
                      )}
                    >
                      {label}
                    </span>
                  ) : null}
                </div>
                <div className={cn("mt-1 flex items-center gap-2 text-[11px] text-muted", mine && "justify-end")}>
                  <span>{formatRelativeTime(new Date(message.createdAt))}</span>
                  {managedAgentMessage ? (
                    <button
                      type="button"
                      onClick={() => void removeAgentMessage(message)}
                      className="font-semibold text-red-600"
                    >
                      {mine ? "双方无痕删除" : "仅为我隐藏"}
                    </button>
                  ) : null}
                </div>
              </div>
              {mine ? <Avatar name={currentUserName} src={currentUserAvatarUrl} size="sm" /> : null}
            </div>
          );
        })}

        {activeTasks.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted">仅你可见的代理任务</p>
            {activeTasks.map((task) => {
              const remaining = remainingTime(task.scheduledFor, now);
              return (
                <article key={task.id} className="rounded-[24px] border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">
                        {task.status === "READY"
                          ? "草稿已就绪"
                          : task.status === "FAILED"
                            ? "任务失败"
                            : "等待发送"}
                      </p>
                      <p className="mt-1 text-xs text-muted">{task.kind}</p>
                    </div>
                    {remaining ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        {remaining}
                      </span>
                    ) : null}
                  </div>
                  {task.status === "READY" && task.draft ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted">{task.draft}</p>
                  ) : null}
                  {task.error || task.reason ? (
                    <p className="mt-2 text-xs leading-5 text-red-600">{task.error || task.reason}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.status === "READY" && task.draft ? (
                      <button
                        type="button"
                        onClick={() => loadTaskDraft(task)}
                        className="btn-secondary h-9 px-3 text-xs"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        预览并编辑
                      </button>
                    ) : null}
                    {task.status === "FAILED" ? (
                      <button
                        type="button"
                        onClick={() => void retryTask(task)}
                        disabled={taskActionId === task.id}
                        className="btn-secondary h-9 px-3 text-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        重试
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void cancelTask(task)}
                        disabled={taskActionId === task.id}
                        className="btn-secondary h-9 px-3 text-xs text-red-600"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                        取消
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </section>

      {assistStatus === "error" || assistStatus === "stopped" ? (
        <div className="mt-2 flex flex-none items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">
          <span>{assistStatus === "stopped" ? "草稿生成已停止" : assistError || "草稿生成失败"}</span>
          <button type="button" onClick={() => void generateAssistDraft()} className="font-semibold">
            重试
          </button>
        </div>
      ) : null}
      {draftTaskId ? (
        <div className="mt-2 flex flex-none items-center gap-2 rounded-2xl bg-skysoft px-4 py-2 text-xs text-ink">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {draftEdited
            ? "草稿已被你编辑，将接管任务并作为本人消息发送"
            : "AI 草稿未修改，发送后会显示完整 AI 来源标签"}
        </div>
      ) : null}

      <form
        onSubmit={sendMessage}
        className="mt-2 flex flex-none items-end gap-2 rounded-[28px] bg-white p-2 shadow-soft"
      >
        {agentConfigurable && agentState.effectiveMode === "ASSIST" && !draftTaskId ? (
          assistStatus === "generating" ? (
            <button
              type="button"
              onClick={() => void stopAssistDraft()}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-50 text-red-600"
              aria-label="停止生成草稿"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void generateAssistDraft()}
              disabled={!canGenerateAssist || sending}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-skysoft text-ink disabled:opacity-40"
              aria-label="生成 AI 辅助草稿"
              title={policyProblem || "生成 AI 辅助草稿"}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
            </button>
          )
        ) : null}
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            if (draftTaskId && value !== draftOriginal) setDraftEdited(true);
            resizeTextarea(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={sending}
          className="min-h-11 max-h-[124px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-[22px] px-4 py-3 text-sm leading-5 outline-none"
          placeholder={
            assistStatus === "generating" ? "正在生成草稿..." : "输入消息"
          }
          aria-label="消息内容"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-40"
          aria-label="发送"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>

      {settingsOpen && agentConfigurable ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-ink/35"
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭设置"
          />
          <section className="relative max-h-[88dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[32px] bg-white px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 shadow-soft">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted">仅此会话</p>
                <h2 className="mt-1 text-2xl font-semibold">代理设置</h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-surface"
                aria-label="关闭"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <section>
              <h3 className="text-sm font-semibold">模式</h3>
              <div className="mt-3 grid gap-2">
                {MODE_OVERRIDES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setSettingsDraft((current) => ({ ...current, modeOverride: mode }))
                    }
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold ${
                      settingsDraft.modeOverride === mode ? "bg-ink text-white" : "bg-surface"
                    }`}
                  >
                    {modeLabel(mode)}
                    {settingsDraft.modeOverride === mode ? <Check className="h-4 w-4" aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold">回复延迟</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {DELAY_OVERRIDES.map((delay) => (
                  <button
                    key={delay}
                    type="button"
                    onClick={() =>
                      setSettingsDraft((current) => ({ ...current, delayOverride: delay }))
                    }
                    className={`rounded-2xl px-3 py-3 text-xs font-semibold ${
                      settingsDraft.delayOverride === delay ? "bg-ink text-white" : "bg-surface"
                    }`}
                  >
                    {delayLabel(delay)}
                  </button>
                ))}
              </div>
              {settingsDraft.delayOverride === "CUSTOM" ? (
                <input
                  type="number"
                  min={1}
                  value={settingsDraft.customDelaySeconds}
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      customDelaySeconds: Number(event.target.value)
                    }))
                  }
                  className="field mt-3"
                  aria-label="自定义延迟秒数"
                />
              ) : null}
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold">活跃时间覆盖</h3>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {WINDOW_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setSettingsDraft((current) => ({ ...current, activeWindowMode: mode }))
                    }
                    className={`rounded-2xl px-2 py-3 text-xs font-semibold ${
                      settingsDraft.activeWindowMode === mode ? "bg-ink text-white" : "bg-surface"
                    }`}
                  >
                    {mode === "INHERIT" ? "继承全局" : mode === "ALWAYS" ? "始终活跃" : "自定义"}
                  </button>
                ))}
              </div>
              {settingsDraft.activeWindowMode === "CUSTOM" ? (
                <div className="mt-3">
                  <AgentScheduleEditor
                    value={settingsDraft.activeWindows}
                    onChange={(activeWindows) =>
                      setSettingsDraft((current) => ({ ...current, activeWindows }))
                    }
                  />
                </div>
              ) : null}
            </section>

            <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl bg-surface px-4 py-3">
              <span>
                <span className="block text-sm font-semibold">接收此联系人的 AI 代理消息</span>
                <span className="mt-1 block text-xs leading-5 text-muted">拒绝后，对方在这个会话中只能本人回复。</span>
              </span>
              <input
                type="checkbox"
                checked={settingsDraft.receiveAiFromContact}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    receiveAiFromContact: event.target.checked
                  }))
                }
                className="h-5 w-5"
              />
            </label>

            <button
              type="button"
              onClick={() => void saveConversationSettings()}
              disabled={settingsSaving}
              className="btn-primary mt-5 w-full"
            >
              {settingsSaving ? "正在保存..." : "保存会话设置"}
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
