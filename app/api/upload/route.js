import fs from 'fs';
import path from 'path';
import { requireUser } from '@/lib/api';
export async function POST(req){
  const { error } = await requireUser(); if(error) return error;
  const form = await req.formData().catch(()=>null);
  const file = form?.get('file');
  if(!file || typeof file === 'string') return Response.json({ error:'file required' }, { status:400 });
  if(!/\.(mp4|webm|mov|mkv)$/i.test(file.name)) return Response.json({ error:'only video files (mp4/webm/mov/mkv)' }, { status:400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(),'data','uploads');
  fs.mkdirSync(dir,{recursive:true});
  const safe = Date.now() + '-' + file.name.replace(/[^\w.\-]+/g,'_');
  fs.writeFileSync(path.join(dir, safe), buf);
  return Response.json({ src:`/api/uploads/${safe}`, name: file.name });
}
