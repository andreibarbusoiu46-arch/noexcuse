import * as s1 from './screens1';
import * as s2 from './screens2';
import * as s3 from './screens3';

export const en = { ...s1.en, ...s2.en, ...s3.en };
export const ro: typeof en = { ...s1.ro, ...s2.ro, ...s3.ro };
