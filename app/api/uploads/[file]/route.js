import fs from 'fs';
import path from 'path';
import { requireUser } from '@/lib/api';
export async function GET(req, { params }){
  const { error } = await requireUser(); if(error) return error;
  const { file } = await params;
  const p = path.join(process.cwd(),'data','uploads', path.basename(file));
  if(!fs.existsSync(p)) return new Response('not found', { status:404 });
  const stat = fs.statSync(p);
  const range = req.headers.get('range');
  const type = p.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  if(range){
    const [s,e] = range.replace('bytes=','').split('-');
    const start = parseInt(s||'0'), end = e? parseInt(e) : stat.size-1;
    const stream = fs.createReadStream(p, { start, end });
    return new Response(stream, { status:206, headers:{ 'Content-Type':type, 'Content-Range':`bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges':'bytes', 'Content-Length': String(end-start+1) } });
  }
  return new Response(fs.createReadStream(p), { headers:{ 'Content-Type':type, 'Content-Length': String(stat.size), 'Accept-Ranges':'bytes' } });
}
