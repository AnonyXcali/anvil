import { User } from '../db/db.types';

export type UserParams = Pick<User, 'name' | 'email'> & { password: string };
