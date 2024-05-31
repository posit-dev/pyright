import { BackgroundAnalysisRunner } from 'pyright-internal/backgroundAnalysis';
import type { AnalysisRequest } from 'pyright-internal/backgroundAnalysisBase';
import { deserialize } from 'pyright-internal/backgroundThreadBase';
import { NoAccessHost, type Host } from 'pyright-internal/common/host';
import { ServiceProvider } from 'pyright-internal/common/serviceProvider';
import { setWorkerData } from 'pyright-internal/worker_threads_shim';
import * as FsUtils from './fs-utils';

export function backgroundThreadStart(): void {
    let serviceProvider: ServiceProvider;
    let runner: BrowserBackgroundAnalysisRunner;

    function initializeWorkerData(e: MessageEvent) {
        if (e.data.status === 'initialWorkerData') {
            const workerData = e.data.workerData;
            setWorkerData(workerData);

            // Now that we've set worker_threads.workerData for this thread, we
            // can launch the BrowserBackgroundAnalysisRunner, which will
            // consume it.
            serviceProvider = new ServiceProvider();
            runner = new BrowserBackgroundAnalysisRunner(serviceProvider);
            runner.start();

            self.postMessage({ status: 'backgroundWorkerInitialized' });

            // Once we're done with this step, remove the listener
            self.removeEventListener('message', initializeWorkerData);
        }
    }
    self.addEventListener('message', initializeWorkerData);

    self.postMessage({ status: 'backgroundWorkerStarted' });
}

class BrowserBackgroundAnalysisRunner extends BackgroundAnalysisRunner {
    // Is this necessary?
    protected override createHost(): Host {
        return new NoAccessHost();
    }

    protected override onMessage(msg: AnalysisRequestExtended | AnalysisRequest) {
        switch (msg.requestType) {
            case 'initialFiles': {
                const data = deserialize(msg.data);
                const initialFiles = data.initialFiles as Record<string, string>;
                FsUtils.writeFiles(this.fs, initialFiles);
                break;
            }

            case 'createFile': {
                const data = deserialize(msg.data);
                FsUtils.createFile(this.fs, data.fileUri);
                break;
            }

            case 'deleteFile': {
                const data = deserialize(msg.data);
                FsUtils.deleteFile(this.fs, data.fileUri);
                break;
            }

            default: {
                super.onMessage(msg);
            }
        }
    }
}

export type AnalysisRequestKindExtended = 'initialFiles' | 'createFile' | 'deleteFile';

export interface AnalysisRequestExtended {
    requestType: AnalysisRequestKindExtended;
    data: string | null;
    port?: MessagePort | undefined;
    sharedUsageBuffer?: SharedArrayBuffer;
}
