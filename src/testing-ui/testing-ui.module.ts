import { Module } from '@nestjs/common';
import { CoreModule } from 'src/core/core.module';
import { ConversationModule } from 'src/conversation/conversation.module';
import { ProjectModule } from 'src/project/project.module';
import { TestingUiController } from './testing-ui.controller';
import { TestingUiService } from './testing-ui.service';

@Module({
  imports: [CoreModule, ConversationModule, ProjectModule],
  controllers: [TestingUiController],
  providers: [TestingUiService],
})
export class TestingUiModule {}
