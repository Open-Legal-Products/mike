"use client";

import { createPortal } from "react-dom";
import { WarningPopup } from "../popups/WarningPopup";

interface Props {
    open: boolean;
    label?: string;
    warning?: string | null;
    onWarningClose?: () => void;
}

export function UploadOverlay({
    open,
    label = "Drop files here to add to chat",
    warning,
    onWarningClose,
}: Props) {
    return (
        <>
            {open &&
                createPortal(
                    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-white/35 p-6 backdrop-blur-md">
                        <p className="font-serif text-xl text-gray-900">
                            {label}
                        </p>
                    </div>,
                    document.body,
                )}
            <WarningPopup
                open={!!warning}
                onClose={onWarningClose ?? (() => {})}
                message={warning}
            />
        </>
    );
}
