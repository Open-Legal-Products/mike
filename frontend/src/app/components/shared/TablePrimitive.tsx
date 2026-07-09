"use client";

import {
    useEffect,
    useRef,
    useState,
    type HTMLAttributes,
    type MouseEvent,
    type ReactNode,
} from "react";
import { cn } from "@/app/lib/utils";
import {
    CLOSE_ROW_ACTIONS_EVENT,
    closeRowActionMenus,
} from "@/app/components/shared/RowActions";
import { GLASS_DROPDOWN } from "@/app/components/shared/HeaderFilterDropdown";

export const TABLE_STICKY_CELL_BG = "bg-[#fafbfc]";
export const TABLE_PRIMARY_CELL_WIDTH_CLASS =
    "w-[248px] sm:w-[292px] md:w-[332px] shrink-0";
export const TABLE_CHECKBOX_CLASS =
    "h-2.5 w-2.5 shrink-0 rounded border-gray-200 cursor-pointer accent-black";

type DivProps = HTMLAttributes<HTMLDivElement>;

export function SkeletonLine({ className }: { className?: string }) {
    return (
        <div
            className={cn("h-3 rounded bg-gray-100 animate-pulse", className)}
        />
    );
}

export function SkeletonDot({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "h-2.5 w-2.5 shrink-0 rounded bg-gray-100 animate-pulse",
                className,
            )}
        />
    );
}

export function TableScrollArea({
    children,
    className,
    innerClassName,
    header,
}: DivProps & { innerClassName?: string; header?: ReactNode }) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);

    function syncHeader() {
        if (headerRef.current && bodyRef.current) {
            headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
        }
    }

    return (
        <div className={cn("w-full min-h-0 flex-1 flex flex-col overflow-hidden", className)}>
            {header !== undefined && (
                <div ref={headerRef} className="shrink-0 overflow-hidden">
                    {header}
                </div>
            )}
            <div
                ref={bodyRef}
                className="min-h-0 flex-1 overflow-auto"
                onScroll={header !== undefined ? syncHeader : undefined}
            >
                <div className={cn("flex min-h-full min-w-max flex-col", innerClassName)}>
                    {children}
                </div>
            </div>
        </div>
    );
}

export function TableHeaderRow({ children, className, ...props }: DivProps) {
    return (
        <div
            className={cn(
                "sticky top-0 z-[70] flex h-8 items-center border-b border-gray-200 bg-[#fafbfc] pr-3 text-xs font-medium text-gray-500 select-none md:pr-10",
                className,
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export function TableRow({
    children,
    className,
    interactive = true,
    onContextMenu,
    rightClickDropdown,
    ...props
}: DivProps & {
    interactive?: boolean;
    rightClickDropdown?: ReactNode | ((close: () => void) => ReactNode);
}) {
    const [menuCoords, setMenuCoords] = useState<{
        top: number;
        left: number;
    } | null>(null);

    useEffect(() => {
        if (!menuCoords) return;
        function handleClick() {
            setMenuCoords(null);
        }
        function handleCloseRowActions() {
            setMenuCoords(null);
        }
        document.addEventListener("click", handleClick);
        document.addEventListener(CLOSE_ROW_ACTIONS_EVENT, handleCloseRowActions);
        return () => {
            document.removeEventListener("click", handleClick);
            document.removeEventListener(
                CLOSE_ROW_ACTIONS_EVENT,
                handleCloseRowActions,
            );
        };
    }, [menuCoords]);

    function closeRightClickDropdown() {
        setMenuCoords(null);
    }

    function handleContextMenu(e: MouseEvent<HTMLDivElement>) {
        onContextMenu?.(e);
        if (!rightClickDropdown || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        closeRowActionMenus();
        const menuWidth = 192;
        setMenuCoords({
            top: e.clientY,
            left: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
        });
    }

    return (
        <>
            <div
                className={cn(
                    "group flex h-10 items-center border-b border-gray-50 pr-3 transition-colors md:pr-10",
                    interactive && "cursor-pointer hover:bg-gray-100",
                    className,
                )}
                onContextMenu={handleContextMenu}
                {...props}
            >
                {children}
            </div>
            {menuCoords && rightClickDropdown && (
                <div
                    style={{
                        position: "fixed",
                        top: menuCoords.top,
                        left: menuCoords.left,
                    }}
                    className={`z-[120] w-48 overflow-hidden ${GLASS_DROPDOWN}`}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    {typeof rightClickDropdown === "function"
                        ? rightClickDropdown(closeRightClickDropdown)
                        : rightClickDropdown}
                </div>
            )}
        </>
    );
}

export function TableStickyCell({
    children,
    className,
    widthClassName = TABLE_PRIMARY_CELL_WIDTH_CLASS,
    bgClassName = TABLE_STICKY_CELL_BG,
    header = false,
    hover = true,
}: DivProps & {
    widthClassName?: string;
    bgClassName?: string;
    header?: boolean;
    hover?: boolean;
}) {
    return (
        <div
            className={cn(
                "sticky left-0 z-[60] flex gap-4 pl-4 pr-2 text-left",
                widthClassName,
                bgClassName,
                header
                    ? "z-[80] items-center self-stretch"
                    : "py-2 transition-colors",
                !header && hover && "group-hover:bg-gray-100",
                className,
            )}
        >
            {children}
        </div>
    );
}

export function TablePrimaryCell({
    children,
    className,
    widthClassName = TABLE_PRIMARY_CELL_WIDTH_CLASS,
    bgClassName,
    selected,
    onSelectionChange,
    checkboxTitle,
    label,
    editing = false,
    editValue,
    onEditValueChange,
    onEditCommit,
    onEditCancel,
}: DivProps & {
    widthClassName?: string;
    bgClassName?: string;
    selected: boolean;
    onSelectionChange: () => void;
    checkboxTitle?: string;
    label?: ReactNode;
    editing?: boolean;
    editValue?: string;
    onEditValueChange?: (value: string) => void;
    onEditCommit?: () => void;
    onEditCancel?: () => void;
}) {
    const content =
        label !== undefined ? (
            editing ? (
                <input
                    autoFocus
                    value={editValue ?? ""}
                    onChange={(e) => onEditValueChange?.(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") onEditCommit?.();
                        if (e.key === "Escape") onEditCancel?.();
                    }}
                    onBlur={onEditCommit}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 text-sm text-gray-800 bg-transparent outline-none"
                />
            ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                    {label}
                </span>
            )
        ) : (
            children
        );

    return (
        <TableStickyCell
            widthClassName={widthClassName}
            bgClassName={bgClassName}
            className={className}
        >
            <div className="flex min-w-0 items-center gap-4">
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onSelectionChange}
                    onClick={(e) => e.stopPropagation()}
                    className={TABLE_CHECKBOX_CLASS}
                    title={checkboxTitle}
                />
                {content}
            </div>
        </TableStickyCell>
    );
}

export function TableHeaderCell({ children, className, ...props }: DivProps) {
    return (
        <div className={cn("shrink-0 text-left", className)} {...props}>
            {children}
        </div>
    );
}

export function TableCell({ children, className, ...props }: DivProps) {
    return (
        <div
            className={cn("shrink-0 truncate text-sm text-gray-500", className)}
            {...props}
        >
            {children}
        </div>
    );
}

export function TableBody({ children, className, ...props }: DivProps) {
    return (
        <div className={cn("flex-1", className)} {...props}>
            {children}
        </div>
    );
}

export function TableEmptyState({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "mx-auto flex w-full max-w-xs flex-1 flex-col items-start justify-center py-24",
                className,
            )}
        >
            {children}
        </div>
    );
}
