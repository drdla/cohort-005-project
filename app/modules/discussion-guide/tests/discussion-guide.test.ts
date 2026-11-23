import { describe, it, expect } from "vitest";
import { questionGuide, replyGuide } from "../index";

describe("questionGuide", () => {
  describe("for a Student", () => {
    const guide = questionGuide({
      isInstructor: false,
      instructorName: "Sarah Chen",
    });

    it("frames the form as asking a question", () => {
      expect(guide.title).toBe("Ask a question");
      expect(guide.submitLabel).toBe("Post question");
      expect(guide.placeholder).toBe(
        "What are you stuck on? Say what you tried and what happened…"
      );
    });

    it("explains, in order, where the question goes, who hears of it, and where the answer turns up", () => {
      expect(guide.steps).toEqual([
        {
          icon: "post",
          text: "Your question is posted below this lesson, where everyone in the course can see it and help.",
        },
        {
          icon: "notify",
          text: "Sarah Chen, the instructor, is notified.",
        },
        {
          icon: "reply",
          text: "Replies appear under your question, and you're notified in the bell at the top of the sidebar.",
        },
      ]);
    });

    it("confirms the instructor was told once the question is posted", () => {
      expect(guide.confirmation).toBe(
        "Question posted. Sarah Chen has been notified, and you'll be notified when someone replies."
      );
    });
  });

  describe("for the course's Instructor", () => {
    const guide = questionGuide({
      isInstructor: true,
      instructorName: "Sarah Chen",
    });

    it("frames the form as a post, not a question", () => {
      expect(guide.title).toBe("Post to the discussion");
      expect(guide.submitLabel).toBe("Post");
      expect(guide.placeholder).toBe(
        "Share a tip, a correction or a follow-up with your students…"
      );
    });

    it("says students are not notified, because an Instructor's post is not a Discussion Question", () => {
      expect(guide.steps).toEqual([
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
          text: "When a student replies, you get a notification in the bell at the top of the sidebar.",
        },
      ]);
      expect(guide.confirmation).toBe("Posted to the discussion.");
    });
  });
});

describe("replyGuide", () => {
  it("tells someone replying to another person's question that its author is notified", () => {
    expect(
      replyGuide({
        viewerId: 2,
        questionAuthorId: 25,
        questionAuthorName: "Hana Kim",
      })
    ).toEqual({
      placeholder: "Reply to Hana Kim",
      submitLabel: "Post reply",
      note: "Hana Kim gets a notification about your reply.",
      confirmation: "Reply posted. Hana Kim has been notified.",
    });
  });

  it("tells the question's author that a follow-up notifies nobody", () => {
    expect(
      replyGuide({
        viewerId: 25,
        questionAuthorId: 25,
        questionAuthorName: "Hana Kim",
      })
    ).toEqual({
      placeholder: "Add a follow-up to your question",
      submitLabel: "Post follow-up",
      note: "Nobody is notified of a follow-up to your own question. It appears in the thread for anyone who opens it.",
      confirmation: "Follow-up posted.",
    });
  });

  it("treats a signed-out viewer as not the author", () => {
    expect(
      replyGuide({
        viewerId: null,
        questionAuthorId: 25,
        questionAuthorName: "Hana Kim",
      }).submitLabel
    ).toBe("Post reply");
  });
});
