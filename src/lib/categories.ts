import type { IconName } from '@/components/Icon';
import type { Category } from '@/data/types';

export const CATEGORIES: { id: Category; label: string; icon: IconName }[] = [
  { id: 'fitness', label: 'Fitness', icon: 'Flame' },
  { id: 'health', label: 'Health', icon: 'Shield' },
  { id: 'education', label: 'Education', icon: 'Doc' },
  { id: 'productivity', label: 'Productivity', icon: 'Target' },
  { id: 'business', label: 'Business', icon: 'Bolt' },
  { id: 'personal', label: 'Personal', icon: 'Profile' },
  { id: 'lifestyle', label: 'Lifestyle', icon: 'Globe' },
  { id: 'custom', label: 'Custom', icon: 'Plus' },
];

export function categoryLabel(c: Category, custom?: string | null): string {
  if (c === 'custom') return custom?.trim() || 'Custom';
  return CATEGORIES.find((x) => x.id === c)?.label ?? 'Personal';
}

export function categoryIcon(c: Category): IconName {
  return CATEGORIES.find((x) => x.id === c)?.icon ?? 'Target';
}
