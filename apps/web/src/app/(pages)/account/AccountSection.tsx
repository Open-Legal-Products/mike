import { cn } from "@/app/lib/utils";
import { accountGlassSectionClassName } from "./accountStyles";

export function AccountSection({
    children,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode;
}) {
    return (
        <div className={cn(accountGlassSectionClassName, className)} {...props}>
            {children}
        </div>
    );
}
