import { SignUp } from "@clerk/nextjs";

export default function SignupPage() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-white p-4">
            <SignUp />
        </div>
    );
}
