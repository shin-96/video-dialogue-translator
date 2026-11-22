import crypto from 'crypto';
import { requireUser } from '@/lib/api';
import { mutate } from '@/lib/store';

// The browser-companion extension cannot use the session cookie (it runs on
// other sites' pages), so each user gets a long-lived import token instead.
// GET returns the user's token, generating + persisting one on first use;
// POST regenerates it (the old token stops working immediately).
const gen = () => crypto.randomBytes(24).toString('hex');

export async function GET(){
  const { user, error } = await requireUser(); if(error) return error;
  const token = mutate(d=>{
    const u = d.users.find(x=>x.id===user.id);
    if(!u) return null;
    if(!u.importToken) u.importToken = gen();
    return u.importToken;
  });
  if(!token) return Response.json({ error:'user not found' }, { status:404 });
  return Response.json({ token });
}

export async function POST(){
  const { user, error } = await requireUser(); if(error) return error;
  const token = mutate(d=>{
    const u = d.users.find(x=>x.id===user.id);
    if(!u) return null;
    u.importToken = gen();
    return u.importToken;
  });
  if(!token) return Response.json({ error:'user not found' }, { status:404 });
  return Response.json({ token });
}
