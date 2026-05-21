'use client';
import StudyCard from './StudyCard.jsx';

// StudyTree — vertical list of imported DICOM studies.
//
// Receives an already-organized `Study[]` (sorted by Agent C's
// `organizeIntoStudies` in study-organizer.ts). This component does no
// re-sorting and no grouping — pure render. Agent A's `LabHome` owns
// the empty-state copy ("no imports yet"), so we just render nothing
// when the array is empty.
//
// Mobile-first 375px: single column, full-width cards. On wider viewports
// (>=720px) the grid lets cards flex to 2 columns naturally via
// auto-fit / minmax. No media queries needed.

export default function StudyTree({
  studies,
  onOpenStudy,
  onOpenInstance,
  onDeleteStudy,
}) {
  if (!Array.isArray(studies) || studies.length === 0) return null;

  return (
    <div style={treeWrapStyle}>
      {studies.map((s) => (
        <StudyCard
          key={s.studyUid}
          study={s}
          onOpenStudy={onOpenStudy}
          onOpenInstance={onOpenInstance}
          onDeleteStudy={onDeleteStudy}
        />
      ))}
    </div>
  );
}

const treeWrapStyle = {
  display: 'grid',
  // Single column at 375px (one card stacks per row); on wider viewports
  // the auto-fit lets two cards sit side-by-side without breakpoint logic.
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
  width: '100%',
};
