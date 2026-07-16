import Image, { type ImageProps } from "next/image";

type IconProps = Omit<
    ImageProps,
    "alt" | "src" | "width" | "height" | "unoptimized"
>;

const ICON_BASE_PATH = "/icons/app-sidebar";
const ICON_VERSION = "27";

function AppSidebarIcon({
    name,
    className,
    ...props
}: IconProps & { name: string }) {
    return (
        <Image
            src={`${ICON_BASE_PATH}/${name}.svg?v=${ICON_VERSION}`}
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

export function ChatSkeuoIcon(props: IconProps) {
    return <AppSidebarIcon name="chat" {...props} />;
}

export function FolderSkeuoIcon(props: IconProps) {
    return <AppSidebarIcon name="project-closed" {...props} />;
}

export function LibrarySkeuoIcon(props: IconProps) {
    return <AppSidebarIcon name="library" {...props} />;
}

export function TabularReviewSkeuoIcon(props: IconProps) {
    return <AppSidebarIcon name="tabular-review" {...props} />;
}

export function WorkflowSkeuoIcon(props: IconProps) {
    return <AppSidebarIcon name="workflow" {...props} />;
}
