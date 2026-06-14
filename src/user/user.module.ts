import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { DbModule } from 'src/db/db.module';
import { UserController } from './user.controller';

@Module({
  imports: [DbModule],
  providers: [UserService],
  controllers: [UserController],
})
export class UserModule {}
