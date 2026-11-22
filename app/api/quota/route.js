import { requireUser } from '@/lib/api';
import { readDB, DAILY_QUOTA, quotaUsed } from '@/lib/store';
export async function GET(){
  const { user, error } = await requireUser(); if(error) return error;
  const used = quotaUsed(readDB(), user.id);
  return Response.json({ used, limit: DAILY_QUOTA, remaining: DAILY_QUOTA - used });
}
