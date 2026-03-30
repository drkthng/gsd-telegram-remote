/**
 * Tests for ask-user-bridge.ts — formatting and parsing logic.
 * Does NOT test the network polling (that requires integration tests).
 */

import {
  formatQuestionMessage,
  parseCallbackAnswer,
  parseTextAnswer,
  type AskUserQuestion,
} from "../src/ask-user-bridge.js";

describe("formatQuestionMessage", () => {
  it("single-select with options produces inline keyboard", () => {
    const questions: AskUserQuestion[] = [{
      id: "deploy",
      header: "Deploy Target",
      question: "Where to deploy?",
      options: [
        { label: "AWS", description: "Amazon" },
        { label: "GCP", description: "Google" },
      ],
    }];

    const result = formatQuestionMessage(questions, "p1");
    expect(result.text).toContain("Deploy Target");
    expect(result.text).toContain("Where to deploy?");
    expect(result.reply_markup).toBeDefined();
    expect(result.reply_markup!.inline_keyboard).toHaveLength(3); // 2 options + "None of the above"
    expect(result.reply_markup!.inline_keyboard[0][0].callback_data).toBe("auq:p1:0");
    expect(result.reply_markup!.inline_keyboard[1][0].callback_data).toBe("auq:p1:1");
    expect(result.reply_markup!.inline_keyboard[2][0].callback_data).toBe("auq:p1:nota");
  });

  it("multi-select produces text without keyboard", () => {
    const questions: AskUserQuestion[] = [{
      id: "features",
      header: "Features",
      question: "Which features?",
      options: [
        { label: "Auth" },
        { label: "Payments" },
      ],
      allowMultiple: true,
    }];

    const result = formatQuestionMessage(questions, "p2");
    expect(result.text).toContain("Features");
    expect(result.text).toContain("1. Auth");
    expect(result.text).toContain("2. Payments");
    expect(result.reply_markup).toBeUndefined();
  });

  it("multi-question produces numbered questions", () => {
    const questions: AskUserQuestion[] = [
      { id: "q1", header: "First", question: "Pick one", options: [{ label: "A" }] },
      { id: "q2", header: "Second", question: "Pick another", options: [{ label: "B" }] },
    ];

    const result = formatQuestionMessage(questions, "p3");
    expect(result.text).toContain("(1/2)");
    expect(result.text).toContain("(2/2)");
    expect(result.reply_markup).toBeUndefined();
  });

  it("escapes HTML in user content", () => {
    const questions: AskUserQuestion[] = [{
      id: "q1",
      header: "Test <script>",
      question: "Is 5 > 3 & 2 < 4?",
      options: [{ label: "<b>Yes</b>" }],
    }];

    const result = formatQuestionMessage(questions, "p4");
    expect(result.text).toContain("&lt;script&gt;");
    expect(result.text).toContain("5 &gt; 3 &amp; 2 &lt; 4");
    // Option label appears in inline keyboard button text, not in HTML body
    // so HTML escaping in options is tested via keyboard button content
    expect(result.reply_markup!.inline_keyboard[0][0].text).toContain("<b>Yes</b>");
  });
});

describe("parseCallbackAnswer", () => {
  const questions: AskUserQuestion[] = [{
    id: "choice",
    question: "Pick",
    options: [
      { label: "Alpha" },
      { label: "Beta" },
    ],
  }];

  it("parses valid callback_data", () => {
    const result = parseCallbackAnswer("auq:p1:0", questions, "p1");
    expect(result).toEqual({
      response: { answers: { choice: { selected: "Alpha" } } },
    });
  });

  it("parses second option", () => {
    const result = parseCallbackAnswer("auq:p1:1", questions, "p1");
    expect(result).toEqual({
      response: { answers: { choice: { selected: "Beta" } } },
    });
  });

  it("returns null for 'nota' (none of the above)", () => {
    const result = parseCallbackAnswer("auq:p1:nota", questions, "p1");
    expect(result).toBeNull();
  });

  it("returns null for wrong promptId", () => {
    const result = parseCallbackAnswer("auq:p2:0", questions, "p1");
    expect(result).toBeNull();
  });

  it("returns null for out-of-range index", () => {
    const result = parseCallbackAnswer("auq:p1:5", questions, "p1");
    expect(result).toBeNull();
  });
});

describe("parseTextAnswer", () => {
  it("single-select: number maps to option", () => {
    const questions: AskUserQuestion[] = [{
      id: "q1",
      question: "Pick",
      options: [{ label: "Alpha" }, { label: "Beta" }],
    }];

    const result = parseTextAnswer("2", questions);
    expect(result.response?.answers.q1.selected).toBe("Beta");
  });

  it("single-select: free text becomes 'None of the above' with notes", () => {
    const questions: AskUserQuestion[] = [{
      id: "q1",
      question: "Pick",
      options: [{ label: "Alpha" }],
    }];

    const result = parseTextAnswer("something else", questions);
    expect(result.response?.answers.q1.selected).toBe("None of the above");
    expect(result.response?.answers.q1.notes).toBe("something else");
  });

  it("multi-select: comma-separated numbers", () => {
    const questions: AskUserQuestion[] = [{
      id: "q1",
      question: "Pick",
      options: [{ label: "A" }, { label: "B" }, { label: "C" }],
      allowMultiple: true,
    }];

    const result = parseTextAnswer("1,3", questions);
    expect(result.response?.answers.q1.selected).toEqual(["A", "C"]);
  });

  it("multi-question: semicolon-separated answers", () => {
    const questions: AskUserQuestion[] = [
      { id: "q1", question: "First", options: [{ label: "A" }, { label: "B" }] },
      { id: "q2", question: "Second", options: [{ label: "X" }, { label: "Y" }] },
    ];

    const result = parseTextAnswer("1;2", questions);
    expect(result.response?.answers.q1.selected).toBe("A");
    expect(result.response?.answers.q2.selected).toBe("Y");
  });

  it("multi-question: newline-separated answers", () => {
    const questions: AskUserQuestion[] = [
      { id: "q1", question: "First", options: [{ label: "A" }, { label: "B" }] },
      { id: "q2", question: "Second", options: [{ label: "X" }, { label: "Y" }] },
    ];

    const result = parseTextAnswer("2\n1", questions);
    expect(result.response?.answers.q1.selected).toBe("B");
    expect(result.response?.answers.q2.selected).toBe("X");
  });

  it("no options: returns raw text as selected", () => {
    const questions: AskUserQuestion[] = [{
      id: "q1",
      question: "Explain",
    }];

    const result = parseTextAnswer("my custom answer", questions);
    expect(result.response?.answers.q1.selected).toBe("my custom answer");
  });
});
