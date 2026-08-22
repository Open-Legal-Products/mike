export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", enabled);
    document.documentElement.style.colorScheme = enabled ? "dark" : "light";
}
