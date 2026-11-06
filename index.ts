// Deploy as "youtube-live" with "Verify JWT" turned OFF.
// Secrets: YOUTUBE_API_KEY, FACEBOOK_PAGE_TOKEN (optional), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const DEFAULT_CHANNEL="UCH8_HkjBWFNJtUze4rI4nxA",FB_PAGE="100092427830037";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const J=(o:unknown,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b=await req.json().catch(()=>({}));const T=Deno.env.get("FACEBOOK_PAGE_TOKEN");
  const yt=async(p:string)=>{const r=await fetch("https://www.googleapis.com/youtube/v3/"+p+"&key="+Deno.env.get("YOUTUBE_API_KEY"));const j=await r.json();if(!r.ok)throw new Error(j.error?.message||String(r.status));return j};
  const isPastor=async()=>{const {data:{user}}=await db.auth.getUser((req.headers.get("Authorization")||"").replace("Bearer ",""));if(!user)return false;const {data}=await db.from("admin_profiles").select("role").eq("user_id",user.id).maybeSingle();return data?.role==="pastor"};
  try{
    if(b.action==="connect"){
      if(!await isPastor())return J({error:"Pastor sign-in required"},403);
      const q=String(b.channel||"").trim();let id=(q.match(/UC[\w-]{22}/)||[])[0];
      if(!id){const h=(q.match(/@[\w.-]+/)||[q])[0];id=(await yt("channels?part=id&forHandle="+encodeURIComponent(h))).items?.[0]?.id}
      if(!id)return J({error:"Channel not found. Paste the channel link, e.g. https://www.youtube.com/@name"},400);
      const name=(await yt("channels?part=snippet&id="+id)).items?.[0]?.snippet?.title||"";
      const {error}=await db.from("youtube_connection").upsert({id:1,channel_id:id,channel_name:name,is_live:false,video_id:null,title:null,checked_at:null});
      if(error)throw error;return J({ok:true,channel_name:name});
    }
    let {data:c}=await db.from("youtube_connection").select("*").eq("id",1).maybeSingle();
    if(!c){c={id:1,channel_id:DEFAULT_CHANNEL,channel_name:"OPMC YouTube"};await db.from("youtube_connection").upsert(c)}
    const out=(x:any,e:any={})=>J({configured:true,channel_name:x.channel_name,is_live:!!x.is_live,video_id:x.video_id,title:x.title,yt_error:e.yt||null,fb:{configured:!!T,is_live:!!x.fb_is_live,url:x.fb_url,title:x.fb_title,error:e.fb||null}});
    if(c.checked_at&&Date.now()-new Date(c.checked_at).getTime()<40000)return out(c);
    let yv:any=c.is_live?{id:c.video_id,title:c.title}:null,ytErr=null;
    try{let ids:string[]=[];
      for(const pl of ["UULV","UU"]){try{const r=await yt("playlistItems?part=contentDetails&maxResults=5&playlistId="+pl+c.channel_id.slice(2));ids.push(...(r.items||[]).map((i:any)=>i.contentDetails.videoId))}catch(e){if(!/not\s*found/i.test((e as Error).message))throw e}}
      ids=[...new Set(ids)];yv=null;
      if(ids.length){const l=((await yt("videos?part=snippet&id="+ids.join(","))).items||[]).find((v:any)=>v.snippet.liveBroadcastContent==="live");if(l)yv={id:l.id,title:l.snippet.title}}
    }catch(e){ytErr=(e as Error).message}
    let fv:any=c.fb_is_live?{id:c.fb_notified_id,url:c.fb_url,title:c.fb_title}:null,fbErr=null;
    if(T){try{const r=await fetch("https://graph.facebook.com/v21.0/"+FB_PAGE+"/live_videos?fields=id,status,title,permalink_url&limit=5&access_token="+T);const j=await r.json();if(!r.ok)throw new Error(j.error?.message||String(r.status));
      const l=(j.data||[]).find((x:any)=>x.status==="LIVE");fv=l?{id:l.id,url:/^http/.test(l.permalink_url)?l.permalink_url:"https://www.facebook.com"+l.permalink_url,title:l.title||"OPMC Facebook Live"}:null}catch(e){fbErr=(e as Error).message}}
    const now=new Date().toISOString();
    const n={is_live:!!yv,video_id:yv?.id||null,title:yv?.title||null,fb_is_live:!!fv,fb_url:fv?.url||null,fb_title:fv?.title||null,checked_at:now};
    await db.from("youtube_connection").update(n).eq("id",1);
    const cur=yv||fv;const {data:ls}=await db.from("live_service").select("id").limit(1);
    const lp=cur?{is_live:true,title:cur.title,stream_url:yv?"https://www.youtube.com/watch?v="+yv.id:"",updated_at:now}:{is_live:false,stream_url:"",updated_at:now};
    if(ls?.length)await db.from("live_service").update(lp).eq("id",ls[0].id);else await db.from("live_service").insert(lp);
    const todo:any[]=[];
    if(yv&&yv.id!==c.notified_video_id){todo.push({title:yv.title,tag:"opmc-live"});await db.from("youtube_connection").update({notified_video_id:yv.id}).eq("id",1)}
    if(fv&&fv.id!==c.fb_notified_id){todo.push({title:fv.title,tag:"opmc-live-fb"});await db.from("youtube_connection").update({fb_notified_id:fv.id}).eq("id",1)}
    if(todo.length){try{webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!,Deno.env.get("VAPID_PUBLIC_KEY")!,Deno.env.get("VAPID_PRIVATE_KEY")!);
      const {data:subs}=await db.from("push_subscriptions").select("id,subscription");const dead:string[]=[];
      for(const t of todo)await Promise.all((subs||[]).map(async(s:any)=>{try{await webpush.sendNotification(s.subscription,JSON.stringify({title:t.title||"OPMC is live now",body:"Join the live service now.",url:"/#live",tag:t.tag}))}catch(e){if([404,410].includes((e as any).statusCode))dead.push(s.id)}}));
      if(dead.length)await db.from("push_subscriptions").delete().in("id",dead)}catch(_){}}
    return out({...c,...n},{yt:ytErr,fb:fbErr});
  }catch(e){return J({error:(e as Error).message},500)}
});
