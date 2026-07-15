import type { LucideIcon } from "lucide-react";
import { AlignLeft, List, Hash, DollarSign, ToggleLeft, Calendar, Tag, Percent, Banknote } from "lucide-react";
import type { ColumnFormat } from "../shared/types";

export const FORMAT_OPTIONS: Array<{ value: ColumnFormat; label: string; icon: LucideIcon; iconClassName: string }> = [
    { value: "text",            label: "自由文本",       icon: AlignLeft,  iconClassName: "text-sky-500"     },
    { value: "bulleted_list",   label: "项目列表",   icon: List,       iconClassName: "text-indigo-500"  },
    { value: "number",          label: "数字",          icon: Hash,       iconClassName: "text-violet-500"  },
    { value: "percentage",      label: "百分比",      icon: Percent,    iconClassName: "text-fuchsia-500" },
    { value: "monetary_amount", label: "金额", icon: Banknote,   iconClassName: "text-emerald-600" },
    { value: "currency",        label: "货币",        icon: DollarSign, iconClassName: "text-teal-600"    },
    { value: "yes_no",          label: "是 / 否",        icon: ToggleLeft, iconClassName: "text-amber-500"   },
    { value: "date",            label: "日期",            icon: Calendar,   iconClassName: "text-rose-500"    },
    { value: "tag",             label: "标签",            icon: Tag,        iconClassName: "text-orange-500"  },
];

export function formatLabel(format: ColumnFormat): string {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? "文本";
}

export function formatIcon(format: ColumnFormat): LucideIcon {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.icon ?? AlignLeft;
}

export function formatIconClassName(format: ColumnFormat): string {
    return FORMAT_OPTIONS.find((o) => o.value === format)?.iconClassName ?? "text-sky-500";
}
