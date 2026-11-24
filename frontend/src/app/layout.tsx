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
  title: "EcoGuard | Bangladesh Forest & Deforestation Intelligence",
  description:
    "Satellite forest conservation, real-time deforestation detection, custom polygon remote sensing, and DeepSeek AI intelligence for Bangladesh forests.",
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
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-[100dvh] bg-[#f5faf6] text-[#0b2419] antialiased selection:bg-emerald-200/70 selection:text-emerald-950"
      >
        {children}
      </body>
    </html>
  );
}
