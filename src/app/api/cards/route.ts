import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { createCard } from "@/lib/store/cards";
import type { CreateCardResponse } from "@/types/upload";

const inputSchema = z.object({ label: z.string() });

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
    const input = inputSchema.safeParse(body);
    if (!input.success) return apiError(400, "BAD_REQUEST");

    const label = input.data.label.trim();
    const result = await createCard(user.id, label);
    switch (result.kind) {
      case "created":
        return Response.json({ card: { id: result.cardId, label } } satisfies CreateCardResponse, { status: 201 });
      case "duplicate_label":
        return apiError(409, "DUPLICATE_LABEL");
      case "invalid_label":
        return apiError(400, "INVALID_LABEL");
    }
  } catch {
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
