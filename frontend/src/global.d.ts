declare module "*.css";

declare global {
    interface Window {
        Clerk?: {
            session?: {
                getToken: (options?: {
                    template?: string;
                }) => Promise<string | null>;
            } | null;
        };
    }
}

export {};
