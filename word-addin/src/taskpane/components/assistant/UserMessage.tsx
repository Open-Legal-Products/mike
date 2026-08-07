import React from "react";
import { FileText, Waypoints } from "lucide-react";

/**
 * Right-aligned user bubble, duplicated from the web app's UserMessage
 * including the same file/workflow chips used by the frontend assistant.
 */
export function UserMessage({
  content,
  files,
  workflow,
}: {
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
}): React.ReactElement {
  return (
    <div className="w-full flex justify-end">
      <div className="max-w-[80%] bg-gray-100 rounded-xl px-4 py-3">
        <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
          {content}
        </p>
        {(workflow || (files && files.length > 0)) && (
          <div className="mt-3 flex flex-wrap justify-end gap-1.5">
            {workflow && (
              <div className="inline-flex items-center gap-1 rounded-full border border-blue-600 bg-blue-600 py-0.5 pl-2 pr-2.5 text-xs text-white shadow">
                <Waypoints className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-[140px] truncate">{workflow.title}</span>
              </div>
            )}
            {files?.map((file) => (
              <div
                key={`${file.document_id ?? file.filename}-${file.filename}`}
                className="inline-flex items-center gap-1 rounded-[10px] border border-white/70 bg-white py-0.5 pl-2 pr-2.5 text-xs text-gray-800 shadow-[0_2px_6px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
              >
                <FileText className="h-2.5 w-2.5 shrink-0 text-gray-400" />
                <span className="max-w-[140px] truncate">{file.filename}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
