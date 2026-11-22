import { readDB, mutate, uid, DAILY_QUOTA, quotaUsed } from '@/lib/store';
import { hashPw, verifyPw, newToken, sessionCookie, currentUser } from '@/lib/auth';
import { cookies } from 'next/headers';
export async function POST(req){
  const { action, email, password, name } = await req.json().catch(()=>({}));
  if(action === 'logout'){
    const c = await cookies(); const tok = c.get('vdt_session')?.value;
    if(tok) mutate(d=>{ delete d.sessions[tok]; });
    c.delete('vdt_session');
    return Response.json({ ok:true });
  }
  if(!email || !password) return Response.json({ error:'email and password required' }, { status:400 });
  if(action === 'register'){
    if(password.length < 6) return Response.json({ error:'password must be at least 6 characters' }, { status:400 });
    const db = readDB();
    if(db.users.some(u=>u.email===email.toLowerCase())) return Response.json({ error:'email already registered' }, { status:409 });
    const user = { id: uid(), email: email.toLowerCase(), name: name || email.split('@')[0], pw: hashPw(password), defaultTarget:'vi', createdAt: Date.now() };
    const tok = newToken();
    mutate(d=>{ d.users.push(user); d.sessions[tok]=user.id; });
    const c = await cookies(); c.set(sessionCookie(tok));
    return Response.json({ user:{ id:user.id, email:user.email, name:user.name } });
  }
  if(action === 'login'){
    const db = readDB();
    const user = db.users.find(u=>u.email===email.toLowerCase());
    if(!user || !verifyPw(password, user.pw)) return Response.json({ error:'wrong email or password' }, { status:401 });
    const tok = newToken();
    mutate(d=>{ d.sessions[tok]=user.id; });
    const c = await cookies(); c.set(sessionCookie(tok));
    return Response.json({ user:{ id:user.id, email:user.email, name:user.name } });
  }
  return Response.json({ error:'unknown action' }, { status:400 });
}
export async function GET(){
  const u = await currentUser();
  if(!u) return Response.json({ user:null });
  const db = readDB();
  return Response.json({ user:{ id:u.id, email:u.email, name:u.name, defaultTarget:u.defaultTarget||'vi' }, quota:{ used: quotaUsed(db,u.id), limit: DAILY_QUOTA } });
}
