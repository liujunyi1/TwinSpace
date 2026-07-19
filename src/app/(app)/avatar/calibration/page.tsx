import {
  AvatarCalibrationClient,
  type InitialCalibrationCase
} from "@/app/(app)/avatar/calibration/avatar-calibration-client";
import {
  CALIBRATION_SCENARIOS,
  type CalibrationKind
} from "@/lib/agent/knowledge";
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
  const knowledgeRevision = avatarProfile?.knowledgeRevision ?? 0;
  const initialCases: InitialCalibrationCase[] = cases.map((item) => ({
    kind: item.kind as CalibrationKind,
    scenario: item.scenario,
    generatedResponse: item.generatedResponse,
    editedResponse: item.editedResponse,
    status: item.status,
    knowledgeRevision: item.knowledgeRevision
  }));

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">分身 · 第二步</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">场景校准</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          检查分身在四类典型场景中的表达。生成过程会实时显示，你修改后的版本将成为最终校准结果。
        </p>
      </header>

      <AvatarCalibrationClient
        scenarios={scenarios}
        initialCases={initialCases}
        knowledgeRevision={knowledgeRevision}
      />
    </main>
  );
}
