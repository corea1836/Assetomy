import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { feedbackLength, normalizeFeedback } from "@/lib/summary-feedback";
import { apiError, checkMutationRequest } from "@/lib/http";
import { saveSummaryFeedback } from "@/lib/store/summary-feedback";
import { SUMMARY_FEEDBACK_MAX_LENGTH, type SummaryFeedbackResponse } from "@/types/summary";
import { CATEGORY_IDS } from "@/types/category";

const inputSchema = z.object({
  category: z.enum(CATEGORY_IDS),
  text: z.string().max(1000),
});

export async function PUT(request: Request): Promise<Response> {
  let userId = "-";
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    userId = user.id;

    const invalidRequest = checkMutationRequest(request, "application/json");
    if (invalidRequest) return invalidRequest;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "BAD_REQUEST");
    }
    const input = inputSchema.safeParse(body);
    if (!input.success) return apiError(400, "BAD_REQUEST");

    const normalized = normalizeFeedback(input.data.text);
    if (feedbackLength(normalized) > SUMMARY_FEEDBACK_MAX_LENGTH) return apiError(400, "BAD_REQUEST");

    const result = await saveSummaryFeedback(user.id, input.data.category, normalized);
    if (result.kind === "saved") {
      return Response.json({ saved: true } satisfies SummaryFeedbackResponse);
    }
    return Response.json({ deleted: true } satisfies SummaryFeedbackResponse);
  } catch (error) {
    console.error(`summary_feedback:${error instanceof Error ? error.constructor.name : "unknown"}`, userId);
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
