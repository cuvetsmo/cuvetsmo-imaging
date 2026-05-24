import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Imaging Lab — a standalone DICOM viewer + AI overlay tool lifted from VetMock. Part of CUVETSMO Labs.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-10 text-[var(--color-text)]">
      <h1 className="text-3xl font-semibold mb-3">About Imaging Lab</h1>
      <p className="text-[var(--color-text-muted)] leading-relaxed mb-6">
        Imaging Lab เป็นเครื่องมือฝึกอ่านภาพทางสัตวแพทย์ — DICOM viewer
        ในเบราว์เซอร์ พร้อม overlay สำหรับวัด <strong className="text-[var(--color-text)]">Norberg angle</strong>{" "}
        (hip dysplasia) และ <strong className="text-[var(--color-text)]">Vertebral Heart Score (VHS)</strong>{" "}
        บวก <strong className="text-[var(--color-text)]">Image Occlusion</strong> สไตล์ Anki สำหรับท่อง anatomy.
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">เหมาะกับใคร</h2>
      <ul className="list-disc pl-6 text-[var(--color-text-muted)] space-y-1 leading-relaxed">
        <li>นิสิตสัตวแพทย์ปี 4–6 ที่กำลังขึ้น clinic / rotation</li>
        <li>คนที่อยากซ้อมวัด Norberg / VHS โดยไม่ต้องลง PACS</li>
        <li>กลุ่มวิจัย senior project ที่ทำ AI สำหรับ vet imaging</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-2">ทำอะไรได้บ้าง</h2>
      <ul className="list-disc pl-6 text-[var(--color-text-muted)] space-y-1 leading-relaxed">
        <li>ลาก DICOM (<code className="text-[var(--color-tool-cyan)]">.dcm</code>) ขึ้น viewer, render ในเบราว์เซอร์ล้วน</li>
        <li>Norberg angle 4-click + classification (Normal / Borderline / Dysplastic)</li>
        <li>VHS 6-click + species-adapted reference range (canine vs feline)</li>
        <li>Length / Angle measurement (mm จาก PixelSpacing tag)</li>
        <li>Drop AI prediction JSON (overlay schema ตามเอกสาร)</li>
        <li>Image Occlusion editor — วาดกล่องทับ label แล้วท่องเป็น flashcard</li>
        <li>DICOM Tag Inspector + PII anonymizer ก่อน share ภาพ</li>
        <li>2-up compare mode (Sync zoom + W/L ระหว่าง view)</li>
        <li>Keyboard shortcuts ครบ 16 keys (กด <kbd className="px-1.5 py-0.5 border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface-2)]">?</kbd> ใน viewer)</li>
      </ul>

      <h2 className="text-xl font-semibold mt-8 mb-2">Credits</h2>
      <p className="text-[var(--color-text-muted)] leading-relaxed">
        Imaging Lab lifted จาก{" "}
        <a href="https://vetmock.vercel.app" className="text-[var(--color-tool-cyan)] hover:underline" rel="noreferrer">
          VetMock
        </a>{" "}
        — แอป exam practice ของนิสิต Vet 86 จุฬาฯ. DICOM stack ใช้{" "}
        <a href="https://github.com/cornerstonejs/cornerstone3D" className="text-[var(--color-tool-cyan)] hover:underline" rel="noreferrer">
          Cornerstone3D
        </a>{" "}
        + <code className="text-[var(--color-tool-cyan)]">dicom-parser</code>.
      </p>
      <p className="text-[var(--color-text-muted)] leading-relaxed mt-3">
        Part of{" "}
        <a href="https://labs.cuvetsmo.com" className="text-[var(--color-tool-cyan)] hover:underline" rel="noreferrer">
          CUVETSMO Labs
        </a>{" "}
        — เครื่องมือทดลองโดยนิสิตสัตวแพทย์ จุฬาฯ.
      </p>
      <p className="text-[var(--color-text-muted)] leading-relaxed mt-3">
        เคสและภาพในเว็บมาจาก dataset เปิด CC BY 4.0 (VetXRay บน Zenodo, Mendeley VHS).
        แหล่งเรียนรู้เพิ่มเติม (VET DICOM Library, IVRA OER, CEG VHS/VLAS viewer)
        ลิงก์ออกครบที่หน้า{" "}
        <Link href="/sources" className="text-[var(--color-tool-cyan)] hover:underline">
          Data + learning sources
        </Link>
        .
      </p>

      <h2 className="text-xl font-semibold mt-8 mb-2">Disclaimer</h2>
      <div className="rounded-md border border-[var(--color-active-red)]/40 bg-[rgba(186,31,64,0.08)] px-4 py-3 text-sm text-[var(--color-text)]">
        Educational tool. <strong>Not for clinical decisions.</strong> ผลการวัดที่ได้
        เป็นการประมาณการณ์เพื่อฝึก ไม่ใช่ workup ผู้ป่วยจริง.
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/" className="vmx-btn vmx-btn-primary vmx-btn-sm">
          ลองใช้งาน
        </Link>
        <Link href="/cases" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          ดู case library
        </Link>
      </div>
    </div>
  );
}
