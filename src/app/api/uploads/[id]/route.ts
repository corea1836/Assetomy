import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { apiError, checkMutationRequest } from "@/lib/http";
import { removeStatements, statementPath } from "@/lib/store/statements";
import { deleteUpload } from "@/lib/store/uploads";

const idSchema = z.uuid();

export async function DELETE(
  request: Request, { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await getSessionUser();
    if (!user) return apiError(401, "UNAUTHORIZED");
    const invalidRequest = checkMutationRequest(request, null);
    if (invalidRequest) return invalidRequest;
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return apiError(404, "NOT_FOUND");

    const uploadId = id.data.toLowerCase();
    const result = await deleteUpload(user.id, uploadId);
    switch (result.kind) {
      case "deleted":
        try {
          await removeStatements([statementPath(user.id, uploadId)]);
        } catch {
          // Maintenance retries removal after the database deletion has committed.
        }
        return Response.json({ deleted: true });
      case "not_found":
        return apiError(404, "NOT_FOUND");
      case "processing":
        return apiError(409, "UPLOAD_PROCESSING");
    }
  } catch {
    return apiError(503, "TEMPORARY_FAILURE");
  }
}
