import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import { questionGuide, replyGuide } from "~/modules/discussion-guide";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { CommentForm, DiscussionSteps } from "~/components/comment-form";
import { UserAvatar } from "~/components/user-avatar";
import { cn, formatRelativeTime } from "~/lib/utils";

// Bodies arrive pre-rendered from the server (renderComment), because comments
// are untrusted markdown and the sanitising renderer is server-only.
export type RenderedComment = {
  id: number;
  /** Raw markdown — only used to populate the edit box. */
  body: string;
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: {
    id: number;
    name: string;
    avatarUrl: string | null;
    isInstructor: boolean;
    isPlatformAdmin: boolean;
  };
  replies: RenderedComment[];
};

function AuthorBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {label}
    </span>
  );
}

function CommentActions({
  comment,
  canEdit,
  canDelete,
  canReply,
  onEdit,
  onReply,
}: {
  comment: RenderedComment;
  canEdit: boolean;
  canDelete: boolean;
  canReply: boolean;
  onEdit: () => void;
  onReply: () => void;
}) {
  const deleteFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    if (deleteFetcher.data?.error) toast.error(deleteFetcher.data.error);
  }, [deleteFetcher.data]);

  if (!canEdit && !canDelete && !canReply) return null;

  return (
    <div className="mt-2 flex items-center gap-1">
      {canReply && (
        <Button variant="ghost" size="sm" onClick={onReply}>
          <Reply className="mr-1 size-3.5" />
          Reply
        </Button>
      )}

      {canEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="mr-1 size-3.5" />
          Edit
        </Button>
      )}

      {canDelete && (
        <deleteFetcher.Form
          method="post"
          onSubmit={(event) => {
            if (!confirm("Delete this comment?")) event.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete-comment" />
          <input type="hidden" name="commentId" value={comment.id} />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={deleteFetcher.state !== "idle"}
          >
            <Trash2 className="mr-1 size-3.5" />
            Delete
          </Button>
        </deleteFetcher.Form>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  currentUserId,
  canModerate,
  canPost,
  isReply,
}: {
  comment: RenderedComment;
  currentUserId: number | null;
  canModerate: boolean;
  canPost: boolean;
  isReply: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

  const isAuthor =
    currentUserId !== null && comment.author.id === currentUserId;

  if (comment.deleted) {
    return (
      <div id={`comment-${comment.id}`} className="scroll-mt-4 py-3">
        <p className="text-sm italic text-muted-foreground">
          This comment was deleted.
        </p>
        <Replies
          comment={comment}
          currentUserId={currentUserId}
          canModerate={canModerate}
          canPost={canPost}
        />
      </div>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className={cn("scroll-mt-4 py-3", isReply && "border-l pl-4")}
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          name={comment.author.name}
          avatarUrl={comment.author.avatarUrl}
          className="size-8 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{comment.author.name}</span>
            {comment.author.isInstructor && <AuthorBadge label="Instructor" />}
            {comment.author.isPlatformAdmin && (
              <AuthorBadge label="Platform Admin" />
            )}
            <span
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {formatRelativeTime(comment.createdAt)}
            </span>
            {comment.editedAt && (
              <span
                className="text-xs text-muted-foreground"
                title={`Edited ${comment.editedAt}`}
              >
                (edited)
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-2">
              <CommentForm
                intent="edit-comment"
                commentId={comment.id}
                defaultValue={comment.body}
                placeholder="Edit your comment"
                submitLabel="Save changes"
                autoFocus
                onDone={() => setEditing(false)}
              />
            </div>
          ) : (
            <div
              className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none"
              // oxlint-disable-next-line react/no-danger -- renderComment escapes the HTML in the Markdown
              dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
            />
          )}

          {!editing && (
            <CommentActions
              comment={comment}
              canEdit={isAuthor}
              canDelete={isAuthor || canModerate}
              canReply={canPost && !isReply}
              onEdit={() => setEditing(true)}
              onReply={() => setReplying(true)}
            />
          )}

          {replying && (
            <div className="mt-3">
              <ReplyForm
                comment={comment}
                currentUserId={currentUserId}
                onDone={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      </div>

      <Replies
        comment={comment}
        currentUserId={currentUserId}
        canModerate={canModerate}
        canPost={canPost}
      />
    </div>
  );
}

function ReplyForm({
  comment,
  currentUserId,
  onDone,
}: {
  comment: RenderedComment;
  currentUserId: number | null;
  onDone: () => void;
}) {
  const guide = replyGuide({
    viewerId: currentUserId,
    questionAuthorId: comment.author.id,
    questionAuthorName: comment.author.name,
  });
  return (
    <CommentForm
      intent="create-comment"
      parentId={comment.id}
      placeholder={guide.placeholder}
      submitLabel={guide.submitLabel}
      note={guide.note}
      confirmation={guide.confirmation}
      autoFocus
      onDone={onDone}
    />
  );
}

function Replies({
  comment,
  currentUserId,
  canModerate,
  canPost,
}: {
  comment: RenderedComment;
  currentUserId: number | null;
  canModerate: boolean;
  canPost: boolean;
}) {
  if (comment.replies.length === 0) return null;

  return (
    <div className="ml-11 mt-1 space-y-1">
      {comment.replies.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          currentUserId={currentUserId}
          canModerate={canModerate}
          canPost={canPost}
          isReply
        />
      ))}
    </div>
  );
}

export function CommentThread({
  comments,
  currentUserId,
  canModerate,
  canPost,
  viewerIsInstructor,
  instructorName,
}: {
  comments: RenderedComment[];
  currentUserId: number | null;
  /** Owning instructor or admin — may delete anyone's comment. */
  canModerate: boolean;
  canPost: boolean;
  viewerIsInstructor: boolean;
  instructorName: string;
}) {
  const guide = questionGuide({
    isInstructor: viewerIsInstructor,
    instructorName,
  });

  return (
    <Card className="mb-8 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="flex items-center gap-3 px-6 pt-6">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MessageSquare className="size-4.5" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-semibold">
              Questions &amp; Discussion
            </h2>
            <p className="text-sm text-muted-foreground">
              Questions and answers from everyone taking this course.
            </p>
          </div>
        </div>

        <div className="px-6 pb-2">
          {comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Stuck on this lesson? There&apos;s no such thing as a question
              that&apos;s too basic.
            </p>
          ) : (
            <div className="mt-4 divide-y">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  canPost={canPost}
                  isReply={false}
                />
              ))}
            </div>
          )}
        </div>

        {canPost && (
          <section
            aria-labelledby="discussion-composer-title"
            className="space-y-4 border-t bg-muted/30 px-6 py-6"
          >
            <h3
              id="discussion-composer-title"
              className="text-base font-semibold"
            >
              {guide.title}
            </h3>
            <DiscussionSteps steps={guide.steps} />
            <CommentForm
              intent="create-comment"
              label="Your message"
              placeholder={guide.placeholder}
              submitLabel={guide.submitLabel}
              confirmation={guide.confirmation}
            />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
