import type { FileSystem } from 'pyright-internal/common/fileSystem';
import { Uri } from 'pyright-internal/common/uri/uri';
import type { TestFileSystem } from 'pyright-internal/tests/harness/vfs/filesystem';

export function writeFiles(fs: FileSystem, files: Record<string, string>) {
    for (const [file, content] of Object.entries(files)) {
        // We treat `fs` as a TestFileSystem because we know it will be one, and
        // because that class counts as a CaseSensitivityDetector, which is
        // what Uri.file() needs.
        const file_uri = Uri.file(file, fs as TestFileSystem);

        const dir_uri = file_uri.getDirectory();
        if (!fs.existsSync(dir_uri)) {
            fs.mkdirSync(dir_uri, { recursive: true });
        }

        fs.writeFileSync(file_uri, content, null);
    }
}

export function createFile(fs: FileSystem, uri: string) {
    const file_uri = Uri.parse(uri, fs as TestFileSystem);
    const dir_uri = file_uri.getDirectory();
    if (!fs.existsSync(dir_uri)) {
        fs.mkdirSync(dir_uri, { recursive: true });
    }
    if (!fs.existsSync(file_uri)) {
        fs.writeFileSync(file_uri, '', null);
    }
}

export function deleteFile(fs: FileSystem, uri: string) {
    const file_uri = Uri.parse(uri, fs as TestFileSystem);
    if (fs.existsSync(file_uri)) {
        fs.unlinkSync(file_uri);
    }
}
