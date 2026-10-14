import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { updateCard } from "@/lib/store/cards";
import { ANALYSIS_BASES, type CardUpdateInput } from "@/types/card";

const idSchema = z.uuid();
const labelInputSchema = z.object({ label: z.string() });
const cardInputSchema = z.object({
  analysisBasis: z.enum(ANALYSIS_BASES),
  cycleStartDay: z.int().min(1).max(31).nullable(),
});

export async function PUT(
  request: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    const invalidRequest = checkMutationRequest(request, "application/json");
    if (invalidRequest) return invalidRequest;

    const id = idSchema.safeParse((await params).id);
    if (!id.success) return apiError(404, "NOT_FOUND");
    const cardId = id.data.toLowerCase();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "BAD_REQUEST");
    }
    const label = labelInputSchema.safeParse(body);
    if (!label.success) return apiError(400, "BAD_REQUEST");

    const cardInput = cardInputSchema.safeParse(body);
    if (!cardInput.success
      || (cardInput.data.analysisBasis === "cycle" && cardInput.data.cycleStartDay === null)
      || (cardInput.data.analysisBasis === "month" && cardInput.data.cycleStartDay !== null)) {
      return apiError(400, "INVALID_CARD");
    }

    const input: CardUpdateInput = { label: label.data.label.trim(), ...cardInput.data };
    const result = await updateCard(user.id, cardId, input);
    switch (result.kind) {
      case "updated":
        return Response.json({ updated: true });
      case "not_found":
        return apiError(404, "NOT_FOUND");
      case "invalid_label":
        return apiError(400, "INVALID_LABEL");
      case "duplicate_label":
        return apiError(409, "DUPLICATE_LABEL");
    }
  } catch {
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
