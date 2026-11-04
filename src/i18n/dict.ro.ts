import type { Dict } from './dict.en';
import * as common from './ns/common';
import * as domain from './ns/domain';
import * as ui from './ns/ui';

export const dictRo: Dict = { common: common.ro, domain: domain.ro, ...ui.ro };
