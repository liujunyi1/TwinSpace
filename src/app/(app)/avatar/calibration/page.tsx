import { approveCalibrationAction, generateCalibrationAction } from "@/app/actions";
import { CALIBRATION_SCENARIOS, CalibrationKind } from "@/lib/agent/knowledge";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const scenarios = Object.entries(CALIBRATION_SCENARIOS).map(([kind, value]) => ({
  kind: kind as CalibrationKind,
  ...value
}));

export default async function AvatarCalibrationPage() {
  const user = await requireUser();
  const [avatarProfile, cases] = await Promise.all([
    prisma.avatarProfile.findUnique({ where: { userId: user.id } }),
    prisma.avatarCalibrationCase.findMany({ where: { userId: user.id } })
  ]);
  const caseByKind = new Map(cases.map((item) => [String(item.kind), item]));
  const revision = avatarProfile?.knowledgeRevision ?? 0;
  const passedCount = scenarios.filter((scenario) => {
    const item = caseByKind.get(scenario.kind);
    return item?.status === "APPROVED" && item.knowledgeRevision === revision;
  }).length;
  const allPassed = passedCount === scenarios.length;

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 第二步</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">场景校准</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          检查分身在四类典型场景中的表达。你修改后的最终版本也会成为校准依据。
        </p>
      </header>

      <section className="card mb-5 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">当前进度</h2>
            <p className="mt-1 text-sm text-muted">基于知识版本 {revision}</p>
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
          const calibration = caseByKind.get(scenario.kind);
          const currentRevision = calibration?.knowledgeRevision === revision;
          const approved = calibration?.status === "APPROVED" && currentRevision;
          const response = calibration?.editedResponse || calibration?.generatedResponse;

          return (
            <article key={scenario.kind} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-muted">场景 {index + 1} / 4</p>
                  <h2 className="mt-1 text-xl font-semibold">{scenario.label}</h2>
                </div>
                <span className={`chip ${approved ? "bg-emerald-50 text-emerald-800" : ""}`}>
                  {approved ? "已通过" : response && currentRevision ? "待确认" : "未生成"}
                </span>
              </div>
              <div className="mt-4 rounded-2xl bg-surface p-4">
                <p className="text-xs font-semibold text-muted">模拟情境</p>
                <p className="mt-2 text-sm leading-6">{scenario.scenario}</p>
              </div>

              {response && currentRevision ? (
                <>
                  <form action={approveCalibrationAction} className="mt-4">
                    <input type="hidden" name="kind" value={scenario.kind} />
                    <label className="text-xs font-semibold text-muted" htmlFor={`content-${scenario.kind}`}>
                      分身回复
                    </label>
                    <textarea
                      id={`content-${scenario.kind}`}
                      name="content"
                      className="textarea mt-2 min-h-32"
                      defaultValue={response}
                      required
                    />
                    <button className="btn-primary mt-3 w-full" type="submit">
                      {approved ? "保存修改并保持通过" : "确认通过"}
                    </button>
                  </form>
                  <form action={generateCalibrationAction} className="mt-2">
                    <input type="hidden" name="kind" value={scenario.kind} />
                    <button className="btn-secondary w-full" type="submit">
                      重新生成
                    </button>
                  </form>
                </>
              ) : (
                <form action={generateCalibrationAction} className="mt-4">
                  <input type="hidden" name="kind" value={scenario.kind} />
                  <button className="btn-primary w-full" type="submit">
                    生成校准回复
                  </button>
                  {calibration && !currentRevision ? (
                    <p className="mt-2 text-center text-xs text-muted">
                      知识库已更新，需要基于最新版本重新校准。
                    </p>
                  ) : null}
                </form>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
