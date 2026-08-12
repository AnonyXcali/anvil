import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';
import { AGENT_DIRECTORY } from 'src/agent.directory';

describe('AnvilAgentSupervisorService', () => {
  let service: AnvilAgentSupervisorService;

  beforeEach(() => {
    service = Object.create(
      AnvilAgentSupervisorService.prototype,
    ) as AnvilAgentSupervisorService;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('resumes the persisted supervisor run after validating its suspended tool', async () => {
    const resumeStream = jest.fn().mockResolvedValue({ fullStream: [] });
    const supervisorAgent = {
      listSuspendedRuns: jest.fn().mockResolvedValue({
        runs: [
          {
            runId: 'supervisor-run-1',
            status: 'suspended',
            toolCalls: [
              {
                toolCallId: 'tool-call-1',
                toolName: 'workflow-frontendEngineeringWorkflow',
                requiresApproval: false,
              },
            ],
          },
        ],
      }),
      resumeStream,
    };
    const mastraService = {
      getAgent: jest.fn().mockReturnValue(supervisorAgent),
    };
    Object.assign(service, { mastraService });

    await service.resumeSupervisorAgent({
      runId: 'supervisor-run-1',
      approved: true,
      toolCallId: 'tool-call-1',
    });

    expect(mastraService.getAgent).toHaveBeenCalledWith(
      AGENT_DIRECTORY.anvilSupervisorAgent,
    );
    expect(supervisorAgent.listSuspendedRuns).toHaveBeenCalledWith();
    expect(resumeStream).toHaveBeenCalledWith(
      { approved: true },
      expect.objectContaining({ runId: 'supervisor-run-1' }),
    );
    const calls = resumeStream.mock.calls as unknown as unknown[][];
    const resumeOptions = calls[0]?.[1] as {
      requestContext: { get(key: string): unknown };
    };
    expect(resumeOptions.requestContext.get('originatingRunId')).toBe(
      'supervisor-run-1',
    );
  });

  it('rejects a run that is not present in suspended-run storage', async () => {
    const supervisorAgent = {
      listSuspendedRuns: jest.fn().mockResolvedValue({ runs: [] }),
      resumeStream: jest.fn(),
    };
    Object.assign(service, {
      mastraService: { getAgent: jest.fn().mockReturnValue(supervisorAgent) },
    });

    await expect(
      service.resumeSupervisorAgent({
        runId: 'already-resumed',
        approved: false,
      }),
    ).rejects.toThrow('was not found or is no longer suspended');
    expect(supervisorAgent.resumeStream).not.toHaveBeenCalled();
  });

  it('rejects a suspended run when the approval tool call does not match', async () => {
    const supervisorAgent = {
      listSuspendedRuns: jest.fn().mockResolvedValue({
        runs: [
          {
            runId: 'supervisor-run-1',
            status: 'suspended',
            toolCalls: [
              {
                toolCallId: 'different-tool-call',
                toolName: 'workflow-frontendEngineeringWorkflow',
                requiresApproval: false,
              },
            ],
          },
        ],
      }),
      resumeStream: jest.fn(),
    };
    Object.assign(service, {
      mastraService: { getAgent: jest.fn().mockReturnValue(supervisorAgent) },
    });

    await expect(
      service.resumeSupervisorAgent({
        runId: 'supervisor-run-1',
        approved: true,
        toolCallId: 'expected-tool-call',
      }),
    ).rejects.toThrow('does not contain the expected tool call');
    expect(supervisorAgent.resumeStream).not.toHaveBeenCalled();
  });
});
