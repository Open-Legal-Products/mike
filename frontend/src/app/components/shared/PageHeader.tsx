"use client";

import {
    useEffect,
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Loader2, Plus, Search } from "lucide-react";
import { usePageChrome } from "@/app/contexts/PageChromeContext";
import { cn } from "@/app/lib/utils";
import {
    APP_SURFACE_ACTIVE_CLASS,
    APP_SURFACE_HOVER_CLASS,
    APP_SURFACE_PRESSED_CLASS,
} from "@/app/components/ui/liquid-surface";

export interface PageHeaderBreadcrumb {
    label?: ReactNode;
    onClick?: () => void;
    cursor?: "text";
    loading?: boolean;
    skeletonClassName?: string;
    title?: string;
}

type PageHeaderButtonAction = {
    type?: never;
    icon?: ReactNode;
    label?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    iconOnly?: boolean;
    tooltip?: ReactNode;
};

type PageHeaderSearchAction = {
    type: "search";
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
};

type PageHeaderNewAction = {
    type: "new";
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    title?: string;
};

type PageHeaderCustomAction = {
    type: "custom";
    render: ReactNode;
};

export type PageHeaderAction =
    | PageHeaderButtonAction
    | PageHeaderSearchAction
    | PageHeaderNewAction
    | PageHeaderCustomAction;

type MaybePageHeaderAction = PageHeaderAction | null | false | undefined;

type PageHeaderActionGroup =
    | MaybePageHeaderAction[]
    | {
          actions: MaybePageHeaderAction[];
      };

interface PageHeaderProps {
    children?: ReactNode;
    actions?: MaybePageHeaderAction[];
    actionGroups?: PageHeaderActionGroup[];
    shrink?: boolean;
    breadcrumbs?: PageHeaderBreadcrumb[];
    loading?: boolean;
}

export function PageHeader({
    children,
    actions,
    actionGroups,
    shrink = false,
    breadcrumbs,
    loading = false,
}: PageHeaderProps) {
    const { mobileActionsContainer } = usePageChrome();
    const headerContent = breadcrumbs?.length ? (
        <PageHeaderBreadcrumbs items={breadcrumbs} />
    ) : (
        children
    );
    const actionsDisabled =
        loading || !!breadcrumbs?.some((item) => item.loading);
    const actionItems = actions?.filter(isPresentAction) ?? [];
    const groupedActionItems = (
        actionGroups
            ?.map(normalizeActionGroup)
            .filter((group) => group.actions.length > 0) ??
        (actionItems.length > 0 ? [{ actions: actionItems }] : [])
    );
    const hasActions = groupedActionItems.length > 0;

    return (
        <div
            className={cn(
                "flex items-center justify-between",
                "mx-4 md:mx-6",
                "min-h-[76px] pb-4 pt-5.5",
                shrink && "shrink-0",
            )}
        >
            {headerContent}
            {hasActions && (
                <div className="ml-4 hidden shrink-0 items-center gap-3 md:flex">
                    <PageHeaderActionGroups
                        groupedActionItems={groupedActionItems}
                        actionsDisabled={actionsDisabled}
                    />
                </div>
            )}
            {hasActions &&
                mobileActionsContainer &&
                createPortal(
                    <div className="flex min-w-0 items-center justify-end gap-3 overflow-visible py-2 -my-2">
                        <PageHeaderActionGroups
                            groupedActionItems={groupedActionItems}
                            actionsDisabled={actionsDisabled}
                        />
                    </div>,
                    mobileActionsContainer,
                )}
        </div>
    );
}

function PageHeaderActionGroups({
    groupedActionItems,
    actionsDisabled,
}: {
    groupedActionItems: {
        actions: PageHeaderAction[];
    }[];
    actionsDisabled: boolean;
}) {
    return (
        <>
            {groupedActionItems.map((group, groupIndex) => (
                <div
                    key={groupIndex}
                    className={cn(
                        "flex shrink-0 items-center gap-2",
                        "rounded-full border border-white/70 bg-app-surface px-1 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-2xl",
                    )}
                >
                    {group.actions.map((action, index) => (
                        <PageHeaderActionRenderer
                            key={index}
                            action={action}
                            disabled={actionsDisabled}
                        />
                    ))}
                </div>
            ))}
        </>
    );
}

function normalizeActionGroup(group: PageHeaderActionGroup) {
    if (Array.isArray(group)) {
        return {
            actions: group.filter(isPresentAction),
        };
    }
    return {
        actions: group.actions.filter(isPresentAction),
    };
}

function isPresentAction(action: MaybePageHeaderAction): action is PageHeaderAction {
    return Boolean(action);
}

function PageHeaderActionRenderer({
    action,
    disabled,
}: {
    action: PageHeaderAction;
    disabled: boolean;
}) {
    switch (action.type) {
        case "search":
            return (
                <PageHeaderSearchActionControl
                    action={action}
                    disabled={disabled}
                />
            );
        case "new":
            return (
                <PageHeaderNewActionControl
                    action={action}
                    disabled={disabled}
                />
            );
        case "custom":
            return (
                <span
                    className={cn(
                        "inline-flex h-7 items-center",
                        disabled && "pointer-events-none opacity-40",
                    )}
                >
                    {action.render}
                </span>
            );
        default:
            return (
                <PageHeaderButtonActionControl
                    action={action}
                    disabled={disabled}
                />
            );
    }
}

function PageHeaderButtonActionControl({
    action,
    disabled,
}: {
    action: PageHeaderButtonAction;
    disabled: boolean;
}) {
    const iconOnly = action.iconOnly ?? !action.label;
    return (
        <div className={action.tooltip ? "relative group" : undefined}>
            <PageHeaderActionButton
                onClick={action.onClick}
                disabled={disabled || action.disabled}
                title={action.title}
                aria-label={action.title}
                iconOnly={iconOnly}
            >
                {action.icon}
                {action.label}
            </PageHeaderActionButton>
            {action.tooltip && (
                <div className="pointer-events-none absolute right-0 top-full mt-1.5 z-10 hidden items-center whitespace-nowrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:flex">
                    {action.tooltip}
                </div>
            )}
        </div>
    );
}

function PageHeaderNewActionControl({
    action,
    disabled,
}: {
    action: PageHeaderNewAction;
    disabled: boolean;
}) {
    const title = action.title ?? "New";
    return (
        <PageHeaderActionButton
            onClick={action.onClick}
            disabled={disabled || action.disabled || action.loading}
            title={title}
            aria-label={title}
            iconOnly
        >
            {action.loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <Plus className="h-4 w-4" />
            )}
        </PageHeaderActionButton>
    );
}

function PageHeaderSearchActionControl({
    action,
    disabled,
}: {
    action: PageHeaderSearchAction;
    disabled: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const placeholder = action.placeholder ?? "Search…";

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
                action.onChange("");
            }
        }
        if (open) document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [open, action]);

    return (
        <div ref={ref} className="relative flex items-center">
            {open ? (
                <div
                    className={cn(
                        pageHeaderActionControlClassName({
                            className:
                                "cursor-text justify-start gap-2 px-3 text-gray-700 hover:text-gray-700",
                        }),
                        `w-56 sm:w-80 ${APP_SURFACE_ACTIVE_CLASS}`,
                    )}
                >
                    <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <input
                        autoFocus
                        disabled={disabled}
                        type="text"
                        placeholder={placeholder}
                        value={action.value}
                        onChange={(e) => action.onChange(e.target.value)}
                        className="flex-1 text-sm text-gray-700 placeholder:text-gray-400 outline-none bg-transparent"
                    />
                </div>
            ) : (
                <PageHeaderActionButton
                    onClick={() => setOpen(true)}
                    disabled={disabled}
                    iconOnly
                    title={placeholder}
                    aria-label={placeholder}
                >
                    <Search className="h-4 w-4" />
                </PageHeaderActionButton>
            )}
        </div>
    );
}

type PageHeaderActionButtonProps = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "className"
> & {
    iconOnly?: boolean;
};

type PageHeaderActionControlClassNameOptions = {
    iconOnly?: boolean;
    disabled?: boolean;
    className?: string;
};

function pageHeaderActionControlClassName({
    iconOnly = false,
    disabled = false,
    className,
}: PageHeaderActionControlClassNameOptions = {}) {
    return cn(
        "flex h-7 items-center justify-center rounded-full text-sm transition-colors disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent disabled:hover:text-gray-300",
        APP_SURFACE_HOVER_CLASS,
        APP_SURFACE_PRESSED_CLASS,
        iconOnly
            ? "w-7"
            : "w-7 gap-1.5 px-0 sm:w-auto sm:px-3",
        disabled ? "cursor-default" : "cursor-pointer",
        "text-gray-500 hover:text-gray-900",
        className,
    );
}

function PageHeaderActionButton({
    children,
    iconOnly = false,
    disabled,
    ...props
}: PageHeaderActionButtonProps) {
    return (
        <button
            disabled={disabled}
            className={pageHeaderActionControlClassName({
                iconOnly,
                disabled,
            })}
            {...props}
        >
            {children}
        </button>
    );
}

function PageHeaderBreadcrumbs({ items }: { items: PageHeaderBreadcrumb[] }) {
    const parent = [...items]
        .slice(0, -1)
        .reverse()
        .find((item) => item.onClick);

    return (
        <div className="flex min-w-0 items-center gap-1.5 text-2xl font-medium font-serif">
            {parent?.onClick && (
                <button
                    onClick={parent.onClick}
                    className="shrink-0 text-gray-400 transition-colors hover:text-gray-600 sm:hidden"
                    title={parent.title ?? "Back"}
                    aria-label={parent.title ?? "Back"}
                >
                    <ChevronLeft className="h-5 w-5" />
                </button>
            )}
            <div className="flex min-w-0 items-center gap-1.5">
                {items.map((item, index) => (
                    <BreadcrumbItem
                        key={index}
                        item={item}
                        current={index === items.length - 1}
                    />
                ))}
            </div>
        </div>
    );
}

function BreadcrumbItem({
    item,
    current,
}: {
    item: PageHeaderBreadcrumb;
    current: boolean;
}) {
    const content = item.loading ? (
        <div
            className={cn(
                "h-6 rounded bg-gray-100 animate-pulse",
                item.skeletonClassName ?? "w-32",
            )}
        />
    ) : (
        <>
            <span
                className={cn(
                    "truncate",
                    item.cursor === "text" && "cursor-text",
                )}
            >
                {item.label}
            </span>
        </>
    );

    const className = cn(
        "min-w-0 truncate transition-colors",
        item.cursor === "text" && "cursor-text",
        current
            ? "text-gray-900"
            : item.onClick
              ? "text-gray-500 hover:text-gray-700"
              : "text-gray-500",
    );
    const wrapperClassName = cn(
        "min-w-0 items-center gap-1.5",
        current ? "flex" : "hidden sm:flex",
    );

    return (
        <span className={wrapperClassName}>
            {current ? (
                <span className={className}>{content}</span>
            ) : item.onClick ? (
                <button onClick={item.onClick} className={className}>
                    {content}
                </button>
            ) : (
                <span className={className}>{content}</span>
            )}
            {!current && <span className="shrink-0 text-gray-300">›</span>}
        </span>
    );
}
