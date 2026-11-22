import './globals.css';
import Nav from './nav';
export const metadata = { title:'Dialogue — Learn languages through video', description:'Paste a video link, get bilingual karaoke dialogue, save words, review with exercises.' };
export default function RootLayout({ children }){
  return (<html lang="en"><body>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'13px 20px',borderBottom:'1px solid #1F2023',position:'sticky',top:0,background:'#08090A',zIndex:20}}>
      <a href="/" style={{display:'flex',gap:10,alignItems:'center'}}><span style={{width:28,height:28,borderRadius:8,background:'#FF4D00',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontWeight:800}}>◐</span><b style={{letterSpacing:'-.02em'}}>Dialogue</b></a>
      <Nav/>
    </header>
    <main style={{maxWidth:1100,margin:'0 auto',padding:'20px 16px 60px'}}>{children}</main>
  </body></html>);
}
