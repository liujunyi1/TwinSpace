import { requireUser } from "@/lib/auth";
import { parseTraits } from "@/lib/profile";

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted">{value}/5</span>
      </div>
      <div className="h-3 rounded-full bg-surface">
        <div className="h-3 rounded-full bg-ink" style={{ width: `${Math.min(100, value * 20)}%` }} />
      </div>
    </div>
  );
}

export default async function PersonalityPage() {
  const user = await requireUser();
  const profile = user.personalityProfile;
  const traits = parseTraits(profile?.traitsJson);

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">人格画像</h1>
      </header>
      <section className="card p-5">
        <h2 className="text-xl font-semibold">摘要</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          {profile?.summary || "暂无画像，请先完成注册问卷。"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {traits.labels?.map((trait) => (
            <span key={trait} className="chip">
              {trait}
            </span>
          ))}
        </div>
      </section>
      <section className="card mt-5 space-y-5 p-5">
        <Meter label="外向程度" value={traits.extroversion || 3} />
        <Meter label="情绪表达" value={traits.emotionalExpression || 3} />
        <Meter label="沟通直接度" value={traits.directness || 3} />
        <Meter label="社交主动性" value={traits.socialInitiative || 3} />
      </section>
      <section className="card mt-5 space-y-4 p-5 text-sm leading-6 text-muted">
        <p><span className="font-semibold text-ink">沟通方式：</span>{profile?.communicationStyle}</p>
        <p><span className="font-semibold text-ink">社交偏好：</span>{profile?.socialStyle}</p>
        <p><span className="font-semibold text-ink">压力下的安慰方式：</span>{profile?.emotionalStyle}</p>
        <p><span className="font-semibold text-ink">回复长度：</span>{profile?.replyLength}</p>
        <p><span className="font-semibold text-ink">表情偏好：</span>{profile?.emojiPreference}</p>
      </section>
    </main>
  );
}
