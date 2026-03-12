import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    variable: "--font-mono",
    display: "swap",
});

export const metadata: Metadata = {
    title: "Junction Modeller Expanded",
    description: "Junction Modeller Expanded: A Web-Based 3D Traffic Simulation and Junction Analysis Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
}