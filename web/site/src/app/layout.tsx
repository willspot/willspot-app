import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import bundled from "../brand.json";
import { BrandProvider } from "@/lib/brand";
import { cssVarsFor } from "@/lib/css-vars";
import "./globals.css";

const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading", display: "swap" });

export const metadata: Metadata = {
  title: `${bundled.name} — ${bundled.tagline}`,
  description: `${bundled.name}: a Naira wallet to add money, withdraw to any Nigerian bank, and buy or sell crypto at clear rates.`,
  icons: { icon: "/brand/logo-mark.svg" },
};

export const viewport: Viewport = { themeColor: bundled.colors.primary, width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <head>
        <style>{cssVarsFor(bundled)}</style>
      </head>
      <body>
        <BrandProvider>{children}</BrandProvider>
      </body>
    </html>
  );
}
