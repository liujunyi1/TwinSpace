import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function visiblePostWhere(viewerId: string): Prisma.PostWhereInput {
  return {
    OR: [
      { authorId: viewerId },
      { visibility: "PUBLIC" },
      {
        visibility: "FRIENDS",
        author: {
          followers: { some: { followerId: viewerId } },
          following: { some: { followingId: viewerId } }
        }
      }
    ]
  };
}

export function findVisiblePost(viewerId: string, postId: string) {
  return prisma.post.findFirst({
    where: {
      AND: [{ id: postId }, visiblePostWhere(viewerId)]
    }
  });
}
