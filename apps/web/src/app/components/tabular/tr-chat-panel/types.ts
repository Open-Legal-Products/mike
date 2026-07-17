import type { AssistantEvent } from "../../shared/types";
import type { TRCitationAnnotation } from "@/app/lib/mikeApi";

export interface TRMessage {
    role: "user" | "assistant";
    content: string;
    events?: AssistantEvent[];
    annotations?: TRCitationAnnotation[];
    isStreaming?: boolean;
}
