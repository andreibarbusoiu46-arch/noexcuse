import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { config } from './config';

export const supabase = createClient(config.supabaseUrl || 'http://localhost:54321', config.supabaseAnonKey || 'public-anon-key', {
  auth: {
    storage: Platform.OS === 'web' && typeof window === 'undefined' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Web: the magic link from the sign-in email lands back on the site with the session in the URL.
    detectSessionInUrl: Platform.OS === 'web' && typeof window !== 'undefined',
  },
});

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

/** Calls an Edge Function with the user's JWT and returns parsed JSON, or throws ApiError with the server's code. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new ApiError('unauthorized', 'Sign in required.', 401);
  let res: Response;
  try {
    res = await fetch(`${config.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: config.supabaseAnonKey },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('network', 'No connection. Check your internet and try again.', 0);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 202) {
    throw new ApiError(String(json.error ?? 'server_error'), String(json.message ?? 'Something went wrong.'), res.status);
  }
  return json as T;
}
