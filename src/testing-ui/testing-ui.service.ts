import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from 'src/conversation/conversation.service';
import { CoreService } from 'src/core/core.service';
import { ProjectService } from 'src/project/project.service';

type ViewModel = Record<string, unknown>;
const TESTING_UI_LAYOUT = 'testing-ui/layout';

@Injectable()
export class TestingUiService {
  constructor(
    private readonly configService: ConfigService,
    private readonly projectService: ProjectService,
    private readonly conversationService: ConversationService,
    private readonly coreService: CoreService,
  ) {}

  isEnabled(): boolean {
    const enabled =
      this.configService.get<boolean>('ENABLE_TESTING_UI') === true;
    const environment = process.env.NODE_ENV ?? 'development';
    return enabled && ['development', 'local', 'test'].includes(environment);
  }

  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new NotFoundException();
    }
  }

  async dashboardModel(
    userId: string,
    selectedProjectId?: string,
  ): Promise<ViewModel> {
    const projects = await this.projectService.findAll(userId);
    const selectedProject = selectedProjectId
      ? projects.find((project) => project.id === selectedProjectId)
      : projects[0];

    return {
      layout: TESTING_UI_LAYOUT,
      title: 'Anvil testing console',
      shellVariant: 'app',
      activeNav: 'projects',
      projectContext: selectedProject,
      projects,
      selectedProject,
      selectedProjectId: selectedProject?.id ?? '',
    };
  }

  authModel(): ViewModel {
    return {
      layout: TESTING_UI_LAYOUT,
      title: 'Anvil testing console sign in',
      shellVariant: 'auth',
      activeNav: 'auth',
    };
  }

  async conversationModel(
    userId: string,
    projectId: string,
    conversationId: string,
  ): Promise<ViewModel> {
    const project = await this.projectService.findById(userId, projectId);
    const messages =
      await this.conversationService.retrieveMessages(conversationId);

    return {
      layout: TESTING_UI_LAYOUT,
      title: `${project.name} conversation`,
      shellVariant: 'app',
      activeNav: 'conversation',
      projectContext: project,
      project,
      conversationId,
      messages,
      streamUrl: `/core/${conversationId}`,
    };
  }

  async newConversationModel(
    userId: string,
    projectId: string,
  ): Promise<ViewModel> {
    const project = await this.projectService.findById(userId, projectId);
    return {
      layout: TESTING_UI_LAYOUT,
      title: `${project.name} new conversation`,
      shellVariant: 'app',
      activeNav: 'conversation',
      projectContext: project,
      project,
    };
  }

  async startConversation(query: string, userId: string, projectId: string) {
    return this.coreService.handleFlowInitiation(query, userId, projectId);
  }

  async sendMessage(
    query: string,
    userId: string,
    projectId: string,
    conversationId: string,
  ) {
    return this.coreService.talk(query, conversationId, projectId, userId);
  }

  async createProject(description: string, userId: string) {
    return this.projectService.insert(description, userId);
  }

  async startProject(projectId: string, userId: string) {
    return this.projectService.start(projectId, userId);
  }

  async stopProject(projectId: string, userId: string) {
    return this.projectService.stop(projectId, userId);
  }

  async deleteProject(projectId: string, userId: string) {
    return this.projectService.delete(projectId, userId);
  }

  async jobStatus(projectId: string, jobId: string, userId: string) {
    await this.projectService.findById(userId, projectId);
    return this.projectService.jobStatus(projectId, jobId);
  }

  async triggerSseTest(conversationId: string) {
    return this.coreService.test(conversationId);
  }
}
