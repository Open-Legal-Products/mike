import mammoth from "mammoth";

// Helper function to convert File to base64 data URL
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result);
        };
        reader.onerror = (error) => reject(error);
    });
};

export async function processFiles(
    files: { name: string; file?: File }[]
): Promise<{ filename: string; data: string }[]> {
    const processedFilesPromises = files
        .filter((f) => f.file)
        .map(async (f) => {
            const file = f.file!;
            let processedFile: File = file;

            // Apply conversions if needed
            if (
                file.type ===
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                file.name.endsWith(".docx")
            ) {
                processedFile = await convertDocxToText(file);
            } else if (
                file.type === "text/plain" ||
                file.name.endsWith(".txt") ||
                file.name.endsWith(".doc")
            ) {
                processedFile = await convertToTextFile(file);
            }
            // PDFs and others are left as-is

            return {
                filename: processedFile.name,
                data: await fileToBase64(processedFile),
            };
        });

    return Promise.all(processedFilesPromises);
}

async function convertDocxToText(file: File): Promise<File> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;
    return createTextFile(text, file.name);
}

async function convertToTextFile(file: File): Promise<File> {
    const text = await file.text();
    return createTextFile(text, file.name);
}

function createTextFile(content: string, fileName: string): File {
    const blob = new Blob([content], { type: "text/plain" });
    return new File([blob], fileName, { type: "text/plain" });
}
