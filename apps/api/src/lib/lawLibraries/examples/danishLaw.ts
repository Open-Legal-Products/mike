import { registerLawLibrary } from "../registry";
import type { OpenAIToolSchema } from "../../llm/types";

/**
 * Danish Law plugin for the law library registry.
 *
 * Provides:
 * - A system prompt fragment explaining Danish citation conventions
 *   (LBK/BEK/BKI numbers from Retsinformation.dk, retspraksis system)
 * - A `danish_law_search` tool schema for live statute lookups
 *
 * Call setupDanishLaw() once at application startup to activate.
 * No other files need to be modified.
 *
 * Example:
 *   import { setupDanishLaw } from "lib/lawLibraries/examples/danishLaw";
 *   setupDanishLaw();
 */

const DANISH_LAW_TOOLS: OpenAIToolSchema[] = [
    {
        type: "function",
        function: {
            name: "danish_law_search",
            description:
                "Search Retsinformation.dk for Danish statutes, regulations, and administrative orders. " +
                "Returns the official LBK/BEK/BKI number, title, and URL for each matching document. " +
                "Use this when the user asks about Danish legislation or when you need to cite a specific statute.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "Search query in Danish or English, e.g. 'lejeloven', 'aktieselskabsloven', " +
                            "'arbejdsmiljø', or 'The Danish Companies Act'.",
                    },
                    doc_type: {
                        type: "string",
                        enum: ["LBK", "BEK", "BKI", "LOV", "VEJ", "CIR"],
                        description:
                            "Optional filter: LBK=consolidated act, BEK=ministerial order, " +
                            "BKI=royal decree, LOV=act, VEJ=guidance, CIR=circular. " +
                            "Omit to search all document types.",
                    },
                },
                required: ["query"],
            },
        },
    },
];

export function setupDanishLaw(): void {
    registerLawLibrary({
        id: "danish-law",
        displayName: "Danish Law (Retsinformation.dk)",

        systemPromptFragment: () => `

## Danish Law

When analyzing Danish legal documents or answering questions about Danish law:

**Citation format**: Cite statutes using their official document type and number from Retsinformation.dk:
- Consolidated acts: "LBK nr. 1234 af DD.MM.ÅÅÅÅ" (lovbekendtgørelse)
- Ministerial orders: "BEK nr. 567 af DD.MM.ÅÅÅÅ" (bekendtgørelse)
- Acts: "LOV nr. 890 af DD.MM.ÅÅÅÅ" (lov)
- Royal decrees: "BKI nr. 12 af DD.MM.ÅÅÅÅ" (bekendtgørelse i kraft)

**Court system**: Danish courts use the "retspraksis" system. Cite court decisions as:
- Supreme Court (Højesteret): "U ÅÅÅÅ.XXX H" (from Ugeskrift for Retsvæsen)
- High Courts (Landsret): "U ÅÅÅÅ.XXX Ø" (Eastern) or "U ÅÅÅÅ.XXX V" (Western)
- District Courts (Byret): case number format "BS-XXXXX-ÅÅÅÅ"

**Key legal concepts**:
- Use Danish legal terminology where precision matters (e.g. "aftaleloven" not just "contract law")
- Note when a statutory provision has been amended after its consolidation number was issued
- Distinguish between "retlig standard" (legal standard) and "skønsmæssig afgørelse" (discretionary decision)

**Retsinformation.dk**: All current Danish legislation is available at retsinformation.dk. Use the danish_law_search tool to find the correct LBK/BEK/BKI number before citing a statute.`,

        tools: () => DANISH_LAW_TOOLS,
    });
}
