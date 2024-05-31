// This file is the entry point for both the foreground pyright thread, and the
// background one. In the two cases, it does something completely different, but
// it makes sense to put the code in a single file because they share a lot of
// imported code, and keeping them in separate files would result in downloading
// two large files with slight differences, whereas putting them in a single
// file results in a single file which can be run in two different ways.

import { isMainThread, setIsMainThread } from 'pyright-internal/worker_threads_shim';
import { mainThreadStart } from './worker-foreground';
import { backgroundThreadStart } from './worker-background';

export const BACKGROUND_THREAD_NAME = 'pyright-background';

setIsMainThread(self.name !== BACKGROUND_THREAD_NAME);

if (isMainThread) {
    mainThreadStart();
} else {
    backgroundThreadStart();
}
