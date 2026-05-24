const fs = require("fs");
const path = require("path");

// Read the JSON file with comments
const jsonPath = path.join(__dirname, "../hooks/google-scholar-courts.json");
const content = fs.readFileSync(jsonPath, "utf8");

// Remove comments from JSON (simple approach - remove lines starting with //)
const lines = content.split("\n");
const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("//");
});

// Also remove trailing commas before closing braces/brackets (common JSON issue)
let cleanedContent = cleanedLines.join("\n");
cleanedContent = cleanedContent.replace(/,(\s*[}\]])/g, "$1");

// Parse the cleaned JSON
const data = JSON.parse(cleanedContent);

// Generate TypeScript file content
let tsContent = `// Court data types and constants
// This file is auto-generated from google-scholar-courts.json

export interface SubCourt {
    id: string;
    value: string;
    label: string;
}

export interface StateCourt {
    id: string;
    value: string;
    label: string;
    subCourts: SubCourt[];
}

export interface Circuit {
    id: string;
    value: string;
    label: string;
    subCourts: SubCourt[];
}

export interface FederalCourts {
    supreme: SubCourt[];
    specialist: SubCourt[];
    circuits: Circuit[];
}

export interface CourtsData {
    stateCourts: StateCourt[];
    federalCourts: FederalCourts;
}

// Court data
export const courtsData: CourtsData = ${JSON.stringify(data, null, 4)};

export const stateCourtsData = courtsData.stateCourts;
export const federalCourtsData = courtsData.federalCourts;

// Helper functions
export function getCircuits(): Circuit[] {
    return federalCourtsData.circuits;
}

export function getCircuitCourts(circuitLabel: string): SubCourt[] {
    const circuit = federalCourtsData.circuits.find(
        (c) => c.label === circuitLabel
    );
    return circuit?.subCourts || [];
}

export function getNationalCourts(): SubCourt[] {
    return federalCourtsData.supreme;
}

export function getSpecialistCourts(): SubCourt[] {
    return federalCourtsData.specialist || [];
}
`;

// Write to court-data.ts
const outputPath = path.join(__dirname, "../data/court-data.ts");
fs.writeFileSync(outputPath, tsContent, "utf8");

console.log("Successfully converted court data to TypeScript!");
console.log(`Output: ${outputPath}`);
