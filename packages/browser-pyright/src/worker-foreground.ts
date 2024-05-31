// TODO: Handle case where user starts typing before loaded. I think the problem
// is that we send the file, then the change event, but then it sends the file
// again? So the key is to not send the file again.

import {
    BrowserMessageReader,
    BrowserMessageWriter,
    createConnection,
    type InitializeParams,
    type InitializeResult,
    type CreateFile,
    type DeleteFile,
} from 'vscode-languageserver/browser';

import { InvalidatedReason } from 'pyright-internal/analyzer/backgroundAnalysisProgram';
import { AnalysisRequest, BackgroundAnalysisBase } from 'pyright-internal/backgroundAnalysisBase';
import { serialize, type InitializationData } from 'pyright-internal/backgroundThreadBase';
import type { FileSystem } from 'pyright-internal/common/fileSystem';
import type { FullAccessHost } from 'pyright-internal/common/fullAccessHost';
import { NoAccessHost } from 'pyright-internal/common/host';
import type { ServiceProvider } from 'pyright-internal/common/serviceProvider';
import { PyrightServer } from 'pyright-internal/server';
import { Worker } from 'pyright-internal/worker_threads_shim';
import type { Connection } from 'vscode-languageserver/browser';
import { AnalysisRequestExtended } from './worker-background';
import { BACKGROUND_THREAD_NAME } from './worker';
import * as FsUtils from './fs-utils';

export function mainThreadStart(): void {
    // TODO: Will we want to allow more threads?
    const MAX_BACKGROUND_THREADS = 1;

    // This will launch the background thread.
    new BrowserPyrightServer(
        createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)),
        MAX_BACKGROUND_THREADS
    );
}

/**
 * The startup sequence is a bit complicated. There are two main parts: the
 * thread startup, and then the LSP server initialization.
 *
 * This is the foreground thread, which runs in a Web Worker started by the
 * parent JS context (typically, the main JS thread for the page). This
 * foreground thread also starts a background thread to help with analyzing
 * code.
 *
 * In the normal Pyright code, when the BackgroundAnalysis class is
 * instantiated, it launches a node:worker_threads.Worker thread. In our browser
 * case, we instead instantiate the BrowserBackgroundAnalysis class (defined in
 * this file), which uses our worker_threads_shim.Worker, which in turn wraps a
 * Web Worker.
 *
 * A node:worker_threads.Worker and a Web Worker differ in one important way:
 * the node Worker can pass workerData to the `new Worker()`, and that data is
 * immediately available in the new worker as `worker_threads.workerData`.
 * However, for Web Workers, the only information that can be passed to it that
 * is readable inside the Web Worker is its name. So after we instantiate the
 * Web Worker, we need to pass it the workerData by sending a message to it.
 * This is an extra step in the initialization process.
 *
 * The thread startup sequence is as follows:
 *
 * - Foreground thread: in the BrowserBackgroundAnalysis constructor, we create
 *   a new Worker, which we'll also call the background thread.
 * - Background thread starts, and sends `{ status: 'backgroundWorkerStarted' }`
 *   to the foreground thread.
 * - Foreground receives it, sends `{ status: 'initialWorkerData', workerData:
 *   initialData }` to the background thread.
 * - Background receives it, then saves the `workerData` in
 *   `worker_threads.workerData`. (This is where the workerData would have been
 *   automatically available in a node Worker.)
 * - Background sends `{ status: 'backgroundWorkerInitialized'}` to foreground.
 * - Foreground receives it.
 *
 * At this point, we are where we would be if we had used a node worker and
 * instantiated it with `new Worker(x, { workerData: initialData })`.
 *
 * That is the thread startup sequence. The next part is the LSP initialization
 * sequence.
 *
 * In the LSP protocol, the first message sent from the client (the parent JS
 * thread) to the server (the pyright foreground thread here) is an 'initialize'
 * request. This request includes an `InitializeParams` object, which has an
 * `initializationOptions` property, which can contain anything.
 *
 * In our case, the `initializationOptions` includes a property named `files`,
 * which is a JS object where the key is the full path to a file, and the value
 * is the contents of the file. This object should contain all the type stubs
 * for various packages. For example, stdlib packages would go in
 * `/typeshed/stdlib/sys.pyi` and `/typeshed/stdlib/os.pyi`, and third-party
 * packages might be in `/src/typings/otherpkg/`. There should also be a
 * `/src/pyrightconfig.json` file.
 *
 * In the initialization, the foreground thread will load these files into its
 * virtual filesystem (which was provided by testFileSystemShim.ts), and it will
 * also send the file data to the background thread so it can do the same in its
 * virtual filesystem. (The two threads do not share memory so they must each
 * have their own vfs with the same contents.)
 *
 * The background thread initialization takes a bit of time and is not
 * automatically synchronized to the foreground thread, so there's a little bit
 * of Promise/async machinery to help make sure these things happen in the
 * correct order.
 *
 * After the LSP initialization step is completed, this thread will be ready to
 * receive requests and notifications from the client (AKA the parent JS
 * thread). It will accept normal LSP requests and notifications, and it also
 * supports two special kinds of notifications:
 *
 * - `$/createFile`: this will create a new file in the virtual filesystem, on
 *   both the foreground and background threads.
 * - `$/deleteFile`: this will delete a file in the virtual filesystem, on both
 *   threads.
 *
 * In a typical use case, the parent JS thread will send the `$/createFile` to
 * the foreground thread to create a file (which will start empty), and then as
 * the user edits the file, it will send a `textDocument/didChange`
 * notifications to the foreground thread with each change. Note that these
 * notifications will not cause the file to be changed on the vfs -- the file on
 * the vfs will remain empty, but all the changes will be applied to the "open"
 * copy in memory. This is just like when you edit a file in VS Code and get
 * diagnostics on the file without saving it to disk.
 */

class BrowserPyrightServer extends PyrightServer {
    initialFiles: Record<string, string> | undefined;

    constructor(connection: Connection, maxWorkers: number, realFileSystem?: FileSystem) {
        super(connection, maxWorkers, realFileSystem);

        // Set up listeners for messages from the host.
        this.connection.onNotification('$/createFile', (params: CreateFile) => {
            this.createFile(params.uri);
        });
        this.connection.onNotification('$/deleteFile', (params: DeleteFile) => {
            this.deleteFile(params.uri);
        });
    }

    // This will be invoked by super.initialize(). It creates the background
    // thread.
    override createBackgroundAnalysis(): BrowserBackgroundAnalysis {
        // TODO:
        // Ignore cancellation restriction for now. Needs investigation for browser support.
        const backgroundAnalysis = new BrowserBackgroundAnalysis(this.serverOptions.serviceProvider);

        (async () => {
            await backgroundAnalysis.initPromise;
            // Tell the background thread to populate the vfs there.
            // this.initialFiles will already be set, from the initialize()
            // method.
            await backgroundAnalysis.initalFiles(this.initialFiles!);
            // This will cause it to load the newly-created pyrightconfig.json
            // file.
            this.onDidChangeConfiguration({ settings: null });
        })();

        return backgroundAnalysis;
    }

    // This is invoked after the constructor, when the 'initialize' message is
    // received from the host.
    protected override initialize(
        params: InitializeParams,
        supportedCommands: string[],
        supportedCodeActions: string[]
    ): InitializeResult {
        // Initialize files in the foreground thread.
        this.initFiles(params.initializationOptions.files);
        // Store this.initialFiles so that the files can be used by
        // createBackgroundAnalysis() to populate the vfs in the background
        // thread.
        this.initialFiles = params.initializationOptions.files;

        const result = super.initialize(params, supportedCommands, supportedCodeActions);

        return result;
    }

    // Store the initial set of files in the virtual filesystem in the
    // foreground thread.
    protected initFiles(initialFiles: Record<string, string>) {
        FsUtils.writeFiles(this.fs, initialFiles);
    }

    protected createFile(uri: string) {
        FsUtils.createFile(this.fs, uri);

        this.workspaceFactory.items().forEach((workspace) => {
            const backgroundAnalysis = workspace.service.backgroundAnalysisProgram
                .backgroundAnalysis as BrowserBackgroundAnalysis;
            backgroundAnalysis.createFile(uri);
            workspace.service.invalidateAndForceReanalysis(InvalidatedReason.Reanalyzed);
        });
    }

    protected deleteFile(uri: string) {
        FsUtils.createFile(this.fs, uri);

        this.workspaceFactory.items().forEach((workspace) => {
            const backgroundAnalysis = workspace.service.backgroundAnalysisProgram
                .backgroundAnalysis as BrowserBackgroundAnalysis;
            backgroundAnalysis.deleteFile(uri);
            workspace.service.invalidateAndForceReanalysis(InvalidatedReason.Reanalyzed);
        });
    }

    // Is this necessary?
    protected override createHost() {
        return new NoAccessHost() as FullAccessHost;
    }
}

class BrowserBackgroundAnalysis extends BackgroundAnalysisBase {
    private static _workerIndex = 0;

    initPromise: Promise<void>;

    constructor(serviceProvider: ServiceProvider) {
        super(serviceProvider.console());

        const initialData: InitializationData = {
            rootUri: '/',
            cancellationFolderName: undefined,
            runner: undefined,
            workerIndex: ++BrowserBackgroundAnalysis._workerIndex,
        };

        // This will load this same .js file in a background thread.
        const worker = new Worker(__filename, undefined, { name: BACKGROUND_THREAD_NAME });

        this.initPromise = new Promise(function (resolve, reject) {
            function backgroundWorkerInitHandler(e: MessageEvent) {
                if (e.data.status === 'backgroundWorkerStarted') {
                    // Prevent this event from propagating to the
                    // BackgroundAnalaysisBase handlers, which won't recognize
                    // what to do with this kind of message and will error.
                    e.stopImmediatePropagation();

                    // This is how we pass the workerData to the background thread. This
                    // differs from the usual node:worker_threads API because Web Workers
                    // don't support passing workerData to `new Worker()`.
                    worker.postMessage({ status: 'initialWorkerData', workerData: initialData });
                } else if (e.data.status === 'backgroundWorkerInitialized') {
                    e.stopImmediatePropagation();

                    // At this point we've initialized equivalent to
                    // node:worker_threads.Worker(__filename, initialData)
                    resolve();

                    // Once we've used this listener, we can remove it.
                    worker.webWorker.removeEventListener('message', backgroundWorkerInitHandler);
                }
            }
            worker.webWorker.addEventListener('message', backgroundWorkerInitHandler);
        });

        this.setup(worker);

        // Tell the cacheManager we have a worker that needs to share data.
        serviceProvider.cacheManager()?.addWorker(initialData.workerIndex, worker);
    }

    async initalFiles(initialFiles: Record<string, string>): Promise<void> {
        await this.initPromise;
        // In the startup sequence, this function will be called before the
        // initialization messages for this object have completed. We need to
        // wait for them to finish before we send the initalFiles message to the
        // background thread.
        this.enqueueRequest({ requestType: 'initialFiles', data: serialize({ initialFiles }) });
    }

    createFile(fileUri: string) {
        this.initPromise.then(() => {
            this.enqueueRequest({ requestType: 'createFile', data: serialize({ fileUri }) });
        });
    }

    deleteFile(fileUri: string) {
        this.initPromise.then(() => {
            this.enqueueRequest({ requestType: 'deleteFile', data: serialize({ fileUri }) });
        });
    }

    // Send a message to the background thread. This override function simply
    // wraps the superclass's method but makes TypeScript happy by allowing
    // AnalysisRequestExtended.
    protected override enqueueRequest(request: AnalysisRequestExtended | AnalysisRequest) {
        super.enqueueRequest(request as AnalysisRequest);
    }
}
