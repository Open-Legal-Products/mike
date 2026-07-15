import type { AssistantEvent } from "../../shared/types";

export function eventErrorMessage(event: AssistantEvent): string | null {
    if (event.type === "error") return event.message;
    if ("error" in event && typeof event.error === "string" && event.error) {
        return event.error;
    }
    return null;
}

export function toolCallLabel(name: string): string {
    if (name === "ask_inputs") return "正在请求输入...";
    if (name === "generate_docx") return "正在创建文档...";
    if (name === "generate_excel") return "正在创建电子表格...";
    if (name === "generate_ppt") return "正在创建演示文稿...";
    if (name === "edit_document") return "正在编辑文档...";
    if (name === "read_document") return "正在阅读文档...";
    if (name === "fetch_documents") return "正在阅读文档...";
    if (name === "find_in_document") return "正在搜索文档...";
    if (name === "replicate_document") return "正在复制文档...";
    if (name === "read_workflow") return "正在加载工作流...";
    if (name === "list_workflows") return "正在加载工作流...";
    if (name === "list_documents") return "正在加载文档...";
    if (name === "courtlistener_search_case_law")
        return "正在检索判例...";
    if (name === "courtlistener_get_cases") return "正在获取案例...";
    if (name === "courtlistener_find_in_case") return "正在搜索案例...";
    if (name === "courtlistener_read_case") return "正在阅读案例...";
    if (name === "courtlistener_verify_citations")
        return "正在核验引文...";
    if (name.startsWith("mcp_")) return "正在使用连接器...";
    return name ? `正在运行 ${name}...` : "处理中...";
}
