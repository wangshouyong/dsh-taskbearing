window.__ModuleLoader__.load({
	id: "dsh-taskbearing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
Object.defineProperty(exports,Symbol.toStringTag,{value:`Module`});var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,s)=>(s=n==null?{}:e(i(n)),o(r||!n||!n.__esModule||!a.call(n,`default`)?t(s,`default`,{value:n,enumerable:!0}):s,n));let c=require("react");c=s(c,1);let l=require("react-dom");var u=class extends Error{constructor(e,t={}){super(e),this.name=`ApiError`,Object.assign(this,t)}};function d(e,t){let n=e?.code??``;return n===`E_NOT_FOUND`||t===404?{code:`E_HOST_OUTDATED`,message:`当前 DSH 是旧版宿主，缺少该接口；重启 DSH 后即可使用。`,details:e?.details}:{code:n||`HTTP_${t}`,message:n?`${n}: ${e?.message??`HTTP ${t}`}`:`HTTP ${t}`,details:e?.details}}async function f(e,t={}){let n=await fetch(e,t),r=await n.json().catch(()=>({}));if(!n.ok){let e=d(r?.error??{},n.status);throw new u(e.message,{code:e.code,details:e.details})}return r}function p(e){let t=new URLSearchParams;for(let[n,r]of Object.entries(e))r!=null&&t.set(n,String(r));let n=t.toString();return n?`?${n}`:``}var m={current:e=>f(`/api/compass/current${p(e??{})}`),baseline:(e,t)=>f(`/api/compass/baseline${p({cwd:e,id:t})}`),status:(e,t)=>f(`/api/compass/status${p({cwd:e,sessionId:t})}`),sessionLinks:(e,t)=>f(`/api/compass/session-links${p({cwd:e,ids:Array.isArray(t)?t.join(`,`):``})}`),sessionTurn:(e,t)=>f(`/api/compass/session-turn${p({cwd:e,session:t?.session,turn:t?.turn,at:t?.at})}`),tree:(e,t)=>f(`/api/compass/tree${p({cwd:e,ifmtime:t})}`),detail:(e,t)=>f(`/api/compass/detail${p({cwd:e,id:t})}`),saveNote:(e,t,n,r)=>f(`/api/compass/note`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,id:t,content:n,sessionId:r})}),fileExists:(e,t)=>f(`/api/compass/file-exists`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,paths:t})}),getUiState:e=>f(`/api/compass/ui-state${p({cwd:e})}`),putUiState:(e,t)=>f(`/api/compass/ui-state`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,...t})}),getPrefs:()=>f(`/api/compass/prefs`),workspaces:e=>f(`/api/compass/workspaces${p({cwd:e})}`),removeWorkspace:e=>f(`/api/compass/workspaces/remove`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({workspace_id:e,confirm:`DELETE`})}),removeRules:()=>f(`/api/compass/rules/remove`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({})}),uninstall:()=>f(`/api/compass/uninstall`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({confirm:`UNINSTALL`})}),putPrefs:e=>f(`/api/compass/prefs`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify(e)}),exportBoard:async e=>{let t=await fetch(`/api/compass/export${p({cwd:e})}`);if(!t.ok){let e=(await t.json().catch(()=>({})))?.error??{};throw new u(e.code?`${e.code}: ${e.message??`HTTP ${t.status}`}`:`HTTP ${t.status}`,{code:e.code??`HTTP_${t.status}`,details:e.details})}let n=await t.text(),r=t.headers.get(`content-disposition`)??``,i=/filename\*=UTF-8''([^;]+)/i.exec(r),a=`taskboard.json`;if(i)try{a=decodeURIComponent(i[1])}catch{a=`taskboard.json`}return{json:n,filename:a}},importBoard:(e,t)=>f(`/api/compass/import`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,bundle:t,confirm:`IMPORT`})})},h=[`current`,`active`,`all`],g=new Set([`待裁决`,`冲突`]);function _(e,t){let n=e.verdict_state??null;return t===`all`?!0:t===`current`?n===null||g.has(n):(n===null||g.has(n))&&e.exec_state!==`已执行`}function v(e){let t=e?.pointers;if(!Array.isArray(t)||t.length===0)return 0;let n=t[t.length-1],r=n?.at?Date.parse(n.at):0;return Number.isFinite(r)?r:0}function y(e){let t=[],n=(e,r)=>{g.has(e.verdict_state)&&t.push({node:e,path:r});for(let t of e.children??[])n(t,[...r,e.human_line])};for(let t of e?.root?.children??[])n(t,[]);return t.sort((e,t)=>v(t.node)-v(e.node)),t}function b(e,t,n){let r=[],i=(e,a)=>{if(!_(e,t))return;let o=e.children??[],s=o.filter(e=>_(e,t)),c=n?.[e.id]===!0;if(r.push({node:e,depth:a,hasChildren:o.length>0,expanded:c,kind:e.kind}),c)for(let e of s)i(e,a+1)};for(let t of e?.root?.children??[])i(t,0);return r}function x(e){let t=0,n=0,r=0,i=0,a=0,o=0,s=e=>{t+=1,e.exec_state===`进行中`?n+=1:e.exec_state===`已阻塞`?i+=1:e.exec_state===`已执行`&&(r+=1),e.verdict_state===`待裁决`&&(a+=1),e.verdict_state===`冲突`&&(o+=1);for(let t of e.children??[])s(t)};for(let t of e.children??[])s(t);return{total:t,active:n,blocked:i,done:r,pendingVerdict:a,conflict:o}}function S(e){let t=[`${e.total} 条任务`];return e.active>0&&t.push(`进行中 ${e.active}`),e.blocked>0&&t.push(`已阻塞 ${e.blocked}`),e.done>0&&t.push(`已执行 ${e.done}`),e.pendingVerdict>0&&t.push(`待裁决 ${e.pendingVerdict}`),e.conflict>0&&t.push(`冲突 ${e.conflict}`),t.join(` · `)}function C(e){let t={未开始:0,进行中:0,已阻塞:0,已执行:0},n=e=>{for(let r of e.children??[])t[r.exec_state]!==void 0&&(t[r.exec_state]+=1),n(r)};return n(e?.root??{children:[]}),t}function w(e){let t=[],n=e.exec_state;n===`已阻塞`?t.push({label:`已阻塞`,tone:`yellow`}):n===`进行中`?t.push({label:`进行中`,tone:`blue`}):n===`已执行`?t.push({label:`已执行`,tone:`green`}):t.push({label:`未开始`,tone:`gray`});let r=e.verdict_state??null;return r===`待裁决`?t.push({label:`待裁决`,tone:`red`}):r===`冲突`?t.push({label:`冲突`,tone:`orange`}):r===`已废弃`?t.push({label:`已废弃`,tone:`muted`}):r===`已替代`&&t.push({label:`已替代`,tone:`muted`}),e.merged_into&&t.push({label:`已并入 ${e.merged_into}`,tone:`muted`}),t}var T=18e5,E=new Set([`进行中`,`已阻塞`]),D=new Set([`已废弃`,`已替代`]);function O(e,t,n={}){if(!t||typeof t!=`string`||!E.has(e?.exec_state)||D.has(e?.verdict_state??null))return null;let r=e?.pointers;if(!Array.isArray(r)||r.length===0)return null;let i=r[r.length-1],a=typeof i?.session==`string`?i.session:``;if(!a||a===t)return null;let o=typeof i?.at==`string`?Date.parse(i.at):NaN;if(!Number.isFinite(o))return null;let s=Number.isFinite(n.now)?n.now:Date.now(),c=Number.isFinite(n.windowMs)?n.windowMs:T,l=s-o;return l>c||l<-6e4?null:{session:a,at:String(i.at),note:typeof i?.note==`string`?i.note:``,minutesAgo:Math.max(0,Math.floor(Math.max(0,l)/6e4))}}function k(e){if(!e)return``;let t=Number(e.minutesAgo);return Number.isFinite(t)&&t>=1?`⚠️ 另一会话在 ${t} 分钟前正在操作此任务`:`⚠️ 另一会话刚刚正在操作此任务`}function ee(e,t={}){let n=e?.node??{},r=n.kind===`requirement`?x(n):null,i=O(n,t.currentSessionId,{now:t.now});return JSON.stringify([n.id,n.kind,n.human_line,n.exec_state,n.verdict_state??null,n.dead_reason??null,n.merged_into??null,e.depth,e.hasChildren===!0,e.expanded===!0,r,i?`${i.session}@${i.at}@${i.minutesAgo}`:null])}function A(e,t){return e?.signature===t?.signature&&e?.onToggle===t?.onToggle&&e?.onOpenDetail===t?.onOpenDetail}function j(e,t=80){let n=String(e??``);return n.length>t?`${n.slice(0,t-1)}…`:n}function te(e){return String(e??``).trim().toLowerCase()}function ne(e,t){if(t.length===0)return!0;let n=[e.title,e.human_line,e.dead_reason].filter(e=>typeof e==`string`&&e.length>0).join(` `).toLowerCase();return t.every(e=>n.includes(e))}function re(e,t,n,r){let i=te(r),a=i?i.split(/\s+/).filter(Boolean):[];if(a.length===0)return{rows:b(e,t,n),matchCount:0,searching:!1};let o=new Set,s=e=>{if(_(e,t)){ne(e,a)&&o.add(e.id);for(let t of e.children??[])s(t)}};for(let t of e?.root?.children??[])s(t);let c=e=>o.has(e.id)||(e.children??[]).some(c),l=[],u=(e,t)=>{if(!c(e))return;let n=(e.children??[]).filter(c);l.push({node:e,depth:t,hasChildren:n.length>0,expanded:!0,kind:e.kind});for(let e of n)u(e,t+1)};for(let t of e?.root?.children??[])c(t)&&u(t,0);return{rows:l,matchCount:o.size,searching:!0}}function ie(e,t,n,r,i){let a=t.join(` › `),o=e.verdict_state??`无`,s=(e.pointers??[]).map(e=>`${e.session} · ${e.at}${e.note?` ${e.note}`:``}`).join(`；`),c=n?.id?`- 所属需求：${n.id} 明面——${n.surface??`（无明面）`}`:null,l=[`# 任务交接：${e.id} ${e.title}`,`- 任务路径：${a}`,`- 执行状态：${e.exec_state}`,`- 裁决状态：${o}`,`- 追溯链：${s||`无`}`,c,``,`## 详情（AI 写）`,r?.trim()?r:`（暂无详情）`];return i?.trim()&&l.push(``,`## 用户备注`,i),l.join(`
`)}function ae(e){let t=/^(R-\d{3,4})/.exec(e??``);return t?t[1]:null}function M(e){let t=e?.workspace??{},n=0,r=0,i=e=>{for(let t of e?.children??[])n+=1,t.kind===`requirement`&&(r+=1),i(t)};return i(e?.tree?.root),{format:typeof e?.format==`string`?e.format:null,schema:Number.isInteger(e?.schema)?e.schema:null,exported_at:typeof e?.exported_at==`string`?e.exported_at:null,plugin_version:typeof e?.plugin_version==`string`?e.plugin_version:null,workspace_name:typeof t.name==`string`?t.name:null,original_path:typeof t.original_path==`string`?t.original_path:null,nodes:n,requirements:r,details:Object.keys(e?.details??{}).length}}function oe(e){return[`来源工作区：${e.workspace_name??`(未命名)`}`,`原始路径：${e.original_path??`(未知)`}`,`导出时间：${e.exported_at??`(未知)`}`,`插件版本：${e.plugin_version??`(未知)`}`,`内容：${e.requirements} 需求 · ${e.nodes} 节点 · ${e.details} 个详情/备注`].join(`
`)}var N=new Set(`ts.tsx.js.jsx.mjs.cjs.json.md.css.scss.py.java.go.rs.c.h.cpp.hpp.yml.yaml.toml.ini.sh.ps1.html.vue.svelte.sql.txt`.split(`.`)),P=200,se=20;function ce(e){let t=String(e??``);return t.startsWith(`/`)||/^[A-Za-z]:[/\\]/.test(t)||t.startsWith(`\\\\`)}function F(e){return encodeURIComponent(e).replace(/%3A/gi,`:`)}function le(e){return e.split(`/`).map(F).join(`/`)}function I(e,t){let n=String(t??``).replace(/\\/g,`/`).replace(/^(?:\.\/)+/,``);return`dsh-resource://file/session/${F(String(e??``))}/${le(n)}`}function ue(e,t,n){let r=String(n??``).replace(/\\/g,`/`);if(!ce(r))return I(e,r);let i=t?String(t).replace(/\\/g,`/`).replace(/\/+$/,``):``;return i!==``&&r===i?I(e,``):i!==``&&r.startsWith(`${i}/`)?I(e,r.slice(i.length+1)):I(e,r)}function L(e){let t=/^(.*?)#L(\d+)$/.exec(e);if(t)return{path:t[1],line:Number(t[2])};let n=/^(.*?):(\d+)(?::\d+)?$/.exec(e);return n&&!/^[A-Za-z]$/.test(n[1])?{path:n[1],line:Number(n[2])}:{path:e,line:null}}function de(e){let t=e.lastIndexOf(`：`);if(t>=0&&t<e.length-1)return e.slice(t+1);let n=/^[^:\\/]{1,20}:([A-Za-z0-9_.$~%+\-][^\s]*)$/.exec(e);return n?n[1]:e}function R(e){let t=String(e??``).trim();if(!t||(t=t.replace(/^`+|`+$/g,``).replace(/^["'(<[]+|["')>\]]+$/g,``),t=de(t),!t||t.length>P)||/:\/\//.test(t)||/^(?:https?|ftp|file):\/\//i.test(t)||/[\s<>|*?"]/.test(t))return null;let{path:n,line:r}=L(t),i=n.replace(/\\/g,`/`);if(!i)return null;let a=/\.([A-Za-z0-9]{1,10})$/.exec(i),o=a?a[1].toLowerCase():``,s=i.includes(`/`);return!N.has(o)||!s&&!/^[\w.-]+\.(?:json|md|txt|toml|ini|ya?ml)$/i.test(i)?null:{path:i,line:Number.isInteger(r)&&r>0?r:null}}var fe=/(?:[A-Za-z]:[\\/]|\/|\\\\)?[^\s`"'<>|*?]+[\\/][^\s`"'<>|*?]+(?::\d+(?::\d+)?|#L\d+)?/g;function pe(e,t={}){let n=Math.max(1,Math.min(Number.isInteger(t.limit)?t.limit:se,50)),r=String(e??``);if(!r)return[];let i=new Set,a=[],o=e=>{let t=String(e??``).replace(/[、，。；：！？（）【】「」《》]/g,` `).split(/\s+/).filter(Boolean);for(let e of t){let t=R(e);if(!t)continue;let r=`${t.path}#${t.line??``}`;if(!i.has(r)&&(i.add(r),a.push({...t,raw:e.trim()}),a.length>=n))return}},s=[],c=/```[\s\S]*?```|`[^`\n]{1,200}`/g,l;for(;(l=c.exec(r))!==null;)s.push(l[0].replace(/```/g,` `));for(let e of s)for(let t of e.split(/\s+/))o(t);let u=r.replace(c,` `);for(;(l=fe.exec(u))!==null&&(o(l[0]),!(a.length>=n)););return a.slice(0,n)}var z=Object.freeze({AVAILABLE:`available`,UNAVAILABLE:`unavailable`,ARCHIVED:`archived`,LOADING:`loading`,UNSUPPORTED:`unsupported`,FILE:`file`});function B(e){let t=typeof e==`string`?e.trim():``;return/^(?:session-[A-Za-z0-9._-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(t)}function V(e,t={}){return typeof e!=`string`||!e.trim()?z.UNAVAILABLE:/^file:/i.test(e.trim())?z.FILE:B(e)?!t.canOpen||!t.sessions||!t.workspaces?z.UNSUPPORTED:t.workspaces.state===`error`?z.UNAVAILABLE:t.sessions.phase===`pending`||t.workspaces.phase===`pending`?z.LOADING:Array.isArray(t.workspaces.archivedSessionIds)&&t.workspaces.archivedSessionIds.includes(e)?z.ARCHIVED:Array.isArray(t.sessions.ids)&&t.sessions.ids.includes(e)?z.AVAILABLE:z.UNAVAILABLE:z.UNAVAILABLE}function H(e,t){return e===z.UNAVAILABLE?t===!0?z.AVAILABLE:z.UNAVAILABLE:e??z.UNAVAILABLE}function U(e){switch(e){case z.AVAILABLE:return``;case z.ARCHIVED:return`会话已归档`;case z.LOADING:return`会话加载中…`;case z.UNSUPPORTED:return`宿主不支持会话跳转`;case z.FILE:return`文件段（不可跳转）`;default:return`会话不可用`}}function me(e){let t=String(e??``);return t.length<=20?t:`${t.slice(0,12)}…${t.slice(-4)}`}function he(e){if(typeof e!=`string`)return``;let t=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(e)?e:``;return t?`${t.slice(0,10)} ${t.slice(11,19)}`:``}function ge(e,t){let n=typeof e?.session==`string`?e.session:``;return{key:`${n}#${e?.at??``}#${t}`,at:he(e?.at),turn:Number.isInteger(e?.turn)&&e.turn>=0?e.turn:null,note:typeof e?.note==`string`?e.note:``,session:n,shortSession:me(n)}}var _e=`data-turn-tail`,W=`data-dsh-compass-flash`,ve=`dsh-compass-flash-style`,ye=[`加载更早`,`Load earlier`,`加载更早的消息`,`Load earlier turns`];function be(e){return`[${_e}="${Number(e)}"]`}function xe(e){let t=String(e??``).trim();return ye.some(e=>t===e||t.startsWith(e))}function Se(e){let t=e?.querySelectorAll?.(`button`)??[];for(let e of t)if(xe(e.textContent))return e;return null}function G(e){if(!e||typeof e.createElement!=`function`||typeof e.getElementById==`function`&&e.getElementById(`dsh-compass-flash-style`))return;let t=e.createElement(`style`);t.id=ve,t.textContent=`@keyframes dsh-compass-flash-pulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0);background-color:rgba(59,130,246,0)}25%,75%{box-shadow:0 0 0 3px rgba(59,130,246,.85);background-color:rgba(59,130,246,.12)}}[${W}]{animation:dsh-compass-flash-pulse 1s ease-in-out 2;border-radius:8px}`,(e.head??e.documentElement)?.appendChild?.(t)}function Ce(e,t=e?.ownerDocument,n=3e3){if(!e||typeof e.setAttribute!=`function`)return!1;G(t),e.setAttribute(W,`1`);let r=t?.defaultView??null,i=(typeof r?.setTimeout==`function`?r.setTimeout:setTimeout)(()=>{e.removeAttribute?.(W)},n);return i&&typeof i.unref==`function`&&i.unref(),!0}async function we(e,t={}){let n=t.document??(typeof document>`u`?null:document);if(!n)return{ok:!1,reason:`no-document`,pages:0};let r=t.sleep??(e=>new Promise(t=>setTimeout(t,e))),i=t.now??(()=>Date.now()),a=Number.isFinite(t.timeoutMs)?t.timeoutMs:1e4,o=Number.isFinite(t.pageWaitMs)?t.pageWaitMs:700,s=i()+a,c=0;for(;i()<=s;){let i=n.querySelector?.(be(e));if(i)return i.scrollIntoView?.({block:`center`,behavior:`smooth`}),Ce(i,n,t.highlightMs??3e3),{ok:!0,reason:`located`,pages:c,turn:Number(e)};let a=Se(n);a?(a.click(),c+=1,await r(o)):await r(300)}return{ok:!1,reason:c>0?`timeout-after-pages`:`turn-not-rendered`,pages:c}}async function Te(e={},t={}){let n=Number(e.turn);if(!Number.isInteger(n)||n<1)return{ok:!1,reason:`no-turn`,pages:0};let r=typeof e.sessionId==`string`?e.sessionId:``,i=typeof e.currentSessionId==`string`?e.currentSessionId:null;if(r&&r!==i){if(typeof e.openSession!=`function`)return{ok:!1,reason:`unsupported`,pages:0};let n=!0;try{n=e.openSession(r)}catch{n=!1}if(n===!1)return{ok:!1,reason:`open-failed`,pages:0};await(t.sleep??(e=>new Promise(t=>setTimeout(t,e))))(Number.isFinite(t.openWaitMs)?t.openWaitMs:1200)}return we(n,t)}async function Ee(e){let t=Number.isInteger(e?.turn)&&e.turn>=1?e.turn:null,n=typeof e?.at==`string`&&e.at.trim()?e.at.trim():null;if(typeof e?.request!=`function`)return{targetTurn:t,meta:null,reason:t===null?`no-turn`:null};let r;try{r=await e.request({session:typeof e?.sessionId==`string`?e.sessionId:``,turn:t,at:n})}catch(e){return{targetTurn:t,meta:null,reason:`lookup-failed`,error:e instanceof Error?e.message:String(e)}}if(!r||typeof r!=`object`)return{targetTurn:t,meta:null,reason:`lookup-failed`,error:`宿主返回为空`};if(r.log_available!==!0)return{targetTurn:null,meta:r,reason:t===null?`no-turn`:`log-unavailable`};let i=Number.isInteger(r.turn)&&r.turn>=1?r.turn:null;return i===null?{targetTurn:null,meta:r,reason:t===null?`no-turn`:`turn-missing`}:{targetTurn:i,meta:r,reason:null}}function De(e,t){let n=t?.meta??null,r=Number.isInteger(t?.targetTurn)?t.targetTurn:null,i=Number.isInteger(n?.requested_turn)?n.requested_turn:null;if(t?.reason===`lookup-failed`)return e?.ok?`已定位第 ${r??e?.turn??`?`} 轮（宿主未提供轮次核验，高亮约 3 秒）`:`已打开会话，但未能定位第 ${r??i??`?`} 轮`;if(t?.reason===`log-unavailable`)return`该会话没有可读的日志，已打开会话（无法核验轮次）`;if(t?.reason===`turn-missing`)return`该会话日志只有 ${n?.turn_count??0} 轮，戳记第 ${i??`?`} 轮不存在；已打开会话`;if(t?.reason===`no-turn`)return`该记录无轮次信息，仅打开会话`;if(e?.reason===`open-failed`)return`打开会话失败：宿主未提供会话跳转`;let a=n?.origin===`subagent`&&typeof n?.target_session==`string`&&n.target_session;if(e?.ok){let t=n?.source===`by-at`&&i!==null&&i!==r;return a?t?`子代理会话不可直接打开；已按时间在父会话定位第 ${r} 轮（戳记第 ${i} 轮，高亮约 3 秒）`:`子代理会话不可直接打开；已在父会话定位第 ${r??`?`} 轮（高亮约 3 秒）`:t?`戳记第 ${i} 轮与日志不符，已按时间还原为第 ${r} 轮（高亮约 3 秒）`:`已定位第 ${r??e?.turn??`?`} 轮（高亮约 3 秒）`}if(e?.reason===`turn-not-rendered`||e?.reason===`timeout-after-pages`){let e=Number.isInteger(n?.turn_count)?`（会话日志共 ${n.turn_count} 轮）`:``;return`已打开${a?`父会话`:`会话`}，但未能定位第 ${r??i??`?`} 轮${e}`}return e?.reason===`unsupported`?`宿主不支持会话跳转`:`已打开会话，但未能定位第 ${r??i??`?`} 轮`}Object.freeze({view:`current`,rememberExpand:!1});function Oe(e){return{view:[`current`,`active`,`all`].includes(e?.view)?e.view:`current`,rememberExpand:e?.rememberExpand===!0}}function ke(e,t){let n={...e??{}};return n[t]=!n[t],n}var Ae=2e3;function je({tabVisible:e,docVisible:t,editing:n}){return!!(e&&t&&!n)}function Me(e=document){let t=e?.documentElement;return t&&((t.getAttribute(`data-theme`)||t.getAttribute(`data-color-scheme`)||t.getAttribute(`data-mode`)||``).toLowerCase().includes(`dark`)||(t.className||``).toLowerCase().includes(`dark`))?`dark`:`light`}function Ne(e,t=document){let n=()=>e(Me(t));n();let r=new MutationObserver(e=>{for(let t of e)t.type===`attributes`&&n()});return r.observe(t.documentElement,{attributes:!0,attributeFilter:[`class`,`data-theme`,`data-color-scheme`,`data-mode`]}),()=>r.disconnect()}function Pe(){let[e,t]=(0,c.useState)(()=>Me());return(0,c.useEffect)(()=>Ne(t),[]),e}function Fe(e,t,n=320){let r=t-Math.max(0,e);return!Number.isFinite(r)||r<=0?0:Math.max(n,Math.floor(r))}function Ie(e){(0,c.useLayoutEffect)(()=>{let t=e.current;if(!t)return;let n=()=>{let e=Fe(t.getBoundingClientRect().top,window.innerHeight);e>0&&(t.style.height=`${e}px`)};n();let r=[50,120,250,500,900,1600,2600].map(e=>window.setTimeout(n,e)),i=()=>n();document.addEventListener(`transitionend`,i,!0),document.addEventListener(`animationend`,i,!0),window.visualViewport?.addEventListener(`resize`,n),window.addEventListener(`resize`,n);let a=new ResizeObserver(n);return a.observe(document.documentElement),t.parentElement&&a.observe(t.parentElement),()=>{for(let e of r)window.clearTimeout(e);document.removeEventListener(`transitionend`,i,!0),document.removeEventListener(`animationend`,i,!0),window.visualViewport?.removeEventListener(`resize`,n),window.removeEventListener(`resize`,n),a.disconnect()}},[e])}var Le=c.createElement,Re={search:[[`circle`,{cx:11,cy:11,r:7}],[`line`,{x1:16.5,y1:16.5,x2:21,y2:21}]],refresh:[[`path`,{d:`M21 12a9 9 0 1 1-2.64-6.36`}],[`polyline`,{points:`21 3 21 9 15 9`}]],settings:[[`line`,{x1:4,y1:21,x2:4,y2:14}],[`line`,{x1:4,y1:10,x2:4,y2:3}],[`line`,{x1:12,y1:21,x2:12,y2:12}],[`line`,{x1:12,y1:8,x2:12,y2:3}],[`line`,{x1:20,y1:21,x2:20,y2:16}],[`line`,{x1:20,y1:12,x2:20,y2:3}],[`line`,{x1:2,y1:14,x2:6,y2:14}],[`line`,{x1:10,y1:8,x2:14,y2:8}],[`line`,{x1:18,y1:16,x2:22,y2:16}]],history:[[`path`,{d:`M3 3v5h5`}],[`path`,{d:`M3.05 13a9 9 0 1 0 .5-5L3 8`}],[`polyline`,{points:`12 7 12 12 15.5 14`}]],close:[[`line`,{x1:6,y1:6,x2:18,y2:18}],[`line`,{x1:18,y1:6,x2:6,y2:18}]],chevron:[[`polyline`,{points:`9 5 16 12 9 19`}]],grid:[[`rect`,{x:3,y:3,width:7,height:7,rx:1.5}],[`rect`,{x:14,y:3,width:7,height:7,rx:1.5}],[`rect`,{x:3,y:14,width:7,height:7,rx:1.5}],[`rect`,{x:14,y:14,width:7,height:7,rx:1.5}]],file:[[`path`,{d:`M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z`}],[`polyline`,{points:`14 2 14 8 20 8`}]],copy:[[`rect`,{x:9,y:9,width:12,height:12,rx:2}],[`path`,{d:`M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1`}]],check:[[`polyline`,{points:`4 12.5 9.5 18 20 6.5`}]],alert:[[`path`,{d:`M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z`}],[`line`,{x1:12,y1:9,x2:12,y2:13}],[`line`,{x1:12,y1:17,x2:12.01,y2:17}]],pin:[[`path`,{d:`M12 17v5`}],[`path`,{d:`M9 3h6l1 7 3 3v1H5v-1l3-3z`}]],folder:[[`path`,{d:`M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z`}]],download:[[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`}],[`polyline`,{points:`7 10 12 15 17 10`}],[`line`,{x1:12,y1:15,x2:12,y2:3}]],upload:[[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`}],[`polyline`,{points:`7 8 12 3 17 8`}],[`line`,{x1:12,y1:3,x2:12,y2:15}]],trash:[[`polyline`,{points:`3 6 5 6 21 6`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`}]],external:[[`path`,{d:`M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6`}],[`polyline`,{points:`15 3 21 3 21 9`}],[`line`,{x1:10,y1:14,x2:21,y2:3}]],inbox:[[`path`,{d:`M22 12h-6l-2 3h-4l-2-3H2`}],[`path`,{d:`M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z`}]]};function K({name:e,size:t=16,className:n=``,title:r}){let i=Re[e]??[];return Le(`svg`,{className:`icon ${n}`.trim(),width:t,height:t,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:1.75,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":!r||void 0,role:r?`img`:void 0,focusable:`false`},r?Le(`title`,null,r):null,i.map(([e,t],n)=>Le(e,{key:n,...t})))}Object.keys(Re);var q=c.createElement,{useEffect:ze,useMemo:Be,useRef:Ve}=c,He=`a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])`;function Ue({variant:e=`center`,onClose:t,label:n,className:r=``,children:i}){let a=Pe(),o=Be(()=>{let e=document.createElement(`div`);return e.className=`dsh-compass-portal`,e},[]),s=Ve(null),c=Ve(t);return c.current=t,ze(()=>{o.setAttribute(`data-theme`,a)},[o,a]),ze(()=>(document.body.appendChild(o),()=>o.remove()),[o]),ze(()=>{let e=s.current;if(!e)return;let t=document.activeElement,n=e.querySelector(`[data-autofocus]`)??e.querySelector(He)??e;try{n.focus({preventScroll:!0})}catch{e.focus?.({preventScroll:!0})}return()=>{if(t&&document.contains(t)&&typeof t.focus==`function`)try{t.focus({preventScroll:!0})}catch{}}},[]),(0,l.createPortal)(q(`div`,{className:`modal-overlay ${e===`drawer`?`drawer`:`center`}`,onMouseDown:e=>{e.target===e.currentTarget&&c.current?.()},onKeyDown:e=>{if(e.key===`Escape`){e.stopPropagation(),e.preventDefault(),c.current?.();return}if(e.key!==`Tab`)return;let t=s.current;if(!t)return;let n=[...t.querySelectorAll(He)].filter(e=>e.getClientRects().length>0&&e.getAttribute(`aria-hidden`)!==`true`);if(n.length===0){e.preventDefault(),t.focus({preventScroll:!0});return}let r=n[0],i=n[n.length-1],a=document.activeElement;e.shiftKey&&(a===r||a===t)?(e.preventDefault(),i.focus({preventScroll:!0})):e.shiftKey||a!==i&&a!==t||(e.preventDefault(),r.focus({preventScroll:!0}))}},q(`div`,{className:`modal-card ${e===`drawer`?`drawer-card`:``} ${r}`.trim(),role:`dialog`,"aria-modal":`true`,"aria-label":n,tabIndex:-1,ref:s},i)),o)}function We({title:e,subtitle:t,onClose:n,closeLabel:r=`关闭`,children:i}){return q(`div`,{className:`modal-head`},q(`div`,{className:`modal-head-text`},q(`div`,{className:`modal-title`},e),t?q(`div`,{className:`modal-subtitle`},t):null,i),q(`button`,{type:`button`,className:`icon-btn modal-close`,onClick:n,"aria-label":r,"data-autofocus":!0},q(K,{name:`close`})))}var J=c.createElement,{useCallback:Y,useEffect:X,useMemo:Z,useRef:Ge,useState:Q}=c,Ke={current:`只看当前`,active:`只看在动`,all:`完整轨迹`},qe={gray:`tone-gray`,blue:`tone-blue`,green:`tone-green`,red:`tone-red`,orange:`tone-orange`,yellow:`tone-yellow`,muted:`tone-muted`};function Je({label:e,tone:t}){return J(`span`,{className:`badge ${qe[t]??`tone-gray`}`},e)}function Ye({cwd:e,onImported:t}){let[n,r]=Q(null),[i,a]=Q(null),[o,s]=Q(null),[l,u]=Q(null),[d,f]=Q(!1),[p,h]=Q(null),[g,_]=Q(null),[v,y]=Q(!1),[b,x]=Q(!1),S=Ge(null),C=Y(async()=>{a(null);try{let t=await m.workspaces(e);r(t.workspaces??[])}catch(e){a(e instanceof Error?e.message:String(e)),r([])}},[e]);X(()=>{C()},[C]);let w=Y(async()=>{if(!e)a(`尚未绑定工作区，无法导出`);else{a(null),s(null),x(!0);try{let{json:t,filename:n}=await m.exportBoard(e),r=null;try{r=M(JSON.parse(t))}catch{r=null}let i=new Blob([t],{type:`application/json`}),a=URL.createObjectURL(i),o=document.createElement(`a`);o.href=a,o.download=n,document.body.appendChild(o),o.click(),o.remove(),window.setTimeout(()=>URL.revokeObjectURL(a),1e3),s(`已导出 ${n}${r?`（${r.requirements} 需求 · ${r.nodes} 节点 · ${r.details} 详情/备注）`:``}`)}catch(e){a(e instanceof Error?e.message:String(e))}finally{x(!1)}}},[e]),T=Y(async e=>{let t=e?.target?.files?.[0];if(e?.target&&(e.target.value=``),t){a(null),s(null);try{let e=await t.text(),n=JSON.parse(e);_({filename:t.name,bundle:n,summary:M(n)})}catch(e){_(null),a(`导入文件不是合法 JSON：${e instanceof Error?e.message:String(e)}`)}}},[]),E=Y(async()=>{if(g&&e){y(!0),a(null),s(null);try{let n=(await m.importBoard(e,g.bundle))?.imported??{};s(`已导入：${n.nodes??0} 节点 · ${n.details??0} 详情/备注 · ${n.baseline_requirements??0} 需求基线`),_(null),await C(),t?.()}catch(e){a(e instanceof Error?e.message:String(e))}finally{y(!1)}}},[e,g,C,t]),D=Y(async e=>{try{await m.removeWorkspace(e),u(null),await C()}catch(e){a(e instanceof Error?e.message:String(e))}},[C]),O=Y(async()=>{try{let e=await m.uninstall();h(`规则区块：${e.rules}；已删除 ${e.workspaces_removed} 份任务板数据`),f(!1),r([])}catch(e){a(e instanceof Error?e.message:String(e))}},[]),k=e=>{let t=[`${e.node_count} 节点`];return Number.isInteger(e.requirement_count)&&t.push(`${e.requirement_count} 需求`),e.exec&&t.push(`进行中 ${e.exec.doing}`),e.verdict&&t.push(`待裁决 ${e.verdict.pending}`),t.join(` · `)};return J(c.Fragment,null,J(`section`,{className:`settings-section`},J(`h3`,{className:`settings-heading`},`迁移与备份`),J(`div`,{className:`ws-tools`},J(`button`,{type:`button`,className:`btn`,onClick:()=>void w(),disabled:b||!e},J(K,{name:`download`,size:14}),b?`导出中…`:`导出任务板`),J(`button`,{type:`button`,className:`btn`,onClick:()=>S.current?.click()},J(K,{name:`upload`,size:14}),`导入任务板`),J(`input`,{type:`file`,accept:`.json,application/json`,ref:S,style:{display:`none`},onChange:e=>void T(e)})),g?J(`div`,{className:`ws-import`},J(`div`,{className:`ws-import-file`},`待导入：${g.filename}`),J(`pre`,{className:`ws-import-summary`},oe(g.summary)),J(`div`,{className:`ws-warn`},`导入只允许写入空板；目标板非空会被拒绝。导入会整体写入树/详情/备注/基线。`),J(`div`,{className:`ws-confirm`},J(`button`,{type:`button`,className:`btn danger`,onClick:()=>void E(),disabled:v},v?`导入中…`:`确认导入`),J(`button`,{type:`button`,className:`btn`,onClick:()=>_(null),disabled:v},`取消`))):null),J(`section`,{className:`settings-section`},J(`h3`,{className:`settings-heading`},J(`span`,null,`本机任务板数据（${n?n.length:`…`}）`),J(`button`,{type:`button`,className:`link-btn`,onClick:()=>void C()},`刷新`)),J(`div`,{className:`settings-row hint`},`本机全部任务板数据（磁盘清理用），不是看板切换器；删除只清理数据目录，不动原项目文件。`),o?J(`div`,{className:`settings-row hint`},o):null,i?J(`div`,{className:`settings-row ws-error`},i):null,n?n.length===0?J(`div`,{className:`settings-row hint`},`本机暂无任务板数据`):n.map(e=>J(`div`,{key:e.workspace_id,className:`ws-row ${e.orphan?`orphan`:``}`},J(`div`,{className:`ws-main`},J(`span`,{className:`ws-name`,title:e.name},`${e.current?`● 当前 · `:``}${e.name}`),J(`span`,{className:`ws-meta`},k(e)),e.orphan?J(`span`,{className:`ws-orphan`},`路径已失效 · 可清理`):null),J(`div`,{className:`ws-path`,title:e.original_path??``},e.original_path??`(未知路径)`),l===e.workspace_id?J(`div`,{className:`ws-confirm`},J(`span`,{className:`ws-warn`},e.current?`这是当前会话正在使用的数据，删除后任务板将变为空板。数据目录将永久删除：`:`删除后该数据目录将永久删除（原项目文件不受影响）：`),J(`button`,{type:`button`,className:`btn danger`,onClick:()=>void D(e.workspace_id)},`确认清理`),J(`button`,{type:`button`,className:`btn`,onClick:()=>u(null)},`取消`)):J(`button`,{type:`button`,className:`link-btn ws-delete`,onClick:()=>u(e.workspace_id)},`清理`))):J(`div`,{className:`settings-row hint`},`加载中…`)),J(`section`,{className:`settings-section danger`},J(`h3`,{className:`settings-heading`},`危险区`),d?J(`div`,{className:`ws-confirm`},J(`span`,{className:`ws-warn`},`将永久清除：AGENTS.md 规则区块 + 全部 ${n?.length??0} 份任务板数据`),J(`button`,{type:`button`,className:`btn danger`,onClick:()=>void O()},`确认卸载`),J(`button`,{type:`button`,className:`btn`,onClick:()=>f(!1)},`取消`)):J(`button`,{type:`button`,className:`btn danger`,onClick:()=>f(!0)},J(K,{name:`trash`,size:14}),`卸载插件（自动清理）`),p?J(`div`,{className:`settings-row hint`},p):null))}function Xe({view:e,onView:t,query:n,onQuery:r,searching:i,matchCount:a,onRefresh:o,onOpenSettings:s}){return J(`div`,{className:`topbar`},J(`div`,{className:`view-tabs`,role:`group`,"aria-label":`视图`},h.map(n=>J(`button`,{key:n,type:`button`,className:`view-tab ${e===n?`on`:``}`,onClick:()=>t(n),"aria-pressed":e===n},Ke[n]))),J(`div`,{className:`topbar-tools`},J(`div`,{className:`search-box`},J(`span`,{className:`search-icon`},J(K,{name:`search`,size:14})),J(`input`,{type:`search`,className:`search-input`,placeholder:`搜索任务…`,value:n,"aria-label":`搜索任务`,onChange:e=>r(e.target.value),onKeyDown:e=>{e.key===`Escape`&&r(``)}}),i?J(`span`,{className:`search-count`},`${a} 项`):null),J(`button`,{type:`button`,className:`icon-btn`,title:`刷新`,onClick:o,"aria-label":`刷新`},J(K,{name:`refresh`})),J(`button`,{type:`button`,className:`icon-btn`,title:`设置`,onClick:s,"aria-label":`设置`},J(K,{name:`settings`}))))}function Ze({view:e,rememberExpand:t,onToggleRemember:n,diagnostics:r,cwd:i,onImported:a,onClose:o}){return J(Ue,{variant:`center`,onClose:o,label:`设置`,className:`settings-card`},J(We,{title:`设置`,subtitle:`偏好 · 备份 · 工作区管理`,onClose:o}),J(`div`,{className:`modal-body`},J(`section`,{className:`settings-section`},J(`h3`,{className:`settings-heading`},`偏好`),J(`div`,{className:`settings-row`},`视图偏好：全局固定（`,Ke[e],`）`),J(`label`,{className:`settings-row checkbox`},J(`input`,{type:`checkbox`,checked:t,onChange:e=>n(e.target.checked)}),`记住展开路径（按工作区）`)),r?J(`section`,{className:`settings-section`},J(`h3`,{className:`settings-heading`},`诊断`),J(`div`,{className:`settings-row diagnostics`},r)):null,J(Ye,{cwd:i,onImported:a}),J(`div`,{className:`settings-row hint`},`判断由 AI 完成，插件只展示`)),J(`div`,{className:`modal-foot`},J(`button`,{type:`button`,className:`btn`,onClick:o},`关闭`)))}function Qe({items:e,onJump:t}){return e.length===0?null:J(`div`,{className:`pinned`},J(`div`,{className:`pinned-title`},J(K,{name:`pin`,size:12}),`待裁决 ${e.length}`),J(`div`,{className:`pinned-list`},e.map(({node:e,path:n})=>J(`button`,{key:e.id,type:`button`,className:`pinned-row`,onClick:()=>t(e),title:e.human_line},J(`span`,{className:`pinned-path`,title:n.join(` › `)},n.join(` › `)||`—`),J(`span`,{className:`pinned-sep`},`›`),J(`span`,{className:`pinned-text`},e.human_line),J(Je,{label:`待裁决`,tone:`red`})))))}var $e=c.memo(function({row:e,expanded:t,onToggle:n,onOpenDetail:r,depth:i,currentSessionId:a,nowMs:o}){typeof window<`u`&&window.__DSH_COMPASS_PROFILE__&&(window.__DSH_COMPASS_ROW_RENDERS__=(window.__DSH_COMPASS_ROW_RENDERS__??0)+1);let{node:s,hasChildren:c}=e,l=w(s),u=s.kind===`requirement`?x(s):null,d=s.dead_reason,f=O(s,a,{now:o}),p=`tree-row depth-${i} kind-${s.kind}${s.exec_state===`已阻塞`?` exec-blocked`:``}`,m=s.exec_state===`进行中`?`exec-doing`:s.exec_state===`已执行`?`exec-done`:s.exec_state===`已阻塞`?`exec-blocked`:`exec-idle`;return J(`div`,{className:p,style:{paddingLeft:4+i*14}},J(`button`,{type:`button`,className:`row-toggle ${c?e.expanded?`open`:``:`leaf`}`,onClick:()=>c&&n(s.id),"aria-expanded":c?e.expanded:void 0,"aria-label":c?e.expanded?`收起`:`展开`:`详情`,tabIndex:c?0:-1},c?J(K,{name:`chevron`,size:12}):J(`span`,{className:`row-leaf-dot`})),J(`div`,{className:`row-main`,onClick:()=>r(s.id),role:`button`,tabIndex:0,"aria-label":s.human_line},J(`span`,{className:`row-dot ${m}`,title:`执行：${s.exec_state??`未开始`}`}),J(`span`,{className:`row-text ${s.verdict_state===`已废弃`||s.verdict_state===`已替代`?`struck`:``}`,title:s.human_line},s.human_line),u?J(`span`,{className:`row-counts`},S(u)):null,d?J(`span`,{className:`row-dead`,title:d},j(d,60)):null),J(`div`,{className:`row-badges`},f?J(`span`,{className:`ghost-mark`,title:f.note?`${k(f)}（${f.note}）`:k(f),"aria-label":`近期并发操作`},`👻`):null,l.map(e=>J(Je,{key:e.label,label:e.label,tone:e.tone})),J(`button`,{type:`button`,className:`row-detail-btn`,title:`详情`,onClick:e=>{e.stopPropagation(),r(s.id)}},`详情`)))},A);function et({rows:e,expanded:t,onToggle:n,onOpenDetail:r,currentSessionId:i,nowMs:a}){return e.length===0?null:J(`div`,{className:`tree`},e.map(e=>J($e,{key:e.node.id,row:e,signature:e.signature,expanded:t,onToggle:n,onOpenDetail:r,depth:e.depth,currentSessionId:i,nowMs:a})))}function $({kind:e,message:t,hint:n,onRetry:r,onCopyHint:i,retryLabel:a=`重试`}){return J(`div`,{className:`empty-state`},J(`div`,{className:`empty-icon`},J(K,{name:e===`error`?`alert`:`inbox`,size:36})),J(`div`,{className:`empty-title`},{uninitialized:`任务板尚未初始化`,empty:`任务板还是空的`,search:`无匹配`,loading:`加载中`,error:`读取失败`}[e]??`提示`),J(`div`,{className:`empty-message`},t),n?J(`div`,{className:`empty-hint`},n):null,J(`div`,{className:`empty-actions`},r?J(`button`,{type:`button`,className:`btn`,onClick:r},a):null,i?J(`button`,{type:`button`,className:`btn`,onClick:i},`复制提示`):null))}function tt({value:e,status:t,onChange:n}){return J(`div`,{className:`note-editor`},J(`textarea`,{className:`note-input`,value:e,placeholder:`写点备注…`,onChange:e=>n(e.target.value)}),J(`div`,{className:`note-status status-${t.state}`},t.state===`saving`?`保存中…`:t.state===`saved`?`已保存 ${t.savedAt}`:t.state===`error`?`保存失败：${t.message}`:t.state===`dirty`?`编辑中…`:`自动保存已开启`))}function nt({pointer:e,index:t,getSessionLinkState:n,hostSession:r,openSession:i,jumpToTurn:a,onJumpError:o,cwd:s}){let c=ge(e,t),l=H(typeof n==`function`?n(c.session):z.UNSUPPORTED,r?.exists),u=l!==z.AVAILABLE,d=l===z.AVAILABLE&&r?.targetSession&&r.targetSession!==c.session,f=c.turn===null?`打开原会话`:d?`跳到父会话对应轮次`:`跳到第 ${c.turn} 轮`,[p,m]=Q(``),h=async()=>{if(typeof a!=`function`){o?.(`宿主不支持会话跳转`);return}c.turn===null?m(`定位中…`):m(`定位第 ${c.turn} 轮…`);let t=null;try{t=await a({sessionId:c.session,turn:c.turn,at:e?.at??null,cwd:s})}catch(e){m(`跳转失败：${e instanceof Error?e.message:String(e)}`);return}let n=De(t,t?.plan??null);m(n||(t?.ok?`已定位并高亮`:`未能定位该轮次`)),t?.reason===`open-failed`&&o?.(`打开会话失败：宿主未提供会话跳转`)};return J(`div`,{key:c.key,className:`pointer-row ${u?`degraded`:``}`},J(`span`,{className:`pointer-at`},c.at||`时间未知`),c.turn===null?null:J(`span`,{className:`pointer-turn`},`第 ${c.turn} 轮`),J(`span`,{className:`pointer-note`,title:c.note},c.note),J(`span`,{className:`pointer-session`,title:c.session},l===z.FILE?c.session.replace(/#.*$/,``):c.shortSession),J(`span`,{className:`pointer-actions`},l===z.AVAILABLE?J(`button`,{type:`button`,className:`link-btn pointer-jump`,onClick:()=>void h()},f):J(`span`,{className:`pointer-degraded`},U(l)),u&&l!==z.FILE?J(`button`,{type:`button`,className:`link-btn`,title:`复制会话 id`,onClick:()=>navigator.clipboard?.writeText?.(c.session)},`复制 id`):null),p?J(`span`,{className:`pointer-jump-status`},p):null)}function rt({node:e,detail:t,noteState:n,onClose:r,onNoteChange:i,onCopy:a,copied:o,pathTitles:s,getSessionLinkState:c,openSession:l,jumpToTurn:u,fileAnchors:d,onOpenFile:f,collision:p,cwd:h}){let g=w(e),[_,v]=Q(``),[y,b]=Q(``),x=Array.isArray(e.pointers)?e.pointers:[],S=Array.isArray(d)?d:[],[C,T]=Q({}),[E,D]=Q(``),O=S.map(e=>e.path).join(`
`),[ee,A]=Q({}),j=[...new Set(x.map(e=>typeof e?.session==`string`?e.session:``).filter(e=>e&&B(e)))].join(`,`);return X(()=>{if(!h||!j)return;let e=!1;return(async()=>{try{let t=await m.sessionLinks(h,j.split(`,`)),n={};for(let e of t?.sessions??[])n[e.session]={exists:e.exists===!0,origin:e.origin??null,openable:e.openable!==!1,targetSession:e.target_session??null};e||A(n)}catch{}})(),()=>{e=!0}},[h,j]),X(()=>{if(!h||!O)return;let e=!1;return(async()=>{try{let t=await m.fileExists(h,O.split(`
`)),n={};for(let e of t?.results??[])n[e.path]=e.kind;e||(T(n),D(``))}catch{e||D(`无法检测文件是否存在（宿主版本过旧），点击仍会尝试打开`)}})(),()=>{e=!0}},[h,O]),J(Ue,{variant:`center`,onClose:r,label:`详情 ${e.id}`,className:`detail-card`},J(`div`,{className:`modal-head`},J(`div`,{className:`modal-head-text`},J(`div`,{className:`modal-title`},J(`span`,{className:`node-id`},e.id),J(`span`,null,e.title)),J(`div`,{className:`detail-meta`},J(`span`,{className:`meta-item`},`执行：`,e.exec_state),J(`span`,{className:`meta-item`},`裁决：`,e.verdict_state??`无`),g.filter(e=>e.tone!==`gray`).map(e=>J(Je,{key:e.label,label:e.label,tone:e.tone})),e.dead_reason?J(`span`,{className:`meta-item dead-reason`},`原因：`,e.dead_reason):null,J(`span`,{className:`meta-item path`,title:s.join(` › `)},`路径：`,s.join(` › `)))),J(`button`,{type:`button`,className:`icon-btn modal-close`,onClick:r,"aria-label":`关闭`,"data-autofocus":!0},J(K,{name:`close`}))),J(`div`,{className:`modal-body`},p?J(`div`,{className:`detail-collision`},J(K,{name:`alert`,size:14}),J(`span`,null,`${k(p)}${p.note?`（${p.note}）`:``}`)):null,J(`section`,{className:`detail-section`},J(`div`,{className:`col-title`},`追溯链（${x.length}）`),x.length===0?J(`div`,{className:`pointer-empty`},`（暂无追溯记录）`):J(`div`,{className:`pointer-list`},x.map((e,t)=>J(nt,{key:`${e?.at??``}#${t}`,pointer:e,index:t,getSessionLinkState:c,hostSession:ee[e?.session]??void 0,openSession:l,jumpToTurn:u,cwd:h,onJumpError:v}))),_?J(`div`,{className:`pointer-error`},_):null),S.length>0?J(`section`,{className:`detail-section`},J(`div`,{className:`col-title`},`文件锚点（${S.length}）`),J(`div`,{className:`file-chips`},S.map(e=>{let t=C[e.path],n=t===`missing`,r=t===`unknown`;return J(`button`,{key:`${e.path}#${e.line??``}`,type:`button`,className:`file-chip ${n?`missing`:``} ${r?`unknown`:``}`.trim(),title:n?`路径不存在：${e.path}（点击复制路径）`:r?`无法检测：${e.path}（点击尝试打开）`:`打开 ${e.path}${e.line?` 第 ${e.line} 行`:``}`,onClick:()=>{n?(navigator.clipboard?.writeText?.(e.path),b(`路径不存在，已复制：${e.path}`)):f?.(e)?b(``):b(`宿主不支持直接打开，已复制路径：${e.path}`)}},J(K,{name:`file`,size:12}),`${e.path}${e.line?`:${e.line}`:``}`)})),y?J(`div`,{className:`file-hint`},y):null,E?J(`div`,{className:`file-hint`},E):null):null,J(`div`,{className:`detail-body`},J(`div`,{className:`detail-col detail-ai`},J(`div`,{className:`col-title`},`详情（AI 写，只读）`),J(`pre`,{className:`detail-text`},t||`（暂无详情）`)),J(`div`,{className:`detail-col detail-note`},J(`div`,{className:`col-title`},`备注（可编辑）`),J(tt,{value:n.text,status:n.status,onChange:i})))),J(`div`,{className:`modal-foot`},J(`button`,{type:`button`,className:`btn primary`,onClick:a},J(K,{name:o?`check`:`copy`,size:14}),o?`已复制 ✓`:`复制交接内容`),J(`button`,{type:`button`,className:`btn`,onClick:r},`关闭`)))}function it({lastUpdated:e,pollingOn:t,dirty:n,onRefresh:r,workspaceLabel:i,boardBehind:a,blocked:o}){return J(`div`,{className:`statusbar`},i?J(`span`,{className:`status-item workspace`,title:i},i):null,J(`span`,{className:`status-item updated`},e?`最后更新 ${e}`:`尚未加载`),J(`span`,{className:`status-item poll`,title:t?`每 ${Ae/1e3}s 自动刷新`:`已暂停刷新`},J(`span`,{className:`poll-dot ${t?``:`off`}`}),t?`每 ${Ae/1e3}s 自动刷新`:`已暂停刷新`),o>0?J(`span`,{className:`status-item blocked-count`,title:`执行态为「已阻塞」的任务数（等第三方/等确认/被卡住，需要人工介入；仅机械计数）`},`阻塞 ${o}`):null,a>0?J(`span`,{className:`status-item board-behind`,title:`板面在最近这些轮次里没有更新；仅提示，不阻塞（B-32）`},`板面 ${a} 轮未落板`):null,n?J(`button`,{type:`button`,className:`link-btn dirty`,onClick:r},`有更新，点击刷新`):null,J(`button`,{type:`button`,className:`link-btn status-refresh`,onClick:r},`手动刷新`))}function at(e){let t=Pe(),n=Ge(null);Ie(n);let r=(e.useTabInfo?e.useTabInfo():null)?.tab?.visible!==!1,[i,a]=Q(null),[o,s]=Q(null),[c,l]=Q(null),[d,f]=Q(!1),[p,h]=Q(`current`),[g,_]=Q(!1),[v,b]=Q({}),[x,S]=Q(null),[w,T]=Q(null),[E,D]=Q({text:``,status:{state:`idle`}}),[k,A]=Q(null),[j,te]=Q(!1),[ne,M]=Q(!1),[oe,N]=Q(!1),[P,se]=Q(``),[ce,F]=Q(null),[le,I]=Q(()=>Date.now()),[L,de]=Q({});X(()=>{let e=window.setInterval(()=>I(Date.now()),6e4);return()=>window.clearInterval(e)},[]);let R=Z(()=>x&&o?ot(o,x):null,[x,o]),fe=Z(()=>R?O(R,e.sessionId):null,[R,e.sessionId]),z=Z(()=>R?pe(`${w?.detail??``}\n${E.text??``}`):[],[w,R,E.text]),B=E.status.state===`saving`||E.status.state===`dirty`,V=i?.cwd,H=Y(e=>{let t=e instanceof u||e instanceof Error?e.message:String(e);A({message:t})},[]),U=Y(async(e,t={})=>{if(e)try{let n=await m.tree(e,t.ifmtime);if(n.changed===!1)return;s(n.tree),l(n.mtimeMs),f(!0),A(null),t.keepDirty||te(!1)}catch(e){H(e)}},[H]);X(()=>{let t=!1;return(async()=>{try{let n=e.projectRoot,r=e.sessionId,i=n&&/^[A-Za-z]:[\\/]|^\//.test(n)?await m.current({cwd:n}):r?await m.current({sessionId:r}):await m.current();if(t)return;a(i);let[o,s]=await Promise.all([m.getPrefs().catch(()=>null),m.getUiState(i.cwd).catch(()=>null)]);if(t)return;let c=Oe(o??{});h(c.view),_(s?.rememberExpand===!0),b(s?.rememberExpand===!0?s?.expanded??{}:{}),await U(i.cwd);let l=await m.status(i.cwd,e.sessionId).catch(()=>null);!t&&l&&F(l)}catch(e){t||H(e)}})(),()=>{t=!0}},[H,U]),X(()=>{if(!V)return;let t=window.setInterval(()=>{je({tabVisible:r,docVisible:document.visibilityState===`visible`,editing:B})&&(m.status(V,e.sessionId).then(e=>F(e)).catch(()=>{}),(async()=>{try{let e=c,t=await m.tree(V,e??void 0);if(t.changed===!1)return;B?te(!0):(s(t.tree),l(t.mtimeMs))}catch{}})())},Ae);return()=>window.clearInterval(t)},[V,c,B,r,e.sessionId]),X(()=>{let e=()=>{document.visibilityState===`visible`&&V&&U(V,{ifmtime:c??void 0})};return document.addEventListener(`visibilitychange`,e),()=>document.removeEventListener(`visibilitychange`,e)},[V,U,c]);let me=Y(e=>{h(e),m.putPrefs({view:e}).catch(()=>{})},[]),he=Y(e=>{b(t=>{let n=ke(t,e);return g&&V&&m.putUiState(V,{expanded:n,rememberExpand:!0}).catch(()=>{}),n})},[V,g]),ge=Y(e=>{_(e),V&&m.putUiState(V,{expanded:e?v:{},rememberExpand:e}).catch(()=>{})},[V,v]),_e=Y(async e=>{if(!e||L[e]!==void 0)return L[e];try{let t=(await m.baseline(V,e))?.surface??null;return de(n=>({...n,[e]:t})),t}catch{return de(t=>({...t,[e]:null})),null}},[L,V]),W=Y(async e=>{S(e),T(null),N(!1);try{let t=await m.detail(V,e);T(t),D({text:t.note??``,status:{state:`idle`}})}catch(e){H(e),S(null)}},[V,H]),ve=Ge(0),ye=Y(t=>{x&&V&&(D(e=>({text:t,status:{state:`dirty`}})),window.clearTimeout(ve.current),ve.current=window.setTimeout(async()=>{D(e=>({text:e.text,status:{state:`saving`}}));try{await m.saveNote(V,x,t,e.sessionId),D(e=>({text:e.text,status:{state:`saved`,savedAt:new Date().toLocaleTimeString(`zh-CN`,{hour12:!1})}})),U(V,{ifmtime:c??void 0})}catch(e){let t=e instanceof Error?e.message:String(e);D(e=>({text:e.text,status:{state:`error`,message:t}}))}},500))},[V,x,U,c,e.sessionId]),be=Y(t=>{let n=e.sessionId;if(!n||!t?.path)return!1;let r=ue(n,i?.cwd,t.path),a=typeof e.openResource==`function`&&e.openResource(r,t.line?{params:{line:t.line}}:void 0);if(!a)try{navigator.clipboard?.writeText?.(t.path)}catch{}return!!a},[e.openResource,e.sessionId,i]),xe=Y(async()=>{if(!R)return;let e=R,t=ae(e.id),n=null;t&&(n=await _e(t));let r=ie(e,[...w?.pathTitles??[e.human_line]],t?{id:t,surface:n}:null,w?.detail??``,E.text);try{await navigator.clipboard.writeText(r),N(!0),window.setTimeout(()=>N(!1),1500)}catch{N(!1)}},[w,R,E.text,_e]),Se=Y(e=>{b(t=>({...t,[e.id]:!0})),W(e.id)},[W]),G=Z(()=>o?re(o,p,v,P):{rows:[],matchCount:0,searching:!1},[o,p,v,P]),Ce=Z(()=>G.rows.map(t=>({...t,signature:ee(t,{currentSessionId:e.sessionId})})),[G.rows,e.sessionId]),we=Z(()=>o?y(o):[],[o]),Te=Z(()=>o?C(o):null,[o]);if(k)return J(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},J($,{kind:`error`,message:k.message,onRetry:()=>{A(null),V&&U(V)}}));if(!i)return J(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},J($,{kind:`loading`,message:`加载任务板…`}));let Ee=R?st(o,R.id):[];return J(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},J(Xe,{view:p,onView:me,query:P,onQuery:se,searching:G.searching,matchCount:G.matchCount,onRefresh:()=>V&&void U(V),onOpenSettings:()=>M(!0)}),J(Qe,{items:we,onJump:Se}),d&&o&&(o.root?.children?.length??0)===0?J($,{kind:`empty`,message:`任务板还是空的。`,hint:`让 AI 用 compass_require 建第一条需求，再用 compass_plan 拆任务。`,onCopyHint:()=>navigator.clipboard.writeText(`请用 compass_require 建第一条需求，再用 compass_plan 拆任务。`)}):d&&G.searching&&Ce.length===0?J($,{kind:`search`,message:`当前视图无匹配：${P}`,hint:`可切到「完整轨迹」再搜，或清空搜索。`,onRetry:()=>se(``),retryLabel:`清空搜索`}):d?J(et,{rows:Ce,expanded:v,onToggle:he,onOpenDetail:W,currentSessionId:e.sessionId,nowMs:le}):J($,{kind:`loading`,message:`加载任务板…`}),J(it,{workspaceLabel:i?.cwd?i.cwd.split(/[\\/]/).filter(Boolean).pop():null,lastUpdated:c?new Date(c).toLocaleTimeString(`zh-CN`,{hour12:!1}):null,pollingOn:je({tabVisible:r,docVisible:document.visibilityState===`visible`,editing:B}),dirty:j,boardBehind:ce?.turns_since_board_update??0,blocked:Te?Te.已阻塞:0,onRefresh:()=>V&&void U(V)}),ne?J(Ze,{view:p,rememberExpand:g,onToggleRemember:ge,cwd:V,onImported:()=>{V&&U(V)},diagnostics:i.dataDir?`data: ${i.dataDir}\n多窗口并发保护：已启用（写锁 + 版本校验）`:null,onClose:()=>M(!1)}):null,x&&R?J(rt,{node:R,detail:w?.detail??``,noteState:E,onClose:()=>S(null),onNoteChange:ye,onCopy:xe,copied:oe,pathTitles:Ee,getSessionLinkState:e.getSessionLinkState,openSession:e.openSession,jumpToTurn:e.jumpToTurn,fileAnchors:z,onOpenFile:be,collision:fe,cwd:V}):null)}function ot(e,t){let n=null,r=e=>{e.id===t&&(n=e);for(let t of e.children??[])r(t)};for(let t of e?.root?.children??[])r(t);return n}function st(e,t){let n=[],r=(e,i)=>{if(e.id===t)return n.push(...i,e.human_line),!0;for(let t of e.children??[])if(r(t,[...i,e.human_line]))return!0;return!1};for(let t of e?.root?.children??[])r(t,[]);return n}var ct=`/* ==========================================================================
   dsh-compass 面板与弹窗样式（契约 v1.23 §8.18/§8.19，B-51/B-52）
   - 作用域：面板 .dsh-compass-root（C-6）；弹窗 .dsh-compass-portal（portal 到 body）
   - 设计令牌集中在两者共用的 :where() 变量块，明暗跟随宿主 data-theme（C-3）
   - 面板根启用 container query，按自身宽度重排；弹窗按视口宽度响应
   ========================================================================== */

/* ---------- 设计令牌 ---------- */
:where(.dsh-compass-root, .dsh-compass-portal) {
  --compass-bg: var(--dsh-bg, #ffffff);
  --compass-card: var(--dsh-bg-elevated, #ffffff);
  --compass-secondary: var(--dsh-bg-secondary, #f4f5f7);
  --compass-fg: var(--dsh-fg, #1f2329);
  --compass-muted: var(--dsh-fg-muted, #8a8f98);
  --compass-border: var(--dsh-border, rgba(0, 0, 0, 0.08));
  --compass-border-strong: rgba(0, 0, 0, 0.14);
  --compass-accent: var(--dsh-accent, #3b82f6);
  --compass-accent-strong: #2563eb;
  --compass-ok: #16a34a;
  --compass-warn: #dc2626;
  --compass-amber: #b45309;
  --compass-orange: #ea580c;
  --compass-hover: rgba(0, 0, 0, 0.045);
  --compass-active: rgba(0, 0, 0, 0.08);
  --compass-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --compass-shadow-lg: 0 24px 64px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(15, 23, 42, 0.08);
  --compass-radius-sm: 6px;
  --compass-radius: 8px;
  --compass-radius-lg: 14px;
  --compass-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}

:where(.dsh-compass-root, .dsh-compass-portal)[data-theme="dark"] {
  --compass-bg: var(--dsh-bg, #15171c);
  --compass-card: var(--dsh-bg-elevated, #1c1f26);
  --compass-secondary: var(--dsh-bg-secondary, #22262e);
  --compass-fg: var(--dsh-fg, #e6e8ec);
  --compass-muted: var(--dsh-fg-muted, #9aa0aa);
  --compass-border: var(--dsh-border, rgba(255, 255, 255, 0.09));
  --compass-border-strong: rgba(255, 255, 255, 0.16);
  --compass-accent-strong: #60a5fa;
  --compass-ok: #4ade80;
  --compass-warn: #f87171;
  --compass-amber: #fbbf24;
  --compass-orange: #fb923c;
  --compass-hover: rgba(255, 255, 255, 0.06);
  --compass-active: rgba(255, 255, 255, 0.1);
  --compass-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --compass-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0, 0, 0, 0.4);
}

/* ---------- 面板根 ---------- */
.dsh-compass-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--compass-bg);
  color: var(--compass-fg);
  font-size: 13px;
  line-height: 1.45;
  container-type: inline-size;
  container-name: compass;
}

.dsh-compass-portal {
  font-size: 13px;
  line-height: 1.45;
  color: var(--compass-fg);
}

:where(.dsh-compass-root, .dsh-compass-portal) :where(button, input, select, textarea) {
  font: inherit;
}
:where(.dsh-compass-root, .dsh-compass-portal) :where(button, a, input, select, textarea):focus-visible {
  outline: 2px solid var(--compass-accent);
  outline-offset: 1px;
}
:where(.dsh-compass-root, .dsh-compass-portal) .icon {
  display: block;
  flex: none;
}

/* ---------- 通用控件 ---------- */
:where(.dsh-compass-root, .dsh-compass-portal) .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--compass-border-strong);
  background: var(--compass-card);
  color: var(--compass-fg);
  padding: 5px 14px;
  border-radius: var(--compass-radius);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
:where(.dsh-compass-root, .dsh-compass-portal) .btn:hover { background: var(--compass-secondary); }
:where(.dsh-compass-root, .dsh-compass-portal) .btn:disabled { opacity: 0.55; cursor: default; }
:where(.dsh-compass-root, .dsh-compass-portal) .btn.primary {
  background: var(--compass-accent);
  border-color: var(--compass-accent);
  color: #fff;
  box-shadow: var(--compass-shadow-sm);
}
:where(.dsh-compass-root, .dsh-compass-portal) .btn.primary:hover { background: var(--compass-accent-strong); border-color: var(--compass-accent-strong); }
:where(.dsh-compass-root, .dsh-compass-portal) .btn.danger {
  border-color: color-mix(in srgb, var(--compass-warn) 45%, transparent);
  color: var(--compass-warn);
}
:where(.dsh-compass-root, .dsh-compass-portal) .btn.danger:hover {
  background: color-mix(in srgb, var(--compass-warn) 8%, transparent);
}

:where(.dsh-compass-root, .dsh-compass-portal) .icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--compass-muted);
  cursor: pointer;
  border-radius: 7px;
  transition: background 120ms ease, color 120ms ease;
}
:where(.dsh-compass-root, .dsh-compass-portal) .icon-btn:hover { background: var(--compass-hover); color: var(--compass-fg); }
:where(.dsh-compass-root, .dsh-compass-portal) .icon-btn.on { background: color-mix(in srgb, var(--compass-accent) 12%, transparent); color: var(--compass-accent); }

:where(.dsh-compass-root, .dsh-compass-portal) .link-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  font-size: 11px;
  color: var(--compass-accent);
  text-decoration: none;
  white-space: nowrap;
}
:where(.dsh-compass-root, .dsh-compass-portal) .link-btn:hover { text-decoration: underline; }
:where(.dsh-compass-root, .dsh-compass-portal) .link-btn.dirty { color: var(--compass-warn); }

/* ---------- 顶栏：分段视图 + 工具行 ---------- */
.dsh-compass-root .topbar {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--compass-border);
}
.dsh-compass-root .view-tabs {
  display: flex;
  gap: 2px;
  background: var(--compass-secondary);
  border-radius: var(--compass-radius);
  padding: 2px;
}
.dsh-compass-root .view-tab {
  flex: 1 1 0;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--compass-muted);
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 120ms ease, color 120ms ease;
}
.dsh-compass-root .view-tab:hover { color: var(--compass-fg); }
.dsh-compass-root .view-tab.on {
  color: var(--compass-fg);
  background: var(--compass-card);
  box-shadow: var(--compass-shadow-sm);
  font-weight: 500;
}
.dsh-compass-root .topbar-tools { display: flex; align-items: center; gap: 4px; }
.dsh-compass-root .search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}
.dsh-compass-root .search-icon {
  position: absolute;
  left: 8px;
  color: var(--compass-muted);
  pointer-events: none;
  display: flex;
}
.dsh-compass-root .search-input {
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  background: var(--compass-secondary);
  color: var(--compass-fg);
  border-radius: var(--compass-radius);
  padding: 5px 8px 5px 28px;
  font-size: 12px;
  transition: border-color 120ms ease, background 120ms ease;
}
.dsh-compass-root .search-input::placeholder { color: var(--compass-muted); }
.dsh-compass-root .search-input:focus { outline: none; border-color: var(--compass-accent); background: var(--compass-card); }
.dsh-compass-root .search-count {
  position: absolute;
  right: 8px;
  font-size: 11px;
  color: var(--compass-muted);
  background: var(--compass-secondary);
  border-radius: 999px;
  padding: 0 6px;
  pointer-events: none;
}

/* ---------- 钉顶区（待裁决） ---------- */
.dsh-compass-root .pinned {
  flex: none;
  border-bottom: 1px solid var(--compass-border);
  padding: 8px 10px 6px;
  background: color-mix(in srgb, var(--compass-warn) 3%, transparent);
}
.dsh-compass-root .pinned-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--compass-warn);
  margin-bottom: 4px;
}
.dsh-compass-root .pinned-list { max-height: 216px; overflow: auto; scrollbar-width: thin; }
.dsh-compass-root .pinned-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 5px 6px;
  border-radius: var(--compass-radius-sm);
  cursor: pointer;
  color: var(--compass-fg);
}
.dsh-compass-root .pinned-row:hover { background: color-mix(in srgb, var(--compass-warn) 7%, transparent); }
.dsh-compass-root .pinned-path { color: var(--compass-muted); font-size: 11px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: none; }
.dsh-compass-root .pinned-sep { color: var(--compass-muted); flex: none; }
.dsh-compass-root .pinned-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 任务树 ---------- */
.dsh-compass-root .tree {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px 6px 10px;
  scrollbar-width: thin;
}
.dsh-compass-root .tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px;
  min-height: 30px;
  border-radius: var(--compass-radius-sm);
}
.dsh-compass-root .tree-row:hover { background: var(--compass-hover); }
.dsh-compass-root .row-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--compass-muted);
  width: 18px;
  height: 20px;
  flex: none;
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
}
.dsh-compass-root .row-toggle:hover { color: var(--compass-fg); background: var(--compass-active); }
.dsh-compass-root .row-toggle .icon { transition: transform 140ms ease; }
.dsh-compass-root .row-toggle.open .icon { transform: rotate(90deg); }
.dsh-compass-root .row-toggle.leaf { cursor: default; }
.dsh-compass-root .row-toggle.leaf:hover { background: transparent; }
.dsh-compass-root .row-leaf-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--compass-border-strong); }
.dsh-compass-root .row-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  overflow: hidden;
}
.dsh-compass-root .row-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--compass-muted);
}
.dsh-compass-root .row-dot.exec-doing { background: var(--compass-accent); }
.dsh-compass-root .row-dot.exec-done { background: var(--compass-ok); }
.dsh-compass-root .row-dot.exec-blocked { background: var(--compass-amber); }
.dsh-compass-root .row-dot.exec-idle { background: transparent; border: 1.5px solid var(--compass-border-strong); width: 5px; height: 5px; }
.dsh-compass-root .row-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.dsh-compass-root .kind-requirement > .row-main .row-text { font-weight: 600; font-size: 12.5px; }
.dsh-compass-root .row-text.struck { text-decoration: line-through; color: var(--compass-muted); }
.dsh-compass-root .row-counts { color: var(--compass-muted); font-size: 11px; flex: none; }
.dsh-compass-root .row-dead { color: var(--compass-muted); font-size: 11px; font-style: italic; flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-compass-root .row-badges { display: flex; gap: 4px; align-items: center; flex: none; }
.dsh-compass-root .row-detail-btn {
  border: none;
  background: transparent;
  color: var(--compass-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 5px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.dsh-compass-root .tree-row:hover .row-detail-btn { opacity: 1; }
.dsh-compass-root .row-detail-btn:hover { background: var(--compass-active); color: var(--compass-fg); }

/* 已阻塞（B-45）：琥珀色左缘 + 文本着色 */
.dsh-compass-root .tree-row.exec-blocked { box-shadow: inset 2px 0 0 var(--compass-amber); }
.dsh-compass-root .tree-row.exec-blocked > .row-main .row-text { color: var(--compass-amber); }

/* 跨会话撞车警示（B-48）：极小幽灵标 */
.dsh-compass-root .ghost-mark { font-size: 11px; line-height: 1; opacity: 0.8; cursor: help; padding: 0 2px; }

/* ---------- 徽标（柔和底色） ---------- */
:where(.dsh-compass-root, .dsh-compass-portal) .badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  line-height: 16px;
  white-space: nowrap;
  flex: none;
}
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-gray { color: var(--compass-muted); background: var(--compass-secondary); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-blue { color: var(--compass-accent); background: color-mix(in srgb, var(--compass-accent) 12%, transparent); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-green { color: var(--compass-ok); background: color-mix(in srgb, var(--compass-ok) 12%, transparent); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-red { color: var(--compass-warn); background: color-mix(in srgb, var(--compass-warn) 10%, transparent); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-orange { color: var(--compass-orange); background: color-mix(in srgb, var(--compass-orange) 12%, transparent); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-yellow { color: var(--compass-amber); background: color-mix(in srgb, var(--compass-amber) 12%, transparent); }
:where(.dsh-compass-root, .dsh-compass-portal) .badge.tone-muted { color: var(--compass-muted); background: var(--compass-secondary); text-decoration: line-through; }

/* ---------- 空态 / 错误态 ---------- */
.dsh-compass-root .empty-state {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  color: var(--compass-muted);
  text-align: center;
  gap: 4px;
}
.dsh-compass-root .empty-icon { color: var(--compass-border-strong); margin-bottom: 8px; }
.dsh-compass-root .empty-title { font-size: 14px; font-weight: 600; color: var(--compass-fg); margin-bottom: 4px; }
.dsh-compass-root .empty-message { margin-bottom: 4px; overflow-wrap: anywhere; max-width: 100%; }
.dsh-compass-root .empty-hint { font-size: 12px; margin-bottom: 12px; overflow-wrap: anywhere; }
.dsh-compass-root .empty-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

/* ---------- 状态条 ---------- */
.dsh-compass-root .statusbar {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 5px 10px;
  border-top: 1px solid var(--compass-border);
  font-size: 11px;
  color: var(--compass-muted);
}
.dsh-compass-root .status-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dsh-compass-root .status-item.workspace { min-width: 0; max-width: 38%; overflow: hidden; text-overflow: ellipsis; display: inline-block; white-space: nowrap; }
.dsh-compass-root .status-item .poll-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--compass-ok); flex: none; }
.dsh-compass-root .status-item .poll-dot.off { background: var(--compass-border-strong); }
.dsh-compass-root .statusbar .link-btn { color: var(--compass-accent); }
.dsh-compass-root .statusbar .board-behind { color: var(--compass-warn); }
.dsh-compass-root .status-item.blocked-count { color: var(--compass-amber); font-weight: 600; }
.dsh-compass-root .statusbar .status-refresh { margin-left: auto; }

/* ==========================================================================
   弹窗体系（portal → body，B-51）
   ========================================================================== */
.dsh-compass-portal .modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  padding: 24px;
  animation: compass-fade 150ms ease-out;
}
.dsh-compass-portal .modal-overlay.center { align-items: center; justify-content: center; }
.dsh-compass-portal .modal-overlay.drawer { align-items: stretch; justify-content: flex-end; padding: 0; }

.dsh-compass-portal .modal-card {
  display: flex;
  flex-direction: column;
  width: min(880px, 100%);
  max-width: 100%;
  max-height: min(84vh, 940px);
  min-height: 0;
  background: var(--compass-card);
  color: var(--compass-fg);
  border: 1px solid var(--compass-border);
  border-radius: var(--compass-radius-lg);
  box-shadow: var(--compass-shadow-lg);
  overflow: hidden;
  outline: none;
  animation: compass-pop 180ms ease-out;
}
.dsh-compass-portal .modal-card.settings-card { width: min(680px, 100%); }
.dsh-compass-portal .modal-card.drawer-card {
  width: min(480px, 100vw);
  max-height: none;
  height: 100%;
  border-radius: 0;
  border-top: none;
  border-bottom: none;
  border-right: none;
  animation: compass-slide 200ms ease-out;
}

.dsh-compass-portal .modal-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--compass-border);
}
.dsh-compass-portal .modal-head-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-compass-portal .modal-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  overflow-wrap: anywhere;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-compass-portal .modal-subtitle { font-size: 12px; color: var(--compass-muted); overflow-wrap: anywhere; }
.dsh-compass-portal .modal-close { margin: -4px -6px 0 0; }
.dsh-compass-portal .modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 20px;
  scrollbar-width: thin;
}
.dsh-compass-portal .modal-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-top: 1px solid var(--compass-border);
}
.dsh-compass-portal .modal-foot .foot-hint { margin-right: auto; font-size: 11px; color: var(--compass-muted); overflow-wrap: anywhere; }

@keyframes compass-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes compass-pop {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes compass-slide {
  from { opacity: 0.4; transform: translateX(32px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-compass-portal .modal-overlay,
  .dsh-compass-portal .modal-card { animation: none !important; }
  :where(.dsh-compass-root, .dsh-compass-portal) * { transition: none !important; }
}

/* ---------- 详情弹窗 ---------- */
.dsh-compass-portal .node-id {
  font-family: var(--compass-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--compass-muted);
  background: var(--compass-secondary);
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
}
.dsh-compass-portal .detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  font-size: 12px;
  color: var(--compass-muted);
}
.dsh-compass-portal .detail-meta .meta-item { display: inline-flex; align-items: center; gap: 4px; }
.dsh-compass-portal .detail-meta .meta-item.path { overflow-wrap: anywhere; }
.dsh-compass-portal .meta-item.dead-reason { color: var(--compass-warn); }
.dsh-compass-portal .detail-collision {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--compass-amber);
  background: color-mix(in srgb, var(--compass-amber) 9%, transparent);
  border-radius: var(--compass-radius);
  padding: 8px 12px;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}
.dsh-compass-portal .detail-section { margin-bottom: 16px; }
.dsh-compass-portal .col-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--compass-muted);
  margin-bottom: 8px;
}

/* 追溯链 */
.dsh-compass-portal .pointer-list { display: flex; flex-direction: column; }
.dsh-compass-portal .pointer-row {
  display: flex;
  gap: 4px 10px;
  align-items: baseline;
  flex-wrap: wrap;
  font-size: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--compass-border);
}
.dsh-compass-portal .pointer-row:last-child { border-bottom: none; }
.dsh-compass-portal .pointer-row.degraded { color: var(--compass-muted); }
.dsh-compass-portal .pointer-at { color: var(--compass-muted); font-family: var(--compass-mono); font-size: 11px; flex: none; }
.dsh-compass-portal .pointer-turn { color: var(--compass-muted); font-size: 11px; flex: none; }
.dsh-compass-portal .pointer-note { flex: 1 1 160px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-compass-portal .pointer-session {
  color: var(--compass-muted);
  font-family: var(--compass-mono);
  font-size: 11px;
  max-width: 32%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: none;
}
.dsh-compass-portal .pointer-actions { display: inline-flex; gap: 8px; align-items: baseline; flex: none; }
.dsh-compass-portal .pointer-degraded { color: var(--compass-muted); font-size: 11px; }
.dsh-compass-portal .pointer-jump-status { flex: 1 1 100%; font-size: 11px; color: var(--compass-accent); }
.dsh-compass-portal .pointer-empty { font-size: 12px; color: var(--compass-muted); }
.dsh-compass-portal .pointer-error { margin-top: 6px; font-size: 12px; color: var(--compass-warn); overflow-wrap: anywhere; }

/* 文件锚点 */
.dsh-compass-portal .file-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-compass-portal .file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--compass-mono);
  font-size: 11px;
  color: var(--compass-accent);
  background: color-mix(in srgb, var(--compass-accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--compass-accent) 22%, transparent);
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background 120ms ease;
}
.dsh-compass-portal .file-chip:hover { background: color-mix(in srgb, var(--compass-accent) 16%, transparent); }
.dsh-compass-portal .file-chip.missing {
  color: var(--compass-muted);
  background: transparent;
  border-color: var(--compass-border-strong);
  border-style: dashed;
  text-decoration: line-through;
}
.dsh-compass-portal .file-chip.missing:hover { background: var(--compass-hover); color: var(--compass-fg); }
.dsh-compass-portal .file-chip.unknown {
  color: var(--compass-amber);
  background: transparent;
  border-color: color-mix(in srgb, var(--compass-amber) 40%, transparent);
  border-style: dashed;
}
.dsh-compass-portal .file-hint { margin-top: 6px; font-size: 12px; color: var(--compass-muted); overflow-wrap: anywhere; }
.dsh-compass-portal .file-hint.warn { color: var(--compass-warn); }

/* 双栏正文 */
.dsh-compass-portal .detail-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  min-height: 200px;
}
.dsh-compass-portal .detail-col { min-width: 0; display: flex; flex-direction: column; }
.dsh-compass-portal .detail-text {
  flex: 1 1 auto;
  font-family: var(--compass-mono);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--compass-fg);
  background: var(--compass-secondary);
  border-radius: var(--compass-radius);
  padding: 12px;
  min-height: 160px;
}
.dsh-compass-portal .note-editor { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-height: 0; }
.dsh-compass-portal .note-input {
  flex: 1 1 auto;
  min-height: 160px;
  resize: vertical;
  font-size: 12px;
  line-height: 1.6;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: var(--compass-radius);
  background: var(--compass-secondary);
  color: var(--compass-fg);
  transition: border-color 120ms ease, background 120ms ease;
}
.dsh-compass-portal .note-input:focus { outline: none; border-color: var(--compass-accent); background: var(--compass-card); }
.dsh-compass-portal .note-status { font-size: 11px; color: var(--compass-muted); }
.dsh-compass-portal .note-status.status-error { color: var(--compass-warn); }
.dsh-compass-portal .note-status.status-saving { color: var(--compass-accent); }
.dsh-compass-portal .note-status.status-saved { color: var(--compass-ok); }

/* ---------- 设置弹窗 ---------- */
.dsh-compass-portal .settings-section { margin-bottom: 20px; }
.dsh-compass-portal .settings-section:last-child { margin-bottom: 4px; }
.dsh-compass-portal .settings-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--compass-fg);
}
.dsh-compass-portal .settings-row { padding: 3px 0; color: var(--compass-muted); font-size: 12px; overflow-wrap: anywhere; }
.dsh-compass-portal .settings-row.checkbox { display: flex; gap: 8px; align-items: center; color: var(--compass-fg); cursor: pointer; }
.dsh-compass-portal .settings-row.checkbox input { accent-color: var(--compass-accent); width: 14px; height: 14px; margin: 0; }
.dsh-compass-portal .settings-row.diagnostics { font-family: var(--compass-mono); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--compass-secondary); border-radius: var(--compass-radius); padding: 10px 12px; }
.dsh-compass-portal .settings-row.hint { color: var(--compass-muted); }
.dsh-compass-portal .ws-error { color: var(--compass-warn); font-size: 12px; }
.dsh-compass-portal .ws-tools { display: flex; gap: 8px; flex-wrap: wrap; }
.dsh-compass-portal .ws-import {
  border: 1px solid var(--compass-border);
  border-radius: var(--compass-radius);
  padding: 10px 12px;
  margin: 10px 0 0;
  background: var(--compass-secondary);
}
.dsh-compass-portal .ws-import-file { font-size: 12px; color: var(--compass-fg); overflow-wrap: anywhere; }
.dsh-compass-portal .ws-import-summary {
  font-family: var(--compass-mono);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0;
  color: var(--compass-muted);
}
.dsh-compass-portal .ws-row { padding: 10px 0; border-bottom: 1px solid var(--compass-border); }
.dsh-compass-portal .ws-row:last-child { border-bottom: none; }
.dsh-compass-portal .ws-row.orphan .ws-name { color: var(--compass-muted); }
.dsh-compass-portal .ws-main { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-compass-portal .ws-name { font-size: 12px; color: var(--compass-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%; }
.dsh-compass-portal .ws-meta { font-size: 11px; color: var(--compass-muted); }
.dsh-compass-portal .ws-orphan {
  font-size: 11px;
  color: var(--compass-amber);
  background: color-mix(in srgb, var(--compass-amber) 10%, transparent);
  border-radius: 999px;
  padding: 0 8px;
  white-space: nowrap;
}
.dsh-compass-portal .ws-path { font-size: 11px; color: var(--compass-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.dsh-compass-portal .ws-confirm { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.dsh-compass-portal .ws-warn { color: var(--compass-warn); font-size: 12px; overflow-wrap: anywhere; }
.dsh-compass-portal .ws-delete { margin-top: 4px; display: inline-block; }
.dsh-compass-portal .settings-section.danger {
  border: 1px solid color-mix(in srgb, var(--compass-warn) 30%, transparent);
  background: color-mix(in srgb, var(--compass-warn) 4%, transparent);
  border-radius: var(--compass-radius);
  padding: 12px;
}
.dsh-compass-portal .settings-section.danger .settings-heading { color: var(--compass-warn); }

/* ==========================================================================
   响应式
   ========================================================================== */

/* 弹窗按视口宽度：窄屏单栏、减小边距 */
@media (max-width: 720px) {
  .dsh-compass-portal .modal-overlay { padding: 12px; }
  .dsh-compass-portal .detail-body { grid-template-columns: minmax(0, 1fr); }
  .dsh-compass-portal .modal-head { padding: 14px 16px 10px; }
  .dsh-compass-portal .modal-body { padding: 12px 16px; }
  .dsh-compass-portal .modal-foot { padding: 10px 16px; }
  .dsh-compass-portal .pointer-session { max-width: 46%; }
}

/* 面板按自身宽度（container query） */
@container compass (max-width: 420px) {
  .dsh-compass-root .status-item.poll { display: none; }
  .dsh-compass-root .row-counts { display: none; }
  .dsh-compass-root .status-item.workspace { max-width: 30%; }
}
@container compass (max-width: 340px) {
  .dsh-compass-root .status-item.updated { display: none; }
  .dsh-compass-root .pinned-path { display: none; }
  .dsh-compass-root .pinned-sep { display: none; }
  .dsh-compass-root .row-dead { display: none; }
}
`,lt=[`slots`,`sidebarRightTabs`,`sessions`,`workspaces`,`uiWorkspace`,`sidebarRight`],ut=`dsh-taskbearing-css`;function dt(){let e=document.getElementById(ut);if(e)return e.textContent=ct,()=>e.remove();let t=document.createElement(`style`);return t.id=ut,t.textContent=ct,document.head.appendChild(t),()=>t.remove()}function ft(e,t){if(!t)return null;try{let n=e.workspaces?.list?.getSnapshot?.()??e.workspaces?.getSnapshot?.()??null,r=(Array.isArray(n?.items)?n.items:[]).find(e=>Array.isArray(e?.sessionIds)&&e.sessionIds.includes(t));return r?.path||r?.cwd||null}catch{return null}}function pt(e){try{let t=e.sessions?.list?.getSnapshot?.()??null,n=e.workspaces?.list?.getSnapshot?.()??null,r=t&&Array.isArray(t.ids)?t:null;if(!r){let e=[];for(let t of Array.isArray(n?.items)?n.items:[])for(let n of Array.isArray(t?.sessionIds)?t.sessionIds:[])e.push(n);e.length>0&&(r={ids:e,phase:`ready`})}let i=n??(r?{state:`ready`}:null);return{canOpen:typeof e.uiWorkspace?.openSession==`function`,sessions:r,workspaces:i}}catch{return{canOpen:!1,sessions:null,workspaces:null}}}function mt(e){e.effect(()=>dt(),`dsh-taskbearing: styles`),e.effect(()=>e.sidebarRightTabs.register({id:`dsh-taskbearing`,kind:`compass`,title:()=>`任务板`,guide:[{id:`compass-board`,order:10,title:()=>`任务板`,description:()=>`需求与任务进度板`}]}),`dsh-taskbearing: tab type`),e.effect(()=>e.slots.register({name:`sidebar.right.pane.tab`,key:`dsh-taskbearing`},t=>{let n=t?.sessionId??null;return at({...t,sessionId:n,projectRoot:ft(e,n),getSessionLinkState:t=>V(t,pt(e)),openSession:t=>{try{return typeof e.uiWorkspace?.openSession==`function`&&(e.uiWorkspace.openSession(t),!0)}catch{return!1}},jumpToTurn:async({sessionId:t,turn:r,at:i,cwd:a}={})=>{let o=t=>{try{return typeof e.uiWorkspace?.openSession==`function`&&(e.uiWorkspace.openSession(t),!0)}catch{return!1}},s=await Ee({sessionId:t,turn:r,at:i,request:a&&t?e=>m.sessionTurn(a,e):null});if(s.reason===`log-unavailable`||s.reason===`turn-missing`||s.reason===`no-turn`){let e=s.meta?.target_session??t,r=!0;return e!==n&&(r=o(e)!==!1),{ok:!1,reason:s.reason,opened:r,pages:0,plan:s}}return{...await Te({sessionId:s.meta?.target_session??t,turn:s.targetTurn,currentSessionId:n,openSession:o}),plan:s}},checkSessions:async(e,t)=>{if(!e||!Array.isArray(t)||t.length===0)return null;try{let n=await m.sessionLinks(e,t),r={};for(let e of n?.sessions??[])r[e.session]=e.exists===!0;return r}catch{return null}},openResource:(t,n)=>{try{return typeof e.sidebarRight?.openResource==`function`&&(e.sidebarRight.openResource(t,n),!0)}catch{return!1}}})}),`dsh-taskbearing: tab body`)}exports.apply=mt,exports.inject=lt;
		return module.exports;
	}
});
