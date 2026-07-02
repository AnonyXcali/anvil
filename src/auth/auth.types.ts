import { PreviewPlatformUser as User } from '../db/db.types';

export type UserParams = Pick<User, 'name' | 'email'> & { password: string };
export type SignInUserParams = Pick<User, 'email'> & { password: string };
