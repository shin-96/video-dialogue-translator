import { requireUser } from '@/lib/api';
import { mutate } from '@/lib/store';
export async function POST(req){
  const { user, error } = await requireUser(); if(error) return error;
  const { defaultTarget } = await req.json().catch(()=>({}));
  mutate(d=>{ const u = d.users.find(x=>x.id===user.id); if(u && defaultTarget) u.defaultTarget = defaultTarget; });
  return Response.json({ ok:true });
}
