/* Run with Playwright in an ephemeral Docker container; see tests/browser/README.md.
 * Every WhatsApp endpoint is mocked: this suite never sends a real message.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin = process.env.WAB_TEST_ORIGIN || 'http://ludaisca:17100';
const sessionFile = process.env.WAB_TEST_SESSIONS || '/review/sessions.json';
const account = {id:'synthetic-account',name:'Cuenta de prueba',phoneNumber:'520000000000'};
const chats=Array.from({length:153},(_,i)=>({id:`synthetic-${i}`,accountId:account.id,remoteJid:`52000000${String(i).padStart(4,'0')}@s.whatsapp.net`,name:`Prueba ${String(i).padStart(3,'0')}`,isGroup:false,lastMessage:'Conversación de prueba',lastMessageAt:'2026-10-23T16:00:00.000Z',unreadCount:1,contactId:null,assignedToId:null,assignedTo:null,account,campaign:null,contact:null}));
const message=(chatId,id,body)=>({id,direction:'INBOUND',messageType:'text',body,caption:null,mediaId:null,mediaUrl:null,mimeType:null,filename:null,bytesSize:null,transcription:null,reaction:null,status:'DELIVERED',timestamp:'2026-10-23T16:00:00.000Z'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const browser=await chromium.launch({headless:true});
 const sessions=JSON.parse(fs.readFileSync(sessionFile,'utf8'));
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:'authjs.session-token',value:sessions.admin,domain:new URL(origin).hostname,path:'/'}]);
 const page=await context.newPage();const errors=[];const sends=[];
 page.on('pageerror',err=>errors.push(err.message));
 let holdA=false, releaseA, delayedSend=false, releaseSend, failSend=false;
 let inboxError=false;
 await page.route('**/api/whatsapp/**',async route=>{
  const req=route.request();const url=new URL(req.url());const path=url.pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
  if(path==='/api/whatsapp/accounts')return json([account]);
  if(path==='/api/whatsapp/chats'){
   if(inboxError)return json({error:'Mantenimiento'},503);
   const id=url.searchParams.get('chatId');const offset=Number(url.searchParams.get('offset')||0);const size=Number(url.searchParams.get('pageSize')||30);
   const rows=id?chats.filter(c=>c.id===id):chats;
   return json({items:rows.slice(offset,offset+size),total:rows.length,page:1,pageSize:size});
  }
  const match=path.match(/\/chats\/([^/]+)\/messages$/);
  if(match){
   if(match[1]==='synthetic-0'&&holdA)await new Promise(resolve=>{releaseA=resolve;});
   return json([message(match[1],`${match[1]}-in`,`Mensaje de ${match[1]}`)]);
  }
  if(path.endsWith('/send')){
   sends.push({path,body:req.postDataJSON()});
   if(delayedSend)await new Promise(resolve=>{releaseSend=resolve;});
   if(failSend)return json({error:'No se pudo enviar el mensaje de prueba'},502);
   return json({...message('',`sent-${sends.length}`,req.postDataJSON().body||'Adjunto de prueba'),direction:'OUTBOUND'});
  }
  if(path==='/api/whatsapp/media')return json({mediaId:'synthetic-media',mimeType:'text/plain',filename:'prueba.txt',localMediaPath:`${account.id}/prueba.txt`,bytesSize:6});
  if(path.endsWith('/usage'))return json({totalCost:0,totalTokens:0,interactions:0,entries:[]});
  if(req.method()!=='GET')throw new Error(`Unexpected mutation: ${path}`);
  return json([]);
 });
 await page.goto(`${origin}/whatsapp/chat/${account.id}/synthetic-0`,{waitUntil:'networkidle'});
 const composer=page.getByRole('textbox',{name:'Mensaje',exact:true});
 await composer.waitFor();await composer.fill('Borrador A');
 await page.locator('input[type=file]').setInputFiles({name:'prueba.txt',mimeType:'text/plain',buffer:Buffer.from('Prueba')});
 await page.getByRole('button',{name:/Prueba 001/}).click();
 await assert.doesNotReject(()=>composer.waitFor());
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Mensaje"]')?.value==='');
 assert.equal(await page.getByText('prueba.txt',{exact:true}).count(),0);
 await composer.fill('Borrador B');
 await page.getByRole('button',{name:/Prueba 000/}).click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Mensaje"]')?.value==='Borrador A');
 await page.getByText('prueba.txt',{exact:true}).waitFor();
 console.log('PASS per-chat text and file drafts survive route navigation');
 // Send A, navigate to B before the response, and ensure neither B's draft nor its history changes.
 delayedSend=true;
 await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
 while(!releaseSend)await delay(25);
 await page.getByRole('button',{name:/Prueba 001/}).click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Mensaje"]')?.value==='Borrador B');
 releaseSend();delayedSend=false;await delay(300);
 assert.equal(await composer.inputValue(),'Borrador B');
 assert.equal(await page.getByText('Adjunto de prueba',{exact:true}).count(),0);
 assert.equal(sends.length,1);assert.match(sends[0].path,/synthetic-0\/send$/);
 console.log('PASS delayed send cannot clear another draft or append to the wrong thread');
 // A stale initial fetch cannot overwrite B.
 await page.getByRole('button',{name:/Prueba 002/}).click();
 holdA=true;await page.getByRole('button',{name:/Prueba 000/}).click();
 while(!releaseA)await delay(25);
 await page.getByRole('button',{name:/Prueba 001/}).click();
 await page.getByText('Mensaje de synthetic-1',{exact:true}).waitFor();
 holdA=false;releaseA();await delay(300);
 assert.equal(await page.getByText('Mensaje de synthetic-0',{exact:true}).count(),0);
 console.log('PASS late fetch never mixes conversation histories');
 // The same protection applies to an in-flight background poll.
 await page.getByRole('button',{name:/Prueba 000/}).click();
 await page.getByText('Mensaje de synthetic-0',{exact:true}).waitFor();
 holdA=true;releaseA=undefined;
 const pollDeadline=Date.now()+12000;
 while(!releaseA&&Date.now()<pollDeadline)await delay(50);
 assert.ok(releaseA,'Background poll must start');
 await page.getByRole('button',{name:/Prueba 001/}).click();
 await page.getByText('Mensaje de synthetic-1',{exact:true}).waitFor();
 holdA=false;releaseA();await delay(300);
 assert.equal(await page.getByText('Mensaje de synthetic-0',{exact:true}).count(),0);
 console.log('PASS late polling response is cancelled when switching conversations');
 // Load 150 rows, send in the currently selected chat, refresh all rows, and append the final page.
 for(let i=0;i<4;i++){await page.getByRole('button',{name:'Cargar más',exact:true}).click();await delay(100);}
 await page.getByRole('button',{name:/Prueba 149/}).waitFor();
 await composer.fill('Mensaje de prueba');
 await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
 await page.getByText('Mensaje de prueba',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Prueba 149/}).waitFor();
 await page.getByRole('button',{name:'Cargar más',exact:true}).click();
 await page.getByRole('button',{name:/Prueba 152/}).waitFor();
 console.log('PASS 150 loaded chats survive refresh, final page is reachable');
 // Shift+Enter inserts a newline and session storage restores text on a full reload.
 const compactHeight=await composer.evaluate(el=>el.getBoundingClientRect().height);
 await composer.fill(Array.from({length:8},()=>"Línea de prueba").join("\n"));
 assert.ok(await composer.evaluate(el=>el.getBoundingClientRect().height)>compactHeight);
 await composer.fill('Línea uno');await composer.press('Shift+Enter');await composer.pressSequentially('Línea dos');
 assert.equal(await composer.inputValue(),'Línea uno\nLínea dos');
 await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Mensaje"]')?.value==='Línea uno\nLínea dos');
 console.log('PASS multiline composer and tab-local draft recovery');
 // Errors leave the draft available; retry is deliberate.
 failSend=true;await page.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
 await page.getByText(/Tu borrador sigue disponible/).waitFor();
 assert.equal(await composer.inputValue(),'Línea uno\nLínea dos');failSend=false;
 // Check responsive workspace and preserved disabled draft during maintenance.
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/review/chats-mobile.png'});
 inboxError=true;
 await page.goto(`${origin}/whatsapp/chat`,{waitUntil:'networkidle'});
 await page.getByText(/sistema está en mantenimiento/).waitFor();
 assert.equal(await page.getByRole('button',{name:'Reintentar',exact:true}).count(),1);
 console.log('PASS mobile layout and actionable maintenance error');
 assert.deepEqual(errors,[]);
 await browser.close();
})().catch(err=>{console.error(err);process.exit(1)});
