import "server-only";
import { sha256Hex } from "@/lib/crypto";
import type { EventKind, IdentityScope } from "@/types/parsing";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function transactionFingerprint(input: {
  cardId: string;
  identityScope: IdentityScope;
  sourceEventKey: string;
  eventKind: EventKind;
}): string {
  const { cardId, identityScope, sourceEventKey, eventKind } = input;
  if (cardId.length !== 36 || !UUID_PATTERN.test(cardId)) throw new Error("invalid_card_id");
  return sha256Hex(new TextEncoder().encode(`${cardId}|${identityScope}|${sourceEventKey}|${eventKind}`));
}
