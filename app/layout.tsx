import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Inter } from "next/font/google";
import "./globals.css";
import { SiteHeader, SiteFooter } from "@/components/Brand";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-ibm-plex-sans-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Inter — clinical UI workhorse. Industry default for medical software,
// broad numeric weights for DICOM metadata. No display font swap; the page
// IS the tool (see projects/cuvetsmo-labs/01-visual-theme-directions.md).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://imaging.cuvetsmo.com"),
  title: {
    default: "Imaging Lab — DICOM viewer + AI overlays for vet students",
    template: "%s — Imaging Lab",
  },
  description:
    "DICOM viewer + AI overlays for vet students. Norberg angle, VHS, image occlusion, runs entirely in browser. By CUVETSMO Labs.",
  applicationName: "Imaging Lab",
  keywords: [
    "imaging lab",
    "dicom viewer",
    "norberg angle",
    "vhs",
    "vertebral heart score",
    "vet imaging",
    "veterinary radiology",
    "image occlusion",
    "cuvetsmo",
    "chulalongkorn vet",
  ],
  authors: [{ name: "CUVETSMO Labs" }],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Imaging Lab — DICOM viewer + AI overlays for vet students",
    description:
      "DICOM viewer, Norberg angle, VHS, image occlusion — all in browser. By Chula Vet students.",
    type: "website",
    locale: "th_TH",
    alternateLocale: ["en_US"],
    siteName: "Imaging Lab",
    url: "https://imaging.cuvetsmo.com",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Imaging Lab — DICOM + AI overlays for vet students",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Imaging Lab — DICOM viewer + AI overlays for vet students",
    description: "DICOM viewer, Norberg angle, VHS, image occlusion — all in browser.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: "https://imaging.cuvetsmo.com" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${ibmPlexSansThai.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <SiteHeader />
        <main className="flex-1 w-full">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
