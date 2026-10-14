import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { createCard } from "@/lib/store/cards";
import { ANALYSIS_BASES, CARD_ISSUERS, type NewCardInput } from "@/types/card";
import type { CreateCardResponse } from "@/types/upload";

const inputSchema = z.object({ label: z.string() });
const cardInputSchema = z.object({
  issuer: z.enum(CARD_ISSUERS),
  analysisBasis: z.enum(ANALYSIS_BASES),
  cycleStartDay: z.int().min(1).max(31).nullable(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    const invalidRequest = checkMutationRequest(request, "application/json");
    if (invalidRequest) return invalidRequest;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "BAD_REQUEST");
    }
    const labelInput = inputSchema.safeParse(body);
    if (!labelInput.success) return apiError(400, "BAD_REQUEST");

    const cardInput = cardInputSchema.safeParse(body);
    if (!cardInput.success
      || (cardInput.data.analysisBasis === "cycle" && cardInput.data.cycleStartDay === null)
      || (cardInput.data.analysisBasis === "month" && cardInput.data.cycleStartDay !== null)) {
      return apiError(400, "INVALID_CARD");
    }

    const input: NewCardInput = { label: labelInput.data.label.trim(), ...cardInput.data };
    const result = await createCard(user.id, input);
    switch (result.kind) {
      case "created":
        return Response.json({
          card: {
            id: result.cardId,
            label: input.label,
            issuer: input.issuer,
            analysisBasis: input.analysisBasis,
            cycleStartDay: input.cycleStartDay,
          },
        } satisfies CreateCardResponse, { status: 201 });
      case "duplicate_label":
        return apiError(409, "DUPLICATE_LABEL");
      case "invalid_label":
        return apiError(400, "INVALID_LABEL");
    }
  } catch {
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
