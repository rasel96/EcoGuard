import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EcoGuard | Geospatial Forest Intelligence",
  description:
    "Satellite forest monitoring, custom polygon remote sensing, and DeepSeek AI environmental intelligence for Bangladesh.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="min-h-[100dvh] bg-[#0a0e0c] text-[#f4f7f5] antialiased selection:bg-emerald-500/30 selection:text-emerald-200"
      >
        {children}
      </body>
    </html>
  );
}
