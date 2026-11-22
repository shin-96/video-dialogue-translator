import crypto from 'crypto';
import { cookies } from 'next/headers';
import { readDB } from './store';
export function hashPw(pw){
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt+':'+h;
}
export function verifyPw(pw, stored){
  try{
    const [salt,h] = stored.split(':');
    const t = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(t, Buffer.from(h,'hex'));
  }catch{ return false; }
}
export const newToken = () => crypto.randomBytes(32).toString('hex');
export async function currentUser(){
  const c = await cookies();
  const tok = c.get('vdt_session')?.value;
  if(!tok) return null;
  const db = readDB();
  const uid = db.sessions[tok];
  if(!uid) return null;
  return db.users.find(u=>u.id===uid) || null;
}
export function sessionCookie(tok){
  return { name:'vdt_session', value:tok, httpOnly:true, path:'/', maxAge:60*60*24*30, sameSite:'lax' };
}
