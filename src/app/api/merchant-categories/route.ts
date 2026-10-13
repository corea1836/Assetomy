import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { setMerchantCategory } from "@/lib/store/merchant-categories";
import { CATEGORY_IDS, type MerchantCategoryResponse } from "@/types/category";

const inputSchema = z.object({
  merchantKey: z.string().min(1).max(200),
  category: z.enum(CATEGORY_IDS),
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

    const result = await setMerchantCategory(user.id, input.data.merchantKey, input.data.category);
    switch (result.kind) {
      case "updated":
        return Response.json({ updated: result.updated } satisfies MerchantCategoryResponse);
      case "not_found":
        return apiError(404, "NOT_FOUND");
    }
  } catch (error) {
    console.error(`merchant_categories:${error instanceof Error ? error.constructor.name : "unknown"}`, userId);
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
