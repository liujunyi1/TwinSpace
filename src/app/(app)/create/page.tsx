import { ArrowUp, Hash, Shield } from "lucide-react";
import { createPostAction } from "@/app/actions";
import { CityLocator } from "@/components/city-locator";
import { PostImageInput } from "@/components/post-image-input";

export default function CreatePage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return (
    <main className="page-shell">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-muted">发布</p>
          <h1 className="mt-1 text-4xl font-semibold tracking-normal">分享一刻</h1>
        </div>
      </div>

      {searchParams?.error ? (
        <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {searchParams.error}
        </p>
      ) : null}

      <form action={createPostAction} className="card overflow-hidden" encType="multipart/form-data">
        <textarea
          name="content"
          className="min-h-[300px] w-full resize-none bg-transparent px-6 py-7 text-2xl leading-10 outline-none placeholder:text-muted/50"
          placeholder="今天想分享什么？"
          required
        />
        <div className="space-y-3 border-t border-line px-5 py-4">
          <PostImageInput />

          <CityLocator />

          <label className="flex items-center gap-2 rounded-full bg-surface px-4 py-3 text-sm text-muted">
            <Hash className="h-4 w-4" aria-hidden />
            <input
              name="topics"
              className="min-w-0 flex-1 bg-transparent outline-none"
              placeholder="添加话题，多个用逗号分隔"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 rounded-full bg-surface px-4 py-3 text-sm text-muted">
              <Shield className="h-4 w-4" aria-hidden />
              <select name="visibility" className="min-w-0 flex-1 bg-transparent outline-none">
                <option value="PUBLIC">公开</option>
                <option value="FRIENDS">互相关注可见</option>
                <option value="PRIVATE">仅自己</option>
              </select>
            </label>
            <label className="flex items-center justify-center gap-2 rounded-full bg-surface px-4 py-3 text-sm text-muted">
              <input name="allowComments" type="checkbox" value="true" defaultChecked />
              允许评论
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between px-5 pb-5">
          <p className="text-xs leading-5 text-muted">发布后会进入动态流，图片和城市会一起展示。</p>
          <button className="grid h-16 w-16 place-items-center rounded-full bg-ink text-white" aria-label="发布">
            <ArrowUp className="h-8 w-8" aria-hidden />
          </button>
        </div>
      </form>
    </main>
  );
}
