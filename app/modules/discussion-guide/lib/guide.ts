export type GuideIcon = "post" | "notify" | "reply";

export type GuideStep = { icon: GuideIcon; text: string };

/**
 * What a person needs to know before and after posting to a lesson's
 * Discussion: what the form is for, who hears about the post, and where an
 * answer will turn up.
 */
export type ComposerGuide = {
  title: string;
  placeholder: string;
  submitLabel: string;
  steps: GuideStep[];
  /** Shown once the post has landed. */
  confirmation: string;
};

const FEED_LOCATION = "the bell at the top of the sidebar";

// These texts mirror the notification rules in `~/lib/comments.server`
// (notifyInstructor, notifyQuestionAuthor): a promise here that the server
// does not keep is worse than no promise at all.

export function questionGuide(viewer: {
  isInstructor: boolean;
  instructorName: string;
}): ComposerGuide {
  if (viewer.isInstructor) {
    return {
      title: "Post to the discussion",
      placeholder:
        "Share a tip, a correction or a follow-up with your students…",
      submitLabel: "Post",
      steps: [
        {
          icon: "post",
          text: "Your post appears below this lesson for everyone in the course.",
        },
        {
          icon: "notify",
          text: "Students aren't notified. They see it when they open this lesson.",
        },
        {
          icon: "reply",
          text: `When a student replies, you get a notification in ${FEED_LOCATION}.`,
        },
      ],
      confirmation: "Posted to the discussion.",
    };
  }

  return {
    title: "Ask a question",
    placeholder: "What are you stuck on? Say what you tried and what happened…",
    submitLabel: "Post question",
    steps: [
      {
        icon: "post",
        text: "Your question is posted below this lesson, where everyone in the course can see it and help.",
      },
      {
        icon: "notify",
        text: `${viewer.instructorName}, the instructor, is notified.`,
      },
      {
        icon: "reply",
        text: `Replies appear under your question, and you're notified in ${FEED_LOCATION}.`,
      },
    ],
    confirmation: `Question posted. ${viewer.instructorName} has been notified, and you'll be notified when someone replies.`,
  };
}

export type ReplyGuide = {
  placeholder: string;
  submitLabel: string;
  /** Who hears about the reply, shown under the reply form. */
  note: string;
  confirmation: string;
};

export function replyGuide(reply: {
  viewerId: number | null;
  questionAuthorId: number;
  questionAuthorName: string;
}): ReplyGuide {
  if (reply.viewerId === reply.questionAuthorId) {
    return {
      placeholder: "Add a follow-up to your question",
      submitLabel: "Post follow-up",
      note: "Nobody is notified of a follow-up to your own question. It appears in the thread for anyone who opens it.",
      confirmation: "Follow-up posted.",
    };
  }

  return {
    placeholder: `Reply to ${reply.questionAuthorName}`,
    submitLabel: "Post reply",
    note: `${reply.questionAuthorName} gets a notification about your reply.`,
    confirmation: `Reply posted. ${reply.questionAuthorName} has been notified.`,
  };
}
