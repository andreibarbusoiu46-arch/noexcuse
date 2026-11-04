import * as common from './ns/common';
import * as domain from './ns/domain';
import * as ui from './ns/ui';

export const dict = { common: common.en, domain: domain.en, ...ui.en };
export type Dict = typeof dict;
