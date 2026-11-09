import { config } from '@/lib/config';

/** Public URL of a profile photo stored in the "avatars" bucket (paths come from the server). */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path || !config.supabaseUrl || !/^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$/.test(path)) return null;
  return `${config.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
}
