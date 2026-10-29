import { config } from '@/lib/config';
import { demoApi } from './demo';
import { liveApi } from './live';
import type { Api } from './types';

export const api: Api = config.demo ? demoApi : liveApi;
export * from './types';
