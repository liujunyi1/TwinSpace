import { describe, expect, it } from "vitest";
import { visiblePostWhere } from "@/lib/post-visibility";

describe("visiblePostWhere", () => {
  it("allows own, public, and mutual-follow posts without a private bypass", () => {
    const where = visiblePostWhere("viewer");

    expect(where).toEqual({
      OR: [
        { authorId: "viewer" },
        { visibility: "PUBLIC" },
        {
          visibility: "FRIENDS",
          author: {
            followers: { some: { followerId: "viewer" } },
            following: { some: { followingId: "viewer" } }
          }
        }
      ]
    });
    expect(JSON.stringify(where)).not.toContain('"visibility":"PRIVATE"');
  });
});
