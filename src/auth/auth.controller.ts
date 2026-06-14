import { Controller, Post, Body } from '@nestjs/common';
import type { UserParams } from './auth.types';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/sign-up')
  @AllowAnonymous() //TODO: need to admin flow only.
  async CreateUserFlow(@Body() body: UserParams) {
    return await this.authService.createUser(body);
  }
}
