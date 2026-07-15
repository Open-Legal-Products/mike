export const PRACTICE_OPTIONS = [
    "一般交易",
    "公司业务",
    "金融",
    "诉讼",
    "房地产",
    "税务",
    "劳动雇佣",
    "知识产权",
    "竞争法",
    "科技交易",
    "项目融资",
    "股权/创投",
    "私募股权",
    "私募信贷",
    "股权资本市场",
    "债务资本市场",
    "杠杆融资",
    "仲裁",
    "其他",
] as const;

export type Practice = (typeof PRACTICE_OPTIONS)[number];
