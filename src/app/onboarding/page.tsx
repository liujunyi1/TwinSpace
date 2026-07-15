import { saveOnboardingAction } from "@/app/actions";
import { onboardingQuestions } from "@/lib/onboarding";
import { requireUser } from "@/lib/auth";

export default async function OnboardingPage() {
  await requireUser();

  return (
    <main className="page-shell pb-10">
      <header className="mb-6">
        <p className="text-sm font-semibold text-muted">第二步</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-normal">让空间理解你</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          这些答案会生成初始人物画像，之后可以在个人页修改。
        </p>
      </header>

      <form action={saveOnboardingAction} className="space-y-4">
        {onboardingQuestions.map((question, index) => (
          <section key={question.key} className="card p-5">
            <p className="mb-2 text-xs font-semibold text-muted">
              {String(index + 1).padStart(2, "0")} / {onboardingQuestions.length}
            </p>
            <h2 className="text-lg font-semibold leading-7">{question.title}</h2>
            {question.helper ? (
              <p className="mt-1 text-sm leading-6 text-muted">{question.helper}</p>
            ) : null}

            <div className="mt-4">
              {question.kind === "single" ? (
                <div className="grid gap-2">
                  {question.options?.map((option) => (
                    <label key={option} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-sm">
                      <input name={question.key} value={option} type="radio" required />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {question.kind === "multi" ? (
                <div className="flex flex-wrap gap-2">
                  {question.options?.map((option) => (
                    <label key={option} className="rounded-full bg-surface px-4 py-2 text-sm">
                      <input name={question.key} value={option} type="checkbox" className="mr-2" />
                      {option}
                    </label>
                  ))}
                </div>
              ) : null}

              {question.kind === "scale" ? (
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} className="grid h-11 flex-1 place-items-center rounded-full bg-surface text-sm font-semibold">
                      <input name={question.key} value={value} type="radio" className="sr-only peer" required />
                      <span className="grid h-11 w-full place-items-center rounded-full peer-checked:bg-ink peer-checked:text-white">
                        {value}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}

              {question.kind === "text" ? (
                <textarea
                  name={question.key}
                  className="textarea min-h-28"
                  placeholder="写几句就可以"
                />
              ) : null}
            </div>
          </section>
        ))}

        <button className="btn-primary w-full" type="submit">
          生成并保存画像
        </button>
      </form>
    </main>
  );
}
