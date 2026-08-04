import { AnvilHistoryService } from './anvil-history.service';
import { HISTORY_FILE_PATH } from './anvil-history.types';

describe('AnvilHistoryService', () => {
  it('reads the fixed architecture history path', async () => {
    const sshService = {
      readProjectFile: jest.fn().mockResolvedValue('history content'),
    };
    const service = new AnvilHistoryService(sshService as never);

    await expect(service.readHistory('project-1')).resolves.toBe(
      'history content',
    );
    expect(sshService.readProjectFile).toHaveBeenCalledWith(
      'project-1',
      HISTORY_FILE_PATH,
    );
  });

  it('appends the next structured entry without replacing history', async () => {
    const sshService = {
      readProjectFile: jest
        .fn()
        .mockResolvedValue('template\n\n## Entry 4\n[subject] - Previous\n'),
      appendProjectFile: jest.fn().mockResolvedValue('updated history'),
    };
    const service = new AnvilHistoryService(sshService as never);
    jest.useFakeTimers().setSystemTime(new Date('2026-08-06T12:00:00.000Z'));

    await expect(
      service.appendHistoryEntry('project-1', {
        subject: 'Apply edit',
        status: 'success',
        changesMade: 'Updated the requested file.',
        files: ['src/App.tsx'],
        actor: 'anvil-edit-workflow.apply-edit',
      }),
    ).resolves.toBe('updated history');

    expect(sshService.appendProjectFile).toHaveBeenCalledWith(
      'project-1',
      HISTORY_FILE_PATH,
      expect.stringContaining('## Entry 5'),
    );
    expect(sshService.appendProjectFile).toHaveBeenCalledWith(
      'project-1',
      HISTORY_FILE_PATH,
      expect.stringContaining('[date] - 2026-08-06T12:00:00.000Z'),
    );
    jest.useRealTimers();
  });
});
