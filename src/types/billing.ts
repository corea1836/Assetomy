export const UPGRADE_SOURCES = ["teaser", "trend", "summary", "pricing", "settings"] as const;
export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];
