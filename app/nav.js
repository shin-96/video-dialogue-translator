'use client';
import { useEffect, useState } from 'react';
export default function Nav(){
  const [user,setUser] = useState(undefined);
  useEffect(()=>{ fetch('/api/auth').then(r=>r.json()).then(j=>setUser(j.user)).catch(()=>setUser(null)); },[]);
  async function logout(){ await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})}); location.href='/'; }
  const link = {fontSize:13,color:'#c9ccd1'};
  return (<nav style={{display:'flex',gap:16,alignItems:'center'}}>
    <a style={link} href="/library">Library</a>
    <a style={link} href="/notebook">Notebook</a>
    <a style={link} href="/settings">Settings</a>
    {user === undefined ? null : user ? (<>
      <span className="small muted">{user.email}</span>
      <button className="btn-ghost" style={{padding:'6px 12px',fontSize:12}} onClick={logout}>Log out</button>
    </>) : (<a className="btn-white" style={{padding:'7px 14px',fontSize:13}} href="/auth">Log in</a>)}
  </nav>);
}
