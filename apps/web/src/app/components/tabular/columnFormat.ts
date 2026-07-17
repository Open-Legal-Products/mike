import type { LucideIcon } from "lucide-react";
import { AlignLeft, List, Hash, DollarSign, ToggleLeft, Calendar, Tag, Percent, Banknote } from "lucide-react";
import type { ColumnFormat } from "../shared/types";

export const FORMAT_OPTIONS: Array<{ value: ColumnFormat; label: string; icon: LucideIcon; iconClassName: string }> = [
    { value: "text",            label: "Free Text",       icon: AlignLeft,  iconClassName: "text-sky-500"     },
    { value: "bulleted_list",   label: "Bulleted list",   icon: List,       iconClassName: "text-indigo-500"  },
    { value: "number",          label: "Number",          icon: Hash,       iconClassName: "text-violet-500"  },
    { value: "percentage",      label: "Percentage",      icon: Percent,    iconClassName: "text-fuchsia-500" },
    { value: "monetary_amount", label: "Monetary Amount", icon: Banknote,   iconClassName: "text-emerald-600" },
    { value: "currency",        label: "Currency",        icon: DollarSign, iconClassName: "text-teal-600"    },
    { value: "yes_no",          label: "Yes / No",        icon: ToggleLeft, iconClassName: "text-amber-500"   },
    { value: "date",            label: "Date",            icon: Calendar,   iconClassName: "text-rose-500"    },
    { value: "tag",             label: "Tags",            icon: Tag,        iconClassName: "text-orange-500"  },
];

export function formatLabel(format: ColumnFormat): string {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? "Text";
}

export function formatIcon(format: ColumnFormat): LucideIcon {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.icon ?? AlignLeft;
}

export function formatIconClassName(format: ColumnFormat): string {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.iconClassName ?? "text-sky-500";
}
