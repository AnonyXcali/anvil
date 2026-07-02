import { Injectable } from '@nestjs/common';
import { auth } from 'src/lib/auth';
import { PreviewPlatformUser as User } from '../db/db.types';
import { ConfigService } from '@nestjs/config';
import { SignInUserParams } from './auth.types';

type UserParams = Pick<User, 'name' | 'email'> & { password: string };

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  async createUser(params: UserParams) {
    const { headers, response } = await auth.api.signUpEmail({
      returnHeaders: true,
      body: {
        email: params.email,
        password: params.password,
        name: params.name,
      },
      headers: new Headers({
        'content-type': 'application/json',
        origin: this.configService.getOrThrow('BETTER_AUTH_URL'),
      }),
    });

    return {
      headers,
      response,
    };
  }

  async signInUser(params: SignInUserParams) {
    const { headers, response } = await auth.api.signInEmail({
      returnHeaders: true,
      body: {
        email: params.email,
        password: params.password,
      },
      headers: new Headers({
        'content-type': 'application/json',
        origin: this.configService.getOrThrow('BETTER_AUTH_URL'),
      }),
    });

    return {
      headers,
      response,
    };
  }
}
