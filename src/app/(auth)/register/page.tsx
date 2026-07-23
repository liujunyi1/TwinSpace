import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions";
import { AvatarUploadInput } from "@/components/avatar-upload-input";
import { getCurrentUser } from "@/lib/auth";

export default async function RegisterPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const user = await getCurrentUser();
  if (user) redirect("/feed");

  return (
    <main className="page-shell">
      <section className="card p-6">
        <p className="text-sm font-medium text-muted">第一步</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-normal">创建你的空间</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          注册后会进入问卷，用于生成初始人物画像。
        </p>

        {searchParams?.error ? (
          <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {searchParams.error}
          </p>
        ) : null}

        <form action={registerAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium">用户名</span>
            <input name="username" className="field" autoComplete="username" required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">昵称</span>
            <input name="nickname" className="field" required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">邮箱</span>
            <input name="email" className="field" type="email" autoComplete="email" required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">密码</span>
            <input
              name="password"
              className="field"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium">确认密码</span>
            <input
              name="confirmPassword"
              className="field"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <AvatarUploadInput label="头像（可跳过）" previewName="新用户" />
          <label className="flex items-start gap-3 rounded-2xl bg-surface p-4 text-sm text-muted">
            <input name="agreed" type="checkbox" className="mt-1" required />
            <span>我已阅读并同意 TwinSpace 的用户协议和隐私说明。</span>
          </label>
          <button className="btn-primary w-full" type="submit">
            注册并进入问卷
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          已有账号？{" "}
          <Link href="/login" className="font-semibold text-ink">
            去登录
          </Link>
        </p>
      </section>
    </main>
  );
}
