import { currentUser } from './auth';
export async function requireUser(){
  const u = await currentUser();
  if(!u) return { error: Response.json({ error:'login required' }, { status:401 }) };
  return { user: u };
}
