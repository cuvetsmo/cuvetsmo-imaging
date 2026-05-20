import type { Metadata } from 'next';
import { ReviewView } from './ReviewView';

export const metadata: Metadata = {
  title: 'Review queue',
  description:
    'Spaced-repetition review queue — next cases to study based on your progress. By CUVETSMO Labs.',
};

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <ReviewView />
    </div>
  );
}
