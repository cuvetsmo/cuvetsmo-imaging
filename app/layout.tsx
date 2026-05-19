import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import { SiteHeader, SiteFooter } from "@/components/Brand";

const ibmPlexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-ibm-plex-sans-thai",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
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
      { url: "/smo-logo.png", type: "image/png" },
    ],
    apple: "/smo-logo.png",
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
  },
  twitter: {
    card: "summary_large_image",
    title: "Imaging Lab — DICOM viewer + AI overlays for vet students",
    description: "DICOM viewer, Norberg angle, VHS, image occlusion — all in browser.",
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
    <html lang="th" className={`${ibmPlexSansThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <SiteHeader />
        <main className="flex-1 w-full">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
