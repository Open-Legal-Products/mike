/**
 * Law Library Plugin System
 *
 * Allows jurisdiction-specific law integrations (Danish law, EU law,
 * Norwegian law, Kenyan law, etc.) to be added as self-contained plugins
 * without editing chatTools.ts or any route file.
 *
 * Usage — registering a plugin at startup:
 *
 *   import { setupDanishLaw } from "lib/lawLibraries/examples/danishLaw";
 *   setupDanishLaw();
 *
 * The plugin's system prompt fragment and tools are automatically picked up
 * by buildMessages() in chatTools.ts via buildLawLibrarySystemPrompt() and
 * getAllLawLibraryTools().
 */

export type { LawLibraryPlugin } from "./registry";

export {
    registerLawLibrary,
    getRegisteredLawLibrary,
    getActiveLawLibraries,
    buildLawLibrarySystemPrompt,
    getAllLawLibraryTools,
    _resetLawLibraryRegistryForTesting,
} from "./registry";
