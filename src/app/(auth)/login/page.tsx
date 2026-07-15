import Link from "next/link";
import { Sparkles } from "lucide-react";
import { loginAction } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const user = await getCurrentUser();
  if (user) redirect("/feed");

  return (
    <main className="page-shell flex items-center">
      <section className="card w-full p-6">
        <div className="mb-8">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-3xl bg-ink text-white">
            <Sparkles className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm font-medium text-muted">欢迎回到</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal">TwinSpace</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            一个为移动端社交而生的轻量空间。
          </p>
        </div>

        {searchParams?.error ? (
          <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {searchParams.error}
          </p>
        ) : null}

        <form action={loginAction} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">用户名或邮箱</span>
            <input name="account" className="field" autoComplete="username" required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">密码</span>
            <input
              name="password"
              className="field"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn-primary w-full" type="submit">
            登录
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          还没有账号？{" "}
          <Link href="/register" className="font-semibold text-ink">
            创建一个
          </Link>
        </p>
        <div className="mt-5 rounded-2xl bg-surface px-4 py-3 text-xs leading-5 text-muted">
          演示账号：demo / TwinSpace123!
        </div>
      </section>
    </main>
  );
}
