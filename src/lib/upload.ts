import "server-only";

import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const MAX_POST_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_POST_IMAGES = 9;

const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

async function saveImageFile(file: File, folder: "avatars" | "posts") {
  const extension = ALLOWED_TYPES.get(file.type);
  if (!extension) {
    throw new Error("图片仅支持 JPG、PNG、WebP 或 GIF");
  }

  const maxSize = folder === "avatars" ? MAX_AVATAR_SIZE : MAX_POST_IMAGE_SIZE;
  if (file.size > maxSize) {
    throw new Error(folder === "avatars" ? "头像不能超过 2MB" : "单张帖子图片不能超过 5MB");
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", folder);
  await mkdir(uploadDir, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadDir, filename), buffer);
  return `/uploads/${folder}/${filename}`;
}

export async function saveAvatarFile(file: File | null | undefined) {
  if (!file || file.size === 0) return null;
  return saveImageFile(file, "avatars");
}

export async function savePostImageFiles(files: File[]) {
  const validFiles = files.filter((file) => file && file.size > 0);
  if (validFiles.length === 0) return [];
  if (validFiles.length > MAX_POST_IMAGES) {
    throw new Error(`帖子最多上传 ${MAX_POST_IMAGES} 张图片`);
  }

  const urls: string[] = [];
  for (const file of validFiles) {
    urls.push(await saveImageFile(file, "posts"));
  }
  return urls;
}
