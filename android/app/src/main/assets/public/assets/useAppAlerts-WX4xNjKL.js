import{c as h,r as s,H as n}from"./index-CQpkvO-x.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=h("TriangleAlert",[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]]),A=()=>{const[r,l]=s.useState([]),[c,o]=s.useState(!0),a=s.useCallback(async()=>{try{const{data:e,error:t}=await n.from("app_alerts").select("*").eq("active",!0);t?(console.warn("[AppAlerts] fetch failed:",t.message),l([])):l(e||[])}catch(e){console.warn("[AppAlerts] fetch threw:",e),l([])}finally{o(!1)}},[]);s.useEffect(()=>{a();const e=n.channel("app_alerts_changes").on("postgres_changes",{event:"*",schema:"public",table:"app_alerts"},()=>a()).subscribe(),t=setInterval(a,6e4);return()=>{n.removeChannel(e),clearInterval(t)}},[a]);const p=s.useCallback(e=>{if(!e)return null;const t=e.toLowerCase();return r.find(u=>t.includes(u.app_match.toLowerCase()))||null},[r]);return{alerts:r,loading:c,getAlertForApp:p,refetch:a}};export{f as T,A as u};
