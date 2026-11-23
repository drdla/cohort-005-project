import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Bell, MessageCircleReply, Send, Users } from "lucide-react";
import type { GuideIcon, GuideStep } from "~/modules/discussion-guide";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { MAX_COMMENT_LENGTH } from "~/lib/comments";

const STEP_ICONS: Record<GuideIcon, typeof Send> = {
  post: Users,
  notify: Bell,
  reply: MessageCircleReply,
};

export function DiscussionSteps({ steps }: { steps: GuideStep[] }) {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => {
        const Icon = STEP_ICONS[step.icon];
        return (
          <li
            key={step.icon}
            className="flex gap-3 rounded-lg bg-background p-3 text-sm shadow-xs ring-1 ring-border"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="text-muted-foreground">
              <span className="sr-only">Step {index + 1}: </span>
              {step.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type CommentFormProps = {
  intent: "create-comment" | "edit-comment";
  parentId?: number;
  commentId?: number;
  defaultValue?: string;
  /** Visible label for the text box; the placeholder labels it otherwise. */
  label?: string;
  placeholder: string;
  submitLabel: string;
  /** Who hears about the post, shown beside the button. */
  note?: string;
  confirmation?: string;
  autoFocus?: boolean;
  onDone?: () => void;
};

/** Posts the form, and on success confirms it, clears the box and closes. */
function useCommentSubmit({
  intent,
  confirmation,
  defaultValue,
  onDone,
}: CommentFormProps) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [body, setBody] = useState(defaultValue ?? "");

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;

    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
      return;
    }

    if (fetcher.data.ok) {
      if (confirmation) toast.success(confirmation);
      if (intent === "create-comment") setBody("");
      onDone?.();
    }
    // onDone is recreated each render by callers; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data, intent]);

  return { fetcher, body, setBody };
}

function CommentField({
  id,
  body,
  setBody,
  label,
  placeholder,
  autoFocus,
}: {
  id: string;
  body: string;
  setBody: (body: string) => void;
  label?: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const tooLong = body.length > MAX_COMMENT_LENGTH;
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      <Textarea
        id={id}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        rows={4}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- focus moves to the form the person just opened
        autoFocus={autoFocus}
        aria-label={label ? undefined : placeholder}
        className="resize-y rounded-none border-0 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
        <span>Markdown supported · ``` for code blocks</span>
        <span className={cn(tooLong && "font-medium text-destructive")}>
          {body.length} / {MAX_COMMENT_LENGTH}
        </span>
      </div>
    </div>
  );
}

function CommentFormFooter({
  submitLabel,
  submitting,
  empty,
  tooLong,
  note,
  onCancel,
}: {
  submitLabel: string;
  submitting: boolean;
  empty: boolean;
  tooLong: boolean;
  note?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" size="sm" disabled={submitting || empty || tooLong}>
        <Send className="mr-1 size-3.5" aria-hidden />
        {submitting ? "Posting..." : submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        {empty ? "Write something to post" : "or press Ctrl + Enter"}
      </span>
      {note && (
        <span className="basis-full text-xs text-muted-foreground">{note}</span>
      )}
    </div>
  );
}

export function CommentForm(props: CommentFormProps) {
  const { intent, parentId, commentId, label, submitLabel, note, onDone } =
    props;
  const { fetcher, body, setBody } = useCommentSubmit(props);
  const fieldId = useId();
  const submitting = fetcher.state !== "idle";
  const empty = body.trim().length === 0;
  const tooLong = body.length > MAX_COMMENT_LENGTH;

  return (
    <fetcher.Form method="post" className="space-y-2">
      <input type="hidden" name="intent" value={intent} />
      {parentId !== undefined && (
        <input type="hidden" name="parentId" value={parentId} />
      )}
      {commentId !== undefined && (
        <input type="hidden" name="commentId" value={commentId} />
      )}
      {label && (
        <label htmlFor={fieldId} className="text-sm font-medium">
          {label}
        </label>
      )}
      <CommentField
        id={fieldId}
        body={body}
        setBody={setBody}
        label={label}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
      />
      <CommentFormFooter
        submitLabel={submitLabel}
        submitting={submitting}
        empty={empty}
        tooLong={tooLong}
        note={note}
        onCancel={onDone}
      />
    </fetcher.Form>
  );
}
