import { z } from 'zod';

export type UUID = string & { readonly __brand?: 'uuid' };
export const uuidSchema = z.uuid();

export function newId(): UUID {
  return crypto.randomUUID();
}

export function isUuid(v: unknown): v is UUID {
  return uuidSchema.safeParse(v).success;
}
