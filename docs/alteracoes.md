# Histórico de Alterações

Registro das principais mudanças feitas neste fork do [mike](https://github.com/willchen96/mike), documentando o que foi alterado, por que e como funciona.

---

## 1. Adaptação para Português Brasileiro (pt-BR)

**Commits:** `a9e0d67` → `fde100d`  
**Branch de trabalho:** `adaptacao-pt-br` (mergeada em `main`)

### O que foi feito

Toda a interface do usuário foi traduzida para português brasileiro usando `next-intl`. Os textos foram removidos do código-fonte e centralizados em `frontend/messages/pt-BR.json`.

### Arquivos de configuração (já existiam)

| Arquivo | Função |
|---|---|
| `frontend/messages/pt-BR.json` | Todas as strings traduzidas |
| `frontend/src/i18n/request.ts` | Configuração do next-intl |
| `frontend/next.config.ts` | Plugin do next-intl habilitado |

### Como usar em componentes

**Client components (`"use client"`):**
```tsx
import { useTranslations } from "next-intl";

export default function MeuComponente() {
  const t = useTranslations("nomeDoNamespace");
  return <button>{t("nomeDaChave")}</button>;
}
```

**Server components:**
```tsx
import { getTranslations } from "next-intl/server";

export default async function MinhaPagina() {
  const t = await getTranslations("nomeDoNamespace");
  return <h1>{t("titulo")}</h1>;
}
```

### Componentes traduzidos

- `ChatInput` — label "Fluxos de trabalho" e tooltip do botão
- `AssistantWorkflowModal` — modal de fluxos de trabalho
- `ChatView` — visualização do chat
- `InitialView` — tela inicial do assistente
- `SelectAssistantProjectModal` — modal de seleção de projeto
- `FileDirectory` — diretório de arquivos
- `RowActions` — ações de linha
- `SidebarChatItem` — item do chat na barra lateral
- `AddDocumentsModal` / `AddProjectDocsModal` — modais de adição de documentos
- `DocView` / `DocViewModal` — visualização de documentos
- `UploadNewVersionModal` — modal de nova versão
- `ProjectExplorer` / `NewProjectModal` / `ProjectPage` / `ProjectsOverview` — telas de projetos
- `AddColumnModal` / `AddNewTRModal` / `TRChatPanel` / `TRTable` / `TabularReviewView` — revisão tabular
- `NewWorkflowModal` / `ShareWorkflowModal` / `WorkflowList` — fluxos de trabalho
- `delete-chats-modal` — modal de exclusão de chats
- `account/page.tsx` — configurações de conta (perfil, plano, zona de risco)
- `account/models/page.tsx` — preferências de modelo e chaves de API
- `account/layout.tsx` — navegação de configurações ("Configurações", "Geral", "Modelos e Chaves de API")
- `login/page.tsx` / `signup/page.tsx` — autenticação
- `ApiKeyMissingModal` — modal de chave ausente
- `support/page.tsx` — página de suporte

### Adaptações além da tradução

- Terminologia jurídica brasileira (CLT, CNJ, advogado, processo, etc.)
- Sugestões de prompts com exemplos brasileiros
- "Tabular Reviews" → "Revisões Tabulares" → terminologia de escritório brasileiro
- Áreas de prática configuráveis via variáveis de ambiente

---

## 2. Correção de Labels no ChatInput

**Commit:** `a9e0d67`

O botão de fluxos de trabalho no `ChatInput` estava com o texto hardcoded em inglês ("Workflows"). Corrigido para usar `t("workflows")` e `t("abrirWorkflows")` via next-intl.

**Chaves adicionadas em `pt-BR.json`:**
```json
"workflows": "Fluxos de trabalho",
"abrirWorkflows": "Abrir fluxos de trabalho"
```

---

## 3. Sistema de Erros Estruturados do Chat

**Commits:** `ed833e1`, `4896b8c`

### Problema

Quando a API do provedor de IA retornava um erro (ex.: saldo insuficiente na Anthropic), o chat travava silenciosamente — sem nenhuma mensagem para o usuário. Dois bugs separados foram encontrados:

1. **Backend:** o erro era capturado mas a mensagem enviada era um texto bruto em inglês vindo do SDK
2. **Frontend:** o `throw` dentro do `try/catch` interno do SSE parser era silenciado pelo próprio catch, que apenas logava um `console.warn`

### Solução no backend

Os arquivos `backend/src/routes/chat.ts` e `backend/src/routes/projectChat.ts` passaram a usar a função `extractError()` que retorna um objeto com `code` e `message`:

```typescript
type StreamError = { code: string; message: string };

function extractError(err: unknown): StreamError {
    // extrai a mensagem real do erro (SDK da Anthropic/OpenAI aninha em err.error.error.message)
    let message = "Unexpected stream error";
    // ...extração...

    // classifica por padrões no texto
    const m = message.toLowerCase();
    let code = "unknown";
    if (m.includes("credit balance") || m.includes("insufficient_quota"))
        code = "insufficient_credits";
    else if (m.includes("invalid api key") || m.includes("authentication"))
        code = "invalid_api_key";
    else if (m.includes("rate limit") || m.includes("too many requests"))
        code = "rate_limit";
    else if (m.includes("context length") || m.includes("token limit"))
        code = "context_length";
    else if (m.includes("timeout") || m.includes("timed out"))
        code = "timeout";
    else if (m.includes("overloaded") || m.includes("capacity"))
        code = "overloaded";

    return { code, message };
}
```

O evento SSE enviado passou a ser:
```json
{ "type": "error", "code": "insufficient_credits", "message": "Your credit balance is too low..." }
```

### Solução no frontend

Em `frontend/src/app/hooks/useAssistantChat.ts`, o handler de erro no loop SSE foi corrigido em dois pontos:

**Antes (bugado — throw silenciado pelo catch):**
```typescript
if (data.type === "error") {
    throw new Error(data.message); // ← swallowed pelo try/catch do JSON.parse
}
```

**Depois (correto):**
```typescript
// 1. Declara variável antes do loop
let streamError: string | null = null;

// 2. Dentro do loop: armazena em vez de lançar
if (data.type === "error") {
    const code = typeof data.code === "string" ? data.code : "unknown";
    const knownCodes = ["insufficient_credits", "invalid_api_key", "rate_limit",
                        "context_length", "timeout", "overloaded", "unknown"];
    streamError = knownCodes.includes(code)
        ? t(`erros.${code}`)           // tradução em português
        : data.message ?? t("erroGenerico");
    continue;
}

// 3. Após o loop: lança fora do try/catch interno
if (streamError) throw new Error(streamError);
```

### Traduções dos códigos de erro

Adicionadas em `frontend/messages/pt-BR.json` → `shared.assistantChat.erros`:

| Código | Mensagem em português |
|---|---|
| `insufficient_credits` | Saldo insuficiente para usar a API. Verifique o plano de cobrança do provedor. |
| `invalid_api_key` | Chave de API inválida. Verifique suas configurações em Conta → Modelos e Chaves de API. |
| `rate_limit` | Limite de requisições atingido. Aguarde alguns instantes e tente novamente. |
| `context_length` | A conversa está longa demais para ser processada. Tente iniciar uma nova conversa. |
| `timeout` | A resposta demorou tempo demais. Tente novamente. |
| `overloaded` | O serviço está sobrecarregado no momento. Tente novamente em alguns instantes. |
| `unknown` | Desculpe, algo deu errado. Tente novamente. |

---

## 4. Outras Melhorias

### Título da aba do navegador configurável
**Commit:** `4556c94`  
O título da aba passou a ser definido via variável de ambiente, evitando referências ao nome original do projeto hardcoded no código.

### Centralização de marca em `brand.ts`
**Commit:** `9dfa9ca`  
Criado `brand.ts` com nome, logo e configurações visuais da aplicação. Componente `AppLogo` usa essa config.

### Desabilitar DevTools do Next.js
**Commit:** `0aef173`  
`devIndicators: false` em `next.config.ts` para não exibir o indicador de desenvolvimento.

### Correção de conflito DOM durante streaming
**Commits:** `4872c90`, `78e2b03`  
Plugins do `ReactMarkdown` causavam erros de `removeChild` durante o streaming. Desabilitados enquanto a mensagem está sendo transmitida.

---

## Estrutura de Namespaces do pt-BR.json

```
pages/
  auth/         → login, signup
  conta/        → perfil, plano, ações, zona de risco
  modelos/      → preferências de modelo e chaves de API
  configLayout/ → navegação das configurações
  assistente/   → tela inicial do assistente
  projetos/     → listagem e detalhes de projetos
  tabular/      → revisões tabulares
  workflows/    → fluxos de trabalho
  suporte/      → página de suporte

shared/
  assistantChat/     → mensagens do chat, erros de stream
  trackedChanges/    → eventos rastreados (criar, editar, ler doc)
  chatInput/         → input do chat
  ...
```

---

## Variáveis de Ambiente Relevantes (frontend)

| Variável | Descrição |
|---|---|
| `NEXT_PUBLIC_APP_TITLE` | Título exibido na aba do navegador |
| `NEXT_PUBLIC_APP_NAME` | Nome da aplicação (usado em textos) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anônima do Supabase |
| `NEXT_PUBLIC_API_URL` | URL base do backend Express |
