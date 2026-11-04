import type { IconName } from '@/components/Icon';
import type { Category } from '@/data/types';
import { t } from '@/i18n';

export const CATEGORIES: { id: Category; icon: IconName }[] = [
  { id: 'fitness', icon: 'Flame' },
  { id: 'health', icon: 'Shield' },
  { id: 'education', icon: 'Doc' },
  { id: 'productivity', icon: 'Target' },
  { id: 'business', icon: 'Bolt' },
  { id: 'personal', icon: 'Profile' },
  { id: 'lifestyle', icon: 'Globe' },
  { id: 'custom', icon: 'Plus' },
];

export function categoryLabel(c: Category, custom?: string | null): string {
  if (c === 'custom') return custom?.trim() || t.domain.category.custom;
  return t.domain.category[c] ?? t.domain.category.personal;
}

export function categoryIcon(c: Category): IconName {
  return CATEGORIES.find((x) => x.id === c)?.icon ?? 'Target';
}
