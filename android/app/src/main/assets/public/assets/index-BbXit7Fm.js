const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/web-DUX2VE7N.js","assets/index-CQpkvO-x.js","assets/index-26f4ulpt.css"])))=>i.map(i=>d[i]);
import{c as u,t as d,_ as l}from"./index-CQpkvO-x.js";/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=u("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);/**
 * @license lucide-react v0.462.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R=u("RefreshCw",[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]);function C(a){a.CapacitorUtils.Synapse=new Proxy({},{get(w,t){return new Proxy({},{get(v,n){return(c,p,e)=>{const o=a.Capacitor.Plugins[t];if(o===void 0){e(new Error(`Capacitor plugin ${t} not found`));return}if(typeof o[n]!="function"){e(new Error(`Method ${n} not found in Capacitor plugin ${t}`));return}(async()=>{try{const i=await o[n](c);p(i)}catch(i){e(i)}})()}}})}})}function f(a){a.CapacitorUtils.Synapse=new Proxy({},{get(w,t){return a.cordova.plugins[t]}})}function y(a=!1){typeof window>"u"||(window.CapacitorUtils=window.CapacitorUtils||{},window.Capacitor!==void 0&&!a?C(window):window.cordova!==void 0&&f(window))}var r;(function(a){a.Documents="DOCUMENTS",a.Data="DATA",a.Library="LIBRARY",a.Cache="CACHE",a.External="EXTERNAL",a.ExternalStorage="EXTERNAL_STORAGE",a.ExternalCache="EXTERNAL_CACHE",a.LibraryNoCloud="LIBRARY_NO_CLOUD",a.Temporary="TEMPORARY"})(r||(r={}));var s;(function(a){a.UTF8="utf8",a.ASCII="ascii",a.UTF16="utf16"})(s||(s={}));const A=d("Filesystem",{web:()=>l(()=>import("./web-DUX2VE7N.js"),__vite__mapDeps([0,1,2])).then(a=>new a.FilesystemWeb)});y();export{r as D,s as E,A as F,R,h as a};
