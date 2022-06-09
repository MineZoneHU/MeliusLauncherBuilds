import { GameFilesIndex } from './GameFilesIndex';

export interface ComparedGameFilesIndexes {
    extra : GameFilesIndex,
    mismatching : GameFilesIndex,
    missing : GameFilesIndex,
    matching : GameFilesIndex
}