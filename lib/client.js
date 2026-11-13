window.__ModuleLoader__.load({
	id: "dsh-taskbearing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
Object.defineProperty(exports,Symbol.toStringTag,{value:`Module`});var e=Object.create,t=Object.defineProperty,n=Object.getOwnPropertyDescriptor,r=Object.getOwnPropertyNames,i=Object.getPrototypeOf,a=Object.prototype.hasOwnProperty,o=(e,i,o,s)=>{if(i&&typeof i==`object`||typeof i==`function`)for(var c=r(i),l=0,u=c.length,d;l<u;l++)d=c[l],!a.call(e,d)&&d!==o&&t(e,d,{get:(e=>i[e]).bind(null,d),enumerable:!(s=n(i,d))||s.enumerable});return e},s=(n,r,s)=>(s=n==null?{}:e(i(n)),o(r||!n||!n.__esModule||!a.call(n,`default`)?t(s,`default`,{value:n,enumerable:!0}):s,n));let c=require("react");c=s(c,1);let l=require("react-dom");var u=class extends Error{constructor(e,t={}){super(e),this.name=`ApiError`,Object.assign(this,t)}};function d(e,t){let n=e?.code??``;return n===`E_NOT_INITIALIZED`?{code:`E_NOT_INITIALIZED`,message:`任务板未初始化（暂无数据）`,details:e?.details}:n===`E_NOT_FOUND`||t===404&&!n?{code:`E_HOST_OUTDATED`,message:`当前 DSH 是旧版宿主，缺少该接口；重启 DSH 后即可使用。`,details:e?.details}:{code:n||`HTTP_${t}`,message:n?`${n}: ${e?.message??`HTTP ${t}`}`:`HTTP ${t}`,details:e?.details}}async function f(e,t={}){let n=await fetch(e,t),r=await n.json().catch(()=>({}));if(!n.ok){let e=d(r?.error??{},n.status);throw new u(e.message,{code:e.code,details:e.details})}return r}function p(e){let t=new URLSearchParams;for(let[n,r]of Object.entries(e))r!=null&&t.set(n,String(r));let n=t.toString();return n?`?${n}`:``}var m={current:e=>f(`/api/compass/current${p(e??{})}`),baseline:(e,t)=>f(`/api/compass/baseline${p({cwd:e,id:t})}`),status:(e,t)=>f(`/api/compass/status${p({cwd:e,sessionId:t})}`),sessionLinks:(e,t)=>f(`/api/compass/session-links${p({cwd:e,ids:Array.isArray(t)?t.join(`,`):``})}`),sessionTurn:(e,t)=>f(`/api/compass/session-turn${p({cwd:e,session:t?.session,turn:t?.turn,at:t?.at})}`),tree:(e,t)=>f(`/api/compass/tree${p({cwd:e,ifmtime:t})}`),historySummary:e=>f(`/api/compass/history-summary${p({cwd:e})}`),detail:(e,t)=>f(`/api/compass/detail${p({cwd:e,id:t})}`),saveNote:(e,t,n,r)=>f(`/api/compass/note`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,id:t,content:n,sessionId:r})}),fileExists:(e,t)=>f(`/api/compass/file-exists`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,paths:t})}),discard:(e,t)=>f(`/api/compass/discard`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,ids:t})}),restore:(e,t)=>f(`/api/compass/restore`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,ids:t})}),purge:(e,t)=>f(`/api/compass/purge`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,id:t,confirm:`DELETE`})}),getUiState:e=>f(`/api/compass/ui-state${p({cwd:e})}`),putUiState:(e,t)=>f(`/api/compass/ui-state`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,...t})}),getPrefs:()=>f(`/api/compass/prefs`),workspaces:e=>f(`/api/compass/workspaces${p({cwd:e})}`),removeWorkspace:e=>f(`/api/compass/workspaces/remove`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({workspace_id:e,confirm:`DELETE`})}),removeRules:()=>f(`/api/compass/rules/remove`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({})}),uninstall:()=>f(`/api/compass/uninstall`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({confirm:`UNINSTALL`})}),putPrefs:e=>f(`/api/compass/prefs`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify(e)}),exportBoard:async e=>{let t=await fetch(`/api/compass/export${p({cwd:e})}`);if(!t.ok){let e=(await t.json().catch(()=>({})))?.error??{};throw new u(e.code?`${e.code}: ${e.message??`HTTP ${t.status}`}`:`HTTP ${t.status}`,{code:e.code??`HTTP_${t.status}`,details:e.details})}let n=await t.text(),r=t.headers.get(`content-disposition`)??``,i=/filename\*=UTF-8''([^;]+)/i.exec(r),a=`taskboard.json`;if(i)try{a=decodeURIComponent(i[1])}catch{a=`taskboard.json`}return{json:n,filename:a}},importBoard:(e,t)=>f(`/api/compass/import`,{method:`POST`,headers:{"content-type":`application/json`},body:JSON.stringify({cwd:e,bundle:t,confirm:`IMPORT`})})},h=`请对本工作区执行历史会话回填（B-29）：
1) 先 compass_status 看板面；未初始化则先 compass_init；
2) 用 compass_import(mode="preview") 读取本工作区全部历史会话用户消息；
3) 按规则用 compass_import(mode="apply") 回填需求/任务：原话只允许用 refs 引用 preview 结果（禁止代写），状态按历史语义落位，挂载与顺序按历史时间；
4) 完成后 compass_status 复核，并告诉我回填了什么、哪些没回填及原因。`,g=`请调用 compass_init 初始化当前工作区的任务板（空板即可），完成后告诉我初始化结果。`;function _(e){let t=typeof e==`string`?e.trim():``;if(!t)return``;let n=Date.parse(t);if(!Number.isFinite(n))return``;let r=new Date(n),i=e=>String(e).padStart(2,`0`);return`${r.getFullYear()}-${i(r.getMonth()+1)}-${i(r.getDate())} ${i(r.getHours())}:${i(r.getMinutes())}`}function ee(e={}){let t=e.history??null,n=e.dismissed===!0,r=e.backfill??{status:`idle`},i=r.status??`idle`,a=Number.isFinite(t?.sessions)?Math.max(0,Number(t.sessions)):null,o=a!==null&&a>0,s=_(t?.latest_at),c=s?`（最近 ${s}）`:``,l=(e=`回填历史会话`)=>[{id:`backfill`,label:e,primary:!0},{id:`dismiss`,label:`暂不回填`}],u=()=>[{id:`init`,label:`让 AI 初始化任务板`,primary:!0},{id:`copy-init`,label:`复制提示`}];if(i===`sending`)return{title:`任务板暂无数据`,message:`正在把回填指令发进当前会话…`,hint:`发送完成后 AI 会自动开始回填；期间任务板保持暂无数据是正常的。`,actions:[{id:`backfill`,label:`发送中…`,primary:!0,disabled:!0},{id:`dismiss`,label:`暂不回填`,disabled:!0}]};if(i===`sent`)return{title:`任务板暂无数据`,message:`已发送回填指令，AI 处理完成后本面板会自动刷新。`,hint:`回填期间可以继续本会话对话；若长时间没有变化，可点状态条「手动刷新」，或让 AI 重新执行回填。`,actions:[{id:`refresh`,label:`刷新`,primary:!0},{id:`copy`,label:`复制回填指令`}]};if(i===`fallback`){let e=typeof r.reason==`string`&&r.reason.trim()?r.reason.trim():`自动发送不可用`,t=r.copied===!0?`回填指令已复制到剪贴板，请粘贴到输入框发送。`:`自动复制失败，请手动复制回填指令后在输入框发送。`;return{title:`任务板暂无数据`,message:o?`任务板暂无数据。检测到本工作区 ${a} 个历史会话${c}；回填与否由你决定。`:`任务板暂无数据。本工作区还没有可回填的历史会话。`,hint:`${e}：${t}`,actions:[{id:`copy`,label:`复制回填指令`,primary:!0},{id:`dismiss`,label:`暂不回填`}]}}return n?{title:`任务板暂无数据`,message:`已跳过回填。需要时再点「回填历史会话」。`,hint:`任务板仍是空的；AI 在本工作区第一次使用任务板时会自动初始化。`,actions:[{id:`backfill`,label:`回填历史会话`},{id:`refresh`,label:`刷新`}]}:o?{title:`任务板暂无数据`,message:`任务板暂无数据。检测到本工作区 ${a} 个历史会话${c}。可以把历史会话回填成需求/任务；回填与否由你决定。`,hint:t?.truncated===!0?`历史会话数量超过统计上限（2000），这里只反映前 2000 个；回填仍以 AI 实际预览结果为准。`:`回填时 AI 会先初始化任务板，再用 compass_import 读取历史会话；原话由插件逐字取回，AI 不代写。`,actions:l()}:a===0?{title:`任务板尚未初始化`,message:`任务板尚未初始化。本工作区还没有任务板数据，也没有可回填的历史会话。`,hint:`让 AI 初始化任务板后即可开始记录需求与任务。`,actions:u()}:{title:`任务板暂无数据`,message:`任务板暂无数据。`,hint:`无法读取历史会话摘要（宿主可能较旧）。可以直接回填历史会话，或先让 AI 初始化空板。`,actions:[...l(),{id:`init`,label:`让 AI 初始化任务板`}]}}var v=[`current`,`active`,`all`],y=new Set([`待裁决`,`冲突`]);function b(e,t){if(x(e))return!1;let n=e.verdict_state??null;return t===`all`?!0:t===`current`?n===null||y.has(n):(n===null||y.has(n))&&e.exec_state!==`已执行`}function x(e){return typeof e?.trashedAt==`string`&&e.trashedAt.length>0}function S(e){let t=e?.pointers;if(!Array.isArray(t)||t.length===0)return 0;let n=t[t.length-1],r=n?.at?Date.parse(n.at):0;return Number.isFinite(r)?r:0}function te(e){let t=[],n=(e,r)=>{y.has(e.verdict_state)&&t.push({node:e,path:r});for(let t of e.children??[])n(t,[...r,e.human_line])};for(let t of e?.root?.children??[])n(t,[]);return t.sort((e,t)=>S(t.node)-S(e.node)),t}function C(e,t,n){let r=[],i=(e,a)=>{if(!b(e,t))return;let o=e.children??[],s=o.filter(e=>b(e,t)),c=n?.[e.id]===!0;if(r.push({node:e,depth:a,hasChildren:o.length>0,expanded:c,kind:e.kind}),c)for(let e of s)i(e,a+1)};for(let t of e?.root?.children??[])i(t,0);return r}function w(e){let t=0,n=0,r=0,i=0,a=0,o=0,s=e=>{t+=1,e.exec_state===`进行中`?n+=1:e.exec_state===`已阻塞`?i+=1:e.exec_state===`已执行`&&(r+=1),e.verdict_state===`待裁决`&&(a+=1),e.verdict_state===`冲突`&&(o+=1);for(let t of e.children??[])s(t)};for(let t of e.children??[])s(t);return{total:t,active:n,blocked:i,done:r,pendingVerdict:a,conflict:o}}function T(e){let t=[`${e.total} 条任务`];return e.active>0&&t.push(`进行中 ${e.active}`),e.blocked>0&&t.push(`已阻塞 ${e.blocked}`),e.done>0&&t.push(`已执行 ${e.done}`),e.pendingVerdict>0&&t.push(`待裁决 ${e.pendingVerdict}`),e.conflict>0&&t.push(`冲突 ${e.conflict}`),t.join(` · `)}function ne(e){let t={未开始:0,进行中:0,已阻塞:0,已执行:0},n=e=>{for(let r of e.children??[])t[r.exec_state]!==void 0&&(t[r.exec_state]+=1),n(r)};return n(e?.root??{children:[]}),t}function E(e){let t=[],n=e.exec_state;n===`已阻塞`?t.push({label:`已阻塞`,tone:`yellow`}):n===`进行中`?t.push({label:`进行中`,tone:`blue`}):n===`已执行`?t.push({label:`已执行`,tone:`green`}):t.push({label:`未开始`,tone:`gray`});let r=e.verdict_state??null;return r===`待裁决`?t.push({label:`待裁决`,tone:`red`}):r===`冲突`?t.push({label:`冲突`,tone:`orange`}):r===`已废弃`?t.push({label:`已废弃`,tone:`muted`}):r===`已替代`&&t.push({label:`已替代`,tone:`muted`}),e.merged_into&&t.push({label:`已并入 ${e.merged_into}`,tone:`muted`}),t}var re=18e5,D=new Set([`进行中`,`已阻塞`]),ie=new Set([`已废弃`,`已替代`]);function ae(e,t,n={}){if(!t||typeof t!=`string`||!D.has(e?.exec_state)||ie.has(e?.verdict_state??null))return null;let r=e?.pointers;if(!Array.isArray(r)||r.length===0)return null;let i=r[r.length-1],a=typeof i?.session==`string`?i.session:``;if(!a||a===t)return null;let o=typeof i?.at==`string`?Date.parse(i.at):NaN;if(!Number.isFinite(o))return null;let s=Number.isFinite(n.now)?n.now:Date.now(),c=Number.isFinite(n.windowMs)?n.windowMs:re,l=s-o;return l>c||l<-6e4?null:{session:a,at:String(i.at),note:typeof i?.note==`string`?i.note:``,minutesAgo:Math.max(0,Math.floor(Math.max(0,l)/6e4))}}function O(e){if(!e)return``;let t=Number(e.minutesAgo);return Number.isFinite(t)&&t>=1?`⚠️ 另一会话在 ${t} 分钟前正在操作此任务`:`⚠️ 另一会话刚刚正在操作此任务`}function oe(e,t={}){let n=e?.node??{},r=n.kind===`requirement`?w(n):null,i=ae(n,t.currentSessionId,{now:t.now});return JSON.stringify([n.id,n.kind,n.human_line,n.exec_state,n.verdict_state??null,n.dead_reason??null,n.merged_into??null,e.depth,e.hasChildren===!0,e.expanded===!0,r,i?`${i.session}@${i.at}@${i.minutesAgo}`:null])}function se(e,t){return e?.signature===t?.signature&&e?.onToggle===t?.onToggle&&e?.onOpenDetail===t?.onOpenDetail&&e?.onDiscard===t?.onDiscard}function k(e,t=80){let n=String(e??``);return n.length>t?`${n.slice(0,t-1)}…`:n}function ce(e){return String(e??``).trim().toLowerCase()}function A(e,t){if(t.length===0)return!0;let n=[e.title,e.human_line,e.dead_reason].filter(e=>typeof e==`string`&&e.length>0).join(` `).toLowerCase();return t.every(e=>n.includes(e))}function le(e,t,n,r){let i=ce(r),a=i?i.split(/\s+/).filter(Boolean):[];if(a.length===0)return{rows:C(e,t,n),matchCount:0,searching:!1};let o=new Set,s=e=>{if(b(e,t)){A(e,a)&&o.add(e.id);for(let t of e.children??[])s(t)}};for(let t of e?.root?.children??[])s(t);let c=e=>o.has(e.id)||(e.children??[]).some(c),l=[],u=(e,t)=>{if(!c(e))return;let n=(e.children??[]).filter(c);l.push({node:e,depth:t,hasChildren:n.length>0,expanded:!0,kind:e.kind});for(let e of n)u(e,t+1)};for(let t of e?.root?.children??[])c(t)&&u(t,0);return{rows:l,matchCount:o.size,searching:!0}}Object.freeze({INVALID_ARG:`E_INVALID_ARG`,NOT_INITIALIZED:`E_NOT_INITIALIZED`,WORKSPACE_MISMATCH:`E_WORKSPACE_MISMATCH`,PARENT_REQUIRED:`E_PARENT_REQUIRED`,PARENT_NOT_FOUND:`E_PARENT_NOT_FOUND`,TASK_NOT_FOUND:`E_TASK_NOT_FOUND`,POINTER_NOTE_REQUIRED:`E_POINTER_NOTE_REQUIRED`,INVALID_TRANSITION:`E_INVALID_TRANSITION`,SUBTREE_INCOMPLETE:`E_SUBTREE_INCOMPLETE`,DEAD_REASON_REQUIRED:`E_DEAD_REASON_REQUIRED`,SELF_MERGE:`E_SELF_MERGE`,REQUIREMENT_NOT_FOUND:`E_REQUIREMENT_NOT_FOUND`,PATH_INVALID:`E_PATH_INVALID`,SCHEMA_VERSION:`E_SCHEMA_VERSION`,STORE_CORRUPT:`E_STORE_CORRUPT`,WRITE_FAILED:`E_WRITE_FAILED`,BUSY:`E_BUSY`,ORIGINAL_UNRESOLVED:`E_ORIGINAL_UNRESOLVED`,ORIGINAL_MISMATCH:`E_ORIGINAL_MISMATCH`,DETAIL_PATH_NOT_FOUND:`E_DETAIL_PATH_NOT_FOUND`,DETAIL_REQUIRED:`E_DETAIL_REQUIRED`,BATCH_DETAIL_REQUIRED:`E_BATCH_DETAIL_REQUIRED`,DETAIL_CONTENT_INVALID:`E_DETAIL_CONTENT_INVALID`,REQUIREMENT_DETAIL_REQUIRED:`E_REQUIREMENT_DETAIL_REQUIRED`,ANCESTOR_DETAIL_REQUIRED:`E_ANCESTOR_DETAIL_REQUIRED`,HISTORY_NOT_FOUND:`E_HISTORY_NOT_FOUND`,HISTORY_REF_INVALID:`E_HISTORY_REF_INVALID`,IMPORT_LIMIT:`E_IMPORT_LIMIT`,IMPORT_ITEM_INVALID:`E_IMPORT_ITEM_INVALID`,SIBLING_NOT_FOUND:`E_SIBLING_NOT_FOUND`,POSITION_CONFLICT:`E_POSITION_CONFLICT`,LOCK_BUSY:`E_LOCK_BUSY`,CONFLICT:`E_CONFLICT`,MIGRATE_SOURCE:`E_MIGRATE_SOURCE`,MIGRATE_REF:`E_MIGRATE_REF`,MIGRATE_ITEM_INVALID:`E_MIGRATE_ITEM_INVALID`,MIGRATE_ARCHIVE:`E_MIGRATE_ARCHIVE`,TRASH_NOT_FOUND:`E_TRASH_NOT_FOUND`,PURGE_FORBIDDEN:`E_PURGE_FORBIDDEN`}),Object.freeze([`未开始`,`进行中`,`已阻塞`,`已执行`]),Object.freeze([`待裁决`,`冲突`,`已废弃`,`已替代`,`已确认继续`]),Object.freeze([`已废弃`,`已替代`]);function ue(e){return typeof e?.trashedAt==`string`&&e.trashedAt.length>0}function de(e){if(!e||!e.root)return e;let t=e=>({...e,children:(e.children??[]).filter(e=>!ue(e)).map(t)});return{...e,root:t(e.root)}}function fe(e){let t=[],n=(e,r)=>{for(let i of e.children??[])if(ue(i)){let n=0;j(i,(e,t,r)=>{r>0&&(n+=1)}),t.push({node:i,parent_id:e.id,path:r,descendants:n})}else n(i,e.id===`ROOT`?r:[...r,e.human_line])};return n(e.root,[]),t.sort((e,t)=>String(t.node.trashedAt??``).localeCompare(String(e.node.trashedAt??``))),t}function j(e,t,n=null,r=0){t(e,n,r);for(let n of e.children??[])j(n,t,e,r+1)}function pe(e,t,n,r,i){let a=t.join(` › `),o=e.verdict_state??`无`,s=(e.pointers??[]).map(e=>`${e.session} · ${e.at}${e.note?` ${e.note}`:``}`).join(`；`),c=n?.id?`- 所属需求：${n.id} 明面——${n.surface??`（无明面）`}`:null,l=[`# 任务交接：${e.id} ${e.title}`,`- 任务路径：${a}`,`- 执行状态：${e.exec_state}`,`- 裁决状态：${o}`,`- 追溯链：${s||`无`}`,c,``,`## 详情（AI 写）`,r?.trim()?r:`（暂无详情）`];return i?.trim()&&l.push(``,`## 用户备注`,i),l.join(`
`)}function me(e){let t=/^(R-\d{3,4})/.exec(e??``);return t?t[1]:null}function M(e){let t=e?.workspace??{},n=0,r=0,i=e=>{for(let t of e?.children??[])n+=1,t.kind===`requirement`&&(r+=1),i(t)};return i(e?.tree?.root),{format:typeof e?.format==`string`?e.format:null,schema:Number.isInteger(e?.schema)?e.schema:null,exported_at:typeof e?.exported_at==`string`?e.exported_at:null,plugin_version:typeof e?.plugin_version==`string`?e.plugin_version:null,workspace_name:typeof t.name==`string`?t.name:null,original_path:typeof t.original_path==`string`?t.original_path:null,nodes:n,requirements:r,details:Object.keys(e?.details??{}).length}}function he(e){return[`来源工作区：${e.workspace_name??`(未命名)`}`,`原始路径：${e.original_path??`(未知)`}`,`导出时间：${e.exported_at??`(未知)`}`,`插件版本：${e.plugin_version??`(未知)`}`,`内容：${e.requirements} 需求 · ${e.nodes} 节点 · ${e.details} 个详情/备注`].join(`
`)}var ge=new Set(`ts.tsx.js.jsx.mjs.cjs.json.md.css.scss.py.java.go.rs.c.h.cpp.hpp.yml.yaml.toml.ini.sh.ps1.html.vue.svelte.sql.txt`.split(`.`)),_e=200,ve=20;function ye(e){let t=String(e??``);return t.startsWith(`/`)||/^[A-Za-z]:[/\\]/.test(t)||t.startsWith(`\\\\`)}function be(e){return encodeURIComponent(e).replace(/%3A/gi,`:`)}function xe(e){return e.split(`/`).map(be).join(`/`)}function N(e,t){let n=String(t??``).replace(/\\/g,`/`).replace(/^(?:\.\/)+/,``);return`dsh-resource://file/session/${be(String(e??``))}/${xe(n)}`}function Se(e,t,n){let r=String(n??``).replace(/\\/g,`/`);if(!ye(r))return N(e,r);let i=t?String(t).replace(/\\/g,`/`).replace(/\/+$/,``):``;return i!==``&&r===i?N(e,``):i!==``&&r.startsWith(`${i}/`)?N(e,r.slice(i.length+1)):N(e,r)}function Ce(e){let t=/^(.*?)#L(\d+)$/.exec(e);if(t)return{path:t[1],line:Number(t[2])};let n=/^(.*?):(\d+)(?::\d+)?$/.exec(e);return n&&!/^[A-Za-z]$/.test(n[1])?{path:n[1],line:Number(n[2])}:{path:e,line:null}}function we(e){let t=e.lastIndexOf(`：`);if(t>=0&&t<e.length-1)return e.slice(t+1);let n=/^[^:\\/]{1,20}:([A-Za-z0-9_.$~%+\-][^\s]*)$/.exec(e);return n?n[1]:e}function Te(e){let t=String(e??``).trim();if(!t||(t=t.replace(/^`+|`+$/g,``).replace(/^["'(<[]+|["')>\]]+$/g,``),t=we(t),!t||t.length>_e)||/:\/\//.test(t)||/^(?:https?|ftp|file):\/\//i.test(t)||/[\s<>|*?"]/.test(t))return null;let{path:n,line:r}=Ce(t),i=n.replace(/\\/g,`/`);if(!i)return null;let a=/\.([A-Za-z0-9]{1,10})$/.exec(i),o=a?a[1].toLowerCase():``,s=i.includes(`/`);return!ge.has(o)||!s&&!/^[\w.-]+\.(?:json|md|txt|toml|ini|ya?ml)$/i.test(i)?null:{path:i,line:Number.isInteger(r)&&r>0?r:null}}var Ee=/(?:[A-Za-z]:[\\/]|\/|\\\\)?[^\s`"'<>|*?]+[\\/][^\s`"'<>|*?]+(?::\d+(?::\d+)?|#L\d+)?/g;function De(e,t={}){let n=Math.max(1,Math.min(Number.isInteger(t.limit)?t.limit:ve,50)),r=String(e??``);if(!r)return[];let i=new Set,a=[],o=e=>{let t=String(e??``).replace(/[、，。；：！？（）【】「」《》]/g,` `).split(/\s+/).filter(Boolean);for(let e of t){let t=Te(e);if(!t)continue;let r=`${t.path}#${t.line??``}`;if(!i.has(r)&&(i.add(r),a.push({...t,raw:e.trim()}),a.length>=n))return}},s=[],c=/```[\s\S]*?```|`[^`\n]{1,200}`/g,l;for(;(l=c.exec(r))!==null;)s.push(l[0].replace(/```/g,` `));for(let e of s)for(let t of e.split(/\s+/))o(t);let u=r.replace(c,` `);for(;(l=Ee.exec(u))!==null&&(o(l[0]),!(a.length>=n)););return a.slice(0,n)}var P=Object.freeze({AVAILABLE:`available`,UNAVAILABLE:`unavailable`,ARCHIVED:`archived`,LOADING:`loading`,UNSUPPORTED:`unsupported`,FILE:`file`});function Oe(e){let t=typeof e==`string`?e.trim():``;return/^(?:session-[A-Za-z0-9._-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(t)}function ke(e,t={}){return typeof e!=`string`||!e.trim()?P.UNAVAILABLE:/^file:/i.test(e.trim())?P.FILE:Oe(e)?!t.canOpen||!t.sessions||!t.workspaces?P.UNSUPPORTED:t.workspaces.state===`error`?P.UNAVAILABLE:t.sessions.phase===`pending`||t.workspaces.phase===`pending`?P.LOADING:Array.isArray(t.workspaces.archivedSessionIds)&&t.workspaces.archivedSessionIds.includes(e)?P.ARCHIVED:Array.isArray(t.sessions.ids)&&t.sessions.ids.includes(e)?P.AVAILABLE:P.UNAVAILABLE:P.UNAVAILABLE}function F(e,t){return e===P.UNAVAILABLE?t===!0?P.AVAILABLE:P.UNAVAILABLE:e??P.UNAVAILABLE}function Ae(e){switch(e){case P.AVAILABLE:return``;case P.ARCHIVED:return`会话已归档`;case P.LOADING:return`会话加载中…`;case P.UNSUPPORTED:return`宿主不支持会话跳转`;case P.FILE:return`文件段（不可跳转）`;default:return`会话不可用`}}function je(e){let t=String(e??``);return t.length<=20?t:`${t.slice(0,12)}…${t.slice(-4)}`}function Me(e){if(typeof e!=`string`)return``;let t=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(e)?e:``;return t?`${t.slice(0,10)} ${t.slice(11,19)}`:``}function Ne(e,t){let n=typeof e?.session==`string`?e.session:``;return{key:`${n}#${e?.at??``}#${t}`,at:Me(e?.at),turn:Number.isInteger(e?.turn)&&e.turn>=0?e.turn:null,note:typeof e?.note==`string`?e.note:``,session:n,shortSession:je(n)}}var Pe=`data-turn-tail`,Fe=`data-dsh-compass-flash`,I=`dsh-compass-flash-style`,Ie=[`加载更早`,`Load earlier`,`加载更早的消息`,`Load earlier turns`],L=6,Le=260;function Re(e){return`[${Pe}="${Number(e)}"]`}function R(e){let t=String(e??``).trim();return Ie.some(e=>t===e||t.startsWith(e))}function z(e){let t=e?.querySelectorAll?.(`button`)??[];for(let e of t)if(R(e.textContent))return e;return null}function B(e,t){let n=String(e??``).trim();if(!n)return!1;let r=String(Number(t));return n===`跳转到第 ${r} 轮`||n===`加载并跳转到第 ${r} 轮`||RegExp(`^(?:Load and )?jump to turn\\s*${r}$`,`i`).test(n)}function V(e,t){let n=e?.querySelectorAll?.(`button`)??[];for(let e of n)if(B(e.getAttribute?.(`aria-label`)??``,t))return e;return null}function H(e){if(!e)return!1;let t=e.ownerDocument?.defaultView??null,n=typeof t?.getComputedStyle==`function`?t.getComputedStyle(e):null,r=n?String(n.overflowY??``):`auto`;return/(auto|scroll|overlay)/.test(r)&&Number(e.scrollHeight)>Number(e.clientHeight)}function U(e){let t=e?.querySelector?.(`[data-conversation-scroll]`)??null;if(t&&H(t))return t;let n=e?.querySelectorAll?.(`[data-turn-tail]`)??[];if(n.length===0)return null;let r=n[0].parentElement??null;for(;r;){if(H(r))return r;r=r.parentElement??null}return null}function ze(e,t,n=L){if(!e||!t)return!1;let r=e.getBoundingClientRect?.(),i=t.getBoundingClientRect?.();return!r||!i?!1:r.bottom>=i.top-n&&r.top<=i.bottom+n}function Be(e,t,n={}){let r=n.scroller??U(e),i=Number(r?.scrollTop??0);if(!t||!r)return t?.scrollIntoView?.({block:`center`}),{ok:!1,scroller:r??null,before:i,after:i,target:i};let a=t.getBoundingClientRect?.(),o=r.getBoundingClientRect?.();if(!a||!o)return{ok:!1,scroller:r,before:i,after:i,target:i};let s=a.top-o.top+i,c=Math.max(0,Number(r.scrollHeight)-Number(r.clientHeight)),l=Math.max(0,Math.min(c,s-Math.max(0,(Number(r.clientHeight)-a.height)/2)));try{r.scrollTo?.({top:l,behavior:`instant`})}catch{}if(Math.abs(Number(r.scrollTop)-l)>2)try{r.scrollTop=l}catch{}return{ok:!0,scroller:r,before:i,after:Number(r.scrollTop),target:l}}function Ve(e){if(!e||typeof e.createElement!=`function`||typeof e.getElementById==`function`&&e.getElementById(`dsh-compass-flash-style`))return;let t=e.createElement(`style`);t.id=I,t.textContent=`@keyframes dsh-compass-flash-pulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0);background-color:rgba(59,130,246,0)}25%,75%{box-shadow:0 0 0 3px rgba(59,130,246,.85);background-color:rgba(59,130,246,.12)}}[${Fe}]{animation:dsh-compass-flash-pulse 1s ease-in-out 2;border-radius:8px}`,(e.head??e.documentElement)?.appendChild?.(t)}function W(e,t=e?.ownerDocument,n=3e3){if(!e||typeof e.setAttribute!=`function`)return!1;Ve(t),e.setAttribute(Fe,`1`);let r=t?.defaultView??null,i=(typeof r?.setTimeout==`function`?r.setTimeout:setTimeout)(()=>{e.removeAttribute?.(Fe)},n);return i&&typeof i.unref==`function`&&i.unref(),!0}async function He(e,t={}){let n=t.document??(typeof document>`u`?null:document);if(!n)return{ok:!1,reason:`no-document`,pages:0};let r=t.sleep??(e=>new Promise(t=>setTimeout(t,e))),i=t.now??(()=>Date.now()),a=Number.isFinite(t.timeoutMs)?t.timeoutMs:1e4,o=Number.isFinite(t.pageWaitMs)?t.pageWaitMs:700,s=i()+a,c=0;for(;i()<=s;){let i=n.querySelector?.(Re(e));if(i){let a=U(n);Be(n,i,{scroller:a}),W(i,n,t.highlightMs??3e3),await r(Le);let s=!a||ze(i,a);if(!a||s)return{ok:!0,reason:`located`,pages:c,turn:Number(e),via:`scroll`};let l=V(n,e);return l&&(l.click(),await r(Math.max(o,900)),Be(n,i,{scroller:U(n)}),W(i,n,t.highlightMs??3e3),await r(Le),ze(i,U(n)))?{ok:!0,reason:`located`,pages:c,turn:Number(e),via:`rail`}:{ok:!1,reason:`scroll-failed`,pages:c,turn:Number(e)}}let a=V(n,e);if(a){a.click(),c+=1,await r(Math.max(o,900));continue}let s=z(n);s?(s.click(),c+=1,await r(o)):await r(300)}return{ok:!1,reason:c>0?`timeout-after-pages`:`turn-not-rendered`,pages:c}}async function Ue(e={},t={}){let n=Number(e.turn);if(!Number.isInteger(n)||n<1)return{ok:!1,reason:`no-turn`,pages:0};let r=typeof e.sessionId==`string`?e.sessionId:``,i=typeof e.currentSessionId==`string`?e.currentSessionId:null;if(r&&r!==i){if(typeof e.openSession!=`function`)return{ok:!1,reason:`unsupported`,pages:0};let n=!0;try{n=e.openSession(r)}catch{n=!1}if(n===!1)return{ok:!1,reason:`open-failed`,pages:0};await(t.sleep??(e=>new Promise(t=>setTimeout(t,e))))(Number.isFinite(t.openWaitMs)?t.openWaitMs:1200)}return He(n,t)}async function We(e){let t=Number.isInteger(e?.turn)&&e.turn>=1?e.turn:null,n=typeof e?.at==`string`&&e.at.trim()?e.at.trim():null;if(typeof e?.request!=`function`)return{targetTurn:t,meta:null,reason:t===null?`no-turn`:null};let r;try{r=await e.request({session:typeof e?.sessionId==`string`?e.sessionId:``,turn:t,at:n})}catch(e){return{targetTurn:t,meta:null,reason:`lookup-failed`,error:e instanceof Error?e.message:String(e)}}if(!r||typeof r!=`object`)return{targetTurn:t,meta:null,reason:`lookup-failed`,error:`宿主返回为空`};if(r.log_available!==!0)return{targetTurn:null,meta:r,reason:t===null?`no-turn`:`log-unavailable`};let i=Number.isInteger(r.turn)&&r.turn>=1?r.turn:null;return i===null?{targetTurn:null,meta:r,reason:t===null?`no-turn`:`turn-missing`}:{targetTurn:i,meta:r,reason:null}}function Ge(e,t){let n=t?.meta??null,r=Number.isInteger(t?.targetTurn)?t.targetTurn:null,i=Number.isInteger(n?.requested_turn)?n.requested_turn:null;if(t?.reason===`lookup-failed`)return e?.ok?`已定位第 ${r??e?.turn??`?`} 轮（宿主未提供轮次核验，高亮约 3 秒）`:`已打开会话，但未能定位第 ${r??i??`?`} 轮`;if(t?.reason===`log-unavailable`)return`该会话没有可读的日志，已打开会话（无法核验轮次）`;if(t?.reason===`turn-missing`)return`该会话日志只有 ${n?.turn_count??0} 轮，戳记第 ${i??`?`} 轮不存在；已打开会话`;if(t?.reason===`no-turn`)return`该记录无轮次信息，仅打开会话`;if(e?.reason===`open-failed`)return`打开会话失败：宿主未提供会话跳转`;let a=n?.origin===`subagent`&&typeof n?.target_session==`string`&&n.target_session;if(e?.ok){let t=n?.source===`by-at`&&i!==null&&i!==r;return a?t?`子代理会话不可直接打开；已按时间在父会话定位第 ${r} 轮（戳记第 ${i} 轮，高亮约 3 秒）`:`子代理会话不可直接打开；已在父会话定位第 ${r??`?`} 轮（高亮约 3 秒）`:t?`戳记第 ${i} 轮与日志不符，已按时间还原为第 ${r} 轮（高亮约 3 秒）`:`已定位第 ${r??e?.turn??`?`} 轮（高亮约 3 秒）`}if(e?.reason===`scroll-failed`)return`已高亮第 ${r??i??`?`} 轮，但未能滚动到该轮（宿主滚动容器的锚定拦截了滚动）；请在${a?`父会话`:`会话`}内手动向上翻找，或再点一次`;if(e?.reason===`turn-not-rendered`||e?.reason===`timeout-after-pages`){let e=Number.isInteger(n?.turn_count)?`（会话日志共 ${n.turn_count} 轮）`:``;return`已打开${a?`父会话`:`会话`}，但未能定位第 ${r??i??`?`} 轮${e}`}return e?.reason===`unsupported`?`宿主不支持会话跳转`:`已打开会话，但未能定位第 ${r??i??`?`} 轮`}Object.freeze({view:`current`,rememberExpand:!1});function Ke(e){return{view:[`current`,`active`,`all`].includes(e?.view)?e.view:`current`,rememberExpand:e?.rememberExpand===!0}}function qe(e,t){let n={...e??{}};return n[t]=!n[t],n}var Je=2e3;function Ye({tabVisible:e,docVisible:t,editing:n}){return!!(e&&t&&!n)}function Xe(e=document){let t=e?.documentElement;return t&&((t.getAttribute(`data-theme`)||t.getAttribute(`data-color-scheme`)||t.getAttribute(`data-mode`)||``).toLowerCase().includes(`dark`)||(t.className||``).toLowerCase().includes(`dark`))?`dark`:`light`}function Ze(e,t=document){let n=()=>e(Xe(t));n();let r=new MutationObserver(e=>{for(let t of e)t.type===`attributes`&&n()});return r.observe(t.documentElement,{attributes:!0,attributeFilter:[`class`,`data-theme`,`data-color-scheme`,`data-mode`]}),()=>r.disconnect()}function Qe(){let[e,t]=(0,c.useState)(()=>Xe());return(0,c.useEffect)(()=>Ze(t),[]),e}function $e(e,t,n=320){let r=t-Math.max(0,e);return!Number.isFinite(r)||r<=0?0:Math.max(n,Math.floor(r))}function et(e){(0,c.useLayoutEffect)(()=>{let t=e.current;if(!t)return;let n=()=>{let e=$e(t.getBoundingClientRect().top,window.innerHeight);e>0&&(t.style.height=`${e}px`)};n();let r=[50,120,250,500,900,1600,2600].map(e=>window.setTimeout(n,e)),i=()=>n();document.addEventListener(`transitionend`,i,!0),document.addEventListener(`animationend`,i,!0),window.visualViewport?.addEventListener(`resize`,n),window.addEventListener(`resize`,n);let a=new ResizeObserver(n);return a.observe(document.documentElement),t.parentElement&&a.observe(t.parentElement),()=>{for(let e of r)window.clearTimeout(e);document.removeEventListener(`transitionend`,i,!0),document.removeEventListener(`animationend`,i,!0),window.visualViewport?.removeEventListener(`resize`,n),window.removeEventListener(`resize`,n),a.disconnect()}},[e])}var tt=c.createElement,nt={search:[[`circle`,{cx:11,cy:11,r:7}],[`line`,{x1:16.5,y1:16.5,x2:21,y2:21}]],refresh:[[`path`,{d:`M21 12a9 9 0 1 1-2.64-6.36`}],[`polyline`,{points:`21 3 21 9 15 9`}]],settings:[[`line`,{x1:4,y1:21,x2:4,y2:14}],[`line`,{x1:4,y1:10,x2:4,y2:3}],[`line`,{x1:12,y1:21,x2:12,y2:12}],[`line`,{x1:12,y1:8,x2:12,y2:3}],[`line`,{x1:20,y1:21,x2:20,y2:16}],[`line`,{x1:20,y1:12,x2:20,y2:3}],[`line`,{x1:2,y1:14,x2:6,y2:14}],[`line`,{x1:10,y1:8,x2:14,y2:8}],[`line`,{x1:18,y1:16,x2:22,y2:16}]],history:[[`path`,{d:`M3 3v5h5`}],[`path`,{d:`M3.05 13a9 9 0 1 0 .5-5L3 8`}],[`polyline`,{points:`12 7 12 12 15.5 14`}]],close:[[`line`,{x1:6,y1:6,x2:18,y2:18}],[`line`,{x1:18,y1:6,x2:6,y2:18}]],chevron:[[`polyline`,{points:`9 5 16 12 9 19`}]],grid:[[`rect`,{x:3,y:3,width:7,height:7,rx:1.5}],[`rect`,{x:14,y:3,width:7,height:7,rx:1.5}],[`rect`,{x:3,y:14,width:7,height:7,rx:1.5}],[`rect`,{x:14,y:14,width:7,height:7,rx:1.5}]],file:[[`path`,{d:`M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z`}],[`polyline`,{points:`14 2 14 8 20 8`}]],copy:[[`rect`,{x:9,y:9,width:12,height:12,rx:2}],[`path`,{d:`M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1`}]],check:[[`polyline`,{points:`4 12.5 9.5 18 20 6.5`}]],alert:[[`path`,{d:`M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z`}],[`line`,{x1:12,y1:9,x2:12,y2:13}],[`line`,{x1:12,y1:17,x2:12.01,y2:17}]],pin:[[`path`,{d:`M12 17v5`}],[`path`,{d:`M9 3h6l1 7 3 3v1H5v-1l3-3z`}]],folder:[[`path`,{d:`M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z`}]],download:[[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`}],[`polyline`,{points:`7 10 12 15 17 10`}],[`line`,{x1:12,y1:15,x2:12,y2:3}]],upload:[[`path`,{d:`M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`}],[`polyline`,{points:`7 8 12 3 17 8`}],[`line`,{x1:12,y1:3,x2:12,y2:15}]],trash:[[`polyline`,{points:`3 6 5 6 21 6`}],[`path`,{d:`M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2`}]],external:[[`path`,{d:`M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6`}],[`polyline`,{points:`15 3 21 3 21 9`}],[`line`,{x1:10,y1:14,x2:21,y2:3}]],inbox:[[`path`,{d:`M22 12h-6l-2 3h-4l-2-3H2`}],[`path`,{d:`M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z`}]]};function G({name:e,size:t=16,className:n=``,title:r}){let i=nt[e]??[];return tt(`svg`,{className:`icon ${n}`.trim(),width:t,height:t,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:1.75,strokeLinecap:`round`,strokeLinejoin:`round`,"aria-hidden":!r||void 0,role:r?`img`:void 0,focusable:`false`},r?tt(`title`,null,r):null,i.map(([e,t],n)=>tt(e,{key:n,...t})))}Object.keys(nt);var K=c.createElement,{useEffect:q,useMemo:rt,useRef:it}=c,at=`a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])`;function J({variant:e=`center`,onClose:t,label:n,className:r=``,children:i}){let a=Qe(),o=rt(()=>{let e=document.createElement(`div`);return e.className=`dsh-compass-portal`,e},[]),s=it(null),c=it(t);return c.current=t,q(()=>{o.setAttribute(`data-theme`,a)},[o,a]),q(()=>(document.body.appendChild(o),()=>o.remove()),[o]),q(()=>{let e=s.current;if(!e)return;let t=document.activeElement,n=e.querySelector(`[data-autofocus]`)??e.querySelector(at)??e;try{n.focus({preventScroll:!0})}catch{e.focus?.({preventScroll:!0})}return()=>{if(t&&document.contains(t)&&typeof t.focus==`function`)try{t.focus({preventScroll:!0})}catch{}}},[]),(0,l.createPortal)(K(`div`,{className:`modal-overlay ${e===`drawer`?`drawer`:`center`}`,onMouseDown:e=>{e.target===e.currentTarget&&c.current?.()},onKeyDown:e=>{if(e.key===`Escape`){e.stopPropagation(),e.preventDefault(),c.current?.();return}if(e.key!==`Tab`)return;let t=s.current;if(!t)return;let n=[...t.querySelectorAll(at)].filter(e=>e.getClientRects().length>0&&e.getAttribute(`aria-hidden`)!==`true`);if(n.length===0){e.preventDefault(),t.focus({preventScroll:!0});return}let r=n[0],i=n[n.length-1],a=document.activeElement;e.shiftKey&&(a===r||a===t)?(e.preventDefault(),i.focus({preventScroll:!0})):e.shiftKey||a!==i&&a!==t||(e.preventDefault(),r.focus({preventScroll:!0}))}},K(`div`,{className:`modal-card ${e===`drawer`?`drawer-card`:``} ${r}`.trim(),role:`dialog`,"aria-modal":`true`,"aria-label":n,tabIndex:-1,ref:s},i)),o)}function ot({title:e,subtitle:t,onClose:n,closeLabel:r=`关闭`,children:i}){return K(`div`,{className:`modal-head`},K(`div`,{className:`modal-head-text`},K(`div`,{className:`modal-title`},e),t?K(`div`,{className:`modal-subtitle`},t):null,i),K(`button`,{type:`button`,className:`icon-btn modal-close`,onClick:n,"aria-label":r,"data-autofocus":!0},K(G,{name:`close`})))}var Y=c.createElement,{useCallback:X,useEffect:Z,useMemo:Q,useRef:st,useState:$}=c,ct={current:`只看当前`,active:`只看在动`,all:`完整轨迹`},lt={gray:`tone-gray`,blue:`tone-blue`,green:`tone-green`,red:`tone-red`,orange:`tone-orange`,yellow:`tone-yellow`,muted:`tone-muted`};function ut({label:e,tone:t}){return Y(`span`,{className:`badge ${lt[t]??`tone-gray`}`},e)}function dt({cwd:e,onImported:t}){let[n,r]=$(null),[i,a]=$(null),[o,s]=$(null),[l,u]=$(null),[d,f]=$(!1),[p,h]=$(null),[g,_]=$(null),[ee,v]=$(!1),[y,b]=$(!1),x=st(null),S=X(async()=>{a(null);try{let t=await m.workspaces(e);r(t.workspaces??[])}catch(e){a(e instanceof Error?e.message:String(e)),r([])}},[e]);Z(()=>{S()},[S]);let te=X(async()=>{if(!e)a(`尚未绑定工作区，无法导出`);else{a(null),s(null),b(!0);try{let{json:t,filename:n}=await m.exportBoard(e),r=null;try{r=M(JSON.parse(t))}catch{r=null}let i=new Blob([t],{type:`application/json`}),a=URL.createObjectURL(i),o=document.createElement(`a`);o.href=a,o.download=n,document.body.appendChild(o),o.click(),o.remove(),window.setTimeout(()=>URL.revokeObjectURL(a),1e3),s(`已导出 ${n}${r?`（${r.requirements} 需求 · ${r.nodes} 节点 · ${r.details} 详情/备注）`:``}`)}catch(e){a(e instanceof Error?e.message:String(e))}finally{b(!1)}}},[e]),C=X(async e=>{let t=e?.target?.files?.[0];if(e?.target&&(e.target.value=``),t){a(null),s(null);try{let e=await t.text(),n=JSON.parse(e);_({filename:t.name,bundle:n,summary:M(n)})}catch(e){_(null),a(`导入文件不是合法 JSON：${e instanceof Error?e.message:String(e)}`)}}},[]),w=X(async()=>{if(g&&e){v(!0),a(null),s(null);try{let n=(await m.importBoard(e,g.bundle))?.imported??{};s(`已导入：${n.nodes??0} 节点 · ${n.details??0} 详情/备注 · ${n.baseline_requirements??0} 需求基线`),_(null),await S(),t?.()}catch(e){a(e instanceof Error?e.message:String(e))}finally{v(!1)}}},[e,g,S,t]),T=X(async e=>{try{await m.removeWorkspace(e),u(null),await S()}catch(e){a(e instanceof Error?e.message:String(e))}},[S]),ne=X(async()=>{try{let e=await m.uninstall();h(`规则区块：${e.rules}；已删除 ${e.workspaces_removed} 份任务板数据`),f(!1),r([])}catch(e){a(e instanceof Error?e.message:String(e))}},[]),E=e=>{let t=[`${e.node_count} 节点`];return Number.isInteger(e.requirement_count)&&t.push(`${e.requirement_count} 需求`),e.exec&&t.push(`进行中 ${e.exec.doing}`),e.verdict&&t.push(`待裁决 ${e.verdict.pending}`),t.join(` · `)};return Y(c.Fragment,null,Y(`section`,{className:`settings-section`},Y(`h3`,{className:`settings-heading`},`迁移与备份`),Y(`div`,{className:`ws-tools`},Y(`button`,{type:`button`,className:`btn`,onClick:()=>void te(),disabled:y||!e},Y(G,{name:`download`,size:14}),y?`导出中…`:`导出任务板`),Y(`button`,{type:`button`,className:`btn`,onClick:()=>x.current?.click()},Y(G,{name:`upload`,size:14}),`导入任务板`),Y(`input`,{type:`file`,accept:`.json,application/json`,ref:x,style:{display:`none`},onChange:e=>void C(e)})),g?Y(`div`,{className:`ws-import`},Y(`div`,{className:`ws-import-file`},`待导入：${g.filename}`),Y(`pre`,{className:`ws-import-summary`},he(g.summary)),Y(`div`,{className:`ws-warn`},`导入只允许写入空板；目标板非空会被拒绝。导入会整体写入树/详情/备注/基线。`),Y(`div`,{className:`ws-confirm`},Y(`button`,{type:`button`,className:`btn danger`,onClick:()=>void w(),disabled:ee},ee?`导入中…`:`确认导入`),Y(`button`,{type:`button`,className:`btn`,onClick:()=>_(null),disabled:ee},`取消`))):null),Y(`section`,{className:`settings-section`},Y(`h3`,{className:`settings-heading`},Y(`span`,null,`本机任务板数据（${n?n.length:`…`}）`),Y(`button`,{type:`button`,className:`link-btn`,onClick:()=>void S()},`刷新`)),Y(`div`,{className:`settings-row hint`},`本机全部任务板数据（磁盘清理用），不是看板切换器；删除只清理数据目录，不动原项目文件。`),o?Y(`div`,{className:`settings-row hint`},o):null,i?Y(`div`,{className:`settings-row ws-error`},i):null,n?n.length===0?Y(`div`,{className:`settings-row hint`},`本机暂无任务板数据`):n.map(e=>Y(`div`,{key:e.workspace_id,className:`ws-row ${e.orphan?`orphan`:``}`},Y(`div`,{className:`ws-main`},Y(`span`,{className:`ws-name`,title:e.name},`${e.current?`● 当前 · `:``}${e.name}`),Y(`span`,{className:`ws-meta`},E(e)),e.orphan?Y(`span`,{className:`ws-orphan`},`路径已失效 · 可清理`):null),Y(`div`,{className:`ws-path`,title:e.original_path??``},e.original_path??`(未知路径)`),l===e.workspace_id?Y(`div`,{className:`ws-confirm`},Y(`span`,{className:`ws-warn`},e.current?`这是当前会话正在使用的数据，删除后任务板将变为空板。数据目录将永久删除：`:`删除后该数据目录将永久删除（原项目文件不受影响）：`),Y(`button`,{type:`button`,className:`btn danger`,onClick:()=>void T(e.workspace_id)},`确认清理`),Y(`button`,{type:`button`,className:`btn`,onClick:()=>u(null)},`取消`)):Y(`button`,{type:`button`,className:`link-btn ws-delete`,onClick:()=>u(e.workspace_id)},`清理`))):Y(`div`,{className:`settings-row hint`},`加载中…`)),Y(`section`,{className:`settings-section danger`},Y(`h3`,{className:`settings-heading`},`危险区`),d?Y(`div`,{className:`ws-confirm`},Y(`span`,{className:`ws-warn`},`将永久清除：AGENTS.md 规则区块 + 全部 ${n?.length??0} 份任务板数据`),Y(`button`,{type:`button`,className:`btn danger`,onClick:()=>void ne()},`确认卸载`),Y(`button`,{type:`button`,className:`btn`,onClick:()=>f(!1)},`取消`)):Y(`button`,{type:`button`,className:`btn danger`,onClick:()=>f(!0)},Y(G,{name:`trash`,size:14}),`卸载插件（自动清理）`),p?Y(`div`,{className:`settings-row hint`},p):null))}function ft({view:e,onView:t,query:n,onQuery:r,searching:i,matchCount:a,trashCount:o,onOpenTrash:s,onRefresh:c,onOpenSettings:l}){return Y(`div`,{className:`topbar`},Y(`div`,{className:`view-tabs`,role:`group`,"aria-label":`视图`},v.map(n=>Y(`button`,{key:n,type:`button`,className:`view-tab ${e===n?`on`:``}`,onClick:()=>t(n),"aria-pressed":e===n},ct[n]))),Y(`div`,{className:`topbar-tools`},Y(`div`,{className:`search-box`},Y(`span`,{className:`search-icon`},Y(G,{name:`search`,size:14})),Y(`input`,{type:`search`,className:`search-input`,placeholder:`搜索任务…`,value:n,"aria-label":`搜索任务`,onChange:e=>r(e.target.value),onKeyDown:e=>{e.key===`Escape`&&r(``)}}),i?Y(`span`,{className:`search-count`},`${a} 项`):null),Y(`button`,{type:`button`,className:`icon-btn trash-entry${o>0?` has-items`:``}`,title:o>0?`回收站：${o} 项`:`回收站（空）`,"aria-label":o>0?`回收站，${o} 项`:`回收站`,onClick:s},Y(G,{name:`trash`}),o>0?Y(`span`,{className:`trash-count`},o>99?`99+`:String(o)):null),Y(`button`,{type:`button`,className:`icon-btn`,title:`刷新`,onClick:c,"aria-label":`刷新`},Y(G,{name:`refresh`})),Y(`button`,{type:`button`,className:`icon-btn`,title:`设置`,onClick:l,"aria-label":`设置`},Y(G,{name:`settings`}))))}function pt({view:e,rememberExpand:t,onToggleRemember:n,diagnostics:r,cwd:i,onImported:a,onClose:o}){return Y(J,{variant:`center`,onClose:o,label:`设置`,className:`settings-card`},Y(ot,{title:`设置`,subtitle:`偏好 · 备份 · 工作区管理`,onClose:o}),Y(`div`,{className:`modal-body`},Y(`section`,{className:`settings-section`},Y(`h3`,{className:`settings-heading`},`偏好`),Y(`div`,{className:`settings-row`},`视图偏好：全局固定（`,ct[e],`）`),Y(`label`,{className:`settings-row checkbox`},Y(`input`,{type:`checkbox`,checked:t,onChange:e=>n(e.target.checked)}),`记住展开路径（按工作区）`)),r?Y(`section`,{className:`settings-section`},Y(`h3`,{className:`settings-heading`},`诊断`),Y(`div`,{className:`settings-row diagnostics`},r)):null,Y(dt,{cwd:i,onImported:a}),Y(`div`,{className:`settings-row hint`},`判断由 AI 完成，插件只展示`)),Y(`div`,{className:`modal-foot`},Y(`button`,{type:`button`,className:`btn`,onClick:o},`关闭`)))}function mt({items:e,onJump:t}){return e.length===0?null:Y(`div`,{className:`pinned`},Y(`div`,{className:`pinned-title`},Y(G,{name:`pin`,size:12}),`待裁决 ${e.length}`),Y(`div`,{className:`pinned-list`},e.map(({node:e,path:n})=>Y(`button`,{key:e.id,type:`button`,className:`pinned-row`,onClick:()=>t(e),title:e.human_line},Y(`span`,{className:`pinned-path`,title:n.join(` › `)},n.join(` › `)||`—`),Y(`span`,{className:`pinned-sep`},`›`),Y(`span`,{className:`pinned-text`},e.human_line),Y(ut,{label:`待裁决`,tone:`red`})))))}var ht=c.memo(function({row:e,expanded:t,onToggle:n,onOpenDetail:r,onDiscard:i,depth:a,currentSessionId:o,nowMs:s}){typeof window<`u`&&window.__DSH_COMPASS_PROFILE__&&(window.__DSH_COMPASS_ROW_RENDERS__=(window.__DSH_COMPASS_ROW_RENDERS__??0)+1);let{node:c,hasChildren:l}=e,u=E(c),d=c.kind===`requirement`?w(c):null,f=c.dead_reason,p=ae(c,o,{now:s}),m=`tree-row depth-${a} kind-${c.kind}${c.exec_state===`已阻塞`?` exec-blocked`:``}`,h=c.exec_state===`进行中`?`exec-doing`:c.exec_state===`已执行`?`exec-done`:c.exec_state===`已阻塞`?`exec-blocked`:`exec-idle`;return Y(`div`,{className:m,style:{paddingLeft:4+a*14}},Y(`button`,{type:`button`,className:`row-toggle ${l?e.expanded?`open`:``:`leaf`}`,onClick:()=>l&&n(c.id),"aria-expanded":l?e.expanded:void 0,"aria-label":l?e.expanded?`收起`:`展开`:`详情`,tabIndex:l?0:-1},l?Y(G,{name:`chevron`,size:12}):Y(`span`,{className:`row-leaf-dot`})),Y(`div`,{className:`row-main`,onClick:()=>r(c.id),role:`button`,tabIndex:0,"aria-label":c.human_line},Y(`span`,{className:`row-dot ${h}`,title:`执行：${c.exec_state??`未开始`}`}),Y(`span`,{className:`row-text ${c.verdict_state===`已废弃`||c.verdict_state===`已替代`?`struck`:``}`,title:c.human_line},c.human_line),d?Y(`span`,{className:`row-counts`},T(d)):null,f?Y(`span`,{className:`row-dead`,title:f},k(f,60)):null),Y(`div`,{className:`row-badges`},p?Y(`span`,{className:`ghost-mark`,title:p.note?`${O(p)}（${p.note}）`:O(p),"aria-label":`近期并发操作`},`👻`):null,u.map(e=>Y(ut,{key:e.label,label:e.label,tone:e.tone})),Y(`button`,{type:`button`,className:`row-discard-btn`,title:`丢弃到回收站（可还原）`,"aria-label":`丢弃到回收站：${c.human_line}`,onClick:e=>{e.stopPropagation(),i(c.id)}},Y(G,{name:`trash`,size:12})),Y(`button`,{type:`button`,className:`row-detail-btn`,title:`详情`,onClick:e=>{e.stopPropagation(),r(c.id)}},`详情`)))},se);function gt({rows:e,expanded:t,onToggle:n,onOpenDetail:r,onDiscard:i,currentSessionId:a,nowMs:o}){return e.length===0?null:Y(`div`,{className:`tree`},e.map(e=>Y(ht,{key:e.node.id,row:e,signature:e.signature,expanded:t,onToggle:n,onOpenDetail:r,onDiscard:i,depth:e.depth,currentSessionId:a,nowMs:o})))}function _t({entries:e,busy:t,notice:n,onRestore:r,onPurge:i,onClose:a}){let[o,s]=c.useState(null);return Z(()=>{s(null)},[e.length]),Y(J,{variant:`drawer`,onClose:a,label:`回收站`,className:`trash-card`},Y(ot,{title:`回收站`,subtitle:e.length>0?`${e.length} 项 · 丢弃不改状态，随时可还原`:`空 · 任务行上的垃圾桶按钮可把一次性任务丢进来`,onClose:a}),Y(`div`,{className:`modal-body trash-body`},n?Y(`div`,{className:`trash-notice`,role:`status`},n):null,e.length===0?Y(`div`,{className:`trash-empty`},Y(G,{name:`inbox`,size:28}),Y(`div`,{className:`trash-empty-title`},`回收站是空的`),Y(`div`,{className:`hint`},`任务行右侧的垃圾桶按钮：一次点击丢弃，整棵子树一起收起来，随时还原。`)):Y(`div`,{className:`trash-list`},e.map(({node:e,path:n,descendants:a})=>{let c=e.kind===`requirement`,l=o===e.id;return Y(`div`,{className:`trash-row${c?` kind-requirement`:``}`,key:e.id},Y(`div`,{className:`trash-row-main`},Y(`div`,{className:`trash-row-title`,title:e.human_line},e.human_line),Y(`div`,{className:`trash-row-meta`},c?`需求`:e.kind===`task`?`任务`:`步骤`,n.length>0?` · ${n.join(` › `)}`:``,a>0?` · 含 ${a} 个后代`:``,` · 丢弃于 ${vt(e.trashedAt)}`)),Y(`div`,{className:`trash-row-actions`},l?[Y(`button`,{key:`ok`,type:`button`,className:`btn danger`,disabled:t,onClick:()=>{s(null),i(e.id)}},a>0?`确认删除（含 ${a} 个后代）`:`确认删除`),Y(`button`,{key:`cancel`,type:`button`,className:`btn`,disabled:t,onClick:()=>s(null)},`取消`)]:[Y(`button`,{key:`restore`,type:`button`,className:`btn`,disabled:t,onClick:()=>r(e.id)},`还原`),Y(`button`,{key:`purge`,type:`button`,className:`btn danger${c?` disabled-look`:``}`,disabled:t||c,title:c?`需求带着基线原话与追溯链，只能保留在回收站，不能彻底删除`:`彻底删除（先备份到 data/.trash，保留 30 天）`,onClick:()=>{c||s(e.id)}},c?`不可删除`:`彻底删除`)]))}))))}function vt(e){let t=typeof e==`string`?Date.parse(e):NaN;if(!Number.isFinite(t))return`未知时间`;let n=new Date(t),r=e=>String(e).padStart(2,`0`);return`${r(n.getMonth()+1)}-${r(n.getDate())} ${r(n.getHours())}:${r(n.getMinutes())}`}function yt({kind:e,message:t,hint:n,onRetry:r,onCopyHint:i,retryLabel:a=`重试`,actions:o}){return Y(`div`,{className:`empty-state`},Y(`div`,{className:`empty-icon`},Y(G,{name:e===`error`?`alert`:`inbox`,size:36})),Y(`div`,{className:`empty-title`},{uninitialized:`任务板暂无数据`,empty:`任务板还是空的`,search:`无匹配`,loading:`加载中`,error:`读取失败`}[e]??`提示`),Y(`div`,{className:`empty-message`},t),n?Y(`div`,{className:`empty-hint`},n):null,Y(`div`,{className:`empty-actions`},...(Array.isArray(o)?o:[]).map((e,t)=>Y(`button`,{key:`${e.label}-${t}`,type:`button`,className:`btn${e.primary?` primary`:``}`,disabled:e.disabled===!0,onClick:e.onClick},e.label)),r?Y(`button`,{type:`button`,className:`btn`,onClick:r},a):null,i?Y(`button`,{type:`button`,className:`btn`,onClick:i},`复制提示`):null))}function bt({value:e,status:t,onChange:n}){return Y(`div`,{className:`note-editor`},Y(`textarea`,{className:`note-input`,value:e,placeholder:`写点备注…`,onChange:e=>n(e.target.value)}),Y(`div`,{className:`note-status status-${t.state}`},t.state===`saving`?`保存中…`:t.state===`saved`?`已保存 ${t.savedAt}`:t.state===`error`?`保存失败：${t.message}`:t.state===`dirty`?`编辑中…`:`自动保存已开启`))}function xt({pointer:e,index:t,getSessionLinkState:n,hostSession:r,openSession:i,jumpToTurn:a,onJumpError:o,cwd:s}){let c=Ne(e,t),l=F(typeof n==`function`?n(c.session):P.UNSUPPORTED,r?.exists),u=l!==P.AVAILABLE,d=l===P.AVAILABLE&&r?.targetSession&&r.targetSession!==c.session,f=c.turn===null?`打开原会话`:d?`跳到父会话对应轮次`:`跳到第 ${c.turn} 轮`,[p,m]=$(``),h=async()=>{if(typeof a!=`function`){o?.(`宿主不支持会话跳转`);return}c.turn===null?m(`定位中…`):m(`定位第 ${c.turn} 轮…`);let t=null;try{t=await a({sessionId:c.session,turn:c.turn,at:e?.at??null,cwd:s})}catch(e){m(`跳转失败：${e instanceof Error?e.message:String(e)}`);return}let n=Ge(t,t?.plan??null);m(n||(t?.ok?`已定位并高亮`:`未能定位该轮次`)),t?.reason===`open-failed`&&o?.(`打开会话失败：宿主未提供会话跳转`)};return Y(`div`,{key:c.key,className:`pointer-row ${u?`degraded`:``}`},Y(`span`,{className:`pointer-at`},c.at||`时间未知`),c.turn===null?null:Y(`span`,{className:`pointer-turn`},`第 ${c.turn} 轮`),Y(`span`,{className:`pointer-note`,title:c.note},c.note),Y(`span`,{className:`pointer-session`,title:c.session},l===P.FILE?c.session.replace(/#.*$/,``):c.shortSession),Y(`span`,{className:`pointer-actions`},l===P.AVAILABLE?Y(`button`,{type:`button`,className:`link-btn pointer-jump`,onClick:()=>void h()},f):Y(`span`,{className:`pointer-degraded`},Ae(l)),u&&l!==P.FILE?Y(`button`,{type:`button`,className:`link-btn`,title:`复制会话 id`,onClick:()=>navigator.clipboard?.writeText?.(c.session)},`复制 id`):null),p?Y(`span`,{className:`pointer-jump-status`},p):null)}function St({node:e,detail:t,noteState:n,onClose:r,onNoteChange:i,onCopy:a,copied:o,pathTitles:s,getSessionLinkState:c,openSession:l,jumpToTurn:u,fileAnchors:d,onOpenFile:f,collision:p,cwd:h}){let g=E(e),[_,ee]=$(``),[v,y]=$(``),b=Array.isArray(e.pointers)?e.pointers:[],x=Array.isArray(d)?d:[],[S,te]=$({}),[C,w]=$(``),T=x.map(e=>e.path).join(`
`),[ne,re]=$({}),D=[...new Set(b.map(e=>typeof e?.session==`string`?e.session:``).filter(e=>e&&Oe(e)))].join(`,`);return Z(()=>{if(!h||!D)return;let e=!1;return(async()=>{try{let t=await m.sessionLinks(h,D.split(`,`)),n={};for(let e of t?.sessions??[])n[e.session]={exists:e.exists===!0,origin:e.origin??null,openable:e.openable!==!1,targetSession:e.target_session??null};e||re(n)}catch{}})(),()=>{e=!0}},[h,D]),Z(()=>{if(!h||!T)return;let e=!1;return(async()=>{try{let t=await m.fileExists(h,T.split(`
`)),n={};for(let e of t?.results??[])n[e.path]=e.kind;e||(te(n),w(``))}catch{e||w(`无法检测文件是否存在（宿主版本过旧），点击仍会尝试打开`)}})(),()=>{e=!0}},[h,T]),Y(J,{variant:`center`,onClose:r,label:`详情 ${e.id}`,className:`detail-card`},Y(`div`,{className:`modal-head`},Y(`div`,{className:`modal-head-text`},Y(`div`,{className:`modal-title`},Y(`span`,{className:`node-id`},e.id),Y(`span`,null,e.title)),Y(`div`,{className:`detail-meta`},Y(`span`,{className:`meta-item`},`执行：`,e.exec_state),Y(`span`,{className:`meta-item`},`裁决：`,e.verdict_state??`无`),g.filter(e=>e.tone!==`gray`).map(e=>Y(ut,{key:e.label,label:e.label,tone:e.tone})),e.dead_reason?Y(`span`,{className:`meta-item dead-reason`},`原因：`,e.dead_reason):null,Y(`span`,{className:`meta-item path`,title:s.join(` › `)},`路径：`,s.join(` › `)))),Y(`button`,{type:`button`,className:`icon-btn modal-close`,onClick:r,"aria-label":`关闭`,"data-autofocus":!0},Y(G,{name:`close`}))),Y(`div`,{className:`modal-body`},p?Y(`div`,{className:`detail-collision`},Y(G,{name:`alert`,size:14}),Y(`span`,null,`${O(p)}${p.note?`（${p.note}）`:``}`)):null,Y(`section`,{className:`detail-section`},Y(`div`,{className:`col-title`},`追溯链（${b.length}）`),b.length===0?Y(`div`,{className:`pointer-empty`},`（暂无追溯记录）`):Y(`div`,{className:`pointer-list`},b.map((e,t)=>Y(xt,{key:`${e?.at??``}#${t}`,pointer:e,index:t,getSessionLinkState:c,hostSession:ne[e?.session]??void 0,openSession:l,jumpToTurn:u,cwd:h,onJumpError:ee}))),_?Y(`div`,{className:`pointer-error`},_):null),x.length>0?Y(`section`,{className:`detail-section`},Y(`div`,{className:`col-title`},`文件锚点（${x.length}）`),Y(`div`,{className:`file-chips`},x.map(e=>{let t=S[e.path],n=t===`missing`,r=t===`unknown`;return Y(`button`,{key:`${e.path}#${e.line??``}`,type:`button`,className:`file-chip ${n?`missing`:``} ${r?`unknown`:``}`.trim(),title:n?`路径不存在：${e.path}（点击复制路径）`:r?`无法检测：${e.path}（点击尝试打开）`:`打开 ${e.path}${e.line?` 第 ${e.line} 行`:``}`,onClick:()=>{n?(navigator.clipboard?.writeText?.(e.path),y(`路径不存在，已复制：${e.path}`)):f?.(e)?y(``):y(`宿主不支持直接打开，已复制路径：${e.path}`)}},Y(G,{name:`file`,size:12}),`${e.path}${e.line?`:${e.line}`:``}`)})),v?Y(`div`,{className:`file-hint`},v):null,C?Y(`div`,{className:`file-hint`},C):null):null,Y(`div`,{className:`detail-body`},Y(`div`,{className:`detail-col detail-ai`},Y(`div`,{className:`col-title`},`详情（AI 写，只读）`),Y(`pre`,{className:`detail-text`},t||`（暂无详情）`)),Y(`div`,{className:`detail-col detail-note`},Y(`div`,{className:`col-title`},`备注（可编辑）`),Y(bt,{value:n.text,status:n.status,onChange:i})))),Y(`div`,{className:`modal-foot`},Y(`button`,{type:`button`,className:`btn primary`,onClick:a},Y(G,{name:o?`check`:`copy`,size:14}),o?`已复制 ✓`:`复制交接内容`),Y(`button`,{type:`button`,className:`btn`,onClick:r},`关闭`)))}function Ct({lastUpdated:e,pollingOn:t,dirty:n,onRefresh:r,workspaceLabel:i,boardBehind:a,blocked:o}){return Y(`div`,{className:`statusbar`},i?Y(`span`,{className:`status-item workspace`,title:i},i):null,Y(`span`,{className:`status-item updated`},e?`最后更新 ${e}`:`尚未加载`),Y(`span`,{className:`status-item poll`,title:t?`每 ${Je/1e3}s 自动刷新`:`已暂停刷新`},Y(`span`,{className:`poll-dot ${t?``:`off`}`}),t?`每 ${Je/1e3}s 自动刷新`:`已暂停刷新`),o>0?Y(`span`,{className:`status-item blocked-count`,title:`执行态为「已阻塞」的任务数（等第三方/等确认/被卡住，需要人工介入；仅机械计数）`},`阻塞 ${o}`):null,a>0?Y(`span`,{className:`status-item board-behind`,title:`板面在最近这些轮次里没有更新；仅提示，不阻塞（B-32）`},`板面 ${a} 轮未落板`):null,n?Y(`button`,{type:`button`,className:`link-btn dirty`,onClick:r},`有更新，点击刷新`):null,Y(`button`,{type:`button`,className:`link-btn status-refresh`,onClick:r},`手动刷新`))}function wt(e){let t=Qe(),n=st(null);et(n);let r=(e.useTabInfo?e.useTabInfo():null)?.tab?.visible!==!1,[i,a]=$(null),[o,s]=$(null),[c,l]=$(null),[d,f]=$(!1),[p,_]=$(!1),[v,y]=$(null),[b,x]=$(!1),[S,C]=$({status:`idle`,reason:null,copied:!1}),[w,T]=$(null),[E,re]=$(`current`),[D,ie]=$(!1),[O,se]=$({}),[k,ce]=$(null),[A,ue]=$(null),[j,M]=$({text:``,status:{state:`idle`}}),[he,ge]=$(null),[_e,ve]=$(!1),[ye,be]=$(!1),[xe,N]=$(!1),[Ce,we]=$(``),[Te,Ee]=$(!1),[P,Oe]=$(!1),[ke,F]=$(null),[Ae,je]=$(null),[Me,Ne]=$(()=>Date.now()),[Pe,Fe]=$({});Z(()=>{let e=window.setInterval(()=>Ne(Date.now()),6e4);return()=>window.clearInterval(e)},[]),Z(()=>{typeof e.ensureStyles==`function`&&e.ensureStyles()},[e.ensureStyles]);let I=Q(()=>o?de(o):null,[o]),Ie=Q(()=>o?fe(o):[],[o]),L=Q(()=>k&&I?Tt(I,k):null,[k,I]),Le=Q(()=>L?ae(L,e.sessionId):null,[L,e.sessionId]),Re=Q(()=>L?De(`${A?.detail??``}\n${j.text??``}`):[],[A,L,j.text]),R=j.status.state===`saving`||j.status.state===`dirty`,z=i?.cwd,B=X(e=>{let t=e instanceof u||e instanceof Error?e.message:String(e);ge({message:t})},[]),V=X(()=>{_(!1),f(!0),ge(null),x(!1),y(null),T(null),C(e=>e.status===`idle`?e:{status:`idle`,reason:null,copied:!1})},[]),H=X(async e=>{if(ge(null),f(!1),_(!0),x(!1),T(null),C({status:`idle`,reason:null,copied:!1}),y(null),e)try{let t=await m.historySummary(e);y(t&&typeof t==`object`?t:null)}catch{y(null)}},[]),U=X(async(e,t)=>{let n=!1;try{await navigator.clipboard?.writeText?.(e),n=!0}catch{n=!1}return T(n?`${t}已复制到剪贴板`:`复制失败，请手动复制`),window.setTimeout(()=>T(null),2500),n},[]),ze=X(async t=>{C(e=>({...e,status:`sending`,reason:null,copied:!1})),T(null);let n=null;try{n=typeof e.sendPrompt==`function`?await e.sendPrompt(t):null}catch(e){n={ok:!1,reason:e instanceof Error?e.message:String(e)}}if(n?.ok===!0){C({status:`sent`,reason:null,copied:!1});return}let r=typeof n?.reason==`string`&&n.reason.trim()?n.reason.trim():`自动发送不可用`,i=await U(t,`回填指令`);C({status:`fallback`,reason:r,copied:i})},[U,e.sendPrompt]),Be=X(async()=>{if(z){try{let e=await m.tree(z);if(e&&e.changed!==!1&&e.tree){s(e.tree),l(e.mtimeMs),V();return}}catch{}try{let e=await m.historySummary(z);y(e&&typeof e==`object`?e:null)}catch{y(null)}}},[z,V]),Ve=X(e=>{e===`backfill`?ze(h):e===`init`?ze(g):e===`dismiss`?x(!0):e===`refresh`?Be():e===`copy`?U(h,`回填指令`):e===`copy-init`&&U(g,`初始化提示`)},[U,Be,ze]),W=X(async(e,t={})=>{if(e)try{let n=await m.tree(e,t.ifmtime);if(n.changed===!1)return;s(n.tree),l(n.mtimeMs),V(),t.keepDirty||ve(!1)}catch(t){if(t instanceof u&&t.code===`E_NOT_INITIALIZED`){await H(e);return}B(t)}},[B,V,H]);Z(()=>{let t=!1;return(async()=>{try{let n=e.projectRoot,r=e.sessionId,i=n&&/^[A-Za-z]:[\\/]|^\//.test(n)?await m.current({cwd:n}):r?await m.current({sessionId:r}):await m.current();if(t)return;a(i);let[o,s]=await Promise.all([m.getPrefs().catch(()=>null),m.getUiState(i.cwd).catch(()=>null)]);if(t)return;let c=Ke(o??{});if(re(c.view),ie(s?.rememberExpand===!0),se(s?.rememberExpand===!0?s?.expanded??{}:{}),i.initialized===!1){await H(i.cwd);return}await W(i.cwd);let l=await m.status(i.cwd,e.sessionId).catch(()=>null);!t&&l&&je(l)}catch(e){t||B(e)}})(),()=>{t=!0}},[B,W,H]),Z(()=>{if(!z)return;let t=window.setInterval(()=>{Ye({tabVisible:r,docVisible:document.visibilityState===`visible`,editing:R})&&(typeof e.ensureStyles==`function`&&e.ensureStyles(),m.status(z,e.sessionId).then(e=>je(e)).catch(()=>{}),(async()=>{try{let e=c,t=await m.tree(z,e??void 0);if(t.changed===!1)return;R?ve(!0):(s(t.tree),l(t.mtimeMs),V())}catch{}})())},Je);return()=>window.clearInterval(t)},[z,c,R,r,e.sessionId,V,e.ensureStyles]),Z(()=>{let e=()=>{document.visibilityState===`visible`&&z&&W(z,{ifmtime:c??void 0})};return document.addEventListener(`visibilitychange`,e),()=>document.removeEventListener(`visibilitychange`,e)},[z,W,c]);let He=X(e=>{re(e),m.putPrefs({view:e}).catch(()=>{})},[]),Ue=X(e=>{se(t=>{let n=qe(t,e);return D&&z&&m.putUiState(z,{expanded:n,rememberExpand:!0}).catch(()=>{}),n})},[z,D]),We=X(e=>{ie(e),z&&m.putUiState(z,{expanded:e?O:{},rememberExpand:e}).catch(()=>{})},[z,O]),Ge=X(async e=>{if(!e||Pe[e]!==void 0)return Pe[e];try{let t=(await m.baseline(z,e))?.surface??null;return Fe(n=>({...n,[e]:t})),t}catch{return Fe(t=>({...t,[e]:null})),null}},[Pe,z]),Xe=X(async e=>{ce(e),ue(null),N(!1);try{let t=await m.detail(z,e);ue(t),M({text:t.note??``,status:{state:`idle`}})}catch(e){B(e),ce(null)}},[z,B]);Z(()=>{if(!k||!z||c==null)return;let e=!1;return(async()=>{try{let t=await m.detail(z,k);if(e)return;ue(t),M(e=>e.status.state===`dirty`||e.status.state===`saving`?e:{text:t.note??``,status:{state:`idle`}})}catch{}})(),()=>{e=!0}},[z,k,c]);let Ze=st(null);Z(()=>{let t=Ze.current;Ze.current=r,r&&(typeof e.ensureStyles==`function`&&e.ensureStyles(),t===!1&&z&&W(z,{ifmtime:c??void 0}))},[r,z,W,c,e.ensureStyles]);let $e=st(0),tt=X(t=>{k&&z&&(M(e=>({text:t,status:{state:`dirty`}})),window.clearTimeout($e.current),$e.current=window.setTimeout(async()=>{M(e=>({text:e.text,status:{state:`saving`}}));try{await m.saveNote(z,k,t,e.sessionId),M(e=>({text:e.text,status:{state:`saved`,savedAt:new Date().toLocaleTimeString(`zh-CN`,{hour12:!1})}})),W(z,{ifmtime:c??void 0})}catch(e){let t=e instanceof Error?e.message:String(e);M(e=>({text:e.text,status:{state:`error`,message:t}}))}},500))},[z,k,W,c,e.sessionId]),nt=X(t=>{let n=e.sessionId;if(!n||!t?.path)return!1;let r=Se(n,i?.cwd,t.path),a=typeof e.openResource==`function`&&e.openResource(r,t.line?{params:{line:t.line}}:void 0);if(!a)try{navigator.clipboard?.writeText?.(t.path)}catch{}return!!a},[e.openResource,e.sessionId,i]),G=X(async()=>{if(!L)return;let e=L,t=me(e.id),n=null;t&&(n=await Ge(t));let r=pe(e,[...A?.pathTitles??[e.human_line]],t?{id:t,surface:n}:null,A?.detail??``,j.text);try{await navigator.clipboard.writeText(r),N(!0),window.setTimeout(()=>N(!1),1500)}catch{N(!1)}},[A,L,j.text,Ge]),K=X(e=>{se(t=>({...t,[e.id]:!0})),Xe(e.id)},[Xe]),q=X(async(e,t)=>{if(z){Oe(!0),F(null);try{let n=await e();F(typeof t==`function`?t(n):t),await W(z)}catch(e){let t=e instanceof Error?e.message:String(e);F(t)}finally{Oe(!1)}}},[z,W]),rt=X(e=>{q(()=>m.discard(z,[e]),`已丢进回收站（可在回收站还原）`)},[z,q]),it=X(e=>{q(()=>m.restore(z,[e]),`已还原，状态保持丢弃前的样子`)},[z,q]),at=X(e=>{q(()=>m.purge(z,e),e=>e?.backup?`已彻底删除（备份：${e.backup}，保留 30 天）`:`已彻底删除`)},[z,q]),J=Q(()=>I?le(I,E,O,Ce):{rows:[],matchCount:0,searching:!1},[I,E,O,Ce]),ot=Q(()=>J.rows.map(t=>({...t,signature:oe(t,{currentSessionId:e.sessionId})})),[J.rows,e.sessionId]),ct=Q(()=>I?te(I):[],[I]),lt=Q(()=>I?ne(I):null,[I]);if(he)return Y(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},Y(yt,{kind:`error`,message:he.message,onRetry:()=>{ge(null),z&&W(z)}}));if(!i)return Y(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},Y(yt,{kind:`loading`,message:`加载任务板…`}));if(p){let e=ee({history:v,dismissed:b,backfill:S});return Y(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},Y(yt,{kind:`uninitialized`,message:e.message,hint:w??e.hint,actions:e.actions.map(e=>({label:e.label,primary:e.primary===!0,disabled:e.disabled===!0,onClick:()=>Ve(e.id)}))}),Y(Ct,{workspaceLabel:i.cwd?i.cwd.split(/[\\/]/).filter(Boolean).pop():null,lastUpdated:null,pollingOn:Ye({tabVisible:r,docVisible:document.visibilityState===`visible`,editing:R}),dirty:!1,boardBehind:0,blocked:0,onRefresh:()=>void Be()}))}let ut=L?Et(I,L.id):[];return Y(`div`,{className:`dsh-compass-root`,"data-theme":t,ref:n},Y(ft,{view:E,onView:He,query:Ce,onQuery:we,searching:J.searching,matchCount:J.matchCount,trashCount:Ie.length,onOpenTrash:()=>{F(null),Ee(!0)},onRefresh:()=>z&&void W(z),onOpenSettings:()=>be(!0)}),Y(mt,{items:ct,onJump:K}),d&&I&&(I.root?.children?.length??0)===0?Y(yt,{kind:`empty`,message:`任务板还是空的。`,hint:Ie.length>0?`板上没有可见任务，回收站里还有 ${Ie.length} 项（顶栏垃圾桶图标可还原）。`:`让 AI 用 compass_require 建第一条需求，再用 compass_plan 拆任务。`,onCopyHint:()=>navigator.clipboard.writeText(`请用 compass_require 建第一条需求，再用 compass_plan 拆任务。`)}):d&&J.searching&&ot.length===0?Y(yt,{kind:`search`,message:`当前视图无匹配：${Ce}`,hint:`可切到「完整轨迹」再搜，或清空搜索。`,onRetry:()=>we(``),retryLabel:`清空搜索`}):d?Y(gt,{rows:ot,expanded:O,onToggle:Ue,onOpenDetail:Xe,onDiscard:rt,currentSessionId:e.sessionId,nowMs:Me}):Y(yt,{kind:`loading`,message:`加载任务板…`}),Y(Ct,{workspaceLabel:i?.cwd?i.cwd.split(/[\\/]/).filter(Boolean).pop():null,lastUpdated:c?new Date(c).toLocaleTimeString(`zh-CN`,{hour12:!1}):null,pollingOn:Ye({tabVisible:r,docVisible:document.visibilityState===`visible`,editing:R}),dirty:_e,boardBehind:Ae?.turns_since_board_update??0,blocked:lt?lt.已阻塞:0,onRefresh:()=>z&&void W(z)}),ye?Y(pt,{view:E,rememberExpand:D,onToggleRemember:We,cwd:z,onImported:()=>{z&&W(z)},diagnostics:i.dataDir?`data: ${i.dataDir}\n多窗口并发保护：已启用（写锁 + 版本校验）`:null,onClose:()=>be(!1)}):null,Te?Y(_t,{entries:Ie,busy:P,notice:ke,onRestore:it,onPurge:at,onClose:()=>{Ee(!1),F(null)}}):null,k&&L?Y(St,{node:L,detail:A?.detail??``,noteState:j,onClose:()=>ce(null),onNoteChange:tt,onCopy:G,copied:xe,pathTitles:ut,getSessionLinkState:e.getSessionLinkState,openSession:e.openSession,jumpToTurn:e.jumpToTurn,fileAnchors:Re,onOpenFile:nt,collision:Le,cwd:z}):null)}function Tt(e,t){let n=null,r=e=>{e.id===t&&(n=e);for(let t of e.children??[])r(t)};for(let t of e?.root?.children??[])r(t);return n}function Et(e,t){let n=[],r=(e,i)=>{if(e.id===t)return n.push(...i,e.human_line),!0;for(let t of e.children??[])if(r(t,[...i,e.human_line]))return!0;return!1};for(let t of e?.root?.children??[])r(t,[]);return n}var Dt=`dsh-taskbearing-css`,Ot=`dsh-taskbearing`,kt=`data-dsh-compass-style`;function At(e,t){if(!e||typeof e.createElement!=`function`)return!1;let n=typeof t==`string`?t:``;if(!n)return!1;let r=[];try{let t=typeof e.querySelectorAll==`function`?e.querySelectorAll(`style`):[];for(let e of t){if(!e)continue;let t=typeof e.id==`string`?e.id:``,n=typeof e.getAttribute==`function`?e.getAttribute(kt):null;(t===`dsh-taskbearing-css`||n===`1`)&&r.push(e)}}catch{}if(r.length===0){let t=e.createElement(`style`);return t.id=Dt,t.setAttribute?.(kt,`1`),t.setAttribute?.(`data-plugin`,Ot),t.setAttribute?.(`data-plugin-css`,Ot),t.textContent=n,(e.head??e.documentElement)?.appendChild?.(t),!!(t.isConnected===void 0||t.isConnected||e.head||e.documentElement)}for(let e of r)e.setAttribute?.(kt,`1`),e.setAttribute?.(`data-plugin`,Ot),e.setAttribute?.(`data-plugin-css`,Ot),e.textContent!==n&&(e.textContent=n);return!0}function jt(e,t){return At(e,t),()=>{}}var Mt=`/* ==========================================================================
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

/* ---------- 回收站（v1.33） ---------- */
.dsh-compass-root .trash-entry { position: relative; }
.dsh-compass-root .trash-entry.has-items { color: var(--compass-warn); }
.dsh-compass-root .trash-count {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--compass-warn);
  color: #fff;
  font-size: 9px;
  line-height: 14px;
  text-align: center;
  font-weight: 600;
}

.dsh-compass-root .row-discard-btn {
  display: inline-flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--compass-muted);
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 5px;
  opacity: 0;
  transition: opacity 120ms ease;
}
.dsh-compass-root .tree-row:hover .row-discard-btn { opacity: 1; }
.dsh-compass-root .row-discard-btn:focus-visible { opacity: 1; outline: 2px solid var(--compass-accent); outline-offset: 1px; }
.dsh-compass-root .row-discard-btn:hover { background: var(--compass-active); color: var(--compass-warn); }

.dsh-compass-portal .trash-card .trash-body { display: flex; flex-direction: column; gap: 10px; overflow: auto; min-height: 0; }
.dsh-compass-portal .trash-notice {
  flex: none;
  font-size: 12px;
  color: var(--compass-fg);
  background: var(--compass-secondary);
  border-radius: var(--compass-radius-sm);
  padding: 7px 10px;
  word-break: break-all;
}
.dsh-compass-portal .trash-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 42px 12px;
  color: var(--compass-muted);
  text-align: center;
}
.dsh-compass-portal .trash-empty-title { font-size: 13px; color: var(--compass-fg); }
.dsh-compass-portal .trash-empty .hint { font-size: 12px; line-height: 1.6; max-width: 280px; }
.dsh-compass-portal .trash-list { display: flex; flex-direction: column; gap: 8px; }
.dsh-compass-portal .trash-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--compass-border);
  border-radius: var(--compass-radius);
  background: var(--compass-card);
}
.dsh-compass-portal .trash-row:hover { border-color: var(--compass-border-strong); }
.dsh-compass-portal .trash-row-title {
  font-size: 13px;
  line-height: 1.5;
  color: var(--compass-fg);
  word-break: break-word;
}
.dsh-compass-portal .trash-row-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--compass-muted);
  line-height: 1.5;
  word-break: break-word;
}
.dsh-compass-portal .trash-row-actions { display: flex; gap: 8px; justify-content: flex-end; }
.dsh-compass-portal .trash-row-actions .btn { padding: 4px 12px; font-size: 12px; }
.dsh-compass-portal .trash-row-actions .btn.disabled-look { color: var(--compass-muted); }

@container compass (max-width: 340px) {
  .dsh-compass-portal .trash-row-actions { flex-wrap: wrap; justify-content: flex-start; }
}\r
`,Nt=[`slots`,`sidebarRightTabs`,`sessions`,`workspaces`,`uiWorkspace`,`sidebarRight`];function Pt(){return At(document,Mt)}function Ft(e,t){if(!t)return null;try{let n=e.workspaces?.list?.getSnapshot?.()??e.workspaces?.getSnapshot?.()??null,r=(Array.isArray(n?.items)?n.items:[]).find(e=>Array.isArray(e?.sessionIds)&&e.sessionIds.includes(t));return r?.path||r?.cwd||null}catch{return null}}function It(e){try{let t=e.sessions?.list?.getSnapshot?.()??null,n=e.workspaces?.list?.getSnapshot?.()??null,r=t&&Array.isArray(t.ids)?t:null;if(!r){let e=[];for(let t of Array.isArray(n?.items)?n.items:[])for(let n of Array.isArray(t?.sessionIds)?t.sessionIds:[])e.push(n);e.length>0&&(r={ids:e,phase:`ready`})}let i=n??(r?{state:`ready`}:null);return{canOpen:typeof e.uiWorkspace?.openSession==`function`,sessions:r,workspaces:i}}catch{return{canOpen:!1,sessions:null,workspaces:null}}}function Lt(e){e.effect(()=>jt(document,Mt),`dsh-taskbearing: styles`);async function t(t,n){let r=e.sessions,i=``;try{let e=typeof r?.scope==`function`?r.scope(t):void 0;if(e){let t=e.conversation;if(t&&typeof t.send==`function`)return await t.send(String(n)),{ok:!0,channel:`conversation.send`}}}catch(e){i=e instanceof Error?e.message:String(e)}try{let a=typeof e.get==`function`?e.get(`conversation`):void 0,o=(typeof r?.binding==`function`?r.binding(t):void 0)?.session;if(a&&typeof a.sendSession==`function`&&o)return(await a.sendSession(o,String(n),[],`queue`))?.kind===`success`?{ok:!0,channel:`conversation.sendSession`}:{ok:!1,reason:`会话拒绝接收这条消息（宿主返回 error）`};i||=`宿主未提供会话发送服务（缺少 conversation 服务）`}catch(e){i=e instanceof Error?e.message:String(e)}return{ok:!1,reason:i||`自动发送不可用`}}e.effect(()=>e.sidebarRightTabs.register({id:`dsh-taskbearing`,kind:`compass`,title:()=>`任务板`,guide:[{id:`compass-board`,order:10,title:()=>`任务板`,description:()=>`需求与任务进度板`}]}),`dsh-taskbearing: tab type`),e.effect(()=>e.slots.register({name:`sidebar.right.pane.tab`,key:`dsh-taskbearing`},n=>{let r=n?.sessionId??null;return wt({...n,sessionId:r,projectRoot:Ft(e,r),ensureStyles:Pt,sendPrompt:e=>t(r,e),getSessionLinkState:t=>ke(t,It(e)),openSession:t=>{try{return typeof e.uiWorkspace?.openSession==`function`&&(e.uiWorkspace.openSession(t),!0)}catch{return!1}},jumpToTurn:async({sessionId:t,turn:n,at:i,cwd:a}={})=>{let o=t=>{try{return typeof e.uiWorkspace?.openSession==`function`&&(e.uiWorkspace.openSession(t),!0)}catch{return!1}},s=await We({sessionId:t,turn:n,at:i,request:a&&t?e=>m.sessionTurn(a,e):null});if(s.reason===`log-unavailable`||s.reason===`turn-missing`||s.reason===`no-turn`){let e=s.meta?.target_session??t,n=!0;return e!==r&&(n=o(e)!==!1),{ok:!1,reason:s.reason,opened:n,pages:0,plan:s}}return{...await Ue({sessionId:s.meta?.target_session??t,turn:s.targetTurn,currentSessionId:r,openSession:o}),plan:s}},checkSessions:async(e,t)=>{if(!e||!Array.isArray(t)||t.length===0)return null;try{let n=await m.sessionLinks(e,t),r={};for(let e of n?.sessions??[])r[e.session]=e.exists===!0;return r}catch{return null}},openResource:(t,n)=>{try{return typeof e.sidebarRight?.openResource==`function`&&(e.sidebarRight.openResource(t,n),!0)}catch{return!1}}})}),`dsh-taskbearing: tab body`)}exports.apply=Lt,exports.inject=Nt;
		return module.exports;
	}
});
