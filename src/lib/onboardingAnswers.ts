import type { OnboardField, OnboardRequest, OnboardingProfile } from "./onboarding";

export interface InterviewQuestion {
  id: string;
  field: OnboardField;
  answers: Partial<OnboardingProfile>;
}

/** Fragments belong to the question at capture time, never the next field
 * reached while an HTTP request was in flight. Only the latest revision of
 * a question may publish its result; superseded requests can finish safely. */
export class OnboardingAnswers {
  private batch: { question: InterviewQuestion; parts: string[]; seen: Set<string>; revision: number } | null = null;

  add(question: InterviewQuestion, text: string) {
    const message = text.trim().slice(0, 2000);
    const key = message.toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
    if (!key) return null;
    if (this.batch?.question.id !== question.id) {
      this.batch = { question, parts: [], seen: new Set(), revision: 0 };
    }
    const batch = this.batch;
    if (batch.seen.has(key)) return null;
    // Bound one question as well as the overall request body.
    if (batch.parts.join(" ").length + message.length > 2000) return null;
    batch.parts.push(message);
    batch.seen.add(key);
    const revision = ++batch.revision;
    return {
      current: () => this.batch === batch && batch.revision === revision,
      request: (): OnboardRequest => ({
        answers: batch.question.answers,
        field: batch.question.field,
        message: batch.parts.join(" "),
      }),
    };
  }

  reset() { this.batch = null; }
}
