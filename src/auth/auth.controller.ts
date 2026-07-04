import { Controller, Post, Body, Res } from '@nestjs/common';
import type { UserParams, SignInUserParams } from './auth.types';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AuthService } from './auth.service';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  //need to support users with ssh keys specifically for them.
  @Post('/sign-up')
  @AllowAnonymous() //TODO: need to admin flow only.
  async CreateUserFlow(
    @Body() body: UserParams,
    @Res({
      passthrough: true,
    })
    res: Response,
  ) {
    const { headers, response } = await this.authService.createUser(body);
    const cookies = headers.getSetCookie();

    if (cookies.length > 0) {
      res.setHeader('Set-Cookie', cookies);
    }
    return response;
  }

  @Post('/sign-in')
  @AllowAnonymous() //TODO: need to admin flow only.
  async SignIn(
    @Body() body: SignInUserParams,
    @Res({
      passthrough: true,
    })
    res: Response,
  ) {
    const { headers, response } = await this.authService.signInUser(body);

    const cookies = headers.getSetCookie();

    if (cookies.length > 0) {
      res.setHeader('Set-Cookie', cookies);
    }
    return response;
  }
}
