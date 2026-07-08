"use client";

import { useMemo } from "react";
import { PRACTICE_OPTIONS } from "../workflows/practices";
import { ModalSelect, type ModalSelectOption } from "../modals/ModalSelect";
import { ModalTextInput } from "../modals/ModalTextInput";

const OPTION_NONE = "__none__";
const OPTION_OTHER = "Other";

interface ProjectPracticeFieldProps {
    id: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

export function ProjectPracticeField({
    id,
    value,
    onChange,
    disabled = false,
}: ProjectPracticeFieldProps) {
    const selectedOption = useMemo(() => {
        if (!value.trim()) return OPTION_NONE;
        return (PRACTICE_OPTIONS as readonly string[]).includes(value)
            ? value
            : OPTION_OTHER;
    }, [value]);
    const customValue =
        selectedOption === OPTION_OTHER && value !== OPTION_OTHER ? value : "";
    const options = useMemo<ModalSelectOption[]>(
        () => [
            { value: OPTION_NONE, label: "None" },
            ...PRACTICE_OPTIONS,
        ],
        [],
    );

    function handleSelect(option: string) {
        if (option === OPTION_NONE) {
            onChange("");
            return;
        }
        if (option === OPTION_OTHER) {
            onChange(OPTION_OTHER);
            return;
        }
        onChange(option);
    }

    return (
        <div className="space-y-2">
            <ModalSelect
                id={id}
                value={selectedOption}
                options={options}
                onChange={handleSelect}
                placeholder="Select practice"
                disabled={disabled}
            />
            {selectedOption === OPTION_OTHER && (
                <ModalTextInput
                    type="text"
                    value={customValue}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="Enter practice..."
                    disabled={disabled}
                />
            )}
        </div>
    );
}
