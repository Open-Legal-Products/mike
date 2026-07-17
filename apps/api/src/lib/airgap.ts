// Central air-gap policy. AIRGAPPED must fence off EVERY external egress channel
// in code (not just the LLM), so the "no content leaves" guarantee holds even if
// network isolation is imperfect.

/** True when the deployment is running in air-gapped mode. */
export function isAirgapped(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.AIRGAPPED === "true";
}
