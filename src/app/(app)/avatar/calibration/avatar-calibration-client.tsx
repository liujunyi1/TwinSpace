"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { approveCalibrationAction } from "@/app/actions";
import type { CalibrationKind } from "@/lib/agent/knowledge";
import { readAiStream, type AiStreamEvent } from "@/lib/client/ai-stream";

export type CalibrationScenarioView = {
  kind: CalibrationKind;
  label: string;
  scenario: string;
};

export type InitialCalibrationCase = {
  kind: CalibrationKind;
  scenario: string;
  generatedResponse: string | null;
  editedResponse: string | null;
  status: string;
  knowledgeRevision: number;
};

type CaseMode = "idle" | "generating" | "editing" | "approved" | "error";

type CaseState = {
  mode: CaseMode;
  text: string;
  error?: string;
  stale: boolean;
};

type AvatarCalibrationClientProps = {
  scenarios: CalibrationScenarioView[];
  initialCases: InitialCalibrationCase[];
  knowledgeRevision: number;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary mt-3 w-full" type="submit" disabled={pending}>
      {pending ? "正在保存..." : "保存修改并确认通过"}
    </button>
  );
}

export function AvatarCalibrationClient({
  scenarios,
  initialCases,
  knowledgeRevision
}: AvatarCalibrationClientProps) {
  const [caseStates, setCaseStates] = useState<Record<string, CaseState>>(() =>
    Object.fromEntries(
      scenarios.map((scenario) => {
        const initial = initialCases.find((item) => item.kind === scenario.kind);
        const currentRevision = initial?.knowledgeRevision === knowledgeRevision;
        const text = initial?.editedResponse || initial?.generatedResponse || "";
        const mode: CaseMode =
          initial?.status === "APPROVED" && currentRevision
            ? "approved"
            : text && currentRevision
              ? "editing"
              : "idle";
        return [
          scenario.kind,
          {
            mode,
            text: currentRevision ? text : "",
            stale: Boolean(initial && !currentRevision)
          }
        ];
      })
    )
  );
  const controllersRef = useRef(new Map<string, AbortController>());

  const patchCase = (kind: CalibrationKind, patch: Partial<CaseState>) => {
    setCaseStates((current) => ({
      ...current,
      [kind]: { ...current[kind], ...patch }
    }));
  };

  const generate = async (kind: CalibrationKind) => {
    if (caseStates[kind]?.mode === "generating") return;
    const controller = new AbortController();
    controllersRef.current.set(kind, controller);
    patchCase(kind, { mode: "generating", text: "", error: undefined, stale: false });
    let terminal = false;

    try {
      const response = await fetch("/api/avatar/calibration/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
        signal: controller.signal
      });

      await readAiStream(response, (event: AiStreamEvent) => {
        if (event.type === "delta") {
          setCaseStates((current) => ({
            ...current,
            [kind]: {
              ...current[kind],
              text: `${current[kind].text}${event.delta}`
            }
          }));
          return;
        }
        if (event.type === "replace") {
          patchCase(kind, { text: event.text });
          return;
        }
        if (event.type === "done") {
          terminal = true;
          patchCase(kind, { mode: "editing", error: undefined });
          return;
        }
        if (event.type === "error") {
          terminal = true;
          patchCase(kind, { mode: "error", error: event.message });
        }
      });

      if (!terminal) {
        throw new Error(
          response.ok ? "连接提前结束，请重试" : `请求失败（HTTP ${response.status}）`
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        patchCase(kind, {
          mode: "error",
          error: error instanceof Error ? error.message : "生成失败，请重试"
        });
      }
    } finally {
      controllersRef.current.delete(kind);
    }
  };

  const approve = async (kind: CalibrationKind, formData: FormData) => {
    await approveCalibrationAction(formData);
    patchCase(kind, { mode: "approved", error: undefined });
  };

  const passedCount = scenarios.filter(
    (scenario) => caseStates[scenario.kind]?.mode === "approved"
  ).length;
  const allPassed = passedCount === scenarios.length;

  return (
    <>
      <section className="card mb-5 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">当前进度</h2>
            <p className="mt-1 text-sm text-muted">基于知识版本 {knowledgeRevision}</p>
          </div>
          <p className="text-3xl font-semibold">{passedCount}/4</p>
        </div>
        {allPassed ? (
          <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            四类场景均已通过，分身现已激活。
          </p>
        ) : null}
      </section>

      <div className="space-y-5">
        {scenarios.map((scenario, index) => {
          const state = caseStates[scenario.kind];
          const generating = state.mode === "generating";
          return (
            <article key={scenario.kind} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-muted">场景 {index + 1} / 4</p>
                  <h2 className="mt-1 text-xl font-semibold">{scenario.label}</h2>
                </div>
                <span
                  className={`chip ${
                    state.mode === "approved"
                      ? "bg-emerald-50 text-emerald-800"
                      : generating
                        ? "animate-pulse bg-skysoft text-ink"
                        : ""
                  }`}
                >
                  {state.mode === "approved"
                    ? "已通过"
                    : generating
                      ? "生成中"
                      : state.mode === "editing"
                        ? "待确认"
                        : state.mode === "error"
                          ? "生成失败"
                          : "未生成"}
                </span>
              </div>

              <div className="mt-4 rounded-2xl bg-surface p-4">
                <p className="text-xs font-semibold text-muted">模拟情境</p>
                <p className="mt-2 text-sm leading-6">{scenario.scenario}</p>
              </div>

              {generating ? (
                <div className="mt-4 rounded-[24px] border border-skysoft bg-white p-4" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                    <Sparkles className="h-4 w-4 animate-pulse" aria-hidden />
                    生成中，回复会实时出现在这里
                  </div>
                  <p className="mt-3 min-h-16 whitespace-pre-wrap text-sm leading-7">
                    {state.text || "正在理解场景和你的知识库..."}
                    {state.text ? (
                      <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-ink align-middle" />
                    ) : null}
                  </p>
                </div>
              ) : null}

              {state.mode === "editing" ? (
                <form action={(formData) => approve(scenario.kind, formData)} className="mt-4">
                  <input type="hidden" name="kind" value={scenario.kind} />
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4" aria-hidden />
                    生成结果，可直接修改
                  </div>
                  <textarea
                    name="content"
                    className="textarea mt-3 min-h-36"
                    value={state.text}
                    onChange={(event) => patchCase(scenario.kind, { text: event.target.value })}
                    required
                  />
                  <p className="mt-2 text-xs leading-5 text-muted">
                    请把回复调整到你愿意由分身说出的程度，保存后该场景才算通过。
                  </p>
                  <SaveButton />
                </form>
              ) : null}

              {state.mode === "approved" ? (
                <div className="mt-4">
                  <div className="rounded-[24px] bg-emerald-50 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                      <Check className="h-4 w-4" aria-hidden />
                      已确认的最终文本
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{state.text}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => patchCase(scenario.kind, { mode: "editing" })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                      重新编辑
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void generate(scenario.kind)}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      重新生成
                    </button>
                  </div>
                </div>
              ) : null}

              {state.mode === "error" ? (
                <div className="mt-4 rounded-[24px] bg-red-50 p-4 text-sm text-red-700">
                  <p className="font-semibold">这次生成没有完成</p>
                  <p className="mt-1 text-xs leading-5">{state.error}</p>
                  <button
                    type="button"
                    className="btn-secondary mt-3 h-10 px-4 text-xs"
                    onClick={() => void generate(scenario.kind)}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    原位重试
                  </button>
                </div>
              ) : null}

              {state.mode === "idle" ? (
                <div className="mt-4">
                  <button
                    type="button"
                    className="btn-primary w-full"
                    onClick={() => void generate(scenario.kind)}
                  >
                    生成校准回复
                  </button>
                  {state.stale ? (
                    <p className="mt-2 text-center text-xs text-muted">
                      知识库已更新，需要基于最新版本重新校准。
                    </p>
                  ) : null}
                </div>
              ) : null}

              {state.mode === "editing" ? (
                <button
                  type="button"
                  className="btn-secondary mt-2 w-full"
                  onClick={() => void generate(scenario.kind)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  重新生成
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
