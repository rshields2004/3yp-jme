/**
 * layout.tsx
 * Root layout - sets the HTML shell, loads the JetBrains Mono font,
 * applies the dark theme, and wraps children in a TooltipProvider.
 */
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * JetBrains Mono font instance used for the monospace CSS variable.
 */
const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});

/**
 * Next.js page metadata (title, description).
 */
export const metadata: Metadata = {
    title: "Junction Modeller Expanded",
    description: "Junction Modeller Expanded: A Web-Based 3D Traffic Simulation and Junction Analysis Platform",
};

/**
 * Root layout wrapping every page with global font and tooltip provider.
 *
 * @param children - child elements to render
 * @returns the rendered root HTML layout
 */
const RootLayout = ({ children }: { children: React.ReactNode }) => {
    return (
        <html lang="en" className="dark">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" sizes="any" />
            </head>
            <body className={jetbrainsMono.variable}>
                <TooltipProvider delayDuration={300}>
                    {children}
                </TooltipProvider>
            </body>
        </html>
    );
};

export default RootLayout;