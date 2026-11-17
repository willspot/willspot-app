import type { Metadata } from "next";
import type { ReactNode } from "react";
import brand from "../brand.json";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} Admin`,
  robots: { index: false, follow: false },
  icons: { icon: "/brand/logo-mark.svg" },
};

const vars = `:root{${Object.entries(brand.colors)
  .map(([k, v]) => `--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
  .join(";")};--radius:${brand.radius}px}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{vars}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
