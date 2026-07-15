import { updateProfileAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const user = await requireUser();

  return (
    <main className="page-shell">
      <header className="mb-5">
        <p className="text-sm font-semibold text-muted">我的</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-normal">编辑资料</h1>
      </header>
      {searchParams?.error ? (
        <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {searchParams.error}
        </p>
      ) : null}
      <form action={updateProfileAction} className="card space-y-4 p-5" encType="multipart/form-data">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">昵称</span>
          <input name="nickname" className="field" defaultValue={user.nickname} required />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">头像链接</span>
          <input name="avatarUrl" className="field" defaultValue={user.avatarUrl || ""} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">上传本地头像</span>
          <input
            name="avatarFile"
            className="block w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">简介</span>
          <textarea name="bio" className="textarea min-h-32" defaultValue={user.bio} />
        </label>
        <button className="btn-primary w-full">保存资料</button>
      </form>
    </main>
  );
}
