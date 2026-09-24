import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Design Sync documentation",
    template: "%s · Design Sync",
  },
  description:
    "Documentation for tracking explicit synchronization baselines between Figma designs and implementation files.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geist.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans`}
      >
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
