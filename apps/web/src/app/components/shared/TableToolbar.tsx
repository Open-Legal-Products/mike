import React from "react";

interface ToolbarItem<T extends string> {
    id: T;
    label: string;
}

interface Props<T extends string> {
    items: ToolbarItem<T>[];
    active: T;
    onChange: (id: T) => void;
    /** Optional content rendered on the right side of the toolbar */
    actions?: React.ReactNode;
}

export function TableToolbar<T extends string>({
    items,
    active,
    onChange,
    actions,
}: Props<T>) {
    const hasItems = items.length > 0;

    return (
        <div className="flex items-center h-10 px-4 border-b border-gray-200 md:px-10">
            {hasItems && (
                <div className="flex-1 flex items-center gap-5">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => onChange(item.id)}
                            className={`text-xs transition-colors ${
                                active === item.id
                                    ? "font-medium text-gray-700"
                                    : "font-normal text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
            {actions && (
                <div
                    className={
                        hasItems
                            ? "flex items-center gap-2"
                            : "flex flex-1 items-center gap-2"
                    }
                >
                    {actions}
                </div>
            )}
        </div>
    );
}
