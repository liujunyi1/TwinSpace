import { safeJsonParse } from "@/lib/utils";

export function parseTraits(traitsJson?: string | null) {
  return safeJsonParse<{
    labels?: string[];
    extroversion?: number;
    emotionalExpression?: number;
    directness?: number;
    socialInitiative?: number;
    interestTopics?: string[];
    comfortPreference?: string[];
    boundaries?: string[];
  }>(traitsJson, {});
}
