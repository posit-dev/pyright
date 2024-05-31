import { TestFileSystem } from '../tests/harness/vfs/filesystem';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import type { ConsoleInterface } from './console';
import type { FileSystem } from './fileSystem';
import type {
    FileWatcher,
    FileWatcherEventHandler,
    FileWatcherEventType,
    FileWatcherHandler,
    FileWatcherProvider,
} from './fileWatcher';
import type { Uri } from './uri/uri';

export { TestFileSystem as RealFileSystem };

// TODO: Should this use a fileWatcherProvider?
export function createFromRealFileSystem(
    caseSensitiveDetector: CaseSensitivityDetector,
    console?: ConsoleInterface,
    fileWatcherProvider?: FileWatcherProvider
): FileSystem {
    return new TestFileSystem(false, {
        cwd: '/',
    });
}

export class RealTempFile extends TestFileSystem {
    constructor() {
        super(false, { cwd: '/' });
    }
}

// =============================================================================
// The following WorkspaceFileWatcher and WorkspaceFileWatcherProvider are
// copied verbatim from realFileSystem.ts.
// =============================================================================

interface WorkspaceFileWatcher extends FileWatcher {
    // Paths that are being watched within the workspace
    workspacePaths: string[];

    // Event handler to call
    eventHandler: FileWatcherEventHandler;
}

export class WorkspaceFileWatcherProvider implements FileWatcherProvider, FileWatcherHandler {
    private _fileWatchers: WorkspaceFileWatcher[] = [];

    createFileWatcher(workspacePaths: string[], listener: FileWatcherEventHandler): FileWatcher {
        const self = this;
        const fileWatcher: WorkspaceFileWatcher = {
            close() {
                // Stop listening for workspace paths.
                self._fileWatchers = self._fileWatchers.filter((watcher) => watcher !== fileWatcher);
            },
            workspacePaths,
            eventHandler: listener,
        };

        // Record the file watcher.
        self._fileWatchers.push(fileWatcher);

        return fileWatcher;
    }

    onFileChange(eventType: FileWatcherEventType, fileUri: Uri): void {
        // Since file watcher is a server wide service, we don't know which watcher is
        // for which workspace (for multi workspace case), also, we don't know which watcher
        // is for source or library. so we need to solely rely on paths that can cause us
        // to raise events both for source and library if .venv is inside of workspace root
        // for a file change. It is event handler's job to filter those out.
        this._fileWatchers.forEach((watcher) => {
            if (watcher.workspacePaths.some((dirPath) => fileUri.getFilePath().startsWith(dirPath))) {
                watcher.eventHandler(eventType, fileUri.getFilePath());
            }
        });
    }
}
