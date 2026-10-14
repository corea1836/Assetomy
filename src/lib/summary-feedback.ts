export function normalizeFeedback(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function feedbackLength(text: string): number {
  return Array.from(text).length;
}
