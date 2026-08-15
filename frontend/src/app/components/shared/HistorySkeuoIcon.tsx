import Image, { type ImageProps } from "next/image";

type IconProps = Omit<ImageProps, "alt" | "src" | "width" | "height" | "unoptimized">;

/** History nav icon — same asset pattern as AppSidebarSkeuoIcons. */
export function HistorySkeuoIcon({ className, ...props }: IconProps) {
    return (
        <Image
            src="/icons/app-sidebar/history.svg?v=2"
            alt=""
            width={64}
            height={64}
            unoptimized
            aria-hidden="true"
            draggable={false}
            className={`${className ?? ""} object-contain`}
            {...props}
        />
    );
}
