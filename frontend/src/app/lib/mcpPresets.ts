/**
 * MCP preset configurations for common third-party MCP servers.
 * These presets help users quickly configure popular MCP services
 * without manually typing URLs and names.
 */

export interface McpPresetServerId {
    value: string;
    label: string;
    description: string;
}

export interface McpPreset {
    id: string;
    brand: string;
    description: string;
    serverUrlTemplate: string;
    serverIdPlaceholder: string;
    serverIdOptions: McpPresetServerId[];
    defaultName: string;
    docsUrl: string;
    consoleUrl: string;
    tokenHint: string;
}

export const PKULAW_PRESET: McpPreset = {
    id: "pkulaw",
    brand: "北大法宝",
    description: "中国领先的法律数据库，提供法规/案例检索、语义搜索、引用核验等法律 AI 能力",
    serverUrlTemplate: "https://apim-gw.pkulaw.com/{serverId}/mcp",
    serverIdPlaceholder: "law-keyword",
    serverIdOptions: [
        {
            value: "law-keyword",
            label: "法规关键词检索",
            description: "通过关键词检索法律法规，支持标题/全文匹配",
        },
        {
            value: "law-semantic",
            label: "法规语义检索",
            description: "通过自然语言语义检索法律法规",
        },
        {
            value: "case-keyword",
            label: "案例关键词检索",
            description: "通过关键词检索司法案例",
        },
        {
            value: "case-semantic",
            label: "案例语义检索",
            description: "通过自然语言语义检索司法案例",
        },
        {
            value: "citation-validator",
            label: "引用核验",
            description: "验证法律引用是否准确有效",
        },
        {
            value: "fatiao-precise",
            label: "法条精准",
            description: "精准定位具体法条内容",
        },
        {
            value: "case-number",
            label: "案号溯源",
            description: "通过案号追踪案件信息",
        },
        {
            value: "semantic-nlsql",
            label: "语义 NL-SQL",
            description: "自然语言转结构化法律查询",
        },
        {
            value: "law-recognition",
            label: "法律识别",
            description: "识别文本中的法律实体和关系",
        },
        {
            value: "grounded-answer",
            label: "有依据回答",
            description: "基于法律数据的 grounded QA",
        },
        {
            value: "legal-research",
            label: "法律研究",
            description: "综合法律研究组合工作流",
        },
        {
            value: "contract-review-lite",
            label: "合同审查轻量",
            description: "轻量级合同审查",
        },
    ],
    defaultName: "北大法宝-{serverId}",
    docsUrl: "https://mcp.pkulaw.com/docs",
    consoleUrl: "https://mcp.pkulaw.com/console",
    tokenHint: "从北大法宝控制台获取 Token",
};

export const MCP_PRESETS: McpPreset[] = [PKULAW_PRESET];

export function getPresetForUrl(serverUrl: string): McpPreset | null {
    try {
        const url = new URL(serverUrl);
        const hostname = url.hostname.toLowerCase();
        if (hostname.includes("pkulaw.com")) {
            return PKULAW_PRESET;
        }
        return null;
    } catch {
        return null;
    }
}

export function getPresetForId(presetId: string): McpPreset | null {
    return MCP_PRESETS.find((p) => p.id === presetId) ?? null;
}

export function buildPresetUrl(
    preset: McpPreset,
    serverId: string,
): string {
    return preset.serverUrlTemplate.replace("{serverId}", serverId);
}

export function buildPresetName(
    preset: McpPreset,
    serverId: string,
): string {
    const option = preset.serverIdOptions.find((o) => o.value === serverId);
    const serverIdLabel = option?.label ?? serverId;
    return `${preset.brand}-${serverIdLabel}`;
}

export function isPkulawConnector(serverUrl: string): boolean {
    return getPresetForUrl(serverUrl)?.id === "pkulaw";
}
