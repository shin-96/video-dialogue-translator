import fs from 'fs';
import path from 'path';
const DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DIR, 'db.json');
function empty(){ return { users:[], sessions:{}, videos:[], saves:[], translations:{}, quota:{} }; }
export function readDB(){
  try{ return JSON.parse(fs.readFileSync(FILE,'utf8')); }catch{ return empty(); }
}
export function writeDB(db){
  fs.mkdirSync(DIR,{recursive:true});
  const tmp = FILE+'.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db,null,1));
  fs.renameSync(tmp, FILE);
}
export function mutate(fn){
  const db = readDB(); const out = fn(db); writeDB(db); return out;
}
export const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
export const today = () => new Date().toISOString().slice(0,10);
export const DAILY_QUOTA = 50000;
export function quotaUsed(db, userId){
  return (db.quota[`${userId}:${today()}`] || 0);
}
export function addQuota(db, userId, n){
  const k = `${userId}:${today()}`;
  db.quota[k] = (db.quota[k]||0) + n;
}
