import { updateProfileAction } from "@/app/actions";
import { AvatarUploadInput } from "@/components/avatar-upload-input";
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
      <form action={updateProfileAction} className="card space-y-4 p-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">昵称</span>
          <input name="nickname" className="field" defaultValue={user.nickname} required />
        </label>
        <AvatarUploadInput
          label="头像"
          previewName={user.nickname}
          currentSrc={user.avatarUrl}
        />
        <label className="block">
          <span className="mb-2 block text-sm font-medium">简介</span>
          <textarea name="bio" className="textarea min-h-32" defaultValue={user.bio} />
        </label>
        <button className="btn-primary w-full">保存资料</button>
      </form>
    </main>
  );
}
