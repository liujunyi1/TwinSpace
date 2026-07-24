type SocialCommentPresentationInput = {
  authorId: string;
  generatedByAvatar: boolean;
  ownerEditedAt?: Date | string | null;
};

export function socialCommentPresentation(
  comment: SocialCommentPresentationInput,
  currentUserId: string
) {
  const ownedByCurrentUser = comment.authorId === currentUserId;
  const editableAiComment =
    ownedByCurrentUser && comment.generatedByAvatar && !comment.ownerEditedAt;
  const uneditedAiComment = comment.generatedByAvatar && !comment.ownerEditedAt;

  return {
    canDelete: ownedByCurrentUser,
    editable: editableAiComment,
    showAiBadge: uneditedAiComment,
    useSocialAgentDelete: editableAiComment
  };
}
