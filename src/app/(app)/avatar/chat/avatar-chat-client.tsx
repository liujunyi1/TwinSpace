"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, RotateCcw, Send, Square } from "lucide-react";
import { clearAvatarSessionAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { readAiStream, type AiStreamEvent } from "@/lib/client/ai-stream";

export type InitialAvatarMessage = {
  id: string;
  role: string;
  content: string;
  status: string;
  replyToMessageId: string | null;
};

type ChatMessage = InitialAvatarMessage & {
  error?: string;
};

type AvatarChatClientProps = {
  initialMessages: InitialAvatarMessage[];
  userName: string;
  userAvatarUrl: string | null;
  avatarName: string;
  avatarAvatarUrl: string | null;
};

function localId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function userMessageFromEvent(value: unknown) {
  if (typeof value === "string") {
    return { id: value } as Partial<InitialAvatarMessage> & { id: string };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    role: typeof record.role === "string" ? record.role : undefined,
    content: typeof record.content === "string" ? record.content : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
    replyToMessageId:
      typeof record.replyToMessageId === "string" || record.replyToMessageId === null
        ? record.replyToMessageId
        : undefined
  } as Partial<InitialAvatarMessage> & { id: string };
}

export function AvatarChatClient({
  initialMessages,
  userName,
  userAvatarUrl,
  avatarName,
  avatarAvatarUrl
}: AvatarChatClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((message) => ({
      ...message,
      error: message.status === "FAILED" ? "生成失败，请重试" : undefined
    }))
  );
  const [input, setInput] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const requestNumberRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const patchAssistant = (
    assistantId: string,
    patch: Partial<ChatMessage> | ((message: ChatMessage) => Partial<ChatMessage>)
  ) => {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) }
          : message
      )
    );
  };

  const runRequest = async (
    body: { content: string } | { userMessageId: string; assistantMessageId: string },
    initialAssistantId: string,
    initialUserId: string
  ) => {
    const requestNumber = ++requestNumberRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    activeAssistantIdRef.current = initialAssistantId;
    setRunningId(initialAssistantId);
    let terminal = false;

    try {
      const response = await fetch("/api/avatar/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      await readAiStream(response, (event: AiStreamEvent) => {
        if (requestNumber !== requestNumberRef.current) return;

        if (event.type === "start") {
          const persistedUser = userMessageFromEvent(event.userMessage);
          const nextUserId = persistedUser?.id || initialUserId;
          const previousAssistantId = activeAssistantIdRef.current || initialAssistantId;
          const nextAssistantId = event.assistantId || previousAssistantId;

          setMessages((current) =>
            current.map((message) => {
              if (message.id === initialUserId && persistedUser) {
                return {
                  ...message,
                  ...persistedUser,
                  id: nextUserId,
                  role: persistedUser.role || message.role,
                  content: persistedUser.content ?? message.content,
                  status: persistedUser.status || "COMPLETE"
                };
              }
              if (message.id === previousAssistantId) {
                return {
                  ...message,
                  id: nextAssistantId,
                  replyToMessageId: nextUserId,
                  status: "STREAMING"
                };
              }
              return message;
            })
          );
          activeAssistantIdRef.current = nextAssistantId;
          setRunningId(nextAssistantId);
          return;
        }

        const assistantId = activeAssistantIdRef.current || initialAssistantId;
        if (event.type === "delta") {
          patchAssistant(assistantId, (message) => ({
            content: `${message.content}${event.delta}`,
            status: "STREAMING",
            error: undefined
          }));
          return;
        }
        if (event.type === "replace") {
          patchAssistant(assistantId, {
            content: event.text,
            status: "STREAMING",
            error: undefined
          });
          return;
        }
        if (event.type === "done") {
          terminal = true;
          patchAssistant(assistantId, { status: "COMPLETE", error: undefined });
          return;
        }
        if (event.type === "error") {
          terminal = true;
          patchAssistant(assistantId, { status: "FAILED", error: event.message });
        }
      });

      if (!terminal && !controller.signal.aborted) {
        throw new Error(
          response.ok ? "连接提前结束，请重试" : `请求失败（HTTP ${response.status}）`
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && requestNumber === requestNumberRef.current) {
        const assistantId = activeAssistantIdRef.current || initialAssistantId;
        patchAssistant(assistantId, {
          status: "FAILED",
          error: error instanceof Error ? error.message : "生成失败，请重试"
        });
      }
    } finally {
      if (requestNumber === requestNumberRef.current) {
        setRunningId(null);
        controllerRef.current = null;
      }
    }
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || runningId) return;

    const userId = localId("user");
    const assistantId = localId("assistant");
    setMessages((current) => [
      ...current,
      {
        id: userId,
        role: "user",
        content,
        status: "COMPLETE",
        replyToMessageId: null
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "THINKING",
        replyToMessageId: userId
      }
    ]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
      textareaRef.current.style.overflowY = "hidden";
    }
    void runRequest({ content }, assistantId, userId);
  };

  const stopCurrentGeneration = async () => {
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId || !controllerRef.current) return;

    controllerRef.current.abort();
    requestNumberRef.current += 1;
    patchAssistant(assistantId, { status: "STOPPED", error: undefined });
    setRunningId(null);
    controllerRef.current = null;
    activeAssistantIdRef.current = null;

    const response = await fetch("/api/avatar/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistantMessageId: assistantId })
    });
    if (!response.ok) {
      throw new Error(`停止请求失败（HTTP ${response.status}）`);
    }
  };

  const stop = () => {
    void stopCurrentGeneration().catch((error) => {
      setClearError(error instanceof Error ? error.message : "停止生成失败");
    });
  };

  const clearConversation = async () => {
    const confirmed = window.confirm(
      "这只会清空当前的分身测试对话，不会影响你的分身、知识库或校准结果。确定继续吗？"
    );
    if (!confirmed || isClearing) return;

    setIsClearing(true);
    setClearError(null);
    try {
      if (controllerRef.current && activeAssistantIdRef.current) {
        await stopCurrentGeneration();
      }
      await clearAvatarSessionAction();
      setMessages([]);
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "44px";
        textareaRef.current.style.overflowY = "hidden";
      }
    } catch (error) {
      setClearError(
        `${error instanceof Error ? error.message : "清空失败"}，当前对话已保留。`
      );
    } finally {
      setIsClearing(false);
    }
  };

  const retry = (assistant: ChatMessage) => {
    if (runningId || !assistant.replyToMessageId) return;
    patchAssistant(assistant.id, {
      content: "",
      status: "THINKING",
      error: undefined
    });
    void runRequest(
      {
        userMessageId: assistant.replyToMessageId,
        assistantMessageId: assistant.id
      },
      assistant.id,
      assistant.replyToMessageId
    );
  };

  return (
    <main
      className="page-shell flex w-full flex-col overflow-hidden"
      style={{
        height: "100dvh",
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "calc(6.5rem + env(safe-area-inset-bottom))"
      }}
    >
      <header className="sticky top-0 z-20 flex flex-none items-center justify-between gap-4 bg-white/80 py-3 backdrop-blur">
        <div>
          <p className="text-sm font-semibold text-muted">分身</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">和自己聊聊</h1>
        </div>
        <button
          type="button"
          onClick={() => void clearConversation()}
          disabled={isClearing || messages.length === 0}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold shadow-sm disabled:opacity-40"
          aria-label="清空对话"
        >
          <RotateCcw className={`h-4 w-4 ${isClearing ? "animate-spin" : ""}`} aria-hidden />
          {isClearing ? "清空中" : "清空对话"}
        </button>
      </header>

      {clearError ? (
        <div className="mb-2 flex-none rounded-2xl bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">
          {clearError}
        </div>
      ) : null}

      <section className="card mb-2 flex-none p-4">
        <div className="flex items-center gap-4">
          {avatarAvatarUrl ? (
            <Avatar name={avatarName} src={avatarAvatarUrl} size="xl" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-[30%] bg-ink text-white">
              <Bot className="h-8 w-8" aria-hidden />
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{avatarName}</h2>
              <span className="chip">AI 分身</span>
            </div>
            <p className="mt-1 text-sm text-muted">按照当前知识版本回应你</p>
          </div>
        </div>
      </section>

      <section
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-1"
        aria-live="polite"
      >
        {messages.length ? (
          messages.map((message) => {
            const mine = message.role === "user";
            const thinking = !mine && message.status === "THINKING";
            const stopped = !mine && message.status === "STOPPED";
            return (
              <div key={message.id} className={`flex gap-2 ${mine ? "justify-end" : ""}`}>
                {!mine ? (
                  avatarAvatarUrl ? (
                    <Avatar name={avatarName} src={avatarAvatarUrl} size="sm" />
                  ) : (
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[30%] bg-ink text-white">
                      <Bot className="h-5 w-5" aria-hidden />
                    </div>
                  )
                ) : null}
                <div className={`max-w-[78%] ${mine ? "text-right" : ""}`}>
                  <div
                    className={`rounded-[24px] px-4 py-3 text-left text-sm leading-6 ${
                      mine ? "bg-ink text-white" : "bg-white text-ink"
                    }`}
                  >
                    {thinking && !message.content ? (
                      <div className="flex items-center gap-1 py-1" aria-label="正在思考">
                        {[0, 1, 2].map((item) => (
                          <span
                            key={item}
                            className="h-2 w-2 animate-pulse rounded-full bg-muted"
                            style={{ animationDelay: `${item * 150}ms` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">
                        {message.content || (stopped ? "未生成内容" : "")}
                        {!mine && message.status === "STREAMING" ? (
                          <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-ink align-middle" />
                        ) : null}
                      </p>
                    )}
                  </div>
                  {stopped ? <p className="mt-1 text-xs text-muted">已停止</p> : null}
                  {message.error ? (
                    <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-left text-xs text-red-700">
                      <p>{message.error}</p>
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 font-semibold"
                        onClick={() => retry(message)}
                        disabled={Boolean(runningId)}
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden />
                        重试
                      </button>
                    </div>
                  ) : null}
                </div>
                {mine ? <Avatar name={userName} src={userAvatarUrl} size="sm" /> : null}
              </div>
            );
          })
        ) : (
          <div className="card p-6">
            <p className="text-2xl font-semibold leading-9">今天状态怎么样？</p>
            <p className="mt-3 text-sm leading-6 text-muted">把想法丢进来，分身会按你的知识库回应。</p>
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      <form
        onSubmit={send}
        className="mt-2 flex flex-none items-end gap-2 rounded-[28px] bg-white p-2 shadow-soft"
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            event.currentTarget.style.height = "44px";
            const nextHeight = Math.min(event.currentTarget.scrollHeight, 124);
            event.currentTarget.style.height = `${nextHeight}px`;
            event.currentTarget.style.overflowY =
              event.currentTarget.scrollHeight > 124 ? "auto" : "hidden";
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
          className="min-h-11 max-h-[124px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-[22px] px-4 py-3 text-sm leading-5 outline-none"
          placeholder={runningId ? "等待当前回复完成" : "和你的分身聊聊"}
          aria-label="发送给分身的内容"
          autoComplete="off"
          disabled={Boolean(runningId)}
        />
        {runningId ? (
          <button
            type="button"
            onClick={stop}
            className="grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-600"
            aria-label="停止生成"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="grid h-11 w-11 place-items-center rounded-full bg-ink text-white disabled:opacity-40"
            aria-label="发送"
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        )}
      </form>
    </main>
  );
}
