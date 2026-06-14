// import { ColumnType, Insertable, Selectable, Updateable } from 'kysely';

// export interface Database {
//   user: UserTable;
// }

// export interface UserTable {
//   id: string;
//   name: string;
//   email: string;
//   emailVerified: boolean;
//   image?: string | null;
//   createdAt: ColumnType<Date, string | undefined, never>;
//   updatedAt: ColumnType<Date, string | undefined, never>;
// }

// export interface Session {
//   id: string;
//   userId: string;
//   token: string;
//   expiresAt: ColumnType<Date, string | undefined, never>;
//   ipAddress?: string | null;
//   userAgent: string | null;
//   createdAt: ColumnType<Date, string | undefined, never>;
//   updatedAt: ColumnType<Date, string | undefined, never>;
// }

// export interface Account {
//   id: string;
//   userId: string;
//   accountId: string;
//   providerId: string;
//   token: string;
//   accessToken?: string;
//   refreshToken?: string;
//   accessTokenExpiresAt?: ColumnType<Date, string | undefined, never>;
//   refreshTokenExpiresAt?: ColumnType<Date, string | undefined, never>;
//   scope?: string;
//   idToken?: string;
//   password?: string;
//   createdAt: ColumnType<Date, string | undefined, never>;
//   updatedAt: ColumnType<Date, string | undefined, never>;
// }

// export interface Verification {
//   id: string;
//   identified: string;
//   value: string;
//   expiresAt: ColumnType<Date, string | undefined, never>;
//   createdAt: ColumnType<Date, string | undefined, never>;
//   updatedAt: ColumnType<Date, string | undefined, never>;
// }

// export type User = Selectable<UserTable>;
// export type NewUser = Insertable<UserTable>;
// export type UserUpdate = Updateable<UserTable>;

import { Generated } from 'kysely';

export interface PlayerTable {
  id: Generated<string>;
  email: string;
  name: string | null;
  created_at: Date;
}

export interface DB {
  users: PlayerTable;
}
