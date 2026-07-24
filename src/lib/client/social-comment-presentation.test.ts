import { describe, expect, it } from "vitest";
import { socialCommentPresentation } from "@/lib/client/social-comment-presentation";

describe("socialCommentPresentation", () => {
  it("allows the owner to edit an unedited AI avatar comment and shows the AI badge", () => {
    expect(
      socialCommentPresentation(
        {
          authorId: "owner",
          generatedByAvatar: true,
          ownerEditedAt: null
        },
        "owner"
      )
    ).toEqual({
      canDelete: true,
      editable: true,
      showAiBadge: true,
      useSocialAgentDelete: true
    });
  });

  it("removes edit affordance and the AI badge after the owner edits the comment", () => {
    expect(
      socialCommentPresentation(
        {
          authorId: "owner",
          generatedByAvatar: true,
          ownerEditedAt: new Date("2026-07-23T00:00:00.000Z")
        },
        "owner"
      )
    ).toMatchObject({
      canDelete: true,
      editable: false,
      showAiBadge: false,
      useSocialAgentDelete: false
    });
  });

  it("shows another user's unedited AI avatar comment badge without edit affordance", () => {
    expect(
      socialCommentPresentation(
        {
          authorId: "other",
          generatedByAvatar: true,
          ownerEditedAt: null
        },
        "owner"
      )
    ).toEqual({
      canDelete: false,
      editable: false,
      showAiBadge: true,
      useSocialAgentDelete: false
    });
  });
});
