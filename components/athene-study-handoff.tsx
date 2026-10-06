import { imagingContext, imagingHandoff } from '@/lib/athene-context'

export default function AtheneStudyHandoff({ kind, reference }: { kind: 'atlas' | 'case'; reference: string }) {
  const record = imagingContext(kind, reference)
  const href = imagingHandoff(kind, reference)
  if (!record || !href) return null
  return (
    <details className="my-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-[var(--color-tool-cyan)]">ติวการอ่านภาพต่อกับ Athene</summary>
      <p className="mt-3 text-[var(--color-text-muted)]">ตรวจหัวข้อจากคลังสาธารณะนี้ก่อนเปิดห้องติว ช่วยฝึกอธิบายสิ่งที่เห็นและแยกสิ่งที่ยังยืนยันไม่ได้</p>
      <p className="mt-3 font-semibold text-[var(--color-text)]">{record.title}</p>
      <p className="mt-1 text-[var(--color-text-muted)]">{record.summary}</p>
      {record.points.length > 0 && <ul className="mt-2 list-inside list-disc text-[var(--color-text-muted)]">{record.points.map((point, index) => <li key={index}>{point}</li>)}</ul>}
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">ลิงก์ส่งเฉพาะรหัสภาพสาธารณะ ไม่ส่งไฟล์ DICOM หรือบันทึกส่วนตัว คุณเลือกแนบภาพและกดส่งคำถามใน Athene เอง</p>
      <a href={href} target="_blank" rel="noopener noreferrer" className="imaging-btn imaging-btn-primary mt-3 inline-flex">เปิดร่างห้องติวใน Athene ↗</a>
    </details>
  )
}
