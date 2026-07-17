import { A2ajProvider } from "./a2ajProvider";
import { CourtListenerProvider } from "./courtlistenerProvider";
import { CanLiiLicensedProvider } from "./licensedConnector";
import {
    JusticeLawsProvider,
    OntarioELawsProvider,
} from "./officialLegislation";
import { LegalSourceRegistry } from "./registry";

export {
    normalizeCanadianCitation,
    parseCanadianCitations,
    renderCanadianCitation,
    verifyCanadianCitations,
} from "./canadianCitations";

export * from "./types";
export { A2ajClient, A2ajApiError } from "./a2ajClient";
export { A2ajProvider, findA2ajPassages } from "./a2ajProvider";
export { CourtListenerProvider } from "./courtlistenerProvider";
export {
    JusticeLawsProvider,
    OntarioELawsProvider,
    parseJusticeXml,
    parseOntarioSections,
} from "./officialLegislation";
export {
    CanLiiLicensedProvider,
    LicensedConnectorGate,
    loadCanLiiEntitlement,
} from "./licensedConnector";
export {
    ONTARIO_COURT_FORMS,
    ONTARIO_PROCEDURE_SOURCES,
    calculateOntarioDeadline,
    checkOntarioProcedureSources,
} from "./ontarioProcedure";
export type {
    OntarioCourtForm,
    OntarioDeadlineInput,
    OntarioDeadlineResult,
    OntarioProcedureSource,
} from "./ontarioProcedure";
export { LegalSourceRegistry } from "./registry";

export function createLegalSourceRegistry() {
    return new LegalSourceRegistry()
        .register(new CourtListenerProvider())
        .register(new A2ajProvider())
        .register(new OntarioELawsProvider())
        .register(new JusticeLawsProvider())
        .register(new CanLiiLicensedProvider());
}
